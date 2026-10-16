-- Kairos supervision of fieldwork 2026-27, moved off Gravity Form 143
-- (WordPress page 45003) on 2026-10-16. An add-on for students already
-- registered for Kairos 2026-27: $300 per term, $600 for both. The card fee
-- the form added is absorbed; pay-by-check goes to the office as before.
-- Open through the end of the spring term.
insert into public.programs (
  client_id, name, year, format, platform, platform_id, tag, instructor, start_date, end_date
)
values ('22500cd6-052a-42ff-a0cb-4f3ba9125dfd', 'Kairos Supervision of Fieldwork 2026-27',
  2026, 'online', 'native', 'kairos-fieldwork-supervision-2026-27', 'kairos-fieldwork-supervision-2026-27',
  null, date '2026-09-01', date '2027-07-31')
on conflict (client_id, platform, platform_id) do nothing;

insert into public.program_offers (
  client_id, program_id, code, name, description,
  amount_cents, currency, seat_count, access_scope, installment_count,
  per_seat, min_seats, max_seats, active, ends_at
)
select program.client_id, program.id, o.code, o.name, o.description, o.amount_cents,
  'USD', 1, 'all', 1, false, 1, 1, true, timestamptz '2027-07-31 23:59:00-04'
from public.programs program
join (values
  ('fw-fall', 'Fall term (September–January)', 'Supervision of fieldwork for the fall term.', 30000),
  ('fw-spring', 'Spring term (February–July)', 'Supervision of fieldwork for the spring term.', 30000),
  ('fw-both', 'Both terms (September–July)', 'Supervision of fieldwork for the fall and spring terms.', 60000)
) as o(code, name, description, amount_cents) on true
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native' and program.platform_id = 'kairos-fieldwork-supervision-2026-27'
on conflict (program_id, code) do nothing;
