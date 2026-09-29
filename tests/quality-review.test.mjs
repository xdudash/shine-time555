import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, seedDatabase } from './helpers/database.mjs';
import { projectResponse } from '../supabase/functions/st-api/security.mjs';
const key=()=>crypto.randomUUID();
const complete=(db,id,request=key())=>db.query('select * from st_job_command(2,$1,\'complete\',\'{}\',$2)',[id,request]);
const review=(db,id,decision='APPROVED',version=1,actor=1,note='Reviewed',request=key())=>db.query('select * from st_review_job($1,$2,$3,$4,$5,$6)',[actor,id,decision,note,request,version]);
test('review lifecycle is authorized, versioned, replay safe, and counted once across rework',async()=>{
 const db=await createDatabase();try{
 await seedDatabase(db);
 const id=(await db.query("insert into st_jobs(object_id,client_id,service_date,status,assigned_cleaner_id,payout,client_price) values(1,1,current_date,'CLEANING',1,20,40) returning id")).rows[0].id;
 const first=(await complete(db,id)).rows[0];assert.equal(first.review_status,'PENDING');assert.equal(first.review_version,1);
 for(const actor of [2,3,4,5]) await assert.rejects(review(db,id,'APPROVED',1,actor),/Forbidden/);
 await db.exec('update st_users set active=false where id=6');await assert.rejects(review(db,id,'APPROVED',1,6),/Forbidden/);await db.exec('update st_users set active=true where id=6');
 await assert.rejects(review(db,id,'REWORK_REQUIRED',1,1,''),/note/i);
 await assert.rejects(db.query("select * from st_record_settlement(1,$1,'CLIENT_PAYMENT',100,'Payment',$2)",[id,key()]),/approved/i);
 const request=key();const rework=(await review(db,id,'REWORK_REQUIRED',1,6,'Redo bathroom',request)).rows[0];
 assert.equal(rework.status,'CLEANING');assert.equal(rework.review_version,2);assert.equal(rework.completed_at.getTime(),first.completed_at.getTime());
 assert.equal((await review(db,id,'REWORK_REQUIRED',1,6,'Redo bathroom',request)).rows[0].review_version,2);
 await assert.rejects(review(db,id,'APPROVED',1,6,'Different',request),/request id/i);
 await assert.rejects(db.query("select * from st_job_command(2,$1,'cancel','{}',$2)",[id,key()]),/rework/i);
 const second=(await complete(db,id)).rows[0];assert.equal(second.review_version,3);
 await assert.rejects(review(db,id,'APPROVED',1),/stale/i);
 assert.equal((await review(db,id,'APPROVED',3)).rows[0].review_status,'APPROVED');
 assert.equal((await db.query('select completed_jobs from st_cleaners where id=1')).rows[0].completed_jobs,1);
 assert.equal((await db.query("select count(*)::int n from st_job_events where job_id=$1 and event_type='COMPLETED'",[id])).rows[0].n,2);
 await db.query("select * from st_record_settlement(1,$1,'CLIENT_PAYMENT',100,'Payment',$2)",[id,key()]);
 await assert.rejects(review(db,id,'REWORK_REQUIRED',4),/settled|pending/i);
 await db.query("update st_jobs set review_status='PENDING' where id=$1",[id]);
 await assert.rejects(review(db,id,'REWORK_REQUIRED',4),/settled/i);
 }finally{await db.close()}
});
test('review metadata excludes private notes from client projections',()=>{
 for(const role of ['OWNER','PROPERTY_MANAGER'])assert.equal(projectResponse({job:{review_status:'PENDING',review_note:'private'}},role).job.review_note,undefined);
});

test('historical completed and settled jobs migrate approved without changing amounts',async()=>{
 const {readFile,readdir}=await import('node:fs/promises');
 const db=await createDatabase({changes:false});try{
 const files=(await readdir('supabase/migrations')).sort();
 for(const name of files.filter(n=>n>'20260902094500_manager_assignment_audit_index.sql'&&!n.endsWith('_quality_review.sql'))) await db.exec(await readFile(`supabase/migrations/${name}`,'utf8'));
 await seedDatabase(db);
 await db.exec("insert into st_jobs(object_id,client_id,service_date,status,assigned_cleaner_id,client_price,payout) values(1,1,current_date,'COMPLETED',1,40,20)");
 await db.query("select st_record_settlement(1,1,'CLIENT_PAYMENT',4000,'Historical',$1)",[key()]);
 for(const name of files.filter(n=>n.endsWith('_quality_review.sql'))) await db.exec(await readFile(`supabase/migrations/${name}`,'utf8'));
 const row=(await db.query('select * from st_jobs where id=1')).rows[0];assert.equal(row.review_status,'APPROVED');assert.equal(row.financial_status,'PAID');assert.equal(row.client_price,'40.00');
 assert.equal((await db.query('select sum(amount_cents)::int n from st_settlements')).rows[0].n,4000);
 await db.exec('set role authenticated');await assert.rejects(review(db,1),/permission denied/);
 }finally{await db.close()}
});

test('settlement report separates review accrual from approved payable balance and protects role scope',async()=>{
 const db=await createDatabase();try{
 await seedDatabase(db);
 const id=(await db.query("insert into st_jobs(object_id,client_id,service_date,status,assigned_cleaner_id,payout,client_price) values(1,1,current_date,'CLEANING',1,20,40) returning id")).rows[0].id;
 await complete(db,id);
 const report=async(actor)=>(await db.query("select st_settlement_report($1,to_char(current_date,'YYYY-MM')) r",[actor])).rows[0].r;
 for(const actor of [1,2]){
  const pending=await report(actor);assert.equal(pending.summary.earnedCents,2000);assert.equal(pending.summary.waitingReviewCents,2000);assert.equal(pending.summary.payableCents,0);
  assert.equal(pending.jobs[0].review_status,'PENDING');assert.equal(pending.jobs[0].waitingReviewCents,2000);assert.equal(pending.jobs[0].payableCents,0);
 }
 const owner=await report(4);assert.equal(owner.summary.dueCents,4000);assert.equal(owner.jobs[0].review_status,'PENDING');
 for(const field of ['earnedCents','waitingReviewCents','payableCents','review_note']){assert.equal(field in owner.summary,false);assert.equal(field in owner.jobs[0],false)}
 const cleaner=await report(2);assert.equal('chargedCents' in cleaner.summary,false);assert.equal('dueCents' in cleaner.jobs[0],false);
 assert.equal((await report(3)).jobs.length,0);
 for(const actor of [5,6])await assert.rejects(report(actor),/Forbidden/);
 await db.exec('update st_users set active=false where id=2');await assert.rejects(report(2),/no rows|Forbidden/);await db.exec('update st_users set active=true where id=2');
 await review(db,id);
 assert.equal((await report(2)).summary.waitingReviewCents,0);assert.equal((await report(2)).summary.payableCents,2000);
 await db.query("select st_record_settlement(1,$1,'CLEANER_PAYOUT',750,'Partial payout',$2)",[id,key()]);
 for(const actor of [1,2]){const paid=await report(actor);assert.equal(paid.summary.earnedCents,2000);assert.equal(paid.summary.paidCents,750);assert.equal(paid.summary.payableCents,1250);assert.equal(paid.jobs[0].payableCents,1250);assert.equal(paid.jobs[0].review_status,'APPROVED')}
 assert.equal((await report(4)).summary.dueCents,4000);
 }finally{await db.close()}
});
