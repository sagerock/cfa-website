-- Connect the learning pilot to the shared client/program/contact model and add
-- reusable first-party registration records. Payment card data never enters Postgres.

alter table public.programs
  drop constraint programs_platform_check;

alter table public.programs
  add constraint programs_platform_check
  check (platform in ('cvent', 'gravity_forms', 'thinkific', 'manual', 'native'));

alter table public.contacts
  add constraint contacts_id_client_id_key unique (id, client_id);

alter table public.programs
  add constraint programs_id_client_id_key unique (id, client_id);

alter table public.enrollments
  add column source text,
  add column source_reference text,
  add column access_starts_at timestamptz not null default now(),
  add column access_ends_at timestamptz,
  add column revoked_at timestamptz;

update public.enrollments enrollment
set source = coalesce(program.platform, 'migration')
from public.programs program
where program.id = enrollment.program_id;

alter table public.enrollments
  alter column source set not null,
  add constraint enrollments_source_check
    check (source in ('cvent', 'gravity_forms', 'thinkific', 'manual', 'native', 'migration')),
  add constraint enrollments_contact_client_fkey
    foreign key (contact_id, client_id)
    references public.contacts(id, client_id),
  add constraint enrollments_program_client_fkey
    foreign key (program_id, client_id)
    references public.programs(id, client_id),
  add constraint enrollments_access_dates_check
    check (access_ends_at is null or access_ends_at > access_starts_at);

create table public.client_auth_identities (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  contact_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_id),
  unique (contact_id, client_id),
  foreign key (contact_id, client_id)
    references public.contacts(id, client_id)
    on delete cascade
);

create table public.program_offers (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  program_id uuid not null,
  code text not null,
  name text not null,
  description text,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  seat_count integer not null default 1 check (seat_count > 0),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, code),
  unique (id, client_id),
  foreign key (program_id, client_id)
    references public.programs(id, client_id)
    on delete cascade,
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table public.registrations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  program_id uuid not null,
  offer_id uuid not null,
  contact_id uuid,
  enrollment_id uuid references public.enrollments(id),
  auth_user_id uuid references auth.users(id),
  idempotency_key uuid not null,
  status text not null default 'initiated'
    check (status in ('initiated', 'processing', 'paid', 'failed', 'enrollment_pending', 'refunded', 'cancelled')),
  email text not null,
  first_name text not null,
  last_name text not null,
  phone text,
  organization text,
  billing_address jsonb not null default '{}'::jsonb,
  amount_cents integer not null check (amount_cents > 0),
  currency text not null default 'USD' check (currency = 'USD'),
  seat_count integer not null default 1 check (seat_count > 0),
  marketing_opt_in boolean not null default false,
  terms_accepted_at timestamptz not null,
  gateway text not null default 'authorize_net' check (gateway = 'authorize_net'),
  gateway_environment text not null check (gateway_environment in ('sandbox', 'production')),
  gateway_transaction_id text,
  gateway_response jsonb not null default '{}'::jsonb,
  failure_code text,
  failure_message text,
  ip_hash text,
  paid_at timestamptz,
  welcome_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, idempotency_key),
  foreign key (program_id, client_id)
    references public.programs(id, client_id),
  foreign key (offer_id, client_id)
    references public.program_offers(id, client_id),
  foreign key (contact_id, client_id)
    references public.contacts(id, client_id)
);

create unique index registrations_gateway_transaction_idx
  on public.registrations(gateway, gateway_environment, gateway_transaction_id)
  where gateway_transaction_id is not null;
create index registrations_email_created_idx
  on public.registrations(client_id, email, created_at desc);
create index registrations_status_created_idx
  on public.registrations(status, created_at desc);

create trigger client_auth_identities_updated_at
before update on public.client_auth_identities
for each row execute function public.update_updated_at_column();

create trigger program_offers_updated_at
before update on public.program_offers
for each row execute function public.update_updated_at_column();

create trigger registrations_updated_at
before update on public.registrations
for each row execute function public.update_updated_at_column();

alter table public.client_auth_identities enable row level security;
alter table public.program_offers enable row level security;
alter table public.registrations enable row level security;

revoke all on table public.client_auth_identities from public, anon;
revoke all on table public.program_offers from public, anon;
revoke all on table public.registrations from public, anon;
grant select, insert, update, delete on table public.client_auth_identities to authenticated;
grant select, insert, update, delete on table public.program_offers to authenticated;
grant select, insert, update, delete on table public.registrations to authenticated;

create policy "Client members manage auth identities"
on public.client_auth_identities for all
to authenticated
using (public.can_access_client(client_id))
with check (public.can_access_client(client_id));

create policy "Client members manage program offers"
on public.program_offers for all
to authenticated
using (public.can_access_client(client_id))
with check (public.can_access_client(client_id));

create policy "Client members manage registrations"
on public.registrations for all
to authenticated
using (public.can_access_client(client_id))
with check (public.can_access_client(client_id));

