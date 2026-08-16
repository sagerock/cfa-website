-- Browser admins may inspect identities and payment records but cannot mutate them.

revoke insert, update, delete on table public.client_auth_identities from authenticated;
revoke insert, update, delete on table public.registrations from authenticated;

drop policy "Client members manage auth identities" on public.client_auth_identities;
drop policy "Client members manage registrations" on public.registrations;

create policy "Client admins read auth identities"
on public.client_auth_identities for select
to authenticated
using (public.can_access_client(client_id));

create policy "Client admins read registrations"
on public.registrations for select
to authenticated
using (public.can_access_client(client_id));
