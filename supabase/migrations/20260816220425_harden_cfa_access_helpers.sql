-- Keep access helpers server-only and cover the new foreign keys.

revoke all on function public.cfa_learn_has_access(uuid)
  from public, anon, authenticated;
grant execute on function public.cfa_learn_has_access(uuid)
  to service_role;

create index if not exists cfa_learn_profiles_contact_idx
  on public.cfa_learn_profiles(contact_id)
  where contact_id is not null;
create index if not exists payment_test_authorizations_registration_idx
  on public.payment_test_authorizations(registration_id)
  where registration_id is not null;
