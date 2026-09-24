import test from 'node:test';
import assert from 'node:assert/strict';
import { assessment, emptyApplication, validateStep, sampleApplication, programs, runsFor, GROUPS } from '../../src/lib/scholarships/model.js';
import { CALENDAR } from '../../src/data/calendar.js';
test('gap deducts monthly contribution and confirmed support',()=>assert.deepEqual(assessment(sampleApplication(),3000),{tuition:3000,contribution:300,support:200,gap:2500,percent:2500/3000*100}));
test('need cannot be negative and no income or essay scoring occurs',()=>{const a={...sampleApplication(),monthly:'1000',purpose:'',income:'0'};assert.equal(assessment(a,3000).gap,0);assert.deepEqual(assessment(a,3000),assessment({...a,income:'100000',purpose:'An elaborate essay'},3000));});
test('missing, negative, infinite and invalid terms never become a zero-dollar recommendation',()=>{for(const value of ['', '-1','NaN','Infinity']) assert.equal(assessment({...sampleApplication(),monthly:value},3000),null);for(const value of ['0','1.5','25']) assert.equal(assessment({...sampleApplication(),months:value},3000),null);assert.equal(assessment({...sampleApplication(),support:''},3000),null);});
test('zero contribution is valid and cents are preserved',()=>{assert.equal(assessment({...sampleApplication(),monthly:'0',support:'0'},3000).gap,3000);assert.equal(assessment({...sampleApplication(),monthly:'10.01',months:'3',support:'0'},100).gap,69.97);});
test('submission requires applicant confirmation',()=>{assert.ok(validateStep(emptyApplication(),0,'2026-09-23'));assert.ok(validateStep(emptyApplication(),3,'2026-09-23'));assert.equal(validateStep(sampleApplication(),3,'2026-09-23'),'');});
test('Milan’s eight programs, in two groups, each tied to the calendar or explicitly not',()=>{
  assert.deepEqual(GROUPS,['Professional Development','Teacher Training']);
  assert.equal(programs.filter(p=>p.group==='Professional Development').length,6);
  assert.deepEqual(programs.filter(p=>p.group==='Teacher Training').map(p=>p.id),['antioch','whistep']);
  for (const p of programs) if (p.calendar) assert.ok(CALENDAR.some(e=>e.program===p.calendar), `${p.id} has no calendar entry`);
});
test('dates come from the calendar, past sessions drop off, next cohort is always offered',()=>{
  const wlcd=runsFor('waldorf-leadership-development','2026-09-23');
  assert.ok(wlcd.some(r=>r.id==='wlcd-fall-residency-2026'));
  assert.equal(wlcd.at(-1).id,'next');
  assert.ok(!runsFor('waldorf-leadership-development','2026-11-01').some(r=>r.id==='wlcd-fall-residency-2026'));
  assert.deepEqual(runsFor('antioch','2026-09-23').map(r=>r.id),['next']);
});
test('step one needs a program and dates; step two needs a cost',()=>{
  const a={...sampleApplication()};
  assert.equal(validateStep(a,0,'2026-09-23'),'');
  assert.match(validateStep({...a,run:''},0,'2026-09-23'),/dates/);
  assert.match(validateStep({...a,run:'starlight-2026-27'},0,'2026-09-23'),/dates/);
  assert.match(validateStep({...a,tuition:''},1,'2026-09-23'),/cost/);
  assert.equal(validateStep(a,1,'2026-09-23'),'');
});
