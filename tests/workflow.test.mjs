import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,seedDatabase} from './helpers/database.mjs';
test('owner booking through assignment, proof, completion and both settlements',async()=>{
 const db=await createDatabase();await seedDatabase(db);
 try {
  const {rows:[{job}]}=await db.query("select to_jsonb(st_create_job(4,jsonb_build_object('objectId',1,'serviceDate',current_date+1,'plannedStart','10:00'))) job");
  assert.equal(job.status,'ACCEPTED');assert.equal(job.assigned_cleaner_id,1);
  const command=(action,body={})=>db.query('select st_job_command(2,$1,$2,$3::jsonb,$4)',[job.id,action,JSON.stringify(body),crypto.randomUUID()]);
  for(const status of ['EN_ROUTE','ARRIVED','CLEANING'])await command('status',{status});
  await assert.rejects(command('complete'),/checklist/i);
  const {rows:items}=await db.query('select id from st_job_checklist where job_id=$1',[job.id]);
  for(const item of items)await db.query('select st_update_job_checklist(2,$1,$2,true)',[job.id,item.id]);
  await assert.rejects(command('complete'),/photo/i);
  await db.query("select st_record_job_photo(2,$1,'Final',$2,'final.jpg','image/jpeg',1000)",[job.id,`${job.id}/final.jpg`]);
  await command('complete');
  for(const [kind,amount] of [['CLIENT_PAYMENT',4000],['CLEANER_PAYOUT',2000]])await db.query('select st_record_settlement(1,$1,$2,$3,$4,$5)',[job.id,kind,amount,'Synthetic workflow',crypto.randomUUID()]);
  const {rows:[{report}]}=await db.query("select st_settlement_report(1,to_char(current_date+1,'YYYY-MM')) report");
  assert.equal(report.summary.dueCents,0);assert.equal(report.summary.payableCents,0);assert.equal(report.summary.jobs,1);
  await assert.rejects(command('cancel'),/terminal/i);
  assert.equal((await db.query('select completed_jobs from st_cleaners where id=1')).rows[0].completed_jobs,1);
 }finally{await db.close();}
});
