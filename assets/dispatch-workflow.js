/* Live dispatch workflow: periodic recomputation, safe local proposals and activity integration. */
(()=>{
 const key='shine-time:dispatch-workflow';
 let timer=null,last=null,source=null,options={};
 const engine=()=>window.ShineTimeDispatch;
 const read=()=>{try{return JSON.parse(localStorage.getItem(key)||'{}')}catch{return{}}};
 const save=v=>{try{localStorage.setItem(key,JSON.stringify(v))}catch{}};
 const compute=data=>{last=engine()?.dispatch(data.jobs||[],data.cleaners||[],data.shifts||[],options)||[];save({updatedAt:new Date().toISOString(),summary:engine()?.summary(last),rows:last});return last};
 const applyLocal=(rows=[],onlyChanges=true)=>rows.filter(x=>x.recommended&&(onlyChanges?x.needsAssignment||x.needsReassignment:true)).map(x=>({...x.job,cleanerId:x.recommended.cleanerId,assignmentReason:x.needsReassignment?'SMART_REBALANCE':'SMART_ASSIGNMENT',dispatchEta:x.recommended.eta?.minutes??null}));
 const start=(provider,opts={})=>{stop();source=typeof provider==='function'?provider:null;options={intervalMs:30000,...opts};const tick=async()=>{if(!source)return;try{const data=await source();compute(data);window.dispatchEvent(new CustomEvent('shine:dispatch',{detail:{rows:last,summary:engine()?.summary(last)}}))}catch(error){window.dispatchEvent(new CustomEvent('shine:dispatch-error',{detail:{error:String(error?.message||error)}}))}};tick();timer=setInterval(tick,Math.max(5000,Number(options.intervalMs)||30000));return true};
 const stop=()=>{if(timer){clearInterval(timer);timer=null}source=null;return true};
 const refresh=async data=>compute(data||await source?.()||{});
 const status=()=>({running:Boolean(timer),updatedAt:read().updatedAt||null,summary:engine()?.summary(last||[])||read().summary||null});
 const render=(container,rows=last||[])=>{if(!container)return false;const s=engine()?.summary(rows)||{total:0,assignments:0,reassignments:0,uncovered:0,urgent:0};const esc=v=>String(v??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]||c));container.innerHTML=`<div class="section-head"><div><h3>Smart Dispatch Live</h3><p class="subtle">${s.total} jobs · ${s.urgent} urgent · ${s.assignments} assignments · ${s.reassignments} rebalances</p></div><span class="badge">${s.uncovered?'GAPS':'READY'}</span></div><div class="list">${rows.slice(0,12).map(x=>`<div class="list-row"><div><strong>${esc(x.job?.title||x.job?.id||'Job')}</strong><div class="subtle">${x.recommended?`→ ${esc(x.recommended.cleanerId)} · ETA ${esc(x.recommended.eta?.minutes??'—')} min · ${esc(x.recommended.eta?.distanceKm??'—')} km`:'No eligible cleaner'}</div></div><span class="badge">${esc(x.priority)}</span></div>`).join('')||'<div class="empty">No dispatch data</div>'}</div>`;return true};
 window.ShineTimeDispatchWorkflow={compute,applyLocal,start,stop,refresh,status,render};
})();