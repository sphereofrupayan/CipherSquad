import os
import json
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional, Tuple

def _now():
    return datetime.now(timezone.utc).isoformat()

class AgentSession:
    """
    Manages the lifecycle, step history, bounds counters, and state for a single Work Agent job.
    Enforces bounded execution:
      - max_steps: 12
      - max_tool_failures: 3
      - max_research_calls: 4
      - max_generated_files: 5
    """

    def __init__(
        self,
        job_id: str,
        user_id: str,
        goal: str,
        source_email: Optional[Dict[str, Any]] = None,
        routing: str = "LOCAL_ONLY",
        autonomy_level: str = "safe_replies",
        max_steps: int = 12,
        max_tool_failures: int = 3,
        max_research_calls: int = 4,
        max_generated_files: int = 5,
        on_step: Optional[Any] = None
    ):
        self.job_id = job_id
        self.user_id = user_id
        self.goal = goal
        self.source_email = source_email or {}
        self.routing = routing  # "BLOCK" | "LOCAL_ONLY" | "CLOUD_ALLOWED"
        self.autonomy_level = autonomy_level  # "off" | "prepare" | "safe_replies" | "full_prepare"
        self.on_step = on_step

        self.max_steps = max_steps
        self.max_tool_failures = max_tool_failures
        self.max_research_calls = max_research_calls
        self.max_generated_files = max_generated_files

        self.step_count = 0
        self.tool_failures = 0
        self.research_calls = 0
        self.generated_files = 0

        self.steps: List[Dict[str, Any]] = []
        self.artifacts: List[Dict[str, Any]] = []
        self.notes: List[str] = []
        self.checklist: List[str] = []
        self.reply_draft: Dict[str, Any] = {}
        self.summary: str = ""
        self.status: str = "running"
        self.finish_reason: Optional[str] = None
        self.missing_deliverable: Optional[str] = None
        self.verification_report: Dict[str, Any] = {}

    def can_continue(self) -> Tuple[bool, str]:
        """Check whether session has exceeded any execution bounds."""
        if self.status != "running":
            return False, f"Session is in '{self.status}' state."
        if self.step_count >= self.max_steps:
            return False, f"Maximum steps exceeded ({self.max_steps})."
        if self.tool_failures >= self.max_tool_failures:
            return False, f"Maximum tool failures reached ({self.max_tool_failures})."
        return True, ""

    def record_step(
        self,
        thought: str,
        action: str,
        args: Dict[str, Any],
        policy_verdict: Dict[str, Any],
        observation: Any,
        status: str = "done"
    ):
        self.step_count += 1
        step_record = {
            "step_no": self.step_count,
            "thought": str(thought or "").strip(),
            "action": action,
            "args": args,
            "policy": policy_verdict,
            "observation": observation,
            "status": status,
            "at": _now()
        }
        self.steps.append(step_record)

        if not policy_verdict.get("allowed", True) or status == "error":
            self.tool_failures += 1
        else:
            if action.startswith("research."):
                self.research_calls += 1
            elif action.startswith("file.create_"):
                self.generated_files += 1

        if self.on_step:
            try:
                self.on_step(self, step_record)
            except Exception as cb_err:
                print(f"[AgentSession] on_step callback error: {cb_err}")

    def add_artifact(self, artifact: Dict[str, Any]):
        # Avoid duplicate artifacts by path or name
        path = artifact.get("path") or artifact.get("name")
        for idx, existing in enumerate(self.artifacts):
            if (existing.get("path") or existing.get("name")) == path:
                self.artifacts[idx] = artifact
                return
        self.artifacts.append(artifact)
        if self.on_step:
            try:
                self.on_step(self, None)
            except Exception as cb_err:
                print(f"[AgentSession] on_step artifact callback error: {cb_err}")

    def add_note(self, note: str):
        n = str(note or "").strip()
        if n and n not in self.notes:
            self.notes.append(n)

    def set_checklist(self, items: List[str]):
        if isinstance(items, list):
            self.checklist = [str(i).strip() for i in items if str(i).strip()]

    def set_reply(self, body: str, subject: str = "", to: str = ""):
        self.reply_draft = {
            "body": str(body or "").strip(),
            "subject": str(subject or "").strip(),
            "to": str(to or "").strip()
        }

    def compact_context(self) -> str:
        """Emits a compact summary of session state for model prompts to avoid context bloat."""
        art_names = [a.get("name") for a in self.artifacts]
        recent_steps = self.steps[-3:] if len(self.steps) > 3 else self.steps
        history_lines = []
        for s in recent_steps:
            history_lines.append(
                f"- Step {s['step_no']} [{s['action']}]: {str(s.get('observation'))[:200]}"
            )

        return (
            f"Job: {self.job_id} | Step: {self.step_count}/{self.max_steps} | Autonomy: {self.autonomy_level}\n"
            f"Goal: {self.goal}\n"
            f"Artifacts created ({len(art_names)}): {', '.join(art_names) or 'None'}\n"
            f"Checklist items ({len(self.checklist)}): {len(self.checklist)} registered\n"
            f"Draft reply ready: {'Yes' if self.reply_draft.get('body') else 'No'}\n"
            f"Recent history:\n" + ("\n".join(history_lines) if history_lines else "None yet.")
        )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "job_id": self.job_id,
            "user_id": self.user_id,
            "goal": self.goal,
            "routing": self.routing,
            "autonomy_level": self.autonomy_level,
            "status": self.status,
            "finish_reason": self.finish_reason,
            "missing_deliverable": self.missing_deliverable,
            "step_count": self.step_count,
            "max_steps": self.max_steps,
            "counters": {
                "tool_failures": self.tool_failures,
                "research_calls": self.research_calls,
                "generated_files": self.generated_files
            },
            "steps": self.steps,
            "artifacts": self.artifacts,
            "notes": self.notes,
            "checklist": self.checklist,
            "reply_draft": self.reply_draft,
            "summary": self.summary,
            "verification_report": self.verification_report
        }
