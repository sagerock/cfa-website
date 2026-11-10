-- Free-event reminders: one email per registrant, sent once, never twice.
--
-- The first $0 events on learn.* (Mentor Training workshop Dec 9, WHiSTEP open
-- house Dec 12) promise "a reminder the day before and an hour before we
-- begin". cfa-learn-remind can't send those: it needs a cfa_learn course and
-- session, and free events have neither. This adds a small generic sender.
--
--   cfa_event_reminders       one row per reminder (event + timing): wording,
--                             send window, cc and skip lists. Rows start
--                             disabled; a reminder is scheduled by setting
--                             enabled = true once CfA has OK'd the wording
--                             and a test copy (Caitlin decides wording and
--                             timing).
--   cfa_event_reminder_sends  one row per (reminder, registration). The unique
--                             key is the reservation: the edge function inserts
--                             it BEFORE calling SendGrid, so a second run, a
--                             retry or a parallel caller finds the row and
--                             sends nothing. A 'failed' row (SendGrid refused,
--                             nothing delivered) may be retried; a 'sending'
--                             row (delivery unknown) is never retried.
--   cfa_event_reminder_recipients(key)
--                             who is eligible: completed registrations for the
--                             reminder's program, not test, not voided or
--                             refunded/cancelled, enrollment not revoked, email
--                             not on the reminder's skip list. Both the runner
--                             (sagerock-jobs cfa-event-reminders) and the edge
--                             function use it, so a caller can't send to
--                             someone outside it.
--
-- Service role only: RLS on, no policies.

create table if not exists public.cfa_event_reminders (
  key text primary key check (key ~ '^[a-z0-9][a-z0-9-]{2,99}$'),
  client_id uuid not null default '22500cd6-052a-42ff-a0cb-4f3ba9125dfd',
  program_platform_id text not null,
  label text not null,
  subject text not null,
  -- Plain text. {first_name} is replaced with the registrant's first name.
  body_template text not null,
  send_at timestamptz not null,
  -- Last moment the runner may still send it (a one-hour reminder must not go
  -- out after the event has started).
  stop_at timestamptz not null,
  enabled boolean not null default false,
  cc_emails text[] not null default '{}',
  skip_emails text[] not null default '{}',
  approved_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (stop_at > send_at)
);

create table if not exists public.cfa_event_reminder_sends (
  id uuid primary key default gen_random_uuid(),
  reminder_key text not null references public.cfa_event_reminders(key),
  registration_id uuid not null references public.registrations(id),
  recipient_email text not null,
  cc_emails text[] not null default '{}',
  status text not null default 'sending' check (status in ('sending', 'sent', 'failed')),
  provider_message_id text,
  error text,
  attempts integer not null default 1,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (reminder_key, registration_id)
);

alter table public.cfa_event_reminders enable row level security;
alter table public.cfa_event_reminder_sends enable row level security;
revoke all on public.cfa_event_reminders from anon, authenticated;
revoke all on public.cfa_event_reminder_sends from anon, authenticated;

create or replace function public.cfa_event_reminder_recipients(requested_key text)
returns table (
  registration_id uuid,
  email text,
  first_name text,
  already text
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (lower(trim(r.email)))
    r.id,
    lower(trim(r.email)),
    nullif(trim(r.first_name), ''),
    s.status
  from public.cfa_event_reminders rem
  join public.programs p
    on p.client_id = rem.client_id
   and p.platform = 'native'
   and p.platform_id = rem.program_platform_id
  join public.registrations r
    on r.program_id = p.id
   and r.client_id = rem.client_id
  left join public.enrollments e on e.id = r.enrollment_id
  left join public.cfa_event_reminder_sends s
    on s.reminder_key = rem.key and s.registration_id = r.id
  where rem.key = requested_key
    and r.status = 'paid'
    and r.is_test = false
    and r.voided_at is null
    and r.enrollment_id is not null
    and e.status = 'registered'
    and e.revoked_at is null
    and lower(trim(r.email)) <> all (select lower(trim(x)) from unnest(rem.skip_emails) x)
  -- One email per address even if someone registered twice: the earliest
  -- registration is the one that carries the send record.
  order by lower(trim(r.email)), r.created_at
$$;

revoke all on function public.cfa_event_reminder_recipients(text) from public, anon, authenticated;
grant execute on function public.cfa_event_reminder_recipients(text) to service_role;

-- Mentor Training workshop, Wednesday December 9, 7:00 PM ET, Zoom room 3.
-- Wording and both times approved by Caitlin 2026-11-09 (thread "You're
-- registered: The Art of the Mentoring Conversation"); Karen chose option 1 the
-- same day, so the question-form line goes in the day-before reminder.
-- Disabled until Caitlin OKs the test copies.
insert into public.cfa_event_reminders (
  key, program_platform_id, label, subject, body_template, send_at, stop_at,
  enabled, cc_emails, skip_emails, approved_note
) values (
  'mt-open-house-2026-12-09-day-before',
  'mentor-training-open-house-2026-12-09',
  'Mentor Training workshop Dec 9: day-before reminder',
  'Tomorrow: The Art of the Mentoring Conversation, 7:00 PM Eastern',
  E'Dear {first_name},\n\n'
  || 'A reminder that The Art of the Mentoring Conversation, a free Mentor Training workshop with Karen Atkinson, '
  || E'is tomorrow, Wednesday, December 9, at 7:00 PM Eastern (60 minutes), on Zoom.\n\n'
  || E'Join here: https://centerforanthroposophy.org/zoomroom3\n\n'
  || 'Is there a question you''d like to bring? Share it here: '
  || E'https://docs.google.com/forms/d/e/1FAIpQLScPO7pR40e0DYFSSPNCfcepDLxjLMU1xUUWZU45zRGTw0SW-A/viewform\n\n'
  || E'Questions? Reply to this email or write to office@centerforanthroposophy.org.\n\n'
  || E'Warmly,\nCenter for Anthroposophy',
  timestamptz '2026-12-08 19:00:00-05',
  timestamptz '2026-12-09 12:00:00-05',
  false,
  array['caitlin@centerforanthroposophy.org'],
  array['jax@centerforanthroposophy.org'],
  'Caitlin OK 2026-11-09 (wording + time); Karen option 1 2026-11-09 (question line)'
), (
  'mt-open-house-2026-12-09-one-hour',
  'mentor-training-open-house-2026-12-09',
  'Mentor Training workshop Dec 9: one-hour reminder',
  'Starting in one hour: The Art of the Mentoring Conversation',
  E'Dear {first_name},\n\n'
  || E'The Art of the Mentoring Conversation with Karen Atkinson begins in one hour, at 7:00 PM Eastern.\n\n'
  || E'Join here: https://centerforanthroposophy.org/zoomroom3\n\n'
  || E'Questions? Reply to this email or write to office@centerforanthroposophy.org.\n\n'
  || E'Warmly,\nCenter for Anthroposophy',
  timestamptz '2026-12-09 18:00:00-05',
  timestamptz '2026-12-09 18:55:00-05',
  false,
  array['caitlin@centerforanthroposophy.org'],
  array['jax@centerforanthroposophy.org'],
  'Caitlin OK 2026-11-09 (wording + time)'
)
on conflict (key) do nothing;
