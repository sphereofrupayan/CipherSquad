-- =========================================================
-- CipherSquad — Supabase Schema
-- Run this in Supabase SQL Editor to set up all tables
-- =========================================================


-- =========================================================
-- 1. USERS
-- =========================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    name TEXT,
    email TEXT UNIQUE NOT NULL,
    google_id TEXT UNIQUE,

    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- =========================================================
-- 2. OAUTH TOKENS
-- =========================================================

CREATE TABLE IF NOT EXISTS oauth_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expiry_date BIGINT,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id)
);


-- =========================================================
-- 3. EMAILS
-- =========================================================

CREATE TABLE IF NOT EXISTS emails (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    gmail_id TEXT NOT NULL,
    thread_id TEXT,

    sender TEXT,
    receiver TEXT,

    subject TEXT,
    body TEXT,
    snippet TEXT,

    timestamp TIMESTAMPTZ,

    is_read BOOLEAN DEFAULT FALSE,
    is_starred BOOLEAN DEFAULT FALSE,

    labels TEXT[],

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(user_id, gmail_id)
);


-- =========================================================
-- 4. EMAIL ANALYSIS
-- =========================================================

CREATE TABLE IF NOT EXISTS email_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    email_id UUID NOT NULL
        REFERENCES emails(id)
        ON DELETE CASCADE,

    summary TEXT,

    category TEXT,

    priority TEXT,

    intent TEXT,

    action_required BOOLEAN DEFAULT FALSE,

    deadline TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(email_id)
);


-- =========================================================
-- 5. TASKS
-- =========================================================

CREATE TABLE IF NOT EXISTS tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    email_id UUID
        REFERENCES emails(id)
        ON DELETE SET NULL,

    title TEXT NOT NULL,

    description TEXT,

    priority TEXT DEFAULT 'medium',

    due_date TIMESTAMPTZ,

    status TEXT DEFAULT 'pending',

    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- =========================================================
-- 6. AGENT ACTIONS
-- =========================================================

CREATE TABLE IF NOT EXISTS agent_actions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    email_id UUID
        REFERENCES emails(id)
        ON DELETE SET NULL,

    action_type TEXT NOT NULL,

    description TEXT,

    status TEXT DEFAULT 'pending',

    result JSONB,

    created_at TIMESTAMPTZ DEFAULT NOW(),

    updated_at TIMESTAMPTZ DEFAULT NOW()
);


-- =========================================================
-- 7. USER INSIGHTS
-- =========================================================

CREATE TABLE IF NOT EXISTS user_insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    user_id UUID NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

    total_emails INT NOT NULL DEFAULT 0,

    important_count INT NOT NULL DEFAULT 0,

    action_count INT NOT NULL DEFAULT 0,

    ai_insight TEXT NOT NULL,

    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- =========================================================
-- 8. ATTENTION ITEMS
-- =========================================================

CREATE TABLE IF NOT EXISTS attention_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    insight_id UUID NOT NULL
        REFERENCES user_insights(id)
        ON DELETE CASCADE,

    sender TEXT NOT NULL,

    reason TEXT NOT NULL,

    is_resolved BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMPTZ DEFAULT NOW()
);


-- =========================================================
-- INDEXES
-- =========================================================

CREATE INDEX IF NOT EXISTS idx_emails_user_id
ON emails(user_id);

CREATE INDEX IF NOT EXISTS idx_emails_timestamp
ON emails(timestamp);

CREATE INDEX IF NOT EXISTS idx_emails_gmail_id
ON emails(gmail_id);

CREATE INDEX IF NOT EXISTS idx_email_analysis_email_id
ON email_analysis(email_id);

CREATE INDEX IF NOT EXISTS idx_tasks_user_id
ON tasks(user_id);

CREATE INDEX IF NOT EXISTS idx_tasks_status
ON tasks(status);

CREATE INDEX IF NOT EXISTS idx_agent_actions_user_id
ON agent_actions(user_id);

CREATE INDEX IF NOT EXISTS idx_agent_actions_status
ON agent_actions(status);

CREATE INDEX IF NOT EXISTS idx_user_insights_created
ON user_insights(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_attention_items_insight_id
ON attention_items(insight_id);


-- =========================================================
-- ROW LEVEL SECURITY
-- =========================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

ALTER TABLE oauth_tokens ENABLE ROW LEVEL SECURITY;

ALTER TABLE emails ENABLE ROW LEVEL SECURITY;

ALTER TABLE email_analysis ENABLE ROW LEVEL SECURITY;

ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

ALTER TABLE agent_actions ENABLE ROW LEVEL SECURITY;

ALTER TABLE user_insights ENABLE ROW LEVEL SECURITY;

ALTER TABLE attention_items ENABLE ROW LEVEL SECURITY;


-- =========================================================
-- RLS POLICIES (Service role bypasses these; needed if
-- you ever query from the client side)
-- =========================================================

CREATE POLICY "Users can read own row" ON users
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "Users can read own tokens" ON oauth_tokens
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can read own emails" ON emails
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can read own analysis" ON email_analysis
  FOR SELECT USING (
    email_id IN (SELECT id FROM emails WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can read own tasks" ON tasks
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can read own actions" ON agent_actions
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can read own insights" ON user_insights
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Users can read own attention items" ON attention_items
  FOR SELECT USING (
    insight_id IN (SELECT id FROM user_insights WHERE user_id = auth.uid())
  );
