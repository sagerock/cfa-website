// Seat maths for offers a buyer can purchase more than one of.
//
// A normal offer sells one thing at one price, and `seat_count` is a ceiling
// (Starlight's institution offer covers up to twenty people for a flat fee).
// A per-seat offer instead prices ONE seat, and the buyer chooses how many
// between `min_seats` and `max_seats` — that is how a school sends three
// colleagues to one residency in a single payment.
//
// The browser never decides an amount. It sends a seat count; the server
// re-derives the price from the offer row.

export function seatRange(offer) {
  const min = Math.max(1, Number(offer?.min_seats) || 1);
  const declaredMax = Number(offer?.max_seats) || 0;
  const fallbackMax = Math.max(1, Number(offer?.seat_count) || 1);
  const max = Math.max(min, declaredMax || fallbackMax);
  return { min, max };
}

// Returns the seat count to charge for, or an error code the caller can
// return verbatim. Non per-seat offers ignore whatever the browser asked for.
export function resolveSeatCount(offer, requested) {
  if (!offer?.per_seat) {
    return { ok: true, seats: 1 };
  }
  const { min, max } = seatRange(offer);
  const asked = Number(requested);
  if (!Number.isInteger(asked)) return { ok: false, error: 'invalid_seat_count' };
  if (asked < min || asked > max) return { ok: false, error: 'invalid_seat_count' };
  return { ok: true, seats: asked };
}

// The list price before any discount. Per-seat offers multiply; everything
// else is exactly what it has always been.
export function offerBaseAmountCents(offer, seats) {
  const unit = Number(offer?.amount_cents) || 0;
  if (!offer?.per_seat) return unit;
  return unit * Math.max(1, Number(seats) || 1);
}

// What lands in registrations.seat_count: the seats actually bought for a
// per-seat offer, and the offer's own allowance otherwise.
export function recordedSeatCount(offer, seats) {
  if (offer?.per_seat) return Math.max(1, Number(seats) || 1);
  return Math.max(1, Number(offer?.seat_count) || 1);
}

// The part of the list price a percentage discount may reduce. An offer can
// carry a fixed component that no coupon or automatic discount touches: Kairos
// Module 7 sells tuition plus an optional $45 EPWB certificate as one offer,
// and "tuition discounts do not apply to the certificate." Offers without
// `discount_exempt_cents` (every offer before 2026-10-16) discount in full,
// exactly as before.
export function discountableAmountCents(offer, listAmountCents) {
  const list = Math.max(0, Number(listAmountCents) || 0);
  const exempt = Math.max(0, Number(offer?.discount_exempt_cents) || 0);
  return Math.max(0, list - exempt);
}
