import test from 'node:test';
import assert from 'node:assert/strict';
import { isPublic, isHeld, publicEvents, normalize, months, programHref } from '../src/lib/program-calendar.js';
import data from '../src/data/program-calendar.json' with { type: 'json' };

test('internal entries never show (Caitlin, 2026-10-05)', () => {
  for (const t of ['TENTATIVE Save the Date: Renewal 2027 (both weeks)', 'Registration Cut-off (TBD): WLD Spring Residency', 'TENTATIVE Registration Opens: Kairos ColorWorks', 'Registration Opens: X', 'TENTATIVE: Kairos ColorWorks with Charles Andrade (1 of 4)', 'Promotion: The Karma of Money', 'TENTATIVE Promotion: The Karma of Money (social post + email campaign)', ''])
    assert.equal(isPublic(t), false, t);
  for (const t of ['Starlight Rays: Sven Saar', 'Renewal Week 2: Online', 'WLD: Spring Residency (Keene, NH)'])
    assert.equal(isPublic(t), true, t);
});
test('the committed snapshot holds no internal entries', () => {
  assert.ok(data.events.length > 0);
  for (const e of data.events) assert.ok(isPublic(e.title), e.title);
});
test('times convert to Eastern; all-day ends are exclusive', () => {
  assert.deepEqual(normalize({ title: 'S', start: '2026-10-10T16:00:00-03:00', end: '2026-10-10T17:30:00-03:00' }), { title: 'S', date: '2026-10-10', end: undefined, time: '3:00–4:30 pm ET' });
  assert.deepEqual(normalize({ title: 'S', start: '2026-11-07T16:00:00-04:00', end: '2026-11-07T17:30:00-04:00' }), { title: 'S', date: '2026-11-07', end: undefined, time: '3:00–4:30 pm ET' });
  assert.deepEqual(normalize({ title: 'R', start: '2026-10-09', end: '2026-10-14' }), { title: 'R', date: '2026-10-09', end: '2026-10-13' });
  assert.deepEqual(normalize({ title: 'D', start: '2026-10-09', end: '2026-10-10' }), { title: 'D', date: '2026-10-09', end: undefined });
  assert.equal(normalize({ title: 'M', start: '2026-10-17T11:00:00-04:00', end: '2026-10-17T13:00:00-04:00' }).time, '11:00 am–1:00 pm ET');
});
test('months group a program’s dates and drop what has passed', () => {
  const ev = [
    { title: 'Explorations Online: 2026-27 Cycle', start: '2026-11-07T13:00:00-04:00', end: '2026-11-07T15:00:00-04:00' },
    { title: 'Explorations Online: 2026-27 Cycle', start: '2026-11-08T13:00:00-04:00', end: '2026-11-08T15:00:00-04:00' },
    { title: 'TENTATIVE Save the Date: WLD Spring Residency', start: '2026-11-06', end: '2026-11-07' },
    { title: 'Starlight Rays: Old', start: '2026-09-26T16:00:00-03:00', end: '2026-09-26T17:30:00-03:00' },
  ];
  const m = months(ev, '2026-10-05');
  assert.equal(m.length, 1);
  assert.equal(m[0].rows.length, 1);
  assert.equal(m[0].rows[0].sessions.length, 2);
  assert.match(m[0].rows[0].href, /explorations-online/);
});
// The Karma of Money has no CfA program page yet (whether it gets one is Sage's call).
const NO_PAGE_YET = [/^The Karma of Money\b/];
test('every program in the snapshot links to a program page', () => {
  for (const e of data.events) if (!NO_PAGE_YET.some((re) => re.test(e.title))) assert.ok(programHref(e.title), e.title);
});

test('entries with a "confirm" note are held back, with their series (Caitlin, 2026-10-05)', () => {
  assert.equal(isHeld('Lisl\'s calendar blocks Apr 23-30; confirm exact end date.'), true);
  assert.equal(isHeld('CONFIRM DATE: website weekdays match 2026.'), true);
  assert.equal(isHeld('Apr 23-26, 2027, confirmed by Torin.'), false);
  assert.equal(isHeld(undefined), false);
  const raw = [
    { title: 'Kairos: Emergency Pedagogy Module 7 with Bernd Ruf (Day 1)', start: '2027-01-15', end: '2027-01-16', description: 'confirm these are the final dates.' },
    { title: 'Kairos: Emergency Pedagogy Module 7 with Bernd Ruf (Day 2)', start: '2027-01-16', end: '2027-01-17', description: '' },
    { title: 'WLD: Spring Residency (Keene, NH)', start: '2027-04-23', end: '2027-04-27', description: 'confirmed by Torin' },
  ];
  assert.deepEqual(publicEvents(raw).map((e) => e.title), ['WLD: Spring Residency (Keene, NH)']);
});
test('the committed snapshot holds no event descriptions', () => {
  for (const e of data.events) assert.equal(e.description, undefined, e.title);
});
