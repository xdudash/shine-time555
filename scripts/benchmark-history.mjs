import {performance} from 'node:perf_hooks';
import {writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createDatabase,seedDatabase} from '../tests/helpers/database.mjs';
const db=await createDatabase();await seedDatabase(db);
try {
 const start=performance.now();
 await db.exec(`insert into st_objects(client_id,code,name,address,checkout_time,deadline_time) select 1,'LOAD-'||g,'Synthetic property '||g,'Test only','08:00','20:00' from generate_series(1,10000) g;
 insert into st_jobs(object_id,client_id,service_date,status,assigned_cleaner_id,client_price,payout)
 select o.id,1,date_trunc('month',current_date)::date+d,'COMPLETED',1,40.10,20.05 from st_objects o cross join generate_series(0,9) d where o.code like 'LOAD-%';`);
 const seedMs=performance.now()-start,queryStart=performance.now();
 const {rows:[{report}]}=await db.query("select st_settlement_report(1,to_char(current_date,'YYYY-MM')) report");
 const queryMs=performance.now()-queryStart;
 assert.equal(report.summary.jobs,100000);assert.equal(report.summary.chargedCents,401000000);assert.equal(report.summary.earnedCents,200500000);assert.equal(report.jobs.length,100);assert.equal(report.hasMore,true);
 const financeStart=performance.now();
 const {rows:[{finance}]}=await db.query("select st_finance_report(1,to_char(current_date,'YYYY-MM')) finance");
 const financeMs=performance.now()-financeStart;
 assert.equal(finance.summary.completedJobs,100000);assert.equal(finance.summary.totalRevenue,4010000);assert.equal(finance.summary.totalExpenses,2005000);
 const result={financeReportMs:Math.round(financeMs),engine:'Isolated PGlite PostgreSQL; not a concurrent production load test',jobs:100000,seedMs:Math.round(seedMs),reportMs:Math.round(queryMs),responseBytes:JSON.stringify(report).length,assertions:'Exact full-history sums and bounded 100-row page passed'};
 await mkdir('artifacts',{recursive:true});await writeFile('artifacts/history-benchmark.json',JSON.stringify(result,null,2)+'\n');console.log(result);
}finally{await db.close();}
