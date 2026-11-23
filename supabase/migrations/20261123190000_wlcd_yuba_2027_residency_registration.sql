-- WLCD September 2027 residency at Yuba River Charter School (CfA COM-2026-024, Jax item 4795).
-- NOT APPLIED. Staged on branch learn-wlcd-yuba-2027 for review; apply only after Torin approves.
-- Individual option only ($850). The group rate stays off until Caitlin confirms $600 or $680.
-- Yuba faculty and staff: a 100% Yuba-only code capped at their headcount, created through the
-- verified-changes gate (cfa-change.py), not here.

insert into public.programs (client_id, name, year, format, platform, platform_id, tag, instructor, start_date, end_date)
values (
  '22500cd6-052a-42ff-a0cb-4f3ba9125dfd',
  'WLCD Yuba Residency 2027',
  2027,
  'in-person',
  'native',
  'wlcd-yuba-2027',
  'wlcd-yuba-2027',
  'Karen Atkinson',
  date '2027-09-17',
  date '2027-09-19'
)
on conflict (client_id, platform, platform_id) do nothing;

insert into public.program_offers (
  client_id, program_id, code, name, description,
  amount_cents, currency, seat_count, access_scope, installment_count,
  per_seat, min_seats, max_seats, active, ends_at
)
select
  program.client_id, program.id, 'residency',
  'September 2027 residency — one participant',
  'Friday, September 17 through Sunday, September 19, 2027 at Yuba River Charter School. This weekend only, with no obligation to join the rest of the program.',
  85000, 'USD', 1, 'all', 1,
  false, 1, 1, true,
  timestamptz '2027-09-17 12:00:00-07'
from public.programs program
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native'
  and program.platform_id = 'wlcd-yuba-2027'
on conflict (program_id, code) do nothing;
