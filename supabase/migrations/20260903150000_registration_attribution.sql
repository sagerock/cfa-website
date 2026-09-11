alter table public.registrations
  add column if not exists attribution jsonb not null default '{}'::jsonb;

alter table public.registrations
  drop constraint if exists registrations_attribution_object;

alter table public.registrations
  add constraint registrations_attribution_object
  check (jsonb_typeof(attribution) = 'object');

comment on column public.registrations.attribution is
  'Sanitized first-touch campaign, click ID, landing path, and referrer data captured by the CfA checkout.';
