/* Daily dispatch planner: builds an ordered route-aware plan and predicts late jobs without server mutation. */
(()=>{
 const num=v=>Number.isFinite(Number(v))?Number(v):0;
 const up=v=>String(v??'').toUpperCase();
 const mins=j=>window.ShineTimeDispatch?.jobMinutes?.(j)||60;
 const clock=v=>{const m=String(v??'').match(/^(\d{1,2}):(\d{2})/);return m?Number(m[1])*60+Number(m[2]):null};
 const startMinute=j=>{const x=clock(j.start||j.startTime||j.scheduledStart);return x==null?1440:x};
 const dueMinute=j=>{const x=clock(j.dueTime||j.due||j.slaTime);return x==null?1440:x};
 const routeDistance=(a,b)=>window.ShineTimeDispatch?.distance?.(a,b);
 const travel=(a,b,options={})=>{const km=routeDistance(a,b);if(!Number.isFinite(km))return{km:null,minutes:num(options.defaultTravelMinutes||20)};return{km:Math.round(km*10)/10,minutes:Math.ceil(km/Math.max(5,num(options.speedKmh||30))*60)};};
 const predict=(jobs=[],cleaners=[],shifts=[],options={})=>{const rows=window.ShineTimeDispatch?.dispatch(jobs,cleaners,shifts,options)||[];const byCleaner=new Map();rows.forEach(r=>{const id=r.recommended?.cleanerId||r.currentCleanerId;if(id)byCleaner.set(id,[...(byCleaner.get(id)||[]),r])});const plans=[];for(const [cleanerId,list] of byCleaner){let cursor=0,previous=null;const ordered=[...list].sort((a,b)=>a.priority-b.priority?b.priority-a.priority:startMinute(a.job)-startMinute(b.job));for(const r of ordered){const j=r.job,e=r.recommended||{};const tr=previous?travel(previous.location||previous,e.cleaner?.location||j.location,options):{km:0,minutes:0};const scheduled=startMinute(j),arrival=Math.max(cursor,scheduled)+tr.minutes,finish=arrival+mins(j),due=dueMinute(j);const late=Math.max(0,finish-due);plans.push({job:j,cleanerId,priority:r.priority,scheduledStart:scheduled,estimatedArrival:arrival,estimatedFinish:finish,lateMinutes:late,predictedLate:late>0,travelMinutes:tr.minutes,distanceKm:tr.km,reason:late>0?'ETA_RISK':'ON_TRACK'});cursor=finish;previous=j;}}
 return plans.sort((a,b)=>b.priority-a.priority||a.estimatedArrival-b.estimatedArrival)};
 const summary=plans=>({jobs:plans.length,predictedLate:plans.filter(x=>x.predictedLate).length,totalLateMinutes:plans.reduce((s,x)=>s+x.lateMinutes,0),onTrack:plans.filter(x=>!x.predictedLate).length});
 const buildPlan=(jobs=[],cleaners=[],shifts=[],options={})=>{const plans=predict(jobs,cleaners,shifts,options),changes=[];const seen=new Set();for(const p of plans){const key=String(p.job?.id||p.job?.title||Math.random());if(seen.has(key))continue;seen.add(key);const current=String(p.job?.cleanerId||p.job?.cleaner_id||'');if(p.cleanerId&&p.cleanerId!==current)changes.push({jobId:key,from:current||null,to:p.cleanerId,reason:p.reason==='ETA_RISK'?'RESCUE_LATE':'OPTIMIZE_ROUTE',lateMinutes:p.lateMinutes})}return{plans,changes,summary:summary(plans)}};
 window.ShineTimeDispatchPlanner={clock,startMinute,dueMinute,travel,predict,summary,buildPlan};
})();