// Amount math and validation for the unified donation form. Shared by the
// /donate page (so the ledger the donor sees matches) and the cfa-donate edge
// function (which recomputes everything and never trusts a browser total).
//
// All money is integer cents. A monthly gift is "N payments of X", where X is
// what the donor typed; the card is charged X (+ the optional fee) today and
// the rest run as an Authorize.Net ARB subscription.

import { hasRequiredBillingAddressFields, isSupportedBillingCountry } from './billingCountries.js';
import { DEFAULT_FUND_SLUG, findFund } from './donationFunds.js';

export const SUGGESTED_AMOUNTS = Object.freeze([35, 50, 100, 250, 500, 1000]);
export const MONTH_OPTIONS = Object.freeze([3, 6, 12]);
export const FREQUENCIES = Object.freeze(['once', 'monthly']);
export const METHODS = Object.freeze(['card', 'check']);
export const TRIBUTE_TYPES = Object.freeze(['honor', 'memory']);

// 3% in basis points, the rate CfA's Gravity Forms add for cards. Here it is
// optional and off by default: the donor may choose to cover it.
export const PROCESSING_FEE_BPS = 300;

// A floor keeps the form from being useful for card testing (fraudsters run
// stolen cards through donation forms at $1). The edge function can lower it
// to $1 for one controlled live test via DONATION_MIN_CENTS; see the docs.
export const MIN_GIFT_CENTS = 500;
export const ABSOLUTE_MIN_GIFT_CENTS = 100;
// Largest single card charge. Bigger gifts are welcome by check or by talking
// to the office, which is also the safer path for a gift that size.
export const MAX_CARD_CHARGE_CENTS = 2500000;
export const MAX_CHECK_PLEDGE_CENTS = 100000000;

export const CHECK_PAYABLE_TO = 'Center for Anthroposophy';
export const CHECK_MAILING_ADDRESS = Object.freeze(['PO Box 15', 'McMinnville, TN 37111']);
export const CFA_TAX_ID = '04-3341510';

export function formatUsd(cents) {
  const value = Number(cents) / 100;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(value);
}

// "$1,000", "25.5", 250 -> integer cents. Anything else (negatives, three
// decimal places, words, exponents) -> NaN.
export function parseAmountToCents(value) {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return NaN;
    const cents = Math.round(value * 100);
    return Math.abs(cents - value * 100) < 1e-6 ? cents : NaN;
  }
  if (typeof value !== 'string') return NaN;
  const cleaned = value.trim().replace(/^\$/, '').replace(/,(?=\d{3}(\D|$))/g, '');
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(cleaned)) return NaN;
  const [whole, fraction = ''] = cleaned.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
}

export function processingFeeCents(giftCents) {
  return Math.round((giftCents * PROCESSING_FEE_BPS) / 10000);
}

// Accepts { frequency: 'once' } or { frequency: 'monthly', months: 6 }, and the
// shorthand 'monthly-6' a campaign link might use. Returns null if invalid.
export function normalizeFrequency(frequency, months) {
  const raw = String(frequency ?? '').trim().toLowerCase();
  if (raw === '' || raw === 'once' || raw === 'one-time' || raw === 'onetime') {
    return { frequency: 'once', months: 1 };
  }
  const shorthand = raw.match(/^monthly-(\d{1,2})$/);
  if (raw === 'monthly' || shorthand) {
    const count = Number(shorthand ? shorthand[1] : months);
    return MONTH_OPTIONS.includes(count) ? { frequency: 'monthly', months: count } : null;
  }
  return null;
}

// The whole ledger for one gift. `payments` is 1 for a one-time gift.
export function computeDonation({ giftCents, frequency = 'once', months = 1, method = 'card', coverFee = false }) {
  const payments = frequency === 'monthly' ? months : 1;
  const feeCents = method === 'card' && coverFee ? processingFeeCents(giftCents) : 0;
  const chargeCents = giftCents + feeCents;
  return {
    giftCents,
    feeCents,
    chargeCents,
    payments,
    giftTotalCents: giftCents * payments,
    feeTotalCents: feeCents * payments,
    scheduleTotalCents: chargeCents * payments,
  };
}

