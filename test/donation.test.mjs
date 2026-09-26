import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DONATION_FUNDS,
  DONATION_FUND_GROUPS,
  activeFunds,
  findFund,
  namedFunds,
} from '../supabase/functions/_shared/donationFunds.js';
import {
  MIN_GIFT_CENTS,
  computeDonation,
  monthlySchedule,
  normalizeFrequency,
  parseAmountToCents,
  parseDonationPrefill,
  processingFeeCents,
  validateDonation,
} from '../supabase/functions/_shared/donationMath.js';
import {
  buildCardReceipt,
  buildCheckPledgeEmail,
  buildCheckReceipt,
  buildStaffNotice,
} from '../supabase/functions/_shared/donationEmail.js';

const donor = {
  first_name: 'Test',
  last_name: 'Donor',
  email: 'Donor@Example.org',
  address: { address: '1 Main St', city: 'Keene', state: 'NH', zip: '03431', country: 'US' },
};

test('amounts parse to integer cents and reject anything ambiguous', () => {
  assert.equal(parseAmountToCents('100'), 10000);
  assert.equal(parseAmountToCents('$1,000'), 100000);
  assert.equal(parseAmountToCents('1,000.50'), 100050);
  assert.equal(parseAmountToCents('25.5'), 2550);
  assert.equal(parseAmountToCents(35), 3500);
  assert.equal(parseAmountToCents(0.1), 10);
  for (const bad of ['', 'abc', '-5', '1e3', '10.555', '10,00', null, undefined, NaN, -1, 25.555, {}]) {
    assert.ok(Number.isNaN(parseAmountToCents(bad)), `expected NaN for ${String(bad)}`);
  }
});

test('the optional card fee is 3% rounded to the cent, and off unless asked for', () => {
  assert.equal(processingFeeCents(10000), 300);
  assert.equal(processingFeeCents(3500), 105);
  assert.equal(processingFeeCents(3333), 100);
  assert.deepEqual(computeDonation({ giftCents: 10000 }), {
    giftCents: 10000, feeCents: 0, chargeCents: 10000, payments: 1,
    giftTotalCents: 10000, feeTotalCents: 0, scheduleTotalCents: 10000,
  });
  const covered = computeDonation({ giftCents: 10000, coverFee: true });
  assert.equal(covered.chargeCents, 10300);
});

test('a check never carries a card fee, even if the box was ticked', () => {
  assert.equal(computeDonation({ giftCents: 10000, method: 'check', coverFee: true }).feeCents, 0);
  const result = validateDonation({ ...donor, amount: '100', method: 'check', cover_fee: true });
  assert.equal(result.ok, true);
  assert.equal(result.value.coverFee, false);
  assert.equal(result.value.ledger.chargeCents, 10000);
});

test('monthly gifts are N payments of the typed amount, fee applied per payment', () => {
  const ledger = computeDonation({ giftCents: 5000, frequency: 'monthly', months: 6, coverFee: true });
  assert.equal(ledger.payments, 6);
  assert.equal(ledger.chargeCents, 5150);
  assert.equal(ledger.giftTotalCents, 30000);
  assert.equal(ledger.feeTotalCents, 900);
  assert.equal(ledger.scheduleTotalCents, 30900);
});

test('frequency accepts only one-time or 3, 6, 12 months', () => {
  assert.deepEqual(normalizeFrequency('once'), { frequency: 'once', months: 1 });
  assert.deepEqual(normalizeFrequency(''), { frequency: 'once', months: 1 });
  assert.deepEqual(normalizeFrequency('monthly', 3), { frequency: 'monthly', months: 3 });
  assert.deepEqual(normalizeFrequency('monthly', '12'), { frequency: 'monthly', months: 12 });
  assert.deepEqual(normalizeFrequency('monthly-6'), { frequency: 'monthly', months: 6 });
  assert.equal(normalizeFrequency('monthly', 24), null);
  assert.equal(normalizeFrequency('monthly'), null);
  assert.equal(normalizeFrequency('weekly'), null);
});

test('the schedule starts today and clamps to month ends like ARB', () => {
  assert.deepEqual(monthlySchedule(new Date('2026-01-31T15:00:00Z'), 3), ['2026-01-31', '2026-02-28', '2026-03-31']);
  assert.equal(monthlySchedule(new Date('2026-09-25T00:00:00Z'), 12).at(-1), '2027-08-25');
});

