-- A production test token may authorize exactly one gateway charge. The raw
-- token is never stored; only its SHA-256 digest is persisted.

create table public.payment_test_authorizations (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  registration_id uuid references public.registrations(id),
  created_at timestamptz not null default now()
);

alter table public.payment_test_authorizations enable row level security;
revoke all on table public.payment_test_authorizations from public, anon, authenticated;

create or replace function public.cfa_claim_payment_test(
  requested_token_hash text,
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
  update public.payment_test_authorizations
  set used_at = now(),
      registration_id = requested_registration_id
  where token_hash = requested_token_hash
    and used_at is null
    and expires_at > now();

  get diagnostics claimed_count = row_count;
  return claimed_count = 1;
end;
$$;

revoke all on function public.cfa_claim_payment_test(text, uuid) from public, anon, authenticated;
grant execute on function public.cfa_claim_payment_test(text, uuid) to service_role;
