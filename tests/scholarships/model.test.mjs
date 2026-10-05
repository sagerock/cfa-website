import test from 'node:test';
import assert from 'node:assert/strict';
import { assessment, emptyApplication, validateStep, sampleApplication, sampleInternational, programs, runsFor, costOf, request, isInternational } from '../../src/lib/scholarships/model.js';
import { ttPrograms, emptyTT, sampleTT, validateTT, STEPS } from '../../src/lib/scholarships/teacher-training.js';
import { CALENDAR } from '../../src/data/calendar.js';
const plan=()=>({monthly:'50',months:'6',support:'200'});
test('gap deducts monthly contribution and confirmed support',()=>assert.deepEqual(assessment(plan(),3000),{tuition:3000,contribution:300,support:200,gap:2500,percent:2500/3000*100}));
test('need cannot be negative and no income or essay scoring occurs',()=>{const a={...plan(),monthly:'1000',circumstances:'',income:'Under $30,000'};assert.equal(assessment(a,3000).gap,0);assert.deepEqual(assessment(a,3000),assessment({...a,income:'Over $150,000',circumstances:'An elaborate essay'},3000));});
test('missing, negative, infinite and invalid terms never become a zero-dollar recommendation',()=>{for(const value of ['', '-1','NaN','Infinity']) assert.equal(assessment({...plan(),monthly:value},3000),null);for(const value of ['0','1.5','25']) assert.equal(assessment({...plan(),months:value},3000),null);assert.equal(assessment({...plan(),support:''},3000),null);});
test('zero contribution is valid and cents are preserved',()=>{assert.equal(assessment({...plan(),monthly:'0',support:'0'},3000).gap,3000);assert.equal(assessment({...plan(),monthly:'10.01',months:'3',support:'0'},100).gap,69.97);});
test('submission requires applicant confirmation',()=>{assert.ok(validateStep(emptyApplication(),0,'2026-09-23'));assert.ok(validateStep(emptyApplication(),3,'2026-09-23'));assert.equal(validateStep(sampleApplication(),3,'2026-09-23'),'');});
test('universal form lists the six short programs; teacher training is its own form (Milan, 2026-10-04)',()=>{
  assert.deepEqual(programs.map(p=>p.id),['building-bridges','explorations-online','mentor-training','renewal-courses','starlight-rays','waldorf-leadership-development']);
  for (const p of programs) assert.ok(CALENDAR.some(e=>e.program===p.calendar), `${p.id} has no calendar entry`);
  assert.deepEqual(ttPrograms.map(p=>p.id),['antioch','whistep']);
  assert.equal(STEPS[1],'Your path');
  assert.equal(STEPS[2],'What’s manageable');
});
test('universal form: no payment-plan step; cost fills in from the program (Milan, 2026-10-05)',()=>{
  const a=sampleApplication();
  assert.equal(costOf(a),850);
  assert.equal(costOf({...a,option:''}),undefined);
  assert.equal(costOf({...a,program:'mentor-training',option:''}),2600);
  assert.equal(costOf({...a,program:'renewal-courses',option:''}),null);
  assert.deepEqual(request(a),{cost:850,aid:400,share:450,percent:400/850*100});
  assert.match(validateStep({...a,option:''},0,'2026-10-05'),/tuition/);
  assert.match(validateStep({...a,aid:''},1,'2026-10-05'),/aid/);
  assert.match(validateStep({...a,aid:'900'},1,'2026-10-05'),/at most/);
  assert.equal(validateStep(a,1,'2026-10-05'),'');
  assert.ok(!('monthly' in a) && !('months' in a));
});
test('universal step three asks monthly income, expenses, assets and employment',()=>{
  const a=sampleApplication();
  assert.equal(validateStep(a,2,'2026-10-05'),'');
  assert.match(validateStep({...a,employment:''},2,'2026-10-05'),/employed/);
  assert.match(validateStep({...a,income:''},2,'2026-10-05'),/income/);
  assert.match(validateStep({...a,expenses:'-1'},2,'2026-10-05'),/expenses/);
  assert.match(validateStep({...a,assets:''},2,'2026-10-05'),/assets/);
  assert.equal(validateStep({...a,income:'0',assets:'0'},2,'2026-10-05'),'');
});
test('applicants outside the US take their own finance path, in their currency',()=>{
  const i=sampleInternational();
  assert.ok(isInternational(i)); assert.ok(!isInternational(sampleApplication()));
  for (const step of [0,1,2,3]) assert.equal(validateStep(i,step,'2026-10-05'),'',`step ${step}`);
  assert.match(validateStep({...i,currency:''},2,'2026-10-05'),/currency/);
  assert.match(validateStep({...i,payUsd:''},2,'2026-10-05'),/US dollars/);
  assert.equal(validateStep({...sampleApplication(),currency:'',payUsd:''},2,'2026-10-05'),'');
  assert.match(validateStep({...i,country:'Another country',otherCountry:''},0,'2026-10-05'),/which country/);
});
test('teacher training form: every step validates for the sample and blocks when empty',()=>{
  const s=sampleTT();
  for (let i=0;i<STEPS.length;i++) assert.equal(validateTT(s,i),'',`step ${i}`);
  for (const i of [0,1,2,3,4,5]) assert.ok(validateTT(emptyTT(),i),`empty step ${i}`);
  assert.match(validateTT({...s,bankruptcy:'Yes'},3),/explanation/);
  assert.equal(validateTT({...s,bankruptcy:'Yes',explain:'2015, discharged.'},3),'');
  assert.match(validateTT({...s,monthly:'-5'},2),/monthly/);
  assert.match(validateTT({...s,affirmed:false},5),/confirm/);
  assert.match(validateTT({...s,program:'tshe'},0),/program/);
  assert.match(validateTT({...s,year:''},0),/year of study/);
  assert.match(validateTT({...s,graduation:'2029'},0),/graduation/);
  assert.match(validateTT({...s,involvement:'  '},1),/anthroposophy/);
});
test('dates come from the calendar, past sessions drop off, next cohort is always offered',()=>{
  const wlcd=runsFor('waldorf-leadership-development','2026-09-23');
  assert.ok(wlcd.some(r=>r.id==='wlcd-fall-residency-2026'));
  assert.equal(wlcd.at(-1).id,'next');
  assert.ok(!runsFor('waldorf-leadership-development','2026-11-01').some(r=>r.id==='wlcd-fall-residency-2026'));
});
test('step one needs a country, program, dates and tuition option',()=>{
  const a={...sampleApplication()};
  assert.equal(validateStep(a,0,'2026-09-23'),'');
  assert.match(validateStep({...a,country:''},0,'2026-09-23'),/country/);
  assert.match(validateStep({...a,run:''},0,'2026-09-23'),/dates/);
  assert.match(validateStep({...a,run:'starlight-2026-27'},0,'2026-09-23'),/dates/);
});