test('a complete card gift validates and normalizes', () => {
  const result = validateDonation({
    ...donor, amount: '250', fund: 'kairos', frequency: 'monthly', months: 12, method: 'card',
    cover_fee: true, anonymous: true, tribute: { type: 'memory', name: '  A. Teacher ' },
  });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.value.fund, 'kairos-institute');
  assert.equal(result.value.email, 'donor@example.org');
  assert.equal(result.value.tributeName, 'A. Teacher');
  assert.equal(result.value.ledger.chargeCents, 25750);
  assert.equal(result.value.anonymous, true);
  assert.equal(result.value.newsletter, false);
});

test('validation refuses what the server must never accept', () => {
  const base = { ...donor, amount: '100', method: 'card' };
  assert.equal(validateDonation({ ...base, amount: '4.99' }).errors.amount, 'too_small');
  assert.equal(validateDonation({ ...base, amount: '25000.01' }).errors.amount, 'too_large_for_card');
  assert.equal(validateDonation({ ...base, amount: '25000', cover_fee: true }).errors.amount, 'too_large_for_card');
  assert.equal(validateDonation({ ...base, amount: '30000', method: 'check' }).ok, true);
  assert.equal(validateDonation({ ...base, fund: 'creative-speech' }).errors.fund, 'unavailable');
  assert.equal(validateDonation({ ...base, fund: 'nope' }).errors.fund, 'unavailable');
  assert.equal(validateDonation({ ...base, method: 'check', frequency: 'monthly', months: 6 }).errors.frequency, 'monthly_requires_card');
  assert.equal(validateDonation({ ...base, method: 'cash' }).errors.method, 'invalid');
  assert.equal(validateDonation({ ...base, email: 'not-an-email' }).errors.email, 'invalid');
  assert.equal(validateDonation({ ...base, first_name: ' ' }).errors.first_name, 'required');
  assert.equal(validateDonation({ ...base, address: { ...donor.address, city: '' } }).errors.address, 'incomplete');
  assert.equal(validateDonation({ ...base, tribute: { type: 'honor', name: '' } }).errors.tribute, 'name_required');
  // A browser-sent total is simply ignored.
  assert.equal(validateDonation({ ...base, total: 1, charge_cents: 1 }).value.ledger.chargeCents, 10000);
  // The $1 controlled test path lowers the floor, never below $1.
  assert.equal(validateDonation({ ...base, amount: '1' }, { minGiftCents: 100 }).ok, true);
  assert.equal(validateDonation({ ...base, amount: '0.50' }, { minGiftCents: 1 }).errors.amount, 'too_small');
});

test('deep links prefill what they recognise and drop the rest', () => {
  const params = new URLSearchParams('fund=kairos-scholarships&amount=100&frequency=monthly&months=6');
  assert.deepEqual(parseDonationPrefill(params), {
    fund: 'kairos-scholarships', fundNotice: null, amountCents: 10000, frequency: 'monthly', months: 6, method: 'card',
  });
  const legacy = parseDonationPrefill(new URLSearchParams('fund=creative-speech&amount=2&frequency=monthly&months=7&method=check'));
  assert.equal(legacy.fund, 'general-support');
  assert.equal(legacy.fundNotice, 'inactive');
  assert.equal(legacy.amountCents, null);
  assert.equal(legacy.frequency, 'once');
  assert.equal(legacy.method, 'check');
  assert.equal(parseDonationPrefill(new URLSearchParams('fund=unknown')).fundNotice, 'unknown');
  assert.equal(parseDonationPrefill(new URLSearchParams('frequency=monthly-3&method=check')).method, 'card');
  assert.equal(parseDonationPrefill(new URLSearchParams('fund=alumni')).fund, 'general-support');
  assert.equal(parseDonationPrefill({}).amountCents, null);
});

