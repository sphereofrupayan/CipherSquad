from typing import Dict, Any, List, Optional

def create_note(note: str, session: Any) -> Dict[str, Any]:
    """Adds a factual note or constraint to the job record."""
    n = str(note or "").strip()
    if session and n:
        session.add_note(n)
    return {
        "ok": True,
        "note": n
    }

def create_checklist(items: List[str], session: Any) -> Dict[str, Any]:
    """Registers actionable steps required to complete the task."""
    clean_items = []
    if isinstance(items, list):
        clean_items = [str(i).strip() for i in items if str(i).strip()]
    elif isinstance(items, str):
        clean_items = [line.strip("- *").strip() for line in items.splitlines() if line.strip()]

    if session and clean_items:
        session.set_checklist(clean_items)

    return {
        "ok": True,
        "count": len(clean_items),
        "checklist": clean_items
    }

def update_job(summary: str, session: Any) -> Dict[str, Any]:
    """Updates the high-level summary and progress description of the job."""
    s = str(summary or "").strip()
    if session and s:
        session.summary = s
    return {
        "ok": True,
        "summary": s
    }

def request_input(question: str, reason: str = "", session: Any = None) -> Dict[str, Any]:
    """Requests user guidance when information is ambiguous or decisions are needed."""
    return {
        "ok": True,
        "needs_user_input": True,
        "question": question,
        "reason": reason
    }

def finish(summary: str = "", session: Any = None) -> Dict[str, Any]:
    """Signals that the agent has finished preparing all requested materials."""
    if session:
        session.status = "finished"
        session.finish_reason = "agent_completed"
        if summary:
            session.summary = summary
    return {
        "ok": True,
        "finished": True,
        "summary": summary
    }
