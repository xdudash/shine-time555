import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePhoto,validateMedia} from '../supabase/functions/st-api/media.mjs';
import {createDatabase,seedDatabase} from './helpers/database.mjs';
test('photo validation rejects executable content, mismatched MIME and oversized payloads',()=>{
 assert.throws(()=>validatePhoto(new TextEncoder().encode('<svg></svg>'),'image/svg+xml'),/format/i);
 assert.throws(()=>validatePhoto(new Uint8Array([1,2,3]),'image/jpeg'),/content/i);
 assert.throws(()=>validatePhoto(new Uint8Array(5*1024*1024+1),'image/jpeg'),/large/i);
 assert.equal(validatePhoto(new Uint8Array([255,216,255,224]),'image/jpeg'),'jpg');
});
test('checklist and photo writes recheck assignment and terminal state inside the transaction',async()=>{
 const db=await createDatabase();await seedDatabase(db);
 try{
 const {rows:[job]}=await db.query("insert into st_jobs(object_id,client_id,service_date,earliest_start,deadline,duration_minutes,status,assigned_cleaner_id) values(1,1,current_date+1,'08:00','20:00',60,'CLEANING',1) returning id");
 const {rows:[item]}=await db.query("insert into st_job_checklist(job_id,label,required) values($1,'Floor',true) returning id",[job.id]);
 const checklist=(actor,done)=>db.query('select st_update_job_checklist($1,$2,$3,$4)',[actor,job.id,item.id,done]);
 await assert.rejects(checklist(3,true),/assigned/i);
 await checklist(2,true);
 assert.equal((await db.query('select completed from st_job_checklist where id=$1',[item.id])).rows[0].completed,true);
 const photo=(actor)=>db.query("select st_record_job_photo($1,$2,'Proof',$3,'photo.jpg','image/jpeg',4)",[actor,job.id,`${job.id}/test.jpg`]);
 await assert.rejects(photo(3),/assigned/i);
 await photo(2);
 await db.query("update st_jobs set status='COMPLETED' where id=$1",[job.id]);
 await assert.rejects(checklist(2,false),/terminal/i);
 await assert.rejects(photo(2),/terminal/i);
 assert.equal((await db.query('select count(*)::int n from st_job_photos')).rows[0].n,1);
 }finally{await db.close();}
});

test('upload finalization is idempotent and cannot attach a photo to another cleaner',async()=>{
 const db=await createDatabase();await seedDatabase(db);try{
 await db.exec("insert into st_jobs(object_id,client_id,service_date,status,assigned_cleaner_id) values(1,1,current_date+1,'CLEANING',1)");
 const id=crypto.randomUUID();
 await db.query("insert into st_upload_tickets(id,actor_id,job_id,category,storage_path,file_name,mime,file_size) values($1,2,1,'Final','1/final.jpg','final.jpg','image/jpeg',100)",[id]);
 await assert.rejects(db.query('select st_finalize_upload(3,$1)',[id]));
 await db.query('select st_finalize_upload(2,$1)',[id]);await db.query('select st_finalize_upload(2,$1)',[id]);
 assert.equal((await db.query('select count(*)::int n from st_job_photos')).rows[0].n,1);
 await db.exec('update st_jobs set assigned_cleaner_id=2 where id=1');
 await assert.rejects(db.query('select st_finalize_upload(2,$1)',[id]),/assigned/i);
 }finally{await db.close()}
});

test('video reports never satisfy a mandatory photo',async()=>{
 assert.equal(validateMedia(new Uint8Array([0,0,0,16,102,116,121,112]),'video/mp4'),'mp4');
 assert.throws(()=>validateMedia(new Uint8Array([0,0,0]),'video/mp4'),/content/);
 const db=await createDatabase();await seedDatabase(db);try{
 await db.exec("insert into st_jobs(object_id,client_id,service_date,status,assigned_cleaner_id) values(1,1,current_date+1,'CLEANING',1)");
 await db.exec("insert into st_job_checklist(job_id,label,required,completed,photo_required,photo_category) values(1,'Final photo',true,true,true,'Final')");
 await db.query("select st_record_job_photo(2,1,'Final','1/video.mp4','video.mp4','video/mp4',8)");
 await assert.rejects(db.query("select st_job_command(2,1,'complete','{}','video-proof')"),/photo/i);
 }finally{await db.close()}
});
