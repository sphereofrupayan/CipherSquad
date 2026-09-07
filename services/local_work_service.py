import hashlib
import json
import os
import re
import threading
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path

import requests


ACTIVE_STATES = {'analyzing', 'working'}
TERMINAL_STATES = {'ready', 'needs_input', 'failed', 'cancelled'}
ALL_STATES = {'queued', *ACTIVE_STATES, *TERMINAL_STATES}


def _now():
    return datetime.now(timezone.utc).isoformat()


def _clean(value, limit=1200):
    return re.sub(r'\s+', ' ', str(value or '')).strip()[:limit]


class LocalWorkService:
    """Durable, read-only preparation jobs backed by a local LM Studio server."""

    def __init__(self, storage_path=None, base_url=None):
        default_path = Path(__file__).resolve().parent.parent / 'data' / 'work_jobs.json'
        self.storage_path = Path(storage_path or default_path)
        self.base_url = (base_url or os.getenv('LM_STUDIO_BASE_URL') or 'http://127.0.0.1:2806/v1').rstrip('/')
        self.model = _clean(os.getenv('LM_STUDIO_MODEL'), 160)
        self.timeout = max(2, min(int(os.getenv('LM_STUDIO_TIMEOUT_SECONDS', '45') or 45), 180))
        self._lock = threading.RLock()
        self._cancel = {}
        self._workers = {}

    def config(self):
        return {
            'available': True,
            'base_url': self.base_url,
            'model': self.model or 'auto',
            'read_only': True,
        }

    def _read(self):
        if not self.storage_path.exists():
            return {}
        try:
            value = json.loads(self.storage_path.read_text(encoding='utf-8'))
            return value if isinstance(value, dict) else {}
        except Exception:
            return {}

    def _write(self, jobs):
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.storage_path.with_suffix('.tmp')
        temp.write_text(json.dumps(jobs, indent=2, ensure_ascii=False), encoding='utf-8')
        temp.replace(self.storage_path)

    @staticmethod
    def _job_id(user_id, gmail_message_id):
        digest = hashlib.sha256(f'{user_id}:{gmail_message_id}'.encode('utf-8')).hexdigest()[:18]
        return f'work_{digest}'

    @staticmethod
    def _is_actionable(email, attention_ids):
        message_id = str(email.get('id') or email.get('gmail_id') or '')
        labels = {str(label).upper() for label in email.get('labels') or []}
        text = f"{email.get('subject') or ''} {email.get('snippet') or ''}"
        return (
            message_id in attention_ids
            or bool(labels.intersection({'IMPORTANT', 'STARRED'}))
            or bool(re.search(r'\b(assignment|submission|deadline|due|urgent|approval|review|reply|respond|blocked|action required|exam)\b', text, re.I))
        )

    def sync_dashboard(self, user_id, payload):
        user_id = _clean(user_id, 240)
        if not user_id:
            return []
        attention_ids = {
            str(item.get('source_message_id') or item.get('message_id') or item.get('email_id') or '')
            for item in payload.get('needs_attention') or []
        }
        candidates = []
        for email in payload.get('emails') or []:
            message_id = str(email.get('id') or email.get('gmail_id') or '').strip()
            thread_id = str(email.get('threadId') or email.get('thread_id') or '').strip()
            if not message_id or not thread_id or not self._is_actionable(email, attention_ids):
                continue
            candidates.append((email, message_id, thread_id))
            if len(candidates) >= 10:
                break

        with self._lock:
            jobs = self._read()
            changed = False
            for email, message_id, thread_id in candidates:
                job_id = self._job_id(user_id, message_id)
                source = {
                    'gmail_message_id': message_id,
                    'gmail_thread_id': thread_id,
                    'subject': _clean(email.get('subject') or 'No subject', 240),
                    'sender': _clean(email.get('sender') or 'Unknown sender', 240),
                    'snippet': _clean(email.get('snippet'), 1200),
                }
                if job_id in jobs:
                    if jobs[job_id].get('source') != source:
                        jobs[job_id]['source'] = source
                        jobs[job_id]['updated_at'] = _now()
                        changed = True
                    continue
                academic = re.search(r'\b(assignment|submission|exam|quiz|course|class|college|university|DA)\b', f"{source['subject']} {source['snippet']}", re.I)
                jobs[job_id] = {
                    'id': job_id,
                    'user_id': user_id,
                    'title': f"Prepare: {source['subject']}",
                    'kind': 'assignment-prep' if academic else 'email-prep',
                    'status': 'queued',
                    'source': source,
                    'progress': [{'stage': 'queued', 'message': 'Ready for local preparation.', 'at': _now()}],
                    'artifact': None,
                    'error': None,
                    'created_at': _now(),
                    'updated_at': _now(),
                }
                changed = True
            if changed:
                self._write(jobs)
            return self._for_user(jobs, user_id)

    @staticmethod
    def _for_user(jobs, user_id):
        values = [deepcopy(job) for job in jobs.values() if job.get('user_id') == user_id]
        values.sort(key=lambda job: job.get('updated_at') or '', reverse=True)
        return values

    def list_jobs(self, user_id):
        with self._lock:
            return self._for_user(self._read(), _clean(user_id, 240))

    def get_job(self, job_id, user_id):
        with self._lock:
            job = self._read().get(str(job_id))
            if not job or job.get('user_id') != _clean(user_id, 240):
                return None
            return deepcopy(job)

    def _update(self, job_id, **updates):
        with self._lock:
            jobs = self._read()
            job = jobs.get(str(job_id))
            if not job:
                return None
            progress_message = updates.pop('progress_message', None)
            progress_stage = updates.get('status')
            job.update(updates)
            job['updated_at'] = _now()
            if progress_message:
                job.setdefault('progress', []).append({
                    'stage': progress_stage or job.get('status'),
                    'message': _clean(progress_message, 500),
                    'at': _now(),
                })
            self._write(jobs)
            return deepcopy(job)

    def _cancelled(self, job_id):
        return self._cancel.get(str(job_id), threading.Event()).is_set()

    def run_job(self, job_id, user_id, source_loader=None):
        job = self.get_job(job_id, user_id)
        if not job:
            return None
        if job.get('status') in ACTIVE_STATES:
            return job

        cancel_event = threading.Event()
        self._cancel[str(job_id)] = cancel_event
        job = self._update(
            job_id,
            status='queued',
            artifact=None,
            error=None,
            progress=[{'stage': 'queued', 'message': 'Queued for LM Studio.', 'at': _now()}],
        )
        worker = threading.Thread(
            target=self._run,
            args=(str(job_id), source_loader),
            daemon=True,
            name=f'local-work-{str(job_id)[-8:]}',
        )
        self._workers[str(job_id)] = worker
        worker.start()
        return job

    def cancel_job(self, job_id, user_id):
        job = self.get_job(job_id, user_id)
        if not job:
            return None
        self._cancel.setdefault(str(job_id), threading.Event()).set()
        if job.get('status') not in TERMINAL_STATES:
            job = self._update(job_id, status='cancelled', progress_message='Cancelled before any external action.')
        return job

    def _run(self, job_id, source_loader):
        try:
            job = self._update(job_id, status='analyzing', progress_message='Reading the exact Gmail source.')
            if self._cancelled(job_id):
                self._update(job_id, status='cancelled', progress_message='Cancelled.')
                return

            source = job.get('source') or {}
            body = source.get('snippet') or ''
            if source_loader:
                try:
                    full = source_loader(source.get('gmail_message_id')) or {}
                    body = full.get('body') or full.get('snippet') or body
                except Exception as exc:
                    self._update(job_id, progress_message=f'Full message unavailable; using saved snippet ({_clean(exc, 120)}).')

            self._update(job_id, status='working', progress_message='Generating a read-only preparation artifact locally.')
            if self._cancelled(job_id):
                self._update(job_id, status='cancelled', progress_message='Cancelled.')
                return

            artifact = self._generate(job, body)
            if self._cancelled(job_id):
                self._update(job_id, status='cancelled', progress_message='Cancelled.')
                return
            self._update(job_id, status='ready', artifact=artifact, error=None, progress_message='Preparation artifact is ready for review.')
        except Exception as exc:
            self._update(job_id, status='failed', error=_clean(exc, 500), progress_message='Local preparation failed without changing Gmail or Calendar.')
        finally:
            self._workers.pop(str(job_id), None)

    def _model_id(self):
        if self.model:
            return self.model
        response = requests.get(f'{self.base_url}/models', timeout=min(self.timeout, 5))
        response.raise_for_status()
        models = response.json().get('data') or []
        model_id = _clean((models[0] or {}).get('id'), 160) if models else ''
        if not model_id:
            raise RuntimeError('LM Studio is reachable, but no model is loaded')
        return model_id

    def _generate(self, job, body):
        source = job.get('source') or {}
        system = (
            'You are a local preparation worker for Mailmate. Produce analysis and drafts only. '
            'Never claim to send email, submit assignments, delete anything, or write to a calendar. '
            'Return valid JSON with keys summary, checklist, suggested_reply, and notes. '
            'checklist and notes must be short arrays of strings.'
        )
        user = (
            f"Job type: {job.get('kind')}\n"
            f"Gmail message ID: {source.get('gmail_message_id')}\n"
            f"Gmail thread ID: {source.get('gmail_thread_id')}\n"
            f"Subject: {source.get('subject')}\n"
            f"Sender: {source.get('sender')}\n\n"
            f"Message:\n{str(body or '')[:12000]}"
        )
        response = requests.post(
            f'{self.base_url}/chat/completions',
            timeout=self.timeout,
            headers={'Content-Type': 'application/json'},
            json={
                'model': self._model_id(),
                'temperature': 0.2,
                'messages': [
                    {'role': 'system', 'content': system},
                    {'role': 'user', 'content': user},
                ],
            },
        )
        response.raise_for_status()
        choices = response.json().get('choices') or []
        content = str(((choices[0] if choices else {}).get('message') or {}).get('content') or '').strip()
        parsed = self._parse_json(content)
        if not isinstance(parsed, dict):
            parsed = {'summary': content, 'checklist': [], 'suggested_reply': '', 'notes': []}
        return {
            'summary': _clean(parsed.get('summary'), 3000),
            'checklist': [_clean(item, 500) for item in (parsed.get('checklist') or [])[:10] if _clean(item, 500)],
            'suggested_reply': str(parsed.get('suggested_reply') or '').strip()[:5000],
            'notes': [_clean(item, 500) for item in (parsed.get('notes') or [])[:10] if _clean(item, 500)],
            'generated_by': self._model_id(),
            'read_only': True,
        }

    @staticmethod
    def _parse_json(content):
        clean = re.sub(r'^```(?:json)?\s*|\s*```$', '', str(content or '').strip(), flags=re.I)
        try:
            return json.loads(clean)
        except Exception:
            start, end = clean.find('{'), clean.rfind('}')
            if start >= 0 and end > start:
                try:
                    return json.loads(clean[start:end + 1])
                except Exception:
                    return None
            return None

    def health(self):
        try:
            model = self._model_id()
            return {**self.config(), 'reachable': True, 'model': model}
        except Exception as exc:
            return {**self.config(), 'reachable': False, 'error': _clean(exc, 300)}


local_work_service = LocalWorkService()
