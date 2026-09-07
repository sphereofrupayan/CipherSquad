const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const { GoogleGenAI } = require('@google/genai');
const crypto = require('crypto');
const path = require('path');
const os = require('os');
require('dotenv').config({ path: path.join(__dirname, 'api.env') });
require('dotenv').config();

const { createOAuthClient } = require('./config/google');
const { fetchUserEmails, fetchUserEmail } = require('./services/gmailService');
const { analyzeEmailsWithAI } = require('./services/aiService');
const {
  findOrCreateUser,
  getUserById,
  saveOAuthTokens,
  getOAuthTokens,
  saveEmails,
  saveUserInsight,
  saveAttentionItems,
  getTasksByUser,
  saveTasks,
  updateTaskStatus,
  saveAgentAction,
  getAgentActions,
  updateAgentAction,
  getDashboardData,
  getEmailsByUser,
} = require('./services/supabaseService');

const app = express();
const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || '0.0.0.0';
const APP_BASE_URL = (process.env.APP_BASE_URL || process.env.FRONTEND_URL || '').replace(/\/$/, '');
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || APP_BASE_URL)
  .split(',')
  .map(origin => origin.trim().replace(/\/$/, ''))
  .filter(Boolean);
const SUPABASE_ENABLED = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

let localTokens = null;
let localProfile = null;
const sessions = new Map();

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    if (!origin || ALLOWED_ORIGINS.length === 0 || ALLOWED_ORIGINS.includes(origin.replace(/\/$/, ''))) {
      callback(null, true);
      return;
    }
    callback(new Error('Origin is not allowed by ALLOWED_ORIGINS'));
  }
}));
app.use(express.json({ limit: '25mb' }));
app.get(['/api.env', '/.env'], (_req, res) => {
  res.status(404).send('Not found');
});

// Serve static frontend files from the project root
app.use(express.static(__dirname));

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || '').split(';').map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }).filter(item => item.length === 2));
}

function startSession(res, userId, profile, tokens) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  sessions.set(sessionId, { userId, profile, tokens, createdAt: Date.now() });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.set('Set-Cookie', `mailmate_session=${sessionId}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400${secure}`);
}

function sessionFor(req) {
  return sessions.get(parseCookies(req).mailmate_session);
}

function authorizedUserId(req, requestedUserId) {
  const session = sessionFor(req);
  if (!session) return null;
  if (requestedUserId && requestedUserId !== session.userId) return null;
  return session.userId;
}

app.use('/api', (req, res, next) => {
  if (req.path === '/config' || req.path === '/health' || req.path === '/auth/status') {
    next();
    return;
  }
  if (!sessionFor(req)) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  next();
});

function getRequestBaseUrl(req) {
  return APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

function getGoogleRedirectUri(req) {
  return process.env.GOOGLE_REDIRECT_URI || `${getRequestBaseUrl(req)}/auth/google/callback`;
}

function hasElevenLabsApiKey() {
  return Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_API_KEY.startsWith('sk_'));
}

function compactKyleContext(context) {
  const emails = (context?.emails || []).slice(0, 8).map(email => ({
    sender: email.sender,
    subject: email.subject,
    date: email.date
  }));

  return {
    metrics: context?.metrics || {},
    ai_insight: context?.ai_insight || '',
    needs_attention: (context?.needs_attention || []).slice(0, 8),
    emails
  };
}

function cleanAgentText(value, max = 240) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function compactKyleReference(reference) {
  const type = cleanAgentText(reference?.type, 48);
  const id = cleanAgentText(reference?.id, 180);
  if (!type || !id) return null;
  const metadata = Object.fromEntries(Object.entries(reference?.metadata || {})
    .filter(([, value]) => value != null && value !== '')
    .slice(0, 8)
    .map(([name, value]) => [cleanAgentText(name, 48), cleanAgentText(value)]));
  return {
    type,
    id,
    label: cleanAgentText(reference?.label || id),
    page: cleanAgentText(reference?.page, 48),
    metadata
  };
}

