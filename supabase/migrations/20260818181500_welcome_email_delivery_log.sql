-- Welcome emails are recorded against central enrollments, with resend lineage.
--
-- The email-event log was created in the first pilot against the legacy
-- cfa_learn_enrollments table; entitlements have since moved to the central
-- enrollments model. The table is empty, so the foreign key moves directly.
-- Learner-facing reads are dropped entirely: the learner data contract does not
-- include email history, so the log becomes service-role-only like the other
-- operational ledgers.

alter table public.cfa_learn_email_events
  drop constraint cfa_learn_email_events_enrollment_id_fkey;

alter table public.cfa_learn_email_events
  add constraint cfa_learn_email_events_enrollment_id_fkey
  foreign key (enrollment_id) references public.enrollments(id) on delete cascade;

alter table public.cfa_learn_email_events
  add column recipient_email text,
  add column resend_of uuid references public.cfa_learn_email_events(id) on delete set null;

drop policy if exists "Learners read their email history" on public.cfa_learn_email_events;
