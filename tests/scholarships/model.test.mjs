import test from 'node:test';
import assert from 'node:assert/strict';
import { assessment, emptyApplication, validateStep, sampleApplication, programs, runsFor } from '../../src/lib/scholarships/model.js';
import { ttPrograms, emptyTT, sampleTT, validateTT, STEPS } from '../../src/lib/scholarships/teacher-training.js';
import { CALENDAR } from '../../src/data/calendar.js';
test('gap deducts monthly contribution and confirmed support',()=>assert.deepEqual(assessment(sampleApplication(),3000),{tuition:3000,contribution:300,support:200,gap:2500,percent:2500/3000*100}));
test('need cannot be negative and no income or essay scoring occurs',()=>{const a={...sampleApplication(),monthly:'1000',circumstances:'',income:'Under $30,000'};assert.equal(assessment(a,3000).gap,0);assert.deepEqual(assessment(a,3000),assessment({...a,income:'Over $150,000',circumstances:'An elaborate essay'},3000));});
test('missing, negative, infinite and invalid terms never become a zero-dollar recommendation',()=>{for(const value of ['', '-1','NaN','Infinity']) assert.equal(assessment({...sampleApplication(),monthly:value},3000),null);for(const value of ['0','1.5','25']) assert.equal(assessment({...sampleApplication(),months:value},3000),null);assert.equal(assessment({...sampleApplication(),support:''},3000),null);});
test('zero contribution is valid and cents are preserved',()=>{assert.equal(assessment({...sampleApplication(),monthly:'0',support:'0'},3000).gap,3000);assert.equal(assessment({...sampleApplication(),monthly:'10.01',months:'3',support:'0'},100).gap,69.97);});
test('submission requires applicant confirmation',()=>{assert.ok(validateStep(emptyApplication(),0,'2026-09-23'));assert.ok(validateStep(emptyApplication(),3,'2026-09-23'));assert.equal(validateStep(sampleApplication(),3,'2026-09-23'),'');});
test('universal form lists the six short programs; teacher training is its own form (Milan, 2026-10-04)',()=>{
  assert.deepEqual(programs.map(p=>p.id),['building-bridges','explorations-online','mentor-training','renewal-courses','starlight-rays','waldorf-leadership-development']);
  for (const p of programs) assert.ok(CALENDAR.some(e=>e.program===p.calendar), `${p.id} has no calendar entry`);
  assert.deepEqual(ttPrograms.map(p=>p.id),['antioch','whistep','tshe']);
  assert.equal(STEPS[1],'What’s manageable');
});
test('universal step three asks the existing aid-form questions',()=>{
  const a=sampleApplication();
  assert.equal(validateStep(a,2,'2026-09-23'),'');
  assert.match(validateStep({...a,income:''},2,'2026-09-23'),/income/);
  assert.match(validateStep({...a,teacherTraining:''},2,'2026-09-23'),/teacher training/);
});
test('teacher training form: every step validates for the sample and blocks when empty',()=>{
  const s=sampleTT();
  for (let i=0;i<STEPS.length;i++) assert.equal(validateTT(s,i),'',`step ${i}`);
  for (const i of [0,1,2,3,4]) assert.ok(validateTT(emptyTT(),i),`empty step ${i}`);
  assert.match(validateTT({...s,bankruptcy:'Yes'},2),/explanation/);
  assert.equal(validateTT({...s,bankruptcy:'Yes',explain:'2015, discharged.'},2),'');
  assert.match(validateTT({...s,monthly:'-5'},1),/monthly/);
  assert.match(validateTT({...s,affirmed:false},4),/confirm/);
});
test('dates come from the calendar, past sessions drop off, next cohort is always offered',()=>{
  const wlcd=runsFor('waldorf-leadership-development','2026-09-23');
  assert.ok(wlcd.some(r=>r.id==='wlcd-fall-residency-2026'));
  assert.equal(wlcd.at(-1).id,'next');
  assert.ok(!runsFor('waldorf-leadership-development','2026-11-01').some(r=>r.id==='wlcd-fall-residency-2026'));
});
test('step one needs a program and dates; step two needs a cost',()=>{
  const a={...sampleApplication()};
  assert.equal(validateStep(a,0,'2026-09-23'),'');
  assert.match(validateStep({...a,run:''},0,'2026-09-23'),/dates/);
  assert.match(validateStep({...a,run:'starlight-2026-27'},0,'2026-09-23'),/dates/);
  assert.match(validateStep({...a,tuition:''},1,'2026-09-23'),/cost/);
  assert.equal(validateStep(a,1,'2026-09-23'),'');
});
