import test from 'node:test';
import assert from 'node:assert/strict';

import {
  offerBaseAmountCents,
  recordedSeatCount,
  resolveSeatCount,
  seatRange,
} from '../supabase/functions/_shared/seatPricing.js';

const individual = { code: 'residency', amount_cents: 85000, seat_count: 1, per_seat: false };
const group = { code: 'residency-group', amount_cents: 68000, seat_count: 1, per_seat: true, min_seats: 3, max_seats: 12 };
const institution = { code: 'institution', amount_cents: 122000, seat_count: 20, per_seat: false };

test('a normal offer ignores whatever seat count the browser sends', () => {
  assert.deepEqual(resolveSeatCount(individual, 9), { ok: true, seats: 1 });
  assert.equal(offerBaseAmountCents(individual, 9), 85000);
  assert.equal(recordedSeatCount(individual, 9), 1);
});

test('a flat institution offer still records its own seat allowance', () => {
  assert.equal(offerBaseAmountCents(institution, 4), 122000);
  assert.equal(recordedSeatCount(institution, 4), 20);
});

test('a per-seat offer multiplies by the seats bought', () => {
  assert.deepEqual(resolveSeatCount(group, 3), { ok: true, seats: 3 });
  assert.equal(offerBaseAmountCents(group, 3), 204000);
  assert.equal(offerBaseAmountCents(group, 5), 340000);
  assert.equal(recordedSeatCount(group, 5), 5);
});

test('a per-seat offer refuses counts outside its range', () => {
  for (const asked of [2, 0, -1, 13, 2.5, 'three', null, undefined, NaN]) {
    assert.deepEqual(
      resolveSeatCount(group, asked),
      { ok: false, error: 'invalid_seat_count' },
      `seats=${String(asked)} must be rejected`,
    );
  }
});

test('the group rate is exactly 20% off the individual rate', () => {
  assert.equal(group.amount_cents, Math.round(individual.amount_cents * 0.8));
});

test('seat range falls back to the offer allowance when no maximum is set', () => {
  assert.deepEqual(seatRange({ per_seat: true, min_seats: 2, seat_count: 6 }), { min: 2, max: 6 });
  assert.deepEqual(seatRange({}), { min: 1, max: 1 });
});
