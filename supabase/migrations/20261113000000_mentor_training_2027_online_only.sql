-- Mentor Training 2027: a link-only "online sessions only" place.
--
-- Karen Atkinson (Director of Mentor Training) offered the online sessions
-- without the summer residency at $1,650 for a participant who cannot attend
-- the residency, with a Letter of Participation instead of the Certification
-- (a residency can be added in a later year). Paid in full, or in ten monthly
-- payments of $165: the same total, no premium, like the public plan.
--
-- Not on the public page: the checkout shows only `tuition` and `plan` unless
-- the link carries ?offer=online-only (MentorTrainingCheckout.astro), which
-- shows these two options. The receipt leaves out the residency
-- (offerDetails in cfa-register).
--
-- Same dates as the public offers. Rollback: set active = false on both rows.

insert into public.program_offers (
  client_id, program_id, code, name, description,
  amount_cents, currency, seat_count, access_scope, installment_count,
  per_seat, min_seats, max_seats, active, starts_at, ends_at
)
select
  program.client_id, program.id,
  offer.code, offer.name, offer.description,
  165000, 'USD', 1, 'all', offer.installment_count,
  false, 1, 1, true,
  timestamptz '2026-10-28 00:00:00-04',
  timestamptz '2027-01-23 09:00:00-05'
from public.programs program
cross join (values
  (
    'online-only',
    'Online sessions only · one payment',
    'The eight online Saturday sessions, with a Letter of Participation. No residency; one can be added in a later year to complete the Certification.',
    1
  ),
  (
    'online-only-plan',
    'Online sessions only · 10 monthly payments',
    'The same online sessions, paid in ten monthly payments: the first today, then one a month, charged automatically to the same card.',
    10
  )
) as offer(code, name, description, installment_count)
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native'
  and program.platform_id = 'mentor-training-2027'
on conflict (program_id, code) do nothing;
