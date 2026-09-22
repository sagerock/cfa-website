// Run with PGLITE_MODULE pointing to an installed @electric-sql/pglite entry.
// This creates an isolated in-memory database; it never contacts Supabase.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const modulePath = process.env.PGLITE_MODULE;
test('database access boundaries and state transitions', { skip: !modulePath }, async () => {
  const { PGlite } = await import(modulePath);
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated,anon,service_role;
      grant execute on function auth.uid() to authenticated,anon,service_role;`);
    await db.exec(await readFile(new URL('../../supabase/migrations/20260922160000_scholarship_application_foundation.sql',import.meta.url),'utf8'));
    const alice='00000000-0000-4000-8000-000000000001';const bob='00000000-0000-4000-8000-000000000002';const staff='00000000-0000-4000-8000-000000000003';const program='00000000-0000-4000-8000-000000000010';
    await db.exec(`insert into auth.users values('${alice}'),('${bob}'),('${staff}');insert into public.cfa_scholarship_programs(id,name,tuition_cents,intake_open,policy_version) values('${program}','Test course',300000,true,'test-v1');insert into public.cfa_scholarship_reviewers(user_id) values('${staff}');`);
    const asUser=async id=>{await db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`);};
    const answers=JSON.stringify({name:'Test Applicant',monthly:'150',months:'10',support:'300',confirmed:true});
    const save=async(revision,submit=false)=>db.query('select * from public.cfa_scholarship_save($1,$2,$3,$4)',[program,answers,revision,submit]);
    await asUser(alice);const draft=(await save(0)).rows[0];assert.equal(draft.status,'draft');
    await assert.rejects(()=>save(0),/changed/);
    await assert.rejects(()=>db.exec(`update public.cfa_scholarship_applications set status='submitted'`),/permission denied/);
    await assert.rejects(()=>db.exec(`insert into public.cfa_scholarship_reviewers(user_id) values('${alice}')`),/permission denied/);
    await asUser(bob);assert.equal((await db.query('select * from public.cfa_scholarship_applications')).rows.length,0);
    await assert.rejects(()=>db.query('select public.cfa_scholarship_record_review($1,$2,$3)',[draft.id,'decline','test']),/Reviewer/);
    await asUser(staff);assert.equal((await db.query('select * from public.cfa_scholarship_applications')).rows.length,0);
    await asUser(alice);const submitted=(await save(1,true)).rows[0];assert.equal(submitted.tuition_cents,300000);assert.equal(submitted.policy_version,'test-v1');
    await assert.rejects(()=>save(2),/locked/);
    await asUser(staff);assert.equal((await db.query('select * from public.cfa_scholarship_applications')).rows.length,1);
    await db.query('select public.cfa_scholarship_record_review($1,$2,$3,$4)',[draft.id,'recommend_award','Test review',120000]);
    await assert.rejects(()=>db.query('select public.cfa_scholarship_record_review($1,$2,$3,$4)',[draft.id,'recommend_award','Test review',300001]),/exceeds/);
    await assert.rejects(()=>db.exec('delete from public.cfa_scholarship_reviews'),/permission denied/);
    await asUser(alice);assert.equal((await db.query('select * from public.cfa_scholarship_reviews')).rows.length,0);
    await assert.rejects(()=>db.query('select public.cfa_scholarship_claim_signin($1)',['a'.repeat(64)]),/permission denied/);
    await db.exec('reset role; set role anon;');await assert.rejects(()=>db.query('select * from public.cfa_scholarship_applications'),/permission denied/);
    await db.exec('reset role;set role service_role;');for(let i=0;i<4;i++)assert.equal((await db.query('select public.cfa_scholarship_claim_signin($1) as allowed',['a'.repeat(64)])).rows[0].allowed,i<3);
  } finally {await db.close();}
});
