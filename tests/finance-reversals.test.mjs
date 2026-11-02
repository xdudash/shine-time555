import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,seedDatabase} from './helpers/database.mjs';

async function setup(){const db=await createDatabase();await seedDatabase(db);return db}
async function manualJob(db,{object='TEST-1',daysAgo=3,cleanerId=1,price=40,payout=20}={}){
 const day=(await db.query("select (current_date - $1::int)::text as day_value",[daysAgo])).rows[0].day_value;
 const {rows}=await db.query(
  "select (st_create_manual_completed_job(1, jsonb_build_object('objectId',(select id from st_objects where code=$1),'serviceDate',$2::text,'cleanerId',$3::bigint,'clientPrice',$4::numeric,'payout',$5::numeric))).id as id",
  [object,day,cleanerId,price,payout]);
 return Number(rows[0].id);
}
async function clientPayment(db,jobId,amount,ref='pay-'+Math.random()){
 const {rows}=await db.query("select id from st_settlements where job_id=$1 and kind='CLIENT_PAYMENT' order by id desc limit 1",[jobId]);
 if(rows.length) return Number(rows[0].id);
 await db.query("select st_record_settlement(1,$1,'CLIENT_PAYMENT',$2,'Bank transfer',$3)",[jobId,amount,ref]);
 return Number((await db.query("select id from st_settlements where job_id=$1 and kind='CLIENT_PAYMENT' order by id desc limit 1",[jobId])).rows[0].id);
}
async function netClient(db,jobId){
 const {rows:[r]}=await db.query("select coalesce(sum(case kind when 'CLIENT_PAYMENT' then amount_cents when 'CLIENT_REFUND' then -amount_cents else 0 end),0)::bigint as net from st_settlements where job_id=$1",[jobId]);
 return Number(r.net);
}

test('reversing a payment keeps it in the history and makes the cleaning unpaid again',async()=>{
 const db=await setup();try{
  const job=await manualJob(db);
  const pay=await clientPayment(db,job,4000);
  assert.equal(await netClient(db,job),4000);
  const {rows:[rev]}=await db.query("select (st_reverse_settlement(1,$1)).id as id",[pay]);
  assert.equal(await netClient(db,job),0);
  const {rows:[row]}=await db.query('select count(*)::int c from st_settlements where job_id=$1',[job]);
  assert.equal(row.c,2,'original and reversal both kept');
  const {rows:[link]}=await db.query('select reverses_settlement_id from st_settlements where id=$1',[rev.id]);
  assert.equal(Number(link.reverses_settlement_id),pay);
  await assert.rejects(db.query('select st_reverse_settlement(1,$1)',[pay]),/already reversed/i);
  const {rows:[jobRow]}=await db.query('select financial_status from st_jobs where id=$1',[job]);
  assert.notEqual(jobRow.financial_status,'PAID');
 }finally{await db.close()}
});

test('changing a payment amount reverses the old one and records the new amount in one step',async()=>{
 const db=await setup();try{
  const job=await manualJob(db);
  const pay=await clientPayment(db,job,4000);
  const {rows:[n]}=await db.query("select (st_correct_settlement(1,$1,2500,'corr-1')).id as id",[pay]);
  assert.equal(await netClient(db,job),2500);
  const {rows:[kind]}=await db.query('select kind,amount_cents from st_settlements where id=$1',[n.id]);
  assert.equal(kind.kind,'CLIENT_PAYMENT');assert.equal(Number(kind.amount_cents),2500);
  const again=(await db.query("select (st_correct_settlement(1,$1,2500,'corr-1')).id as id",[pay])).rows[0].id;
  assert.equal(Number(again),Number(n.id),'same request replays without a second row');
  await assert.rejects(db.query("select st_correct_settlement(1,$1,4000,'corr-2')",[pay]),/already reversed/i);
 }finally{await db.close()}
});

test('a manual cleaning can be deleted only when no money is left on it, and its date can be entered again',async()=>{
 const db=await setup();try{
  const job=await manualJob(db,{daysAgo:4});
  const pay=await clientPayment(db,job,4000);
  await assert.rejects(db.query("select st_cancel_manual_job(1,$1)",[job]),/reverse the payments/i);
  await db.query("select st_reverse_settlement(1,$1)",[pay]);
  await db.query("select st_cancel_manual_job(1,$1)",[job]);
  const {rows:[st]}=await db.query('select status from st_jobs where id=$1',[job]);
  assert.equal(st.status,'CANCELLED');
  const month=(await db.query("select to_char(current_date,'YYYY-MM') m")).rows[0].m;
  const {rows:[{r}]}=await db.query('select st_monthly_reconciliation(1,$1) r',[month]);
  assert.ok(!r.jobs.some(j=>Number(j.id)===job),'deleted cleaning leaves the reconciliation');
  const day=(await db.query("select (current_date - 4)::text d")).rows[0].d;
  await db.query("select st_create_manual_completed_job(1, jsonb_build_object('objectId',1,'serviceDate',$1::text,'cleanerId',1,'clientPrice',40,'payout',20))",[day]);
 }finally{await db.close()}
});

test('only administrators can reverse, correct or delete money records, and automatic cleanings cannot be deleted',async()=>{
 const db=await setup();try{
  const job=await manualJob(db);
  const pay=await clientPayment(db,job,4000);
  await assert.rejects(db.query("select st_reverse_settlement(5,$1)",[pay]),/forbidden/i);
  await assert.rejects(db.query("select st_correct_settlement(4,$1,100,'c-owner')",[pay]),/forbidden/i);
  await assert.rejects(db.query("select st_cancel_manual_job(5,$1)",[job]),/forbidden/i);
  await db.exec("insert into st_jobs(object_id,client_id,service_date,status,review_status,assigned_cleaner_id,client_price,payout,earliest_start,deadline,duration_minutes) values(2,1,current_date-10,'COMPLETED','APPROVED',1,40,20,'08:00','20:00',60)");
  const auto=(await db.query("select id from st_jobs where service_date=current_date-10")).rows[0].id;
  await assert.rejects(db.query('select st_cancel_manual_job(1,$1)',[auto]),/entered by hand/i);
 }finally{await db.close()}
});

test('an administrator can change a cleaning after payment, but not below what was already paid',async()=>{
 const db=await setup();try{
  const job=await manualJob(db,{daysAgo:6});
  await clientPayment(db,job,4000);
  const day=(await db.query("select (current_date-6)::text d")).rows[0].d;
  const moved=(await db.query("select (current_date-5)::text d")).rows[0].d;
  const body=(client,cleaner,date)=>JSON.stringify({serviceDate:date,clientAmountCents:client,cleanerAmountCents:cleaner});
  await assert.rejects(db.query('select st_correct_completed_job_finance(1,$1,$2::jsonb)',[job,body(3000,2000,day)]),/already paid more/i);
  const {rows:[row]}=await db.query('select to_jsonb(st_correct_completed_job_finance(1,$1,$2::jsonb)) as j',[job,body(5000,2000,day)]);
  assert.equal(Number(row.j.client_price),50);
  assert.equal(row.j.financial_status,'INVOICED','4000 received of 5000 is no longer paid in full');
  await db.query('select st_correct_completed_job_finance(1,$1,$2::jsonb)',[job,body(5000,2000,moved)]);
  assert.equal(await netClient(db,job),4000,'payments are untouched by a correction');
 }finally{await db.close()}
});
