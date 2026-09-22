import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase, seedDatabase } from './helpers/database.mjs';

async function fixture(status = 'UNASSIGNED', cleaner = null) {
  const db = await createDatabase();
  await seedDatabase(db);
  const result = await db.query(`insert into st_jobs(object_id,client_id,service_date,earliest_start,deadline,duration_minutes,planned_start,status,assigned_cleaner_id)
    values(1,1,current_date+1,'10:00','20:00',60,'10:00',$1,$2) returning id`, [status, cleaner]);
  return { db, jobId: result.rows[0].id };
}

async function command(db, actor, job, action, body = {}, key = crypto.randomUUID()) {
  return db.query('select (st_job_command($1,$2,$3,$4::jsonb,$5)).*', [actor, job, action, JSON.stringify(body), key]);
}

test('only an active cleaner can accept a feasible marketplace job', async () => {
  const { db, jobId } = await fixture();
  try {
    const claimed = await command(db, 2, jobId, 'accept', { nowTime: '09:00', safetyBuffer: 0, travelBuffer: 0 });
    assert.equal(claimed.rows[0].assigned_cleaner_id, 1);
    await assert.rejects(command(db, 3, jobId, 'accept', { nowTime: '09:00' }), /already accepted|not available/i);
    assert.equal((await db.query('select count(*)::int count from st_job_events where job_id=$1', [jobId])).rows[0].count, 1);
  } finally { await db.close(); }
});

test('acceptance uses the cleaner and object windows after 15:00', async () => {
  const { db, jobId } = await fixture();
  try {
    await db.query("update st_jobs set planned_start='18:00', earliest_start='16:00', deadline='20:00' where id=$1", [jobId]);
    const claimed = await command(db, 2, jobId, 'accept', { nowTime: '16:00', safetyBuffer: 0, travelBuffer: 0 });
    assert.equal(String(claimed.rows[0].planned_start).slice(0, 5), '18:00');
  } finally { await db.close(); }
});

test('duplicate completion request returns the same result and writes one event', async () => {
  const { db, jobId } = await fixture('CLEANING', 1);
  try {
    const key = crypto.randomUUID();
    await command(db, 2, jobId, 'complete', {}, key);
    await command(db, 2, jobId, 'complete', {}, key);
    assert.equal((await db.query("select count(*)::int count from st_job_events where job_id=$1 and event_type='COMPLETED'", [jobId])).rows[0].count, 1);
    assert.equal((await db.query('select completed_jobs from st_cleaners where id=1')).rows[0].completed_jobs, 1);
  } finally { await db.close(); }
});

test('an idempotency key cannot be reused for a different command', async () => {
  const { db, jobId } = await fixture();
  try {
    const key = crypto.randomUUID();
    await command(db, 2, jobId, 'accept', { nowTime: '09:00', safetyBuffer: 0, travelBuffer: 0 }, key);
    await assert.rejects(command(db, 2, jobId, 'cancel', {}, key), /request id.*another command/i);
  } finally { await db.close(); }
});

test('idempotent replay returns the original command result', async () => {
  const { db, jobId } = await fixture();
  try {
    const key = crypto.randomUUID();
    const first = await command(db, 2, jobId, 'accept', { nowTime: '09:00', safetyBuffer: 0, travelBuffer: 0 }, key);
    await db.query("update st_jobs set assigned_cleaner_id=2 where id=$1", [jobId]);
    const replay = await command(db, 2, jobId, 'accept', {}, key);
    assert.equal(replay.rows[0].assigned_cleaner_id, first.rows[0].assigned_cleaner_id);
  } finally { await db.close(); }
});

test('stale cleaner cannot update a reassigned job', async () => {
  const { db, jobId } = await fixture('ACCEPTED', 2);
  try { await assert.rejects(command(db, 2, jobId, 'status', { status: 'EN_ROUTE' }), /assigned to you|forbidden/i); }
  finally { await db.close(); }
});

test('assignment rejects overlapping jobs for the cleaner', async () => {
  const { db, jobId } = await fixture();
  try {
    await db.exec("insert into st_jobs(object_id,client_id,service_date,earliest_start,deadline,duration_minutes,planned_start,status,assigned_cleaner_id) values(2,1,current_date+1,'10:30','20:00',60,'10:30','ACCEPTED',1)");
    await assert.rejects(command(db, 1, jobId, 'assign', { cleanerId: 1, safetyBuffer: 0, travelBuffer: 0 }), /conflicts|overlap/i);
  } finally { await db.close(); }
});

