import os
import json
import re
import hashlib
import queue
import threading
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
import requests

from services.google_service import (
    create_gmail_draft,
    send_gmail_draft,
    update_gmail_draft,
    get_gmail_threads,
    get_gmail_thread,
    get_gmail_draft,
    delete_gmail_draft
)
from services.auto_send_policy import AutoSendPolicy
from services.privacy_gate import PrivacyGate
from services.agent import AgentSession, AgentLoop, PolicyEngine, ToolRegistry, Verifier

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
WORKSPACES_DIR = BASE_DIR / "workspaces"
JOBS_FILE = DATA_DIR / "work_jobs.json"
SETTINGS_FILE = DATA_DIR / "work_settings.json"

DEFAULT_SETTINGS = {
    "auto_prep": True,
    "create_gmail_drafts": True,
    "auto_send_mode": "safe_replies",  # "off", "prepare", "safe_replies", "full_prepare"
    "countdown_seconds": 20,
    "trusted_senders": []
}

def _now():
    return datetime.now(timezone.utc).isoformat()

def _clean(val, limit=2000):
    return re.sub(r"\s+", " ", str(val or "")).strip()[:limit]

def clean_job_title(title: str, subject: str = "") -> str:
    """Transform messy or classified titles into clean, concise human-readable titles."""
    raw = title or subject or "Work Task"
    # Remove synthetic prefixes like "Assignment: ", "Task: ", "Re: ", "Fwd: "
    cleaned = re.sub(r"^(?:assignment|task|follow-?up|re|fwd|todo)[\s:]+", "", raw, flags=re.I).strip()
    if not cleaned or cleaned.lower() == "no subject":
        cleaned = subject if (subject and subject.lower() != "no subject") else "DA Submission"
    cleaned = re.sub(r"^(?:assignment|task|follow-?up|re|fwd|todo)[\s:]+", "", cleaned, flags=re.I).strip()
    if not cleaned:
        cleaned = "DA Submission"
    
    words = cleaned.split()
    fixed_words = []
    acronyms = {"da", "os", "ai", "stt", "tts", "api", "db", "ui", "ux", "ml", "llm", "cse", "ece", "vit"}
    for w in words:
        low = re.sub(r"[^\w]", "", w.lower())
        if low in acronyms:
            # Preserve punctuation around acronym
            fixed_words.append(re.sub(r"[a-zA-Z]+", low.upper(), w))
        elif w.isupper() and len(w) > 1:
            fixed_words.append(w)
        else:
            fixed_words.append(w.capitalize())
    return " ".join(fixed_words)


