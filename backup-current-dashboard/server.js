const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const { GoogleGenAI } = require('@google/genai');

require('dotenv').config({ path: path.join(__dirname, 'api.env') });
require('dotenv').config();

const app = express();
const PORT = Number(process.env.PORT || 8000);
const ROOT = __dirname;
const FRONTEND_URL = process.env.FRONTEND_URL || `http://localhost:${PORT}`;

let userTokens = null;
let userProfile = null;

function hasElevenLabsApiKey() {
  return Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.startsWith('sk_'));
}

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.get(['/api.env', '/.env', '/api.env.example'], (_req, res) => {
  res.status(404).send('Not found');
});
app.use(express.static(ROOT, { extensions: ['html'] }));

function makeOAuthClient() {
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${FRONTEND_URL}/auth/google/callback`;
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    redirectUri
  );
}

function sendConfig(res) {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    hasGoogleClientSecret: Boolean(process.env.GOOGLE_CLIENT_SECRET),
    elevenLabsConfigured: hasElevenLabsApiKey(),
    backendAuthUrl: '/auth/google',
    dashboardOverviewUrl: '/api/dashboard/overview',
    voiceBriefingUrl: '/api/voice/briefing'
  });
}

function getHeader(payload, name) {
  return payload?.headers?.find(header => header.name.toLowerCase() === name.toLowerCase())?.value || '';
}

async function fetchUserEmails(tokens) {
  const oauth2Client = makeOAuthClient();
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const listResponse = await gmail.users.messages.list({
    userId: 'me',
    maxResults: 20,
    q: 'newer_than:30d'
  });

  const messages = listResponse.data.messages || [];
  const detailedEmails = await Promise.all(messages.map(async message => {
    const detail = await gmail.users.messages.get({
      userId: 'me',
      id: message.id,
      format: 'metadata',
      metadataHeaders: ['From', 'Subject', 'Date']
    });

    const payload = detail.data.payload || {};
    return {
      id: detail.data.id,
      threadId: detail.data.threadId,
      sender: getHeader(payload, 'From') || 'Unknown Sender',
      subject: getHeader(payload, 'Subject') || 'No Subject',
      date: getHeader(payload, 'Date') || '',
      snippet: detail.data.snippet || ''
    };
  }));

  return detailedEmails;
}

async function fetchGoogleProfile(tokens) {
  const oauth2Client = makeOAuthClient();
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const response = await oauth2.userinfo.get();
  return response.data;
}

function fallbackAnalysis(emails) {
  const attentionWords = /(urgent|asap|blocked|blocker|approval|approve|deadline|due|waiting|risk|deploy|demo|review|action|required)/i;
  const needsAttention = emails
    .filter(email => attentionWords.test(`${email.subject} ${email.snippet}`))
    .slice(0, 8)
    .map(email => ({
      sender: email.sender,
      subject: email.subject,
      reason: email.snippet || 'Likely action item detected from subject context.'
    }));

  return {
    total_emails: emails.length,
    important_count: needsAttention.length,
    action_items_count: needsAttention.length,
    needs_attention: needsAttention,
    ai_insight: needsAttention.length
      ? `${needsAttention.length} recent Gmail threads look action-oriented. Review the top items for approvals, blockers, deadlines, or waiting dependencies.`
      : 'No urgent blockers detected in recent Gmail metadata. Demo workflow data remains loaded for the judging walkthrough.'
  };
}

async function analyzeEmailsWithAI(emails) {
  if (!emails.length) return fallbackAnalysis(emails);
  if (!process.env.GEMINI_API_KEY) return fallbackAnalysis(emails);

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const prompt = `
Return ONLY raw JSON. Analyze these Gmail messages as an agent harness for project email workflows.
Detect blockers, approvals, deadlines, waiting states, and action items.
Schema:
{
  "total_emails": number,
  "important_count": number,
  "action_items_count": number,
  "needs_attention": [{"sender": string, "subject": string, "reason": string}],
  "ai_insight": string
}

Emails:
${JSON.stringify(emails)}
`;

  const response = await ai.models.generateContent({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    contents: prompt
  });

  const responseText = (response.text || '').replace(/```json|```/g, '').trim();
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return fallbackAnalysis(emails);

  return JSON.parse(jsonMatch[0]);
}

app.get('/api/config', (req, res) => {
  sendConfig(res);
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    googleClientConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    elevenLabsConfigured: hasElevenLabsApiKey(),
    gmailAuthenticated: Boolean(userTokens)
  });
});

app.get('/api/me', (req, res) => {
  if (!userProfile) {
    res.status(401).json({ error: 'User profile unavailable until Google auth completes.' });
    return;
  }

  res.json(userProfile);
});

app.post('/api/voice/briefing', async (req, res) => {
  if (!hasElevenLabsApiKey()) {
    res.status(503).json({ error: 'ElevenLabs API key is missing or invalid. API keys start with sk_.' });
    return;
  }

  const rawText = String(req.body?.text || '').trim();
  const fallbackText = 'Agent briefing. Database schema approval is blocking backend deployment and frontend integration. Risk is high because the client demo deadline is approaching. Recommended action: remind the owner, create an approval task, notify waiting stakeholders, and prepare a reviewed reply.';
  const text = (rawText || fallbackText).slice(0, 1200);
  const voiceId = process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
  const modelId = process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';

  try {
    const voiceResponse = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg'
        },
        body: JSON.stringify({
          text,
          model_id: modelId,
          voice_settings: {
            stability: 0.48,
            similarity_boost: 0.78,
            style: 0.18,
            use_speaker_boost: true
          }
        })
      }
    );

    if (!voiceResponse.ok) {
      const detail = await voiceResponse.text();
      throw new Error(detail || `ElevenLabs returned ${voiceResponse.status}`);
    }

    const audioBuffer = Buffer.from(await voiceResponse.arrayBuffer());
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length,
      'Cache-Control': 'no-store'
    });
    res.end(audioBuffer);
  } catch (error) {
    console.error('ElevenLabs briefing failed:', error.message || error);
    res.status(502).json({ error: 'Failed to generate ElevenLabs voice briefing.' });
  }
});

app.get('/auth/google', (req, res) => {
  const oauth2Client = makeOAuthClient();
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/gmail.readonly'
    ]
  });

  res.redirect(url);
});

app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;

  if (error) {
    res.redirect(`/index.html?auth_error=${encodeURIComponent(error)}`);
    return;
  }

  if (!code) {
    res.status(400).send('Missing Google OAuth code.');
    return;
  }

  try {
    const oauth2Client = makeOAuthClient();
    const { tokens } = await oauth2Client.getToken(code);
    userTokens = tokens;
    userProfile = await fetchGoogleProfile(tokens).catch(() => null);
    res.redirect('/dashboard.html?connected=true');
  } catch (authError) {
    console.error('Google OAuth callback failed:', authError.message || authError);
    res.status(500).send('Authentication failed. Check GOOGLE_REDIRECT_URI and OAuth credentials.');
  }
});

app.get('/api/dashboard/overview', async (req, res) => {
  if (!userTokens) {
    res.status(401).json({
      error: 'User not authenticated with Gmail',
      authUrl: '/auth/google'
    });
    return;
  }

  try {
    const rawEmails = await fetchUserEmails(userTokens);
    const analysis = await analyzeEmailsWithAI(rawEmails);

    res.json({
      metrics: {
        emails: analysis.total_emails || rawEmails.length,
        important: analysis.important_count || 0,
        actions: analysis.action_items_count || 0
      },
      needs_attention: analysis.needs_attention || [],
      ai_insight: analysis.ai_insight || 'No urgent emails found.',
      emails: rawEmails
    });
  } catch (error) {
    console.error('Dashboard endpoint failed:', error.message || error);
    res.status(500).json({ error: 'Failed to process email insights.' });
  }
});

app.use((req, res) => {
  const indexPath = path.join(ROOT, 'index.html');
  if (fs.existsSync(indexPath)) res.sendFile(indexPath);
  else res.status(404).send('Not found');
});

app.listen(PORT, () => {
  console.log(`CipherSquad full-stack app running at http://localhost:${PORT}`);
});

// Keep process active in background execution
setInterval(() => {}, 1000 * 60 * 60);
