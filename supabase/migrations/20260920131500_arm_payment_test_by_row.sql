-- Arming a production payment test moves from Edge Function secrets to this row.
--
-- Edge Function secrets only reach a running deployment on redeploy, so every
-- armed run previously required a production deploy of cfa-register, and test
-- mode stayed on until someone remembered to remove the secrets. The row was
-- already the one-use, hashed, expiring half of the check; it now carries the
-- amount too and is the whole of it.
--
-- The table is service-role only (RLS on, all grants revoked from public, anon
-- and authenticated) — see 20260816172258_one_time_payment_test_authorization.
-- The ceiling is enforced here as well as in the function so that no row, however
-- it was created, can authorize a meaningful charge.

alter table public.payment_test_authorizations
  add column if not exists amount_cents integer not null default 100;

alter table public.payment_test_authorizations
  drop constraint if exists payment_test_authorizations_amount_cents_check;

alter table public.payment_test_authorizations
  add constraint payment_test_authorizations_amount_cents_check
  check (amount_cents between 100 and 10000);

comment on column public.payment_test_authorizations.amount_cents is
  'Amount this armed run may charge, 100-10000. The $1 default is held for '
  'review by the merchant fraud filter, so a run that needs the charge approved '
  'raises it (5000 is known good). Always voided immediately.';
