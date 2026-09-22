import test from 'node:test';
import assert from 'node:assert/strict';
import { assessment, emptyApplication, validateStep, sampleApplication } from '../../src/lib/scholarships/model.js';
test('gap deducts monthly contribution and confirmed support',()=>assert.deepEqual(assessment(sampleApplication(),3000),{tuition:3000,contribution:1500,support:300,gap:1200,percent:40}));
test('need cannot be negative and no income or essay scoring occurs',()=>{const a={...sampleApplication(),monthly:'1000',purpose:'',income:'0'};assert.equal(assessment(a,3000).gap,0);assert.deepEqual(assessment(a,3000),assessment({...a,income:'100000',purpose:'An elaborate essay'},3000));});
test('missing, negative, infinite and invalid terms never become a zero-dollar recommendation',()=>{for(const value of ['', '-1','NaN','Infinity']) assert.equal(assessment({...sampleApplication(),monthly:value},3000),null);for(const value of ['0','1.5','25']) assert.equal(assessment({...sampleApplication(),months:value},3000),null);assert.equal(assessment({...sampleApplication(),support:''},3000),null);});
test('zero contribution is valid and cents are preserved',()=>{assert.equal(assessment({...sampleApplication(),monthly:'0',support:'0'},3000).gap,3000);assert.equal(assessment({...sampleApplication(),monthly:'10.01',months:'3',support:'0'},100).gap,69.97);});
test('submission requires applicant confirmation',()=>{assert.ok(validateStep(emptyApplication(),0));assert.ok(validateStep(emptyApplication(),3));assert.equal(validateStep(sampleApplication(),3),'');});
