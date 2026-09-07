import os
import json
from urllib.parse import urlencode, urlparse
from pathlib import Path
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import re
import threading
import time
import hashlib
from dateutil import parser as date_parser

from flask import Flask, request, jsonify, redirect, send_from_directory, session, abort
from flask_cors import CORS
from dotenv import load_dotenv

# Resolve everything relative to app.py, not the shell/Antigravity working directory.
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / 'data'
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Load environment before importing services; service modules may read env at import time.
load_dotenv(BASE_DIR / 'api.env')

# Localhost-only OAuth development flags. Keep these before google-auth-oauthlib is used.
os.environ['OAUTHLIB_INSECURE_TRANSPORT'] = '1'
os.environ['OAUTHLIB_RELAX_TOKEN_SCOPE'] = '1'

from services.google_service import get_auth_url, handle_callback, get_user_profile, get_gmail_threads, get_gmail_message_ids, get_gmail_message, mark_gmail_message_read, trash_gmail_message, get_gmail_permissions, GmailInsufficientPermissionError
from services.calendar_service import list_events as calendar_list_events, create_event as calendar_create_event, update_event as calendar_update_event, delete_event as calendar_delete_event, find_event as calendar_find_event, access_status as calendar_access_status, upsert_ai_deadline_event as calendar_upsert_ai_deadline
from services.ai_service import get_dashboard_overview, chat_with_kyle, generate_kyle_agent_reply
from services.work_agent_service import work_agent_service
from services.whisper_service import whisper_service
from services.privacy_gate import PrivacyGate
from services.system_context_service import system_context_service


# Kick off local Whisper model preparation in background
try:
    whisper_service.initialize()
except Exception as _w_err:
    print(f"[Whisper] Background init notice: {_w_err}")

app = Flask(__name__, static_folder=None)
app.secret_key = os.getenv('FLASK_SECRET_KEY', 'default-dev-secret-key-123')
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE='Lax'
)
CORS(app)

APP_TIMEZONE = os.getenv('APP_TIMEZONE', 'Asia/Kolkata')

def _load_app_timezone():
    try:
        return ZoneInfo(APP_TIMEZONE)
    except Exception as exc:
        if APP_TIMEZONE in {'Asia/Kolkata', 'Asia/Calcutta'}:
            print(f"[Calendar] timezone database unavailable ({exc}); using fixed IST UTC+05:30")
            return timezone(timedelta(hours=5, minutes=30), name='IST')
        return timezone.utc

APP_TZ = _load_app_timezone()
CACHE_SYNC_SECONDS = max(60, int(os.getenv('CACHE_SYNC_SECONDS', '300')))
CACHE_REPROCESS_SECONDS = max(CACHE_SYNC_SECONDS, int(os.getenv('CACHE_REPROCESS_SECONDS', '1800')))
AI_CALENDAR_SYNC_SECONDS = max(30, int(os.getenv('AI_CALENDAR_SYNC_SECONDS', '180')))
_ai_calendar_last_sync = {}
CALENDAR_DISMISSALS_FILE = DATA_DIR / 'calendar_dismissals.json'
_calendar_dismissal_lock = threading.Lock()


def _calendar_account_key(profile=None):
    profile = profile or {}
    return str(profile.get('email') or profile.get('id') or 'default').strip().lower()


