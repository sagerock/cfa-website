import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FEATURED_BILLING_COUNTRY_CODES,
  ISO_COUNTRY_CODES,
  getBillingAddressRule,
  hasRequiredBillingAddressFields,
  isSupportedBillingCountry,
} from '../supabase/functions/_shared/billingCountries.js';

test('country list is complete, unique, and features Australia', () => {
  assert.equal(ISO_COUNTRY_CODES.length, 249);
  assert.equal(new Set(ISO_COUNTRY_CODES).size, ISO_COUNTRY_CODES.length);
  assert.deepEqual(FEATURED_BILLING_COUNTRY_CODES, ['US', 'CA', 'AU']);
  assert.equal(isSupportedBillingCountry('AU'), true);
  assert.equal(isSupportedBillingCountry('au'), true);
  assert.equal(isSupportedBillingCountry('XX'), false);
});

test('Australia uses Australian billing labels and required locality fields', () => {
  assert.deepEqual(getBillingAddressRule('AU'), {
    regionLabel: 'State or territory',
    postalLabel: 'Postcode',
    regionRequired: true,
    postalRequired: true,
    regionPlaceholder: 'e.g. NSW',
    postalPlaceholder: 'e.g. 2000',
  });
});

test('countries without a specific rule keep flexible locality fields', () => {
  const rule = getBillingAddressRule('GB');
  assert.equal(rule.regionRequired, false);
  assert.equal(rule.postalRequired, false);
  assert.equal(rule.regionLabel, 'State, province, or region');
});

test('server-side billing validation requires Australian state and postcode', () => {
  const australianAddress = {
    address: '1 Martin Place',
    city: 'Sydney',
    state: 'NSW',
    zip: '2000',
    country: 'AU',
  };
  assert.equal(hasRequiredBillingAddressFields(australianAddress), true);
  assert.equal(hasRequiredBillingAddressFields({ ...australianAddress, state: '' }), false);
  assert.equal(hasRequiredBillingAddressFields({ ...australianAddress, zip: '' }), false);
});

test('server-side billing validation permits flexible locality fields elsewhere', () => {
  assert.equal(hasRequiredBillingAddressFields({
    address: '10 Downing Street',
    city: 'London',
    state: '',
    zip: '',
    country: 'GB',
  }), true);
  assert.equal(hasRequiredBillingAddressFields({
    address: 'Somewhere',
    city: 'Nowhere',
    state: '',
    zip: '',
    country: 'XX',
  }), false);
});
