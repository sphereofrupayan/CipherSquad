const supabase = require('../config/supabase');
const crypto = require('crypto');

function tokenKey() {
  const value = process.env.OAUTH_TOKEN_ENCRYPTION_KEY || '';
  if (!/^(?:[0-9a-f]{64}|[A-Za-z0-9+/]{43}={0,2})$/i.test(value)) {
    throw new Error('OAUTH_TOKEN_ENCRYPTION_KEY must be a 32-byte hex or base64 key');
  }
  return Buffer.from(value.length === 64 ? value : value, value.length === 64 ? 'hex' : 'base64');
}

function encryptToken(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${encrypted.toString('base64')}`;
}

function decryptToken(value) {
  if (!value) return null;
  const [iv, tag, encrypted] = String(value).split('.').map(part => Buffer.from(part, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', tokenKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

// =========================================================
// USERS
// =========================================================

/**
 * Find a user by email or create a new one.
 * Returns the user row.
 */
async function findOrCreateUser(email, name, googleId) {
  // Try to find existing user
  const { data: existing, error: findErr } = await supabase
    .from('users')
    .select('*')
    .eq('email', email)
    .single();

  if (existing) {
    // Update google_id / name if they changed
    if ((googleId && existing.google_id !== googleId) || (name && existing.name !== name)) {
      const updates = {};
      if (googleId) updates.google_id = googleId;
      if (name) updates.name = name;

      const { data: updated } = await supabase
        .from('users')
        .update(updates)
        .eq('id', existing.id)
        .select()
        .single();
      return updated || existing;
    }
    return existing;
  }

  // Create new user
  const { data: newUser, error: createErr } = await supabase
    .from('users')
    .insert({ email, name, google_id: googleId })
    .select()
    .single();

  if (createErr) throw new Error(`Failed to create user: ${createErr.message}`);
  return newUser;
}

/**
 * Get user by ID.
 */
async function getUserById(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) throw new Error(`User not found: ${error.message}`);
  return data;
}

// =========================================================
// OAUTH TOKENS
// =========================================================

/**
 * Save or update OAuth tokens for a user.
 */
async function saveOAuthTokens(userId, tokens) {
  const row = {
    user_id: userId,
    encrypted_access_token: encryptToken(tokens.access_token),
    encrypted_refresh_token: encryptToken(tokens.refresh_token),
    expiry_date: tokens.expiry_date || null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('oauth_tokens')
    .upsert(row, { onConflict: 'user_id' })
    .select()
    .single();

  if (error) throw new Error(`Failed to save tokens: ${error.message}`);
  return data;
}

/**
 * Get OAuth tokens for a user.
 */
async function getOAuthTokens(userId) {
  const { data, error } = await supabase
    .from('oauth_tokens')
    .select('user_id, encrypted_access_token, encrypted_refresh_token, expiry_date')
    .eq('user_id', userId)
    .single();

  if (error) return null;
  if (!data?.encrypted_access_token) return null;
  return {
    user_id: data.user_id,
    access_token: decryptToken(data.encrypted_access_token),
    refresh_token: decryptToken(data.encrypted_refresh_token),
    expiry_date: data.expiry_date,
  };
}

// =========================================================
// EMAILS
// =========================================================

/**
 * Bulk upsert emails for a user.
 * Expects an array of email objects from gmailService.
 */
async function saveEmails(userId, emails) {
  if (!emails || emails.length === 0) return [];

  const rows = emails.map((e) => ({
    user_id: userId,
    gmail_id: e.id,
    thread_id: e.threadId || null,
    sender: e.sender || null,
    receiver: e.receiver || null,
    subject: e.subject || null,
    timestamp: e.date ? new Date(e.date).toISOString() : null,
    is_read: e.is_read || false,
    is_starred: e.is_starred || false,
    labels: e.labels || [],
  }));

  const { data, error } = await supabase
    .from('emails')
    .upsert(rows, { onConflict: 'user_id,gmail_id' })
    .select();

  if (error) throw new Error(`Failed to save emails: ${error.message}`);
  return data;
}

/**
 * Get all emails for a user (latest first).
 */
async function getEmailsByUser(userId, limit = 100) {
  const { data, error } = await supabase
    .from('emails')
    .select('id,user_id,gmail_id,thread_id,sender,receiver,subject,timestamp,is_read,is_starred,labels')
    .eq('user_id', userId)
    .order('timestamp', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to fetch emails: ${error.message}`);
  return data || [];
}

// =========================================================
// EMAIL ANALYSIS
// =========================================================

/**
 * Save AI analysis for a specific email.
 */
