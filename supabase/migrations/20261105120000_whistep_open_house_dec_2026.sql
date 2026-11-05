-- WHiSTEP Open House, Saturday December 12, 2026, 4:35 to 5:00 PM ET, on Zoom
--
-- The second free event on learn.* (the first: Mentor Training Open House,
-- 20261104150000). Hosted by David Barham, Director of WHiSTEP, in Zoom room 4,
-- in the same session right after that day's Starlight Rays talk (David chose
-- this date and time 2026-11-04). Free; registrants get the recording afterward.
--
-- One $0 offer, open now, closing when the open house begins. The amount
-- checks were already relaxed to >= 0 by 20261104150000.
--
-- HELD: apply this together with the cfa-register deploy and the page merge,
-- once CfA has settled the host line and the talk invitation.

insert into public.programs (
  client_id, name, year, format, platform, platform_id, tag, instructor, start_date, end_date
)
values (
  '22500cd6-052a-42ff-a0cb-4f3ba9125dfd',
  'WHiSTEP Open House (December 12, 2026)',
  2026,
  'online',
  'native',
  'whistep-open-house-2026-12-12',
  'whistep-open-house-2026-12-12',
  'David Barham',
  date '2026-12-12',
  date '2026-12-12'
)
on conflict (client_id, platform, platform_id) do nothing;

insert into public.program_offers (
  client_id, program_id, code, name, description,
  amount_cents, currency, seat_count, access_scope, installment_count,
  per_seat, min_seats, max_seats, active, starts_at, ends_at
)
select
  program.client_id, program.id,
  'open-house',
  'Open house · free',
  'A free introduction to WHiSTEP on Zoom, with time for your questions.',
  0, 'USD', 1, 'all', 1,
  false, 1, 1, true,
  timestamptz '2026-11-05 00:00:00-05',
  timestamptz '2026-12-12 16:35:00-05'
from public.programs program
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native'
  and program.platform_id = 'whistep-open-house-2026-12-12'
on conflict (program_id, code) do nothing;
