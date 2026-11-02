import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,seedDatabase} from './helpers/database.mjs';

async function setup(){const db=await createDatabase();await seedDatabase(db);return db}
async function currentMonth(db){return (await db.query("select to_char(current_date,'YYYY-MM') as month_value")).rows[0].month_value}

test('monthly reconciliation groups the property total and tracks client and cleaner payments independently',async()=>{
 const db=await setup();try{
  const month=await currentMonth(db);
  await db.exec("insert into st_jobs(object_id,client_id,service_date,status,review_status,assigned_cleaner_id,client_price,payout,bonus,extra_revenue) values(1,1,current_date,'COMPLETED','APPROVED',1,40,20,3,2),(1,1,current_date+1,'COMPLETED','APPROVED',1,40,20,0,0)");
  await db.query("select st_record_settlement(1,1,'CLIENT_PAYMENT',1000,'Part receipt','recon-client')");
  await db.query("select st_record_settlement(1,1,'CLEANER_PAYOUT',500,'Part payout','recon-cleaner')");
  const {rows:[{r}]}=await db.query('select st_monthly_reconciliation(1,$1) r',[month]);
  assert.equal(r.summary.jobsCount,2);
  assert.equal(r.summary.clientAmountCents,8200);
  assert.equal(r.summary.clientPaidCents,1000);
  assert.equal(r.summary.clientDueCents,7200);
  assert.equal(r.summary.cleanerAmountCents,4300);
  assert.equal(r.summary.cleanerPaidCents,500);
  assert.equal(r.summary.cleanerDueCents,3800);
  assert.equal(r.objects.length,1);
  assert.equal(r.objects[0].objectCode,'TEST-1');
  assert.equal(r.objects[0].jobsCount,2);
  assert.equal(r.jobs[0].clientDueCents,3200);
  assert.equal(r.jobs[0].cleanerDueCents,1800);
  await assert.rejects(db.query('select st_monthly_reconciliation(2,$1)',[month]),/forbidden/i);
 }finally{await db.close()}
});

test('finance correction can fix the date and total amounts and leaves an audit event',async()=>{
 const db=await setup();try{
  await db.exec("insert into st_jobs(object_id,client_id,service_date,status,review_status,assigned_cleaner_id,client_price,payout) values(2,1,current_date,'COMPLETED','APPROVED',1,45,25),(2,1,current_date+1,'COMPLETED','APPROVED',1,10,5)");
  const {rows:[{j}]}=await db.query(
   "select to_jsonb(st_correct_completed_job_finance(1,1,jsonb_build_object('serviceDate',(current_date+2)::text,'clientAmountCents',5000,'cleanerAmountCents',2700))) as j"
  );
  assert.equal(String(j.service_date).slice(0,10), (await db.query("select to_char(current_date+2,'YYYY-MM-DD') as day_value")).rows[0].day_value);
  assert.equal(Number(j.client_price),50);
  assert.equal(Number(j.payout),27);
  const events=(await db.query("select event_type,payload_json from st_job_events where job_id=1 order by id desc limit 1")).rows[0];
  assert.equal(events.event_type,'FINANCE_CORRECTION');
  assert.equal(Number(events.payload_json.after.clientAmountCents),5000);
  await assert.rejects(db.query(
   "select st_correct_completed_job_finance(1,1,jsonb_build_object('serviceDate',(current_date+1)::text,'clientAmountCents',5000,'cleanerAmountCents',2700))"
  ),/already has a cleaning/i);
 }finally{await db.close()}
});

test('finance correction keeps recorded payments and refuses totals below what was already paid',async()=>{
 const db=await setup();try{
  await db.exec("insert into st_jobs(object_id,client_id,service_date,status,review_status,assigned_cleaner_id,client_price,payout) values(1,1,current_date,'COMPLETED','APPROVED',1,40,20)");
  await db.query("select st_record_settlement(1,1,'CLIENT_PAYMENT',1000,'Receipt','recon-protected')");
  await assert.rejects(db.query(
   "select st_correct_completed_job_finance(1,1,jsonb_build_object('serviceDate',current_date::text,'clientAmountCents',500,'cleanerAmountCents',2000))"
  ),/already paid more/i);
  const {rows:[{j}]}=await db.query(
   "select to_jsonb(st_correct_completed_job_finance(1,1,jsonb_build_object('serviceDate',current_date::text,'clientAmountCents',4000,'cleanerAmountCents',2000))) as j");
  assert.equal(Number(j.client_price),40);
  assert.equal((await db.query("select count(*)::int c from st_settlements")).rows[0].c,1,'the payment itself is untouched');
  await assert.rejects(db.query(
   "select st_correct_completed_job_finance(2,1,jsonb_build_object('serviceDate',current_date::text,'clientAmountCents',4000,'cleanerAmountCents',2000))"
  ),/forbidden/i);
 }finally{await db.close()}
});
