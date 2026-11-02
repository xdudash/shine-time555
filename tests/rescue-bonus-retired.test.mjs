import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,seedDatabase} from './helpers/database.mjs';

async function setup(){const db=await createDatabase();await seedDatabase(db);return db}

test('a recorded bonus never changes and no new bonus can be added',async()=>{
 const db=await setup();try{
  // A historical cleaning keeps the bonus it was paid with; balances stay exact.
  const {rows:[old]}=await db.query("insert into st_jobs(object_id,client_id,service_date,status,review_status,assigned_cleaner_id,client_price,payout,bonus) values(1,1,current_date-2,'COMPLETED','APPROVED',1,40,20,6) returning id");
  await db.query('update st_jobs set bonus=12 where id=$1',[old.id]);
  await db.query('update st_jobs set bonus=0 where id=$1',[old.id]);
  assert.equal(Number((await db.query('select bonus from st_jobs where id=$1',[old.id])).rows[0].bonus),6,'historical bonus is kept');
  // An open cleaning without a bonus cannot be given one, whatever the update.
  const {rows:[open]}=await db.query("insert into st_jobs(object_id,client_id,service_date,status,client_price,payout) values(1,1,current_date+3,'UNASSIGNED',40,20) returning id");
  await db.query("update st_jobs set status='RESCUE',rescue_state='ACTIVE',bonus=6 where id=$1",[open.id]);
  const {rows:[row]}=await db.query('select status,bonus from st_jobs where id=$1',[open.id]);
  assert.equal(row.status,'RESCUE','the rest of the update still applies');
  assert.equal(Number(row.bonus),0,'rescue adds no bonus');
  // The setting that drove it is gone.
  assert.equal((await db.query("select count(*)::int n from st_settings where setting_key='rescueBonus'")).rows[0].n,0);
 }finally{await db.close()}
});
