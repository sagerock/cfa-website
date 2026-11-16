-- Biografía y Arte Social 2026: a link-only late-join place at $100.
--
-- A participant asked to join Magnolia Ríos's course after registration
-- closed. Magnolia agreed 2026-11-09; the program's director approved a $100
-- late-join price on 2026-11-16. The two sessions left are November 18 and 25.
--
-- Link-only: BiografiaCheckout.astro hides any offer whose code starts with
-- "enlace-" unless the page is opened with ?offer=<code>, so /biografia still
-- shows registration as closed to everyone else. It closes when the last
-- session starts. Rollback: set active = false on this row.

insert into public.program_offers (
  client_id, program_id, code, name, description,
  amount_cents, currency, seat_count, access_scope, installment_count,
  per_seat, min_seats, max_seats, active, starts_at, ends_at
)
select
  program.client_id, program.id,
  'enlace-ultimas-sesiones',
  'Últimas sesiones · 18 y 25 de noviembre',
  'Inscripción tardía para las sesiones que quedan, los miércoles 18 y 25 de noviembre, de 7:00 a 8:30 pm (hora del Este). Sin grabaciones.',
  10000, 'USD', 1, 'all', 1,
  false, 1, 1, true,
  null,
  timestamptz '2026-11-25 19:00:00-05'
from public.programs program
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native'
  and program.platform_id = 'biografia-y-arte-social-2026'
on conflict (program_id, code) do nothing;