def _read_calendar_dismissals():
    if not CALENDAR_DISMISSALS_FILE.exists():
        return {}
    try:
        data = json.loads(CALENDAR_DISMISSALS_FILE.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def _calendar_dismissed_markers(profile=None):
    account = _calendar_account_key(profile)
    with _calendar_dismissal_lock:
        data = _read_calendar_dismissals()
        values = data.get(account) or []
        return {str(value) for value in values if value}


def _remember_calendar_dismissal(profile, marker):
    marker = str(marker or '').strip()
    if not marker:
        return False
    account = _calendar_account_key(profile)
    with _calendar_dismissal_lock:
        data = _read_calendar_dismissals()
        values = {str(value) for value in (data.get(account) or []) if value}
        values.add(marker)
        data[account] = sorted(values)
        tmp = CALENDAR_DISMISSALS_FILE.with_suffix('.tmp')
        tmp.write_text(json.dumps(data, indent=2), encoding='utf-8')
        tmp.replace(CALENDAR_DISMISSALS_FILE)
    return True


def _attention_source_id(item):
    return str(
        (item or {}).get('source_message_id')
        or (item or {}).get('message_id')
        or (item or {}).get('email_id')
        or ''
    ).strip()


def _prune_payload_to_live_gmail(payload, live_ids):
    """Remove messages/tasks that no longer exist in active Gmail (e.g. moved to Trash)."""
    result = dict(payload or {})
    live_ids = {str(value) for value in (live_ids or set()) if value}
    before_emails = list(result.get('emails') or [])
    result['emails'] = [
        email for email in before_emails
        if str(email.get('id') or email.get('gmail_id') or '') in live_ids
    ]

    removed_ids = {
        str(email.get('id') or email.get('gmail_id') or '')
        for email in before_emails
        if str(email.get('id') or email.get('gmail_id') or '') not in live_ids
    }

    for key in ('needs_attention', 'waiting_on_others'):
        cleaned = []
        for item in result.get(key) or []:
            source_id = _attention_source_id(item)
            if source_id and source_id in removed_ids:
                continue
            cleaned.append(item)
        result[key] = cleaned

    metrics = dict(result.get('metrics') or {})
    metrics['emails'] = len(result['emails'])
    metrics['important'] = len(result.get('needs_attention') or [])
    metrics['actions'] = len(result.get('needs_attention') or [])
    result['metrics'] = metrics
    result['gmail_pruned_count'] = len(removed_ids)
    return result

@app.route('/')
def index():
    return send_from_directory(str(BASE_DIR), 'index.html')


@app.route('/dashboard.html')
def dashboard_page():
    return send_from_directory(str(BASE_DIR), 'dashboard.html')


@app.route('/assets/<path:filename>')
def serve_assets(filename):
    assets_dir = BASE_DIR / 'assets'
    if not (assets_dir / filename).is_file():
        abort(404)
    return send_from_directory(str(assets_dir), filename)


@app.route('/<path:filename>')
def serve_project_file(filename):
    # Serve real project files only. Never return index.html for missing
    # CSS/JS/image requests, because the browser will reject the wrong MIME type.
    candidate = (BASE_DIR / filename).resolve()
    try:
        candidate.relative_to(BASE_DIR)
    except ValueError:
        abort(404)

    if candidate.is_file():
        return send_from_directory(str(BASE_DIR), filename)

    abort(404)

@app.route('/api/health')
def health():
    return jsonify({
        "ok": True,
        "googleClientConfigured": bool(os.getenv('GOOGLE_CLIENT_ID')),
        "supabaseConfigured": False,
        "supabase": {"enabled": False, "configured": False, "ready": False, "mode": "disabled"},
        "privacyGate": {"enabled": True, "mode": "deterministic-local", "centralRetention": "disabled"},
        "cachePolicy": {"syncCheckSeconds": CACHE_SYNC_SECONDS, "reprocessSeconds": CACHE_REPROCESS_SECONDS},
        "elevenLabsConfigured": bool(os.getenv('ELEVENLABS_API_KEY')),
        "calendar": calendar_access_status(),
        "calendarReadWrite": calendar_access_status().get("writable", False),
        "gmailWrite": get_gmail_permissions().get("can_write", False),
        "gmailPermissions": get_gmail_permissions(),
        "appTimezone": APP_TIMEZONE,
        "voiceInput": "browser-speech-recognition",
        "staticFiles": {
            "index.html": (BASE_DIR / "index.html").is_file(),
            "styles.css": (BASE_DIR / "styles.css").is_file(),
            "script.js": (BASE_DIR / "script.js").is_file(),
            "dashboard.html": (BASE_DIR / "dashboard.html").is_file(),
            "dashboard.css": (BASE_DIR / "dashboard.css").is_file(),
            "dashboard.js": (BASE_DIR / "dashboard.js").is_file(),
            "cs_logo.png": (BASE_DIR / "assets" / "images" / "cs_logo.png").is_file(),
            "logo.svg": (BASE_DIR / "assets" / "images" / "logo.svg").is_file()
        },
        "projectRoot": str(BASE_DIR),
        "message": "Flask Backend Running!"
    })

@app.route('/api/config')
def config():
    return jsonify({
        "googleClientId": os.getenv('GOOGLE_CLIENT_ID', ''),
        "backendAuthUrl": "/auth/google"
    })

def _oauth_origin():
    redirect_uri = os.getenv('GOOGLE_REDIRECT_URI', 'http://localhost:5000/auth/google/callback')
    parsed = urlparse(redirect_uri)
    return f"{parsed.scheme or 'http'}://{parsed.netloc or 'localhost:5000'}"


@app.before_request
def keep_oauth_on_one_host():
    # Flask session cookies are host-scoped. If auth starts on 127.0.0.1 but
    # Google redirects to localhost, OAuth state / PKCE verifier are lost.
    if request.path.startswith('/auth/google'):
        target_origin = _oauth_origin()
        target = urlparse(target_origin)
        if target.netloc and request.host != target.netloc:
            query = f"?{request.query_string.decode()}" if request.query_string else ''
            return redirect(f"{target_origin}{request.path}{query}")


@app.route('/auth/google')
def auth_google():
    auth_url, state, code_verifier = get_auth_url()
    session['oauth_state'] = state
    if code_verifier:
        session['code_verifier'] = code_verifier
    return redirect(auth_url)

@app.route('/auth/google/callback')
def auth_google_callback():
    state = session.get('oauth_state')
    code_verifier = session.get('code_verifier')

    if not state:
        return (
            'OAuth session state is missing. Open http://localhost:5000 and sign in again.',
            400,
        )

    try:
        handle_callback(request.url, state=state, code_verifier=code_verifier)
        profile = get_user_profile() or {}
    except Exception as exc:
        app.logger.exception('Google OAuth callback failed')
        return jsonify({
            'error': 'Google OAuth callback failed',
            'detail': str(exc),
            'hasState': bool(state),
            'hasCodeVerifier': bool(code_verifier),
            'callbackHost': request.host,
            'expectedOrigin': _oauth_origin(),
        }), 500
    finally:
        session.pop('oauth_state', None)
        session.pop('code_verifier', None)

    user_id = profile.get('id') or profile.get('sub') or profile.get('email') or ''
    params = {
        'connected': 'true',
        'userId': user_id,
        'name': profile.get('name', ''),
        'picture': profile.get('picture', ''),
    }
    return redirect('/dashboard.html?' + urlencode(params))

@app.route('/api/user/profile')
def user_profile():
    profile = get_user_profile()
    if profile: return jsonify(profile)
    return jsonify({"error": "Not authenticated"}), 401


@app.route('/api/auth/logout', methods=['POST'])
def auth_logout():
    session.clear()
    credential_file = DATA_DIR / 'google_credentials.json'
    try:
        if credential_file.exists():
            credential_file.unlink()
    except Exception as exc:
        app.logger.warning('Could not delete local Google credentials: %s', exc)
    return jsonify({"ok": True, "redirect": "/"})


def _utc_now():
    return datetime.now(timezone.utc)


def _parse_utc(value):
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


def _deadline_target(item):
    raw = str((item or {}).get('deadline') or '').strip()
    if not raw:
        return None, False

    now = datetime.now(APP_TZ)
    lower = raw.lower()

    within = re.search(r'within\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)', lower)
    if within:
        amount = int(within.group(1))
        minutes = amount * 60 if within.group(2).startswith(('hour', 'hr')) else amount
        return now + timedelta(minutes=minutes), True

    if 'tomorrow' in lower:
        target = (now + timedelta(days=1)).replace(hour=23, minute=59, second=0, microsecond=0)
        clock = _parse_clock(raw)
        if clock:
            target = target.replace(hour=clock[0], minute=clock[1])
            return target, True
        return target, False

    if 'today' in lower or 'tonight' in lower:
        target = now.replace(hour=23, minute=59, second=0, microsecond=0)
        clock = _parse_clock(raw)
        if clock:
            target = target.replace(hour=clock[0], minute=clock[1])
            return target, True
        return target, False

    try:
        parsed = date_parser.parse(raw, fuzzy=True, default=now)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=APP_TZ)
        else:
            parsed = parsed.astimezone(APP_TZ)
        has_time = bool(re.search(r'\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b\d{1,2}:\d{2}\b', lower))
        return parsed, has_time
    except Exception:
        return None, False


def _deadline_urgency(target):
    if not target:
        return 'normal'
    remaining = (target - datetime.now(APP_TZ)).total_seconds()
    if remaining <= 6 * 3600:
        return 'critical'
    if remaining <= 24 * 3600:
        return 'urgent'
    return 'normal'


def _deadline_marker(item):
    stable = (
        (item or {}).get('source_message_id')
        or (item or {}).get('message_id')
        or (item or {}).get('email_id')
    )
    if stable:
        return f"gmail-{stable}"
    raw = '|'.join([
        str((item or {}).get('subject') or ''),
        str((item or {}).get('title') or ''),
        str((item or {}).get('description') or (item or {}).get('reason') or ''),
        str((item or {}).get('deadline') or ''),
    ])
    return 'derived-' + hashlib.sha256(raw.encode('utf-8')).hexdigest()[:24]


def _deadline_title(item):
    title = (
        (item or {}).get('subject')
        or (item or {}).get('title')
        or _short_task_description(item)
        or 'Email deadline'
    )
    title = re.sub(r'\s+', ' ', str(title)).strip()
    if len(title) > 72:
        title = title[:69].rstrip() + '...'
    return title


def _source_email_for_attention(item, payload):
    source_id = str(
        (item or {}).get('source_message_id')
        or (item or {}).get('message_id')
        or (item or {}).get('email_id')
        or ''
    ).strip()
    if not source_id:
        return None
    for email in (payload or {}).get('emails') or []:
        ids = {
            str(email.get('id') or ''),
            str(email.get('gmail_id') or ''),
        }
        if source_id in ids:
            return email
    return None


def _calendar_write_decision(item, payload, profile=None):
    """Deterministic boundary for automatic email-derived Calendar writes."""
    source = _source_email_for_attention(item, payload)
    if not source:
        return False, 'ambiguous_source'

    direction = str(source.get('direction') or '').strip().lower()
    if direction == 'outbound' or 'SENT' in (source.get('labels') or []):
        return False, 'outbound_email'
    if direction != 'inbound':
        return False, 'ambiguous_direction'

    owner = str((item or {}).get('owner') or '').strip().lower()
    current_email = str((profile or {}).get('email') or '').strip().lower()
    current_names = {
        'me', 'myself', 'current_user', 'current user', 'user',
        current_email,
        str((profile or {}).get('name') or '').strip().lower(),
    }
    current_names.discard('')
    if owner not in current_names:
        return False, 'not_assigned_to_current_user' if owner else 'ambiguous_owner'

    return True, 'inbound_assigned_to_current_user'