test('owner can cancel own job but cannot cancel another portfolio job', async () => {
  const { db, jobId } = await fixture();
  try {
    await command(db, 4, jobId, 'cancel', { reason: 'changed' });
    const other = await db.query("insert into st_client_accounts(user_id,account_type) values(1,'OWNER') returning id");
    await db.query("insert into st_objects(client_id,code,name,address) values($1,'OTHER','Other','Elsewhere')", [other.rows[0].id]);
    const alien = await db.query("insert into st_jobs(object_id,client_id,service_date) values(3,$1,current_date+1) returning id", [other.rows[0].id]);
    await assert.rejects(command(db, 4, alien.rows[0].id, 'cancel'), /forbidden/i);
  } finally { await db.close(); }
});

test('failed completion rolls back without an event or job mutation', async () => {
  const { db, jobId } = await fixture('CLEANING', 1);
  try {
    await db.exec(`insert into st_job_checklist(job_id,label,required,completed) values(${jobId},'Required',true,false)`);
    await assert.rejects(command(db, 2, jobId, 'complete'), /checklist/i);
    assert.equal((await db.query('select status from st_jobs where id=$1', [jobId])).rows[0].status, 'CLEANING');
    assert.equal((await db.query('select count(*)::int count from st_job_events where job_id=$1', [jobId])).rows[0].count, 0);
  } finally { await db.close(); }
});

test('generic patch rejects terminal changes and invalid service windows', async () => {
  const { db, jobId } = await fixture('COMPLETED', 1);
  try {
    await assert.rejects(command(db, 1, jobId, 'patch', { status: 'UNASSIGNED' }), /terminal/i);
    const open = await db.query("insert into st_jobs(object_id,client_id,service_date) values(2,1,current_date+1) returning id");
    await assert.rejects(command(db, 1, open.rows[0].id, 'patch', { earliestStart: '18:00', deadline: '17:00' }), /window/i);
  } finally { await db.close(); }
});

test('a cleaner cannot transition or release an unassigned job',async()=>{
 const {db,jobId}=await fixture('ACCEPTED',null);
 try{await assert.rejects(command(db,2,jobId,'status',{status:'EN_ROUTE'}),/assigned|forbidden/i);await assert.rejects(command(db,2,jobId,'cancel'),/assigned|forbidden/i);}finally{await db.close()}
});
test('assignment to tomorrow does not compare tomorrow start against current time',async()=>{
 const {db,jobId}=await fixture();try{const result=await command(db,1,jobId,'assign',{cleanerId:1,nowTime:'23:00'});assert.equal(result.rows[0].assigned_cleaner_id,1)}finally{await db.close()}
});
test('negative prices are rejected and assigned time edits cannot create overlap',async()=>{
 const {db,jobId}=await fixture('ACCEPTED',1);try{
  await assert.rejects(command(db,1,jobId,'patch',{payout:-5}),/negative|amount/i);
  await db.exec("insert into st_jobs(object_id,client_id,service_date,earliest_start,deadline,duration_minutes,planned_start,status,assigned_cleaner_id) values(2,1,current_date+1,'13:00','20:00',60,'13:00','ACCEPTED',1)");
  await assert.rejects(command(db,1,jobId,'patch',{durationMinutes:240}),/conflict|overlap/i);
 }finally{await db.close()}
});

test('authenticated realtime sees only authorized signals and cannot read jobs', async () => {
  const { db, jobId } = await fixture();
  try {
    const other = await db.query("insert into st_client_accounts(user_id,account_type) values(1,'OWNER') returning id");
    const object = await db.query("insert into st_objects(client_id,code,name,address) values($1,'PRIVATE','Private','Elsewhere') returning id", [other.rows[0].id]);
    await db.query("insert into st_jobs(object_id,client_id,service_date,status,marketplace_visible) values($1,$2,current_date+1,'CANCELLED',false)", [object.rows[0].id, other.rows[0].id]);
    await db.exec("select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000004',false); set role authenticated");
    const visible = await db.query('select job_id from st_job_signals order by job_id');
    assert.deepEqual(visible.rows.map((row) => row.job_id), [jobId]);
    await assert.rejects(db.query('select id from st_jobs'), /permission denied/i);
  } finally { await db.close(); }
});
