-- Milan, 2026-09-28: "program directors (David in this case) need to see all of
-- them before they are sent out and actually most likely they should be sent
-- from their (David's now) email address with some nice cover letter like we
-- used to do in SimpleCerts."
--
-- The 9/11 stack renders and stores certificates; it has no way to send one.
-- This adds the sending half, and keeps the same shape as the rest of the stack:
-- a delivery is a named human act, recorded, and never automatic.

alter table public.cfa_certificate_templates
  add column signatures jsonb not null default '[]'::jsonb,
  add column sender_name text,
  add column sender_email text,
  add column cover_letter_subject text,
  add column cover_letter_body text;

comment on column public.cfa_certificate_templates.signatures is
  'Optional signature blocks drawn over the background. CfA Classic v1 carries David Barham and Lisa Mahar inside the artwork, so it stays empty; this is for designs whose printed signature line is wrong for the program.';
comment on column public.cfa_certificate_templates.sender_email is
  'The director address a certificate is sent from. Null means the program has not nominated one and sending is refused.';
comment on column public.cfa_certificate_templates.cover_letter_body is
  'Cover letter template. {{first_name}}, {{recipient_name}} and {{program_title}} are substituted; no other placeholder is honoured.';

create table public.cfa_certificate_deliveries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  certificate_id uuid not null references public.cfa_certificates(id) on delete restrict,
  to_email text not null check (position('@' in to_email) > 1),
  from_name text not null,
  from_email text not null check (position('@' in from_email) > 1),
  subject text not null,
  body text not null,
  sent_by text not null,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  provider_message_id text,
  error_detail text,
  created_at timestamptz not null default now()
);

-- One successful delivery per certificate. A resend is a deliberate act that has
-- to clear this index, not something a double-clicked button can do by accident.
create unique index cfa_certificate_deliveries_one_sent_idx
  on public.cfa_certificate_deliveries (certificate_id)
  where status = 'sent';
create index cfa_certificate_deliveries_recent_idx
  on public.cfa_certificate_deliveries (client_id, created_at desc);

alter table public.cfa_certificate_deliveries enable row level security;
revoke all on table public.cfa_certificate_deliveries from public, anon, authenticated;

comment on table public.cfa_certificate_deliveries is
  'Every certificate email CfA has sent, including failures. sent_by is the staff member who pressed send; there is no automatic path.';
