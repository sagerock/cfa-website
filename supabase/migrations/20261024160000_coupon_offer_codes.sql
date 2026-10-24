-- Coupons limited to specific options. Null or empty = every option in the
-- program (the old behavior). cfa-register refuses a limited coupon on any
-- other option, so a free code for one $19 session cannot make the full
-- series free (Elsy, 2026-10-23).
alter table public.program_coupons
  add column offer_codes text[];
