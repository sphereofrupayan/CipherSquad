import os
import google.generativeai as genai
import json
import datetime
from services.google_service import get_calendar_events, build, get_credentials
from services.privacy_gate import PrivacyGate

def get_dashboard_overview(threads):
    # Enforce Privacy Gate: Sensitive threads (bank alerts, OTPs, promotions) NEVER reach Gemini
    safe_threads = PrivacyGate.filter_threads_for_ai(threads or [])
    shielded_count = len(threads or []) - len(safe_threads)
    if shielded_count > 0:
        print(f"[PrivacyGate] Shielded {shielded_count} sensitive/private thread(s) from Gemini AI analysis.")

    genai.configure(api_key=os.getenv('GEMINI_API_KEY'))
    model = genai.GenerativeModel('gemini-3.5-flash-lite', generation_config={"response_mime_type": "application/json"})

    ai_threads = []
    for thread in safe_threads:
        messages = []
        for message in (thread.get('messages') or []):
            messages.append({
                'id': message.get('id'),
                'sender': message.get('sender'),
                'subject': message.get('subject'),
                'date': message.get('date'),
                'snippet': str(message.get('snippet') or '')[:500],
                'body': str(message.get('body') or '')[:12000],
                'direction': message.get('direction'),
            })
        ai_threads.append({
            'thread_id': thread.get('thread_id'),
            'subject': thread.get('subject'),
            'latest_direction': thread.get('latest_direction'),
            'messages': messages,
        })

    prompt = f"""Analyze the following email threads and generate an overview.
Format MUST be JSON exactly matching this:
{{
    "metrics": {{"emails": int, "important": int, "actions": int}},
    "needs_attention": [{{"description": "...", "owner": "me", "source_message_id": "...", "deadline": "..."}}],
    "waiting_on_others": [{{"description": "...", "owner": "other", "source_message_id": "..."}}],
    "ai_insight": "string"
}}
RULES:
1. Distinguish between 'needs_attention' (actions where owner='me' and unresolved) vs 'waiting_on_others' (owner='other').
2. If latest message in thread is 'outbound' and has no reply, it usually means waiting_on_others, unless a task assigned to 'me' is still incomplete.
3. Ignore promotional/reddit emails.
Threads:
{json.dumps(ai_threads)}
"""
    try:
        res = model.generate_content(prompt)
        parsed = json.loads(res.text)
        # Ensure total email metric accurately reflects all visible emails on the Display Plane
        if "metrics" in parsed:
            parsed["metrics"]["emails"] = len(threads or [])
        return parsed
    except Exception as e:
        print("Gemini error:", e)
        return {
            "metrics": {"emails": len(threads or []), "important": 0, "actions": 0},
            "needs_attention": [],
            "waiting_on_others": [],
            "ai_insight": "Error analyzing emails."
        }

def list_events():
    '''List upcoming calendar events.'''
    events = get_calendar_events()
    return f"Upcoming events: {json.dumps(events)}"

def create_event(title: str, start_time: str, end_time: str):
    '''Create a calendar event. Times must be ISO string e.g. 2026-09-07T10:00:00+05:30'''
    try:
        creds = get_credentials()
        service = build('calendar', 'v3', credentials=creds)
        event = {
            'summary': title,
            'start': {'dateTime': start_time, 'timeZone': 'Asia/Kolkata'},
            'end': {'dateTime': end_time, 'timeZone': 'Asia/Kolkata'},
        }
        event = service.events().insert(calendarId='primary', body=event).execute()
        return f"Created event: {event.get('htmlLink')}"
    except Exception as e:
        return f"Error: {str(e)}"

def chat_with_kyle(message):
    genai.configure(api_key=os.getenv('GEMINI_API_KEY'))
    tools = [list_events, create_event]
    model = genai.GenerativeModel('gemini-3.5-flash-lite', tools=tools)

    chat = model.start_chat(enable_automatic_function_calling=True)
    try:
        res = chat.send_message(f"You are Kyle, a helpful assistant. You manage calendar and email workflows. Timezone is Asia/Kolkata. The time is {datetime.datetime.now().isoformat()}. User says: {message}")
        return res.text
    except Exception as e:
        return f"Kyle error: {str(e)}"


def generate_kyle_agent_reply(message, compact_context):
    """Generate speech-friendly wording only; UI actions are resolved elsewhere."""
    genai.configure(api_key=os.getenv('GEMINI_API_KEY'))
    model = genai.GenerativeModel('gemini-3.5-flash-lite')
    prompt = f"""You are Kyle, the calm operating agent inside Mailmate.
Reply like a person speaking, in one or two short sentences and at most 40 words.
No markdown, bullets, headings, or technical narration.
The app has already resolved words like this, that, and it. Treat the resolved object as authoritative.
Never claim an email was sent or data was deleted. If an editor or draft was created, say it is waiting for your review in the Work tab.
If the user asks what you prepared, what tasks exist, or asks about work, refer to the work items waiting for review in compact context (mention the sender or task and that the response draft/checklist is waiting for approval in the Work tab).

Compact context: {json.dumps(compact_context, ensure_ascii=False)}
User: {message}
"""
    try:
        response = model.generate_content(prompt)
        return str(response.text or '').strip()
    except Exception as exc:
        print('Kyle agent reply error:', exc)
        return ''
