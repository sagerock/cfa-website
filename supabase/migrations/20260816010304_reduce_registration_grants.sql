-- Supabase's default authenticated grants include TRUNCATE/TRIGGER/REFERENCES.
-- Replace them with the exact privileges required by the admin UI.

revoke all on table public.client_auth_identities from authenticated;
revoke all on table public.registrations from authenticated;
revoke all on table public.program_offers from authenticated;

grant select on table public.client_auth_identities to authenticated;
grant select on table public.registrations to authenticated;
grant select, insert, update, delete on table public.program_offers to authenticated;
