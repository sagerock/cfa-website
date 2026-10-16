import test from 'node:test';
import assert from 'node:assert/strict';

import { KAIROS_FORMS, validateSubmission, submissionText } from '../supabase/functions/_shared/kairosForms.js';

const aid = {
  first_name: 'Ana', last_name: 'Ruiz', email: 'ana@example.org',
  program: 'Emergency Pedagogy Module 7 (January 2027)',
  student_status: 'I am a Friend of Kairos taking individual courses',
  family_income: 'Under $20,000', family_size: '3', annual_income: '18000',
  annual_expenses: '17000', family_assets: '0', circumstances: 'Line one\nLine two',
};

test('financial aid: a complete application passes and unknown fields are dropped', () => {
  const out = validateSubmission('kairos-financial-aid', { ...aid, injected: 'x' });
  assert.equal(out.ok, true);
  assert.equal(out.values.program, aid.program);
  assert.equal('injected' in out.values, false);
});

test('financial aid: missing required field and off-list radio are refused', () => {
  assert.match(validateSubmission('kairos-financial-aid', { ...aid, family_size: ' ' }).error, /How many/);
  assert.equal(validateSubmission('kairos-financial-aid', { ...aid, program: 'Free stuff' }).ok, false);
  assert.equal(validateSubmission('kairos-financial-aid', { ...aid, email: 'nope' }).ok, false);
});

test('unknown form is refused', () => {
  assert.equal(validateSubmission('kairos-donate', aid).ok, false);
});

test('inquiry requires a message', () => {
  const base = { first_name: 'A', last_name: 'B', email: 'a@b.co' };
  assert.equal(validateSubmission('kairos-inquiry', base).ok, false);
  assert.equal(validateSubmission('kairos-inquiry', { ...base, message: 'Hello' }).ok, true);
});

test('notification text lists answered fields only', () => {
  const { values } = validateSubmission('kairos-financial-aid', aid);
  const text = submissionText('kairos-financial-aid', values);
  assert.match(text, /How many in the family\?: 3/);
  assert.match(text, /circumstances and needs:\nLine one\nLine two/);
  assert.doesNotMatch(text, /Phone:/);
});

test('every form has recipients and unique field names', () => {
  for (const [key, form] of Object.entries(KAIROS_FORMS)) {
    assert.ok(form.notify.length > 0, key);
    const names = form.fields.map((f) => f.name);
    assert.equal(new Set(names).size, names.length, key);
  }
});
