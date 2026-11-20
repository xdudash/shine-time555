import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,seedDatabase} from './helpers/database.mjs';

test('the dispatch tick flags an accepted cleaning past its deadline once and tells staff',async()=>{
 const db=await createDatabase();await seedDatabase(db);
 try{
  const {rows:[{job}]}=await db.query("select to_jsonb(st_create_job(1,jsonb_build_object('objectId',1,'serviceDate',(current_date+1)::text))) as job");
  await db.query("update st_jobs set service_date=current_date-1,status='ACCEPTED',assigned_cleaner_id=1 where id=$1",[job.id]);
  const first=(await db.query('select st_dispatch_tick() as r')).rows[0].r;
  assert.equal(first.overdue,1);
  const flagged=(await db.query('select overdue_notified_at from st_jobs where id=$1',[job.id])).rows[0];
  assert.ok(flagged.overdue_notified_at,'the cleaning is marked as reported');
  assert.equal((await db.query("select status from st_jobs where id=$1",[job.id])).rows[0].status,'ACCEPTED','the cleaning stays open for staff to resolve');
  const notes=(await db.query("select count(*)::int n from st_notifications where type='OVERDUE'")).rows[0].n;
  assert.ok(notes>=1,'staff are notified');
  const second=(await db.query('select st_dispatch_tick() as r')).rows[0].r;
  assert.equal(second.overdue,0,'staff are told only once');
  assert.equal((await db.query("select count(*)::int n from st_job_events where job_id=$1 and event_type='OVERDUE'",[job.id])).rows[0].n,1);
 }finally{await db.close()}
});

test('a finished cleaning is never reported as overdue',async()=>{
 const db=await createDatabase();await seedDatabase(db);
 try{
  const {rows:[{job}]}=await db.query("select to_jsonb(st_create_job(1,jsonb_build_object('objectId',1,'serviceDate',(current_date+1)::text))) as job");
  await db.query("update st_jobs set service_date=current_date-1,status='COMPLETED',assigned_cleaner_id=1,completed_at=now() where id=$1",[job.id]);
  assert.equal((await db.query('select st_dispatch_tick() as r')).rows[0].r.overdue,0);
 }finally{await db.close()}
});
