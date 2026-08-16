-- Prevent charging an email that already has access to the selected program.

create or replace function public.cfa_registration_has_access(
  requested_client_id uuid,
  requested_program_id uuid,
  requested_email text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.contacts as contact
    join public.enrollments as enrollment
      on enrollment.contact_id = contact.id
     and enrollment.client_id = contact.client_id
    where contact.client_id = requested_client_id
      and lower(contact.email) = lower(requested_email)
      and enrollment.program_id = requested_program_id
      and enrollment.status = 'registered'
  );
$$;

revoke all on function public.cfa_registration_has_access(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.cfa_registration_has_access(uuid, uuid, text)
  to service_role;