function compactKyleUiContext(context = {}) {
  const reference = value => compactKyleReference(value);
  return {
    page: cleanAgentText(context.page || 'overview', 48),
    selected: reference(context.selected),
    open: reference(context.open),
    hovered: reference(context.hovered),
    focused: reference(context.focused),
    lastClicked: reference(context.lastClicked),
    selectedText: cleanAgentText(context.selectedText, 280),
    selectedTextSource: reference(context.selectedTextSource),
    references: {
      lastMentioned: reference(context.references?.lastMentioned),
      lastOpened: reference(context.references?.lastOpened),
      lastCreated: reference(context.references?.lastCreated),
      lastModified: reference(context.references?.lastModified),
      lastManipulated: reference(context.references?.lastManipulated)
    },
    visibleObjects: (context.visibleObjects || []).slice(0, 12).map(reference).filter(Boolean)
  };
}

function knownKyleReferences(uiContext, resolvedReferences) {
  const candidates = [
    uiContext.selected,
    uiContext.open,
    uiContext.hovered,
    uiContext.focused,
    uiContext.lastClicked,
    uiContext.selectedTextSource,
    ...Object.values(uiContext.references || {}),
    ...(uiContext.visibleObjects || []),
    ...(resolvedReferences || []).map(compactKyleReference)
  ].filter(Boolean);
  return new Map(candidates.map(reference => [`${reference.type}:${reference.id}`, reference]));
}

function sanitizeKyleAction(action, knownReferences) {
  const tool = cleanAgentText(action?.tool, 64);
  const args = action?.args || {};
  const pages = new Set(['overview', 'inbox', 'work', 'calendar', 'automations', 'status', 'integrations', 'settings']);
  const filters = new Set(['all', 'important', 'action', 'unread']);
  if (tool === 'navigation.open' && pages.has(args.page)) return { tool, args: { page: args.page } };
  if (tool === 'inbox.set_filter' && filters.has(args.filter)) return { tool, args: { filter: args.filter } };
  if (tool === 'ui.toast') {
    const message = cleanAgentText(args.message, 180);
    return message ? { tool, args: { message } } : null;
  }

  const expectedTypes = {
    'inbox.open_email': 'email',
    'calendar.open_event': 'calendar-event',
    'work.focus': 'work-item',
    'ui.highlight': null,
    'ui.scroll_to': null
  };
  if (!(tool in expectedTypes)) return null;

  const reference = compactKyleReference(args.reference || args);
  if (!reference) return null;
  if (expectedTypes[tool] && reference.type !== expectedTypes[tool]) return null;
  const known = knownReferences.get(`${reference.type}:${reference.id}`);
  return known ? { tool, args: { reference: known } } : null;
}

function inferKyleActions(message, references) {
  const text = message.toLowerCase();
  const reference = references[0] || null;
  const actions = [];
  const pageMatches = [
    ['calendar', /\b(open|go to|show)\s+(my\s+)?calendar\b/],
    ['inbox', /\b(open|go to|show)\s+(my\s+)?inbox\b/],
    ['work', /\b(open|go to|show)\s+(my\s+)?work\b/],
    ['overview', /\b(open|go to|show)\s+(the\s+)?overview\b/],
    ['status', /\b(open|go to|show)\s+(the\s+)?status\b/]
  ];
  const page = pageMatches.find(([, pattern]) => pattern.test(text))?.[0];
  if (page) actions.push({ tool: 'navigation.open', args: { page } });

  const filter = /\bunread\b/.test(text) ? 'unread'
    : /\bimportant\b/.test(text) ? 'important'
      : /\b(requires action|action items?)\b/.test(text) ? 'action'
        : null;
  if (filter && /\b(show|filter|open|find)\b/.test(text)) actions.push({ tool: 'inbox.set_filter', args: { filter } });

  if (reference?.type === 'email' && /\b(open|show|read|reply|respond)\b/.test(text)) {
    actions.push({ tool: 'inbox.open_email', args: { reference } });
  } else if (reference?.type === 'calendar-event' && /\b(open|show|edit|move|reschedule|change)\b/.test(text)) {
    actions.push({ tool: 'calendar.open_event', args: { reference } });
  } else if (reference?.type === 'work-item' && /\b(open|show|do|work|focus)\b/.test(text)) {
    actions.push({ tool: 'work.focus', args: { reference } });
  }

  if (reference && /\b(where|which|highlight|point)\b/.test(text)) {
    actions.push({ tool: 'ui.scroll_to', args: { reference } });
    actions.push({ tool: 'ui.highlight', args: { reference } });
  }
  return actions;
}

