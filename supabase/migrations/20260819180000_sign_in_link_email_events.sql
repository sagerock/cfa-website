-- Self-service sign-in links are sent by cfa-learn-signin (CfA-branded, via
-- SendGrid) instead of the shared project's Supabase Auth template, and every
-- send is recorded like welcomes are. The event log's message_type gains
-- 'sign_in_link'; the recorded events double as the rate-limit state.

alter table public.cfa_learn_email_events
  drop constraint cfa_learn_email_events_message_type_check;

alter table public.cfa_learn_email_events
  add constraint cfa_learn_email_events_message_type_check
  check (message_type in ('welcome', 'session_reminder', 'course_update', 'sign_in_link'));
