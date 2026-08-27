-- Institutional Starlight registrations are purchases for a school, not a
-- one-person enrollment. The purchaser receives a private roster link and the
-- people on that roster receive individual full-series enrollments.

create table public.institution_rosters (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references public.registrations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  program_id uuid not null,
  organization text not null,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  token_expires_at timestamptz,
  seat_limit integer not null default 20 check (seat_limit between 1 and 100),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'complete', 'needs_attention')),
  confirmation_sent_at timestamptz,
  confirmation_error text,
  last_opened_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (program_id, client_id)
    references public.programs(id, client_id)
    on delete cascade
);

create table public.institution_roster_members (
  id uuid primary key default gen_random_uuid(),
  roster_id uuid not null references public.institution_rosters(id) on delete cascade,
  sort_order integer not null check (sort_order between 1 and 100),
  first_name text not null,
  last_name text not null,
  email text not null,
  title_role text not null,
  completed_teacher_training boolean not null,
  status text not null default 'pending'
    check (status in ('pending', 'provisioning', 'provisioned', 'invited', 'failed')),
  contact_id uuid,
  enrollment_id uuid references public.enrollments(id) on delete set null,
  auth_user_id uuid references auth.users(id) on delete set null,
  welcome_sent_at timestamptz,
  error_code text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (roster_id, sort_order)
);

create unique index institution_roster_members_email_idx
  on public.institution_roster_members(roster_id, lower(email));
create index institution_rosters_status_created_idx
  on public.institution_rosters(status, created_at desc);
create index institution_roster_members_status_idx
  on public.institution_roster_members(roster_id, status);

create trigger institution_rosters_updated_at
before update on public.institution_rosters
for each row execute function public.update_updated_at_column();

create trigger institution_roster_members_updated_at
before update on public.institution_roster_members
for each row execute function public.update_updated_at_column();

alter table public.institution_rosters enable row level security;
alter table public.institution_roster_members enable row level security;
revoke all on table public.institution_rosters from public, anon, authenticated;
revoke all on table public.institution_roster_members from public, anon, authenticated;

