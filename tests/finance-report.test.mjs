import test from 'node:test';
import assert from 'node:assert/strict';
import {createDatabase,seedDatabase} from './helpers/database.mjs';
test('finance sums all rows beyond API limits, includes manual entries and enforces role access',async()=>{
 const db=await createDatabase();await seedDatabase(db);try{
 await db.exec("insert into st_jobs(object_id,client_id,service_date,status,assigned_cleaner_id,client_price,payout) values(1,1,current_date,'COMPLETED',1,40.10,20.05)");
 await db.exec("insert into st_financial_entries(entry_date,entry_type,amount,client_id,object_id) select current_date,'INCOME',0.10,1,1 from generate_series(1,1100)");
 const {rows:[{r}]}=await db.query("select st_finance_report(1,to_char(current_date,'YYYY-MM')) r");
 assert.equal(r.summary.totalRevenue,150.10);assert.equal(r.summary.totalExpenses,20.05);assert.equal(r.summary.profit,130.05);assert.equal(r.entries.length,100);assert.equal(r.entriesHasMore,true);assert.equal(r.byObject[0].revenue,150.10);assert.equal(r.trend.length,12);assert.equal(r.trend.at(-1).revenue,150.10);
 await assert.rejects(db.query("select st_finance_report(6,to_char(current_date,'YYYY-MM'))"),/forbidden/i);
 const {rows:[{r:next}]}=await db.query("select st_finance_report(1,to_char(current_date,'YYYY-MM'),$1) r",[r.entriesNextCursor]);
 assert.deepEqual(next.summary,r.summary);assert.notEqual(next.entries[0].id,r.entries[0].id);
 }finally{await db.close()}
});
