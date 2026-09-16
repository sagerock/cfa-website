-- Biografía y Arte Social — the two-payment option, staged INACTIVE.
--
-- Deborah agreed to the structure on 2026-09-11 ("That payment plan sounds
-- good") against a proposal of two payments, one in October and one in
-- November. The arithmetic behind it was $60 + $60, because tuition was $120 at
-- the time. Tuition is now $175 and nobody redid the split, so the amount here
-- is the plain even one, $87.50 twice, and it is a PLACEHOLDER.
--
-- `active = false` on purpose. The page reads its options from this table, so
-- an active row would put a guessed price in front of real buyers the moment it
-- landed. Flipping it on is one update once Sage and Deborah confirm the number:
--
--   update public.program_offers set active = true
--   where code = 'curso-completo-2-pagos';
--
-- If they want the small plan premium Starlight charges ($420 one-time against
-- $445 in five payments), change amount_cents first — 18000 gives $90 twice.
--
-- amount_cents is the TOTAL. cfa-register divides it by installment_count, so
-- 17500 over 2 is exactly $87.50 and $87.50 with no remainder.
--
-- Timing works out without a rule: installments are charged monthly from the
-- purchase date, and registration closes when the first session starts on
-- October 7, so the second payment always lands before the course ends on
-- November 25. Deborah ruled out anything later than that on 2026-09-04.

insert into public.program_offers (
  client_id, program_id, code, name, description,
  amount_cents, currency, seat_count, access_scope, installment_count,
  per_seat, min_seats, max_seats, active, ends_at
)
select
  program.client_id, program.id,
  'curso-completo-2-pagos',
  'Curso completo · 2 pagos',
  'El curso completo, pagado en dos cuotas de $87.50 USD: la primera hoy y la segunda un mes después, con cargo automático a la misma tarjeta. Mismo contenido y mismas ocho sesiones que el pago único.',
  17500, 'USD', 1, 'all', 2,
  false, 1, 1,
  false,
  timestamptz '2026-10-07 19:00:00-04'
from public.programs program
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native'
  and program.platform_id = 'biografia-y-arte-social-2026'
on conflict (program_id, code) do nothing;
