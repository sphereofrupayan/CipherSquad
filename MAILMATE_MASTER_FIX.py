#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path

HOST_TS_IP_DEFAULT = "100.114.2.88"


def die(message: str):
    raise SystemExit(f"\nERROR: {message}")


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def write(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def set_env(path: Path, key: str, value: str):
    lines = path.read_text(encoding="utf-8-sig").splitlines() if path.exists() else []
    pat = re.compile(rf"^\s*{re.escape(key)}\s*=")
    out = []
    seen = False
    for line in lines:
        if pat.match(line):
            if not seen:
                out.append(f"{key}={value}")
                seen = True
        else:
            out.append(line)
    if not seen:
        out.append(f"{key}={value}")
    write(path, "\n".join(out).rstrip() + "\n")


def remove_env(path: Path, key: str):
    if not path.exists():
        return
    pat = re.compile(rf"^\s*{re.escape(key)}\s*=")
    lines = [line for line in read(path).splitlines() if not pat.match(line)]
    write(path, "\n".join(lines).rstrip() + "\n")


def backup_files(root: Path, files: list[str]) -> Path:
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup = root / ".mailmate-master-backup" / stamp
    backup.mkdir(parents=True, exist_ok=True)
    for rel in files:
        src = root / rel
        if src.exists():
            shutil.copy2(src, backup / rel.replace("/", "__").replace("\\", "__"))
    print("Backup:", backup)
    return backup


def run(cmd, check=True):
    print("+", " ".join(map(str, cmd)))
    return subprocess.run(cmd, check=check)


def patch_app(root: Path, host_ip: str):
    path = root / "app.py"
    text = read(path)

    if not re.search(r"(?m)^import ipaddress\s*$", text):
        if "import hmac\n" in text:
            text = text.replace("import hmac\n", "import hmac\nimport ipaddress\n", 1)
        else:
            text = "import ipaddress\n" + text

    old_auth = '''def _mailmate_compute_authorized():
    expected = os.getenv("MAILMATE_WORKER_TOKEN", "").strip()
    if not expected:
        return False
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return False
    supplied = header[7:].strip()
    return bool(supplied) and hmac.compare_digest(supplied, expected)
'''
    new_auth = '''def _mailmate_compute_authorized():
    # Same-machine and Tailscale devices may use the inference-only route.
    remote = str(request.remote_addr or "").strip()
    try:
        ip = ipaddress.ip_address(remote)
        if ip.is_loopback or ip in ipaddress.ip_network("100.64.0.0/10"):
            return True
    except ValueError:
        pass

    # Optional bearer token remains supported for explicit non-Tailscale routes.
    expected = os.getenv("MAILMATE_WORKER_TOKEN", "").strip()
    if not expected:
        return False
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return False
    supplied = header[7:].strip()
    return bool(supplied) and hmac.compare_digest(supplied, expected)
'''
    if old_auth in text:
        text = text.replace(old_auth, new_auth, 1)

    guard_marker = "# MAILMATE_TAILNET_COMPUTE_ONLY_GUARD"
    if guard_marker not in text:
        guard = '''# MAILMATE_TAILNET_COMPUTE_ONLY_GUARD
@app.before_request
def _mailmate_tailnet_compute_only():
    """Tailnet peers may use compute only; Priyam's Gmail/session routes stay local."""
    remote = str(request.remote_addr or "").strip()
    try:
        ip = ipaddress.ip_address(remote)
    except ValueError:
        return None

    if ip.is_loopback:
        return None
    if ip in ipaddress.ip_network("100.64.0.0/10"):
        if request.path.startswith("/api/compute/"):
            return None
        return jsonify({"error": "tailnet_compute_only"}), 403
    return None


'''
        marker = "@app.route('/')"
        if marker in text:
            text = text.replace(marker, guard + marker, 1)

    text = re.sub(
        r'base = os\.getenv\("MAILMATE_REMOTE_WORKER_URL",\s*"[^"]*"\)\.strip\(\)\.rstrip\("/"\)',
        f'base = os.getenv("MAILMATE_REMOTE_WORKER_URL", "http://{host_ip}:5000/api/compute").strip().rstrip("/")',
        text,
        count=1,
    )

    health_anchor = '        "googleClientConfigured": bool(os.getenv(\'GOOGLE_CLIENT_ID\')),\n'
    if health_anchor in text and '"geminiConfigured"' not in text:
        health_extra = (
            health_anchor
            + '        "geminiConfigured": bool(os.getenv(\'GEMINI_API_KEY\')),\n'
            + '        "geminiFallbackEnabled": str(os.getenv(\'MAILMATE_CLOUD_FALLBACK\', \'0\')).lower() in {\'1\', \'true\', \'yes\', \'on\'},\n'
            + '        "localModelConfigured": bool(os.getenv(\'LM_STUDIO_BASE_URL\', \'http://127.0.0.1:2806/v1\')),\n'
            + '        "whisper": whisper_service.get_status(),\n'
        )
        text = text.replace(health_anchor, health_extra, 1)

    text = text.replace(
        '        "voiceInput": "browser-speech-recognition",',
        '        "voiceInput": "local-whisper-with-browser-fallback" if whisper_service.get_status().get("available") else "browser-speech-recognition",'
    )

    old_work = '''@app.route('/api/work/jobs', methods=['GET'])
def list_work_jobs():
    profile = get_user_profile()
    if not profile:
        return jsonify({"error": "Not authenticated"}), 401
    user_id = profile.get('email') or profile.get('id')
    jobs = work_agent_service.list_jobs(user_id)
    return jsonify(jobs)
'''
    new_work = '''@app.route('/api/work/jobs', methods=['GET'])
def list_work_jobs():
    profile = get_user_profile()
    if not profile:
        return jsonify({"error": "Not authenticated"}), 401
    user_id = profile.get('email') or profile.get('id')
    jobs = work_agent_service.list_jobs(user_id)

    ensure = str(request.args.get('ensure', '')).lower() in {'1', 'true', 'yes'}
    if ensure and not jobs:
        try:
            live_payload = _build_live_dashboard(profile, force_ai=False)
            work_agent_service.sync_and_enqueue(user_id, live_payload)
            jobs = work_agent_service.list_jobs(user_id, reconcile=False)
            system_context_service.increment_version()
        except Exception as ensure_exc:
            app.logger.debug('Work ensure sync notice: %s', ensure_exc)

    return jsonify(jobs)
'''
    if old_work in text:
        text = text.replace(old_work, new_work, 1)

    write(path, text)


def write_ai_service(root: Path):
    path = root / "services" / "ai_service.py"
    content = r'''import datetime
import json
import os
import re
from typing import Any, Dict, List

import requests

from services.google_service import get_calendar_events, build, get_credentials
from services.privacy_gate import PrivacyGate
from services.agent.models.lmstudio import LMStudioModel


def _json_object(text: str) -> Dict[str, Any]:
    clean = re.sub(r"^```(?:json)?\s*|\s*```$", "", str(text or "").strip(), flags=re.I)
    match = re.search(r"\{[\s\S]*\}", clean)
    if not match:
        raise ValueError("No JSON object in model response")
    return json.loads(match.group(0))


def _local_completion(prompt: str, max_tokens: int = 1600) -> str:
    model = LMStudioModel(timeout=16)
    payload = {
        "model": model.model,
        "temperature": 0.1,
        "max_tokens": max_tokens,
        "messages": [
            {
                "role": "system",
                "content": "You are Mailmate's local reasoning model. Never invent mailbox or Work state. Follow requested schemas exactly.",
            },
            {"role": "user", "content": prompt},
        ],
    }
    response = model._request_completion(payload)
    return str(response["choices"][0]["message"].get("content") or "").strip()


def _gemini_completion(prompt: str, json_mode: bool = False) -> str:
    enabled = str(os.getenv("MAILMATE_CLOUD_FALLBACK", "0")).lower() in {"1", "true", "yes", "on"}
    key = os.getenv("GEMINI_API_KEY", "").strip()
    if not enabled or not key:
        raise RuntimeError("Gemini fallback disabled")

    model = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite").strip()
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "temperature": 0.1,
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


def get_dashboard_overview(threads):
    safe_threads = PrivacyGate.filter_threads_for_ai(threads or [])
    shielded = len(threads or []) - len(safe_threads)
    if shielded:
        print(f"[PrivacyGate] Shielded {shielded} sensitive/private thread(s) from AI analysis.")

    prompt = f"""Analyze these safe email threads for the current user.
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
Threads:
{json.dumps(safe_threads, ensure_ascii=False)}
"""

    parsed = None
    try:
        parsed = _json_object(_local_completion(prompt))
    except Exception as exc:
        print("[AI] local overview notice:", exc)

    if parsed is None:
        try:
            parsed = _json_object(_gemini_completion(prompt, json_mode=True))
        except Exception as exc:
            print("[AI] Gemini overview fallback notice:", exc)

    if parsed is None:
        parsed = _heuristic_overview(safe_threads)

    parsed.setdefault("metrics", {})
    parsed.setdefault("needs_attention", [])
    parsed.setdefault("waiting_on_others", [])
    parsed.setdefault("ai_insight", "")
    parsed["metrics"]["emails"] = len(threads or [])
    parsed["metrics"]["important"] = len(parsed["needs_attention"])
    parsed["metrics"]["actions"] = len(parsed["needs_attention"])
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
        return _local_completion(prompt, max_tokens=500)
    except Exception:
        try:
            return _gemini_completion(prompt)
        except Exception as exc:
            return f"Kyle local AI is temporarily unavailable: {exc}"


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
        return _local_completion(prompt, max_tokens=280)
    except Exception:
        try:
            return _gemini_completion(prompt)
        except Exception:
            return "I can still operate Mailmate, but the language model is temporarily unavailable."
'''
    write(path, content)


def patch_lmstudio(root: Path, host_ip: str):
    path = root / "services" / "agent" / "models" / "lmstudio.py"
    text = read(path)
    text = re.sub(
        r'self\.remote_worker_url = os\.getenv\("MAILMATE_REMOTE_WORKER_URL",\s*"[^"]*"\)\.strip\(\)\.rstrip\("/"\)',
        f'self.remote_worker_url = os.getenv("MAILMATE_REMOTE_WORKER_URL", "http://{host_ip}:5000/api/compute").strip().rstrip("/")',
        text,
        count=1,
    )

    start = text.find("    def _request_completion(self, payload: Dict[str, Any]) -> Dict[str, Any]:")
    end = text.find("\n    def plan(", start)
    if start >= 0 and end > start:
        replacement = '''    def _request_completion(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Local-first completion with transient-network retries."""
        errors = []

        def attempt(url, provider, delays, headers=None):
            headers = headers or {}
            for delay in delays:
                if delay:
                    import time
                    time.sleep(delay)
                try:
                    res = requests.post(url, json=payload, headers=headers, timeout=self.timeout)
                    if res.ok:
                        self.last_provider = provider
                        return res.json()
                    if 400 <= res.status_code < 500:
                        errors.append(f"{provider} HTTP {res.status_code}")
                        return None
                    errors.append(f"{provider} transient HTTP {res.status_code}")
                except requests.RequestException as exc:
                    errors.append(f"{provider} unavailable: {exc}")
            return None

        is_host = bool(os.getenv("MAILMATE_WORKER_HOST"))
        local = attempt(
            self._completion_url(self.base_url),
            "local_lm_studio",
            [0, 1, 2, 4] if is_host else [0],
        )
        if local is not None:
            return local

        if self.remote_worker_url:
            headers = {}
            if self.worker_token:
                headers["Authorization"] = f"Bearer {self.worker_token}"
            remote = attempt(
                self._completion_url(self.remote_worker_url, worker=True),
                "remote_local_worker",
                [0, 2, 4, 8],
                headers=headers,
            )
            if remote is not None:
                return remote

        raise RuntimeError("; ".join(errors[-8:]) or "No local model route is available.")
'''
        text = text[:start] + replacement + text[end:]
    write(path, text)


def patch_work_agent(root: Path):
    path = root / "services" / "work_agent_service.py"
    text = read(path)
    text = text.replace("            max_steps=12,", "            max_steps=20,", 1)

    marker = '            job["updated_at"] = _now()\n            self._write_jobs(jobs)\n\n    def _execute_job(self, job_id, user_id):\n'
    if marker in text and 'job["checkpoint"] = session.to_dict()' not in text:
        text = text.replace(
            marker,
            '            job["checkpoint"] = session.to_dict()\n            job["updated_at"] = _now()\n            self._write_jobs(jobs)\n\n    def _execute_job(self, job_id, user_id):\n',
            1,
        )

    anchor = '''        # Step 3: Run Agent Loop
        loop = AgentLoop(session)
'''
    if anchor in text and "Restore the last successfully persisted agent checkpoint" not in text:
        restore = '''        # Restore the last successfully persisted agent checkpoint.
        # This lets a paused Tailscale/LM Studio job continue instead of replaying
        # already-completed research/file/tool actions.
        checkpoint = job.get("checkpoint") or {}
        if checkpoint:
            try:
                session.steps = list(checkpoint.get("steps") or [])
                session.artifacts = list(checkpoint.get("artifacts") or [])
                session.notes = list(checkpoint.get("notes") or [])
                session.checklist = list(checkpoint.get("checklist") or [])
                session.reply_draft = dict(checkpoint.get("reply_draft") or {})
                session.summary = str(checkpoint.get("summary") or "")
                counters = checkpoint.get("counters") or {}
                session.step_count = min(int(checkpoint.get("step_count") or len(session.steps)), session.max_steps - 1)
                session.tool_failures = int(counters.get("tool_failures") or 0)
                session.research_calls = int(counters.get("research_calls") or 0)
                session.generated_files = int(counters.get("generated_files") or 0)
                session.status = "running"
                session.finish_reason = None
            except Exception as checkpoint_exc:
                print(f"[WorkAgent] Checkpoint restore notice: {checkpoint_exc}")

        # Step 3: Run Agent Loop
        loop = AgentLoop(session)
'''
        text = text.replace(anchor, restore, 1)

    old_wait = '''                    jobs[job_id]["status"] = "waiting_local_model"
                    jobs[job_id]["summary"] = "Job waiting: local model unavailable. Cloud fallback prohibited by Privacy Gate."
                    jobs[job_id]["routing"] = routing
                    jobs[job_id]["steps"] = final_session.steps
                    jobs[job_id]["updated_at"] = _now()
                    self._write_jobs(jobs)
'''
    new_wait = '''                    jobs[job_id]["status"] = "waiting_local_model"
                    jobs[job_id]["summary"] = "Kyle paused because local compute is temporarily unavailable. Progress is saved."
                    jobs[job_id]["routing"] = routing
                    jobs[job_id]["steps"] = final_session.steps
                    jobs[job_id]["artifacts"] = final_session.artifacts
                    jobs[job_id]["checkpoint"] = final_session.to_dict()
                    jobs[job_id]["pause_reason"] = "compute_unavailable"
                    jobs[job_id]["paused_at"] = _now()
                    jobs[job_id]["current_step"] = "Waiting for local AI · progress saved"
                    jobs[job_id]["updated_at"] = _now()
                    self._write_jobs(jobs)
'''
    if old_wait in text:
        text = text.replace(old_wait, new_wait, 1)

    write(path, text)


def patch_whisper(root: Path):
    path = root / "services" / "whisper_service.py"
    text = read(path).replace("            beam_size=5,", "            beam_size=1,")
    write(path, text)


def write_kyle_audio(root: Path):
    path = root / "kyle-audio.js"
    content = r'''(function () {
  function createAudioEngine(onAmplitude) {
    let audioContext = null;
    let analyser = null;
    let source = null;
    let rafId = null;
    let stream = null;
    let recorder = null;
    let chunks = [];
    let smoothed = 0;
    let closeTimer = null;
    const data = new Float32Array(1024);

    function ensureContext() {
      audioContext = audioContext || new AudioContext();
      return audioContext;
    }

    function micLive() {
      return Boolean(stream && stream.getAudioTracks().some(track => track.readyState === 'live'));
    }

    function startAnalyser() {
      if (!analyser || rafId) return;
      const tick = () => {
        analyser.getFloatTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);
        const normalized = Math.max(0, Math.min(1, (rms - 0.018) * 9));
        smoothed = smoothed * 0.75 + normalized * 0.25;
        onAmplitude(smoothed);
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }

    function stopAnalyser() {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      smoothed = 0;
      onAmplitude(0);
    }

    function cancelScheduledClose() {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = null;
    }

    async function openMic() {
      cancelScheduledClose();
      if (!micLive()) {
        const started = performance.now();
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
        });
        console.log(`[Kyle Voice] cold mic ready in ${Math.round(performance.now() - started)} ms`);
      } else {
        console.log('[Kyle Voice] warm mic reused');
      }

      const ctx = ensureContext();
      if (ctx.state === 'suspended') await ctx.resume();
      if (!analyser || !source) {
        analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
      }
      startAnalyser();
      return stream;
    }

    function startRecording(onChunk, onStop) {
      if (!micLive()) throw new Error('Microphone is not ready');
      chunks = [];
      const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined;
      recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          chunks.push(event.data);
          onChunk?.(event.data);
        }
      };
      recorder.onstop = () => onStop?.(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
      recorder.start(250);
      return recorder;
    }

    async function connectAudioElement(audio) {
      const ctx = ensureContext();
      await ctx.resume();
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source = ctx.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(ctx.destination);
      startAnalyser();
    }

    function cleanupMic() {
      cancelScheduledClose();
      stopAnalyser();
      recorder = null;
      if (source) { try { source.disconnect(); } catch (_) {} }
      source = null;
      analyser = null;
      stream?.getTracks().forEach(track => track.stop());
      stream = null;
      console.log('[Kyle Voice] mic closed');
    }

    function scheduleMicClose(delayMs = 10000) {
      cancelScheduledClose();
      closeTimer = setTimeout(cleanupMic, Math.max(0, delayMs));
    }

    function cleanupAudio() {
      stopAnalyser();
      if (source) { try { source.disconnect(); } catch (_) {} }
      source = null;
      analyser = null;
    }

    return {
      openMic,
      startRecording,
      connectAudioElement,
      cleanupMic,
      scheduleMicClose,
      cancelScheduledClose,
      isMicLive: micLive,
      cleanupAudio
    };
  }

  window.KyleAudio = { createAudioEngine };
})();
'''
    write(path, content)


def patch_kyle_js(root: Path):
    path = root / "kyle.js"
    text = read(path)

    old = '''  async function whisperReady() {
    try {
      const response = await fetch(`${API_BASE}/api/stt/status`, { cache: 'no-store' });
      if (!response.ok) return false;
      const status = await response.json();
      return Boolean(status.loaded || status.available);
    } catch (_) {
      return false;
    }
  }

  async function startListening() {
    if (store.muted) return;
    if (store.current === store.states.LISTENING || store.current === store.states.TRANSCRIBING) return;
    interrupt(false);

    activeRun += 1;
    const run = activeRun;
    recognitionTranscript = '';

    if (await whisperReady()) {
      return startWhisperListening(run);
    }

    return startBrowserListening(run);
  }

  async function startWhisperListening(run) {
    try {
      await audio.openMic();
'''
    new = '''  const whisperStatusCache = { ready: null, checkedAt: 0 };

  async function whisperReady() {
    const now = Date.now();
    if (whisperStatusCache.ready !== null && now - whisperStatusCache.checkedAt < 30000) {
      return whisperStatusCache.ready;
    }
    try {
      const response = await fetch(`${API_BASE}/api/stt/status`, { cache: 'no-store' });
      if (!response.ok) return false;
      const status = await response.json();
      whisperStatusCache.ready = Boolean(status.loaded || status.available);
      whisperStatusCache.checkedAt = now;
      return whisperStatusCache.ready;
    } catch (_) {
      return false;
    }
  }

  async function startListening() {
    if (store.muted) return;
    if (store.current === store.states.LISTENING || store.current === store.states.TRANSCRIBING) return;
    interrupt(false);

    activeRun += 1;
    const run = activeRun;
    recognitionTranscript = '';
    const startedAt = performance.now();

    store.set(store.states.LISTENING);
    ui.setLiveText('Listening…');

    const micPromise = audio.openMic();
    const whisperPromise = whisperReady();

    try {
      await micPromise;
      if (run !== activeRun) return;
      console.log(`[Kyle Voice] mic ready after ${Math.round(performance.now() - startedAt)} ms`);
      const useWhisper = await whisperPromise;
      if (useWhisper) return startWhisperListening(run, true);
      return startBrowserListening(run, true);
    } catch (error) {
      console.warn('[Kyle Voice] mic startup failed:', error.message || error);
      return startBrowserListening(run, false);
    }
  }

  async function startWhisperListening(run, micReady = false) {
    try {
      if (!micReady) await audio.openMic();
'''
    if old in text:
        text = text.replace(old, new, 1)

    text = text.replace("  async function startBrowserListening(run) {", "  async function startBrowserListening(run, micReady = false) {", 1)
    text = text.replace(
        "      await audio.openMic();\n      if (run !== activeRun) return;\n\n      recognition = new SpeechRecognition();",
        "      if (!micReady) await audio.openMic();\n      if (run !== activeRun) return;\n\n      recognition = new SpeechRecognition();",
        1,
    )
    text = text.replace(
        "    audio.cleanupMic();\n\n    if (run !== activeRun) return;\n    if (!blob || blob.size < 1000) {",
        "    audio.scheduleMicClose?.(10000);\n\n    if (run !== activeRun) return;\n    if (!blob || blob.size < 1000) {",
        1,
    )
    text = text.replace(
        "    recognition = null;\n    audio.cleanupMic();\n    ui.setAmplitude(0, 0);",
        "    recognition = null;\n    audio.scheduleMicClose?.(10000);\n    ui.setAmplitude(0, 0);",
        1,
    )

    if "async function guardWorkNarration" not in text:
        marker = "  async function handlePrompt(prompt, run = ++activeRun) {"
        guard = r'''  async function guardWorkNarration(reply, voice) {
    const combined = `${reply || ''} ${voice || ''}`;
    const makesWorkClaim = /\b(drafts? (?:are )?waiting|prepared work|ready for review|waiting for review|tasks? waiting.*work|work tab.*(?:draft|prepared|review))\b/i.test(combined);
    if (!makesWorkClaim) return { reply, voice };

    try {
      const response = await fetch(`${API_BASE}/api/work/jobs`, { cache: 'no-store' });
      if (!response.ok) return { reply, voice };
      const jobs = await response.json();
      const live = (Array.isArray(jobs) ? jobs : []).filter(job => [
        'queued','reading_context','planning','researching','generating','drafting_reply',
        'creating_files','verifying','preparing','working','waiting_local_model',
        'waiting_approval','auto_send_countdown','needs_input'
      ].includes(job.status));
      if (live.length === 0) {
        const truth = 'There are no prepared Work items waiting for review right now.';
        return { reply: truth, voice: truth };
      }
    } catch (_) {}
    return { reply, voice };
  }

'''
        if marker in text:
            text = text.replace(marker, guard + marker, 1)

    old_data = '''      let reply = String(data.reply || data.text || '').trim() || 'Done.';
      let voice = String(data.voice || compactVoice(reply)).trim();

      if (run !== activeRun) return;
'''
    new_data = '''      let reply = String(data.reply || data.text || '').trim() || 'Done.';
      let voice = String(data.voice || compactVoice(reply)).trim();

      ({ reply, voice } = await guardWorkNarration(reply, voice));

      if (run !== activeRun) return;
'''
    if old_data in text:
        text = text.replace(old_data, new_data, 1)

    write(path, text)


def patch_kyle_ui(root: Path):
    path = root / "kyle-ui.js"
    text = read(path)

    text = text.replace(
        '''                <button class="kyle-panel-btn kyle-panel-mic-btn" id="kylePanelMicBtn" type="button" aria-label="Mute Kyle" title="Mute Kyle">
                  <i class="fas fa-volume-high"></i>
                </button>
''',
        "",
        1,
    )
    text = text.replace(
        "      panelMicBtn.innerHTML = muted ? '<i class=\"fas fa-volume-xmark\"></i>' : '<i class=\"fas fa-volume-high\"></i>';",
        "      if (!panelMicBtn) return;\n      panelMicBtn.innerHTML = muted ? '<i class=\"fas fa-volume-xmark\"></i>' : '<i class=\"fas fa-volume-high\"></i>';",
        1,
    )
    text = text.replace(
        "    panelMicBtn.addEventListener('click', () => boundHandlers.onMute?.());",
        "    panelMicBtn?.addEventListener('click', () => boundHandlers.onMute?.());",
        1,
    )

    old_fetch = '''        const res = await fetch('/api/mail/send', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: to,
            subject: subject,
            body: body,
            thread_id: current.thread_id || null,
            in_reply_to: current.in_reply_to || null
          })
        });

        const data = await res.json().catch(() => ({}));
'''
    new_fetch = '''        const payload = {
          to: to,
          subject: subject,
          body: body,
          thread_id: current.thread_id || null,
          in_reply_to: current.in_reply_to || null
        };

        let res = null;
        let lastNetworkError = null;
        for (const delay of [0, 450, 1200]) {
          if (delay) await new Promise(resolve => setTimeout(resolve, delay));
          try {
            res = await fetch('/api/mail/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            break;
          } catch (networkError) {
            lastNetworkError = networkError;
          }
        }
        if (!res) throw lastNetworkError || new Error('Mailmate backend is unreachable.');
        const data = await res.json().catch(() => ({}));
'''
    if old_fetch in text:
        text = text.replace(old_fetch, new_fetch, 1)

    write(path, text)


def patch_dashboard(root: Path):
    path = root / "dashboard.js"
    text = read(path)

    text = text.replace(
        "const res = await fetch(`${API_BASE}/api/work/jobs`);",
        "const res = await fetch(`${API_BASE}/api/work/jobs?ensure=1`, { cache: 'no-store' });",
        1,
    )

    anchor = '''      state.data = data;
      state.calendarDismissedMarkers = new Set(data.calendar_dismissed_markers || []);
      renderDashboard(data);
'''
    replacement = '''      state.data = data;
      state.calendarDismissedMarkers = new Set(data.calendar_dismissed_markers || []);
      renderDashboard(data);

      try {
        const workResponse = await fetch(`${API_BASE}/api/work/jobs?ensure=1`, { cache: 'no-store' });
        if (workResponse.ok) {
          workJobs = await workResponse.json();
          renderOverviewWorkingNow();
        }
      } catch (workSyncError) {
        console.debug('Work sync notice:', workSyncError);
      }
'''
    if anchor in text:
        text = text.replace(anchor, replacement, 1)

    # Add Work jobs to Kyle's normal context payloads.
    text = text.replace(
        '''        calendarEvents: state.calendarEvents,
        health: state.health,
        currentPage: state.currentPage
''',
        '''        calendarEvents: state.calendarEvents,
        workJobs: workJobs,
        health: state.health,
        currentPage: state.currentPage
''',
    )

    text = text.replace(
        "// Google -> Agent Harness: refresh once a minute while the page is open.",
        "// Google Calendar is authoritative; refresh often enough to remove externally deleted events quickly.",
    )
    text = text.replace("    }, 60000);", "    }, 10000);", 1)

    text = text.replace("['Gemini', h.geminiConfigured],", "['Gemini cloud fallback', h.geminiConfigured],")
    text = text.replace(
        '''els.statusList.innerHTML = rows.map(([label, ok]) => `<li data-status="${ok ? 'Ready' : 'Unavailable'}"><strong>${escapeHtml(label)}</strong></li>`).join('');''',
        '''els.statusList.innerHTML = rows.map(([label, ok]) => {
      const statusText = ok ? 'Ready' : (label.startsWith('Gemini') ? 'Optional · off' : 'Unavailable');
      return `<li data-status="${statusText}"><strong>${escapeHtml(label)}</strong></li>`;
    }).join('');''',
    )
    text = text.replace(
        '''els.integrationList.innerHTML = rows.map(([label, ok]) => `<li data-status="${ok ? 'Connected' : 'Unavailable'}"><strong>${escapeHtml(label)}</strong></li>`).join('');''',
        '''els.integrationList.innerHTML = rows.map(([label, ok]) => {
      const statusText = ok ? 'Connected' : (label.startsWith('Gemini') ? 'Optional · off' : 'Unavailable');
      return `<li data-status="${statusText}"><strong>${escapeHtml(label)}</strong></li>`;
    }).join('');''',
    )

    if "function startInboxAutoSync()" not in text:
        text = text.replace("    startCalendarAutoSync();\n", "    startCalendarAutoSync();\n    startInboxAutoSync();\n", 1)
        state_anchor = "    calendarSyncTimer: null,\n"
        if state_anchor in text:
            text = text.replace(state_anchor, state_anchor + "    inboxSyncTimer: null,\n", 1)
        fn_anchor = "  function startCalendarAutoSync() {"
        inbox_fn = '''  function startInboxAutoSync() {
    if (state.inboxSyncTimer) clearInterval(state.inboxSyncTimer);
    state.inboxSyncTimer = setInterval(() => {
      if (document.hidden) return;
      if (!['overview', 'inbox'].includes(state.currentPage)) return;
      loadInbox(false);
    }, 10000);
  }

'''
        if fn_anchor in text:
            text = text.replace(fn_anchor, inbox_fn + fn_anchor, 1)

    write(path, text)


def write_polish_css(root: Path):
    path = root / "mailmate-master-polish.css"
    css = r'''/* Final Mailmate UX polish */
.kyle-floating-mount { right: 24px !important; bottom: 22px !important; z-index: 1900 !important; }
.kyle-shell {
  width: 72px !important; height: 72px !important; padding: 6px !important;
  border-radius: 999px !important; border: 1px solid rgba(255,255,255,.13) !important;
  background: rgba(19,19,18,.94) !important;
  box-shadow: 0 18px 50px rgba(0,0,0,.24), 0 1px 0 rgba(255,255,255,.06) inset !important;
  transform-origin: 100% 50%;
  transition: width 220ms cubic-bezier(.16,1,.3,1), box-shadow 180ms ease !important;
}
.kyle-widget:hover .kyle-shell,
.kyle-widget:focus-within .kyle-shell,
.kyle-widget.is-expanded .kyle-shell,
.kyle-widget:not([data-state="IDLE"]) .kyle-shell { width: min(382px, calc(100vw - 44px)) !important; }
.kyle-orb { width: 60px !important; height: 60px !important; flex-basis: 60px !important; }
.orb-visual {
  box-shadow: inset 0 0 20px rgba(255,255,255,.34), 0 0 0 1px rgba(255,255,255,.16), 0 10px 24px rgba(0,0,0,.18) !important;
  transition: transform 90ms linear, box-shadow 200ms ease, opacity 180ms ease !important;
}
.kyle-widget[data-state="THINKING"] .orb-visual { animation: mailmateThink 1100ms ease-in-out infinite alternate; }
.kyle-widget[data-state="ACTING"] .orb-visual,
.kyle-widget[data-state="OBSERVING"] .orb-visual { animation: mailmateWork 980ms ease-in-out infinite alternate !important; }
.kyle-widget[data-state="WAITING_APPROVAL"] .orb-visual {
  box-shadow: inset 0 0 20px rgba(255,255,255,.42), 0 0 0 2px rgba(217,158,63,.56), 0 12px 30px rgba(0,0,0,.2) !important;
}
.kyle-action-panel {
  right: 24px !important; bottom: 104px !important; width: min(410px, calc(100vw - 32px)) !important;
  max-height: min(530px, calc(100vh - 132px)) !important; border: 1px solid rgba(255,255,255,.11) !important;
  border-radius: 18px !important; overflow: hidden !important; background: rgba(20,20,19,.965) !important;
  box-shadow: 0 26px 70px rgba(0,0,0,.32), 0 1px 0 rgba(255,255,255,.05) inset !important;
  transform-origin: 100% 100% !important; transform: translateY(12px) scale(.965) !important; opacity: 0 !important;
  transition: opacity 170ms ease, transform 220ms cubic-bezier(.16,1,.3,1) !important;
}
.kyle-action-panel.is-open { opacity: 1 !important; transform: translateY(0) scale(1) !important; }
.kyle-panel-header { min-height: 58px; padding: 13px 14px 11px !important; border-bottom: 1px solid rgba(255,255,255,.075) !important; }
.kyle-panel-mic-btn { display: none !important; }
.kyle-panel-btn { width: 30px !important; height: 30px !important; border-radius: 9px !important; }
.kyle-panel-body { padding: 13px 14px !important; max-height: 370px !important; }
.kyle-composer-input, .kyle-composer-textarea { border-radius: 10px !important; border-color: rgba(255,255,255,.085) !important; background: rgba(255,255,255,.038) !important; }
.kyle-composer-textarea { min-height: 130px !important; }
.kyle-panel-footer { padding: 11px 14px !important; background: rgba(0,0,0,.16) !important; }
.kyle-btn { min-height: 34px; padding: 7px 13px !important; border-radius: 9px !important; }
.kyle-hud-step { padding: 8px 9px !important; border-radius: 10px !important; background: rgba(255,255,255,.035) !important; animation: mailmateStepIn 180ms ease both; }
.kyle-confirmation-item { border-radius: 10px !important; padding: 9px 10px !important; }

.work-layout { grid-template-columns: 300px minmax(0,1fr) !important; border-radius: 14px !important; box-shadow: 0 8px 26px rgba(0,0,0,.035) !important; }
.work-history { background: #e9e9e5 !important; padding-top: 14px !important; }
.work-item { padding: 13px 16px !important; transition: background 150ms ease !important; }
.work-item:hover { background: rgba(255,255,255,.66) !important; }
.work-item.active { background: #fff !important; }
.work-run { padding: 26px 30px 34px !important; }
.work-prepared-card, .work-collapsible, .policy-banner, .work-reply-preview { border-radius: 11px !important; }

.week-calendar { padding-bottom: 80px !important; scroll-padding-bottom: 80px !important; scrollbar-gutter: stable; }
.calendar-time-column, .calendar-day-column { height: calc(var(--calendar-hour-height) * 24 + 80px) !important; padding-bottom: 80px !important; }

.email-prefetch-indicator { display:inline-flex; align-items:center; gap:7px; margin-bottom:14px; padding:5px 8px; border-radius:999px; background:rgba(24,24,23,.045); color:var(--muted); font-size:.72rem; }
.email-snippet-content { color: var(--soft); opacity: .82; white-space: pre-wrap; }

@keyframes mailmateStepIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:translateY(0); } }
@keyframes mailmateThink { from { opacity:.82; transform:scale(.99); } to { opacity:1; transform:scale(1.015); } }
@keyframes mailmateWork { from { opacity:.86; transform:scale(.995); } to { opacity:1; transform:scale(1.025); } }

@media (max-width:720px) {
  .kyle-floating-mount { right:14px !important; bottom:14px !important; }
  .kyle-action-panel { right:14px !important; bottom:96px !important; width:calc(100vw - 28px) !important; }
  .work-layout { grid-template-columns:1fr !important; }
}
@media (prefers-reduced-motion:reduce) {
  .kyle-action-panel, .kyle-shell, .orb-visual, .kyle-hud-step { animation:none !important; transition:none !important; }
}
'''
    write(path, css)


def patch_dashboard_html(root: Path):
    path = root / "dashboard.html"
    text = read(path)
    text = re.sub(r'dashboard\.css\?v=\d+', 'dashboard.css?v=30', text)
    text = re.sub(r'remote-worker-ui\.css\?v=\d+', 'remote-worker-ui.css?v=8', text)
    text = re.sub(r'dashboard\.js\?v=\d+', 'dashboard.js?v=30', text)
    text = re.sub(r'kyle-ui\.js\?v=\d+', 'kyle-ui.js?v=30', text)
    text = re.sub(r'kyle-audio\.js\?v=\d+', 'kyle-audio.js?v=30', text)
    text = re.sub(r'kyle\.js\?v=\d+', 'kyle.js?v=30', text)

    if "mailmate-master-polish.css" not in text:
        anchor = '<link rel="stylesheet" href="/compute-ui-fix.css?v=1">'
        if anchor in text:
            text = text.replace(anchor, anchor + '\n  <link rel="stylesheet" href="./mailmate-master-polish.css?v=1">', 1)
        else:
            text = text.replace("</head>", '  <link rel="stylesheet" href="./mailmate-master-polish.css?v=1">\n</head>', 1)
    write(path, text)


def patch_remote_ui(root: Path):
    path = root / "remote-worker-ui.js"
    if not path.exists():
        return
    text = read(path)
    text = text.replace("const FAILURE_THRESHOLD = 1;", "const FAILURE_THRESHOLD = 3;")
    text = text.replace("const SUCCESS_THRESHOLD = 1;", "const SUCCESS_THRESHOLD = 2;")
    text = text.replace("Priyam's hotspot", "Priyam's Tailscale workstation")
    text = text.replace("Priyam’s hotspot", "Priyam’s Tailscale workstation")
    write(path, text)


def cleanup_requirements(root: Path):
    path = root / "requirements.txt"
    if not path.exists():
        return
    remove_prefixes = (
        "supabase==", "supabase-auth==", "supabase-functions==",
        "postgrest==", "realtime==", "storage3==",
    )
    lines = [line for line in read(path).splitlines() if not line.lower().startswith(remove_prefixes)]
    write(path, "\n".join(lines).rstrip() + "\n")


def cleanup_local(root: Path):
    for name in ["node_modules", ".pytest_cache"]:
        path = root / name
        if path.exists() and path.is_dir():
            print("[cleanup]", name)
            shutil.rmtree(path, ignore_errors=True)
    for cache_dir in root.rglob("__pycache__"):
        if ".venv" in cache_dir.parts:
            continue
        shutil.rmtree(cache_dir, ignore_errors=True)


def configure_env(root: Path, role: str, host_ip: str):
    env = root / "api.env"
    set_env(env, "MAILMATE_REMOTE_WORKER_URL", f"http://{host_ip}:5000/api/compute")
    set_env(env, "MAILMATE_COMPUTE_LABEL", "Priyam's Tailscale workstation")
    if role == "host":
        set_env(env, "LM_STUDIO_BASE_URL", "http://127.0.0.1:2806/v1")
        set_env(env, "MAILMATE_WORKER_HOST", "embedded-app")
    elif role == "client":
        remove_env(env, "MAILMATE_WORKER_HOST")
    # Tailnet CIDR authorization makes the old shared token unnecessary.
    remove_env(env, "MAILMATE_WORKER_TOKEN")


def main():
    parser = argparse.ArgumentParser(description="Apply the combined Mailmate stabilization and UX pass")
    parser.add_argument("--role", choices=["host", "client", "code-only"], default="host")
    parser.add_argument("--host-ip", default=HOST_TS_IP_DEFAULT)
    parser.add_argument("--no-commit", action="store_true")
    parser.add_argument("--no-cleanup", action="store_true")
    args = parser.parse_args()

    root = Path.cwd()
    if not (root / ".git").exists():
        die("Run this from the Mailmate/CipherSquad repository root.")

    required = [
        "app.py", "services/ai_service.py", "services/agent/models/lmstudio.py",
        "services/work_agent_service.py", "services/whisper_service.py",
        "kyle-audio.js", "kyle.js", "kyle-ui.js",
        "dashboard.js", "dashboard.html", "dashboard.css",
    ]
    for rel in required:
        if not (root / rel).exists():
            die(f"Missing required file: {rel}")

    backup_files(root, required + ["requirements.txt", "remote-worker-ui.js", "api.env"])

    patch_app(root, args.host_ip)
    write_ai_service(root)
    patch_lmstudio(root, args.host_ip)
    patch_work_agent(root)
    patch_whisper(root)
    write_kyle_audio(root)
    patch_kyle_js(root)
    patch_kyle_ui(root)
    patch_dashboard(root)
    write_polish_css(root)
    patch_dashboard_html(root)
    patch_remote_ui(root)
    cleanup_requirements(root)

    if args.role != "code-only":
        configure_env(root, args.role, args.host_ip)

    if not args.no_cleanup:
        cleanup_local(root)

    print("\nSyntax checks...")
    run([
        sys.executable, "-m", "py_compile",
        "app.py", "services/ai_service.py", "services/agent/models/lmstudio.py",
        "services/work_agent_service.py", "services/whisper_service.py",
    ])

    node = shutil.which("node")
    if node:
        for js in ["kyle-audio.js", "kyle.js", "kyle-ui.js", "dashboard.js", "remote-worker-ui.js"]:
            if (root / js).exists():
                run([node, "--check", js])

    if not args.no_commit:
        subprocess.run(["git", "diff", "--stat"])
        run([
            "git", "add",
            "app.py", "services/ai_service.py", "services/agent/models/lmstudio.py",
            "services/work_agent_service.py", "services/whisper_service.py",
            "kyle-audio.js", "kyle.js", "kyle-ui.js", "dashboard.js", "dashboard.html",
            "mailmate-master-polish.css", "remote-worker-ui.js", "requirements.txt",
            "MAILMATE_MASTER_FIX.py",
        ], check=False)
        commit = subprocess.run(["git", "commit", "-m", "fix: stabilize Kyle Work, Tailscale compute, voice and UX"])
        if commit.returncode == 0:
            push = subprocess.run(["git", "push", "origin", "main"])
            if push.returncode != 0:
                print("\nPush failed. Run:")
                print("  git pull --rebase origin main")
                print("  git push origin main")

    print("\n" + "=" * 64)
    print("MAILMATE MASTER FIX APPLIED")
    print("=" * 64)
    if args.role == "host":
        print(f"Host inference: http://{args.host_ip}:5000/api/compute")
        print("Start LM Studio Local API on 127.0.0.1:2806, then: py app.py")
    elif args.role == "client":
        print(f"Client inference route: http://{args.host_ip}:5000/api/compute")
        print("Keep Tailscale connected, then: py app.py")
    print("Do one Ctrl+Shift+R after restarting Flask.")
    print("No services.remote_worker_server process is required.")


if __name__ == "__main__":
    main()
