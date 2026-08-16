-- Remove a legacy explicit anonymous grant and index registration relationships.

revoke execute on function public.cfa_learn_has_access(uuid) from anon;

alter function public.update_programs_updated_at() set search_path = '';
alter function public.update_enrollments_updated_at() set search_path = '';
alter function public.update_updated_at_column() set search_path = '';

create index cfa_learn_courses_program_idx
  on public.cfa_learn_courses(program_id);
create index client_auth_identities_client_idx
  on public.client_auth_identities(client_id);
create index enrollments_contact_client_idx
  on public.enrollments(contact_id, client_id);
create index enrollments_program_client_idx
  on public.enrollments(program_id, client_id);
create index program_offers_client_active_idx
  on public.program_offers(client_id, active, program_id);
create index program_offers_program_client_idx
  on public.program_offers(program_id, client_id);
create index registrations_auth_user_idx
  on public.registrations(auth_user_id);
create index registrations_contact_client_idx
  on public.registrations(contact_id, client_id);
create index registrations_enrollment_idx
  on public.registrations(enrollment_id);
create index registrations_offer_client_idx
  on public.registrations(offer_id, client_id);
create index registrations_program_client_idx
  on public.registrations(program_id, client_id);
