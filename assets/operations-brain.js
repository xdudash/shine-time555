/* Operations Brain: combines historical cleaner performance with dispatch planning to surface local optimization recommendations. */
(()=>{
 const num=v=>Number.isFinite(Number(v))?Number(v):0;
 const upper=v=>String(v??'').toUpperCase();
 const id=v=>String(v??'');
 const perf=()=>window.ShineTimePerformance;
 const planner=()=>window.ShineTimeDispatchPlanner;
 const buildProfiles=(cleaners=[],jobs=[],options={})=>cleaners.map(c=>perf()?.profile(c,jobs,options));
 const predict=(cleaner,job,jobs=[],options={})=>perf()?.predict(cleaner,job,jobs,options)||null;
 const optimize=(jobs=[],cleaners=[],historyJobs=jobs,options={})=>{
  const active=jobs.filter(j=>!['COMPLETED','CANCELLED'].includes(upper(j.status)));
  const rows=active.map(job=>{
   const current=id(job.cleanerId||job.cleaner_id), candidates=perf()?.rank({cleaners,job,jobs:historyJobs,options})||[],best=candidates[0]||null,currentCleaner=cleaners.find(c=>id(c.id||c.user_id)===current),currentPrediction=currentCleaner?predict(currentCleaner,job,historyJobs,options):null;
   const gain=currentPrediction&&best?Math.max(0,currentPrediction.predictedMinutes-best.prediction.predictedMinutes):0;
   const risk=best?.prediction?.lateRisk??100;
   const action=!current?'ASSIGN':best&&best.cleanerId!==current&&gain>=Math.max(10,num(options.minGainMinutes||15))?'REASSIGN':risk>=70?'RESCUE':'KEEP';
   return{job,currentCleanerId:current||null,recommended:best,recommendation:action,timeGainMinutes:gain,risk,confidence:best?.prediction?.confidence??0,reason:action==='REASSIGN'?'FASTER_PERFORMER':action==='RESCUE'?'LATE_RISK':action==='ASSIGN'?'UNASSIGNED':'STABLE'};
  }).sort((a,b)=>({RESCUE:0,REASSIGN:1,ASSIGN:2,KEEP:3}[a.recommendation]-({RESCUE:0,REASSIGN:1,ASSIGN:2,KEEP:3}[b.recommendation])||b.risk-a.risk||b.timeGainMinutes-a.timeGainMinutes));
  return{rows,profiles:buildProfiles(cleaners,historyJobs,options),summary:{jobs:rows.length,assignments:rows.filter(x=>x.recommendation==='ASSIGN').length,reassignments:rows.filter(x=>x.recommendation==='REASSIGN').length,rescues:rows.filter(x=>x.recommendation==='RESCUE').length,keep:rows.filter(x=>x.recommendation==='KEEP').length}};
 };
 const forecast=(jobs=[],cleaners=[],historyJobs=jobs,options={})=>jobs.map(job=>{const current=id(job.cleanerId||job.cleaner_id),c=cleaners.find(x=>id(x.id||x.user_id)===current),p=c?predict(c,job,historyJobs,options):null;return{job,cleanerId:current||null,prediction:p}});
 const render=(target,data)=>{const root=typeof target==='string'?document.querySelector(target):target;if(!root)return null;root.innerHTML=`<div class="ops-brain"><strong>Operations Brain</strong><span>${data.summary.rescues} rescue · ${data.summary.reassignments} reassign · ${data.summary.assignments} assign</span></div>`;return root};
 window.ShineTimeOperationsBrain={buildProfiles,predict,optimize,forecast,render,localOnly:true};
})();
