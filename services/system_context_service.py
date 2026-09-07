import threading
import time
from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
import os
import threading

from services.google_service import get_user_profile
from services.work_agent_service import work_agent_service
from services.calendar_service import list_events as calendar_list_events
from services.calendar_conflicts import calculate_conflicts

_APP_TZ = timezone(timedelta(hours=5, minutes=30))  # Default fallback IST


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class SystemContextService:
    """
    Authoritative, unified system snapshot provider for Mailmate.
    Reconciles WorkJobs against Gmail, normalizes calendar conflicts,
    and provides a single canonical context for Kyle and all dashboard tabs.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self._context_version = 1
        self._start_time = time.time()
        self._last_build: Dict[str, Any] = {}
        self._freshness = {
            "system": _iso_now(),
            "gmail": None,
            "calendar": None,
            "work": None,
        }

    def increment_version(self) -> int:
        with self._lock:
            self._context_version += 1
            return self._context_version

    def get_version(self) -> int:
        with self._lock:
            return self._context_version

    def build(self, user_id: Optional[str] = None, force_reconcile: bool = True) -> Dict[str, Any]:
        """
        Build the canonical system context snapshot for a user.
        Performs Gmail-Work reconciliation, calendar conflict deduction,
        and partitions jobs into canonical states.
        """
        if not user_id:
            try:
                profile = get_user_profile() or {}
                user_id = profile.get("email") or profile.get("id") or "default"
            except Exception:
                user_id = "default"

        now_iso = _iso_now()

        # 1. Gmail ↔ Work Reconciliation
        reconciled_jobs = []
        if force_reconcile and user_id:
            try:
                reconciled_jobs = work_agent_service.reconcile_jobs_with_gmail(user_id)
                self._freshness["gmail"] = now_iso
            except Exception as e:
                print(f"[SystemContext] Reconcile error: {e}")

        # 2. Work Jobs Partitioning
        active_jobs = work_agent_service.get_active_jobs(user_id)
        waiting_jobs = work_agent_service.get_waiting_approval_jobs(user_id)
        needs_input_jobs = work_agent_service.get_needs_input_jobs(user_id)
        completed_jobs = work_agent_service.get_completed_jobs(user_id)
        all_jobs = work_agent_service.list_jobs(user_id, reconcile=False)
        self._freshness["work"] = now_iso

        # 3. Calendar & Conflict Derivation
        calendar_events = []
        conflict_pairs = []
        try:
            raw_events = calendar_list_events(limit=100) or []
            self._freshness["calendar"] = now_iso

            calendar_events, conflict_pairs = calculate_conflicts(raw_events)
        except Exception as e:
            print(f"[SystemContext] Calendar fetch/conflict error: {e}")

        # 4. Mail & Needs Attention Context
        needs_attention = []
        recent_emails_count = 0

        with self._lock:
            self._context_version += 1
            version = self._context_version
            self._freshness["system"] = now_iso

            snapshot = {
                "context_version": version,
                "timestamp": now_iso,
                "user_id": user_id,
                "freshness": dict(self._freshness),
                "work": {
                    "active": active_jobs,
                    "waiting_approval": waiting_jobs,
                    "needs_input": needs_input_jobs,
                    "completed": completed_jobs,
                    "all": all_jobs,
                    "counts": {
                        "active": len(active_jobs),
                        "waiting_approval": len(waiting_jobs),
                        "needs_input": len(needs_input_jobs),
                        "completed": len(completed_jobs),
                        "total": len(all_jobs),
                    },
                },
                "calendar": {
                    "events": calendar_events,
                    "conflicts": conflict_pairs,
                    "conflict_count": len(conflict_pairs),
                    "synced_at": self._freshness.get("calendar"),
                },
                "mail": {
                    "needs_attention": needs_attention,
                    "recent_count": recent_emails_count,
                },
                "diagnostics": {
                    "context_version": version,
                    "reconciled_recent": len(reconciled_jobs),
                    "uptime_seconds": round(time.time() - self._start_time, 1),
                },
            }
            self._last_build = snapshot
            return snapshot

    def get_latest(self) -> Optional[Dict[str, Any]]:
        with self._lock:
            return dict(self._last_build) if self._last_build else None


system_context_service = SystemContextService()