-- Replace the editable portion of a roster atomically. Already provisioned
-- members cannot be removed or have their login email changed; they may have
-- their name, role, and training answer corrected. Pending/failed rows are
-- safely replaced by the reviewed submission.
create or replace function public.cfa_save_institution_roster(
  requested_roster_id uuid,
  requested_members jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  roster_record public.institution_rosters%rowtype;
  item jsonb;
  item_id uuid;
  existing_member public.institution_roster_members%rowtype;
  normalized_email text;
  row_count integer;
begin
  select * into roster_record
  from public.institution_rosters
  where id = requested_roster_id
  for update;
  if not found then raise exception 'institution_roster_not_found'; end if;

  if roster_record.status = 'processing'
    and roster_record.updated_at > now() - interval '5 minutes' then
    raise exception 'institution_roster_processing';
  end if;

  if jsonb_typeof(requested_members) <> 'array' then
    raise exception 'invalid_roster_members';
  end if;
  row_count := jsonb_array_length(requested_members);
  if row_count < 1 or row_count > roster_record.seat_limit then
    raise exception 'invalid_roster_size';
  end if;
  if (
    select count(*)
    from jsonb_array_elements(requested_members) member
  ) <> (
    select count(distinct lower(btrim(member->>'email')))
    from jsonb_array_elements(requested_members) member
  ) then
    raise exception 'duplicate_roster_email';
  end if;

  for item in select value from jsonb_array_elements(requested_members)
  loop
    normalized_email := lower(btrim(item->>'email'));
    if btrim(coalesce(item->>'first_name', '')) = ''
      or btrim(coalesce(item->>'last_name', '')) = ''
      or normalized_email = ''
      or normalized_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      or btrim(coalesce(item->>'title_role', '')) = ''
      or jsonb_typeof(item->'completed_teacher_training') <> 'boolean'
      or coalesce((item->>'sort_order')::integer, 0) < 1
      or (item->>'sort_order')::integer > roster_record.seat_limit then
      raise exception 'invalid_roster_member';
    end if;

    if nullif(item->>'id', '') is not null then
      item_id := (item->>'id')::uuid;
      if not exists (
        select 1 from public.institution_roster_members
        where id = item_id and roster_id = requested_roster_id
      ) then
        raise exception 'invalid_roster_member_reference';
      end if;
    end if;
  end loop;

  if exists (
    select 1
    from public.institution_roster_members existing
    where existing.roster_id = requested_roster_id
      and existing.status not in ('pending', 'failed')
      and not exists (
        select 1
        from jsonb_array_elements(requested_members) requested
        where nullif(requested->>'id', '')::uuid = existing.id
          or lower(btrim(requested->>'email')) = lower(existing.email)
      )
  ) then
    raise exception 'provisioned_member_cannot_be_removed';
  end if;

  with ranked as (
    select id, row_number() over (order by sort_order, id) as position
    from public.institution_roster_members
    where roster_id = requested_roster_id
  )
  update public.institution_roster_members member
  set sort_order = 50 + ranked.position
  from ranked
  where member.id = ranked.id;

  delete from public.institution_roster_members
  where roster_id = requested_roster_id
    and status in ('pending', 'failed');

  for item in select value from jsonb_array_elements(requested_members)
  loop
    item_id := null;
    normalized_email := lower(btrim(item->>'email'));
    if nullif(item->>'id', '') is not null then
      select * into existing_member
      from public.institution_roster_members
      where id = (item->>'id')::uuid
        and roster_id = requested_roster_id;
      if found then item_id := existing_member.id; end if;
    end if;
    if item_id is null then
      select * into existing_member
      from public.institution_roster_members
      where roster_id = requested_roster_id
        and lower(email) = normalized_email;
      if found then item_id := existing_member.id; end if;
    end if;

    if item_id is not null then
      if lower(existing_member.email) <> normalized_email then
        raise exception 'provisioned_email_cannot_change';
      end if;
      update public.institution_roster_members
      set sort_order = (item->>'sort_order')::integer,
          first_name = left(btrim(item->>'first_name'), 100),
          last_name = left(btrim(item->>'last_name'), 100),
          title_role = left(btrim(item->>'title_role'), 120),
          completed_teacher_training = (item->>'completed_teacher_training')::boolean
      where id = item_id;
    else
      insert into public.institution_roster_members (
        roster_id, sort_order, first_name, last_name, email, title_role,
        completed_teacher_training, status
      ) values (
        requested_roster_id, (item->>'sort_order')::integer,
        left(btrim(item->>'first_name'), 100),
        left(btrim(item->>'last_name'), 100), normalized_email,
        left(btrim(item->>'title_role'), 120),
        (item->>'completed_teacher_training')::boolean, 'pending'
      );
    end if;
  end loop;

  update public.institution_rosters
  set status = 'processing',
      submitted_at = now(),
      completed_at = null
  where id = requested_roster_id;

  return row_count;
end;
$$;

revoke all on function public.cfa_save_institution_roster(uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.cfa_save_institution_roster(uuid, jsonb)
  to service_role;

-- Mark a successful institution payment complete without creating a learner
-- identity or enrollment for the purchaser. The purchaser may add themselves
-- to the roster if they are also participating.
create or replace function public.cfa_complete_institution_registration(
  requested_registration_id uuid,
  requested_gateway_transaction_id text,
  requested_gateway_response jsonb,
  requested_roster_token_hash text,
  requested_token_expires_at timestamptz
)
returns table (contact_id uuid, roster_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
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
    and offer.code = 'institution'
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
$$;

revoke all on function public.cfa_complete_institution_registration(
  uuid, text, jsonb, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.cfa_complete_institution_registration(
  uuid, text, jsonb, text, timestamptz
) to service_role;

-- Provision one reviewed roster member. Auth user creation and email delivery
-- stay in the Edge Function; this transaction owns contact/identity/enrollment
-- consistency and is safe to retry.
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

-- The published offer now accurately represents the automated workflow and
-- covered seats. Presenter honorifics appear on the checkout cards.
update public.program_offers offer
set name = case offer.code
      when 'single-rawson' then 'Dr. Martyn Rawson session'
      when 'single-blanning' then 'Dr. Adam Blanning session'
      when 'single-kaliks' then 'Dr. Constanza Kaliks session'
      else offer.name
    end,
    description = case offer.code
      when 'institution' then 'All 12 live seminars, recordings, and course resources for up to 20 participants in an institution. Just share your roster of colleagues and consider it done!'
      else offer.description
    end,
    seat_count = case when offer.code = 'institution' then 20 else offer.seat_count end,
    updated_at = now()
from public.programs program
where offer.program_id = program.id
  and program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'thinkific'
  and program.platform_id = '3357450'
  and offer.code in ('institution', 'single-rawson', 'single-blanning', 'single-kaliks');
