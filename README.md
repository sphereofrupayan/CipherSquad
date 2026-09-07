# Mailmate - Team CIPHERSQUAD

Mailmate is a proactive Gmail intelligence & autonomous work preparation workspace built for Code2Create 7.0.

> **“Mailmate displays user-authorized Gmail data transiently, but does not centrally retain mailbox content. Before any AI or autonomous processing, a local privacy gate blocks sensitive and irrelevant messages and passes only the minimum required context.”**

---

## Two-Plane Security Architecture

Mailmate enforces a strict boundary between user email viewing and machine intelligence:

```text
                         Gmail
                           │
                           ▼
                 ┌──────────────────┐
                 │ DISPLAY PLANE    │
                 │                  │
                 │ All authorized   │
                 │ Gmail content    │
                 │ can be shown     │
                 │ in browser RAM   │
                 └────────┬─────────┘
                          │
                    Privacy Gate
                          │
                only required + safe
                          ▼
                 ┌──────────────────┐
                 │ AI / WORK PLANE  │
                 │                  │
                 │ Kyle             │
                 │ LM Studio        │
                 │ Gemini fallback  │
                 │ Work Agent       │
                 │ Auto-drafts      │
                 └──────────────────┘
```

### Boundary Enforcement Rules
- `Gmail → browser`: Allowed display (transient in browser RAM only; no emails hidden from user).
- `Gmail → disk/database`: **Prohibited** (zero central mailbox retention; only minimal derived task state is stored).
- `Gmail → AI / Gemini / LM Studio`: **Gate required** (sensitive, financial, and security emails blocked).
- `Gmail → Work Agent`: **Gate required** (only actionable academic/work tasks qualify).
- `Gmail → auto-send`: **Gate + AutoSendPolicy required** (routine acknowledgements only, 20s cancelable countdown).

---

## Features

- **Google OAuth with Gmail modify & Calendar access**
- **Transient In-Memory Inbox**: Full Gmail viewing with zero central mailbox storage
- **Deterministic Local Privacy Gate**: Screens out banking, OTPs, and personal records before AI
- **Proactive Work Agent**: Autonomously prepares checklists (`.md`, `.docx`) and response drafts
- **Autopilot Safety Engine (`AutoSendPolicy`)**: 20-second cancelable auto-send countdown for routine acknowledgements only
- **Local CUDA-Accelerated Whisper STT & Kyle Browser Voice Assistant**
- **Overview, Inbox, Work, Calendar, Automations, Status, Integrations, and Settings views**

---

## Requirements

- Python 3.10 or newer & Node.js 18 or newer
- A Google Cloud project with Gmail API and Google Calendar API enabled
- A Google OAuth 2.0 Web application client
- A Gemini API key
- (Optional) NVIDIA GPU with CUDA for local Whisper STT acceleration

---

## Install And Run

Clone the repository and enter the project:

```bash
git clone https://github.com/sphereofrupayan/CipherSquad.git
cd CipherSquad
```

Create your local environment file:

```bat
copy api.env.example api.env
```

Start the application:

```bash
py app.py
```

Open [http://localhost:5000](http://localhost:5000), choose **Continue with Google**, and grant Gmail and Calendar access.

---

## Environment Variables

Start from [`api.env.example`](./api.env.example). Never commit the completed `api.env` file.

Required for Google login and Gmail:

```env
GOOGLE_CLIENT_ID=your_google_oauth_web_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_google_oauth_web_client_secret
GOOGLE_REDIRECT_URI=http://localhost:5000/auth/google/callback
PORT=5000
FRONTEND_URL=http://localhost:5000
```

Required for Gemini analysis and Kyle replies:

```env
GEMINI_API_KEY=your_google_gemini_api_key
GEMINI_MODEL=gemini-3.6-flash
GMAIL_FETCH_LIMIT=20
GMAIL_QUERY=newer_than:30d
```

Recommended for shared persistence (derived state only):

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_supabase_publishable_key
SUPABASE_SECRET_KEY=your_supabase_service_role_key
SUPABASE_JWKS_URL=https://your-project.supabase.co/auth/v1/.well-known/jwks.json
OAUTH_TOKEN_ENCRYPTION_KEY=64_hex_characters_or_base64_32_byte_key
```

Run [`SUPABASE_PRIVACY_MIGRATION.sql`](./SUPABASE_PRIVACY_MIGRATION.sql) after deploying the privacy changes. It removes legacy email body/snippet columns and plaintext OAuth token columns; users must reconnect Google afterward. The backend fetches full Gmail content only for transient analysis or an explicit message-detail request, and stores only email metadata plus derived results.

---

## Kyle Voice Assistant

- Local speech-to-text via CUDA-accelerated `faster-whisper` (`small` model).
- Automatic fallback to browser `webkitSpeechRecognition`.
- Kyle's voice responses spoken via browser speech synthesis.

---

## Troubleshooting

- **Google access blocked:** Add the Gmail account as an OAuth test user or publish the consent screen.
- **Insufficient Permissions / 403 on Drafts:** Reconnect Google at `http://localhost:5000/auth/google` to grant `gmail.modify` permissions. Older tokens may contain only `gmail.readonly`.
- **Kyle voice input:** Ensure microphone permissions are granted in Chrome.
