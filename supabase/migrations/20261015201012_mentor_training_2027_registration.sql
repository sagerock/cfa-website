-- Mentor Training Program 2027 — native registration on learn.*
--
-- Ten-month, low-residency certificate program for experienced Waldorf
-- teachers, directed by Karen Atkinson. Eight online Saturdays (January 23 –
-- November 13, 2027) plus an in-person residency, Sunday June 27 – Friday
-- July 2, 2027, in Wilton, NH. Sage confirmed the build and the pricing on
-- 2026-10-15: tuition $2,650, or ten monthly payments of $265; a 10% webinar /
-- early-bird code ($2,385) for the October 28 – November 1, 2026 window.
--
-- Same shape as Biografía and the Bridge Lectures (one program, a lander at
-- /mentor-training, a confirmation email, no sign-in link), plus a payment-plan
-- offer like Starlight's `individual-plan`.
--
-- amount_cents is the TOTAL for every offer. cfa-register applies any discount
-- to the total and then splits it by installment_count (remainder on the
-- first payment), so the plan is 265000 over 10 = $265 a month, and with the
-- 10% code 238500 over 10 = $238.50 a month. Both offers cost the same total:
-- no premium for paying monthly.
--
-- Registration opens October 28, 2026: both offers carry starts_at, which
-- cfa-register already filters on for the offer list AND for checkout (POST
-- only accepts an offer the same filtered query returned). ends_at closes the
-- form when the first session day begins, 9:00 AM ET on January 23, 2027.
--
-- Deliberately NOT here:
--   * The 2026 same-school group discount (10% for two or more from one
--     school). Not part of the 2027 offer as confirmed.
--   * A Canada-specific rule. CANADA20 is a client-wide automatic discount
--     and already applies to every native checkout.
--   * Staff notice recipients. Those live in the cfa-register function secret
--     REGISTRATION_NOTIFY_EMAILS_MENTOR_TRAINING_2027, never in this public repo.

insert into public.programs (
  client_id, name, year, format, platform, platform_id, tag, instructor, start_date, end_date
)
values (
  '22500cd6-052a-42ff-a0cb-4f3ba9125dfd',
  'Mentor Training 2027',
  2027,
  'hybrid',
  'native',
  'mentor-training-2027',
  'mentor-training-2027',
  'Karen Atkinson',
  date '2027-01-23',
  date '2027-11-13'
)
on conflict (client_id, platform, platform_id) do nothing;

insert into public.program_offers (
  client_id, program_id, code, name, description,
  amount_cents, currency, seat_count, access_scope, installment_count,
  per_seat, min_seats, max_seats, active, starts_at, ends_at
)
select
  program.client_id, program.id,
  offer.code, offer.name, offer.description,
  265000, 'USD', 1, 'all', offer.installment_count,
  false, 1, 1, true,
  timestamptz '2026-10-28 00:00:00-04',
  timestamptz '2027-01-23 09:00:00-05'
from public.programs program
cross join (values
  (
    'tuition',
    'Full tuition · one payment',
    'The whole ten-month program: eight online Saturday sessions and the week-long in-person residency in Wilton, NH. Travel and lodging are not included.',
    1
  ),
  (
    'plan',
    'Full tuition · 10 monthly payments',
    'The same program, paid in ten monthly payments: the first today, then one a month, charged automatically to the same card.',
    10
  )
) as offer(code, name, description, installment_count)
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native'
  and program.platform_id = 'mentor-training-2027'
on conflict (program_id, code) do nothing;

-- The webinar / early-bird code. Valid on both offers (the server applies a
-- percent coupon before splitting a plan). Window from Karen's note: opens
-- with registration on October 28 and runs through November 1, 2026.
insert into public.program_coupons (
  client_id, program_id, code, percent_off, note, active, starts_at, ends_at
)
select
  program.client_id, program.id,
  'MTWEBINAR', 10,
  'Mentor Training 2027 webinar/early-bird (Karen, 10/14)',
  true,
  timestamptz '2026-10-28 00:00:00-04',
  timestamptz '2026-11-02 00:00:00-05'
from public.programs program
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native'
  and program.platform_id = 'mentor-training-2027'
on conflict (client_id, program_id, code) do nothing;
