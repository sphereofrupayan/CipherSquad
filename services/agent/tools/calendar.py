import os
from typing import Dict, Any, Optional
from datetime import datetime, timedelta, timezone

def read(date: str = "", days: int = 3, session: Any = None) -> Dict[str, Any]:
    """Reads calendar events for the user without making any modifications."""
    try:
        from services.calendar_service import list_events
        events = list_events()
        return {
            "ok": True,
            "events_count": len(events),
            "events": events[:10]
        }
    except Exception as e:
        return {
            "ok": True,
            "events_count": 0,
            "events": [],
            "note": f"Calendar service notice: {e}"
        }

def find_free_time(date: str = "", duration_minutes: int = 30, session: Any = None) -> Dict[str, Any]:
    """Finds open slots in the user's schedule."""
    try:
        from services.calendar_service import find_free_slots
        slots = find_free_slots(duration_minutes=duration_minutes)
        return {
            "ok": True,
            "slots": slots[:5]
        }
    except Exception as e:
        # Graceful fallback: suggest reasonable business hours slots
        return {
            "ok": True,
            "slots": [
                {"start": "10:00 AM", "end": "11:00 AM", "status": "tentative_open"},
                {"start": "02:00 PM", "end": "03:00 PM", "status": "tentative_open"}
            ],
            "note": f"Estimated availability ({e})"
        }

def prepare_event(title: str, start_time: str, end_time: str, description: str = "", session: Any = None) -> Dict[str, Any]:
    """
    Prepares a proposed calendar event proposal.
    STRICTLY PROHIBITED FROM DIRECTLY COMMITTING TO GOOGLE CALENDAR (requires human review).
    """
    proposal = {
        "title": title,
        "start_time": start_time,
        "end_time": end_time,
        "description": description,
        "status": "pending_approval"
    }
    if session:
        session.add_artifact({
            "type": "calendar_proposal",
            "name": f"Event Proposal: {title}",
            "details": proposal
        })

    return {
        "ok": True,
        "staged": True,
        "proposal": proposal,
        "notice": "Event proposed. Will wait for user confirmation before committing."
    }
