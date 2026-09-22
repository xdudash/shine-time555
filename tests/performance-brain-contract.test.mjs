import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const load=(files)=>{
 const context={window:{},document:{querySelector:()=>null},Date,Math,Number,String,console};
 vm.createContext(context);
 for(const file of files)vm.runInContext(fs.readFileSync(new URL(`../${file}`,import.meta.url),'utf8'),context,{filename:file});
 return context.window;
};

test('performance engine exposes cleaner history profiles and prediction',()=>{
 const w=load(['assets/performance-engine.js']);
 assert.ok(w.ShineTimePerformance);
 const cleaner={id:'c1'};
 const jobs=[
  {id:'j1',cleanerId:'c1',status:'COMPLETED',start:'2026-09-14T08:00:00',end:'2026-09-14T09:30:00',actualMinutes:90},
  {id:'j2',cleanerId:'c1',status:'COMPLETED',start:'2026-09-14T10:00:00',end:'2026-09-14T11:40:00',actualMinutes:100}
 ];
 const profile=w.ShineTimePerformance.profile(cleaner,jobs);
 assert.equal(profile.samples,2);
 assert.ok(profile.medianRatio>0);
 assert.ok(profile.onTimeRate>=0&&profile.onTimeRate<=1);
 const p=w.ShineTimePerformance.predict(cleaner,{durationMinutes:60},jobs);
 assert.ok(p.predictedMinutes>=15);
 assert.ok(p.confidence>0);
});

test('operations brain recommends faster cleaner and marks local only',()=>{
 const w=load(['assets/performance-engine.js','assets/operations-brain.js']);
 const jobs=[
  {id:'old1',cleanerId:'slow',status:'COMPLETED',durationMinutes:60,actualMinutes:120},
  {id:'old2',cleanerId:'fast',status:'COMPLETED',durationMinutes:60,actualMinutes:60},
  {id:'today',cleanerId:'slow',status:'ASSIGNED',durationMinutes:60}
 ];
 const result=w.ShineTimeOperationsBrain.optimize(jobs,[{id:'slow'},{id:'fast'}],jobs,{minGainMinutes:10});
 const row=result.rows.find(x=>x.job.id==='today');
 assert.ok(row);
 assert.equal(row.recommendation,'REASSIGN');
 assert.equal(row.recommended.cleanerId,'fast');
 assert.ok(row.timeGainMinutes>=10);
 assert.equal(w.ShineTimeOperationsBrain.localOnly,true);
});

test('brain handles unassigned jobs and risk',()=>{
 const w=load(['assets/performance-engine.js','assets/operations-brain.js']);
 const jobs=[{id:'u',status:'OPEN',durationMinutes:90}];
 const result=w.ShineTimeOperationsBrain.optimize(jobs,[{id:'c'}],[]);
 assert.equal(result.summary.assignments,1);
 assert.equal(result.rows[0].recommendation,'ASSIGN');
 assert.ok(result.rows[0].recommended);
});
