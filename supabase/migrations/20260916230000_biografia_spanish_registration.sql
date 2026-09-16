-- Biografía y Arte Social 2026 — CfA's first registration in a language other
-- than English.
--
-- Why: Deborah Dornemann is running an eight-week Spanish biography course with
-- Magnolia Ríos, October 7 to November 25, 2026, Wednesdays 7:00-8:30 pm ET,
-- for a small group of 8 to 15 people. It is sold, taught and confirmed in
-- Spanish. Milan Daler proposed $175 on 2026-09-11 and Deborah agreed on
-- 2026-09-15; that is the number here.
--
-- Nothing about this program is in-person and nothing about it is a portal
-- course: people get a Zoom room and eight dates, and by Deborah's decision
-- the sessions are never recorded. So it registers exactly like the Keene
-- residency does — one payment, a confirmation email, no sign-in link — with
-- the confirmation written in Spanish.
--
-- Deliberately NOT here: the two-payment option. Deborah and Sage agreed to
-- offer one, but the installment amounts and the due dates have never been
-- decided, and an offer row is the wrong place to guess. Adding it later is one
-- insert against this program with installment_count = 2; no code changes.

insert into public.programs (
  client_id, name, year, format, platform, platform_id, tag, instructor, start_date, end_date
)
values (
  '22500cd6-052a-42ff-a0cb-4f3ba9125dfd',
  'Biografía y Arte Social 2026',
  2026,
  'online',
  'native',
  'biografia-y-arte-social-2026',
  'biografia-y-arte-social-2026',
  'Magnolia Ríos',
  date '2026-10-07',
  date '2026-11-25'
)
on conflict (client_id, platform, platform_id) do nothing;

-- One offer, in the language the buyer is reading. `ends_at` closes the form
-- when the first session starts rather than leaving a dead page taking money
-- for a course that has already begun.
insert into public.program_offers (
  client_id, program_id, code, name, description,
  amount_cents, currency, seat_count, access_scope, installment_count,
  per_seat, min_seats, max_seats, active, ends_at
)
select
  program.client_id, program.id,
  'curso-completo',
  'Curso completo · 8 sesiones',
  'Los cuatro talleres desarrollados a lo largo de ocho encuentros en vivo: el Sol; Mercurio y Júpiter; Venus y Marte; la Luna y Saturno. Incluye versos, dibujo de formas, ejercicios artísticos, preguntas de vida y puesta en común. Sin grabaciones.',
  17500, 'USD', 1, 'all', 1,
  false, 1, 1, true,
  timestamptz '2026-10-07 19:00:00-04'
from public.programs program
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native'
  and program.platform_id = 'biografia-y-arte-social-2026'
on conflict (program_id, code) do nothing;
