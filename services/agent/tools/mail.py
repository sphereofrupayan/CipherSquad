import re
from typing import Dict, Any, Optional
from services.google_service import create_gmail_draft, update_gmail_draft, get_gmail_threads
from services.privacy_gate import PrivacyGate

def get_safe_context(session: Any) -> Dict[str, Any]:
    """Returns safe, privacy-evaluated context of the source email."""
    source = session.source_email if session else {}
    return {
        "ok": True,
        "sender": source.get("sender", "Unknown"),
        "subject": source.get("subject", "No subject"),
        "deadline": source.get("deadline", "None specified"),
        "snippet": source.get("snippet", ""),
        "message_id": source.get("message_id", ""),
        "thread_id": source.get("thread_id", "")
    }

def get_thread_safe(thread_id: str, session: Any) -> Dict[str, Any]:
    """Fetches and filters thread messages to ensure no sensitive items are exposed."""
    tid = thread_id or (session.source_email.get("thread_id") if session else None)
    if not tid:
        return {"ok": False, "error": "No thread ID provided."}

    try:
        threads = get_gmail_threads(max_results=5)
        matched = next((t for t in threads if t.get("id") == tid), None)
        if not matched:
            return {"ok": True, "messages": [get_safe_context(session)]}

        # Filter through PrivacyGate
        safe_threads = PrivacyGate.filter_threads_for_ai([matched])
        if not safe_threads:
            return {"ok": False, "error": "Thread content shielded by Privacy Gate."}

        return {
            "ok": True,
            "thread_id": tid,
            "messages": safe_threads[0].get("messages", [])
        }
    except Exception as e:
        return {"ok": False, "error": f"Failed to retrieve thread: {e}"}

def prepare_reply(body: str, subject: str = "", to: str = "", session: Any = None) -> Dict[str, Any]:
    """Stages a proposed reply text in the session for review or draft synchronization."""
    if session:
        source = session.source_email or {}
        dest_to = to or source.get("sender") or ""
        # Clean reply subject
        dest_subj = subject or ("Re: " + re.sub(r"^(Re:\s*)+", "", source.get("subject") or "", flags=re.I))
        session.set_reply(body, subject=dest_subj, to=dest_to)

    return {
        "ok": True,
        "staged": True,
        "reply_body": body[:500],
        "length": len(body)
    }

def create_draft(body: str, subject: str = "", to: str = "", session: Any = None) -> Dict[str, Any]:
    """Synchronizes a Gmail draft via Google Workspace API (draft creation only; NEVER sends)."""
    source = session.source_email if session else {}
    dest_to = to or source.get("sender") or ""
    match = re.search(r"[\w\.-]+@[\w\.-]+", dest_to)
    clean_to = match.group(0) if match else dest_to

    dest_subj = subject or ("Re: " + re.sub(r"^(Re:\s*)+", "", source.get("subject") or "", flags=re.I))
    thread_id = source.get("thread_id")

    try:
        draft_res = create_gmail_draft(clean_to, dest_subj, body, thread_id=thread_id)
        draft_id = draft_res.get("id")
        if session:
            session.add_artifact({
                "type": "email_draft",
                "name": f"Gmail Draft ({dest_subj})",
                "draft_id": draft_id
            })
            session.set_reply(body, subject=dest_subj, to=clean_to)

        return {
            "ok": True,
            "draft_id": draft_id,
            "to": clean_to,
            "subject": dest_subj
        }
    except Exception as e:
        return {
            "ok": False,
            "error": f"Gmail draft creation error: {e}"
        }
