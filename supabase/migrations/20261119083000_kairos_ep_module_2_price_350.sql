-- Kairos EP Module 2 (kairos-ep-module-2-2027): tuition lowered from $425 to $350.
-- Lisl Hofer (Manager, Kairos Institute) with Karine, 2026-11-17, forwarded by Caitlin
-- 2026-11-18 ("Please lower the price to $350"). Jax open item #4274.
-- The $45 EPWB certificate is unchanged and stays discount-exempt, so with the
-- certificate the total is $395. EP2GROUP20 (20%, tuition only) now gives $280 / $325.
-- Undo: set amount_cents back to 42500 / 47000 and restore the $425 description.
update public.program_offers o
set amount_cents = 35000,
    description = 'Emergency Pedagogy Module 2 with Bernd Ruf, in person in Wilton, NH, July 2-4, 2027.'
from public.programs p
where p.id = o.program_id and p.platform = 'native'
  and p.platform_id = 'kairos-ep-module-2-2027' and o.code = 'ep2-tuition';

update public.program_offers o
set amount_cents = 39500,
    description = 'Tuition $350 plus the optional $45 Module 2 certificate from Emergency Pedagogy Without Borders. Discounts apply to tuition only.'
from public.programs p
where p.id = o.program_id and p.platform = 'native'
  and p.platform_id = 'kairos-ep-module-2-2027' and o.code = 'ep2-tuition-cert';
