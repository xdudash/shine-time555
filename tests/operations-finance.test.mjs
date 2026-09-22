import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,seedDatabase} from './helpers/database.mjs';
async function setup(){const db=await createDatabase();await seedDatabase(db);return db}
test('recurring generation is repeatable without duplicate jobs and snapshots checklist',async()=>{
 const db=await setup();try{
  await db.exec("insert into st_checklist_items(object_id,label,required,sort_order) values(1,'Lock door',true,1)");
  await db.exec("insert into st_recurring(object_id,created_by_user_id,start_date,weekdays,planned_start) values(1,1,current_date+1,array[1,2,3,4,5,6,7],'10:00')");
  await db.query('select st_generate_recurring(1,1,current_date+3)');
  await db.query('select st_generate_recurring(1,1,current_date+3)');
  assert.equal((await db.query('select count(*)::int n from st_jobs')).rows[0].n,3);
  assert.equal((await db.query('select count(*)::int n from st_job_checklist')).rows[0].n,3);
  await assert.rejects(db.query('select st_generate_recurring(2,1,current_date+3)'),/forbidden/i);
 }finally{await db.close()}
});
test('payments are exact, idempotent, cannot overpay and preserve cleaner settlement separately',async()=>{
 const db=await setup();try{
  await db.exec("insert into st_jobs(object_id,client_id,service_date,status,assigned_cleaner_id,client_price,payout) values(1,1,current_date,'COMPLETED',1,0.30,0.20)");
  const call=(kind,amount,key)=>db.query('select st_record_settlement(1,1,$1,$2,$3,$4)',[kind,amount,'Cash test',key]);
  await call('CLIENT_PAYMENT',10,'a');await call('CLIENT_PAYMENT',10,'a');await call('CLIENT_PAYMENT',20,'b');
  assert.equal((await db.query("select sum(amount_cents)::int n from st_settlements where kind='CLIENT_PAYMENT'")).rows[0].n,30);
  await assert.rejects(call('CLIENT_PAYMENT',1,'c'),/exceeds|outstanding/i);
  await call('CLEANER_PAYOUT',20,'d');
  await assert.rejects(db.query("select st_record_settlement(2,1,'CLIENT_PAYMENT',1,'x','bad')"),/forbidden/i);
  const r=await db.query("select st_settlement_report(1,to_char(current_date,'YYYY-MM')) as report");
  assert.equal(r.rows[0].report.summary.receivedCents,30);assert.equal(r.rows[0].report.summary.paidCents,20);
 }finally{await db.close()}
});
test('owner settlement report contains own charges and never cleaner payouts',async()=>{
 const db=await setup();try{
  await db.exec("insert into st_jobs(object_id,client_id,service_date,status,assigned_cleaner_id,client_price,payout) values(1,1,current_date,'COMPLETED',1,40,20)");
  const r=await db.query("select st_settlement_report(4,to_char(current_date,'YYYY-MM')) as report");
  assert.equal(r.rows[0].report.summary.chargedCents,4000);
  assert.equal('earnedCents' in r.rows[0].report.summary,false);
  assert.equal('payout' in r.rows[0].report.jobs[0],false);
 }finally{await db.close()}
});

test('settlement pages cover history without changing full-month totals',async()=>{
 const db=await setup();try{
 await db.exec("insert into st_jobs(object_id,client_id,service_date,status,assigned_cleaner_id,client_price,payout) values(1,1,current_date,'COMPLETED',1,40,20),(2,1,current_date,'COMPLETED',1,40,20)");
 const page=async before=>(await db.query("select st_settlement_report(1,to_char(current_date,'YYYY-MM'),$1,1) r",[before])).rows[0].r;
 const first=await page(null),second=await page(first.nextCursor);
 assert.equal(first.hasMore,true);assert.equal(second.hasMore,false);
 assert.notEqual(first.jobs[0].id,second.jobs[0].id);
 assert.equal(first.summary.chargedCents,8000);assert.deepEqual(second.summary,first.summary);
 }finally{await db.close()}
});

test('recurring worker isolates an invalid schedule and safely repeats successful runs',async()=>{
 const db=await setup();try{
 // The worker uses Bratislava service dates even when the database runs in UTC.
 await db.exec("set time zone 'Europe/Bratislava'");
 await db.exec("insert into st_recurring(object_id,created_by_user_id,start_date,weekdays,planned_start) values(1,1,current_date+1,array[1,2,3,4,5,6,7],'10:00'),(2,1,current_date+1,array[1,2,3,4,5,6,7],'23:00')");
 const run=async()=>(await db.query('select st_run_recurring(3) r')).rows[0].r;
 assert.equal((await run()).failed,1);assert.equal((await run()).processed,1);
 assert.equal((await db.query('select count(*)::int n from st_jobs')).rows[0].n,3);
 assert.equal((await db.query('select count(*)::int n from st_recurring_runs where error_message is not null')).rows[0].n,2);
 await db.exec('set role authenticated');await assert.rejects(db.query('select st_run_recurring(3)'),/permission denied/i);
 }finally{await db.close()}
});
