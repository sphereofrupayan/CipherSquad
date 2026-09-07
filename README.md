# Mailmate - Team CIPHERSQUAD

Mailmate is a proactive Gmail intelligence & autonomous work preparation workspace built for Code2Create 7.0.

> **â€œMailmate displays user-authorized Gmail data transiently, but does not centrally retain mailbox content. Before any AI or autonomous processing, a local privacy gate blocks sensitive and irrelevant messages and passes only the minimum required context.â€**

---

## Two-Plane Security Architecture

Mailmate enforces a strict boundary between user email viewing and machine intelligence:

```text
                         Gmail
                           â”‚
                           â–¼
                 â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                 â”‚ DISPLAY PLANE    â”‚
                 â”‚                  â”‚
                 â”‚ All authorized   â”‚
                 â”‚ Gmail content    â”‚
                 â”‚ can be shown     â”‚
                 â”‚ in browser RAM   â”‚
                 â””â”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
                          â”‚
                    Privacy Gate
                          â”‚
                only required + safe
                          â–¼
                 â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
                 â”‚ AI / WORK PLANE  â”‚
                 â”‚                  â”‚
                 â”‚ Kyle             â”‚
                 â”‚ LM Studio        â”‚
                 â”‚ Gemini fallback  â”‚
                 â”‚ Work Agent       â”‚
                 â”‚ Auto-drafts      â”‚
                 â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Boundary Enforcement Rules
- `Gmail â†’ browser`: Allowed display (transient in browser RAM only; no emails hidden from user).
- `Gmail â†’ disk/database`: **Prohibited** (zero central mailbox retention; only minimal derived task state is stored).
- `Gmail â†’ AI / Gemini / LM Studio`: **Gate required** (sensitive, financial, and security emails blocked).
- `Gmail â†’ Work Agent`: **Gate required** (only actionable academic/work tasks qualify).
- `Gmail â†’ auto-send`: **Gate + AutoSendPolicy required** (routine acknowledgements only, 20s cancelable countdown).

---

## Features

- **Google OAuth with Gmail modify & Calendar access**
- **Transient In-Memory Inbox**: Full Gmail viewing with zero central mailbox storage
- **Deterministic Local Privacy Gate**: Screens out banking, OTPs, and personal records before AI
- **Proactive Work Agent**: Autonomously prepares checklists (`.md`, `.docx`) and response drafts
- **Autopilot Safety Engine (`AutoSendPolicy`)**: 20-second cancelable auto-send countdown for routine acknowledgements only
- **Kyle Browser Voice Assistant** with native browser speech input and speech synthesis
- **Persistent Kyle Automations** with once, daily, weekly, and interval schedules; every run is recorded in Work
- **Overview, Inbox, Work, Calendar, Automations, Status, Integrations, and Settings views**

---

## Requirements

- Python 3.10 or newer
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


---

## Kyle Voice Assistant

- Speech-to-text uses the browser's built-in `SpeechRecognition` / `webkitSpeechRecognition` support.
- Kyle's voice responses use browser speech synthesis, so ElevenLabs is not required for local testing.
- Calendar deletions always show the exact event or grouped event list before Kyle makes the change.

---

## Automations

Create an automation from the Automations view and choose a once, daily, weekly, or interval schedule. Schedules are stored locally in `data/automations.json`, restored after restarts, and run in the background while Mailmate is open. Each run creates a visible Work record with progress steps and its final summary.

---

## Troubleshooting

- **Google access blocked:** Add the Gmail account as an OAuth test user or publish the consent screen.
- **Insufficient Permissions / 403 on Drafts:** Reconnect Google at `http://localhost:5000/auth/google` to grant `gmail.modify` permissions. Older tokens may contain only `gmail.readonly`.
- **Kyle voice input:** Ensure microphone permissions are granted in Chrome.

