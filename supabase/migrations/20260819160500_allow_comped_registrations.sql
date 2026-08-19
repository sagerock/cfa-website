-- A fully comped (100% coupon) registration records amount_cents = 0.
-- Zero is allowed only when a discount produced it, so a plain zero-dollar
-- registration without a coupon still violates the constraint.

alter table public.registrations drop constraint registrations_amount_cents_check;
alter table public.registrations add constraint registrations_amount_cents_check
  check (amount_cents >= 0 and (amount_cents > 0 or discount_cents > 0));