class WorkAgentService:
    def __init__(self):
        self.base_url = os.getenv("LM_STUDIO_BASE_URL", "http://127.0.0.1:2806/v1").rstrip("/")
        self.model = os.getenv("LM_STUDIO_MODEL", "")
        self.timeout = int(os.getenv("LM_STUDIO_TIMEOUT_SECONDS", "30"))
        self._lock = threading.RLock()
        self._queue = queue.Queue()
        self._running_worker = None
        self._active_jobs = set()
        self._start_queue_worker()

    def _start_queue_worker(self):
        def worker_loop():
            while True:
                job_id, user_id = self._queue.get()
                try:
                    self._execute_job(job_id, user_id)
                except Exception as e:
                    print(f"[WorkAgent] Worker error for {job_id}: {e}")
                finally:
                    self._queue.task_done()
                    with self._lock:
                        self._active_jobs.discard(job_id)

        t = threading.Thread(target=worker_loop, daemon=True, name="WorkAgent-Worker")
        t.start()
        self._running_worker = t

    def get_settings(self) -> dict:
        if not SETTINGS_FILE.exists():
            return dict(DEFAULT_SETTINGS)
        try:
            data = json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
            merged = dict(DEFAULT_SETTINGS)
            merged.update(data if isinstance(data, dict) else {})
            return merged
        except Exception:
            return dict(DEFAULT_SETTINGS)

    def update_settings(self, new_settings: dict) -> dict:
        current = self.get_settings()
        for k, v in (new_settings or {}).items():
            if k in DEFAULT_SETTINGS:
                current[k] = v
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        SETTINGS_FILE.write_text(json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8")
        return current

    def _read_jobs(self):
        if not JOBS_FILE.exists():
            return {}
        try:
            data = json.loads(JOBS_FILE.read_text(encoding="utf-8"))
            if not isinstance(data, dict):
                return {}
            # Ensure titles and verdicts are normalized
            settings = self.get_settings()
            for jid, j in data.items():
                if "clean_title" not in j:
                    j["clean_title"] = clean_job_title(j.get("title", ""), (j.get("source") or {}).get("subject", ""))
                if "policy_verdict" not in j and j.get("output", {}).get("suggested_reply"):
                    j["policy_verdict"] = AutoSendPolicy.evaluate(
                        j["output"]["suggested_reply"],
                        artifacts=j.get("artifacts", []),
                        source=j.get("source", {}),
                        settings=settings
                    )
            return data
        except Exception:
            return {}

    def _write_jobs(self, jobs):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        tmp = JOBS_FILE.with_suffix(".tmp")
        tmp.write_text(json.dumps(jobs, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(JOBS_FILE)

    def _job_id(self, user_id, message_id):
        digest = hashlib.sha256(f"{user_id}:{message_id}".encode("utf-8")).hexdigest()[:12]
        return f"work_{digest}"

    def reconcile_jobs_with_gmail(self, user_id=None):
        """
        Inspect unresolved WorkJobs tied to Gmail threads.
        If the authenticated user sent a newer outbound message on the thread,
        transition the job to 'resolved_external', cancel any auto-send countdown,
        and safely delete Mailmate's own stale draft if one exists.
        """
        reconciled = []
        with self._lock:
            jobs = self._read_jobs()
            unresolved_statuses = {
                "queued", "reading_context", "planning", "researching",
                "generating", "drafting_reply", "creating_files",
                "verifying", "preparing", "working", "waiting_approval",
                "auto_send_countdown", "needs_input"
            }
            changed = False
            for jid, job in list(jobs.items()):
                if user_id and job.get("user_id") != user_id:
                    continue
                if job.get("status") not in unresolved_statuses:
                    continue

                source = job.get("source") or {}
                thread_id = source.get("thread_id")
                source_msg_id = source.get("message_id")
                if not thread_id:
                    continue

                try:
                    thread_data = get_gmail_thread(thread_id)
                except Exception as e:
                    print(f"[WorkAgent] Thread check failed ({thread_id}): {e}")
                    continue

                if not thread_data or not thread_data.get("messages"):
                    continue

                messages = thread_data["messages"]
                # Find index of source inbound message
                source_index = -1
                for idx, m in enumerate(messages):
                    if m.get("id") == source_msg_id or m.get("gmail_id") == source_msg_id:
                        source_index = idx
                        break

                later_messages = messages[source_index + 1:] if source_index >= 0 else messages
                outbound = next((m for m in later_messages if m.get("direction") == "outbound" or m.get("is_sent_by_me")), None)

                if outbound:
                    print(f"[WorkAgent] Thread {thread_id} already handled externally via Gmail (msg {outbound.get('id')}). Reconciling job {jid}...")
                    job["status"] = "resolved_external"
                    job["resolved_at"] = outbound.get("date") or outbound.get("timestamp") or _now()
                    job["resolved_message_id"] = outbound.get("id")
                    job["resolution"] = "manual_gmail_reply"
                    job["updated_at"] = _now()
                    changed = True

                    # Cancel auto-send countdown if running
                    if "countdown" in job:
                        job["countdown"]["cancelled"] = True

                    # Clean up Mailmate's own draft if it was staged but not used
                    draft_id = (job.get("output") or {}).get("gmail_draft_id")
                    if draft_id:
                        try:
                            existing_draft = get_gmail_draft(draft_id)
                            if existing_draft:
                                delete_gmail_draft(draft_id)
                                job["output"]["draft_stale"] = True
                                job["output"]["gmail_draft_id"] = None
                            else:
                                job["resolution"] = "manual_gmail_reply_sent_draft"
                        except Exception as d_err:
                            print(f"[WorkAgent] Draft cleanup notice: {d_err}")

                    # Append history step
                    if "steps" not in job:
                        job["steps"] = []
                    job["steps"].append({
                        "type": "resolved_external",
                        "label": "Replied via Gmail (Handled outside Mailmate)",
                        "status": "done",
                        "at": _now()
                    })
                    reconciled.append(job)

            if changed:
                self._write_jobs(jobs)

        return reconciled

    def list_jobs(self, user_id, reconcile=True):
        if reconcile and user_id:
            try:
                self.reconcile_jobs_with_gmail(user_id)
            except Exception as e:
                print(f"[WorkAgent] Reconciliation notice in list_jobs: {e}")

        with self._lock:
            jobs = self._read_jobs()
            user_jobs = [j for j in jobs.values() if j.get("user_id") == user_id]
            user_jobs.sort(key=lambda x: x.get("updated_at") or "", reverse=True)
            return user_jobs

    def get_active_jobs(self, user_id):
        active_statuses = {
            "queued", "reading_context", "planning", "researching",
            "generating", "drafting_reply", "creating_files",
            "verifying", "preparing", "working"
        }
        return [j for j in self.list_jobs(user_id, reconcile=False) if j.get("status") in active_statuses]

    def get_waiting_approval_jobs(self, user_id):
        return [j for j in self.list_jobs(user_id, reconcile=False) if j.get("status") in {"waiting_approval", "auto_send_countdown"}]

    def get_needs_input_jobs(self, user_id):
        return [j for j in self.list_jobs(user_id, reconcile=False) if j.get("status") == "needs_input"]

    def get_completed_jobs(self, user_id):
        completed_statuses = {"sent", "approved_sent", "resolved_external", "cancelled", "failed"}
        return [j for j in self.list_jobs(user_id, reconcile=False) if j.get("status") in completed_statuses]

    def get_job(self, job_id, user_id):
        with self._lock:
            jobs = self._read_jobs()
            job = jobs.get(str(job_id))
            if job and job.get("user_id") == user_id:
                return job
            return None

    def sync_and_enqueue(self, user_id, overview_data):
        """Analyze overview tasks, create WorkJob records, and enqueue actionable jobs."""
        if not user_id or not overview_data:
            return []

        settings = self.get_settings()
        if not settings.get("auto_prep", True):
            return []

        needs_attention = overview_data.get("needs_attention") or []
        emails = overview_data.get("emails") or []
        email_map = {str(e.get("id") or e.get("gmail_id")): e for e in emails}

        new_jobs = []
        with self._lock:
            jobs = self._read_jobs()
            for item in needs_attention:
                msg_id = str(item.get("source_message_id") or "")
                if not msg_id:
                    continue
                email = email_map.get(msg_id) or {}
                thread_id = email.get("thread_id") or msg_id
                subject = email.get("subject") or item.get("description") or "Action Item"
                sender = email.get("sender") or email.get("from") or "Unknown sender"
                snippet = email.get("snippet") or item.get("description") or ""

                # Privacy Gate: Verify that item is safe and actionable for the Work Plane
                gate = PrivacyGate.evaluate(email if email else {"subject": subject, "snippet": snippet, "sender": sender})
                if gate.get("work_agent_allowed") is not True:
                    continue

                job_id = self._job_id(user_id, msg_id)

                if job_id not in jobs:
                    is_academic = bool(re.search(r"\b(DA|assignment|submission|exam|quiz|synopsis|project)\b", f"{subject} {snippet}", re.I))
                    display_title = clean_job_title(subject, subject)

                    job = {
                        "id": job_id,
                        "user_id": user_id,
                        "title": display_title,
                        "clean_title": display_title,
                        "kind": "assignment-prep" if is_academic else "email-reply",
                        "status": "queued",
                        "source": {
                            "type": "gmail",
                            "message_id": msg_id,
                            "thread_id": thread_id,
                            "sender": sender,
                            "subject": subject,
                            "snippet": snippet,
                            "deadline": item.get("deadline") or ""
                        },
                        "steps": [
                            {"type": "read_thread", "label": f"Read email from {sender.split('<')[0].strip()}", "status": "done"},
                            {"type": "extract_requirements", "label": "Identified action & deadline", "status": "done"},
                            {"type": "prepare_reply", "label": "Prepare draft reply", "status": "queued"},
                            {"type": "create_files", "label": "Generate checklist / artifacts", "status": "queued"},
                            {"type": "human_approval", "label": "Waiting for review", "status": "pending"}
                        ],
                        "output": {
                            "summary": item.get("description") or snippet,
                            "checklist": [],
                            "suggested_reply": "",
                            "gmail_draft_id": None,
                            "notes": []
                        },
                        "policy_verdict": None,
                        "artifacts": [],
                        "created_at": _now(),
                        "updated_at": _now()
                    }
                    jobs[job_id] = job
                    new_jobs.append(job_id)
                    self._queue.put((job_id, user_id))

            if new_jobs:
                self._write_jobs(jobs)

        return new_jobs

    def run_job(self, job_id, user_id):
        job = self.get_job(job_id, user_id)
        if not job:
            return None
        with self._lock:
            jobs = self._read_jobs()
            if job_id in jobs:
                jobs[job_id]["status"] = "queued"
                jobs[job_id]["updated_at"] = _now()
                self._write_jobs(jobs)
                self._queue.put((job_id, user_id))
                return jobs[job_id]
        return None

    def cancel_job(self, job_id, user_id):
        with self._lock:
            jobs = self._read_jobs()
            if job_id in jobs and jobs[job_id].get("user_id") == user_id:
                jobs[job_id]["status"] = "cancelled"
                jobs[job_id]["updated_at"] = _now()
                if "countdown" in jobs[job_id]:
                    jobs[job_id]["countdown"]["cancelled"] = True
                self._write_jobs(jobs)
                return jobs[job_id]
        return None

    def cancel_countdown(self, job_id, user_id):
        """Immediately halts the 20-second auto-send timer and holds for human approval."""
        with self._lock:
            jobs = self._read_jobs()
            job = jobs.get(str(job_id))
            if not job or job.get("user_id") != user_id:
                return None
            if job.get("status") == "auto_send_countdown":
                job["status"] = "waiting_approval"
                job["updated_at"] = _now()
                if "countdown" in job:
                    job["countdown"]["cancelled"] = True
                for step in job.get("steps", []):
                    if step.get("type") == "countdown":
                        step["status"] = "cancelled"
                        step["label"] = "Auto-send cancelled by user"
                job["steps"].append({
                    "type": "human_approval",
                    "label": "Waiting for manual human approval",
                    "status": "pending",
                    "at": _now()
                })
                self._write_jobs(jobs)
                return job
            return job

    def save_draft(self, job_id, user_id, edited_reply):
        """Save manual edits to the draft without sending. Aborts any active auto-send countdown."""
        with self._lock:
            jobs = self._read_jobs()
            job = jobs.get(str(job_id))
            if not job or job.get("user_id") != user_id:
                return None

            # If job was in auto-send countdown, an edit halts auto-send
            if job.get("status") == "auto_send_countdown":
                job["status"] = "waiting_approval"
                if "countdown" in job:
                    job["countdown"]["cancelled"] = True

            job["updated_at"] = _now()
            if "reply_draft" not in job:
                job["reply_draft"] = {}
            job["reply_draft"]["body"] = edited_reply
            if "output" not in job:
                job["output"] = {}
            job["output"]["suggested_reply"] = edited_reply

            # Re-evaluate policy verdict for the edited text
            settings = self.get_settings()
            job["policy_verdict"] = AutoSendPolicy.evaluate(
                edited_reply,
                artifacts=job.get("artifacts", []),
                source=job.get("source", {}),
                settings=settings
            )

            # Update real Gmail draft if one exists
            draft_id = job.get("output", {}).get("gmail_draft_id")
            source = job.get("source") or {}
            sender = source.get("sender") or ""
            match = re.search(r"[\w\.-]+@[\w\.-]+", sender)
            to_email = match.group(0) if match else sender
            subj = "Re: " + re.sub(r"^(Re:\s*)+", "", source.get("subject") or "", flags=re.I)
            if draft_id:
                try:
                    update_gmail_draft(draft_id, to_email, subj, edited_reply, thread_id=source.get("thread_id"))
                except Exception as e:
                    print(f"[WorkAgent] Failed to update draft on save: {e}")
            else:
                try:
                    draft_res = create_gmail_draft(to_email, subj, edited_reply, thread_id=source.get("thread_id"))
                    job["output"]["gmail_draft_id"] = draft_res.get("id")
                except Exception as e:
                    print(f"[WorkAgent] Failed to create draft on save: {e}")

            self._write_jobs(jobs)
            return job

    def approve_job(self, job_id, user_id, edited_reply=None, auto_sent=False):
        """Human approval boundary: Execute external action (send the Gmail draft)."""
        job = self.get_job(job_id, user_id)
        if not job:
            raise ValueError("Job not found")

        # Reconcile with Gmail thread before executing send
        source = job.get("source") or {}
        thread_id = source.get("thread_id")
        source_msg_id = source.get("message_id")
        if thread_id and not auto_sent:
            try:
                thread_data = get_gmail_thread(thread_id)
                if thread_data and thread_data.get("messages"):
                    msgs = thread_data["messages"]
                    s_idx = -1
                    for idx, m in enumerate(msgs):
                        if m.get("id") == source_msg_id or m.get("gmail_id") == source_msg_id:
                            s_idx = idx
                            break
                    later = msgs[s_idx + 1:] if s_idx >= 0 else msgs
                    outbound = next((m for m in later if m.get("direction") == "outbound" or m.get("is_sent_by_me")), None)
                    if outbound:
                        print(f"[WorkAgent] Aborting send for job {job_id}: thread {thread_id} already has outbound reply {outbound.get('id')}.")
                        with self._lock:
                            jobs = self._read_jobs()
                            if job_id in jobs:
                                jobs[job_id]["status"] = "resolved_external"
                                jobs[job_id]["resolution"] = "manual_gmail_reply"
                                jobs[job_id]["resolved_at"] = outbound.get("date") or _now()
                                jobs[job_id]["resolved_message_id"] = outbound.get("id")
                                self._write_jobs(jobs)
                        return jobs.get(job_id) or job
            except Exception as e:
                print(f"[WorkAgent] approve_job reconciliation check notice: {e}")

        with self._lock:
            jobs = self._read_jobs()
            if job_id in jobs:
                jobs[job_id]["status"] = "sending"
                self._write_jobs(jobs)

        source = job.get("source") or {}
        sender = source.get("sender") or ""
        match = re.search(r"[\w\.-]+@[\w\.-]+", sender)
        to_email = match.group(0) if match else sender
        subj = "Re: " + re.sub(r"^(Re:\s*)+", "", source.get("subject") or "", flags=re.I)
        body = edited_reply or (job.get("reply_draft") or {}).get("body") or (job.get("output") or {}).get("suggested_reply") or "Thank you, I am working on this."

        try:
            draft_id = (job.get("output") or {}).get("gmail_draft_id")
            if not draft_id:
                # If no draft ID exists yet, create one now
                draft_res = create_gmail_draft(to_email, subj, body, thread_id=source.get("thread_id"))
                draft_id = draft_res.get("id")
            elif edited_reply:
                # Update existing draft with user's edited content before sending
                try:
                    update_gmail_draft(draft_id, to_email, subj, body, thread_id=source.get("thread_id"))
                except Exception as e:
                    print(f"[WorkAgent] Notice: draft update warning: {e}")

            # Now send the exact reviewed draft
            send_res = send_gmail_draft(draft_id)
        except Exception as exc:
            with self._lock:
                jobs = self._read_jobs()
                if job_id in jobs:
                    jobs[job_id]["status"] = "waiting_approval"
                    jobs[job_id]["updated_at"] = _now()
                    self._write_jobs(jobs)
            raise exc

        with self._lock:

            jobs = self._read_jobs()
            if job_id in jobs:
                jobs[job_id]["status"] = "sent"
                jobs[job_id]["updated_at"] = _now()
                if edited_reply:
                    if "reply_draft" in jobs[job_id]:
                        jobs[job_id]["reply_draft"]["body"] = edited_reply
                    if "output" in jobs[job_id]:
                        jobs[job_id]["output"]["suggested_reply"] = edited_reply
                jobs[job_id]["output"]["gmail_draft_id"] = draft_id
                
                # Update steps
                for step in jobs[job_id].get("steps", []):
                    if step.get("type") in ["human_approval", "countdown"]:
                        step["status"] = "done"
                        step["label"] = "Sent automatically (Safe acknowledgement rule)" if auto_sent else "Approved & sent via Gmail"
                
                jobs[job_id]["steps"].append({
                    "type": "email_sent",
                    "label": f"Sent email to {job.get('source', {}).get('sender')}",
                    "status": "done",
                    "auto_sent": auto_sent,
                    "at": _now()
                })
                self._write_jobs(jobs)
                return jobs[job_id]

    def _on_session_step(self, job_id, session, step_record):
        """Immediately persists each agent step as it executes."""
        with self._lock:
            jobs = self._read_jobs()
            job = jobs.get(job_id)
            if not job:
                return
            job["status"] = "working"
            job["steps"] = list(session.steps)
            job["artifacts"] = list(session.artifacts)
            if step_record:
                job["current_step"] = step_record.get("thought") or step_record.get("action") or "Working"
                job["activity_label"] = step_record.get("action") or "Working"
                job["step_index"] = session.step_count
                job["step_count"] = session.step_count
            job["updated_at"] = _now()
            self._write_jobs(jobs)

    def _execute_job(self, job_id, user_id):
        with self._lock:
            jobs = self._read_jobs()
            job = jobs.get(job_id)
            if not job or job.get("status") == "cancelled":
                return
            job["status"] = "preparing"
            job["updated_at"] = _now()
            self._write_jobs(jobs)

        source = job.get("source") or {}
        subject = source.get("subject") or ""
        snippet = source.get("snippet") or ""
        sender = source.get("sender") or ""
        deadline = source.get("deadline") or ""

        # Step 1: Privacy Gate & Routing
        gate = PrivacyGate.evaluate(source if source else {"subject": subject, "snippet": snippet, "sender": sender})
        routing = gate.get("routing", "LOCAL_ONLY")
        if routing == "BLOCK":
            with self._lock:
                jobs = self._read_jobs()
                if job_id in jobs:
                    jobs[job_id]["status"] = "blocked"
                    jobs[job_id]["summary"] = "Job blocked: content classified as sensitive by Privacy Gate."
                    jobs[job_id]["routing"] = routing
                    jobs[job_id]["updated_at"] = _now()
                    self._write_jobs(jobs)
            return

        settings = self.get_settings()
        autonomy_level = settings.get("auto_send_mode", "safe_replies")

        # Step 2: Initialize Bounded Agent Session with real-time on_step callback
        session = AgentSession(
            job_id=job_id,
            user_id=user_id,
            goal=f"Analyze email, extract requirements, generate checklist, prepare workspace files, and draft response for: {subject}",
            source_email=source,
            routing=routing,
            autonomy_level=autonomy_level,
            max_steps=12,
            max_tool_failures=3,
            max_research_calls=4,
            max_generated_files=5,
            on_step=lambda s, step: self._on_session_step(job_id, s, step)
        )

        # Step 3: Run Agent Loop
        loop = AgentLoop(session)
        final_session = loop.run()

        # Step 4: Handle needs_input (e.g. required specific deliverable like OS PDF is missing)
        if final_session.status == "needs_input":
            with self._lock:
                jobs = self._read_jobs()
                if job_id in jobs:
                    j = jobs[job_id]
                    j["status"] = "needs_input"
                    j["missing_deliverable"] = final_session.missing_deliverable
                    j["summary"] = final_session.summary or f"Needs input — required {final_session.missing_deliverable or 'file'} is missing."
                    j["updated_at"] = _now()
                    j["steps"] = final_session.steps
                    j["artifacts"] = final_session.artifacts
                    j["output"] = {
                        "summary": j["summary"],
                        "checklist": final_session.checklist,
                        "suggested_reply": final_session.reply_draft.get("body") or "",
                        "gmail_draft_id": None,
                        "notes": final_session.notes
                    }
                    self._write_jobs(jobs)
            return

        # Step 4.5: Handle model availability / routing pause
        if final_session.status == "waiting_local_model":
            with self._lock:
                jobs = self._read_jobs()
                if job_id in jobs:
                    jobs[job_id]["status"] = "waiting_local_model"
                    jobs[job_id]["summary"] = "Job waiting: local model unavailable. Cloud fallback prohibited by Privacy Gate."
                    jobs[job_id]["routing"] = routing
                    jobs[job_id]["steps"] = final_session.steps
                    jobs[job_id]["updated_at"] = _now()
                    self._write_jobs(jobs)
            return

        # Step 5: Check/Sync Gmail Draft if requested
        draft_id = None
        for art in final_session.artifacts:
            if art.get("type") == "email_draft":
                draft_id = art.get("draft_id")
                break

        suggested_reply = final_session.reply_draft.get("body") or (
            f"Hi {sender.split('<')[0].strip()},\n\n"
            f"I received your email regarding '{subject}'. I am reviewing the details now.\n\n"
            f"Best regards,\nPriyam"
        )

        if not draft_id and settings.get("create_gmail_drafts", True):
            try:
                match = re.search(r"[\w\.-]+@[\w\.-]+", sender)
                to_email = match.group(0) if match else sender
                reply_subject = "Re: " + re.sub(r"^(Re:\s*)+", "", subject, flags=re.I)
                draft_res = create_gmail_draft(
                    to=to_email,
                    subject=reply_subject,
                    body=suggested_reply,
                    thread_id=source.get("thread_id")
                )
                draft_id = draft_res.get("id")
                final_session.add_artifact({
                    "type": "email_draft",
                    "name": f"Gmail Draft ({reply_subject})",
                    "draft_id": draft_id
                })
            except Exception as draft_err:
                print(f"[WorkAgent] Notice: Gmail draft creation skipped: {draft_err}")

        # Step 6: Evaluate with AutoSendPolicy
        policy_verdict = AutoSendPolicy.evaluate(
            suggested_reply,
            artifacts=final_session.artifacts,
            source=source,
            settings=settings
        )

        # Step 7: Finalize Job State
        with self._lock:
            jobs = self._read_jobs()
            if job_id in jobs:
                j = jobs[job_id]
                j["clean_title"] = clean_job_title(j.get("title", ""), subject)
                j["updated_at"] = _now()
                j["routing"] = routing
                j["output"] = {
                    "summary": final_session.summary or snippet,
                    "checklist": final_session.checklist,
                    "suggested_reply": suggested_reply,
                    "gmail_draft_id": draft_id,
                    "notes": final_session.notes
                }
                j["artifacts"] = final_session.artifacts
                j["policy_verdict"] = policy_verdict
                j["verification"] = final_session.verification_report

                # Merge agent loop steps with final review/dispatch steps
                steps = list(final_session.steps)
                if not steps:
                    steps = [
                        {"type": "read_thread", "label": f"Read thread from {sender.split('<')[0].strip()}", "status": "done"},
                        {"type": "extract_deadline", "label": f"Found deadline ({deadline or 'urgent'})", "status": "done"},
                        {"type": "prepare_reply", "label": "Prepared response draft", "status": "done"},
                        {"type": "create_files", "label": f"Created {len(final_session.artifacts)} workspace artifacts", "status": "done"},
                        {"type": "create_gmail_draft", "label": "Synced draft to Gmail", "status": "done" if draft_id else "skipped"}
                    ]

                if policy_verdict.get("auto_send_allowed") is True:
                    # Safe reply -> start 20s cancelable countdown
                    countdown_sec = int(settings.get("countdown_seconds", 20))
                    started_at = _now()
                    send_at = (datetime.now(timezone.utc) + timedelta(seconds=countdown_sec)).isoformat()
                    j["status"] = "auto_send_countdown"
                    j["countdown"] = {
                        "duration": countdown_sec,
                        "started_at": started_at,
                        "auto_send_at": send_at,
                        "cancelled": False
                    }
                    steps.append({
                        "type": "countdown",
                        "label": f"Policy approved: sending in {countdown_sec}s",
                        "status": "active"
                    })
                    j["steps"] = steps
                    self._write_jobs(jobs)
                    self._start_countdown_timer(job_id, user_id, send_at, countdown_sec)
                else:
                    # High / medium risk -> hold for human approval
                    j["status"] = "waiting_approval"
                    steps.append({
                        "type": "human_approval",
                        "label": "Waiting for human approval",
                        "status": "pending"
                    })
                    j["steps"] = steps
                    self._write_jobs(jobs)

    def _start_countdown_timer(self, job_id, user_id, expected_send_at, seconds=20):
        """Launches a background timer that dispatches the draft if not cancelled, with pre-send reconciliation check."""
        def timer_loop():
            time.sleep(seconds)
            with self._lock:
                jobs = self._read_jobs()
                job = jobs.get(str(job_id))
                if not job or job.get("status") != "auto_send_countdown":
                    return
                # Verify countdown timestamp was not aborted
                c = job.get("countdown") or {}
                if c.get("cancelled") or c.get("auto_send_at") != expected_send_at:
                    return

            # Pre-send reconciliation invariant: verify user hasn't replied manually in Gmail
            source = job.get("source") or {}
            thread_id = source.get("thread_id")
            if thread_id:
                try:
                    thread_data = get_gmail_thread(thread_id)
                    if thread_data and thread_data.get("messages"):
                        source_msg_id = source.get("message_id")
                        msgs = thread_data["messages"]
                        s_idx = next((i for i, m in enumerate(msgs) if m.get("id") == source_msg_id or m.get("gmail_id") == source_msg_id), -1)
                        later = msgs[s_idx + 1:] if s_idx >= 0 else msgs
                        outbound = next((m for m in later if m.get("direction") == "outbound" or m.get("is_sent_by_me")), None)
                        if outbound:
                            print(f"[WorkAgent] Auto-send aborted: user already replied manually on thread {thread_id}!")
                            with self._lock:
                                jobs = self._read_jobs()
                                if str(job_id) in jobs:
                                    jobs[str(job_id)]["status"] = "resolved_external"
                                    jobs[str(job_id)]["resolution"] = "manual_gmail_reply"
                                    jobs[str(job_id)]["resolved_at"] = outbound.get("date") or _now()
                                    jobs[str(job_id)]["resolved_message_id"] = outbound.get("id")
                                    if "countdown" in jobs[str(job_id)]:
                                        jobs[str(job_id)]["countdown"]["cancelled"] = True
                                    # Clean up stale Mailmate draft if one was staged
                                    draft_id = (jobs[str(job_id)].get("output") or {}).get("gmail_draft_id")
                                    if draft_id:
                                        try:
                                            delete_gmail_draft(draft_id)
                                            jobs[str(job_id)]["output"]["gmail_draft_id"] = None
                                        except Exception:
                                            pass
                                    self._write_jobs(jobs)
                            return
                except Exception as check_err:
                    print(f"[WorkAgent] Pre-send thread check error: {check_err}")

            print(f"[WorkAgent] Countdown expired. Auto-sending safe reply for job {job_id}...")
            try:
                self.approve_job(job_id, user_id, auto_sent=True)
            except Exception as e:
                print(f"[WorkAgent] Auto-send execution failed for {job_id}: {e}")

        t = threading.Thread(target=timer_loop, daemon=True, name=f"AutoSendTimer-{job_id}")
        t.start()

    def _call_llm(self, subject, snippet, sender, deadline, kind):
        """Call LM Studio if available, otherwise fallback to Gemini."""
        prompt = (
            f"You are Mailmate's autonomous preparatory work agent.\n"
            f"Analyze this inbound email and prepare actionable output.\n"
            f"Subject: {subject}\n"
            f"From: {sender}\n"
            f"Deadline: {deadline}\n"
            f"Snippet: {snippet}\n\n"
            f"Return JSON strictly matching this schema:\n"
            f'{{\n'
            f'  "summary": "Brief summary of the requested task",\n'
            f'  "checklist": ["Step 1", "Step 2", "Step 3"],\n'
            f'  "suggested_reply": "Natural, polite email reply acknowledging the request. Sign off as Priyam.",\n'
            f'  "notes": ["Important detail 1", "Important detail 2"]\n'
            f'}}'
        )

        # 1. Try LM Studio
        try:
            headers = {"Content-Type": "application/json"}
            payload = {
                "model": self.model or "local-model",
                "temperature": 0.2,
                "messages": [
                    {"role": "system", "content": "You are a helpful email productivity agent. Always respond with valid JSON only."},
                    {"role": "user", "content": prompt}
                ]
            }
            res = requests.post(f"{self.base_url}/chat/completions", headers=headers, json=payload, timeout=self.timeout)
            if res.ok:
                content = res.json()["choices"][0]["message"]["content"]
                clean_json = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.I)
                return json.loads(clean_json)
        except Exception:
            pass

        # 2. Try Gemini Fallback
        try:
            import google.generativeai as genai
            genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
            m = genai.GenerativeModel("gemini-3.5-flash-lite", generation_config={"response_mime_type": "application/json"})
            res = m.generate_content(prompt)
            return json.loads(res.text)
        except Exception:
            # Fallback default template
            return {
                "summary": f"Task: {subject}",
                "checklist": [
                    f"Review {subject} details",
                    f"Complete task before {deadline or 'due date'}",
                    "Submit deliverables"
                ],
                "suggested_reply": (
                    f"Hi {sender.split('<')[0].strip()},\n\n"
                    f"I received your email regarding '{subject}'. I am reviewing the details now and will have this completed within the requested deadline ({deadline or 'asap'}).\n\n"
                    f"Best regards,\nPriyam"
                ),
                "notes": [f"Deadline noted: {deadline}"]
            }

work_agent_service = WorkAgentService()
