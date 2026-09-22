/* Shine Time Dispatch Console — additive operational control layer. */
(()=>{
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const route=()=>location.hash.replace(/^#/,'');
  const page=()=>document.querySelector('#page');
  const toast=(m,type='')=>window.toast?.(m,type);
  const request=()=>window.ShineTimeSupabase?.request;
  let cache={jobs:[],cleaners:[],rows:[]};
  const unwrap=v=>v?.data??v;
  const activeJob=j=>!['COMPLETED','CANCELLED'].includes(String(j?.status||'').toUpperCase());
  const statusText=j=>String(j?.status||'').toUpperCase();
  async function load(){
    if(typeof request()!=='function')throw new Error('Supabase API client is not available');
    const [jobsRes,cleanersRes]=await Promise.all([request()('/api/admin/jobs'),request()('/api/admin/cleaners')]);
    const jobs=unwrap(jobsRes)?.jobs||[],cleaners=unwrap(cleanersRes)?.cleaners||[];
    cache.jobs=jobs;cache.cleaners=cleaners;
    const shifts=jobs.filter(j=>j.assigned_cleaner_id||j.cleaner_id).map(j=>({cleanerId:j.assigned_cleaner_id||j.cleaner_id,date:j.service_date,start:j.planned_start,end:j.eta,durationMinutes:j.duration_minutes}));
    const rows=window.ShineTimeDispatch?.dispatch?.(jobs,cleaners,shifts,{})||jobs.filter(activeJob).map(job=>({job,priority:Number(job.risk_score||job.priority||0),needsAssignment:!job.assigned_cleaner_id,recommended:null,needsReassignment:false}));
    cache.rows=rows;window.__shineTimeDispatchRows=rows;window.dispatchEvent(new CustomEvent('shine:dispatch',{detail:{rows,summary:window.ShineTimeDispatch?.summary?.(rows)}}));return rows;
  }
  async function runCommand(jobId,action,payload={}){const req=request();if(typeof req!=='function')throw new Error('Supabase API client is not available');const res=await req(`/api/admin/jobs/${encodeURIComponent(jobId)}/${action}`,{method:'POST',body:payload});if(res?.error)throw new Error(res.error.message||'Operation failed');return unwrap(res);}
  async function assign(jobId,cleanerId,rescue=false){
    try{await runCommand(jobId,rescue?'rescue':'assign',{cleanerId:Number(cleanerId),requestId:crypto.randomUUID()});toast(rescue?'Rescue assignment applied':'Cleaner assigned','success');await load();paint(document.querySelector('.st-dispatch-console'));window.render?.();}
    catch(error){toast(error?.message||'Dispatch operation failed','error');}
  }
  const cleanerName=id=>{const c=cache.cleaners.find(x=>String(x.id)===String(id));return c?.full_name||c?.name||id||'—';};
  function openPicker(jobId,rescue=false){
    const candidates=cache.cleaners.filter(c=>c.active!==false&&c.available!==false);
    const html=candidates.map(c=>`<button class="st-dispatch-picker-row" data-picker-id="${esc(c.id)}"><strong>${esc(c.full_name||c.name||`Cleaner ${c.id}`)}</strong><small>${esc(c.mode||'')}${c.reliability_score!=null?` · reliability ${esc(c.reliability_score)}`:''}</small></button>`).join('')||'<div class="st-dispatch-empty">No active cleaner is currently available.</div>';
    let root=document.querySelector('#dispatch-picker-root');if(!root){root=document.createElement('div');root.id='dispatch-picker-root';document.body.append(root);}
    root.innerHTML=`<div class="st-dispatch-picker-backdrop"><div class="st-dispatch-picker" role="dialog" aria-modal="true"><div class="st-dispatch-picker-head"><strong>${rescue?'Choose rescue cleaner':'Assign cleaner'}</strong><button data-picker-close>×</button></div><div class="st-dispatch-picker-list">${html}</div></div></div>`;
    root.querySelector('[data-picker-close]').onclick=()=>root.remove();root.querySelectorAll('[data-picker-id]').forEach(b=>b.onclick=async()=>{const id=b.dataset.pickerId;root.remove();await assign(jobId,id,rescue);});
  }
  function render(){
    if(!['admin/live','admin/jobs','admin/tomorrow'].includes(route()))return;const p=page();if(!p||p.querySelector('.st-dispatch-console'))return;
    const el=document.createElement('section');el.className='st-dispatch-console';el.innerHTML=`<div class="st-dispatch-head"><div><div class="st-eyebrow">DISPATCH CONTROL</div><h2>Live assignment desk</h2><p>Real API assignment and rescue actions — no simulated success.</p></div><div class="st-dispatch-actions"><button class="st-dispatch-btn" data-action="refresh">↻ Recalculate</button><button class="st-dispatch-btn danger" data-action="rescue">⚡ Rescue queue</button></div></div><div class="st-dispatch-metrics"><div><span>Open</span><strong data-m="open">—</strong></div><div><span>Unassigned</span><strong data-m="unassigned">—</strong></div><div><span>Rebalance</span><strong data-m="rebalance">—</strong></div><div><span>Urgent</span><strong data-m="urgent">—</strong></div></div><div class="st-dispatch-body"><div class="st-dispatch-list" data-list><div class="st-dispatch-empty">Loading live dispatch data…</div></div></div>`;
    p.prepend(el);el.querySelector('[data-action="refresh"]').onclick=refresh;el.querySelector('[data-action="rescue"]').onclick=()=>document.querySelector('[data-filter="rescue"]')?.click()||toast('Rescue queue filter is ready on the board','success');refresh();
  }
  async function refresh(){const el=document.querySelector('.st-dispatch-console');if(!el)return;const btn=el.querySelector('[data-action="refresh"]');if(btn)btn.disabled=true;try{await load();paint(el);}catch(error){toast(error?.message||'Could not load dispatch data','error');}finally{if(btn)btn.disabled=false;}}
  function paint(el){
    if(!el)return;const data=cache.rows.length?cache.rows:(window.__shineTimeDispatchRows||[]),open=data.filter(x=>activeJob(x.job)),unassigned=data.filter(x=>x.needsAssignment||statusText(x.job)==='UNASSIGNED'),rebalance=data.filter(x=>x.needsReassignment),urgent=data.filter(x=>Number(x.priority)>=85||['CRITICAL','URGENT','OVERDUE','AT_RISK','LATE','RESCUE'].includes(statusText(x.job)));
    el.querySelector('[data-m="open"]').textContent=open.length;el.querySelector('[data-m="unassigned"]').textContent=unassigned.length;el.querySelector('[data-m="rebalance"]').textContent=rebalance.length;el.querySelector('[data-m="urgent"]').textContent=urgent.length;
    const list=el.querySelector('[data-list]');list.innerHTML=data.slice(0,10).map(x=>{const j=x.job||{},r=x.recommended,assigned=j.assigned_cleaner_id||j.cleaner_id,action=x.needsAssignment||statusText(j)==='UNASSIGNED'?'ASSIGN':x.needsReassignment?'REBALANCE':urgent.includes(x)?'WATCH':'OK',candidate=r?.cleanerId;return `<div class="st-dispatch-row-wrap"><button class="st-dispatch-row" data-job="${esc(j.id||'')}"><span class="st-dispatch-priority p-${action.toLowerCase()}">${action}</span><span class="st-dispatch-job"><strong>${esc(j.title||j.object_name||j.id||'Job')}</strong><small>${esc(j.address||j.zone||j.service_date||'No location')} · ${candidate?`→ ${esc(cleanerName(candidate))} · ${esc(r.eta?.minutes??'—')} min`:assigned?`Assigned: ${esc(cleanerName(assigned))}`:'No eligible cleaner'}</small></span><span class="st-dispatch-score">${Number(x.priority||0)}</span></button>${action==='ASSIGN'||action==='REBALANCE'?`<button class="st-dispatch-inline" data-dispatch-action="assign" data-job="${esc(j.id)}">Assign</button>`:''}${urgent.includes(x)?`<button class="st-dispatch-inline rescue" data-dispatch-action="rescue" data-job="${esc(j.id)}">Rescue</button>`:''}</div>`}).join('')||'<div class="st-dispatch-empty">No dispatch recommendations yet.</div>';
    list.querySelectorAll('.st-dispatch-row[data-job]').forEach(b=>b.onclick=()=>window.openJob?.(b.dataset.job)||window.viewJob?.(b.dataset.job));list.querySelectorAll('[data-dispatch-action="assign"]').forEach(b=>b.onclick=e=>{e.stopPropagation();openPicker(b.dataset.job,false)});list.querySelectorAll('[data-dispatch-action="rescue"]').forEach(b=>b.onclick=e=>{e.stopPropagation();openPicker(b.dataset.job,true)});
  }
  function init(){render();let lastRoute='';setInterval(()=>{const r=route();if(r!==lastRoute){lastRoute=r;render();}const el=page()?.querySelector('.st-dispatch-console');if(el&&!el.dataset.livePaint){el.dataset.livePaint='1';paint(el);}},1500);}
  window.ShineTimeDispatchConsole={render,paint,load,refresh,assign};window.addEventListener('shine:dispatch',e=>{cache.rows=e.detail?.rows||[];const el=page()?.querySelector('.st-dispatch-console');if(el)paint(el)});if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
