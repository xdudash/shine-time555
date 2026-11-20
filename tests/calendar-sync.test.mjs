import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,seedDatabase} from './helpers/database.mjs';

async function setup(auto=true){
 const db=await createDatabase();await seedDatabase(db);
 const {rows:[{id}]}=await db.query("insert into st_object_calendars(object_id,source,url,auto_create,created_by_user_id) values(1,'AIRBNB','https://www.airbnb.com/calendar/ical/1.ics?s=t',$1,4) returning id",[auto]);
 return {db,cal:id};
}
const day=n=>`(current_date+${n})::text`;
async function sync(db,cal,events,error=null){
 const {rows:[{r}]}=await db.query('select st_sync_calendar($1,$2::jsonb,$3) as r',[cal,JSON.stringify(events),error]);return r;
}
async function dates(db,n){return (await db.query(`select to_char(current_date+${n},'YYYY-MM-DD') d`)).rows[0].d}

test('a reservation books one check-out cleaning as the owner, and a repeat sync changes nothing',async()=>{
 const {db,cal}=await setup();try{
  const stay={uid:'r1',checkIn:await dates(db,2),checkOut:await dates(db,4),summary:'Reserved'};
  const first=await sync(db,cal,[stay]);
  assert.equal(first.created,1);
  const job=(await db.query("select j.*,to_char(j.service_date,'YYYY-MM-DD') day from st_jobs j join st_stays s on s.job_id=j.id where s.uid='r1'")).rows[0];
  assert.equal(job.day,stay.checkOut);
  assert.equal(job.booking_source,'CALENDAR');
  assert.equal(job.status,'UNASSIGNED');
  assert.match(job.client_note,/Guest check-out · Airbnb/);
  assert.equal((await db.query("select created_by_user_id from st_jobs where id=$1",[job.id])).rows[0].created_by_user_id,4,'booked as the owner');
  const again=await sync(db,cal,[stay]);
  assert.equal(again.created,0);
  assert.equal((await db.query("select count(*)::int n from st_jobs where status<>'CANCELLED'")).rows[0].n,1);
  assert.equal((await db.query("select last_status from st_object_calendars where id=$1",[cal])).rows[0].last_status,'OK');
 }finally{await db.close()}
});

test('a cancelled reservation releases its untaken cleaning; a taken one alerts staff instead',async()=>{
 const {db,cal}=await setup();try{
  const a={uid:'a',checkIn:await dates(db,1),checkOut:await dates(db,3)};
  const b={uid:'b',checkIn:await dates(db,5),checkOut:await dates(db,7)};
  await sync(db,cal,[a,b]);
  const jb=(await db.query("select job_id from st_stays where uid='b'")).rows[0].job_id;
  await db.query("update st_jobs set status='ACCEPTED',assigned_cleaner_id=1 where id=$1",[jb]);
  const r=await sync(db,cal,[]);
  assert.equal(r.cancelled,2);
  const ja=(await db.query("select j.status from st_jobs j join st_stays s on s.job_id=j.id where s.uid='a'")).rows[0].status;
  assert.equal(ja,'CANCELLED','nobody had taken it');
  assert.equal((await db.query('select status from st_jobs where id=$1',[jb])).rows[0].status,'ACCEPTED','a taken cleaning is never cancelled silently');
  assert.ok((await db.query("select count(*)::int n from st_notifications where type='CALENDAR_CHANGE'")).rows[0].n>=1);
 }finally{await db.close()}
});

test('moved check-out: the old untaken cleaning is released and a new one booked',async()=>{
 const {db,cal}=await setup();try{
  await sync(db,cal,[{uid:'m',checkIn:await dates(db,1),checkOut:await dates(db,3)}]);
  const old=(await db.query("select job_id from st_stays where uid='m'")).rows[0].job_id;
  const r=await sync(db,cal,[{uid:'m',checkIn:await dates(db,1),checkOut:await dates(db,5)}]);
  assert.equal(r.changed,1);assert.equal(r.created,1);
  assert.equal((await db.query('select status from st_jobs where id=$1',[old])).rows[0].status,'CANCELLED');
  const fresh=(await db.query("select job_id from st_stays where uid='m'")).rows[0].job_id;
  assert.notEqual(fresh,old);
 }finally{await db.close()}
});

test('an existing cleaning on the check-out date is linked, not duplicated',async()=>{
 const {db,cal}=await setup();try{
  const {rows:[{job}]}=await db.query(`select to_jsonb(st_create_job(1,jsonb_build_object('objectId',1,'serviceDate',${day(4)}))) as job`);
  const r=await sync(db,cal,[{uid:'x',checkIn:await dates(db,2),checkOut:await dates(db,4)}]);
  assert.equal(r.linked,1);assert.equal(r.created,0);
  assert.equal((await db.query("select job_id from st_stays where uid='x'")).rows[0].job_id,job.id);
 }finally{await db.close()}
});

test('with automatic cleanings off, stays are tracked but nothing is booked',async()=>{
 const {db,cal}=await setup(false);try{
  const r=await sync(db,cal,[{uid:'s',checkIn:await dates(db,2),checkOut:await dates(db,4)}]);
  assert.equal(r.stays,1);assert.equal(r.created,0);
  assert.equal((await db.query('select count(*)::int n from st_jobs')).rows[0].n,0);
 }finally{await db.close()}
});

test('check-outs beyond the horizon wait; a failed fetch keeps stays and records the error',async()=>{
 const {db,cal}=await setup();try{
  const r=await sync(db,cal,[{uid:'far',checkIn:await dates(db,60),checkOut:await dates(db,63)}]);
  assert.equal(r.stays,1);assert.equal(r.created,0,'beyond 45 days nothing is booked yet');
  const e=await sync(db,cal,[],'The calendar link no longer works');
  assert.equal(e.error,'The calendar link no longer works');
  const c=(await db.query('select last_status,last_error from st_object_calendars where id=$1',[cal])).rows[0];
  assert.equal(c.last_status,'ERROR');
  assert.equal((await db.query("select status from st_stays where uid='far'")).rows[0].status,'ACTIVE','a fetch error never cancels stays');
 }finally{await db.close()}
});

test('calendar tables and the sync function are closed to browsers',async()=>{
 const db=await createDatabase();try{
  for(const t of ['st_object_calendars','st_stays']){
   const {rows:[r]}=await db.query("select relrowsecurity rls from pg_class where relname=$1",[t]);
   assert.equal(r.rls,true,t);
  }
  const {rows}=await db.query("select has_function_privilege('authenticated','st_sync_calendar(bigint,jsonb,text)','execute') a");
  assert.equal(rows[0].a,false);
 }finally{await db.close()}
});
