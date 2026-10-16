-- Kairos seminars with Dr. James Dyson (The Organic and Psychospiritual Basis
-- of Mental Health), four Saturdays, September 26 - November 7, 2026, moved
-- off the WordPress Kairos general form (137) mid-series on 2026-10-16 (Sage:
-- "let's migrate them all"). $350 for the series, as on WordPress page 44886;
-- the card fee is absorbed. Closes at the start of the last seminar.
--
-- Codes carried over from form 137 so nobody loses a discount in the move:
--   * GRADS25, Kairos graduates, 25% (form 137 field 19). Also added to the
--     Bridge Lectures, which moved on 2026-09-25 without it.
--   * DYSON25AM, Amber Melendy's one-use 25% (Gravity coupon feed 97, Karine
--     and Sage 2026-10-10), unused at the move.

insert into public.programs (
  client_id, name, year, format, platform, platform_id, tag, instructor, start_date, end_date
)
values ('22500cd6-052a-42ff-a0cb-4f3ba9125dfd',
  'The Organic and Psychospiritual Basis of Mental Health with Dr. James Dyson 2026',
  2026, 'online', 'native', 'kairos-dyson-mental-health-2026', 'kairos-dyson-mental-health-2026',
  'James Dyson', date '2026-09-26', date '2026-11-07')
on conflict (client_id, platform, platform_id) do nothing;

insert into public.program_offers (
  client_id, program_id, code, name, description,
  amount_cents, currency, seat_count, access_scope, installment_count,
  per_seat, min_seats, max_seats, active, ends_at
)
select program.client_id, program.id, 'dyson-series', 'The Dyson seminars · all four',
  'Four Saturday seminars with Dr. James Dyson, September 26, October 24, October 31 and November 7, 2026, 3:00-5:00 PM Eastern. Online.',
  35000, 'USD', 1, 'all', 1, false, 1, 1, true, timestamptz '2026-11-07 15:00:00-05'
from public.programs program
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native' and program.platform_id = 'kairos-dyson-mental-health-2026'
on conflict (program_id, code) do nothing;

insert into public.program_coupons (client_id, program_id, code, percent_off, note, active, max_uses)
select program.client_id, program.id, c.code, 25, c.note, true, c.max_uses
from public.programs program
join (values
  ('kairos-dyson-mental-health-2026', 'GRADS25', 'Kairos Institute graduates, carried over from WordPress form 137 (Sage 2026-10-16).', null::integer),
  ('kairos-dyson-mental-health-2026', 'DYSON25AM', 'Amber Melendy, one use, carried over from Gravity coupon feed 97 (Karine/Sage 2026-10-10; moved 2026-10-16).', 1),
  ('kairos-gloeckler-bridge-2027', 'GRADS25', 'Kairos Institute graduates, carried over from WordPress form 137 (Sage 2026-10-16).', null::integer)
) as c(platform_id, code, note, max_uses) on c.platform_id = program.platform_id
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native'
  and not exists (select 1 from public.program_coupons x where x.program_id = program.id and x.code = c.code);
