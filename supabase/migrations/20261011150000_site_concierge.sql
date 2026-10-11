-- Site concierge (Milan's go 10/10, build plan 2026-10-11). A chat assistant on the
-- website that helps people pick a program, hands them a prefilled sign-up link, and
-- answers a verified person's questions about their own registration.
--
-- Four tables, all service-role only (the cfa-concierge Edge Function is the only reader
-- and writer). The operating rules live in cfa_concierge_config, not in this public repo.

create table public.cfa_concierge_config (
  id smallint primary key default 1 check (id = 1),
  system_prompt text not null,
  updated_at timestamptz not null default now()
);

create table public.cfa_concierge_sessions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  ip_hash text not null,
  origin text,
  page_path text,
  is_test boolean not null default false,
  message_count integer not null default 0,
  -- Set once the visitor proves an address with an emailed code.
  contact_id uuid references public.contacts(id) on delete set null,
  verified_email text,
  verified_at timestamptz,
  handed_off_at timestamptz
);
create index cfa_concierge_sessions_ip_idx on public.cfa_concierge_sessions (ip_hash, last_message_at);
create index cfa_concierge_sessions_created_idx on public.cfa_concierge_sessions (created_at);

-- The transcript in Messages API shape: one row per user or assistant message, content
-- exactly as sent to or returned by the model, so a session replays append-only.
create table public.cfa_concierge_messages (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.cfa_concierge_sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  role text not null check (role in ('user', 'assistant')),
  content jsonb not null,
  -- Visitor-typed text for user turns; null for tool-result turns.
  visitor_text text,
  model text,
  stop_reason text,
  usage jsonb
);
create index cfa_concierge_messages_session_idx on public.cfa_concierge_messages (session_id, id);
create index cfa_concierge_messages_created_idx on public.cfa_concierge_messages (created_at);

create table public.cfa_concierge_verifications (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.cfa_concierge_sessions(id) on delete cascade,
  email text not null,
  contact_id uuid references public.contacts(id) on delete cascade,
  code_hash text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts integer not null default 0,
  verified_at timestamptz
);
create index cfa_concierge_verifications_email_idx on public.cfa_concierge_verifications (email, created_at);
create index cfa_concierge_verifications_session_idx on public.cfa_concierge_verifications (session_id, created_at);

alter table public.cfa_concierge_config enable row level security;
alter table public.cfa_concierge_sessions enable row level security;
alter table public.cfa_concierge_messages enable row level security;
alter table public.cfa_concierge_verifications enable row level security;
revoke all on table public.cfa_concierge_config from public, anon, authenticated;
revoke all on table public.cfa_concierge_sessions from public, anon, authenticated;
revoke all on table public.cfa_concierge_messages from public, anon, authenticated;
revoke all on table public.cfa_concierge_verifications from public, anon, authenticated;

-- Token use per month and model, for the monthly CfA report. The Anthropic Console
-- workspace is the billing authority; this is the readout we can quote.
create view public.cfa_concierge_usage
with (security_invoker = true) as
select
  date_trunc('month', m.created_at) as month,
  m.model,
  s.is_test,
  count(*) as calls,
  count(distinct m.session_id) as sessions,
  sum(coalesce((m.usage->>'input_tokens')::bigint, 0)) as input_tokens,
  sum(coalesce((m.usage->>'cache_read_input_tokens')::bigint, 0)) as cache_read_tokens,
  sum(coalesce((m.usage->>'cache_creation_input_tokens')::bigint, 0)) as cache_write_tokens,
  sum(coalesce((m.usage->>'output_tokens')::bigint, 0)) as output_tokens
from public.cfa_concierge_messages m
join public.cfa_concierge_sessions s on s.id = m.session_id
where m.role = 'assistant'
group by 1, 2, 3;
revoke all on table public.cfa_concierge_usage from public, anon, authenticated;

comment on table public.cfa_concierge_sessions is
  'Site concierge chat sessions. Service-role only. contact_id is set only after emailed-code verification.';
comment on table public.cfa_concierge_messages is
  'Site concierge transcript in Messages API shape, append-only. Service-role only.';
comment on table public.cfa_concierge_verifications is
  'Emailed six-digit codes (hashed) for concierge identity checks. Service-role only.';
comment on table public.cfa_concierge_config is
  'Single row: the concierge system prompt (operating rules). Kept out of the public repo.';
