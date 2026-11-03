-- Institution packs (Starlight Rays, 2026-11-03, Sage's yes on Today item #2311).
-- Institution behavior was keyed to the literal offer code 'institution'. Any offer
-- whose code is 'institution' or starts with 'institution-' is now an institution
-- registration (organization + roster link), and roster members inherit the offer's
-- access scope, so a session pack seats its teachers in only the pack's sessions.

CREATE OR REPLACE FUNCTION public.cfa_complete_institution_registration(requested_registration_id uuid, requested_gateway_transaction_id text, requested_gateway_response jsonb, requested_roster_token_hash text, requested_token_expires_at timestamp with time zone)
 RETURNS TABLE(contact_id uuid, roster_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  registration_record public.registrations%rowtype;
  resolved_contact_id uuid;
  resolved_roster_id uuid;
  contact_count integer;
  institution_seat_limit integer;
begin
  if requested_roster_token_hash is null
    or requested_roster_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_roster_token_hash';
  end if;

  select registration.* into registration_record
  from public.registrations registration
  join public.program_offers offer
    on offer.id = registration.offer_id
   and offer.client_id = registration.client_id
  where registration.id = requested_registration_id
    and (offer.code = 'institution' or offer.code like 'institution-%')
  for update of registration;

  if not found then raise exception 'institution_registration_not_found'; end if;

  if registration_record.status = 'paid' then
    select registration_record.contact_id, roster.id
    into resolved_contact_id, resolved_roster_id
    from public.institution_rosters roster
    where roster.registration_id = registration_record.id;
    if resolved_roster_id is null then raise exception 'institution_roster_not_found'; end if;
    return query select resolved_contact_id, resolved_roster_id;
    return;
  end if;

  if registration_record.status not in ('initiated', 'processing', 'enrollment_pending') then
    raise exception 'registration_not_completable';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      registration_record.client_id::text || ':' || lower(registration_record.email),
      0
    )
  );

  select count(*) into contact_count
  from public.contacts
  where client_id = registration_record.client_id
    and lower(email) = lower(registration_record.email);

  if contact_count > 1 then
    raise exception 'duplicate_contact_email';
  elsif contact_count = 0 then
    insert into public.contacts (
      client_id, email, first_name, last_name, company, record_type, source_code,
      tags, custom_fields, total_spent, order_count, first_order_date, last_order_date
    ) values (
      registration_record.client_id, lower(registration_record.email),
      registration_record.first_name, registration_record.last_name,
      registration_record.organization, 'contact', 'native-registration',
      array['starlight-rays-2026-2027', 'institution-purchaser'],
      jsonb_build_object('phone', registration_record.phone),
      registration_record.amount_cents::numeric / 100, 1, now(), now()
    ) returning id into resolved_contact_id;
  else
    select id into resolved_contact_id
    from public.contacts
    where client_id = registration_record.client_id
      and lower(email) = lower(registration_record.email);

    update public.contacts
    set first_name = coalesce(nullif(registration_record.first_name, ''), first_name),
        last_name = coalesce(nullif(registration_record.last_name, ''), last_name),
        company = coalesce(nullif(registration_record.organization, ''), company),
        tags = (
          select array_agg(distinct tag)
          from unnest(
            coalesce(tags, '{}'::text[])
              || array['starlight-rays-2026-2027', 'institution-purchaser']
          ) tag
        ),
        custom_fields = coalesce(custom_fields, '{}'::jsonb)
          || jsonb_build_object('phone', registration_record.phone),
        total_spent = coalesce(total_spent, 0) + registration_record.amount_cents::numeric / 100,
        order_count = coalesce(order_count, 0) + 1,
        first_order_date = coalesce(first_order_date, now()),
        last_order_date = now(),
        updated_at = now()
    where id = resolved_contact_id;
  end if;

  select seat_count into institution_seat_limit
  from public.program_offers
  where id = registration_record.offer_id;

  insert into public.institution_rosters (
    registration_id, client_id, program_id, organization, token_hash,
    token_expires_at, seat_limit
  ) values (
    registration_record.id, registration_record.client_id,
    registration_record.program_id, registration_record.organization,
    requested_roster_token_hash, requested_token_expires_at,
    greatest(1, coalesce(institution_seat_limit, 20))
  )
  returning id into resolved_roster_id;

  update public.registrations
  set contact_id = resolved_contact_id,
      enrollment_id = null,
      auth_user_id = null,
      status = 'paid',
      gateway_transaction_id = requested_gateway_transaction_id,
      gateway_response = coalesce(requested_gateway_response, '{}'::jsonb),
      failure_code = null,
      failure_message = null,
      paid_at = coalesce(paid_at, now())
  where id = registration_record.id;

  return query select resolved_contact_id, resolved_roster_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cfa_provision_institution_roster_member(requested_roster_id uuid, requested_member_id uuid, requested_user_id uuid)
 RETURNS TABLE(contact_id uuid, enrollment_id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  roster_record public.institution_rosters%rowtype;
  member_record public.institution_roster_members%rowtype;
  resolved_contact_id uuid;
  resolved_enrollment_id uuid;
  contact_count integer;
  auth_email text;
  identity_contact_id uuid;
  roster_offer_id uuid;
  offer_scope text;
  resolved_scope text;
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

  -- A roster seat carries the institution offer's scope: the full-season
  -- 'institution' offer grants every session, a pack such as
  -- 'institution-eight-session' grants only its mapped sessions.
  select offer.id, offer.access_scope into roster_offer_id, offer_scope
  from public.registrations registration
  join public.program_offers offer on offer.id = registration.offer_id
  where registration.id = roster_record.registration_id;
  offer_scope := coalesce(offer_scope, 'all');
  if offer_scope = 'sessions' and not exists (
    select 1 from public.program_offer_sessions where offer_id = roster_offer_id
  ) then
    raise exception 'session_offer_has_no_sessions';
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
    now(), offer_scope,
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
    access_scope = case when current_enrollment.access_scope = 'all' or excluded.access_scope = 'all'
      then 'all' else 'sessions' end,
    raw_data = coalesce(current_enrollment.raw_data, '{}'::jsonb) || excluded.raw_data,
    updated_at = now()
  returning id, access_scope into resolved_enrollment_id, resolved_scope;

  if resolved_scope = 'all' then
    delete from public.enrollment_session_access session_access
    where session_access.enrollment_id = resolved_enrollment_id;
  else
    insert into public.enrollment_session_access (enrollment_id, session_id, source_offer_id)
    select resolved_enrollment_id, session_id, roster_offer_id
    from public.program_offer_sessions
    where offer_id = roster_offer_id
    on conflict (enrollment_id, session_id) do nothing;
  end if;

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
$function$;
