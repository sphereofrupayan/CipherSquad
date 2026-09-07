-- Run once in Supabase SQL Editor.
-- Keeps the original tables and adds one rich current-context cache.

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

create index if not exists processed_context_user_idx
    on public.processed_context(user_id);

create index if not exists processed_context_reprocess_idx
    on public.processed_context(reprocess_after);
