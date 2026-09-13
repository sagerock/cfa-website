-- WLCD October 2026 residency — the first native registration for an in-person program.
--
-- Why: CfA's Waldorf Leadership & Community Development residency registers through
-- Cvent, whose only residency-only option is still labelled for the closed Yuba River
-- weekend, and Cvent is being wound down. Sage chose CfA's own checkout for the
-- October 9-13 Keene weekend (2026-09-12) rather than repairing a platform we are leaving.
--
-- Three generic capabilities are added so this is a pattern and not a one-off:
--   1. registration completion tags contacts with the program's own tag,
--      instead of the hard-coded Starlight tag;
--   2. an offer can be priced per seat, so a school can buy several seats in one payment;
--   3. a registration can carry the names of the people the buyer is registering.
--
-- Starlight behaviour is unchanged: its program tag is already
-- 'starlight-rays-2026-2027', and per-seat pricing defaults to off.

-- 1. Per-seat offers ---------------------------------------------------------

alter table public.program_offers
  add column if not exists per_seat boolean not null default false,
  add column if not exists min_seats integer not null default 1,
  add column if not exists max_seats integer;

comment on column public.program_offers.per_seat is
  'When true, amount_cents is the price of ONE seat and the buyer chooses how many.';
comment on column public.program_offers.min_seats is
  'Smallest seat count a per-seat offer accepts (a group rate can require three).';
comment on column public.program_offers.max_seats is
  'Largest seat count a per-seat offer accepts. Null falls back to seat_count.';

alter table public.program_offers
  drop constraint if exists program_offers_seat_range_check;
alter table public.program_offers
  add constraint program_offers_seat_range_check check (
    min_seats >= 1
    and (max_seats is null or max_seats >= min_seats)
    and (not per_seat or max_seats is not null)
  );

-- 2. Who the payment is for --------------------------------------------------

alter table public.registrations
  add column if not exists participants jsonb not null default '[]'::jsonb;

comment on column public.registrations.participants is
  'People this registration covers when the payer is not the only attendee: '
  '[{"first_name":"","last_name":"","email":""}]. Never card data.';

alter table public.registrations
  drop constraint if exists registrations_participants_check;
alter table public.registrations
  add constraint registrations_participants_check
  check (jsonb_typeof(participants) = 'array');

-- 3. Tag the contact with the program they actually bought -------------------

create or replace function public.cfa_complete_registration(
  requested_registration_id uuid,
  requested_gateway_transaction_id text,
  requested_gateway_response jsonb
)
returns table (contact_id uuid, enrollment_id uuid, user_id uuid)
language plpgsql
security definer
set search_path = ''
as $function$
#variable_conflict use_column
declare
  registration_record public.registrations%rowtype;
  resolved_contact_id uuid;
  resolved_enrollment_id uuid;
  resolved_user_id uuid;
  offer_scope text;
  resolved_scope text;
  program_tag text;
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

  -- The contact tag follows the program that was bought. Starlight's own tag is
  -- 'starlight-rays-2026-2027', so its behaviour here does not change.
  select tag into program_tag
  from public.programs
  where id = registration_record.program_id
    and client_id = registration_record.client_id;
  if program_tag is null or program_tag = '' then raise exception 'program_tag_missing'; end if;

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
      array[program_tag], jsonb_build_object('phone', registration_record.phone),
      registration_record.amount_cents::numeric / 100, 1, now(), now()
    ) returning id into resolved_contact_id;
  else
    update public.contacts
    set first_name = coalesce(nullif(registration_record.first_name, ''), first_name),
        last_name = coalesce(nullif(registration_record.last_name, ''), last_name),
        company = coalesce(nullif(registration_record.organization, ''), company),
        tags = case when program_tag = any(coalesce(tags, '{}'::text[]))
          then tags else array_append(coalesce(tags, '{}'::text[]), program_tag) end,
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
$function$;

revoke all on function public.cfa_complete_registration(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.cfa_complete_registration(uuid, text, jsonb)
  to service_role;

-- 4. The program and its two offers ------------------------------------------
--
-- $850 for one person; $680 a seat for three or more from one school, which is
-- Torin Finser's published 20% group discount expressed as a price.

insert into public.programs (client_id, name, year, format, platform, platform_id, tag, instructor, start_date, end_date)
values (
  '22500cd6-052a-42ff-a0cb-4f3ba9125dfd',
  'WLCD October Residency 2026',
  2026,
  'in-person',
  'native',
  'wlcd-october-2026',
  'wlcd-october-2026',
  'Karen Atkinson',
  date '2026-10-09',
  date '2026-10-13'
)
on conflict (client_id, platform, platform_id) do nothing;

insert into public.program_offers (
  client_id, program_id, code, name, description,
  amount_cents, currency, seat_count, access_scope, installment_count,
  per_seat, min_seats, max_seats, active, ends_at
)
select
  program.client_id, program.id, offer.code, offer.name, offer.description,
  offer.amount_cents, 'USD', offer.seat_count, 'all', 1,
  offer.per_seat, offer.min_seats, offer.max_seats, true,
  timestamptz '2026-10-09 12:00:00-04'
from public.programs program
cross join (values
  (
    'residency',
    'October residency — one participant',
    'Friday, October 9 through Tuesday, October 13, 2026 in Keene, New Hampshire. This weekend only, with no obligation to join the rest of the program.',
    85000, 1, false, 1, 1
  ),
  (
    'residency-group',
    'October residency — school group',
    'Three or more people from one school, at 20% off the individual rate. $680 a person.',
    68000, 1, true, 3, 12
  )
) as offer(code, name, description, amount_cents, seat_count, per_seat, min_seats, max_seats)
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native'
  and program.platform_id = 'wlcd-october-2026'
on conflict (program_id, code) do nothing;
