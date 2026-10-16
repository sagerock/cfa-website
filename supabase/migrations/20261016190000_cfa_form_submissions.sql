-- Kairos information forms on learn.* (financial aid, inquiry), replacing Gravity
-- Forms 84, 125 and 94 (2026-10-16). Written only by the cfa-forms function with the
-- service role; RLS on with no policies, so the public keys cannot read it.
-- Financial aid answers are personal financial data: staff read them here or in
-- the notification email, never in a public view.
create table if not exists public.cfa_form_submissions (
  id uuid primary key default gen_random_uuid(),
  form_key text not null,
  email text not null,
  first_name text,
  last_name text,
  data jsonb not null default '{}'::jsonb,
  source_path text,
  notified boolean not null default false,
  notify_error text,
  created_at timestamptz not null default now()
);

create index if not exists cfa_form_submissions_form_created_idx
  on public.cfa_form_submissions (form_key, created_at desc);

alter table public.cfa_form_submissions enable row level security;
revoke all on public.cfa_form_submissions from anon, authenticated;