test('the fund list is well formed', () => {
  const slugs = new Set();
  const groups = new Set(DONATION_FUND_GROUPS.map((group) => group.id));
  for (const fund of DONATION_FUNDS) {
    assert.match(fund.slug, /^[a-z0-9-]+$/);
    assert.ok(!slugs.has(fund.slug), `duplicate ${fund.slug}`);
    slugs.add(fund.slug);
    assert.ok(groups.has(fund.group), `${fund.slug} has unknown group`);
    for (const alias of fund.aliases) {
      assert.ok(!slugs.has(alias), `alias ${alias} collides`);
      assert.equal(findFund(alias), fund);
    }
  }
  assert.equal(findFund('general-support').active, true);
  assert.ok(activeFunds().every((fund) => fund.active));
  assert.ok(DONATION_FUNDS.filter((fund) => fund.confirm).every((fund) => !fund.active));
});

// Torin Finser owns CfA's development guidelines; these five are his (2026-09-26).
// If this fails, someone changed the named funds without CfA saying so.
test('the five named funds are the ones CfA named', () => {
  assert.deepEqual(namedFunds().map((fund) => fund.slug), [
    'kairos-institute',
    'research',
    'douglas-gerwin-scholarship',
    'georg-locher-scholarship',
    'karine-munk-finser-renewal-scholarship',
  ]);
  // Research is named but deliberately not offered until CfA gives us its wording.
  assert.equal(findFund('research').active, false);
  assert.equal(findFund('diversity-scholarships').named, undefined);
});

const cardGift = () => ({
  ...validateDonation({ ...donor, amount: '100', fund: 'kairos-scholarships', method: 'card', cover_fee: true }).value,
  date: '2026-09-25',
  transactionId: '1234567890',
  cardLast4: '1111',
});

test('the card receipt carries every element of a written acknowledgment', () => {
  const { subject, text } = buildCardReceipt(cardGift());
  assert.match(subject, /Thank you/);
  assert.match(text, /Dear Test,/);
  assert.match(text, /Date: September 25, 2026/);
  assert.match(text, /Amount: \$103/);
  assert.match(text, /\$100 gift plus \$3 you added/);
  assert.match(text, /Designated to: Kairos Scholarships/);
  assert.match(text, /No goods or services were provided in exchange for this contribution\./);
  assert.match(text, /04-3341510/);
  assert.match(text, /Center for Anthroposophy\noffice@/);
  assert.doesNotMatch(text, /Sage|Jax|Claude/);
  assert.doesNotMatch(text, /\n\n\n/);
});

test('the monthly receipt states the schedule', () => {
  const gift = {
    ...validateDonation({ ...donor, amount: '50', method: 'card', frequency: 'monthly', months: 3 }).value,
    date: '2026-01-31',
    schedule: monthlySchedule(new Date('2026-01-31T12:00:00Z'), 3),
  };
  const { text } = buildCardReceipt(gift);
  assert.match(text, /payment 1 of 3/);
  assert.match(text, /remaining 2 will be charged on February 28, 2026/);
  assert.match(text, /last on March 31, 2026/);
});

test('a check pledge is explicitly not a receipt; the check receipt is', () => {
  const pledge = validateDonation({ ...donor, amount: '500', method: 'check' }).value;
  const { text } = buildCheckPledgeEmail(pledge);
  assert.match(text, /pledge of \$500/);
  assert.match(text, /PO Box 15\nMcMinnville, TN 37111/);
  assert.match(text, /not a tax receipt/);
  assert.doesNotMatch(text, /No goods or services/);
  const receipt = buildCheckReceipt(pledge, { amountCents: 45000, receivedOn: '2026-10-02', checkNumber: '1042' });
  assert.match(receipt.text, /Amount: \$450/);
  assert.match(receipt.text, /check #1042/);
  assert.match(receipt.text, /Date received: October 2, 2026/);
  assert.match(receipt.text, /No goods or services/);
});

test('the staff notice surfaces the follow-ups the office acts on', () => {
  const gift = { ...cardGift(), plannedGivingInfo: true, note: 'For the art therapy module' };
  const { subject, text } = buildStaffNotice(gift, { donationId: 'abc', transactionId: '1234567890', receiptSent: false });
  assert.match(subject, /New gift: \$100 to Kairos Scholarships from Test Donor/);
  assert.match(text, /Wants information on a bequest or planned gift: yes/);
  assert.match(text, /Card fee covered by donor: \$3/);
  assert.match(text, /For the art therapy module/);
  assert.match(text, /receipt email did not send/);
});