function parseKyleJson(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(text);
  } catch (_) {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try { return JSON.parse(text.slice(start, end + 1)); } catch (_) {}
    }
    return null;
  }
}

function normalizeCachedDashboard(cached, emails = []) {
  const insight = cached?.insight || {};
  const attentionItems = insight.attention_items || [];
  const normalizedEmails = emails.map(email => ({
    id: email.id || email.gmail_id,
    threadId: email.threadId || email.thread_id,
    sender: email.sender,
    receiver: email.receiver,
    subject: email.subject,
    date: email.date || email.timestamp,
    labels: email.labels || [],
    is_read: email.is_read,
    is_starred: email.is_starred
  }));
  return {
    metrics: {
      emails: insight.total_emails || normalizedEmails.length,
      important: insight.important_count || attentionItems.length || 0,
      actions: insight.action_count || (cached?.tasks || []).length || 0
    },
    needs_attention: attentionItems.map(item => ({
      sender: item.sender,
      reason: item.reason
    })),
    ai_insight: insight.ai_insight || 'Cached Gmail context is ready.',
    emails: normalizedEmails,
    tasks: cached?.tasks || [],
    actions: cached?.actions || [],
    cached: true
  };
}

function fallbackAnalysis(emails) {
  const attentionWords = /(urgent|asap|blocked|blocker|approval|approve|deadline|due|waiting|risk|deploy|demo|review|action|required)/i;
  const needsAttention = (emails || [])
    .filter(email => attentionWords.test(`${email.subject || ''} ${email.snippet || ''}`))
    .slice(0, 8)
    .map(email => ({
      sender: email.sender || 'Unknown sender',
      reason: email.snippet || email.subject || 'Likely action item detected from recent Gmail context.'
    }));

  return {
    total_emails: emails.length,
    important_count: needsAttention.length,
    action_items_count: needsAttention.length,
    needs_attention: needsAttention,
    ai_insight: needsAttention.length
      ? `${needsAttention.length} recent Gmail messages look action-oriented. Review approvals, blockers, deadlines, and waiting dependencies first.`
      : 'No urgent blockers detected in recent Gmail messages.'
  };
}

async function safeAnalyzeEmails(emails) {
  try {
    return (await analyzeEmailsWithAI(emails)) || fallbackAnalysis(emails);
  } catch (error) {
    console.warn('AI analysis unavailable, using local heuristic:', error.message || error);
    return fallbackAnalysis(emails);
  }
}

async function analyzeTransientEmails(tokens, metadataEmails) {
  const fullEmails = await Promise.all((metadataEmails || []).map(email => fetchUserEmail(tokens, email.id)));
  return safeAnalyzeEmails(fullEmails.filter(Boolean));
}

async function fetchGoogleProfile(tokens, redirectUri) {
  const oauth2Client = createOAuthClient(redirectUri);
  oauth2Client.setCredentials(tokens);
  const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
  const { data } = await oauth2.userinfo.get();
  return data;
}

function getLocalUserId() {
  return localProfile?.id || localProfile?.email || 'local-gmail-user';
}

app.get('/api/config', (_req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    hasGoogleClientSecret: Boolean(process.env.GOOGLE_CLIENT_SECRET),
    supabaseConfigured: SUPABASE_ENABLED,
    elevenLabsConfigured: hasElevenLabsApiKey(),
    backendAuthUrl: '/auth/google',
    dashboardOverviewUrl: '/api/dashboard/overview',
    voiceBriefingUrl: '/api/voice/briefing',
    transcriptionUrl: '/api/transcribe'
  });
});

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    googleClientConfigured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
    supabaseConfigured: SUPABASE_ENABLED,
    elevenLabsConfigured: hasElevenLabsApiKey(),
    whisperConfigured: Boolean(process.env.OPENAI_API_KEY || process.env.WHISPER_API_KEY),
    gmailAuthenticated: Boolean(localTokens)
  });
});

app.get('/api/me', (_req, res) => {
  if (!localProfile) {
    res.status(401).json({ error: 'User profile unavailable until Google auth completes.' });
    return;
  }
  res.json(localProfile);
});

