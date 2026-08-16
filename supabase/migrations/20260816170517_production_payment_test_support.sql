-- Track controlled live-gateway tests and atomically reverse their local effects
-- after Authorize.Net confirms the corresponding transaction was voided.

alter table public.registrations
  drop constraint registrations_status_check,
  add column is_test boolean not null default false,
  add column voided_at timestamptz,
  add constraint registrations_status_check
    check (status in (
      'initiated', 'processing', 'paid', 'failed', 'enrollment_pending',
      'refunded', 'cancelled', 'voided'
    ));

create or replace function public.cfa_void_test_registration(
  requested_registration_id uuid,
  requested_void_response jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  registration_record public.registrations%rowtype;
begin
  select * into registration_record
  from public.registrations
  where id = requested_registration_id
  for update;

  if not found or not registration_record.is_test then
    raise exception 'test_registration_not_found';
  end if;

  if registration_record.status = 'voided' then
    return;
  end if;

  if registration_record.gateway_transaction_id is null then
    raise exception 'test_transaction_not_recorded';
  end if;

  update public.enrollments
  set status = 'cancelled',
      revoked_at = now(),
      updated_at = now()
  where id = registration_record.enrollment_id;

  update public.contacts
  set total_spent = greatest(coalesce(total_spent, 0) - registration_record.amount_cents::numeric / 100, 0),
      order_count = greatest(coalesce(order_count, 0) - 1, 0),
      first_order_date = case when coalesce(order_count, 0) <= 1 then null else first_order_date end,
      last_order_date = case when coalesce(order_count, 0) <= 1 then null else last_order_date end,
      custom_fields = coalesce(custom_fields, '{}'::jsonb)
        || jsonb_build_object('authorize_net_test_voided_at', now())
  where id = registration_record.contact_id;

  update public.registrations
  set status = 'voided',
      voided_at = now(),
      gateway_response = jsonb_build_object(
        'charge', registration_record.gateway_response,
        'void', coalesce(requested_void_response, '{}'::jsonb)
      ),
      failure_code = null,
      failure_message = null
  where id = registration_record.id;
end;
$$;

revoke all on function public.cfa_void_test_registration(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.cfa_void_test_registration(uuid, jsonb) to service_role;
