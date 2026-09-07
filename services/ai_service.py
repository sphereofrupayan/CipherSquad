import datetime
import hashlib
import json
import os
import re
import threading
from copy import deepcopy
from typing import Any, Dict, List

import requests

from services.google_service import get_calendar_events, build, get_credentials
from services.privacy_gate import PrivacyGate
from services.agent.token_budget import bound_messages


def _json_object(text: str) -> Dict[str, Any]:
    clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", str(text or "").strip(), flags=re.I)
    match = re.search(r"\{[\s\S]*\}", clean)
    if not match:
        raise ValueError("No JSON object in model response")
    return json.loads(match.group(0))


_overview_lock = threading.Lock()
_overview_cache = {}
_overview_inflight = {}


def _gemini_completion(prompt: str, json_mode: bool = False, max_input_tokens: int = 3500, max_output_tokens: int = 300) -> str:
    enabled = str(os.getenv('MAILMATE_GEMINI_ENABLED', '1')).lower() in {'1', 'true', 'yes', 'on'}
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not enabled or not key:
        raise RuntimeError("Gemini is not configured")

    bounded_prompt = bound_messages([{'role': 'user', 'content': prompt}], max_input_tokens)[0]['content']

    model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite").strip()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": bounded_prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": max_output_tokens,
            **({"responseMimeType": "application/json"} if json_mode else {}),
        },
    }
    response = requests.post(url, params={"key": key}, json=payload, timeout=18)
    response.raise_for_status()
    data = response.json()
    candidates = data.get("candidates") or []
    parts = ((candidates[0].get("content") or {}).get("parts") or []) if candidates else []
    return "".join(str(part.get("text") or "") for part in parts).strip()


def _latest(thread: Dict[str, Any]) -> Dict[str, Any]:
    messages = thread.get("messages") or []
    return messages[-1] if messages else thread


def _deadline(text: str) -> str:
    within = re.search(r"\bwithin\s+(\d+)\s*hours?\b", text, re.I)
    if within:
        return f"within {within.group(1)} hours"
    if re.search(r"\btomorrow\b", text, re.I):
        return "tomorrow"
    if re.search(r"\b(today|tonight)\b", text, re.I):
        return "today"
    match = re.search(
        r"\b(?:due|deadline|submit(?:ted)? by|before)\s+(?:on\s+)?([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?|\d{1,2}[-/]\d{1,2}(?:[-/]\d{2,4})?)",
        text,
        re.I,
    )
    return match.group(1) if match else ""


def _heuristic_overview(threads: List[Dict[str, Any]]) -> Dict[str, Any]:
    needs, waiting = [], []
    action_pattern = re.compile(
        r"\b(due|deadline|submit|submission|assignment|exam|quiz|review|approve|approval|send|share|provide|reply|respond|urgent|action required|please|can you|could you|meeting|schedule|extension|pdf|document|details needed)\b",
        re.I,
    )

    for thread in threads or []:
        latest = _latest(thread)
        subject = str(latest.get("subject") or thread.get("subject") or "Email")
        snippet = str(latest.get("snippet") or latest.get("body") or thread.get("snippet") or "")
        direction = str(latest.get("direction") or thread.get("direction") or "").lower()
        message_id = str(
            latest.get("id")
            or latest.get("gmail_id")
            or thread.get("latest_message_id")
            or thread.get("id")
            or ""
        )
        combined = f"{subject} {snippet}".strip()

        if direction == "outbound":
            if message_id:
                waiting.append({
                    "description": combined[:280],
                    "owner": "other",
                    "source_message_id": message_id,
                })
            continue

        if action_pattern.search(combined) and message_id:
            needs.append({
                "description": combined[:280],
                "owner": "me",
                "source_message_id": message_id,
                "deadline": _deadline(combined),
            })

    return {
        "metrics": {"emails": len(threads or []), "important": len(needs), "actions": len(needs)},
        "needs_attention": needs[:12],
        "waiting_on_others": waiting[:8],
        "ai_insight": (
            f"{len(needs)} actionable item{'s' if len(needs) != 1 else ''} found."
            if needs else "No clear actionable requests detected."
        ),
    }


