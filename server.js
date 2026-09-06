const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const oauth2Client = require('./config/google');
const { fetchUserEmails } = require('./services/gmailService');
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
require('dotenv').config();

const app = express();
app.use(cors({ origin: process.env.FRONTEND_URL || 'http://localhost:3000', credentials: true }));
app.use(express.json());

// Serve static frontend files from the project root
app.use(express.static(__dirname));

// ─────────────────────────────────────────────
// AUTH ROUTES
// ─────────────────────────────────────────────

// Route 1: Redirect user to Google OAuth page
app.get('/auth/google', (req, res) => {
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
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Get user profile from Google
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    // Upsert user in Supabase
    const user = await findOrCreateUser(profile.email, profile.name, profile.id);

    // Save OAuth tokens in Supabase
    await saveOAuthTokens(user.id, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expiry_date: tokens.expiry_date,
    });

    // Redirect to frontend with userId
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${frontendUrl}/dashboard.html?connected=true&userId=${user.id}&name=${encodeURIComponent(user.name || '')}`);
  } catch (error) {
    console.error('Error during OAuth callback:', error.message || error);
    res.status(500).send('Authentication failed');
  }
});

// Route 3: Check auth status
app.get('/api/auth/status', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    const user = await getUserById(userId);
    const tokens = await getOAuthTokens(userId);
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
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId query param is required' });

  try {
    // 1. Load tokens from Supabase
    const tokenRow = await getOAuthTokens(userId);
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
    await saveEmails(userId, rawEmails);

    // 4. Run AI analysis
    const aiAnalysis = await analyzeEmailsWithAI(rawEmails);

    // 5. Persist insight snapshot
    const insight = await saveUserInsight(userId, {
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
      user_id: userId,
    });
  } catch (error) {
    console.error('Dashboard Endpoint Error:', error.message || error);
    res.status(500).json({ error: 'Failed to process email insights.' });
  }
});

// Route 5: Get cached dashboard data (without re-fetching Gmail)
app.get('/api/dashboard/cached', async (req, res) => {
  const { userId } = req.query;
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    const data = await getDashboardData(userId);
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
  try {
    const emails = await getEmailsByUser(req.params.userId);
    res.json(emails);
  } catch (error) {
    console.error('Emails fetch error:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch emails.' });
  }
});

// ─────────────────────────────────────────────
// TASKS API
// ─────────────────────────────────────────────

app.get('/api/tasks/:userId', async (req, res) => {
  try {
    const tasks = await getTasksByUser(req.params.userId);
    res.json(tasks);
  } catch (error) {
    console.error('Tasks fetch error:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch tasks.' });
  }
});

app.post('/api/tasks', async (req, res) => {
  const { userId, tasks } = req.body;
  if (!userId || !tasks) return res.status(400).json({ error: 'userId and tasks are required' });

  try {
    const saved = await saveTasks(userId, tasks);
    res.json(saved);
  } catch (error) {
    console.error('Tasks save error:', error.message || error);
    res.status(500).json({ error: 'Failed to save tasks.' });
  }
});

app.patch('/api/tasks/:taskId', async (req, res) => {
  const { status } = req.body;
  try {
    const updated = await updateTaskStatus(req.params.taskId, status);
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
  if (!userId || !action) return res.status(400).json({ error: 'userId and action are required' });

  try {
    const saved = await saveAgentAction(userId, action);
    res.json(saved);
  } catch (error) {
    console.error('Agent action error:', error.message || error);
    res.status(500).json({ error: 'Failed to save agent action.' });
  }
});

app.get('/api/agent/actions/:userId', async (req, res) => {
  try {
    const actions = await getAgentActions(req.params.userId);
    res.json(actions);
  } catch (error) {
    console.error('Agent actions fetch error:', error.message || error);
    res.status(500).json({ error: 'Failed to fetch agent actions.' });
  }
});

app.patch('/api/agent/action/:actionId', async (req, res) => {
  try {
    const updated = await updateAgentAction(req.params.actionId, req.body);
    res.json(updated);
  } catch (error) {
    console.error('Agent action update error:', error.message || error);
    res.status(500).json({ error: 'Failed to update agent action.' });
  }
});

// ─────────────────────────────────────────────
// START SERVER
// ─────────────────────────────────────────────

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
});