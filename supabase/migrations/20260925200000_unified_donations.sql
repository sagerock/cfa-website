-- Unified donation form (staged 2026-09-25, NOT applied).
--
-- One table for every gift made through the new /donate form: one-time and
-- monthly card gifts charged through Authorize.Net, and check pledges that are
-- recorded without charging. It replaces the entries WordPress Gravity Forms
-- 97, 114, 5 and 96 keep today.
--
-- Service-role only. The cfa-donate edge function is the only writer; staff
-- read it through the dashboard or SQL. Nothing here is exposed to anon or
-- authenticated users, and no card data is ever stored (Authorize.Net keeps the
-- card; we keep its transaction, profile and subscription ids).
--
-- Amounts are integer cents. `total_cents` is ONE charge (gift + covered fee);
-- a monthly gift repeats it `months` times, and `schedule_total_cents` is the
-- whole commitment.

create table public.donations (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  idempotency_key uuid,
  source text not null default 'web' check (source in ('web', 'staff')),
  status text not null check (status in (
    'processing',     -- card charge in flight
    'paid',           -- card charge approved
    'pledged',        -- check promised online, not yet received
    'check_received', -- staff recorded the check; receipt goes out
    'failed',         -- card declined; the donor may retry with the same key
    'needs_review'    -- gateway result unknown or held; a person must look
  )),
  is_test boolean not null default false,

  fund text not null check (fund ~ '^[a-z0-9-]{1,80}$'),
  fund_note text check (char_length(fund_note) <= 1000),
  frequency text not null check (frequency in ('once', 'monthly')),
  months smallint not null default 1 check (months in (1, 3, 6, 12)),
  method text not null check (method in ('card', 'check')),

  gift_cents integer not null check (gift_cents > 0),
  fee_covered_cents integer not null default 0 check (fee_covered_cents >= 0),
  total_cents integer not null,
  schedule_total_cents integer not null,
  currency text not null default 'USD' check (currency = 'USD'),

  first_name text not null check (char_length(first_name) between 1 and 100),
  last_name text not null check (char_length(last_name) between 1 and 100),
  email text not null check (char_length(email) between 3 and 254),
  phone text check (char_length(phone) <= 50),
  mailing_address jsonb not null default '{}'::jsonb,
  anonymous boolean not null default false,
  newsletter_opt_in boolean not null default false,
  planned_giving_info boolean not null default false,
  tribute_type text check (tribute_type in ('honor', 'memory')),
  tribute_name text check (char_length(tribute_name) <= 200),

  gateway_environment text check (gateway_environment in ('sandbox', 'production')),
  gateway_transaction_id text,
  gateway_response jsonb not null default '{}'::jsonb,
  customer_profile_id text,
  payment_profile_id text,
  subscription_id text,
  schedule_status text not null default 'not_applicable'
    check (schedule_status in ('not_applicable', 'active', 'needs_attention', 'cancelled')),
  next_charge_on date,
  final_charge_on date,

  check_number text check (char_length(check_number) <= 40),
  check_received_on date,
  check_amount_cents integer check (check_amount_cents > 0),

  failure_code text,
  failure_message text,
  ip_hash text,
  attribution jsonb not null default '{}'::jsonb,

  paid_at timestamptz,
  pledged_at timestamptz,
  receipt_sent_at timestamptz,
  pledge_email_sent_at timestamptz,
  staff_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- The server's amount math, enforced again by the database.
  constraint donations_total_is_gift_plus_fee check (total_cents = gift_cents + fee_covered_cents),
  constraint donations_schedule_total check (schedule_total_cents = total_cents * months),
  constraint donations_once_is_one_payment check ((frequency = 'once') = (months = 1)),
  constraint donations_check_has_no_fee check (method = 'card' or fee_covered_cents = 0),
  constraint donations_check_is_one_time check (method = 'card' or frequency = 'once'),
  constraint donations_web_needs_key check (source = 'staff' or idempotency_key is not null),
  constraint donations_card_statuses check (
    method = 'card' and status in ('processing', 'paid', 'failed', 'needs_review')
    or method = 'check' and status in ('pledged', 'check_received')
  ),
  constraint donations_check_received_complete check (
    status <> 'check_received'
    or (check_received_on is not null and check_amount_cents is not null)
  ),
  constraint donations_tribute_named check ((tribute_type is null) = (tribute_name is null))
);

