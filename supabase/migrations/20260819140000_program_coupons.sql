-- Percent-off coupon codes for first-party registration.
--
-- Server-authoritative like program_offers: the browser submits only a code;
-- pricing math happens in cfa-register. A 100% coupon produces a $0
-- registration that never touches the payment gateway. Claims are atomic and
-- counted; a claim happens after the registration row exists and before any
-- charge, so an exhausted code can never produce a charge.

create table public.program_coupons (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  program_id uuid not null,
  code text not null check (code = upper(btrim(code)) and length(code) between 3 and 40),
  percent_off integer not null check (percent_off between 1 and 100),
  note text,
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  max_uses integer check (max_uses is null or max_uses > 0),
  use_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (client_id, program_id, code)
);

alter table public.program_coupons enable row level security;
revoke all on table public.program_coupons from public, anon, authenticated;

alter table public.registrations
  add column coupon_code text,
  add column discount_cents integer not null default 0;

create or replace function public.cfa_claim_coupon(
  requested_coupon_id uuid,
  requested_registration_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_count integer;
begin
  update public.program_coupons
  set use_count = use_count + 1
  where id = requested_coupon_id
    and active
    and (starts_at is null or starts_at <= now())
    and (ends_at is null or ends_at > now())
    and (max_uses is null or use_count < max_uses);

  get diagnostics claimed_count = row_count;
  if claimed_count = 1 then
    update public.registrations
    set coupon_code = (select code from public.program_coupons where id = requested_coupon_id)
    where id = requested_registration_id;
  end if;
  return claimed_count = 1;
end;
$$;

revoke all on function public.cfa_claim_coupon(uuid, uuid) from public, anon, authenticated;
grant execute on function public.cfa_claim_coupon(uuid, uuid) to service_role;