insert into public.programs (
  client_id,
  name,
  year,
  format,
  platform,
  platform_id,
  tag,
  instructor,
  start_date,
  end_date
) values (
  '22500cd6-052a-42ff-a0cb-4f3ba9125dfd',
  'Starlight Rays 2026–2027',
  2026,
  'online',
  'thinkific',
  '3357450',
  'starlight-rays-2026-2027',
  'David Barham, M.Ed.',
  '2026-09-05',
  '2027-02-27'
)
on conflict (client_id, platform, platform_id) do update set
  name = excluded.name,
  year = excluded.year,
  format = excluded.format,
  tag = excluded.tag,
  instructor = excluded.instructor,
  start_date = excluded.start_date,
  end_date = excluded.end_date,
  updated_at = now();

alter table public.cfa_learn_courses
  add column program_id uuid references public.programs(id);

update public.cfa_learn_courses course
set
  slug = 'starlight-rays-2026-2027',
  title = 'Starlight Rays 2026–2027',
  program_id = program.id
from public.programs program
where course.source_system = 'thinkific'
  and course.source_course_id = '3357450'
  and program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'thinkific'
  and program.platform_id = '3357450';

alter table public.cfa_learn_courses
  alter column program_id set not null;

insert into public.program_offers (
  client_id,
  program_id,
  code,
  name,
  description,
  amount_cents,
  seat_count
)
select
  program.client_id,
  program.id,
  offer.code,
  offer.name,
  offer.description,
  offer.amount_cents,
  offer.seat_count
from public.programs program
cross join (
  values
    ('individual', 'Individual registration', 'Access for one participant.', 42000, 1),
    ('institution', 'Institution registration', 'Institution access; participant rosters are added separately.', 122000, 1)
) as offer(code, name, description, amount_cents, seat_count)
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'thinkific'
  and program.platform_id = '3357450';

do $$
declare
  pilot_user_id uuid;
  pilot_contact_id uuid;
  starlight_program_id uuid;
begin
  select id into pilot_user_id
  from auth.users
  where lower(email) = 'sage@sagerock.com'
  limit 1;

  select id into starlight_program_id
  from public.programs
  where client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
    and platform = 'thinkific'
    and platform_id = '3357450';

  if pilot_user_id is not null then
    select id into pilot_contact_id
    from public.contacts
    where client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
      and lower(email) = 'sage@sagerock.com'
    order by created_at
    limit 1;

    if pilot_contact_id is null then
      insert into public.contacts (
        client_id,
        email,
        first_name,
        last_name,
        record_type,
        source_code,
        tags
      ) values (
        '22500cd6-052a-42ff-a0cb-4f3ba9125dfd',
        'sage@sagerock.com',
        'Sage',
        'Lewis',
        'contact',
        'starlight-pilot',
        array['starlight-rays-2026-2027']
      ) returning id into pilot_contact_id;
    end if;

    insert into public.client_auth_identities (client_id, contact_id, user_id)
    values ('22500cd6-052a-42ff-a0cb-4f3ba9125dfd', pilot_contact_id, pilot_user_id);

    insert into public.enrollments (
      client_id,
      program_id,
      contact_id,
      status,
      enrolled_at,
      source,
      source_reference,
      raw_data
    ) values (
      '22500cd6-052a-42ff-a0cb-4f3ba9125dfd',
      starlight_program_id,
      pilot_contact_id,
      'registered',
      now(),
      'manual',
      'starlight-pilot',
      '{"role":"internal_test"}'::jsonb
    )
    on conflict (contact_id, program_id) do update set
      status = 'registered',
      source = excluded.source,
      source_reference = excluded.source_reference,
      revoked_at = null,
      updated_at = now();

    update public.cfa_learn_profiles
    set contact_id = pilot_contact_id
    where user_id = pilot_user_id;
  end if;
end;
$$;

alter table public.cfa_learn_profiles
  add constraint cfa_learn_profiles_contact_id_fkey
  foreign key (contact_id) references public.contacts(id) on delete set null;

create or replace function public.cfa_learn_has_access(requested_course_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.cfa_learn_courses course
    join public.programs program on program.id = course.program_id
    join public.client_auth_identities identity
      on identity.client_id = program.client_id
      and identity.user_id = auth.uid()
    join public.enrollments enrollment
      on enrollment.client_id = program.client_id
      and enrollment.program_id = program.id
      and enrollment.contact_id = identity.contact_id
    where course.id = requested_course_id
      and course.published
      and enrollment.status = 'registered'
      and enrollment.access_starts_at <= now()
      and (enrollment.access_ends_at is null or enrollment.access_ends_at > now())
      and enrollment.revoked_at is null
  );
$$;

revoke all on function public.cfa_learn_has_access(uuid) from public;
grant execute on function public.cfa_learn_has_access(uuid) to authenticated;

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
  on conflict (user_id, client_id) do update set
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
  on conflict (contact_id, program_id) do update set
    status = 'registered',
    source = 'native',
    source_reference = registration_record.id::text,
    access_starts_at = now(),
    access_ends_at = null,
    revoked_at = null,
    raw_data = current_enrollment.raw_data || excluded.raw_data,
    updated_at = now()
  returning id into resolved_enrollment_id;

  update public.cfa_learn_profiles
  set contact_id = resolved_contact_id,
      display_name = coalesce(nullif(display_name, ''), registration_record.first_name)
  where user_id = resolved_user_id;

  insert into public.cfa_learn_profiles (user_id, contact_id, display_name)
  values (resolved_user_id, resolved_contact_id, registration_record.first_name)
  on conflict (user_id) do nothing;

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
