-- Kairos Emergency Pedagogy Module 2 with Bernd Ruf, in person, Wilton NH,
-- July 2-4, 2027. Caitlin asked Jax on 2026-11-14 to create the event and
-- registration, forwarding Karine's 11/12 announcement: tuition $425; group
-- discount 20% for 3 or more, also extended to participants in Renewal Courses
-- or the Kairos Summer Residency (July 5 pm - July 9 noon); optional $45 EPWB
-- Module Certificate; "Tuition discounts do not apply to this fee."
--
-- Same pattern as Module 7 (20261016130000): the certificate rides inside an
-- offer and discount_exempt_cents keeps every discount off it. The checkout has
-- no volume pricing, so the group discount is the link-only code EP2GROUP20
-- (20%, tuition only), given to groups and to Renewal/Residency participants.
-- No student-rate page: none was asked for.
--
-- Registration closes when the module starts; the daily schedule is not set,
-- so 9:00 AM EDT July 2 is used.
-- Staff notice recipients: function secret REGISTRATION_NOTIFY_EMAILS_KAIROS_EP_MODULE_2_2027.

insert into public.programs (
  client_id, name, year, format, platform, platform_id, tag, instructor, start_date, end_date
)
values
  ('22500cd6-052a-42ff-a0cb-4f3ba9125dfd', 'Emergency Pedagogy Module 2 with Bernd Ruf 2027',
   2027, 'in-person', 'native', 'kairos-ep-module-2-2027', 'kairos-ep-module-2-2027',
   'Bernd Ruf', date '2027-07-02', date '2027-07-04')
on conflict (client_id, platform, platform_id) do nothing;

insert into public.program_offers (
  client_id, program_id, code, name, description,
  amount_cents, discount_exempt_cents, currency, seat_count, access_scope, installment_count,
  per_seat, min_seats, max_seats, active, ends_at
)
select program.client_id, program.id, o.code, o.name, o.description,
  o.amount_cents, o.exempt, 'USD', 1, 'all', 1, false, 1, 1, true,
  timestamptz '2027-07-02 09:00:00-04'
from public.programs program
join (values
  ('kairos-ep-module-2-2027', 'ep2-tuition', 'Module 2 tuition',
   'Emergency Pedagogy Module 2 with Bernd Ruf, in person in Wilton, NH, July 2-4, 2027.', 42500, 0),
  ('kairos-ep-module-2-2027', 'ep2-tuition-cert', 'Module 2 tuition + EPWB Module Certificate',
   'Tuition $425 plus the optional $45 Module 2 certificate from Emergency Pedagogy Without Borders. Discounts apply to tuition only.', 47000, 4500)
) as o(platform_id, code, name, description, amount_cents, exempt)
  on o.platform_id = program.platform_id
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native'
on conflict (program_id, code) do nothing;

insert into public.program_coupons (client_id, program_id, code, percent_off, note, active)
select program.client_id, program.id, 'EP2GROUP20', 20,
  'Group discount (3 or more) and Renewal Courses / Kairos Summer Residency participants, per Karine 2026-11-12 via Caitlin 2026-11-14. Tuition only; certificate exempt.',
  true
from public.programs program
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native'
  and program.platform_id = 'kairos-ep-module-2-2027'
  and not exists (
    select 1 from public.program_coupons c where c.program_id = program.id and c.code = 'EP2GROUP20'
  );