app.post('/api/voice/briefing', async (req, res) => {
  if (!hasElevenLabsApiKey()) {
    res.status(503).json({ error: 'ElevenLabs API key is missing or invalid. API keys start with sk_.' });
    return;
  }

  const rawText = String(req.body?.text || '').trim();
  const fallbackText = 'Agent briefing. Recent Gmail messages have been scanned for blockers, approvals, deadlines, and action items. Review the highest priority items and keep every execution step visible in the audit trail.';
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

app.post('/api/transcribe', async (req, res) => {
  const audioBase64 = String(req.body?.audio || '');
  const mimeType = String(req.body?.mimeType || 'audio/webm');
  const apiKey = process.env.OPENAI_API_KEY || process.env.WHISPER_API_KEY;

  if (!apiKey) {
    res.status(503).json({ error: 'Whisper transcription is not configured. Set OPENAI_API_KEY or WHISPER_API_KEY.' });
    return;
  }

  if (!audioBase64) {
    res.status(400).json({ error: 'audio is required' });
    return;
  }

  try {
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    const extension = mimeType.includes('mp4') ? 'm4a' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: mimeType }), `speech.${extension}`);
    form.append('model', process.env.WHISPER_MODEL || 'whisper-1');
    form.append('response_format', 'json');

    console.log('[Kyle Voice] whisper started');
    const response = await fetch(process.env.WHISPER_TRANSCRIBE_URL || 'https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form
    });

    if (!response.ok) {
      const detail = await response.text();
      throw new Error(detail || `Whisper returned ${response.status}`);
    }

    const data = await response.json();
    console.log('[Kyle Voice] final transcript');
    res.json({ text: data.text || '' });
  } catch (error) {
    console.error('[Kyle Voice] whisper failed:', error.message || error);
    res.status(502).json({ error: 'Failed to transcribe audio.' });
  }
});

async function handleKyleAgent(req, res) {
  const message = String(req.body?.message || '').trim();
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  const context = compactKyleContext(req.body?.context || {});
  const uiContext = compactKyleUiContext(req.body?.uiContext || {});
  const resolvedReferences = (req.body?.resolvedReferences || []).slice(0, 4).map(compactKyleReference).filter(Boolean);
  const knownReferences = knownKyleReferences(uiContext, resolvedReferences);
  const deterministicActions = inferKyleActions(message, resolvedReferences)
    .map(action => sanitizeKyleAction(action, knownReferences))
    .filter(Boolean);
  const resolved = resolvedReferences[0];
  const fallbackReply = resolved
    ? `I know you mean ${resolved.label}. ${deterministicActions.length ? 'I have opened the right place for it.' : 'What would you like me to do with it?'}`
    : `I am with you. I can see ${context.metrics.emails || 0} scanned emails and ${context.metrics.actions || 0} possible actions. What should we handle first?`;

  if (!process.env.GEMINI_API_KEY) {
    res.json({ reply: fallbackReply, actions: deterministicActions, mode: 'fallback' });
    return;
  }

  try {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `
You are Kyle, the calm operating agent inside Mailmate.
You are speaking out loud, not writing a report.
Answer like a person in 1 to 3 short spoken sentences.
Use contractions naturally. Avoid bullets, markdown, headings, tables, and long lists.
Use the Gmail/workflow context when available.
Return only valid JSON with this shape: {"reply":"spoken response","actions":[{"tool":"tool.name","args":{}}]}.
Allowed tools are navigation.open, inbox.set_filter, inbox.open_email, calendar.open_event, work.focus, ui.highlight, ui.scroll_to, and ui.toast.
Use only exact IDs from Resolved references or UI context. Never invent IDs, CSS selectors, JavaScript, or new tool names.
Never send email, delete data, or complete an irreversible action. For reply, move, reschedule, or edit requests, open the exact object so the user can review it.
The phrase this, that, or it has already been resolved locally. Treat Resolved references as authoritative.

User request:
${message}

Current Gmail/workflow context:
${JSON.stringify(context)}

Compact UI context:
${JSON.stringify(uiContext)}

Resolved references:
${JSON.stringify(resolvedReferences)}

Actions already inferred locally (do not repeat them):
${JSON.stringify(deterministicActions)}
`;

    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
      contents: prompt,
      config: { responseMimeType: 'application/json' }
    });
    const parsed = parseKyleJson(response.text);
    const modelActions = (parsed?.actions || [])
      .slice(0, 4)
      .map(action => sanitizeKyleAction(action, knownReferences))
      .filter(Boolean);
    const actions = [...deterministicActions, ...modelActions]
      .filter((action, index, all) => all.findIndex(candidate => JSON.stringify(candidate) === JSON.stringify(action)) === index)
      .slice(0, 5);
    res.json({ reply: cleanAgentText(parsed?.reply || fallbackReply, 520), actions, mode: 'gemini' });
  } catch (error) {
    console.error('Kyle Gemini agent failed:', error.message || error);
    res.json({ reply: fallbackReply, actions: deterministicActions, mode: 'fallback' });
  }
}

