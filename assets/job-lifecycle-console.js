/* Shine Time Job Lifecycle Console — additive real-command controls. */
(()=>{
  'use strict';
  const ROUTES=new Set(['admin/live','admin/jobs','admin/tomorrow']);
  const route=()=>location.hash.replace(/^#/,'');
  const page=()=>document.querySelector('#page');
  const toast=(m,t='')=>window.toast?.(m,t);
  const request=()=>window.ShineTimeSupabase?.request;
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const status=v=>String(v||'').toUpperCase();
  const unwrap=v=>v?.data??v;
  const commands={
    EN_ROUTE:{label:'Accept / en route',from:['ACCEPTED'],to:'EN_ROUTE',action:'status',body:()=>({status:'EN_ROUTE'})},
    ARRIVED:{label:'Arrived',from:['EN_ROUTE'],to:'ARRIVED',action:'status',body:()=>({status:'ARRIVED'})},
    CLEANING:{label:'Start cleaning',from:['ARRIVED'],to:'CLEANING',action:'status',body:()=>({status:'CLEANING'})},
    COMPLETE:{label:'Complete',from:['CLEANING'],to:'COMPLETED',action:'complete',body:()=>({})}
  };
  async function send(jobId,command,extra={}){
    const req=request();
    if(typeof req!=='function')throw new Error('Supabase API client is not available');
    const spec=commands[command];
    if(!spec)throw new Error('Unsupported lifecycle command');
    const res=await req(`/api/admin/jobs/${encodeURIComponent(jobId)}/${spec.action}`,{method:'POST',body:{...spec.body(),...extra,requestId:crypto.randomUUID()}});
    if(res?.error)throw new Error(res.error.message||'Job command failed');
    return unwrap(res);
  }
  function nextFor(job){
    const s=status(job?.status);
    return Object.entries(commands).find(([,v])=>v.from.includes(s));
  }
  function findJob(jobId){
    const source=window.__shineTimeDispatchRows||[];
    return source.find(x=>String(x?.job?.id)===String(jobId))?.job||null;
  }
  async function execute(jobId,command){
    const job=findJob(jobId);
    if(!job)return toast('Job data is not loaded yet','error');
    try{
      await send(jobId,command);
      toast(`${commands[command].label} applied`,'success');
      await window.ShineTimeDispatchConsole?.refresh?.();
      window.render?.();
    }catch(error){toast(error?.message||'Lifecycle command failed','error');}
  }
  function controls(job){
    const item=nextFor(job); if(!item)return '';
    const [command,spec]=item;
    return `<button class="st-lifecycle-btn" data-lifecycle="${command}" data-job="${esc(job.id)}">${esc(spec.label)}</button>`;
  }
  function decorate(){
    if(!ROUTES.has(route()))return;
    const consoleEl=document.querySelector('.st-dispatch-console');
    if(!consoleEl)return;
    consoleEl.querySelectorAll('.st-dispatch-row-wrap').forEach(wrap=>{
      const row=wrap.querySelector('.st-dispatch-row');
      const id=row?.dataset.job;if(!id||wrap.querySelector('.st-lifecycle-controls'))return;
      const job=findJob(id);if(!job)return;
      const html=controls(job);if(!html)return;
      const bar=document.createElement('div');bar.className='st-lifecycle-controls';bar.innerHTML=html;wrap.append(bar);
      bar.querySelector('[data-lifecycle]')?.addEventListener('click',e=>{e.stopPropagation();execute(id,e.currentTarget.dataset.lifecycle)});
    });
  }
  function init(){
    let last='';
    const tick=()=>{const r=route();if(r!==last){last=r}decorate()};
    setInterval(tick,700);window.addEventListener('shine:dispatch',tick);tick();
  }
  window.ShineTimeJobLifecycle={send,execute,decorate,nextFor};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
