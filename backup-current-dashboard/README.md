# CipherMail - Team CIPHERSQUAD

Agent Harness for Intelligent Email Workflows, built for Code2Create 7.0.

## What It Does

- Google OAuth login with the user's own Google profile data
- Live Gmail fetch for recent inbox messages
- Agent-style email analysis, blockers, urgency, and task extraction
- Dashboard view for email threads, profile, actions, and voice briefing
- Optional Gemini and ElevenLabs integrations

## Run Locally

```bash
npm install
copy api.env.example api.env
npm start
```

Open `http://localhost:8000`.

## Required Google Setup

In Google Cloud Console:

1. Enable the Gmail API.
2. Create an OAuth Web application client.
3. Add this authorized redirect URI:

```text
http://localhost:8000/auth/google/callback
```

4. While the app is in testing mode, add every teammate's Gmail account under Google Auth Platform > Audience > Test users.

Google only allows listed test users until the OAuth app is published or verified. For hackathon judging, add judges as test users or publish the app if the consent screen is ready.

## Environment Variables

Copy `api.env.example` to `api.env` and fill local values. Never commit `api.env`.

ElevenLabs needs a real API key that starts with `sk_`. The voice ID can stay as the sample value or be replaced with your selected voice.
