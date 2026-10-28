import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,seedDatabase} from './helpers/database.mjs';

async function setup(){const db=await createDatabase();await seedDatabase(db);return db}
async function currentMonth(db){return (await db.query("select to_char(current_date,'YYYY-MM') as month_value")).rows[0].month_value}
async function manualJob(db,{object='TEST-1',daysAgo=3,cleanerId=1,price=40,payout=20,note='Cleaned by hand'}={}){
 const day=(await db.query("select (current_date - $1::int)::text as day_value",[daysAgo])).rows[0].day_value;
 const {rows}=await db.query(
  "select (st_create_manual_completed_job(1, jsonb_build_object('objectId',(select id from st_objects where code=$1),'serviceDate',$2::text,'cleanerId',$3::bigint,'clientPrice',$4::numeric,'payout',$5::numeric,'note',$6::text))).id as id",
  [object,day,cleanerId,price,payout,note]);
 return Number(rows[0].id);
}

test('a manual cleaning joins the monthly reconciliation as completed and approved, with an audit event',async()=>{
 const db=await setup();try{
  const month=await currentMonth(db);
  const id=await manualJob(db);
  const {rows:[job]}=await db.query('select status,review_status,completion_counted,client_price,payout,assigned_cleaner_id from st_jobs where id=$1',[id]);
  assert.equal(job.status,'COMPLETED');assert.equal(job.review_status,'APPROVED');assert.equal(job.completion_counted,true);
  assert.equal(Number(job.client_price),40);assert.equal(Number(job.payout),20);assert.equal(Number(job.assigned_cleaner_id),1);
  const {rows:[{r}]}=await db.query('select st_monthly_reconciliation(1,$1) r',[month]);
  assert.equal(r.summary.jobsCount,1);assert.equal(r.summary.clientAmountCents,4000);assert.equal(r.summary.cleanerAmountCents,2000);
  const {rows:[event]}=await db.query("select event_type,payload_json from st_job_events where job_id=$1 and event_type='MANUAL_ENTRY'",[id]);
  assert.equal(event.payload_json.note,'Cleaned by hand');
 }finally{await db.close()}
});

test('manual cleanings need a note, a past date, an approved property and an admin, and cannot duplicate a booked date',async()=>{
 const db=await setup();try{
  await assert.rejects(manualJob(db,{note:'   '}),/note is required/i);
  await assert.rejects(manualJob(db,{daysAgo:-1}),/past service date/i);
  await assert.rejects(manualJob(db,{daysAgo:400}),/past service date/i);
  await manualJob(db);
  await assert.rejects(manualJob(db),/already recorded/i,'same property and date is refused');
  await assert.rejects(db.query("select st_create_manual_completed_job(4, jsonb_build_object('objectId',1,'serviceDate',(current_date-5)::text,'cleanerId',1,'clientPrice',40,'payout',20,'note','x'))"),/forbidden/i);
 }finally{await db.close()}
});

test('a manual monthly payment is spread over the oldest cleanings, can be partial, is idempotent and never overpays',async()=>{
 const db=await setup();try{
  const month=await currentMonth(db);
  await manualJob(db,{object:'TEST-1',daysAgo:3});
  await manualJob(db,{object:'TEST-2',daysAgo:2,cleanerId:2});
  const first=(await db.query("select st_record_manual_monthly_payment(1,$1,'CLIENT',1,5000,'Bank transfer 28.10','manual-a') r",[month])).rows[0].r;
  assert.deepEqual(first,{count:2,amountCents:5000});
  const rows=(await db.query("select job_id,amount_cents from st_settlements where kind='CLIENT_PAYMENT' order by id")).rows;
  assert.equal(rows.length,2);assert.equal(Number(rows[0].amount_cents),4000);assert.equal(Number(rows[1].amount_cents),1000);
  const status=(await db.query('select id,financial_status from st_jobs order by id')).rows;
  assert.equal(status[0].financial_status,'PAID');assert.equal(status[1].financial_status,'INVOICED');
  await assert.rejects(db.query("select st_record_manual_monthly_payment(1,$1,'CLIENT',1,3100,'Too much','manual-b')",[month]),/exceeds outstanding balance/i);
  const replay=(await db.query("select st_record_manual_monthly_payment(1,$1,'CLIENT',1,5000,'Bank transfer 28.10','manual-a') r",[month])).rows[0].r;
  assert.deepEqual(replay,first);
  assert.equal((await db.query('select count(*)::int c from st_settlements')).rows[0].c,2,'replay writes nothing');
  await assert.rejects(db.query("select st_record_manual_monthly_payment(1,$1,'CLIENT',1,4000,'Bank transfer 28.10','manual-a')",[month]),/Request id already used/i);
  const partial=(await db.query("select st_record_manual_monthly_payment(1,$1,'CLEANER',1,1500,'Cash 15','manual-c') r",[month])).rows[0].r;
  assert.deepEqual(partial,{count:1,amountCents:1500});
 }finally{await db.close()}
});

test('manual monthly payments respect roles and property scope',async()=>{
 const db=await setup();try{
  const month=await currentMonth(db);
  await manualJob(db);
  await assert.rejects(db.query("select st_record_manual_monthly_payment(4,$1,'CLIENT',1,100,'x','owner-try')",[month]),/forbidden/i,'owner cannot confirm own payments');
  await assert.rejects(db.query("select st_record_manual_monthly_payment(5,$1,'CLIENT',1,100,'x','manager-try')",[month]),/forbidden/i,'property manager without this property');
 }finally{await db.close()}
});
