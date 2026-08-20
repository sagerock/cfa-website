-- Durable personal classroom links ("bookmark this and you're in").
--
-- Bulk emails can't carry 24-hour magic links; instead each enrollee gets a
-- long-lived personal token. The raw token appears only in their email; the
-- database stores its SHA-256. Clicking exchanges the token for a fresh
-- Supabase magic link server-side, so the session machinery is unchanged.
-- Links are per-enrollment: revoking the enrollment cascades away the link,
-- and individual links can be revoked or rotated. Uses are counted so a
-- leaked link is visible in the data.

create table public.cfa_learn_access_links (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid not null,
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz,
  revoked_at timestamptz,
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (contact_id, client_id) references public.contacts(id, client_id) on delete cascade
);

create index cfa_learn_access_links_enrollment_idx
  on public.cfa_learn_access_links(enrollment_id);

alter table public.cfa_learn_access_links enable row level security;
revoke all on table public.cfa_learn_access_links from public, anon, authenticated;
