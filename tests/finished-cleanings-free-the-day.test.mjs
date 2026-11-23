import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,seedDatabase} from './helpers/database.mjs';

// A cleaner who finished early takes the next cleaning in the same window (owner report 2026-11-23).
test('accepting is not blocked by a cleaning the cleaner already finished',async()=>{
 const db=await createDatabase();await seedDatabase(db);
 try{
  const book=async(start,end)=>(await db.query(`select to_jsonb(st_create_job(1,jsonb_build_object('objectId',1,'serviceDate',(current_date+1)::text,'earliestStart',$1::text,'deadline',$2::text,'durationMinutes',60))) as job`,[start,end])).rows[0].job;
  const first=await book('09:00','12:00');
  const cleanerUser=(await db.query('select user_id from st_cleaners where id=1')).rows[0].user_id;
  const accept=(id,start)=>db.query("select to_jsonb(st_job_command($1,$2,'accept',jsonb_build_object('plannedStart',$3::text),$4)) as job",[cleanerUser,id,start,crypto.randomUUID()]);
  await accept(first.id,'09:00');
  // The second cleaning is at another property, so only the cleaner's own day can block it.
  const second=(await db.query(`select to_jsonb(st_create_job(1,jsonb_build_object('objectId',2,'serviceDate',(current_date+1)::text,'earliestStart','09:00','deadline','12:00','durationMinutes',60))) as job`)).rows[0].job;
  await assert.rejects(accept(second.id,'09:30'),/Conflicts/,'while the first cleaning is open, its window is busy');
  await db.query("update st_jobs set status='COMPLETED',completed_at=now(),review_status='APPROVED' where id=$1",[first.id]);
  const taken=(await accept(second.id,'09:30')).rows[0].job;
  assert.equal(taken.status,'ACCEPTED','finished early: the window is free');
 }finally{await db.close()}
});
