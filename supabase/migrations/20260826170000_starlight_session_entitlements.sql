-- Session-scoped Starlight access.
--
-- Existing enrollments and the full-series/institution offers keep full access.
-- The three $19 offers and $44 bundle snapshot their allowed sessions onto the
-- central enrollment when registration completes. A later full-series purchase
-- upgrades that same enrollment to full access without losing its audit trail.

alter table public.program_offers
  add column access_scope text not null default 'all'
    check (access_scope in ('all', 'sessions'));

alter table public.enrollments
  add column access_scope text not null default 'all'
    check (access_scope in ('all', 'sessions'));

create table public.program_offer_sessions (
  offer_id uuid not null references public.program_offers(id) on delete cascade,
  session_id uuid not null references public.cfa_learn_sessions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (offer_id, session_id)
);

create table public.enrollment_session_access (
  enrollment_id uuid not null references public.enrollments(id) on delete cascade,
  session_id uuid not null references public.cfa_learn_sessions(id) on delete cascade,
  source_offer_id uuid references public.program_offers(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (enrollment_id, session_id)
);

create index enrollment_session_access_session_idx
  on public.enrollment_session_access(session_id, enrollment_id);

alter table public.program_offer_sessions enable row level security;
alter table public.enrollment_session_access enable row level security;
revoke all on table public.program_offer_sessions from public, anon, authenticated;
revoke all on table public.enrollment_session_access from public, anon, authenticated;

with starlight_program as (
  select id, client_id
  from public.programs
  where client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
    and platform = 'thinkific'
    and platform_id = '3357450'
), offer_values(code, name, description, amount_cents) as (
  values
    ('single-rawson', 'Martyn Rawson session', 'September 5 live seminar, recording, and resources.', 1900),
    ('single-blanning', 'Adam Blanning session', 'October 31 live seminar, recording, and resources.', 1900),
    ('single-kaliks', 'Constanza Kaliks session', 'December 19 live seminar, recording, and resources.', 1900),
    ('three-session-bundle', 'Three-session bundle', 'Rawson, Blanning, and Kaliks live seminars, recordings, and resources.', 4400)
)
insert into public.program_offers (
  client_id, program_id, code, name, description, amount_cents, seat_count, access_scope, active
)
select
  program.client_id,
  program.id,
  offer.code,
  offer.name,
  offer.description,
  offer.amount_cents,
  1,
  'sessions',
  true
from starlight_program program
cross join offer_values offer
on conflict (program_id, code) do update set
  name = excluded.name,
  description = excluded.description,
  amount_cents = excluded.amount_cents,
  access_scope = 'sessions',
  active = true,
  updated_at = now();

update public.program_offers offer
set description = case offer.code
      when 'individual' then 'All 12 live seminars, recordings, and course resources for one participant.'
      when 'institution' then 'All 12 seminars for an institution; participant rosters are added separately.'
      else offer.description
    end,
    access_scope = 'all',
    updated_at = now()
from public.programs program
where offer.program_id = program.id
  and program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'thinkific'
  and program.platform_id = '3357450'
  and offer.code in ('individual', 'institution');

with mappings(offer_code, session_slug) as (
  values
    ('single-rawson', 'methods'),
    ('single-blanning', 'sensory-diet'),
    ('single-kaliks', 'citizenship'),
    ('three-session-bundle', 'methods'),
    ('three-session-bundle', 'sensory-diet'),
    ('three-session-bundle', 'citizenship')
)
insert into public.program_offer_sessions (offer_id, session_id)
select offer.id, session.id
from mappings mapping
join public.programs program
  on program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
 and program.platform = 'thinkific'
 and program.platform_id = '3357450'
join public.program_offers offer
  on offer.program_id = program.id
 and offer.code = mapping.offer_code
join public.cfa_learn_courses course
  on course.program_id = program.id
join public.cfa_learn_sessions session
  on session.course_id = course.id
 and session.slug = mapping.session_slug
on conflict do nothing;

-- Paid registrations for different offers are legitimate: a participant may
-- buy one session, another session later, or upgrade to the full series. Keep
-- the no-double-charge guard at the in-flight level, then separately prevent
-- buying the exact same offer twice.
drop index public.registrations_one_active_email_program_idx;
create unique index registrations_one_inflight_email_program_idx
  on public.registrations(client_id, program_id, lower(email))
  where status in ('processing', 'enrollment_pending');
create unique index registrations_one_paid_email_program_offer_idx
  on public.registrations(client_id, program_id, offer_id, lower(email))
  where status = 'paid';

create or replace function public.cfa_registration_has_offer_access(
  requested_client_id uuid,
  requested_program_id uuid,
  requested_offer_id uuid,
  requested_email text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_enrollment_id uuid;
  current_scope text;
  requested_scope text;
begin
  select enrollment.id, enrollment.access_scope
  into current_enrollment_id, current_scope
  from public.contacts contact
  join public.enrollments enrollment
    on enrollment.contact_id = contact.id
   and enrollment.client_id = contact.client_id
  where contact.client_id = requested_client_id
    and lower(contact.email) = lower(requested_email)
    and enrollment.program_id = requested_program_id
    and enrollment.status = 'registered'
    and enrollment.revoked_at is null
    and enrollment.access_starts_at <= now()
    and (enrollment.access_ends_at is null or enrollment.access_ends_at > now())
  limit 1;

  if current_enrollment_id is null then
    return false;
  end if;
  if current_scope = 'all' then
    return true;
  end if;

  select access_scope into requested_scope
  from public.program_offers
  where id = requested_offer_id
    and client_id = requested_client_id
    and program_id = requested_program_id;

  if requested_scope is null then
    raise exception 'offer_not_found';
  end if;
  if requested_scope = 'all' then
    return false;
  end if;
  if not exists (
    select 1 from public.program_offer_sessions
    where offer_id = requested_offer_id
  ) then
    raise exception 'session_offer_has_no_sessions';
  end if;

  return not exists (
    select 1
    from public.program_offer_sessions requested
    where requested.offer_id = requested_offer_id
      and not exists (
        select 1
        from public.enrollment_session_access owned
        where owned.enrollment_id = current_enrollment_id
          and owned.session_id = requested.session_id
      )
  );
end;
$$;

revoke all on function public.cfa_registration_has_offer_access(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.cfa_registration_has_offer_access(uuid, uuid, uuid, text)
  to service_role;

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
  offer_scope text;
  resolved_scope text;
begin
  select * into registration_record
  from public.registrations
  where id = requested_registration_id
  for update;

  if not found then raise exception 'registration_not_found'; end if;
  if registration_record.status = 'paid' then
    return query select registration_record.contact_id, registration_record.enrollment_id, registration_record.auth_user_id;
    return;
  end if;
  if registration_record.status not in ('initiated', 'processing', 'enrollment_pending') then
    raise exception 'registration_not_completable';
  end if;

  select access_scope into offer_scope
  from public.program_offers
  where id = registration_record.offer_id
    and client_id = registration_record.client_id
    and program_id = registration_record.program_id;
  if offer_scope is null then raise exception 'offer_not_found'; end if;
  if offer_scope = 'sessions' and not exists (
    select 1 from public.program_offer_sessions where offer_id = registration_record.offer_id
  ) then
    raise exception 'session_offer_has_no_sessions';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(registration_record.client_id::text || ':' || lower(registration_record.email), 0)
  );

  select id into resolved_user_id from auth.users
  where lower(email) = lower(registration_record.email) limit 1;
  if resolved_user_id is null then raise exception 'auth_user_not_found'; end if;

  select id into resolved_contact_id
  from public.contacts
  where client_id = registration_record.client_id
    and lower(email) = lower(registration_record.email)
  order by created_at limit 1;

  if resolved_contact_id is null then
    insert into public.contacts (
      client_id, email, first_name, last_name, company, record_type, source_code,
      tags, custom_fields, total_spent, order_count, first_order_date, last_order_date
    ) values (
      registration_record.client_id, lower(registration_record.email), registration_record.first_name,
      registration_record.last_name, registration_record.organization, 'contact', 'native-registration',
      array['starlight-rays-2026-2027'], jsonb_build_object('phone', registration_record.phone),
      registration_record.amount_cents::numeric / 100, 1, now(), now()
    ) returning id into resolved_contact_id;
  else
    update public.contacts
    set first_name = coalesce(nullif(registration_record.first_name, ''), first_name),
        last_name = coalesce(nullif(registration_record.last_name, ''), last_name),
        company = coalesce(nullif(registration_record.organization, ''), company),
        tags = case when 'starlight-rays-2026-2027' = any(coalesce(tags, '{}'::text[]))
          then tags else array_append(coalesce(tags, '{}'::text[]), 'starlight-rays-2026-2027') end,
        custom_fields = coalesce(custom_fields, '{}'::jsonb) || jsonb_build_object('phone', registration_record.phone),
        total_spent = coalesce(total_spent, 0) + registration_record.amount_cents::numeric / 100,
        order_count = coalesce(order_count, 0) + 1,
        first_order_date = coalesce(first_order_date, now()),
        last_order_date = now()
    where id = resolved_contact_id;
  end if;

  insert into public.client_auth_identities (client_id, contact_id, user_id)
  values (registration_record.client_id, resolved_contact_id, resolved_user_id)
  on conflict on constraint client_auth_identities_user_id_client_id_key do update set
    contact_id = excluded.contact_id, updated_at = now();

  insert into public.enrollments as current_enrollment (
    client_id, program_id, contact_id, status, enrolled_at, platform_enrollment_id,
    source, source_reference, access_starts_at, access_scope, raw_data
  ) values (
    registration_record.client_id, registration_record.program_id, resolved_contact_id,
    'registered', now(), registration_record.id::text, 'native', registration_record.id::text,
    now(), offer_scope,
    jsonb_build_object('offer_id', registration_record.offer_id, 'seat_count', registration_record.seat_count,
      'gateway', registration_record.gateway, 'gateway_transaction_id', requested_gateway_transaction_id)
  )
  on conflict on constraint enrollments_contact_id_program_id_key do update set
    status = 'registered', source = 'native', source_reference = registration_record.id::text,
    access_starts_at = now(), access_ends_at = null, revoked_at = null,
    access_scope = case when current_enrollment.access_scope = 'all' or excluded.access_scope = 'all'
      then 'all' else 'sessions' end,
    raw_data = current_enrollment.raw_data || excluded.raw_data,
    updated_at = now()
  returning id, access_scope into resolved_enrollment_id, resolved_scope;

  if resolved_scope = 'all' then
    delete from public.enrollment_session_access where enrollment_id = resolved_enrollment_id;
  else
    insert into public.enrollment_session_access (enrollment_id, session_id, source_offer_id)
    select resolved_enrollment_id, session_id, registration_record.offer_id
    from public.program_offer_sessions
    where offer_id = registration_record.offer_id
    on conflict (enrollment_id, session_id) do nothing;
  end if;

  update public.cfa_learn_profiles profile
  set contact_id = resolved_contact_id,
      display_name = coalesce(nullif(profile.display_name, ''), registration_record.first_name)
  where profile.user_id = resolved_user_id;
  insert into public.cfa_learn_profiles (user_id, contact_id, display_name)
  values (resolved_user_id, resolved_contact_id, registration_record.first_name)
  on conflict on constraint cfa_learn_profiles_pkey do nothing;

  update public.registrations
  set contact_id = resolved_contact_id, enrollment_id = resolved_enrollment_id,
      auth_user_id = resolved_user_id, status = 'paid',
      gateway_transaction_id = requested_gateway_transaction_id,
      gateway_response = coalesce(requested_gateway_response, '{}'::jsonb),
      failure_code = null, failure_message = null, paid_at = now()
  where id = registration_record.id;

  return query select resolved_contact_id, resolved_enrollment_id, resolved_user_id;
end;
$$;

revoke all on function public.cfa_complete_registration(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.cfa_complete_registration(uuid, text, jsonb)
  to service_role;
