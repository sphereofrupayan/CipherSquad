import time
from typing import Dict, Any, Optional
from services.agent.session import AgentSession
from services.agent.policy import PolicyEngine
from services.agent.registry import ToolRegistry
from services.agent.verifier import Verifier
from services.agent.models.base import BaseModel
from services.agent.models.lmstudio import LMStudioModel
from services.agent.models.gemini import GeminiModel

class AgentLoop:
    """
    Bounded ReAct / Action-Observation agent execution loop.
    Separates loop lifecycle from models, tools, storage, and policy.
    
    Enforces:
      - Max 12 steps
      - Quota limits (tool failures, research calls, generated files)
      - Deterministic Policy checks before every action
      - Intermediate verification and self-correction repair loops
      - Final artifact and claim verification
      - Strict privacy routing: LOCAL_ONLY never falls back to Gemini
    """

    def __init__(
        self,
        session: AgentSession,
        registry: Optional[ToolRegistry] = None,
        policy_engine: Optional[PolicyEngine] = None,
        verifier: Optional[Verifier] = None,
        local_model: Optional[BaseModel] = None,
        cloud_model: Optional[BaseModel] = None
    ):
        self.session = session
        self.registry = registry or ToolRegistry()
        self.policy_engine = policy_engine or PolicyEngine()
        self.verifier = verifier or Verifier()
        self.local_model = local_model or LMStudioModel(timeout=12)
        self.cloud_model = cloud_model or GeminiModel()
        self._local_failed = False
        self._cloud_failed = False

    def run(self) -> AgentSession:
        """Executes the bounded loop until goal is achieved or bounds are reached."""
        while True:
            can_run, reason = self.session.can_continue()
            if not can_run:
                self.session.status = "bounds_reached" if self.session.status == "running" else self.session.status
                self.session.finish_reason = reason
                break

            # 1. PLAN: Model proposes next action
            decision = self._get_plan_decision()
            if not decision:
                # If model is unavailable, check status
                if self.session.status == "waiting_local_model":
                    break
                # Graceful heuristic fallback plan
                decision = self._heuristic_fallback_action()

            thought = decision.get("thought", "")
            action = decision.get("action", "work.finish")
            args = decision.get("args") or {}

            # Check if model chose to finish
            if action == "work.finish":
                summary = args.get("summary") or self.session.summary or "Preparations completed."
                self.session.record_step(
                    thought=thought,
                    action=action,
                    args=args,
                    policy_verdict={"allowed": True, "reason": "Goal finished"},
                    observation={"ok": True, "summary": summary},
                    status="done"
                )
                self.session.status = "finished"
                self.session.finish_reason = "model_finished"
                break

            # 2. POLICY CHECK: LLM never decides permissions
            policy = self.policy_engine.check(action, args, self.session)
            if not policy.get("allowed", True):
                self.session.record_step(
                    thought=thought,
                    action=action,
                    args=args,
                    policy_verdict=policy,
                    observation={"ok": False, "error": "action_blocked", "reason": policy.get("reason")},
                    status="error"
                )
                continue

            # 3. ACT: Execute tool through restricted registry
            observation = self.registry.execute(action, args, self.session)

            # 4. VERIFY & REPAIR (Self-Correction Loop)
            is_valid, repair_hint = self.verifier.verify_step(action, args, observation, self.session)
            if not is_valid:
                observation["ok"] = False
                observation["repair_hint"] = repair_hint
                self.session.record_step(
                    thought=thought,
                    action=action,
                    args=args,
                    policy_verdict=policy,
                    observation=observation,
                    status="error"
                )
                # Next loop iteration will feed repair_hint into context for self-correction!
                continue

            # Step succeeded
            self.session.record_step(
                thought=thought,
                action=action,
                args=args,
                policy_verdict=policy,
                observation=observation,
                status="done"
            )

            # Check if goal is already completely satisfied
            if self.verifier.goal_satisfied(self.session) and self.session.step_count >= 3:
                # Signal wrap-up
                self.session.status = "finished"
                self.session.finish_reason = "goal_satisfied"
                break

        # 5. FINAL VERIFY: Audit artifacts, claims, and requirements
        report = self.verifier.finalize(self.session)
        if self.session.missing_deliverable and not report.get("passed", True):
            self.session.status = "needs_input"
            self.session.finish_reason = f"missing_{self.session.missing_deliverable.lower().replace(' ', '_')}"
        return self.session

    def _get_plan_decision(self) -> Optional[Dict[str, Any]]:
        context = self.session.compact_context()
        tools = self.registry.schemas()

        # Step A: Try LM Studio local model if not previously failed
        if not self._local_failed:
            try:
                return self.local_model.plan(self.session.goal, context, tools, self.session)
            except Exception as local_err:
                print(f"[AgentLoop] Local model notice ({self.session.job_id}): {local_err}")
                self._local_failed = True

        # Step B: Model Routing Check
        if self.session.routing == "LOCAL_ONLY":
            # STRICT PRIVACY RULE: NEVER fall back to Gemini for LOCAL_ONLY!
            print(f"[AgentLoop] LOCAL_ONLY routing active. Gemini cloud fallback prohibited.")
            self.session.status = "waiting_local_model"
            self.session.summary = "Job paused: local model unavailable. Cloud fallback prohibited by Privacy Gate."
            return None

        # Step C: If CLOUD_ALLOWED, attempt Gemini fallback if not previously failed
        if self.session.routing == "CLOUD_ALLOWED" and not self._cloud_failed:
            try:
                print(f"[AgentLoop] Falling back to Gemini for CLOUD_ALLOWED job {self.session.job_id}...")
                return self.cloud_model.plan(self.session.goal, context, tools, self.session)
            except Exception as cloud_err:
                print(f"[AgentLoop] Cloud model fallback notice: {cloud_err}")
                self._cloud_failed = True

        return None

    def _heuristic_fallback_action(self) -> Dict[str, Any]:
        """
        Deterministic state machine fallback if both LLMs are temporarily unresponsive,
        ensuring bounded progress without infinite spinning.
        """
        import re
        source = self.session.source_email
        subject = source.get("subject", "Task")
        sender = source.get("sender", "Sender")
        clean_sender = sender.split("<")[0].strip()
        snippet = source.get("snippet", "")
        combined = f"{subject} {snippet}".lower()

        # Check if the email explicitly requests a specific deliverable like OS PDF, document, slides
        needs_pdf = bool(re.search(r"\b(pdf|document)\b", combined))
        has_pdf = any(a.get("name", "").lower().endswith(".pdf") for a in self.session.artifacts)

        if needs_pdf and not has_pdf:
            topic = "OS PDF" if "os" in combined else "PDF document"
            self.session.missing_deliverable = topic
            self.session.status = "needs_input"
            summary_msg = f"Needs input — which {topic} should be provided to {clean_sender}?"
            self.session.summary = summary_msg
            reply_text = (
                f"Hi {clean_sender},\n\n"
                f"I received your request regarding '{subject}'. Could you please clarify which {topic} is needed?\n\n"
                f"Best regards,\nPriyam"
            )
            self.session.set_reply(reply_text)
            return {
                "thought": f"Specific deliverable required ({topic}) but source file cannot be determined without user input.",
                "action": "work.finish",
                "args": {"summary": summary_msg}
            }

        # Phase 1: Checklist
        if not self.session.checklist:
            return {
                "thought": "Create actionable checklist items for this assignment.",
                "action": "work.create_checklist",
                "args": {
                    "items": [
                        f"Review {subject} instructions and deliverables",
                        "Prepare solutions, documentation, and code",
                        "Verify submission requirements before deadline"
                    ]
                }
            }

        # Phase 2: Workspace Artifacts
        file_artifacts = [a for a in self.session.artifacts if a.get("type") == "file"]
        if not file_artifacts:
            safe_slug = re.sub(r"[^\w]+", "_", subject).strip("_")[:24] or "Task"
            spec = {
                "title": f"Checklist: {subject}",
                "sections": [
                    {"heading": "Task Details", "content": f"Assigned by: {sender}\nSubject: {subject}\nAction required before deadline."},
                    {"heading": "Action Items", "content": "\n".join([f"- [ ] {item}" for item in self.session.checklist])}
                ],
                "references": ["Internal Coursework Guidelines"]
            }
            return {
                "thought": "Generate Markdown checklist artifact.",
                "action": "file.create_markdown",
                "args": {
                    "filename": f"{safe_slug}_checklist.md",
                    "spec": spec
                }
            }

        # Phase 3: Prepare draft reply
        if not self.session.reply_draft.get("body"):
            reply_text = (
                f"Hi {clean_sender},\n\n"
                f"I received your email regarding '{subject}'. I am reviewing the details now.\n\n"
                f"Best regards,\nPriyam"
            )
            return {
                "thought": "Draft polite receipt acknowledgement.",
                "action": "mail.prepare_reply",
                "args": {
                    "body": reply_text
                }
            }

        # Phase 4: Finish
        return {
            "thought": "All preparations ready.",
            "action": "work.finish",
            "args": {"summary": f"Prepared checklist and response draft for {subject}."}
        }
