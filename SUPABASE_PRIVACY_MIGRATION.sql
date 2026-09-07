-- Privacy migration: run after deploying the application changes.
-- Existing OAuth sessions must reconnect after this migration because legacy
-- plaintext tokens cannot be encrypted safely inside SQL.

begin;

create table if not exists public.processed_context (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  context_key text not null default 'dashboard',
  payload jsonb not null default '{}'::jsonb,
  source_fingerprint text,
  processed_at timestamptz not null default now(),
  last_checked_at timestamptz not null default now(),
  reprocess_after timestamptz,
  unique (user_id, context_key)
);

alter table public.oauth_tokens
  add column if not exists encrypted_access_token text,
  add column if not exists encrypted_refresh_token text;

-- Force re-authentication before removing plaintext credentials.
update public.oauth_tokens
set access_token = null,
    refresh_token = null;

alter table public.oauth_tokens
  drop column if exists access_token,
  drop column if exists refresh_token;

-- Existing mailbox content is intentionally removed. Gmail remains the source
-- of truth; the application now stores metadata and derived results only.
alter table public.emails
  drop column if exists body,
  drop column if exists snippet;

alter table public.users enable row level security;
alter table public.oauth_tokens enable row level security;
alter table public.emails enable row level security;
alter table public.email_analysis enable row level security;
alter table public.tasks enable row level security;
alter table public.agent_actions enable row level security;
alter table public.user_insights enable row level security;
alter table public.attention_items enable row level security;
alter table public.processed_context enable row level security;

-- Remove legacy permissive policies before creating complete owner policies.
do $$
declare policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('users', 'oauth_tokens', 'emails', 'email_analysis', 'tasks', 'agent_actions', 'user_insights', 'attention_items', 'processed_context')
  loop
    execute format('drop policy if exists %I on %I.%I', policy_record.policyname, policy_record.schemaname, policy_record.tablename);
  end loop;
end $$;

create policy users_owner on public.users
  for all using (id = auth.uid()) with check (id = auth.uid());

create policy oauth_tokens_owner on public.oauth_tokens
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy emails_owner on public.emails
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy email_analysis_owner on public.email_analysis
  for all using (exists (select 1 from public.emails e where e.id = email_id and e.user_id = auth.uid()))
  with check (exists (select 1 from public.emails e where e.id = email_id and e.user_id = auth.uid()));

create policy tasks_owner on public.tasks
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy agent_actions_owner on public.agent_actions
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy user_insights_owner on public.user_insights
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy attention_items_owner on public.attention_items
  for all using (exists (select 1 from public.user_insights i where i.id = insight_id and i.user_id = auth.uid()))
  with check (exists (select 1 from public.user_insights i where i.id = insight_id and i.user_id = auth.uid()));

create policy processed_context_owner on public.processed_context
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

commit;

-- Required server configuration:
-- OAUTH_TOKEN_ENCRYPTION_KEY=<64 hex characters or base64-encoded 32 bytes>