def _source_fingerprint(threads):
    source = []
    for thread in threads or []:
        latest = _latest(thread)
        source.append({
            'thread_id': str(thread.get('id') or thread.get('threadId') or ''),
            'message_id': str(latest.get('id') or latest.get('gmail_id') or ''),
            'timestamp': str(latest.get('timestamp') or latest.get('date') or ''),
            'direction': str(latest.get('direction') or thread.get('direction') or ''),
        })
    packed = json.dumps(source, ensure_ascii=True, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(packed.encode('utf-8')).hexdigest()


def _overview_candidates(threads, limit=15):
    action_pattern = re.compile(
        r'\b(action required|urgent|due|deadline|submit|assignment|review|approve|reply|respond|please|meeting|schedule|extension|document|details needed)\b',
        re.I,
    )
    noise_pattern = re.compile(r'\b(unsubscribe|sale|offer|discount|newsletter|digest|promotion|recommended for you)\b', re.I)
    candidates = []
    for thread in threads or []:
        latest = _latest(thread)
        subject = str(latest.get('subject') or thread.get('subject') or 'Email')
        snippet = str(latest.get('snippet') or latest.get('body') or thread.get('snippet') or '')
        direction = str(latest.get('direction') or thread.get('direction') or '').lower()
        labels = list(latest.get('labelIds') or latest.get('labels') or thread.get('labelIds') or thread.get('labels') or [])
        combined = f'{subject} {snippet}'
        label_text = ' '.join(str(label) for label in labels).lower()
        if ('promotion' in label_text or 'social' in label_text or noise_pattern.search(combined)) and not action_pattern.search(combined):
            continue
        if direction != 'outbound' and not action_pattern.search(combined) and 'important' not in label_text:
            continue
        candidates.append({
            'thread_id': str(thread.get('id') or thread.get('threadId') or ''),
            'message_id': str(latest.get('id') or latest.get('gmail_id') or thread.get('latest_message_id') or ''),
            'subject': subject[:180],
            'sender': str(latest.get('sender') or thread.get('sender') or '')[:160],
            'latest_direction': direction or 'unknown',
            'snippet': re.sub(r'\s+', ' ', snippet).strip()[:420],
            'timestamp': str(latest.get('timestamp') or latest.get('date') or '')[:80],
            'labels': [str(label)[:50] for label in labels[:8]],
            'privacy': 'ALLOW',
        })
        if len(candidates) >= limit:
            break
    return candidates


def get_dashboard_overview(threads):
    safe_threads = PrivacyGate.filter_threads_for_ai(threads or [])
    shielded = len(threads or []) - len(safe_threads)
    if shielded:
        print(f"[PrivacyGate] Shielded {shielded} sensitive/private thread(s) from AI analysis.")

    fingerprint = _source_fingerprint(threads or [])
    with _overview_lock:
        cached = _overview_cache.get(fingerprint)
        if cached is not None:
            return deepcopy(cached)
        inflight = _overview_inflight.get(fingerprint)
        if inflight is None:
            inflight = threading.Event()
            _overview_inflight[fingerprint] = inflight
            leader = True
        else:
            leader = False

    if not leader:
        inflight.wait(timeout=40)
        with _overview_lock:
            cached = _overview_cache.get(fingerprint)
        return deepcopy(cached) if cached is not None else _heuristic_overview(safe_threads)

    candidates = _overview_candidates(safe_threads)
    prompt = f"""Classify these compact, privacy-approved email candidates.
Return JSON exactly:
{{
  "metrics": {{"emails": 0, "important": 0, "actions": 0}},
  "needs_attention": [{{"description": "...", "owner": "me", "source_message_id": "...", "deadline": "..."}}],
  "waiting_on_others": [{{"description": "...", "owner": "other", "source_message_id": "..."}}],
  "ai_insight": "..."
}}
Rules:
- Only unresolved inbound requests assigned to the current user belong in needs_attention.
- If the latest message is outbound and has no reply, prefer waiting_on_others.
- Ignore newsletters/promotions/social noise.
- Preserve the exact source message id.
- Never invent deadlines.
Candidates:
{json.dumps(candidates, ensure_ascii=False, separators=(',', ':'))}
"""

    parsed = None
    try:
        if candidates:
            parsed = _json_object(_gemini_completion(
                prompt,
                json_mode=True,
                max_input_tokens=3200,
                max_output_tokens=450,
            ))
    except Exception as exc:
        print("[AI] Gemini overview notice:", exc)

    if parsed is None:
        parsed = _heuristic_overview(safe_threads)
    if not isinstance(parsed, dict):
        parsed = _heuristic_overview(safe_threads)

    parsed.setdefault("metrics", {})
    parsed.setdefault("needs_attention", [])
    parsed.setdefault("waiting_on_others", [])
    parsed.setdefault("ai_insight", "")
    parsed["metrics"]["emails"] = len(threads or [])
    parsed["metrics"]["important"] = len(parsed["needs_attention"])
    parsed["metrics"]["actions"] = len(parsed["needs_attention"])
    with _overview_lock:
        _overview_cache.clear()
        _overview_cache[fingerprint] = deepcopy(parsed)
        event = _overview_inflight.pop(fingerprint, None)
        if event:
            event.set()
    return parsed


def list_events():
    return f"Upcoming events: {json.dumps(get_calendar_events())}"


def create_event(title: str, start_time: str, end_time: str):
    try:
        creds = get_credentials()
        service = build("calendar", "v3", credentials=creds)
        event = {
            "summary": title,
            "start": {"dateTime": start_time, "timeZone": "Asia/Kolkata"},
            "end": {"dateTime": end_time, "timeZone": "Asia/Kolkata"},
        }
        event = service.events().insert(calendarId="primary", body=event).execute()
        return f"Created event: {event.get('htmlLink')}"
    except Exception as exc:
        return f"Error: {exc}"


def chat_with_kyle(message):
    prompt = (
        "You are Kyle, Mailmate's concise assistant. "
        f"Timezone Asia/Kolkata. Time: {datetime.datetime.now().isoformat()}. User: {message}"
    )
    try:
        return _gemini_completion(prompt, max_input_tokens=800, max_output_tokens=150)
    except Exception as exc:
        return f"Kyle is temporarily unavailable: {exc}"


def generate_kyle_agent_reply(message, compact_context):
    ctx = compact_context or {}
    active = int(ctx.get("active_work_count") or 0)
    waiting = int(ctx.get("waiting_approval_count") or 0)
    lower = str(message or "").lower()

    if re.search(r"\b(draft|drafts|work tab|prepared|waiting for review|ready for review|what.*prepared)\b", lower):
        if active + waiting == 0:
            return "There are no prepared Work items waiting for review right now."
        if waiting:
            return f"You have {waiting} item{'s' if waiting != 1 else ''} ready for review in Work."
        return f"Kyle is currently working on {active} item{'s' if active != 1 else ''}."

    prompt = f"""You are Kyle, the calm operating agent inside Mailmate.
Reply in one or two short spoken sentences, maximum 40 words.
Do not invent app state.
Never claim drafts, prepared work, sent mail, deleted events, or completed actions unless context proves it.
If active_work_count and waiting_approval_count are zero, never say anything is waiting in Work.
Canonical context: {json.dumps(ctx, ensure_ascii=False)}
User: {message}
"""
    try:
        return _gemini_completion(prompt, max_input_tokens=800, max_output_tokens=150)
    except Exception:
        return "I can still operate Mailmate, but Gemini is temporarily unavailable."