def _reconcile_ai_calendar(payload, profile=None, force=False):
    """
    Persist high-confidence email deadlines into the currently connected
    Google Calendar. Managed markers make this safe to run repeatedly.
    """
    status = calendar_access_status()
    if not status.get('authenticated') or status.get('writable') is False:
        return {"created_or_updated": 0, "skipped": 0, "enabled": False}

    account_key = str((profile or {}).get('email') or (profile or {}).get('id') or 'default')
    now_ts = time.time()
    if not force and now_ts - _ai_calendar_last_sync.get(account_key, 0) < AI_CALENDAR_SYNC_SECONDS:
        return {"created_or_updated": 0, "skipped": 0, "enabled": True, "throttled": True}

    _ai_calendar_last_sync[account_key] = now_ts
    changed = 0
    skipped = 0
    skip_reasons = {}

    for item in (payload or {}).get('needs_attention') or []:
        if not item.get('deadline'):
            continue

        may_write, policy_reason = _calendar_write_decision(item, payload, profile=profile)
        item['calendar_write'] = {'allowed': may_write, 'reason': policy_reason}
        if not may_write:
            skipped += 1
            skip_reasons[policy_reason] = skip_reasons.get(policy_reason, 0) + 1
            continue

        target, has_time = _deadline_target(item)
        if not target:
            skipped += 1
            continue

        urgency = _deadline_urgency(target)
        marker = _deadline_marker(item)
        if marker in _calendar_dismissed_markers(profile):
            skipped += 1
            skip_reasons['user_deleted'] = skip_reasons.get('user_deleted', 0) + 1
            continue
        description = str(
            item.get('description')
            or item.get('reason')
            or 'Automatically created from an email deadline by Mailmate.'
        ).strip()

        if has_time:
            # A deadline is represented as a short block ending at the due time.
            start = target - timedelta(minutes=30)
            end = target
            event_payload = {
                "title": _deadline_title(item),
                "description": description + "\n\nCreated automatically by Mailmate from Gmail.",
                "start": start.isoformat(),
                "end": end.isoformat(),
                "all_day": False,
                "urgency": urgency,
            }
        else:
            event_payload = {
                "title": _deadline_title(item),
                "description": description + "\n\nCreated automatically by Mailmate from Gmail.",
                "start": target.date().isoformat(),
                "end": (target.date() + timedelta(days=1)).isoformat(),
                "all_day": True,
                "urgency": urgency,
            }

        try:
            calendar_upsert_ai_deadline(marker, event_payload)
            changed += 1
        except Exception as exc:
            app.logger.warning('AI calendar reconcile skipped %s: %s', marker, exc)
            skipped += 1

    return {
        "created_or_updated": changed,
        "skipped": skipped,
        "skip_reasons": skip_reasons,
        "enabled": True,
    }


def _build_live_dashboard(profile, force_ai=False):
    threads, emails = get_gmail_threads()
    if not threads:
        raise RuntimeError('No Gmail threads are available')

    # Two-Plane Architecture: Annotate all emails with Privacy Gate for Display Plane
    for email in emails:
        email['privacy_gate'] = PrivacyGate.evaluate(email)

    ai_shielded = sum(1 for e in emails if not e.get('privacy_gate', {}).get('ai_allowed', True))
    work_active = sum(1 for e in emails if e.get('privacy_gate', {}).get('work_agent_allowed', False))
    privacy_summary = {
        "display_plane_total": len(emails),
        "ai_allowed_count": len(emails) - ai_shielded,
        "ai_shielded_count": ai_shielded,
        "work_active_count": work_active,
        "central_retention": "disabled (browser-ram-only)"
    }

    # Central mailbox retention is PROHIBITED (Gmail -> database = prohibited).
    # Raw emails remain transient in browser RAM only.
    overview = get_dashboard_overview(threads)
    overview['emails'] = emails
    overview['privacy_summary'] = privacy_summary
    overview['user'] = profile
    overview['user_id'] = profile.get('email') or profile.get('id') or ''
    overview['cached'] = False
    overview['source_changed'] = True
    overview['calendar_dismissed_markers'] = sorted(_calendar_dismissed_markers(profile))
    overview['ai_calendar_sync'] = _reconcile_ai_calendar(overview, profile=profile, force=True)

    return overview


@app.route('/api/dashboard/overview')
def dashboard_overview():
    try:
        profile = get_user_profile()
        if not profile:
            return jsonify({"error": "Not authenticated"}), 401

        force = str(request.args.get('refresh', '')).lower() in {'1', 'true', 'yes'}
        live_payload = _build_live_dashboard(profile, force_ai=force)
        user_id = profile.get('email') or profile.get('id')
        try:
            threading.Thread(target=work_agent_service.sync_and_enqueue, args=(user_id, live_payload), daemon=True).start()
        except Exception as sync_exc:
            app.logger.debug('Work agent sync skipped: %s', sync_exc)
        return jsonify(live_payload)
    except Exception as exc:
        app.logger.exception('Dashboard processing failed')
        return jsonify({"error": str(exc)}), 500


@app.route('/api/work/jobs', methods=['GET'])
def list_work_jobs():
    profile = get_user_profile()
    if not profile:
        return jsonify({"error": "Not authenticated"}), 401
    user_id = profile.get('email') or profile.get('id')
    jobs = work_agent_service.list_jobs(user_id)
    return jsonify(jobs)


