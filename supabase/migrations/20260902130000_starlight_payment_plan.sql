-- Starlight Rays 5-payment plan (Sage, 2026-09-02).
--
-- A payment-plan offer is a normal program_offers row whose installment_count
-- is greater than 1. Its amount_cents is still the full price; cfa-register
-- splits it evenly (remainder on the first installment) so the server stays
-- the only pricing authority. Mechanism, chosen by Sage over pure ARB:
--
--   1. The Accept.js nonce creates an Authorize.Net customer payment profile
--      (CIM), so no card data ever reaches this database.
--   2. Installment 1 is charged synchronously from that profile, through the
--      same approval, idempotency, and enrollment path as a one-time purchase.
--      "Paid -> access" stays true; gate 7 still holds.
--   3. The remaining installments are an Authorize.Net ARB subscription created
--      from the same profile, monthly, starting one month after purchase.
--      Authorize.Net owns the schedule; cfa-plan-sync pulls its results back
--      into registration_installments.
--
-- registrations.amount_cents keeps the full contracted total, so existing
-- reports and contacts.total_spent reflect the commitment, and
-- registration_payment_plans.paid_cents tracks what has actually settled.

alter table public.program_offers
  add column installment_count integer not null default 1
    check (installment_count between 1 and 12);

create table public.registration_payment_plans (
  id uuid primary key default gen_random_uuid(),
  registration_id uuid not null unique references public.registrations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  gateway text not null default 'authorize_net',
  gateway_environment text not null check (gateway_environment in ('sandbox', 'production')),
  customer_profile_id text,
  payment_profile_id text,
  subscription_id text,
  total_cents integer not null check (total_cents > 0),
  installment_count integer not null check (installment_count between 2 and 12),
  installment_cents integer not null check (installment_cents > 0),
  first_installment_cents integer not null check (first_installment_cents > 0),
  paid_installments integer not null default 0 check (paid_installments >= 0),
  paid_cents integer not null default 0 check (paid_cents >= 0),
  next_charge_on date,
  final_charge_on date,
  -- pending: profile created, first charge not yet confirmed
  -- active: first charge settled and the ARB schedule exists
  -- schedule_pending: first charge settled but ARB creation failed; ops must create it
  -- past_due: Authorize.Net suspended the subscription after a failed installment
  -- completed: every installment settled
  -- cancelled: declined first charge, voided test, or cancelled by CfA
  -- needs_attention: sync saw a state it could not classify
  status text not null default 'pending'
    check (status in ('pending', 'active', 'schedule_pending', 'past_due', 'completed', 'cancelled', 'needs_attention')),
  gateway_status text,
  last_synced_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index registration_payment_plans_subscription_idx
  on public.registration_payment_plans(gateway, gateway_environment, subscription_id)
  where subscription_id is not null;
create index registration_payment_plans_status_idx
  on public.registration_payment_plans(status, next_charge_on);

create table public.registration_installments (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.registration_payment_plans(id) on delete cascade,
  sequence integer not null check (sequence between 1 and 12),
  amount_cents integer not null check (amount_cents > 0),
  due_on date not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'paid', 'failed', 'voided', 'cancelled')),
  gateway_transaction_id text,
  gateway_response jsonb not null default '{}'::jsonb,
  attempted_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, sequence)
);

create index registration_installments_due_idx
  on public.registration_installments(status, due_on);

create trigger registration_payment_plans_updated_at
before update on public.registration_payment_plans
for each row execute function public.update_updated_at_column();

create trigger registration_installments_updated_at
before update on public.registration_installments
for each row execute function public.update_updated_at_column();

-- Service role only, like registrations: the browser never reads these and
-- the learner portal never needs them.
alter table public.registration_payment_plans enable row level security;
alter table public.registration_installments enable row level security;
revoke all on table public.registration_payment_plans from public, anon, authenticated;
revoke all on table public.registration_installments from public, anon, authenticated;

-- The offer itself. Same $420 total as the one-time individual registration
-- (Sage, 2026-09-02: no plan surcharge), individual scope only.
insert into public.program_offers (
  client_id, program_id, code, name, description, amount_cents, seat_count,
  access_scope, installment_count, active
)
select
  offer.client_id,
  offer.program_id,
  'individual-plan',
  'Individual registration · 5 monthly payments',
  'All 12 live seminars, recordings, and course resources for one participant. $84 today, then $84 a month for four months.',
  offer.amount_cents,
  1,
  'all',
  5,
  -- Inserted inactive: cfa-register must be deployed with installment support
  -- before this offer is visible, or it would render as a one-time $420 charge.
  -- Activation is a data update after the function deploy is verified.
  false
from public.program_offers offer
where offer.code = 'individual'
  and offer.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
on conflict (program_id, code) do nothing;
