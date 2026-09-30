import {subscribeJobChanges} from '../assets/job-subscription.mjs';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import pg from 'pg';
const config=JSON.parse(execFileSync('node_modules/.bin/supabase',['status','--workdir','artifacts/supabase-integration','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
for(const key of ['API_URL','DB_URL'])assert.ok(['localhost','127.0.0.1'].includes(new URL(config[key]).hostname),'Integration tests require localhost');
const admin=createClient(config.API_URL,config.SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const db=new pg.Client({connectionString:config.DB_URL});await db.connect();
const roles=['ADMIN','CLEANER','CLEANER','OWNER','PROPERTY_MANAGER','OPERATIONS_MANAGER'];
const clients=[];
const channels=[];
async function api(index,route,method='GET',body={},query={}){
 const {data:{session}}=await clients[index].auth.getSession();
 const res=await fetch(`${config.API_URL}/functions/v1/st-api`,{method:'POST',headers:{apikey:config.ANON_KEY,Authorization:`Bearer ${session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify({route,method,body,query,clientBuild:'2026-09-28-quality1'})});
 const data=await res.json();
 assert.ok(res.ok,`${route}: ${res.status} ${JSON.stringify(data)}`);return data;
}
try{
 assert.equal(Number((await db.query('select count(*) from st_users')).rows[0].count),0,'Fresh test database required');
 for(const [i,role] of roles.entries()){
  const email=`integration-${i}@test.invalid`,password='Synthetic-local-test-2026!';
  const {data,error}=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(error);
  await db.query('insert into st_users(auth_user_id,email,role,full_name) values($1,$2,$3,$4)',[data.user.id,email,role,`Test ${role}`]);
  const client=createClient(config.API_URL,config.ANON_KEY,{auth:{persistSession:false}});
  const login=await client.auth.signInWithPassword({email,password});assert.ifError(login.error);clients.push(client);
 }
 await db.query(`insert into st_cleaners(user_id,max_jobs_day) values(2,20),(3,20);
 insert into st_client_accounts(user_id,account_type) values(4,'OWNER'),(5,'PROPERTY_MANAGER');
 insert into st_objects(client_id,code,name,address,checkout_time,deadline_time,duration_minutes,payout,client_price,access_instructions) values(1,'INTEGRATION','Test apartment','Synthetic address','08:00','20:00',60,20,40,'Synthetic-door-code');
 insert into st_cleaner_availability(cleaner_id,service_date,online,from_time,to_time) values(1,current_date+1,true,'08:00','20:00'),(2,current_date+1,true,'08:00','20:00');`);
 for(let attempt=0;;attempt++){try{await api(0,'health');break}catch(error){if(attempt>=30)throw error;await new Promise(r=>setTimeout(r,1000));}}
 for(let i=0;i<roles.length;i++)assert.equal((await api(i,'me')).user.role,roles[i]);
 const date=(await db.query("select to_char(current_date+1,'YYYY-MM-DD') date")).rows[0].date;
 assert.ok((await api(3,'client/slots','GET',{}, {objectId:1,date})).slots.includes('10:00'));
 const {booking}=await api(3,'client/bookings','POST',{objectId:1,serviceDate:date,startTime:'10:00',requestId:crypto.randomUUID()});
 assert.equal(booking.status,'ACCEPTED');
 const cleaner=Number(booking.assigned_cleaner_id);
 const path=`cleaner/jobs/${booking.id}`;
 const unrelated=cleaner===1?2:1;
 const deniedRows=await clients[unrelated].from('st_job_signals').select('*').eq('job_id',booking.id);
 assert.ifError(deniedRows.error);assert.deepEqual(deniedRows.data,[]);
 const privateJobs=await clients[cleaner].from('st_jobs').select('*');
 assert.ok(privateJobs.error,'Raw jobs must be inaccessible to authenticated clients');
 await assert.rejects(api(unrelated,path),/403|404|assigned|Forbidden|access/i);
 const allowedRows=await clients[cleaner].from('st_job_signals').select('*').eq('job_id',booking.id);
 assert.ifError(allowedRows.error);assert.equal(allowedRows.data.length,1,'Assigned user must pass signal RLS');
 const {data:{session:realtimeSession}}=await clients[cleaner].auth.getSession();
 await clients[cleaner].realtime.setAuth(realtimeSession.access_token);
 const events=[];
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('Realtime listener readiness timeout')),30000);
  const stop=subscribeJobChanges(clients[cleaner],payload=>{if(payload)events.push(payload);},status=>{
   if(status==='SUBSCRIBED'){clearTimeout(timer);resolve();}
   else if(['CHANNEL_ERROR','TIMED_OUT'].includes(status)){clearTimeout(timer);reject(new Error(`Realtime ${status}`));}
  });
  channels.push(stop);
 });
 for(const status of ['EN_ROUTE','ARRIVED','CLEANING'])await api(cleaner,`${path}/status`,'POST',{status,requestId:crypto.randomUUID()});
 for(let attempt=0;events.length===0&&attempt<100;attempt++)await new Promise(r=>setTimeout(r,100));
 if(!events.length){
  console.log('Realtime diagnostics',JSON.stringify({publication:(await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime'")).rows,slots:(await db.query('select slot_name,active from pg_replication_slots')).rows,signal:(await db.query('select * from st_job_signals where job_id=$1',[booking.id])).rows}));
  const names=execFileSync('docker',['ps','--format','{{.Names}}'],{encoding:'utf8'}).trim().split('\n').filter(n=>n.startsWith('supabase_realtime_'));
  for(const name of names){const logs=execFileSync('docker',['logs','--tail','150',name],{encoding:'utf8',stdio:['ignore','pipe','pipe']});console.log(logs.split('\n').filter(line=>/error|Error|fail|Fail/.test(line)).map(line=>line.replace(/eyJ[A-Za-z0-9_.-]+/g,'[JWT redacted]')).join('\n'));}
 }
 assert.ok(events.length>0,'Assigned cleaner must receive real Realtime job changes');
 for(const event of events)assert.deepEqual(Object.keys(event.new).sort(),['changed_at','job_id']);
 // Entry details and reference photos are visible only to the assigned cleaner during active work.
 assert.match(JSON.stringify(await api(cleaner,path)),/Synthetic-door-code/,'Active cleaner sees entry details');
 const guidePng=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBZkAAAAASUVORK5CYII=','base64').toString('base64');
 const {photo:guide}=await api(0,'objects/1/reference-photos','POST',{caption:'Entrance',mime:'image/png',base64:guidePng});
 assert.equal((await api(cleaner,`cleaner/jobs/${booking.id}/reference-photos`)).photos.length,1);
 assert.match((await api(cleaner,`cleaner/jobs/${booking.id}/reference-photos/${guide.id}`)).dataUrl,/^data:image\/png;base64,/);
 await assert.rejects(api(unrelated,`cleaner/jobs/${booking.id}/reference-photos`),/403|Forbidden|assigned/i);
 await assert.rejects(api(4,'objects/1/reference-photos'),/403|Forbidden/i,'Unlinked property manager is denied');
 await api(0,'admin/clients/2/properties','POST',{objectId:1});
 assert.equal((await api(4,'objects/1/reference-photos')).photos.length,1,'Linked property manager can view');
 await assert.rejects(api(4,`objects/1/reference-photos/${guide.id}`,'DELETE'),/403|Forbidden/i,'Property manager cannot delete');
 assert.equal((await api(3,'objects/1/reference-photos')).photos.length,1,'Owner can view');
 await assert.rejects(api(cleaner,'objects/1/reference-photos'),/403|Forbidden/i);
 for(const item of (await db.query('select id from st_job_checklist where job_id=$1',[booking.id])).rows)await api(cleaner,`${path}/checklist/${item.id}`,'PATCH',{completed:true});
 await assert.rejects(api(cleaner,`${path}/complete`,'POST',{requestId:crypto.randomUUID()}),/photo/i);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBZkAAAAASUVORK5CYII=','base64');
 const ticket=await api(cleaner,`${path}/photos/prepare`,'POST',{mime:'image/png',fileName:'proof.png',category:'Final',fileSize:png.length});
 const uploaded=await clients[cleaner].storage.from(ticket.bucket).uploadToSignedUrl(ticket.path,ticket.token,png,{contentType:'image/png'});assert.ifError(uploaded.error);
 const first=await api(cleaner,`${path}/photos/finalize`,'POST',{uploadId:ticket.uploadId});
 const repeat=await api(cleaner,`${path}/photos/finalize`,'POST',{uploadId:ticket.uploadId});assert.equal(first.photo.id,repeat.photo.id);
 const proofUrl=new URL(first.photo.url);
 const downloaded=await fetch(config.API_URL+proofUrl.pathname+proofUrl.search);
 assert.equal(downloaded.status,200);assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),png);
 const completion={requestId:crypto.randomUUID()};
 await api(cleaner,`${path}/complete`,'POST',completion);
 await api(cleaner,`${path}/complete`,'POST',completion);
 assert.doesNotMatch(JSON.stringify(await api(cleaner,path)),/Synthetic-door-code/,'Entry details are withdrawn after completion');
 await assert.rejects(api(cleaner,`cleaner/jobs/${booking.id}/reference-photos`),/403|Forbidden/i,'Reference photos are withdrawn after completion');
 const month=date.slice(0,7);
 const waiting=await api(0,'admin/settlements/monthly','GET',{},{month,side:'CLIENT',partyId:1});
 assert.deepEqual(waiting.groups,[],'Unapproved work is not offered for monthly settlement');assert.equal(waiting.waitingReviewJobs,1);
 await assert.rejects(api(0,'admin/settlements/batch','POST',{month,side:'CLIENT',partyId:1,items:[{jobId:booking.id,amountCents:4000}],note:'Synthetic',requestId:crypto.randomUUID()}),/review|approv/i);
 await assert.rejects(api(5,'admin/settlements/monthly','GET',{},{month,side:'CLIENT'}),/403|Forbidden/i,'Operations manager cannot see monthly finance');
 await assert.rejects(api(0,'admin/settlements','POST',{jobId:booking.id,kind:'CLEANER_PAYOUT',amountCents:2000,note:'Synthetic test',requestId:crypto.randomUUID()}),/review|approv/i);
 const pending=await api(5,`admin/jobs/${booking.id}`);
 assert.equal(pending.review_status,'PENDING');
 const accepted=await api(5,`admin/jobs/${booking.id}/review`,'POST',{decision:'APPROVED',expectedVersion:pending.review_version,requestId:crypto.randomUUID()});
 assert.equal(accepted.job.review_status,'APPROVED');
 const ready=await api(0,'admin/settlements/monthly','GET',{},{month,side:'CLIENT',partyId:1});
 assert.equal(ready.groups.length,1);assert.equal(ready.groups[0].dueCents,4000);assert.equal(ready.waitingReviewJobs,0);
 const batch={month,side:'CLIENT',partyId:1,items:[{jobId:booking.id,amountCents:4000}],note:'Synthetic monthly',requestId:crypto.randomUUID()};
 assert.deepEqual(await api(0,'admin/settlements/batch','POST',batch),{count:1,amountCents:4000});
 assert.deepEqual(await api(0,'admin/settlements/batch','POST',batch),{count:1,amountCents:4000},'Batch replay is idempotent');
 await api(0,'admin/settlements','POST',{jobId:booking.id,kind:'CLEANER_PAYOUT',amountCents:2000,note:'Synthetic test',requestId:crypto.randomUUID()});
 const settlement=await api(0,'admin/settlements','GET',{}, {month:date.slice(0,7)});
 assert.equal(settlement.summary.dueCents,0);assert.equal(settlement.summary.payableCents,0);
 await assert.rejects(api(3,'admin/settings'),/403|Forbidden|permission/i);
 const report={realAuthRoles:5,booking:true,referencePhotos:true,entryDetailsWithdrawn:true,monthlySettlementGate:true,signedStorageUpload:true,idempotentFinalize:true,completion:true,settlements:true,realtime:true,privateJobAccess:true,productionTouched:false};
 await writeFile('artifacts/integration-result.json',JSON.stringify(report,null,2));console.log(report);
}finally{for(const stop of channels)await stop();await db.end();for(const client of clients)await client.auth.signOut();}