app.post('/api/kyle/agent', handleKyleAgent);
app.post('/api/kyle/chat', handleKyleAgent);

// ─────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────

// Route 1: Redirect user to Google OAuth page
app.get('/auth/google', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    res.status(503).send('Google OAuth is not configured on this backend.');
    return;
  }
  const oauth2Client = createOAuthClient(getGoogleRedirectUri(req));
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/userinfo.profile',
  ];
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent',
  });
  res.redirect(url);
});

// Route 2: OAuth Callback — persist user & tokens to Supabase
app.get('/auth/google/callback', async (req, res) => {
  const { code, error } = req.query;
  const frontendUrl = getRequestBaseUrl(req);
  if (error) {
    res.redirect(`${frontendUrl}/index.html?auth_error=${encodeURIComponent(error)}`);
    return;
  }
  if (!code) {
    res.status(400).send('Missing Google OAuth code.');
    return;
  }

  try {
    const redirectUri = getGoogleRedirectUri(req);
    const oauth2Client = createOAuthClient(redirectUri);
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user profile from Google
    const profile = await fetchGoogleProfile(tokens, redirectUri);

    if (!SUPABASE_ENABLED) {
      localTokens = tokens;
      localProfile = profile;
      startSession(res, getLocalUserId(), profile, tokens);
      res.redirect(`${frontendUrl}/dashboard.html?connected=true&userId=${encodeURIComponent(getLocalUserId())}&name=${encodeURIComponent(profile.name || profile.email || '')}&picture=${encodeURIComponent(profile.picture || '')}`);
      return;
    }

    // Upsert user in Supabase
    const user = await findOrCreateUser(profile.email, profile.name, profile.id);

    // Save OAuth tokens in Supabase
    await saveOAuthTokens(user.id, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    });

    startSession(res, user.id, user, tokens);
    // Redirect to frontend with userId
    res.redirect(`${frontendUrl}/dashboard.html?connected=true&userId=${user.id}&name=${encodeURIComponent(user.name || '')}&picture=${encodeURIComponent(profile.picture || '')}`);
  } catch (error) {
    console.error('Error during OAuth callback:', error.message || error);
    res.status(500).send('Authentication failed');
  }
});

// Route 3: Check auth status
app.get('/api/auth/status', async (req, res) => {
  const { userId } = req.query;
  const authorizedId = authorizedUserId(req, userId);
  if (!authorizedId && !localTokens) return res.status(401).json({ authenticated: false });

  if (!SUPABASE_ENABLED) {
    res.json({
      authenticated: Boolean(localTokens),
      user: localProfile ? {
        id: getLocalUserId(),
        name: localProfile.name,
        email: localProfile.email,
        picture: localProfile.picture
      } : null
    });
    return;
  }

  try {
    const user = await getUserById(authorizedId);
    const tokens = await getOAuthTokens(authorizedId);
    res.json({
      authenticated: !!tokens,
      user: { id: user.id, name: user.name, email: user.email },
    });
  } catch (error) {
    res.status(401).json({ authenticated: false });
  }
});

// ─────────────────────────────────────────────
// DASHBOARD API
// ─────────────────────────────────────────────