comment on table public.donations is
  'Gifts from the unified /donate form (cfa-donate). Service-role only. Staged 2026-09-25.';

-- One row per checkout attempt: a double-click or retry with the same key can
-- never become a second charge.
create unique index donations_idempotency_key_idx
  on public.donations(client_id, idempotency_key)
  where idempotency_key is not null;

create index donations_client_created_idx on public.donations(client_id, created_at desc);
create index donations_email_created_idx on public.donations(client_id, email, created_at desc);
create index donations_ip_created_idx on public.donations(client_id, ip_hash, created_at desc)
  where ip_hash is not null;
create index donations_open_status_idx on public.donations(client_id, status)
  where status in ('pledged', 'needs_review', 'processing');
create index donations_subscription_idx on public.donations(subscription_id)
  where subscription_id is not null;

create trigger donations_updated_at
before update on public.donations
for each row execute function public.update_updated_at_column();

alter table public.donations enable row level security;
-- No policies on purpose: with RLS on and no policy, only service_role (which
-- bypasses RLS) can read or write.
revoke all on table public.donations from public, anon, authenticated;
grant select, insert, update on table public.donations to service_role;

-- Staff: a check has arrived. Either completes an online pledge
-- (requested_donation_id) or records a check that was simply mailed in
-- (requested_donation_id null, donor details supplied). Returns the row; the
-- edge function then sends the receipt and stamps receipt_sent_at.
-- Idempotent: marking the same pledge again with the same check number returns
-- it unchanged; a different number is refused.
create or replace function public.cfa_mark_donation_check_received(
  requested_client_id uuid,
  requested_donation_id uuid,
  requested_check_number text,
  requested_received_on date,
  requested_amount_cents integer,
  requested_donor jsonb default null
)
returns setof public.donations
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing public.donations;
  donor jsonb := coalesce(requested_donor, '{}'::jsonb);
begin
  if requested_amount_cents is null or requested_amount_cents <= 0 then
    raise exception 'Check amount must be positive';
  end if;
  if requested_received_on is null or requested_received_on > current_date + 1 then
    raise exception 'Check received date is required and cannot be in the future';
  end if;

  if requested_donation_id is not null then
    select * into existing from public.donations
    where id = requested_donation_id and client_id = requested_client_id
    for update;
    if not found then
      raise exception 'Donation not found';
    end if;
    if existing.method <> 'check' then
      raise exception 'Donation is not a check pledge';
    end if;
    if existing.status = 'check_received' then
      if existing.check_number is not distinct from nullif(trim(requested_check_number), '') then
        return next existing;
        return;
      end if;
      raise exception 'Check already recorded for this pledge';
    end if;
    return query
      update public.donations set
        status = 'check_received',
        check_number = nullif(trim(requested_check_number), ''),
        check_received_on = requested_received_on,
        check_amount_cents = requested_amount_cents
      where id = existing.id
      returning *;
    return;
  end if;

  if coalesce(trim(donor->>'first_name'), '') = ''
     or coalesce(trim(donor->>'last_name'), '') = ''
     or coalesce(trim(donor->>'email'), '') = '' then
    raise exception 'Donor first name, last name and email are required for a mailed check';
  end if;
  return query
    insert into public.donations (
      client_id, source, status, fund, fund_note, frequency, months, method,
      gift_cents, fee_covered_cents, total_cents, schedule_total_cents,
      first_name, last_name, email, phone, mailing_address,
      anonymous, newsletter_opt_in, planned_giving_info,
      check_number, check_received_on, check_amount_cents
    ) values (
      requested_client_id, 'staff', 'check_received',
      coalesce(nullif(donor->>'fund', ''), 'general-support'), nullif(donor->>'note', ''),
      'once', 1, 'check',
      requested_amount_cents, 0, requested_amount_cents, requested_amount_cents,
      trim(donor->>'first_name'), trim(donor->>'last_name'), lower(trim(donor->>'email')),
      nullif(donor->>'phone', ''), coalesce(donor->'address', '{}'::jsonb),
      coalesce((donor->>'anonymous')::boolean, false), false, false,
      nullif(trim(requested_check_number), ''), requested_received_on, requested_amount_cents
    )
    returning *;
end;
$$;

revoke all on function public.cfa_mark_donation_check_received(uuid, uuid, text, date, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.cfa_mark_donation_check_received(uuid, uuid, text, date, integer, jsonb)
  to service_role;
