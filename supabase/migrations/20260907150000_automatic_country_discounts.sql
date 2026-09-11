-- Reusable, server-authoritative country pricing for CfA's native checkout.
--
-- Rules are client-wide by design, so every current and future offer handled by
-- the shared registration service receives the same adjustment. The checkout
-- may preview these rules, but the Edge Function always recalculates the final
-- amount from the submitted billing country.

create table public.automatic_discounts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  code text not null check (code = upper(btrim(code)) and length(code) between 3 and 40),
  label text not null check (length(btrim(label)) between 1 and 100),
  country_code text not null check (
    country_code = upper(btrim(country_code))
    and length(country_code) = 2
  ),
  percent_off integer not null check (percent_off between 1 and 100),
  active boolean not null default true,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now(),
  unique (client_id, code),
  unique (client_id, country_code)
);

alter table public.automatic_discounts enable row level security;
revoke all on table public.automatic_discounts from public, anon, authenticated;

alter table public.registrations
  add column automatic_discount_code text;

insert into public.automatic_discounts (
  client_id,
  code,
  label,
  country_code,
  percent_off
) values (
  '22500cd6-052a-42ff-a0cb-4f3ba9125dfd',
  'CANADA20',
  'Canadian tuition adjustment',
  'CA',
  20
);