// Route 4: Dashboard Overview — fetches emails, runs AI, persists everything
app.get('/api/dashboard/overview', async (req, res) => {
  const { userId, refresh } = req.query;
  const authorizedId = authorizedUserId(req, userId);
  if (!authorizedId && !localTokens) return res.status(401).json({ error: 'Authentication required.' });

  if (!SUPABASE_ENABLED) {
    if (!localTokens) {
      return res.status(401).json({ error: 'User not authenticated with Gmail', authUrl: '/auth/google' });
    }

    try {
      const rawEmails = await fetchUserEmails(localTokens);
      const aiAnalysis = await analyzeTransientEmails(localTokens, rawEmails);
      return res.json({
        metrics: {
          emails: aiAnalysis?.total_emails || rawEmails.length,
          important: aiAnalysis?.important_count || 0,
          actions: aiAnalysis?.action_items_count || 0,
        },
        needs_attention: aiAnalysis?.needs_attention || [],
        ai_insight: aiAnalysis?.ai_insight || 'No urgent emails found.',
        emails: rawEmails,
        user: localProfile,
        user_id: getLocalUserId(),
      });
    } catch (error) {
      console.error('Local dashboard endpoint error:', error.message || error);
      return res.status(500).json({ error: 'Failed to process email insights.' });
    }
  }

  try {
    if (refresh !== 'true') {
      const [cached, cachedEmails] = await Promise.all([
        getDashboardData(authorizedId),
        getEmailsByUser(authorizedId, Number(process.env.GMAIL_FETCH_LIMIT || 20))
      ]);

      if (cached?.insight || cachedEmails.length) {
        return res.json(normalizeCachedDashboard(cached, cachedEmails));
      }
    }

    // 1. Load tokens from Supabase
    const tokenRow = await getOAuthTokens(authorizedId);
    if (!tokenRow) {
      return res.status(401).json({ error: 'User not authenticated with Gmail' });
    }

    const tokens = {
      access_token: tokenRow.access_token,
      refresh_token: tokenRow.refresh_token,
      expiry_date: tokenRow.expiry_date,
    };

    // 2. Fetch emails from Gmail
    const rawEmails = await fetchUserEmails(tokens);

    // 3. Persist emails to Supabase
    await saveEmails(authorizedId, rawEmails);

    // 4. Run AI analysis
    const aiAnalysis = await analyzeTransientEmails(tokens, rawEmails);

    // 5. Persist insight snapshot
    const insight = await saveUserInsight(authorizedId, {
      total_emails: aiAnalysis?.total_emails || rawEmails.length,
      important_count: aiAnalysis?.important_count || 0,
      action_items_count: aiAnalysis?.action_items_count || 0,
      ai_insight: aiAnalysis?.ai_insight || 'No urgent emails found.',
    });

    // 6. Persist attention items
    if (aiAnalysis?.needs_attention && aiAnalysis.needs_attention.length > 0) {
      await saveAttentionItems(insight.id, aiAnalysis.needs_attention);
    }

    // 7. Return response
    res.json({
      metrics: {
        emails: aiAnalysis?.total_emails || rawEmails.length,
        important: aiAnalysis?.important_count || 0,
        actions: aiAnalysis?.action_items_count || 0,
      },
      needs_attention: aiAnalysis?.needs_attention || [],
      ai_insight: aiAnalysis?.ai_insight || 'No urgent emails found.',
      emails: rawEmails,
      user_id: authorizedId,
    });
  } catch (error) {
    console.error('Dashboard Endpoint Error:', error.message || error);
    res.status(500).json({ error: 'Failed to process email insights.' });
  }
});

// Route 5: Get cached dashboard data (without re-fetching Gmail)
app.get('/api/dashboard/cached', async (req, res) => {
  const { userId } = req.query;
  const authorizedId = authorizedUserId(req, userId);
  if (!authorizedId) return res.status(401).json({ error: 'Authentication required.' });

  try {
    const data = await getDashboardData(authorizedId);
    res.json(data);
  } catch (error) {
    console.error('Cached dashboard error:', error.message || error);
    res.status(500).json({ error: 'Failed to load dashboard data.' });
  }
});

// ─────────────────────────────────────────────
// EMAILS API
// ─────────────────────────────────────────────

app.get('/api/emails/:userId', async (req, res) => {
  const authorizedId = authorizedUserId(req, req.params.userId);
  if (!authorizedId) return res.status(403).json({ error: 'Forbidden.' });
  try {
    const emails = await getEmailsByUser(authorizedId);
    res.json(emails);
  } catch (error) {
    console.error('Emails fetch error:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch emails.' });
  }
});

