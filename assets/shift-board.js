/* Additive shift board: local planning model with workload, conflicts and fast actions. */
(()=>{
 const key='shine-time:shift-board';
 const read=()=>{try{return JSON.parse(localStorage.getItem(key)||'[]')}catch{return[]}};
 const write=x=>{try{localStorage.setItem(key,JSON.stringify(x));return true}catch{return false}};
 const planner=()=>window.ShineTimeShiftPlanner;
 const normalize=x=>({...x,cleanerId:String(x.cleanerId||x.cleaner_id||'unassigned'),date:String(x.date||''),start:String(x.start||'08:00'),end:String(x.end||'10:00')});
 const all=()=>read().map(normalize);
 const add=x=>{const rows=all(),item=normalize(x);if(!item.date)return{ok:false,error:'date'};if(planner?.().conflicts([...rows,item]).length)return{ok:false,error:'conflict'};rows.push(item);write(rows);return{ok:true,item}};
 const remove=index=>{const rows=all();rows.splice(Number(index),1);write(rows);return rows};
 const summary=()=>{const rows=all();const p=planner?.();return{count:rows.length,workload:p?.workload(rows)||[],conflicts:p?.conflicts(rows)||[]}};
 const render=(container= document.querySelector('[data-shift-board]'))=>{if(!container)return false;const s=summary();container.innerHTML=`<div class="section-head"><div><h3>Shift Board</h3><p class="subtle">${s.count} shifts · ${s.conflicts.length} conflicts</p></div><button class="btn" type="button" data-shift-add>Quick shift</button></div><div class="grid-2"><div class="card"><h4>Workload</h4>${s.workload.length?s.workload.map(x=>`<div class="list-row"><strong>${x.cleanerId}</strong><span>${x.hours}h</span></div>`).join(''):'<div class="empty">No shifts</div>'}</div><div class="card"><h4>Conflicts</h4>${s.conflicts.length?s.conflicts.map(x=>`<div class="list-row"><strong>${x.cleanerId}</strong><span>${x.date}</span></div>`).join(''):'<div class="empty">No conflicts</div>'}</div></div>`;container.querySelector('[data-shift-add]')?.addEventListener('click',()=>{const date=new Date().toISOString().slice(0,10);const result=add({cleanerId:'unassigned',date,start:'08:00',end:'10:00'});if(result.ok)render(container);window.toast?.(result.ok?'Shift added':'Shift conflicts with an existing shift',result.ok?'success':'error')});return true};
 window.ShineTimeShiftBoard={all,add,remove,summary,render};
 new MutationObserver(()=>render()).observe(document.body,{childList:true,subtree:true});
})();
