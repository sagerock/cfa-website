-- Mentor Training Open House, Wednesday December 9, 2026, 7:00 PM ET, on Zoom
--
-- The first free event registered on learn.* instead of Constant Contact's event
-- tool (CfA rule, 2026-10-30: Constant Contact is for promotional mail, CfA's own
-- registration system is for registrants). Hosted by Karen Atkinson, Director of
-- Mentor Training; Zoom room 3. Karen confirmed the date, wording, host and room
-- on 2026-11-03.
--
-- One $0 offer. cfa-register never calls the payment gateway for a $0 total and
-- needs no billing address; the program definition (`freeEvent`) sends a plain
-- confirmation with the joining link instead of a receipt.
--
-- The marketing opt-in box on the page is stored on the registration
-- (registrations.marketing_opt_in). Only people who tick it are added to
-- Constant Contact; registering alone grants no list permission.
--
-- Registration opens now and closes when the event begins.
--
-- Schema: until now an offer had to cost something (amount_cents > 0) and a
-- registration had to be paid or discounted. A free event is neither, so both
-- checks become amount_cents >= 0. Nothing downstream depends on the old rule:
-- payment reconciliation matches gateway transactions to registrations (a $0
-- registration has no gateway transaction), and fully discounted registrations
-- already complete through the same path.

alter table public.program_offers drop constraint if exists program_offers_amount_cents_check;
alter table public.program_offers add constraint program_offers_amount_cents_check
  check (amount_cents >= 0);

alter table public.registrations drop constraint if exists registrations_amount_cents_check;
alter table public.registrations add constraint registrations_amount_cents_check
  check (amount_cents >= 0);

insert into public.programs (
  client_id, name, year, format, platform, platform_id, tag, instructor, start_date, end_date
)
values (
  '22500cd6-052a-42ff-a0cb-4f3ba9125dfd',
  'Mentor Training Open House (December 9, 2026)',
  2026,
  'online',
  'native',
  'mentor-training-open-house-2026-12-09',
  'mentor-training-open-house-2026-12-09',
  'Karen Atkinson',
  date '2026-12-09',
  date '2026-12-09'
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
  'A free introduction to the Mentor Training Program on Zoom, with time for your questions.',
  0, 'USD', 1, 'all', 1,
  false, 1, 1, true,
  timestamptz '2026-11-04 00:00:00-05',
  timestamptz '2026-12-09 19:00:00-05'
from public.programs program
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native'
  and program.platform_id = 'mentor-training-open-house-2026-12-09'
on conflict (program_id, code) do nothing;