app.get('/api/gmail/messages/:messageId', async (req, res) => {
  try {
    const session = sessionFor(req);
    const tokens = session?.tokens || await getOAuthTokens(session?.userId);
    if (!tokens) return res.status(401).json({ error: 'Gmail authentication required.' });
    const email = await fetchUserEmail(tokens, req.params.messageId);
    if (!email) return res.status(404).json({ error: 'Message not found.' });
    res.set('Cache-Control', 'no-store');
    res.json(email);
  } catch (error) {
    res.status(502).json({ error: 'Failed to fetch Gmail message.' });
  }
});

// ─────────────────────────────────────────────
// TASKS API
// ─────────────────────────────────────────────

app.get('/api/tasks/:userId', async (req, res) => {
  const authorizedId = authorizedUserId(req, req.params.userId);
  if (!authorizedId) return res.status(403).json({ error: 'Forbidden.' });
  try {
    const tasks = await getTasksByUser(authorizedId);
    res.json(tasks);
  } catch (error) {
    console.error('Tasks fetch error:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch tasks.' });
  }
});

app.post('/api/tasks', async (req, res) => {
  const { userId, tasks } = req.body;
  const authorizedId = authorizedUserId(req, userId);
  if (!authorizedId || !tasks) return res.status(403).json({ error: 'Forbidden.' });

  try {
    const saved = await saveTasks(authorizedId, tasks);
    res.json(saved);
  } catch (error) {
    console.error('Tasks save error:', error.message || error);
    res.status(500).json({ error: 'Failed to save tasks.' });
  }
});

app.patch('/api/tasks/:taskId', async (req, res) => {
  const { status } = req.body;
  const authorizedId = authorizedUserId(req);
  if (!authorizedId) return res.status(403).json({ error: 'Forbidden.' });
  try {
    const updated = await updateTaskStatus(req.params.taskId, status, authorizedId);
    res.json(updated);
  } catch (error) {
    console.error('Task update error:', error.message || error);
    res.status(500).json({ error: 'Failed to update task.' });
  }
});

// ─────────────────────────────────────────────
// AGENT ACTIONS API
// ─────────────────────────────────────────────

app.post('/api/agent/action', async (req, res) => {
  const { userId, action } = req.body;
  const authorizedId = authorizedUserId(req, userId);
  if (!authorizedId || !action) return res.status(403).json({ error: 'Forbidden.' });

  try {
    const saved = await saveAgentAction(authorizedId, action);
    res.json(saved);
  } catch (error) {
    console.error('Agent action error:', error.message || error);
    res.status(500).json({ error: 'Failed to save agent action.' });
  }
});

app.get('/api/agent/actions/:userId', async (req, res) => {
  const authorizedId = authorizedUserId(req, req.params.userId);
  if (!authorizedId) return res.status(403).json({ error: 'Forbidden.' });
  try {
    const actions = await getAgentActions(authorizedId);
    res.json(actions);
  } catch (error) {
    console.error('Agent actions fetch error:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch agent actions.' });
  }
});

app.patch('/api/agent/action/:actionId', async (req, res) => {
  const authorizedId = authorizedUserId(req);
  if (!authorizedId) return res.status(403).json({ error: 'Forbidden.' });
  try {
    const updated = await updateAgentAction(req.params.actionId, req.body, authorizedId);
    res.json(updated);
  } catch (error) {
    console.error('Agent action update error:', error.message || error);
    res.status(500).json({ error: 'Failed to update agent action.' });
  }
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────

const server = app.listen(PORT, HOST, () => {
  console.log(`[Harness] backend listening on http://localhost:${PORT}`);
  if (HOST === '0.0.0.0' || HOST === '::') {
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter(address => address && address.family === 'IPv4' && !address.internal)
      .map(address => `http://${address.address}:${PORT}`);
    if (addresses.length) console.log(`[Harness] LAN access: ${addresses.join(', ')}`);
  }
});

function shutdown(signal) {
  console.log(`[Harness] ${signal} received, closing server`);
  server.close(() => process.exit(0));
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { app, server };
