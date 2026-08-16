-- Qualify conflict targets that overlap the function's output column names.

create or replace function public.cfa_complete_registration(
  requested_registration_id uuid,
  requested_gateway_transaction_id text,
  requested_gateway_response jsonb
)
returns table (contact_id uuid, enrollment_id uuid, user_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  registration_record public.registrations%rowtype;
  resolved_contact_id uuid;
  resolved_enrollment_id uuid;
  resolved_user_id uuid;
begin
  select * into registration_record
  from public.registrations
  where id = requested_registration_id
  for update;

  if not found then
    raise exception 'registration_not_found';
  end if;

  if registration_record.status = 'paid' then
    return query select
      registration_record.contact_id,
      registration_record.enrollment_id,
      registration_record.auth_user_id;
    return;
  end if;

  if registration_record.status not in ('initiated', 'processing', 'enrollment_pending') then
    raise exception 'registration_not_completable';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(registration_record.client_id::text || ':' || lower(registration_record.email), 0)
  );

  select id into resolved_user_id
  from auth.users
  where lower(email) = lower(registration_record.email)
  limit 1;

  if resolved_user_id is null then
    raise exception 'auth_user_not_found';
  end if;

  select id into resolved_contact_id
  from public.contacts
  where client_id = registration_record.client_id
    and lower(email) = lower(registration_record.email)
  order by created_at
  limit 1;

  if resolved_contact_id is null then
    insert into public.contacts (
      client_id,
      email,
      first_name,
      last_name,
      company,
      record_type,
      source_code,
      tags,
      custom_fields,
      total_spent,
      order_count,
      first_order_date,
      last_order_date
    ) values (
      registration_record.client_id,
      lower(registration_record.email),
      registration_record.first_name,
      registration_record.last_name,
      registration_record.organization,
      'contact',
      'native-registration',
      array['starlight-rays-2026-2027'],
      jsonb_build_object('phone', registration_record.phone),
      registration_record.amount_cents::numeric / 100,
      1,
      now(),
      now()
    ) returning id into resolved_contact_id;
  else
    update public.contacts
    set
      first_name = coalesce(nullif(registration_record.first_name, ''), first_name),
      last_name = coalesce(nullif(registration_record.last_name, ''), last_name),
      company = coalesce(nullif(registration_record.organization, ''), company),
      tags = case
        when 'starlight-rays-2026-2027' = any(coalesce(tags, '{}'::text[])) then tags
        else array_append(coalesce(tags, '{}'::text[]), 'starlight-rays-2026-2027')
      end,
      custom_fields = coalesce(custom_fields, '{}'::jsonb)
        || jsonb_build_object('phone', registration_record.phone),
      total_spent = coalesce(total_spent, 0) + registration_record.amount_cents::numeric / 100,
      order_count = coalesce(order_count, 0) + 1,
      first_order_date = coalesce(first_order_date, now()),
      last_order_date = now()
    where id = resolved_contact_id;
  end if;

  insert into public.client_auth_identities (client_id, contact_id, user_id)
  values (registration_record.client_id, resolved_contact_id, resolved_user_id)
  on conflict on constraint client_auth_identities_user_id_client_id_key do update set
    contact_id = excluded.contact_id,
    updated_at = now();

  insert into public.enrollments as current_enrollment (
    client_id,
    program_id,
    contact_id,
    status,
    enrolled_at,
    platform_enrollment_id,
    source,
    source_reference,
    access_starts_at,
    raw_data
  ) values (
    registration_record.client_id,
    registration_record.program_id,
    resolved_contact_id,
    'registered',
    now(),
    registration_record.id::text,
    'native',
    registration_record.id::text,
    now(),
    jsonb_build_object(
      'offer_id', registration_record.offer_id,
      'seat_count', registration_record.seat_count,
      'gateway', registration_record.gateway,
      'gateway_transaction_id', requested_gateway_transaction_id
    )
  )
  on conflict on constraint enrollments_contact_id_program_id_key do update set
    status = 'registered',
    source = 'native',
    source_reference = registration_record.id::text,
    access_starts_at = now(),
    access_ends_at = null,
    revoked_at = null,
    raw_data = current_enrollment.raw_data || excluded.raw_data,
    updated_at = now()
  returning id into resolved_enrollment_id;

  update public.cfa_learn_profiles as profile
  set contact_id = resolved_contact_id,
      display_name = coalesce(nullif(profile.display_name, ''), registration_record.first_name)
  where profile.user_id = resolved_user_id;

  insert into public.cfa_learn_profiles (user_id, contact_id, display_name)
  values (resolved_user_id, resolved_contact_id, registration_record.first_name)
  on conflict on constraint cfa_learn_profiles_pkey do nothing;

  update public.registrations
  set
    contact_id = resolved_contact_id,
    enrollment_id = resolved_enrollment_id,
    auth_user_id = resolved_user_id,
    status = 'paid',
    gateway_transaction_id = requested_gateway_transaction_id,
    gateway_response = coalesce(requested_gateway_response, '{}'::jsonb),
    failure_code = null,
    failure_message = null,
    paid_at = now()
  where id = registration_record.id;

  return query select resolved_contact_id, resolved_enrollment_id, resolved_user_id;
end;
$$;

revoke all on function public.cfa_complete_registration(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.cfa_complete_registration(uuid, text, jsonb) to service_role;
