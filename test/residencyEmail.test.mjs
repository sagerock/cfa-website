import test from 'node:test';
import assert from 'node:assert/strict';

import { buildResidencyEmailText } from '../supabase/functions/_shared/residencyEmail.js';

const base = {
  firstName: 'Karen',
  programTitle: 'the October residency in Keene',
  offerName: 'October residency — one participant',
  amount: '$850.00',
  transactionId: '1234567890',
  seats: 1,
  participants: [],
  details: [
    'Friday, October 9 through Tuesday, October 13, 2026',
    'Gathering Waters Charter School, Keene, New Hampshire',
  ],
  cancellationUrl: 'https://learn.centerforanthroposophy.org/policies/cancellation/',
  contactEmail: 'office@centerforanthroposophy.org',
};

test('an in-person confirmation names the dates and never offers a sign-in link', () => {
  const text = buildResidencyEmailText(base);
  assert.match(text, /Dear Karen,/);
  assert.match(text, /October 9 through Tuesday, October 13, 2026/);
  assert.match(text, /Gathering Waters Charter School/);
  assert.match(text, /Amount: \$850\.00$/m);
  assert.doesNotMatch(text, /sign in|sign-in|portal|token_hash/i);
});

test('a group registration says how many it covers and lists them', () => {
  const text = buildResidencyEmailText({
    ...base,
    offerName: 'October residency — school group',
    amount: '$2,040.00',
    seats: 3,
    participants: [
      { first_name: 'Ada', last_name: 'Nunez', email: 'ada@example.org' },
      { first_name: 'Bo', last_name: 'Feld', email: '' },
      { first_name: '', last_name: '', email: '' },
    ],
  });
  assert.match(text, /Amount: \$2,040\.00 for 3 people/);
  assert.match(text, /Ada Nunez — ada@example\.org/);
  assert.match(text, /^ {2}Bo Feld$/m);
  assert.doesNotMatch(text, /^ {2}—/m);
});

test('an empty roster leaves the section out entirely', () => {
  assert.doesNotMatch(buildResidencyEmailText(base), /Registered:/);
});

test('a Spanish program gets a Spanish receipt, not a translated English one', () => {
  const text = buildResidencyEmailText({
    ...base,
    locale: 'es',
    firstName: 'Magnolia',
    programTitle: 'Biografía y Arte Social 2026',
    offerName: 'Curso completo · 8 sesiones',
    amount: '$175.00',
    details: [
      'Ocho miércoles, del 7 de octubre al 25 de noviembre de 2026',
      'De 7:00 a 8:30 pm, hora del Este de EE. UU.',
    ],
  });
  assert.match(text, /^Hola Magnolia:/);
  assert.match(text, /Gracias por inscribirte en Biografía y Arte Social 2026\./);
  assert.match(text, /Inscripción: Curso completo/);
  assert.match(text, /Importe: \$175\.00 USD$/m);
  assert.match(text, /Ocho miércoles, del 7 de octubre/);
  assert.doesNotMatch(text, /Dear |Thank you|Amount:|Transaction:|contact /);
});

test('an unknown locale falls back to English rather than printing nothing', () => {
  const text = buildResidencyEmailText({ ...base, locale: 'fr' });
  assert.match(text, /Dear Karen,/);
  assert.match(text, /Amount: \$850\.00$/m);
});
