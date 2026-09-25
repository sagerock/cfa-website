-- The Bridge Lectures with Dr. Michaela Glöckler — Kairos Institute public
-- course, January–February 2027. The first Kairos program on the native
-- checkout.
--
-- Why: the course is sold today through the WordPress Kairos general
-- registration form (tick a box, card payment, 3% processing fee). This moves
-- it to the same one-program checkout as Biografía y Arte Social and the Keene
-- residency. Facts are from the WordPress course page
-- (centerforanthroposophy.org/the-bridge-lectures-with-dr-michaela-gloeckler/,
-- modified 2026-09-15): three Sunday seminars, January 24, February 14 and
-- February 21, 2027, each in two parts, 11:00 AM–12:30 PM and 1:30–3:00 PM
-- EST, online, $350 for all six sessions.
--
-- Nothing about it is in-person and nothing is a portal course, so it
-- registers exactly like Biografía: one payment, a confirmation email, no
-- sign-in link. The receipt is in English and says the Zoom details come
-- before the first session.
--
-- Deliberately NOT here:
--   * The 3% card processing fee the WordPress form adds. The new site absorbs
--     the fee, as learn.* and Thinkific already do; $350 is what is charged.
--   * A payment plan. None has been offered for this course. One can be added
--     later as a second offer row with installment_count > 1, no code change.
--   * Single-seminar or single-session offers. The WordPress page sells the
--     series only.
--   * Staff notice recipients. Those live in the cfa-register function secret
--     REGISTRATION_NOTIFY_EMAILS_KAIROS_GLOECKLER_BRIDGE_2027, never in this
--     public repo.

insert into public.programs (
  client_id, name, year, format, platform, platform_id, tag, instructor, start_date, end_date
)
values (
  '22500cd6-052a-42ff-a0cb-4f3ba9125dfd',
  'The Bridge Lectures with Dr. Michaela Glöckler 2027',
  2027,
  'online',
  'native',
  'kairos-gloeckler-bridge-2027',
  'kairos-gloeckler-bridge-2027',
  'Michaela Glöckler',
  date '2027-01-24',
  date '2027-02-21'
)
on conflict (client_id, platform, platform_id) do nothing;

-- One offer, the whole series. `ends_at` closes the form when the first
-- session starts (11:00 AM EST on January 24, 2027) rather than leaving a page
-- taking money for a course that has already begun.
insert into public.program_offers (
  client_id, program_id, code, name, description,
  amount_cents, currency, seat_count, access_scope, installment_count,
  per_seat, min_seats, max_seats, active, ends_at
)
select
  program.client_id, program.id,
  'series',
  'The Bridge Lectures · all six sessions',
  'Three Sunday seminars with Dr. Michaela Glöckler, January 24, February 14 and February 21, 2027. Each in two parts, 11:00 AM–12:30 PM and 1:30–3:00 PM EST. Online.',
  35000, 'USD', 1, 'all', 1,
  false, 1, 1, true,
  timestamptz '2027-01-24 11:00:00-05'
from public.programs program
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native'
  and program.platform_id = 'kairos-gloeckler-bridge-2027'
on conflict (program_id, code) do nothing;