@app.route('/api/work/jobs/<job_id>', methods=['GET'])
def get_work_job(job_id):
    profile = get_user_profile()
    if not profile:
        return jsonify({"error": "Not authenticated"}), 401
    user_id = profile.get('email') or profile.get('id')
    job = work_agent_service.get_job(job_id, user_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


@app.route('/api/work/jobs/<job_id>/run', methods=['POST'])
def run_work_job(job_id):
    profile = get_user_profile()
    if not profile:
        return jsonify({"error": "Not authenticated"}), 401
    user_id = profile.get('email') or profile.get('id')
    job = work_agent_service.run_job(job_id, user_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


@app.route('/api/work/jobs/<job_id>/cancel', methods=['POST'])
def cancel_work_job(job_id):
    profile = get_user_profile()
    if not profile:
        return jsonify({"error": "Not authenticated"}), 401
    user_id = profile.get('email') or profile.get('id')
    job = work_agent_service.cancel_job(job_id, user_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify(job)


@app.route('/api/work/jobs/<job_id>/approve', methods=['POST'])
def approve_work_job(job_id):
    profile = get_user_profile()
    if not profile:
        return jsonify({"error": "Not authenticated"}), 401
    user_id = profile.get('email') or profile.get('id')
    data = request.get_json(silent=True) or {}
    edited_reply = data.get('reply')
    try:
        job = work_agent_service.approve_job(job_id, user_id, edited_reply=edited_reply)
        return jsonify({"ok": True, "job": job})
    except GmailInsufficientPermissionError as exc:
        app.logger.warning("Gmail approval permission error: %s", exc)
        return jsonify({
            "ok": False,
            "error": "Google account needs reconnection to grant Gmail draft & send permissions (gmail.modify).",
            "code": "insufficient_scopes",
            "reconnect_url": "/auth/google"
        }), 403
    except Exception as e:
        app.logger.exception("Job approval failed")
        err_str = str(e).lower()
        if "insufficient" in err_str or "permission" in err_str or "403" in err_str:
            return jsonify({
                "ok": False,
                "error": "Google account needs reconnection to grant Gmail draft & send permissions (gmail.modify).",
                "code": "insufficient_scopes",
                "reconnect_url": "/auth/google"
            }), 403
        return jsonify({"error": str(e)}), 500


@app.route('/api/work/settings', methods=['GET', 'POST'])
def work_settings():
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        settings = work_agent_service.update_settings(data)
        return jsonify({"ok": True, "settings": settings})
    return jsonify(work_agent_service.get_settings())


@app.route('/api/work/jobs/<job_id>/cancel-countdown', methods=['POST'])
def cancel_work_countdown(job_id):
    profile = get_user_profile()
    if not profile:
        return jsonify({"error": "Not authenticated"}), 401
    user_id = profile.get('email') or profile.get('id')
    job = work_agent_service.cancel_countdown(job_id, user_id)
    if not job:
        return jsonify({"error": "Job not found"}), 404
    return jsonify({"ok": True, "job": job})


@app.route('/api/work/jobs/<job_id>/save-draft', methods=['POST'])
def save_work_draft(job_id):
    profile = get_user_profile()
    if not profile:
        return jsonify({"error": "Not authenticated"}), 401
    user_id = profile.get('email') or profile.get('id')
    data = request.get_json(silent=True) or {}
    edited_reply = data.get('reply', '')
    try:
        job = work_agent_service.save_draft(job_id, user_id, edited_reply)
        if not job:
            return jsonify({"error": "Job not found"}), 404
        return jsonify({"ok": True, "job": job})
    except GmailInsufficientPermissionError as exc:
        app.logger.warning("Gmail save-draft permission error: %s", exc)
        return jsonify({
            "ok": False,
            "error": "Google account needs reconnection to grant Gmail draft & send permissions (gmail.modify).",
            "code": "insufficient_scopes",
            "reconnect_url": "/auth/google"
        }), 403
    except Exception as e:
        app.logger.exception("Save draft failed")
        err_str = str(e).lower()
        if "insufficient" in err_str or "permission" in err_str or "403" in err_str:
            return jsonify({
                "ok": False,
                "error": "Google account needs reconnection to grant Gmail draft & send permissions (gmail.modify).",
                "code": "insufficient_scopes",
                "reconnect_url": "/auth/google"
            }), 403
        return jsonify({"error": str(e)}), 500




@app.route('/api/work/jobs/<job_id>/artifacts/<filename>', methods=['GET'])
def get_work_artifact(job_id, filename):
    profile = get_user_profile()
    if not profile:
        return jsonify({"error": "Not authenticated"}), 401
    job_dir = BASE_DIR / 'workspaces' / job_id
    artifact_path = job_dir / filename
    if not artifact_path.is_file():
        abort(404)
    return send_from_directory(str(job_dir), filename)


@app.route('/api/system/context', methods=['GET'])
def system_context_endpoint():
    profile = get_user_profile()
    if not profile:
        return jsonify({"error": "Not authenticated"}), 401
    user_id = profile.get('email') or profile.get('id') or 'default'
    force_reconcile = str(request.args.get('reconcile', 'true')).lower() in {'1', 'true', 'yes'}
    ctx = system_context_service.build(user_id=user_id, force_reconcile=force_reconcile)
    return jsonify(ctx)


@app.route('/api/work/reconcile', methods=['POST'])
def work_reconcile_endpoint():
    profile = get_user_profile()
    if not profile:
        return jsonify({"error": "Not authenticated"}), 401
    user_id = profile.get('email') or profile.get('id') or 'default'
    reconciled = work_agent_service.reconcile_jobs_with_gmail(user_id)
    jobs = work_agent_service.list_jobs(user_id, reconcile=False)
    system_context_service.increment_version()
    return jsonify({
        "ok": True,
        "reconciled": reconciled,
        "reconciled_count": len(reconciled),
        "jobs": jobs,
        "context_version": system_context_service.get_version()
    })


@app.route('/api/stt/status', methods=['GET'])
def stt_status():
    return jsonify(whisper_service.get_status())


@app.route('/api/stt/init', methods=['POST'])
def stt_init():
    whisper_service.initialize()
    return jsonify({"message": "Whisper initialization started", "status": whisper_service.get_status()})


@app.route('/api/stt/transcribe', methods=['POST'])
def stt_transcribe():
    file = request.files.get('audio') or request.files.get('file')
    if not file or file.filename == '':
        return jsonify({"error": "No audio file provided"}), 400

    import tempfile
    suffix = Path(file.filename).suffix or '.webm'
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        file.save(tmp.name)
        tmp_path = tmp.name

    try:
        result = whisper_service.transcribe(tmp_path)
        return jsonify(result)
    except Exception as e:
        if str(e) == "whisper_model_loading":
            return jsonify({"error": "Whisper model is still loading"}), 503
        app.logger.warning(f"Whisper transcription failed: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        try:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass


@app.route('/api/cache/status')
def cache_status():
    profile = get_user_profile()
    if not profile:
        return jsonify({"authenticated": False, "supabase": {"enabled": False, "configured": False, "ready": False}}), 401

    return jsonify({
        "authenticated": True,
        "supabase": {"enabled": False, "configured": False, "ready": False, "mode": "disabled"},
        "cache": {
            "available": False,
            "mode": "live-gmail",
            "retention": "transient-browser-ram-only",
        },
        "policy": {
            "sync_check_seconds": CACHE_SYNC_SECONDS,
            "reprocess_seconds": CACHE_REPROCESS_SECONDS,
        }
    })


@app.route('/api/gmail/messages/<message_id>', methods=['DELETE'])
def gmail_message_delete(message_id):
    profile = get_user_profile()
    if not profile:
        return jsonify({'error': 'Not authenticated'}), 401
    try:
        result = trash_gmail_message(message_id)
        return jsonify(result)
    except Exception as exc:
        app.logger.exception('Gmail trash failed')
        detail = str(exc)
        status = 403 if ('insufficient' in detail.lower() or 'permission' in detail.lower() or 'scope' in detail.lower()) else 500
        return jsonify({
            'error': detail,
            'hint': 'Reconnect Google once so Mailmate can receive the gmail.modify scope.' if status == 403 else None,
        }), status


@app.route('/api/gmail/messages/<message_id>', methods=['GET'])
def gmail_message_detail(message_id):
    if not get_user_profile():
        return jsonify({'error': 'Not authenticated'}), 401
    try:
        return jsonify(get_gmail_message(message_id))
    except Exception as exc:
        app.logger.exception('Gmail message fetch failed')
        return jsonify({'error': str(exc)}), 500


@app.route('/api/gmail/messages/<message_id>/read', methods=['POST'])
def gmail_message_read(message_id):
    if not get_user_profile():
        return jsonify({'error': 'Not authenticated'}), 401
    try:
        return jsonify(mark_gmail_message_read(message_id))
    except Exception as exc:
        app.logger.exception('Gmail mark-read failed')
        detail = str(exc)
        status = 403 if ('insufficient' in detail.lower() or 'permission' in detail.lower() or 'scope' in detail.lower()) else 500
        return jsonify({
            'error': detail,
            'hint': 'Reconnect Google once so Mailmate can receive the gmail.modify scope.' if status == 403 else None,
        }), status


@app.route('/api/calendar/ai-sync', methods=['POST'])
def calendar_ai_sync():
    profile = get_user_profile()
    if not profile:
        return jsonify({"error": "Not authenticated"}), 401

    threads, emails = get_gmail_threads()
    if not threads:
        return jsonify({"ok": True, "created_or_updated": 0, "reason": "No Gmail threads"})

    overview = get_dashboard_overview(threads)
    result = _reconcile_ai_calendar(overview, profile=profile, force=True)
    return jsonify({"ok": True, **result})


@app.route('/api/calendar/events', methods=['GET', 'POST'])
def calendar_events():
    try:
        if request.method == 'POST':
            payload = request.get_json(silent=True) or {}
            return jsonify(calendar_create_event(payload)), 201

        events = calendar_list_events(
            start=request.args.get('start'),
            end=request.args.get('end'),
            limit=request.args.get('limit', 250),
        )
        return jsonify(events)
    except Exception as exc:
        app.logger.exception('Calendar request failed')
        return jsonify({"error": str(exc)}), 500


@app.route('/api/calendar/events/<event_id>', methods=['PATCH', 'DELETE'])
def calendar_event_detail(event_id):
    try:
        if request.method == 'DELETE':
            result = calendar_delete_event(event_id)
            marker = str((result or {}).get('marker') or '').strip()
            if marker:
                profile = get_user_profile() or {}
                _remember_calendar_dismissal(profile, marker)
                result['dismissed_marker'] = marker
            return jsonify(result)
        payload = request.get_json(silent=True) or {}
        return jsonify(calendar_update_event(event_id, payload))
    except Exception as exc:
        app.logger.exception('Calendar mutation failed')
        return jsonify({"error": str(exc)}), 500


@app.route('/api/calendar/sync')
def calendar_sync():
    """Small endpoint used by the frontend/Kyle to force a current read."""
    try:
        return jsonify({
            "events": calendar_list_events(
                start=request.args.get('start'),
                end=request.args.get('end'),
                limit=request.args.get('limit', 250),
            ),
            "synced_at": datetime.now(APP_TZ).isoformat(),
            "timezone": APP_TIMEZONE,
        })
    except Exception as exc:
        return jsonify({"error": str(exc)}), 500

def _day_window_from_text(text):
    now = datetime.now(APP_TZ)
    lower = (text or '').lower()
    if 'tomorrow' in lower:
        day = now + timedelta(days=1)
    elif 'today' in lower or 'tonight' in lower:
        day = now
    else:
        weekdays = {
            'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3,
            'friday': 4, 'saturday': 5, 'sunday': 6,
        }
        target = next((n for name, n in weekdays.items() if name in lower), None)
        if target is None:
            day = now
        else:
            delta = (target - now.weekday()) % 7
            if delta == 0 and 'next ' in lower:
                delta = 7
            day = now + timedelta(days=delta)

    start = day.replace(hour=0, minute=0, second=0, microsecond=0)
    end = day.replace(hour=23, minute=59, second=59, microsecond=0)
    return start, end


def _parse_clock(text):
    lower = (text or '').lower()
    m = re.search(r'\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b', lower)
    if m:
        hour = int(m.group(1))
        minute = int(m.group(2) or 0)
        if hour == 12:
            hour = 0
        if m.group(3) == 'pm':
            hour += 12
        return hour, minute

    m = re.search(r'\bat\s+([01]?\d|2[0-3]):([0-5]\d)\b', lower)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None


def _extract_event_title(text):
    raw = (text or '').strip()
    called = re.search(r'\bcalled\s+(.+?)(?:\s+(?:today|tomorrow|on\s+\w+|at\s+\d)|$)', raw, re.I)
    if called:
        return called.group(1).strip(' .')

    # "schedule C2C test tomorrow at 5 pm"
    m = re.search(
        r'\b(?:add|create|schedule|book)\s+(?:an?\s+)?(?:event\s+)?(.+?)(?=\s+(?:today|tomorrow|on\s+\w+|at\s+\d)|$)',
        raw,
        re.I,
    )
    if m:
        title = m.group(1).strip(' .')
        title = re.sub(r'^(?:for\s+)?', '', title).strip()
        if title:
            return title
    return 'New event'


def _natural_event_payload(text):
    day_start, _ = _day_window_from_text(text)
    clock = _parse_clock(text)
    if not clock:
        return None

    hour, minute = clock
    start = day_start.replace(hour=hour, minute=minute)
    duration = 60
    dm = re.search(r'\bfor\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)\b', text or '', re.I)
    if dm:
        amount = int(dm.group(1))
        duration = amount * 60 if dm.group(2).lower().startswith(('hour', 'hr')) else amount

    return {
        "title": _extract_event_title(text),
        "start": start.isoformat(),
        "end": (start + timedelta(minutes=max(15, duration))).isoformat(),
        "description": "Created by Kyle from Agent Harness.",
    }


def _event_brief_item(event):
    start = event.get('start') or ''
    label = start
    try:
        if 'T' in start:
            dt = datetime.fromisoformat(start.replace('Z', '+00:00')).astimezone(APP_TZ)
            label = dt.strftime('%a %d %b · %-I:%M %p') if os.name != 'nt' else dt.strftime('%a %d %b · %#I:%M %p')
        elif start:
            dt = datetime.fromisoformat(start[:10])
            label = dt.strftime('%a %d %b · all day')
    except Exception:
        pass
    return {
        "title": event.get('title') or 'Event',
        "meta": label,
        "conflict": bool(event.get('conflict')),
        "id": event.get('id'),
    }


def _short_task_description(item):
    text = str(item.get('description') or item.get('reason') or item.get('subject') or 'your highest-priority task').strip()
    text = re.sub(r'\s+', ' ', text)
    return text[:120].rstrip(' ,.;')


def _kyle_fast_path(message, context, selected_event_id=None):
    lower = (message or '').lower().strip()

    if re.search(r'\b(open|show)\s+(my\s+)?calendar\b', lower) and not re.search(r'\b(today|tomorrow|week|schedule|what|events?)\b', lower):
        return {
            "reply": "Calendar opened.",
            "voice": "Calendar opened.",
            "command": {"type": "open_page", "page": "calendar"},
            "handled": True,
        }

    if re.search(r'\b(drafts?|pending drafts?|waiting for review|waiting approval|prepared work|what have you prepared|any drafts)\b', lower):
        work_section = (context or {}).get('work') or {}
        waiting = work_section.get('waiting_approval') or []
        active = work_section.get('active') or []
        if not waiting and not active:
            return {
                "reply": "There are no drafts waiting for your review right now. (Any thread you replied to in Gmail has been marked resolved.)",
                "voice": "No drafts are waiting for your review. You are all caught up.",
                "command": {"type": "open_page", "page": "work"},
                "handled": True,
            }
        elif waiting:
            first = waiting[0]
            subj = (first.get('source') or {}).get('subject') or first.get('clean_title') or first.get('title') or 'Email'
            plural = "s" if len(waiting) != 1 else ""
            return {
                "reply": f"You have {len(waiting)} draft{plural} ready for review, including '{subj}'.",
                "voice": f"You have {len(waiting)} draft ready for review. First is {subj}.",
                "command": {"type": "open_page", "page": "work"},
                "handled": True,
            }

    if re.search(r'\b(clash(es)?|conflicts?|overlapping|overlap)\b', lower) and not re.search(r'\b(add|create|delete|remove)\b', lower):
        cal_section = (context or {}).get('calendar') or {}
        conflict_count = cal_section.get('conflict_count', 0)
        if conflict_count == 0:
            return {
                "reply": "No schedule clashes detected. Your calendar has no overlapping commitments.",
                "voice": "No schedule clashes detected. Your calendar is clear of overlaps.",
                "command": {"type": "open_page", "page": "calendar"},
                "handled": True,
            }
        else:
            plural = "es" if conflict_count != 1 else ""
            return {
                "reply": f"You have {conflict_count} schedule clash{plural} this week.",
                "voice": f"You have {conflict_count} schedule clash{plural} this week.",
                "command": {"type": "open_page", "page": "calendar"},
                "handled": True,
            }

    # Calendar reads should never spend a Gemini token.
    if (
        ('calendar' in lower or 'schedule' in lower)
        and re.search(r'\b(what|show|list|have|on|free|busy|today|tomorrow|week)\b', lower)
        and not re.search(r'\b(add|create|schedule\s+an?\s+event|book|move|change|delete|remove)\b', lower)
    ):
        if 'week' in lower:
            start, _ = _day_window_from_text('today')
            start = start - timedelta(days=start.weekday())
            end = start + timedelta(days=7) - timedelta(seconds=1)
        else:
            start, end = _day_window_from_text(lower)
        events = calendar_list_events(start=start.isoformat(), end=end.isoformat(), limit=100)
        items = [_event_brief_item(e) for e in events[:8]]
        conflicts = sum(1 for e in events if e.get('conflict'))

        deadline_items = []
        task_source = (context or {}).get('mail', {}).get('needs_attention') or (context or {}).get('needs_attention') or []
        for task in task_source:
            deadline = str(task.get('deadline') or '').lower()
            if not deadline:
                continue
            relevant = True
            if 'tomorrow' in lower:
                relevant = 'tomorrow' in deadline
            elif 'today' in lower or 'tonight' in lower:
                relevant = ('today' in deadline or 'tonight' in deadline or 'within' in deadline)
            if relevant:
                deadline_items.append({
                    "title": task.get('subject') or task.get('title') or 'Email deadline',
                    "meta": _short_task_description(task),
                    "conflict": False,
                })

        items = (deadline_items + items)[:8]
        total = len(events) + len(deadline_items)
        if total == 0:
            voice = "Your calendar and deadlines are clear."
            reply = "No calendar events or email deadlines in that window."
        elif deadline_items and not events:
            voice = f"No meetings, but you have {len(deadline_items)} deadline{'s' if len(deadline_items) != 1 else ''}."
            reply = f"{len(deadline_items)} email deadline{'s' if len(deadline_items) != 1 else ''} need attention."
        else:
            first = events[0]
            voice = f"You have {len(events)} calendar event{'s' if len(events) != 1 else ''}"
            if deadline_items:
                voice += f" and {len(deadline_items)} deadline{'s' if len(deadline_items) != 1 else ''}"
            voice += f". First: {first.get('title', 'event')}."
            if conflicts:
                voice += f" {conflicts} clash{'es' if conflicts != 1 else ''}."
            reply = f"{total} scheduled item{'s' if total != 1 else ''} found."
        return {
            "reply": reply,
            "voice": voice,
            "brief": {"title": "Calendar", "items": items},
            "command": {"type": "open_page", "page": "calendar"},
            "handled": True,
        }

    # Deterministic creation for common voice commands: no Gemini call.
    if re.search(r'\b(add|create|schedule|book)\b', lower) and ('event' in lower or 'calendar' in lower or _parse_clock(lower)):
        payload = _natural_event_payload(message)
        if payload:
            event = calendar_create_event(payload)
            item = _event_brief_item(event)
            return {
                "reply": f"Added {event.get('title')} to Google Calendar.",
                "voice": f"Done. {event.get('title')} is on your calendar.",
                "brief": {"title": "Added to calendar", "items": [item]},
                "command": {"type": "calendar_refresh"},
                "handled": True,
            }

    # Selected-event mutations.
    if selected_event_id and re.search(r'\b(delete|remove|cancel)\b', lower):
        delete_result = calendar_delete_event(selected_event_id)
        marker = str((delete_result or {}).get('marker') or '').strip()
        if marker:
            try:
                _remember_calendar_dismissal(get_user_profile() or {}, marker)
            except Exception as dismissal_exc:
                app.logger.warning('Could not persist AI deadline dismissal: %s', dismissal_exc)
        return {
            "reply": "Deleted the selected Google Calendar event.",
            "voice": "Done. I deleted it.",
            "command": {"type": "calendar_refresh"},
            "handled": True,
        }

    if selected_event_id and re.search(r'\b(move|change|reschedule)\b', lower):
        clock = _parse_clock(lower)
        if clock:
            start_day, _ = _day_window_from_text(lower)
            hour, minute = clock
            new_start = start_day.replace(hour=hour, minute=minute)
            # Keep the default mutation small; the UI can edit exact duration.
            event = calendar_update_event(selected_event_id, {
                "start": new_start.isoformat(),
                "end": (new_start + timedelta(hours=1)).isoformat(),
            })
            return {
                "reply": f"Moved {event.get('title')} on Google Calendar.",
                "voice": "Done. I moved it.",
                "brief": {"title": "Calendar updated", "items": [_event_brief_item(event)]},
                "command": {"type": "calendar_refresh"},
                "handled": True,
            }

    # "What should I work on?" is primarily local context, not an LLM problem.
    if re.search(r'\b(what should i (work on|do)|what do i (work on|do)|what(?:\'s| is) next|priority)\b', lower):
        attention = list((context or {}).get('needs_attention') or [])
        start, end = _day_window_from_text('today')
        try:
            events = calendar_list_events(start=start.isoformat(), end=end.isoformat(), limit=50)
        except Exception:
            events = []

        items = []
        if attention:
            top = attention[0]
            task = _short_task_description(top)
            items.append({
                "title": top.get('subject') or 'Do this first',
                "meta": task,
                "conflict": False,
            })
            voice = f"Do this first: {task}."
        elif events:
            first = events[0]
            items.append(_event_brief_item(first))
            voice = f"Your next commitment is {first.get('title', 'an event')}."
        else:
            voice = "Nothing urgent is blocking you. Pick one focused task."

        for event in events[:3]:
            items.append(_event_brief_item(event))

        return {
            "reply": voice,
            "voice": voice[:220],
            "brief": {"title": "What to focus on", "items": items[:5]},
            "handled": True,
        }

    return None


def _compact_context(context):
    context = context or {}
    tasks = []
    task_items = (
        (context.get('mail') or {}).get('needs_attention')
        or context.get('needs_attention')
        or []
    )
    for item in task_items[:3]:
        tasks.append({
            "task": _short_task_description(item),
            "deadline": item.get('deadline'),
        })

    calendar_events = []
    cal_items = (
        (context.get('calendar') or {}).get('events')
        or context.get('calendarEvents')
        or []
    )
    for event in cal_items[:5]:
        calendar_events.append({
            "title": event.get('title'),
            "start": event.get('start'),
            "conflict": event.get('conflict'),
        })

    work_items = []
    jobs = (
        (context.get('work') or {}).get('all')
        or context.get('workJobs')
    )
    if jobs is None:
        user_id = context.get('user_id') or 'default'
        try:
            jobs = work_agent_service.list_jobs(user_id)
        except Exception:
            jobs = []

    for job in (jobs or [])[:4]:
        work_items.append({
            "id": job.get('id'),
            "title": job.get('title'),
            "status": job.get('status'),
            "sender": (job.get('source') or {}).get('sender'),
            "subject": (job.get('source') or {}).get('subject'),
            "artifacts": [a.get('name') for a in (job.get('artifacts') or [])]
        })

    work_section = context.get('work') or {}
    active_count = len(work_section.get('active') or [j for j in (jobs or []) if j.get('status') in {'queued', 'reading_context', 'planning', 'researching', 'generating', 'drafting_reply', 'creating_files', 'verifying', 'preparing', 'working'}])
    waiting_count = len(work_section.get('waiting_approval') or [j for j in (jobs or []) if j.get('status') in {'waiting_approval', 'auto_send_countdown'}])
    conflict_count = (context.get('calendar') or {}).get('conflict_count', sum(1 for e in cal_items if e.get('conflict')))

    return {
        "tasks": tasks,
        "calendar": calendar_events,
        "work_items": work_items,
        "active_work_count": active_count,
        "waiting_approval_count": waiting_count,
        "calendar_conflict_count": conflict_count,
    }


def _compact_voice(text, max_chars=190):
    clean = re.sub(r'\s+', ' ', str(text or '')).strip()
    if not clean:
        return ''
    sentences = re.split(r'(?<=[.!?])\s+', clean)
    spoken = sentences[0]
    if len(spoken) < 70 and len(sentences) > 1:
        spoken += ' ' + sentences[1]
    if len(spoken) > max_chars:
        spoken = spoken[:max_chars].rsplit(' ', 1)[0].rstrip(' ,;:') + '.'
    return spoken


def _agent_text(value, limit=240):
    return re.sub(r'\s+', ' ', str(value or '')).strip()[:limit]


def _agent_reference(value):
    value = value or {}
    ref_type = _agent_text(value.get('type'), 48)
    ref_id = _agent_text(value.get('id'), 180)
    if not ref_type or not ref_id:
        return None
    metadata = {}
    for key, item in list((value.get('metadata') or {}).items())[:8]:
        if item is not None and item != '':
            metadata[_agent_text(key, 48)] = _agent_text(item)
    return {
        'type': ref_type,
        'id': ref_id,
        'label': _agent_text(value.get('label') or ref_id),
        'page': _agent_text(value.get('page'), 48),
        'metadata': metadata,
    }


def _agent_ui_context(value):
    value = value or {}
    refs = value.get('references') or {}
    return {
        'page': _agent_text(value.get('page') or 'overview', 48),
        'selected': _agent_reference(value.get('selected')),
        'open': _agent_reference(value.get('open')),
        'hovered': _agent_reference(value.get('hovered')),
        'focused': _agent_reference(value.get('focused')),
        'lastClicked': _agent_reference(value.get('lastClicked')),
        'selectedText': _agent_text(value.get('selectedText'), 280),
        'selectedTextSource': _agent_reference(value.get('selectedTextSource')),
        'references': {
            'lastMentioned': _agent_reference(refs.get('lastMentioned')),
            'lastOpened': _agent_reference(refs.get('lastOpened')),
            'lastCreated': _agent_reference(refs.get('lastCreated')),
            'lastModified': _agent_reference(refs.get('lastModified')),
            'lastManipulated': _agent_reference(refs.get('lastManipulated')),
        },
        'visibleObjects': [
            item for item in (_agent_reference(ref) for ref in (value.get('visibleObjects') or [])[:12]) if item
        ],
    }


def _agent_known_references(ui_context, resolved):
    candidates = [
        ui_context.get('selected'), ui_context.get('open'), ui_context.get('hovered'),
        ui_context.get('focused'), ui_context.get('lastClicked'),
        ui_context.get('selectedTextSource'),
        *(ui_context.get('references') or {}).values(),
        *(ui_context.get('visibleObjects') or []),
        *resolved,
    ]
    return {f"{ref['type']}:{ref['id']}": ref for ref in candidates if ref}


def _sanitize_agent_action(action, known):
    action = action or {}
    tool = _agent_text(action.get('tool'), 64)
    args = action.get('args') or {}
    pages = {'overview', 'inbox', 'work', 'calendar', 'automations', 'status', 'integrations', 'settings'}
    filters = {'all', 'important', 'action', 'unread'}
    if tool == 'navigation.open' and args.get('page') in pages:
        return {'tool': tool, 'args': {'page': args['page']}}
    if tool == 'inbox.set_filter' and args.get('filter') in filters:
        return {'tool': tool, 'args': {'filter': args['filter']}}
    if tool == 'ui.toast':
        message = _agent_text(args.get('message'), 180)
        return {'tool': tool, 'args': {'message': message}} if message else None
    if tool == 'calendar.preview_create':
        payload = args.get('payload') or {}
        title = _agent_text(payload.get('title'), 160)
        start = _agent_text(payload.get('start'), 80)
        end = _agent_text(payload.get('end'), 80)
        if not title or not start or not end:
            return None
        return {'tool': tool, 'args': {'payload': {
            'title': title,
            'start': start,
            'end': end,
            'description': _agent_text(payload.get('description'), 600),
        }}}

    expected = {
        'inbox.open_email': 'email',
        'calendar.open_event': 'calendar-event',
        'calendar.preview_move': 'calendar-event',
        'work.focus': 'work-item',
        'ui.highlight': None,
        'ui.scroll_to': None,
        'ui.annotate': None,
    }
    if tool not in expected:
        return None
    reference = _agent_reference(args.get('reference') or args)
    if not reference or (expected[tool] and reference['type'] != expected[tool]):
        return None
    exact = known.get(f"{reference['type']}:{reference['id']}")
    if not exact:
        return None
    clean_args = {'reference': exact}
    if tool == 'calendar.preview_move':
        clean_args['start'] = _agent_text(args.get('start'), 80)
        clean_args['end'] = _agent_text(args.get('end'), 80)
        if not clean_args['start']:
            return None
    if tool == 'ui.annotate':
        clean_args['text'] = _agent_text(args.get('text'), 90)
    return {'tool': tool, 'args': clean_args}


def _infer_agent_actions(message, resolved, context=None):
    lower = message.lower()
    reference = resolved[0] if resolved else None
    actions = []
    context = context or {}
    pages = [
        ('calendar', r'\b(open|go to|show)\s+(my\s+)?calendar\b'),
        ('inbox', r'\b(open|go to|show)\s+(my\s+)?inbox\b'),
        ('work', r'\b(?:(open|go to|show)\s+(?:my\s+)?work|what did you prepare|what have you prepared|prepared work|review work)\b'),
        ('overview', r'\b(open|go to|show)\s+(the\s+)?overview\b'),
        ('status', r'\b(open|go to|show)\s+(the\s+)?status\b'),
    ]
    for page, pattern in pages:
        if re.search(pattern, lower):
            actions.append({'tool': 'navigation.open', 'args': {'page': page}})
            break

    filter_name = 'unread' if re.search(r'\bunread\b', lower) else (
        'important' if re.search(r'\bimportant\b', lower) else (
            'action' if re.search(r'\b(requires action|action items?)\b', lower) else None
        )
    )
    if filter_name and re.search(r'\b(show|filter|open|find)\b', lower):
        if not any(action.get('args', {}).get('page') == 'inbox' for action in actions):
            actions.append({'tool': 'navigation.open', 'args': {'page': 'inbox'}})
        actions.append({'tool': 'inbox.set_filter', 'args': {'filter': filter_name}})

    put_on_calendar = bool(re.search(r'\b(put|add|save|schedule)\b.*\b(calendar|schedule)\b', lower))
    if reference and reference['type'] == 'email' and put_on_calendar:
        source = next((email for email in (context.get('emails') or []) if str(email.get('id') or email.get('gmail_id')) == reference['id']), None)
        attention = next((item for item in (context.get('needs_attention') or []) if str(item.get('source_message_id') or item.get('message_id') or item.get('email_id')) == reference['id']), None)
        target, has_time = _deadline_target(attention or {})
        if source and target:
            start = target - timedelta(minutes=60) if has_time else target.replace(hour=17, minute=0, second=0, microsecond=0)
            payload = {
                'title': _agent_text(source.get('subject') or reference.get('label') or 'Email follow-up', 160),
                'start': start.isoformat(),
                'end': (start + timedelta(hours=1)).isoformat(),
                'description': _agent_text(source.get('snippet') or '', 600),
            }
            actions.extend([
                {'tool': 'navigation.open', 'args': {'page': 'calendar'}},
                {'tool': 'calendar.preview_create', 'args': {'payload': payload}},
            ])
    elif reference and reference['type'] == 'email' and re.search(r'\b(open|show|read|reply|respond)\b', lower):
        actions.append({'tool': 'inbox.open_email', 'args': {'reference': reference}})
    elif reference and reference['type'] == 'calendar-event' and re.search(r'\b(open|show|edit|move|reschedule|change)\b', lower):
        moving = bool(re.search(r'\b(move|reschedule|change)\b', lower))
        clock = _parse_clock(lower)
        if not clock and moving:
            short_clock = re.search(r'\b(?:to|at)\s+([1-9]|1[0-2])(?::([0-5]\d))?\b', lower)
            if short_clock:
                hour = int(short_clock.group(1))
                if hour <= 7:
                    hour += 12
                clock = (hour, int(short_clock.group(2) or 0))
        current = next((event for event in (context.get('calendarEvents') or []) if str(event.get('id')) == reference['id']), None)
        if moving and clock and current and current.get('start'):
            old_start = date_parser.parse(str(current['start']))
            if old_start.tzinfo is None:
                old_start = old_start.replace(tzinfo=APP_TZ)
            old_end = date_parser.parse(str(current.get('end') or current['start']))
            if old_end.tzinfo is None:
                old_end = old_end.replace(tzinfo=old_start.tzinfo)
            duration = max(timedelta(minutes=15), old_end - old_start)
            if re.search(r'\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b', lower):
                target_day, _ = _day_window_from_text(lower)
            else:
                target_day = old_start.astimezone(APP_TZ)
            next_start = target_day.replace(hour=clock[0], minute=clock[1], second=0, microsecond=0)
            actions.extend([
                {'tool': 'navigation.open', 'args': {'page': 'calendar'}},
                {'tool': 'calendar.preview_move', 'args': {
                    'reference': reference,
                    'start': next_start.isoformat(),
                    'end': (next_start + duration).isoformat(),
                }},
            ])
        else:
            actions.append({'tool': 'calendar.open_event', 'args': {'reference': reference}})
    elif reference and reference['type'] == 'work-item' and re.search(r'\b(open|show|do|work|focus)\b', lower):
        actions.append({'tool': 'work.focus', 'args': {'reference': reference}})

    if reference and re.search(r'\b(where|which|highlight|point)\b', lower):
        actions.extend([
            {'tool': 'ui.scroll_to', 'args': {'reference': reference}},
            {'tool': 'ui.highlight', 'args': {'reference': reference}},
        ])
    return actions


@app.route('/api/kyle/agent', methods=['POST'])
def kyle_agent_endpoint():
    data = request.get_json(silent=True) or {}
    message = _agent_text(data.get('message'), 1200)
    if not message:
        return jsonify({'error': 'message is required'}), 400

    profile = get_user_profile() or {}
    user_id = profile.get('email') or profile.get('id') or 'default'
    system_ctx = system_context_service.build(user_id=user_id, force_reconcile=False)

    ui_context = _agent_ui_context(data.get('uiContext'))
    resolved = [
        item for item in (_agent_reference(ref) for ref in (data.get('resolvedReferences') or [])[:4]) if item
    ]
    known = _agent_known_references(ui_context, resolved)

    if re.search(r'\b(this|that|it|this one|that one|these|those)\b', message, re.I) and not resolved:
        return jsonify({
            'reply': 'Which item do you mean? Click it, then ask me again.',
            'voice': 'Which item do you mean? Click it, then ask me again.',
            'actions': [],
            'mode': 'clarification',
        })

    actions = []
    # Merge browser context with authoritative system_ctx
    merged_context = dict(system_ctx)
    if isinstance(data.get('context'), dict):
        for k, v in data['context'].items():
            if k not in merged_context:
                merged_context[k] = v

    for candidate in _infer_agent_actions(message, resolved, context=merged_context):
        sanitized = _sanitize_agent_action(candidate, known)
        if sanitized and sanitized not in actions:
            actions.append(sanitized)

    compact = {
        'mail': _compact_context(merged_context),
        'ui': ui_context,
        'resolved': resolved,
        'plannedActions': actions,
        'context_version': system_ctx.get('context_version', 1),
    }
    reply = 'Working on that.' if actions else generate_kyle_agent_reply(message, compact)
    if not reply:
        if resolved:
            reply = f"I know you mean {resolved[0]['label']}. " + (
                'I opened the right place for it.' if actions else 'What would you like me to do with it?'
            )
        elif actions:
            reply = 'Done. I opened the right place.'
        else:
            reply = 'I am with you. What should we handle first?'

    return jsonify({
        'reply': reply,
        'text': reply,
        'voice': _compact_voice(reply),
        'actions': actions[:5],
        'mode': 'deterministic-context',
        'context_version': system_ctx.get('context_version', 1),
    })


@app.route('/api/kyle/chat', methods=['POST'])
def kyle_chat_endpoint():
    data = request.get_json(silent=True) or {}
    msg = str(data.get('message') or '').strip()

    profile = get_user_profile() or {}
    user_id = profile.get('email') or profile.get('id') or 'default'
    system_ctx = system_context_service.build(user_id=user_id, force_reconcile=False)

    merged_context = dict(system_ctx)
    if isinstance(data.get('context'), dict):
        for k, v in data['context'].items():
            if k not in merged_context:
                merged_context[k] = v

    selected_event_id = data.get('selectedCalendarEventId')

    try:
        fast = _kyle_fast_path(msg, merged_context, selected_event_id=selected_event_id)
        if fast:
            fast['context_version'] = system_ctx.get('context_version', 1)
            return jsonify(fast)
    except Exception as exc:
        app.logger.warning('Kyle deterministic tool failed: %s', exc)

    # Fallback AI: give it only the tiny context that changes the answer.
    # The full inbox is already visible in the UI, so there is no reason to
    # send/voice it again.
    compact = _compact_context(merged_context)
    ai_prompt = (
        "You are Kyle inside Agent Harness. Answer naturally and directly. "
        "The UI already shows details, so the spoken answer should usually be 1-2 short sentences, <=35 words. "
        "Never claim the calendar is clear when the supplied context contains a deadline or event. "
        "Never claim drafts are waiting if waiting_approval_count is 0. "
        f"Context: {json.dumps(compact, ensure_ascii=False)}\n"
        f"User: {msg}"
    )
    text = chat_with_kyle(ai_prompt)
    return jsonify({
        "reply": text,
        "text": text,
        "voice": _compact_voice(text),
        "handled": False,
        "context_version": system_ctx.get('context_version', 1),
    })

if __name__ == '__main__':
    print('[Mailmate] Running with zero central mailbox retention (transient browser RAM only).')
    port = int(os.getenv('PORT', 5000))
    print(f"Flask server running on http://localhost:{port}")
    print(f"[Static] project root: {BASE_DIR}")
    print(f"[Static] styles.css: {(BASE_DIR / 'styles.css').is_file()}")
    app.run(port=port, host='0.0.0.0', debug=True, use_reloader=False)