async function saveEmailAnalysis(emailId, analysis) {
  const row = {
    email_id: emailId,
    summary: analysis.summary || null,
    category: analysis.category || null,
    priority: analysis.priority || null,
    intent: analysis.intent || null,
    action_required: analysis.action_required || false,
    deadline: analysis.deadline || null,
  };

  const { data, error } = await supabase
    .from('email_analysis')
    .upsert(row, { onConflict: 'email_id' })
    .select()
    .single();

  if (error) throw new Error(`Failed to save email analysis: ${error.message}`);
  return data;
}

// =========================================================
// TASKS
// =========================================================

/**
 * Create tasks for a user (from AI extraction).
 */
async function saveTasks(userId, tasks) {
  if (!tasks || tasks.length === 0) return [];

  const rows = tasks.map((t) => ({
    user_id: userId,
    email_id: t.email_id || null,
    title: t.title,
    description: t.description || null,
    priority: t.priority || 'medium',
    due_date: t.due_date || null,
    status: t.status || 'pending',
  }));

  const { data, error } = await supabase
    .from('tasks')
    .insert(rows)
    .select();

  if (error) throw new Error(`Failed to save tasks: ${error.message}`);
  return data;
}

/**
 * Get all tasks for a user.
 */
async function getTasksByUser(userId) {
  const { data, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch tasks: ${error.message}`);
  return data || [];
}

/**
 * Update a task's status.
 */
async function updateTaskStatus(taskId, status, userId) {
  const { data, error } = await supabase
    .from('tasks')
    .update({ status })
    .eq('id', taskId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update task: ${error.message}`);
  return data;
}

// =========================================================
// AGENT ACTIONS
// =========================================================

/**
 * Log an agent action.
 */
async function saveAgentAction(userId, action) {
  const row = {
    user_id: userId,
    email_id: action.email_id || null,
    action_type: action.action_type,
    description: action.description || null,
    status: action.status || 'pending',
    result: action.result || null,
  };

  const { data, error } = await supabase
    .from('agent_actions')
    .insert(row)
    .select()
    .single();

  if (error) throw new Error(`Failed to save agent action: ${error.message}`);
  return data;
}

/**
 * Get agent actions for a user.
 */
async function getAgentActions(userId) {
  const { data, error } = await supabase
    .from('agent_actions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch agent actions: ${error.message}`);
  return data || [];
}

/**
 * Update agent action status & result.
 */
async function updateAgentAction(actionId, updates, userId) {
  const { data, error } = await supabase
    .from('agent_actions')
    .update({
      status: updates.status,
      result: updates.result || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', actionId)
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new Error(`Failed to update agent action: ${error.message}`);
  return data;
}

// =========================================================
// USER INSIGHTS
// =========================================================

/**
 * Save a dashboard insight snapshot.
 */
async function saveUserInsight(userId, insight) {
  const row = {
    user_id: userId,
    total_emails: insight.total_emails || 0,
    important_count: insight.important_count || 0,
    action_count: insight.action_items_count || 0,
    ai_insight: insight.ai_insight || 'No insights available.',
  };

  const { data, error } = await supabase
    .from('user_insights')
    .insert(row)
    .select()
    .single();

  if (error) throw new Error(`Failed to save insight: ${error.message}`);
  return data;
}

/**
 * Get the latest insight for a user.
 */
async function getLatestInsight(userId) {
  const { data, error } = await supabase
    .from('user_insights')
    .select('*, attention_items(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) return null;
  return data;
}

// =========================================================
// ATTENTION ITEMS
// =========================================================

/**
 * Save attention items linked to an insight.
 */
async function saveAttentionItems(insightId, items) {
  if (!items || items.length === 0) return [];

  const rows = items.map((item) => ({
    insight_id: insightId,
    sender: item.sender,
    reason: item.reason,
    is_resolved: false,
  }));

  const { data, error } = await supabase
    .from('attention_items')
    .insert(rows)
    .select();

  if (error) throw new Error(`Failed to save attention items: ${error.message}`);
  return data;
}

// =========================================================
// DASHBOARD AGGREGATE
// =========================================================

/**
 * Get full dashboard data for a user:
 * Latest insight + attention items + recent tasks + recent agent actions.
 */
async function getDashboardData(userId) {
  const [insight, tasks, actions] = await Promise.all([
    getLatestInsight(userId),
    getTasksByUser(userId),
    getAgentActions(userId),
  ]);

  return {
    insight,
    tasks,
    actions,
  };
}

module.exports = {
  findOrCreateUser,
  getUserById,
  saveOAuthTokens,
  getOAuthTokens,
  saveEmails,
  getEmailsByUser,
  saveEmailAnalysis,
  saveTasks,
  getTasksByUser,
  updateTaskStatus,
  saveAgentAction,
  getAgentActions,
  updateAgentAction,
  saveUserInsight,
  getLatestInsight,
  saveAttentionItems,
  getDashboardData,
};
