-- Read-only Authorize.Net reporting mirror for CfA.
--
-- The live checkout already records the transaction id returned at charge time,
-- but that is not proof that the transaction later settled. These service-role-
-- only tables mirror settlement batches and transaction status so the office can
-- reconcile registrations, refunds, voids, and ARB installments without handling
-- card data or changing anything at the gateway.

create table public.authorize_net_settlement_batches (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  gateway_environment text not null check (gateway_environment in ('sandbox', 'production')),
  batch_id text not null,
  settlement_time_utc timestamptz,
  settlement_state text,
  payment_method text,
  market_type text,
  product text,
  charge_count integer not null default 0,
  charge_amount_cents integer not null default 0,
  refund_count integer not null default 0,
  refund_amount_cents integer not null default 0,
  void_count integer not null default 0,
  decline_count integer not null default 0,
  error_count integer not null default 0,
  returned_item_count integer not null default 0,
  returned_item_amount_cents integer not null default 0,
  chargeback_count integer not null default 0,
  chargeback_amount_cents integer not null default 0,
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, gateway_environment, batch_id)
);

create index authorize_net_batches_settlement_idx
  on public.authorize_net_settlement_batches(client_id, settlement_time_utc desc);

create table public.authorize_net_transactions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  gateway_environment text not null check (gateway_environment in ('sandbox', 'production')),
  transaction_id text not null,
  batch_id text,
  registration_id uuid references public.registrations(id) on delete set null,
  ref_transaction_id text,
  subscription_id text,
  transaction_type text,
  transaction_status text not null,
  response_code text,
  response_reason_code text,
  response_reason_description text,
  submit_time_utc timestamptz,
  settlement_time_utc timestamptz,
  auth_amount_cents integer,
  settle_amount_cents integer,
  expected_amount_cents integer,
  invoice_number text,
  description text,
  customer_email text,
  customer_first_name text,
  customer_last_name text,
  account_type text,
  account_last_four text,
  reconciliation_status text not null default 'gateway_only'
    check (reconciliation_status in (
      'settled', 'pending', 'refunded', 'voided', 'declined', 'error',
      'matched', 'amount_mismatch', 'gateway_only'
    )),
  reconciliation_note text,
  first_seen_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (client_id, gateway_environment, transaction_id)
);

create index authorize_net_transactions_registration_idx
  on public.authorize_net_transactions(registration_id, submit_time_utc desc);
create index authorize_net_transactions_batch_idx
  on public.authorize_net_transactions(client_id, batch_id);
create index authorize_net_transactions_reconcile_idx
  on public.authorize_net_transactions(client_id, reconciliation_status, submit_time_utc desc);
create index authorize_net_transactions_ref_idx
  on public.authorize_net_transactions(client_id, ref_transaction_id)
  where ref_transaction_id is not null;

create trigger authorize_net_settlement_batches_updated_at
before update on public.authorize_net_settlement_batches
for each row execute function public.update_updated_at_column();

create trigger authorize_net_transactions_updated_at
before update on public.authorize_net_transactions
for each row execute function public.update_updated_at_column();

alter table public.authorize_net_settlement_batches enable row level security;
alter table public.authorize_net_transactions enable row level security;

-- Financial data stays server-side. The service role used by the sync and the
-- private office sheet bypasses RLS; no browser role receives table privileges.
revoke all on table public.authorize_net_settlement_batches from public, anon, authenticated;
revoke all on table public.authorize_net_transactions from public, anon, authenticated;

comment on table public.authorize_net_settlement_batches is
  'Read-only mirror of Authorize.Net settlement batches; no card data.';
comment on table public.authorize_net_transactions is
  'Read-only mirror of Authorize.Net transaction status matched to CfA registrations.';