// Same calendar day N months out, clamped to the end of shorter months, as ARB
// bills (a January 31 gift is next charged February 28). Mirrors cfa-register.
export function addMonthsClamped(date, months) {
  const day = date.getUTCDate();
  const target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

// ISO dates of every payment; the first is today and is charged immediately.
export function monthlySchedule(start, months) {
  return Array.from({ length: months }, (_, index) =>
    addMonthsClamped(start, index).toISOString().slice(0, 10));
}

function text(value, maxLength) {
  return value == null ? '' : String(value).trim().slice(0, maxLength);
}

function validEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Server-side validation of a submitted gift. Returns { ok, value, errors }.
// `errors` maps a field name to a short machine code the page turns into copy.
export function validateDonation(input, options = {}) {
  const minGiftCents = Math.max(ABSOLUTE_MIN_GIFT_CENTS, options.minGiftCents ?? MIN_GIFT_CENTS);
  const body = input && typeof input === 'object' ? input : {};
  const errors = {};

  const giftCents = parseAmountToCents(body.amount);
  const method = METHODS.includes(body.method) ? body.method : null;
  if (!method) errors.method = 'invalid';

  const schedule = normalizeFrequency(body.frequency, body.months);
  if (!schedule) errors.frequency = 'invalid';
  else if (schedule.frequency === 'monthly' && method === 'check') errors.frequency = 'monthly_requires_card';

  if (!Number.isInteger(giftCents)) errors.amount = 'invalid';
  else if (giftCents < minGiftCents) errors.amount = 'too_small';

  const fund = findFund(body.fund || DEFAULT_FUND_SLUG);
  if (!fund || !fund.active) errors.fund = 'unavailable';

  const coverFee = body.cover_fee === true && method === 'card';
  const ledger = Number.isInteger(giftCents) && schedule && method
    ? computeDonation({ giftCents, frequency: schedule.frequency, months: schedule.months, method, coverFee })
    : null;
  if (ledger && !errors.amount) {
    if (method === 'card' && ledger.chargeCents > MAX_CARD_CHARGE_CENTS) errors.amount = 'too_large_for_card';
    if (method === 'check' && ledger.giftCents > MAX_CHECK_PLEDGE_CENTS) errors.amount = 'too_large';
  }

  const firstName = text(body.first_name, 100);
  const lastName = text(body.last_name, 100);
  const email = text(body.email, 254).toLowerCase();
  const phone = text(body.phone, 50);
  if (!firstName) errors.first_name = 'required';
  if (!lastName) errors.last_name = 'required';
  if (!validEmail(email)) errors.email = 'invalid';

  const rawAddress = body.address && typeof body.address === 'object' ? body.address : {};
  const address = {
    address: text(rawAddress.address, 200),
    address2: text(rawAddress.address2, 200),
    city: text(rawAddress.city, 100),
    state: text(rawAddress.state, 100),
    zip: text(rawAddress.zip, 30),
    country: text(rawAddress.country || 'US', 2).toUpperCase(),
  };
  if (!isSupportedBillingCountry(address.country)) errors.address = 'country';
  else if (!hasRequiredBillingAddressFields(address)) errors.address = 'incomplete';

  const rawTribute = body.tribute && typeof body.tribute === 'object' ? body.tribute : {};
  const tributeType = TRIBUTE_TYPES.includes(rawTribute.type) ? rawTribute.type : null;
  const tributeName = tributeType ? text(rawTribute.name, 200) : '';
  if (tributeType && !tributeName) errors.tribute = 'name_required';

  const value = {
    giftCents,
    fund: fund?.slug ?? null,
    frequency: schedule?.frequency ?? null,
    months: schedule?.months ?? null,
    method,
    coverFee,
    ledger,
    firstName,
    lastName,
    email,
    phone,
    address,
    note: text(body.note, 1000),
    tributeType,
    tributeName,
    anonymous: body.anonymous === true,
    newsletter: body.newsletter === true,
    plannedGivingInfo: body.planned_giving_info === true,
  };
  return { ok: Object.keys(errors).length === 0, value, errors };
}

// Deep links: /donate?fund=kairos-scholarships&amount=100&frequency=monthly&months=6
// Anything unrecognised is dropped rather than guessed. An inactive fund falls
// back to General Support and says so, so an old mailing never dead-ends.
export function parseDonationPrefill(params) {
  const get = (key) => (typeof params?.get === 'function' ? params.get(key) : params?.[key]) ?? '';
  const result = { fund: DEFAULT_FUND_SLUG, fundNotice: null, amountCents: null, frequency: 'once', months: 12, method: 'card' };

  const requestedFund = String(get('fund')).trim();
  if (requestedFund) {
    const fund = findFund(requestedFund);
    if (fund?.active) result.fund = fund.slug;
    else result.fundNotice = fund ? 'inactive' : 'unknown';
  }

  const cents = parseAmountToCents(String(get('amount')));
  if (Number.isInteger(cents) && cents >= MIN_GIFT_CENTS && cents <= MAX_CARD_CHARGE_CENTS) {
    result.amountCents = cents;
  }

  const schedule = normalizeFrequency(get('frequency'), get('months') || 12);
  if (schedule) {
    result.frequency = schedule.frequency;
    if (schedule.frequency === 'monthly') result.months = schedule.months;
  }

  if (String(get('method')).trim().toLowerCase() === 'check' && result.frequency === 'once') {
    result.method = 'check';
  }
  return result;
}
