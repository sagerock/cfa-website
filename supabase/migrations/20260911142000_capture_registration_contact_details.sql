-- Keep the central CfA contact useful after a native registration.
--
-- The checkout has always retained phone and billing_address on registrations,
-- but cfa_complete_registration copied only the phone onto contacts. That made
-- the office notification and contact lookup look as though the address had
-- never been collected. Future paid registrations now update the current
-- contact fields atomically when registration completion links the contact.
-- Historical registrations are backfilled conservatively: preserve an existing
-- mailing address (for example Neon data), while retaining the newest checkout
-- address separately as registration_billing_address and filling missing fields.

create or replace function public.cfa_sync_registration_contact_details()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  contact_phone text := nullif(pg_catalog.btrim(coalesce(new.phone, '')), '');
  contact_address text := nullif(pg_catalog.btrim(coalesce(new.billing_address->>'address', '')), '');
  contact_city text := nullif(pg_catalog.btrim(coalesce(new.billing_address->>'city', '')), '');
  contact_state text := nullif(pg_catalog.btrim(coalesce(new.billing_address->>'state', '')), '');
  contact_zip text := nullif(pg_catalog.btrim(coalesce(new.billing_address->>'zip', '')), '');
  contact_country text := nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(new.billing_address->>'country', ''))), '');
  contact_fields jsonb;
begin
  if new.status <> 'paid' or new.contact_id is null or new.is_test then
    return new;
  end if;

  contact_fields := pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
    'phone', contact_phone,
    'address', contact_address,
    'city', contact_city,
    'zip', contact_zip,
    'registration_billing_address', case
      when contact_address is not null then pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'address', contact_address,
        'city', contact_city,
        'state', contact_state,
        'zip', contact_zip,
        'country', contact_country
      ))
      else null
    end
  ));

  update public.contacts
  set state = coalesce(contact_state, state),
      country = coalesce(contact_country, country),
      custom_fields = coalesce(custom_fields, '{}'::jsonb) || contact_fields,
      updated_at = pg_catalog.now()
  where id = new.contact_id
    and client_id = new.client_id;

  return new;
end;
$$;

revoke all on function public.cfa_sync_registration_contact_details()
  from public, anon, authenticated;

drop trigger if exists cfa_sync_registration_contact_details_after_payment
  on public.registrations;
create trigger cfa_sync_registration_contact_details_after_payment
after update of status, contact_id, billing_address, phone on public.registrations
for each row
when (new.status = 'paid' and new.contact_id is not null and new.is_test = false)
execute function public.cfa_sync_registration_contact_details();

-- Backfill the newest real paid checkout per contact. Do not reinterpret a
-- pre-existing address as billing or overwrite it; store the checkout address
-- under its explicit name and only fill flat contact fields that were absent.
with latest_registration as (
  select distinct on (registration.contact_id)
    registration.contact_id,
    nullif(pg_catalog.btrim(coalesce(registration.phone, '')), '') as phone,
    registration.billing_address
  from public.registrations registration
  where registration.status = 'paid'
    and registration.contact_id is not null
    and registration.is_test = false
    and registration.voided_at is null
  order by registration.contact_id,
    coalesce(registration.paid_at, registration.created_at) desc,
    registration.created_at desc
)
update public.contacts contact
set state = coalesce(
      nullif(pg_catalog.btrim(coalesce(contact.state, '')), ''),
      nullif(pg_catalog.btrim(coalesce(latest.billing_address->>'state', '')), '')
    ),
    country = coalesce(
      nullif(pg_catalog.btrim(coalesce(contact.country, '')), ''),
      nullif(pg_catalog.upper(pg_catalog.btrim(coalesce(latest.billing_address->>'country', ''))), '')
    ),
    custom_fields = coalesce(contact.custom_fields, '{}'::jsonb)
      || pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'phone', latest.phone,
        'address', case
          when nullif(pg_catalog.btrim(coalesce(contact.custom_fields->>'address', '')), '') is null
            then nullif(pg_catalog.btrim(coalesce(latest.billing_address->>'address', '')), '')
          else null
        end,
        'city', case
          when nullif(pg_catalog.btrim(coalesce(contact.custom_fields->>'city', '')), '') is null
            then nullif(pg_catalog.btrim(coalesce(latest.billing_address->>'city', '')), '')
          else null
        end,
        'zip', case
          when nullif(pg_catalog.btrim(coalesce(contact.custom_fields->>'zip', '')), '') is null
            then nullif(pg_catalog.btrim(coalesce(latest.billing_address->>'zip', '')), '')
          else null
        end,
        'registration_billing_address', case
          when nullif(pg_catalog.btrim(coalesce(latest.billing_address->>'address', '')), '') is not null
            then latest.billing_address
          else null
        end
      )),
    updated_at = pg_catalog.now()
from latest_registration latest
where contact.id = latest.contact_id;
