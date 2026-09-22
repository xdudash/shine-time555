/* Additive activity log: durable local audit trail for operator actions. */
(()=>{
 const key='shine-time:activity-log';
 const load=()=>{try{return JSON.parse(localStorage.getItem(key)||'[]')}catch{return[]}};
 const save=x=>{try{localStorage.setItem(key,JSON.stringify(x.slice(0,250)));return true}catch{return false}};
 const add=(action,detail='',meta={})=>{const rows=load();rows.unshift({id:String(Date.now())+'-'+Math.random().toString(36).slice(2,7),action:String(action),detail:String(detail),meta,at:new Date().toISOString()});save(rows);return rows[0]};
 const clear=()=>save([]);
 const render=(container=document.querySelector('[data-activity-log]'))=>{if(!container)return false;const rows=load();container.innerHTML=`<div class="section-head"><div><h3>Activity Log</h3><p class="subtle">${rows.length} recorded actions</p></div><button class="btn" type="button" data-clear-activity>Clear</button></div><div class="list">${rows.slice(0,30).map(x=>`<div class="list-row"><div><strong>${String(x.action).replace(/[&<>\"]/g,'')}</strong><div class="subtle">${String(x.detail).replace(/[&<>\"]/g,'')}</div></div><time class="subtle">${new Date(x.at).toLocaleString()}</time></div>`).join('')||'<div class="empty">No activity yet</div>'}</div>`;container.querySelector('[data-clear-activity]')?.addEventListener('click',()=>{clear();render(container)});return true};
 window.ShineTimeActivity={load,save,add,clear,render};new MutationObserver(()=>render()).observe(document.body,{childList:true,subtree:true});
})();
