-- Qualify the identity lookup in the roster-member provisioning function.
-- Its table-return column named contact_id is also a PL/pgSQL output variable,
-- so the unqualified reference is ambiguous when the function first executes.

create or replace function public.cfa_provision_institution_roster_member(
  requested_roster_id uuid,
  requested_member_id uuid,
  requested_user_id uuid
)
returns table (contact_id uuid, enrollment_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  roster_record public.institution_rosters%rowtype;
  member_record public.institution_roster_members%rowtype;
  resolved_contact_id uuid;
  resolved_enrollment_id uuid;
  contact_count integer;
  auth_email text;
  identity_contact_id uuid;
begin
  select * into roster_record
  from public.institution_rosters
  where id = requested_roster_id
  for update;
  if not found then raise exception 'institution_roster_not_found'; end if;

  if not exists (
    select 1 from public.registrations
    where id = roster_record.registration_id
      and status = 'paid'
  ) then
    raise exception 'institution_registration_not_paid';
  end if;

  select * into member_record
  from public.institution_roster_members
  where id = requested_member_id
    and roster_id = requested_roster_id
  for update;
  if not found then raise exception 'institution_roster_member_not_found'; end if;

  select lower(email) into auth_email
  from auth.users
  where id = requested_user_id;
  if auth_email is null or auth_email <> lower(member_record.email) then
    raise exception 'auth_user_email_mismatch';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      roster_record.client_id::text || ':' || lower(member_record.email),
      0
    )
  );

  select count(*) into contact_count
  from public.contacts
  where client_id = roster_record.client_id
    and lower(email) = lower(member_record.email);

  if contact_count > 1 then
    raise exception 'duplicate_contact_email';
  elsif contact_count = 0 then
    insert into public.contacts (
      client_id, email, first_name, last_name, company, record_type, source_code,
      tags, custom_fields
    ) values (
      roster_record.client_id, lower(member_record.email), member_record.first_name,
      member_record.last_name, roster_record.organization, 'contact',
      'native-institution-roster', array['starlight-rays-2026-2027'],
      jsonb_build_object(
        'school', roster_record.organization,
        'title_role', member_record.title_role,
        'completed_middle_or_high_school_teacher_training',
          member_record.completed_teacher_training,
        'institution_roster_id', roster_record.id
      )
    ) returning id into resolved_contact_id;
  else
    select id into resolved_contact_id
    from public.contacts
    where client_id = roster_record.client_id
      and lower(email) = lower(member_record.email);

    update public.contacts
    set first_name = coalesce(nullif(member_record.first_name, ''), first_name),
        last_name = coalesce(nullif(member_record.last_name, ''), last_name),
        company = coalesce(nullif(roster_record.organization, ''), company),
        tags = case
          when 'starlight-rays-2026-2027' = any(coalesce(tags, '{}'::text[])) then tags
          else array_append(coalesce(tags, '{}'::text[]), 'starlight-rays-2026-2027')
        end,
        custom_fields = coalesce(custom_fields, '{}'::jsonb)
          || jsonb_build_object(
            'school', roster_record.organization,
            'title_role', member_record.title_role,
            'completed_middle_or_high_school_teacher_training',
              member_record.completed_teacher_training,
            'institution_roster_id', roster_record.id
          ),
        updated_at = now()
    where id = resolved_contact_id;
  end if;

  select identity.contact_id into identity_contact_id
  from public.client_auth_identities identity
  where identity.user_id = requested_user_id
    and identity.client_id = roster_record.client_id;
  if identity_contact_id is not null and identity_contact_id <> resolved_contact_id then
    raise exception 'identity_conflict';
  end if;

  insert into public.client_auth_identities (client_id, contact_id, user_id)
  values (roster_record.client_id, resolved_contact_id, requested_user_id)
  on conflict on constraint client_auth_identities_user_id_client_id_key do update set
    contact_id = excluded.contact_id,
    updated_at = now();

  insert into public.enrollments as current_enrollment (
    client_id, program_id, contact_id, status, enrolled_at,
    platform_enrollment_id, source, source_reference, access_starts_at,
    access_scope, raw_data
  ) values (
    roster_record.client_id, roster_record.program_id, resolved_contact_id,
    'registered', now(), member_record.id::text, 'native', member_record.id::text,
    now(), 'all',
    jsonb_build_object(
      'institution_roster_id', roster_record.id,
      'institution_roster_member_id', member_record.id,
      'institution_registration_id', roster_record.registration_id,
      'organization', roster_record.organization,
      'title_role', member_record.title_role,
      'completed_middle_or_high_school_teacher_training',
        member_record.completed_teacher_training
    )
  )
  on conflict on constraint enrollments_contact_id_program_id_key do update set
    status = 'registered',
    source = case
      when current_enrollment.source in ('thinkific', 'migration') then current_enrollment.source
      else 'native'
    end,
    source_reference = excluded.source_reference,
    access_starts_at = least(current_enrollment.access_starts_at, excluded.access_starts_at),
    access_ends_at = null,
    revoked_at = null,
    access_scope = 'all',
    raw_data = coalesce(current_enrollment.raw_data, '{}'::jsonb) || excluded.raw_data,
    updated_at = now()
  returning id into resolved_enrollment_id;

  delete from public.enrollment_session_access session_access
  where session_access.enrollment_id = resolved_enrollment_id;

  update public.cfa_learn_profiles profile
  set contact_id = resolved_contact_id,
      display_name = coalesce(nullif(profile.display_name, ''), member_record.first_name)
  where profile.user_id = requested_user_id;

  insert into public.cfa_learn_profiles (user_id, contact_id, display_name)
  values (requested_user_id, resolved_contact_id, member_record.first_name)
  on conflict on constraint cfa_learn_profiles_pkey do nothing;

  update public.institution_roster_members
  set status = 'provisioned',
      contact_id = resolved_contact_id,
      enrollment_id = resolved_enrollment_id,
      auth_user_id = requested_user_id,
      error_code = null,
      error_message = null
  where id = member_record.id;

  return query select resolved_contact_id, resolved_enrollment_id;
end;
$$;

revoke all on function public.cfa_provision_institution_roster_member(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.cfa_provision_institution_roster_member(uuid, uuid, uuid)
  to service_role;
