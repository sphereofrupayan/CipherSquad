from __future__ import annotations

import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

try:
    from supabase import create_client
except Exception:
    create_client = None

CONTEXT_KEY = "dashboard"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso_now() -> str:
    return _now().isoformat()


def _parse_iso(value: Any) -> Optional[datetime]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


class SupabaseCache:
    def __init__(self) -> None:
        self.url = (os.getenv("SUPABASE_URL") or "").rstrip("/")
        self.key = (
            os.getenv("SUPABASE_SECRET_KEY")
            or os.getenv("SUPABASE_SERVICE_ROLE_KEY")
            or os.getenv("SUPABASE_PUBLISHABLE_KEY")
            or ""
        )
        self.client = None
        self._processed_context_supported: Optional[bool] = None
        self.last_error = ""

        if self.url and self.key and create_client is not None:
            try:
                self.client = create_client(self.url, self.key)
            except Exception as exc:
                self.last_error = str(exc)

    @property
    def configured(self) -> bool:
        return bool(self.url and self.key)

    @property
    def enabled(self) -> bool:
        return self.client is not None

    @staticmethod
    def _data(response: Any) -> Any:
        return getattr(response, "data", None)

    @staticmethod
    def _privacy_payload(payload: Dict[str, Any]) -> Dict[str, Any]:
        """Keep only transient-safe email metadata in processed_context."""
        result = dict(payload or {})
        result["emails"] = [{
            key: email.get(key)
            for key in ("id", "gmail_id", "threadId", "thread_id", "sender", "receiver", "subject", "date", "timestamp", "labels", "is_read", "is_starred", "privacy_gate", "direction", "is_sent_by_me")
            if email.get(key) is not None
        } for email in (payload.get("emails") or []) if isinstance(email, dict)]
        return result

    def _error(self, exc: Exception) -> None:
        self.last_error = str(exc)

    def _detect_processed_context(self) -> bool:
        if not self.enabled:
            self._processed_context_supported = False
            return False
        try:
            self.client.table("processed_context").select("user_id").limit(1).execute()
            self._processed_context_supported = True
        except Exception as exc:
            self._processed_context_supported = False
            self._error(exc)
        return bool(self._processed_context_supported)

    def status(self) -> Dict[str, Any]:
        if self.enabled and self._processed_context_supported is None:
            self._detect_processed_context()
        return {
            "configured": self.configured,
            "ready": self.enabled,
            "mode": (
                "processed-context"
                if self._processed_context_supported is True
                else "legacy-cache"
                if self.enabled
                else "disabled"
            ),
            "processedContextTable": self._processed_context_supported,
            "lastError": self.last_error or None,
        }

    def find_or_create_user(self, profile: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not self.enabled:
            return None

        email = str(profile.get("email") or "").strip().lower()
        if not email:
            return None

        try:
            result = self.client.table("users").select("*").eq("email", email).limit(1).execute()
            rows = self._data(result) or []
            if rows:
                user = rows[0]
                updates = {}
                name = profile.get("name")
                google_id = profile.get("id") or profile.get("sub")
                if name and user.get("name") != name:
                    updates["name"] = name
                if google_id and user.get("google_id") != google_id:
                    updates["google_id"] = google_id
                if updates:
                    updated = self.client.table("users").update(updates).eq("id", user["id"]).execute()
                    updated_rows = self._data(updated) or []
                    if updated_rows:
                        user = updated_rows[0]
                return user

            inserted = self.client.table("users").insert({
                "email": email,
                "name": profile.get("name") or email,
                "google_id": profile.get("id") or profile.get("sub"),
            }).execute()
            rows = self._data(inserted) or []
            return rows[0] if rows else None
        except Exception as exc:
            self._error(exc)
            return None

    @staticmethod
    def fingerprint_emails(emails: Iterable[Dict[str, Any]]) -> str:
        compact = []
        for email in emails or []:
            compact.append({
                "id": email.get("id") or email.get("gmail_id"),
                "thread": email.get("threadId") or email.get("thread_id"),
                "subject": email.get("subject") or "",
                "timestamp": email.get("timestamp") or email.get("date") or "",
                "labels": sorted(email.get("labels") or []),
                "direction": email.get("direction") or "",
            })
        compact.sort(key=lambda x: (str(x["timestamp"]), str(x["id"])))
        raw = json.dumps(compact, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    @staticmethod
    def _email_row(user_id: str, email: Dict[str, Any]) -> Dict[str, Any]:
        sender = email.get("sender")
        from_obj = email.get("from")
        if not sender and isinstance(from_obj, dict):
            sender = from_obj.get("name") or from_obj.get("email")

        receiver = email.get("receiver")
        if not receiver:
            recipients = email.get("to") or []
            if isinstance(recipients, list):
                parts = []
                for item in recipients:
                    if isinstance(item, dict):
                        parts.append(item.get("email") or item.get("name") or "")
                    else:
                        parts.append(str(item))
                receiver = ", ".join(x for x in parts if x)

        timestamp = email.get("timestamp") or email.get("date")
        parsed = _parse_iso(timestamp)
        if parsed:
            timestamp = parsed.isoformat()

        return {
            "user_id": user_id,
            "gmail_id": email.get("id") or email.get("gmail_id"),
            "thread_id": email.get("threadId") or email.get("thread_id"),
            "sender": sender,
            "receiver": receiver,
            "subject": email.get("subject"),
            "timestamp": timestamp,
            "is_read": bool(email.get("is_read", False)),
            "is_starred": bool(email.get("is_starred", False)),
            "labels": email.get("labels") or [],
        }

    def save_emails(self, user_id: str, emails: Iterable[Dict[str, Any]]) -> int:
        """
        Two-Plane Security: Central mailbox content retention is PROHIBITED.
        Gmail content lives transiently in browser RAM on the Display Plane.
        No raw email records are written to remote databases.
        """
        return 0


    def get_emails(self, user_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        if not self.enabled or not user_id:
            return []
        try:
            result = (
                self.client.table("emails")
                .select("*")
                .eq("user_id", user_id)
                .order("timestamp", desc=True)
                .limit(int(limit))
                .execute()
            )
            return self._data(result) or []
        except Exception as exc:
            self._error(exc)
            return []

    def get_processed_context(self, user_id: str) -> Optional[Dict[str, Any]]:
        if not self.enabled or not user_id:
            return None
        if self._processed_context_supported is None:
            self._detect_processed_context()
        if not self._processed_context_supported:
            return None
        try:
            result = (
                self.client.table("processed_context")
                .select("*")
                .eq("user_id", user_id)
                .eq("context_key", CONTEXT_KEY)
                .limit(1)
                .execute()
            )
            rows = self._data(result) or []
            if not rows:
                return None
            row = rows[0]
            return {
                "payload": row.get("payload") if isinstance(row.get("payload"), dict) else {},
                "source_fingerprint": row.get("source_fingerprint"),
                "processed_at": row.get("processed_at"),
                "last_checked_at": row.get("last_checked_at"),
                "reprocess_after": row.get("reprocess_after"),
                "mode": "processed-context",
            }
        except Exception as exc:
            self._error(exc)
            self._processed_context_supported = False
            return None

    def save_processed_context(
        self,
        user_id: str,
        payload: Dict[str, Any],
        fingerprint: str,
        reprocess_after: str,
    ) -> bool:
        if not self.enabled or not user_id:
            return False
        if self._processed_context_supported is None:
            self._detect_processed_context()
        if not self._processed_context_supported:
            return False
        try:
            self.client.table("processed_context").upsert({
                "user_id": user_id,
                "context_key": CONTEXT_KEY,
                "payload": self._privacy_payload(payload),
                "source_fingerprint": fingerprint,
                "processed_at": _iso_now(),
                "last_checked_at": _iso_now(),
                "reprocess_after": reprocess_after,
            }, on_conflict="user_id,context_key").execute()
            return True
        except Exception as exc:
            self._error(exc)
            self._processed_context_supported = False
            return False

    def mark_checked(self, user_id: str) -> None:
        if not self.enabled or not user_id or not self._processed_context_supported:
            return
        try:
            (
                self.client.table("processed_context")
                .update({"last_checked_at": _iso_now()})
                .eq("user_id", user_id)
                .eq("context_key", CONTEXT_KEY)
                .execute()
            )
        except Exception as exc:
            self._error(exc)

    def save_legacy_snapshot(self, user_id: str, payload: Dict[str, Any]) -> None:
        if not self.enabled or not user_id:
            return
        try:
            metrics = payload.get("metrics") or {}
            response = self.client.table("user_insights").insert({
                "user_id": user_id,
                "total_emails": int(metrics.get("emails") or len(payload.get("emails") or [])),
                "important_count": int(metrics.get("important") or 0),
                "action_count": int(metrics.get("actions") or 0),
                "ai_insight": payload.get("ai_insight") or "No insights available.",
            }).execute()
            rows = self._data(response) or []
            if not rows:
                return
            insight_id = rows[0].get("id")
            items = payload.get("needs_attention") or []
            attention_rows = []
            for item in items[:20]:
                attention_rows.append({
                    "insight_id": insight_id,
                    "sender": item.get("sender") or item.get("owner") or item.get("subject") or "Unknown",
                    "reason": item.get("description") or item.get("reason") or item.get("title") or "Needs attention",
                    "is_resolved": False,
                })
            if attention_rows:
                self.client.table("attention_items").insert(attention_rows).execute()
        except Exception as exc:
            self._error(exc)

    def get_legacy_dashboard(self, user_id: str, limit: int = 50) -> Optional[Dict[str, Any]]:
        if not self.enabled or not user_id:
            return None
        try:
            insight_res = (
                self.client.table("user_insights")
                .select("*")
                .eq("user_id", user_id)
                .order("created_at", desc=True)
                .limit(1)
                .execute()
            )
            insights = self._data(insight_res) or []
            emails = self.get_emails(user_id, limit)
            if not insights and not emails:
                return None

            insight = insights[0] if insights else {}
            attention = []
            if insight.get("id"):
                att_res = (
                    self.client.table("attention_items")
                    .select("*")
                    .eq("insight_id", insight["id"])
                    .execute()
                )
                attention = self._data(att_res) or []

            normalized = [{
                "id": e.get("gmail_id") or e.get("id"),
                "threadId": e.get("thread_id"),
                "sender": e.get("sender"),
                "receiver": e.get("receiver"),
                "subject": e.get("subject"),
                "date": e.get("timestamp"),
                "timestamp": e.get("timestamp"),
                "labels": e.get("labels") or [],
                "is_read": e.get("is_read"),
                "is_starred": e.get("is_starred"),
            } for e in emails]

            payload = {
                "metrics": {
                    "emails": insight.get("total_emails") or len(normalized),
                    "important": insight.get("important_count") or len(attention),
                    "actions": insight.get("action_count") or len(attention),
                },
                "needs_attention": [{
                    "sender": a.get("sender"),
                    "reason": a.get("reason"),
                    "description": a.get("reason"),
                } for a in attention if not a.get("is_resolved")],
                "waiting_on_others": [],
                "ai_insight": insight.get("ai_insight") or "Cached Gmail context is ready.",
                "emails": normalized,
            }
            return {
                "payload": payload,
                "source_fingerprint": self.fingerprint_emails(normalized),
                "processed_at": insight.get("created_at"),
                "last_checked_at": None,
                "reprocess_after": None,
                "mode": "legacy-cache",
            }
        except Exception as exc:
            self._error(exc)
            return None

    def get_cached_dashboard(self, user_id: str) -> Optional[Dict[str, Any]]:
        return self.get_processed_context(user_id) or self.get_legacy_dashboard(user_id)


supabase_cache = SupabaseCache()
