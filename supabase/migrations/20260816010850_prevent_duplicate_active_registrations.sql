-- Only one active checkout or paid registration may exist per email and program.
-- Failed, cancelled, and refunded records remain available for audit and retry.

create unique index registrations_one_active_email_program_idx
  on public.registrations(client_id, program_id, lower(email))
  where status in ('processing', 'paid', 'enrollment_pending');
