/* Additive shift planner: weekly grids, workload balancing and shift conflict utilities. */
(()=>{
 const DAY=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
 const mins=v=>{const m=String(v||'').match(/^(\d{1,2}):(\d{2})$/);if(!m)return null;const n=Number(m[1])*60+Number(m[2]);return n<1440&&Number(m[2])<60?n:null};
 const duration=(start,end)=>{const a=mins(start),b=mins(end);if(a===null||b===null)return 0;return b>=a?b-a:1440-a+b};
 const week=(date=new Date())=>{const d=new Date(date);d.setHours(12,0,0,0);d.setDate(d.getDate()-d.getDay());return Array.from({length:7},(_,i)=>{const x=new Date(d);x.setDate(d.getDate()+i);return{date:x.toISOString().slice(0,10),weekday:DAY[i]}})};
 const workload=(shifts=[])=>{const by={};for(const x of shifts){const id=String(x.cleanerId||x.cleaner_id||'unassigned');by[id]=(by[id]||0)+duration(x.start,x.end)}return Object.entries(by).map(([cleanerId,minutes])=>({cleanerId,minutes,hours:Math.round(minutes/60*100)/100})).sort((a,b)=>b.minutes-a.minutes)};
 const balance=(shifts=[],limit=480)=>workload(shifts).map(x=>({...x,overLimit:x.minutes>limit,utilization:Math.round(x.minutes/limit*1000)/10}));
 const conflicts=(shifts=[])=>{const out=[];for(let i=0;i<shifts.length;i++)for(let j=i+1;j<shifts.length;j++){const a=shifts[i],b=shifts[j];if(String(a.cleanerId||a.cleaner_id)!==String(b.cleanerId||b.cleaner_id)||String(a.date)!==String(b.date))continue;const as=mins(a.start),ae=as+duration(a.start,a.end),bs=mins(b.start),be=bs+duration(b.start,b.end);if(as<be&&bs<ae)out.push({a:i,b:j,cleanerId:a.cleanerId||a.cleaner_id,date:a.date})}return out};
 const nextAvailable=(shifts,cleanerId,date,start,end)=>!conflicts([...(shifts||[]),{cleanerId,date,start,end}]).some(x=>x.cleanerId===cleanerId&&x.date===date);
 window.ShineTimeShiftPlanner={week,duration,workload,balance,conflicts,nextAvailable};
})();
