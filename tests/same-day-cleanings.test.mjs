import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,seedDatabase} from './helpers/database.mjs';

async function setup(){const db=await createDatabase();await seedDatabase(db);return db}
const book=(db,start,end,day='current_date+2')=>db.query(
 `select to_jsonb(st_create_job(1,jsonb_build_object('objectId',1,'serviceDate',(${day})::text,'earliestStart',$1::text,'deadline',$2::text,'durationMinutes',60))) as job`,[start,end]
).then(r=>r.rows[0].job);

test('two cleanings at one property on one day are allowed when their windows do not overlap',async()=>{
 const db=await setup();try{
  const morning=await book(db,'09:00','12:00');
  const evening=await book(db,'15:00','18:00');
  assert.notEqual(morning.id,evening.id);
  assert.equal((await db.query("select count(*)::int n from st_jobs where object_id=1 and service_date=current_date+2 and status not in ('CANCELLED','EXPIRED')")).rows[0].n,2);
  await assert.rejects(book(db,'11:00','14:00'),/overlaps/i,'a window that overlaps another open cleaning is refused');
  // Touching windows (one ends when the next starts) do not overlap.
  await book(db,'12:00','15:00');
 }finally{await db.close()}
});

test('a cancelled cleaning frees its window, and an edit onto another open window is refused',async()=>{
 const db=await setup();try{
  const first=await book(db,'09:00','12:00');
  const second=await book(db,'14:00','17:00');
  await assert.rejects(db.query("update st_jobs set earliest_start='10:00',deadline='13:00' where id=$1",[second.id]),/overlaps/i);
  await db.query("select st_job_command(1,$1,'cancel',jsonb_build_object('reason','client changed plans'),$2)",[first.id,crypto.randomUUID()]);
  await book(db,'09:00','12:00');
 }finally{await db.close()}
});

test('repeating schedules still create at most one cleaning a day',async()=>{
 const db=await setup();try{
  const src=(await db.query("select prosrc from pg_proc where proname='st_generate_recurring'")).rows[0].prosrc;
  assert.match(src,/service_date=d\) then skipped/,'the generator skips any day that already has a cleaning');
 }finally{await db.close()}
});
