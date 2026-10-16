-- Kairos Emergency Pedagogy Module 7 with Bernd Ruf, January 15-16, 2027.
-- Moves Module 7 registration off WordPress (Gravity Forms 137 and 142) onto
-- the native checkout, the second Kairos course after the Bridge Lectures.
--
-- Facts are from the WordPress pages it replaces (page 44894, the public
-- Module 7 page, and page 44974, the registered-student checkout), as live on
-- 2026-10-16: online, Friday January 15 3:00-4:30 PM EST and Saturday
-- January 16 9:00 AM-4:00 PM EST; tuition $350; registered Kairos students
-- $250 ($100 less); optional $45 EPWB certificate, paid with registration,
-- and "tuition discounts do not apply to the certificate"; Kairos graduates
-- take 25% off tuition with the shared code GRADS25.
--
-- Two programs over one module, because the student price must not sit on the
-- public page. The student page is unlisted, not access-controlled, exactly
-- like WordPress page 44974.
--
-- The certificate rides inside the offer (no add-ons in this checkout), with
-- discount_exempt_cents marking the part a percentage discount never reduces.
-- The column defaults to 0, so every existing offer prices exactly as before.
--
-- Deliberately NOT here:
--   * The 3% card processing fee the WordPress forms add. The new site absorbs
--     it, as for the Bridge Lectures.
--   * Pay-by-check. The native checkout takes cards; a check payer goes to the
--     office as before.
--   * Staff notice recipients: function secrets
--     REGISTRATION_NOTIFY_EMAILS_KAIROS_EP_MODULE_7_2027(_STUDENTS).

alter table public.program_offers
  add column if not exists discount_exempt_cents integer not null default 0
  check (discount_exempt_cents >= 0);

comment on column public.program_offers.discount_exempt_cents is
  'Fixed part of amount_cents that coupons and automatic discounts never reduce (e.g. a certificate fee bundled with tuition).';

insert into public.programs (
  client_id, name, year, format, platform, platform_id, tag, instructor, start_date, end_date
)
values
  ('22500cd6-052a-42ff-a0cb-4f3ba9125dfd', 'Emergency Pedagogy Module 7 with Bernd Ruf 2027',
   2027, 'online', 'native', 'kairos-ep-module-7-2027', 'kairos-ep-module-7-2027',
   'Bernd Ruf', date '2027-01-15', date '2027-01-16'),
  ('22500cd6-052a-42ff-a0cb-4f3ba9125dfd', 'Emergency Pedagogy Module 7 with Bernd Ruf 2027 (Kairos student rate)',
   2027, 'online', 'native', 'kairos-ep-module-7-2027-students', 'kairos-ep-module-7-2027-students',
   'Bernd Ruf', date '2027-01-15', date '2027-01-16')
on conflict (client_id, platform, platform_id) do nothing;

-- Registration closes when the module starts, 3:00 PM EST on January 15.
insert into public.program_offers (
  client_id, program_id, code, name, description,
  amount_cents, discount_exempt_cents, currency, seat_count, access_scope, installment_count,
  per_seat, min_seats, max_seats, active, ends_at
)
select program.client_id, program.id, o.code, o.name, o.description,
  o.amount_cents, o.exempt, 'USD', 1, 'all', 1, false, 1, 1, true,
  timestamptz '2027-01-15 15:00:00-05'
from public.programs program
join (values
  ('kairos-ep-module-7-2027', 'ep7-tuition', 'Module 7 tuition',
   'Emergency Pedagogy Module 7 with Bernd Ruf, online, January 15-16, 2027.', 35000, 0),
  ('kairos-ep-module-7-2027', 'ep7-tuition-cert', 'Module 7 tuition + EPWB certificate',
   'Tuition $350 plus the optional $45 Module 7 certificate from Emergency Pedagogy Without Borders. Discounts apply to tuition only.', 39500, 4500),
  ('kairos-ep-module-7-2027-students', 'ep7-student', 'Module 7 tuition, registered Kairos student',
   'Emergency Pedagogy Module 7 with Bernd Ruf, online, January 15-16, 2027. $350 tuition less the $100 student discount.', 25000, 0),
  ('kairos-ep-module-7-2027-students', 'ep7-student-cert', 'Module 7 student tuition + EPWB certificate',
   'Student tuition $250 plus the optional $45 Module 7 certificate from Emergency Pedagogy Without Borders.', 29500, 4500)
) as o(platform_id, code, name, description, amount_cents, exempt)
  on o.platform_id = program.platform_id
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native'
on conflict (program_id, code) do nothing;

-- GRADS25: the existing shared Kairos graduates code (WordPress coupon feed 81,
-- "Kairos Institute Graduates"), public program only.
insert into public.program_coupons (client_id, program_id, code, percent_off, note, active)
select program.client_id, program.id, 'GRADS25', 25,
  'Kairos Institute graduates, shared code carried over from WordPress form 137 (Sage 2026-10-16, Module 7 move to learn.*). Tuition only; certificate exempt.',
  true
from public.programs program
where program.client_id = '22500cd6-052a-42ff-a0cb-4f3ba9125dfd'
  and program.platform = 'native'
  and program.platform_id = 'kairos-ep-module-7-2027'
  and not exists (
    select 1 from public.program_coupons c where c.program_id = program.id and c.code = 'GRADS25'
  );
