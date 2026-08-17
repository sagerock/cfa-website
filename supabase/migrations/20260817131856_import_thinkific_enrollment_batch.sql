-- Transactional, idempotent import for reviewed Thinkific enrollment batches.

create or replace function public.cfa_import_thinkific_enrollment_batch(
  requested_batch_id text,
  requested_client_id uuid,
  requested_program_id uuid,
  requested_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item jsonb;
  normalized_email text;
  resolved_contact_id uuid;
  existing_enrollment public.enrollments%rowtype;
  contact_count integer;
  contacts_created integer := 0;
  contacts_reused integer := 0;
  enrollments_created integer := 0;
  enrollments_updated integer := 0;
begin
  if requested_batch_id is null or btrim(requested_batch_id) = '' then
    raise exception 'batch_id_required';
  end if;
  if jsonb_typeof(requested_rows) <> 'array' or jsonb_array_length(requested_rows) = 0 then
    raise exception 'rows_required';
  end if;
  if not exists (
    select 1
    from public.programs
    where id = requested_program_id
      and client_id = requested_client_id
      and platform = 'thinkific'
  ) then
    raise exception 'thinkific_program_not_found';
  end if;

  for item in select value from jsonb_array_elements(requested_rows)
  loop
    normalized_email := lower(btrim(item->>'email'));
    if normalized_email = ''
      or coalesce(item->>'platform_enrollment_id', '') = ''
      or coalesce(item->>'thinkific_user_id', '') = ''
      or coalesce(item->>'access_starts_at', '') = '' then
      raise exception 'invalid_import_row';
    end if;

    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(requested_client_id::text || ':' || normalized_email, 0)
    );

    select count(*)
    into contact_count
    from public.contacts
    where client_id = requested_client_id
      and lower(email) = normalized_email;

    if contact_count > 1 then
      raise exception 'duplicate_contact_email:%', normalized_email;
    elsif contact_count = 0 then
      insert into public.contacts (
        client_id,
        email,
        first_name,
        last_name,
        record_type,
        source_code,
        tags,
        custom_fields
      ) values (
        requested_client_id,
        normalized_email,
        nullif(item->>'first_name', ''),
        nullif(item->>'last_name', ''),
        'contact',
        'thinkific-migration',
        array['starlight-rays-2026-2027'],
        jsonb_strip_nulls(jsonb_build_object(
          'migration_batch_id', requested_batch_id,
          'thinkific_user_id', item->>'thinkific_user_id',
          'school', nullif(item->>'school', ''),
          'phone', nullif(item->>'phone', ''),
          'possible_duplicate_emails', nullif(item->>'possible_duplicate_emails', '')
        ))
      )
      returning id into resolved_contact_id;
      contacts_created := contacts_created + 1;
    else
      select id into resolved_contact_id
      from public.contacts
      where client_id = requested_client_id
        and lower(email) = normalized_email;

      update public.contacts
      set
        tags = case
          when 'starlight-rays-2026-2027' = any(coalesce(tags, '{}'::text[])) then tags
          else array_append(coalesce(tags, '{}'::text[]), 'starlight-rays-2026-2027')
        end,
        custom_fields = coalesce(custom_fields, '{}'::jsonb)
          || jsonb_strip_nulls(jsonb_build_object(
            'migration_batch_id', requested_batch_id,
            'thinkific_user_id', item->>'thinkific_user_id',
            'school', nullif(item->>'school', ''),
            'phone', nullif(item->>'phone', ''),
            'possible_duplicate_emails', nullif(item->>'possible_duplicate_emails', '')
          )),
        updated_at = now()
      where id = resolved_contact_id;
      contacts_reused := contacts_reused + 1;
    end if;

    select * into existing_enrollment
    from public.enrollments
    where contact_id = resolved_contact_id
      and program_id = requested_program_id
    for update;

    if found then
      if existing_enrollment.source not in ('thinkific', 'migration') then
        raise exception 'non_thinkific_enrollment_conflict:%', existing_enrollment.id;
      end if;
      update public.enrollments
      set
        status = 'registered',
        enrolled_at = (item->>'enrolled_at')::timestamptz,
        platform_enrollment_id = item->>'platform_enrollment_id',
        source = 'thinkific',
        source_reference = item->>'platform_enrollment_id',
        access_starts_at = (item->>'access_starts_at')::timestamptz,
        access_ends_at = nullif(item->>'access_ends_at', '')::timestamptz,
        revoked_at = null,
        raw_data = coalesce(raw_data, '{}'::jsonb)
          || coalesce(item->'raw_data', '{}'::jsonb)
          || jsonb_build_object('migration_batch_id', requested_batch_id),
        updated_at = now()
      where id = existing_enrollment.id;
      enrollments_updated := enrollments_updated + 1;
    else
      insert into public.enrollments (
        client_id,
        program_id,
        contact_id,
        status,
        enrolled_at,
        platform_enrollment_id,
        source,
        source_reference,
        access_starts_at,
        access_ends_at,
        raw_data
      ) values (
        requested_client_id,
        requested_program_id,
        resolved_contact_id,
        'registered',
        (item->>'enrolled_at')::timestamptz,
        item->>'platform_enrollment_id',
        'thinkific',
        item->>'platform_enrollment_id',
        (item->>'access_starts_at')::timestamptz,
        nullif(item->>'access_ends_at', '')::timestamptz,
        coalesce(item->'raw_data', '{}'::jsonb)
          || jsonb_build_object('migration_batch_id', requested_batch_id)
      );
      enrollments_created := enrollments_created + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'batch_id', requested_batch_id,
    'contacts_created', contacts_created,
    'contacts_reused', contacts_reused,
    'enrollments_created', enrollments_created,
    'enrollments_updated', enrollments_updated,
    'rows_processed', jsonb_array_length(requested_rows)
  );
end;
$$;

revoke all on function public.cfa_import_thinkific_enrollment_batch(text, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.cfa_import_thinkific_enrollment_batch(text, uuid, uuid, jsonb)
  to service_role;
