/* Shine Time Operations Command Surface — additive UX and workflow helpers. */
(function(){
  'use strict';
  const state={route:'',ready:false};
  const app=()=>document.querySelector('#app');
  const page=()=>document.querySelector('#page');
  const route=()=>location.hash.replace(/^#/,'');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function toast(msg,type=''){ if(typeof window.toast==='function')window.toast(msg,type); }
  function nav(r){ if(typeof window.navTo==='function')window.navTo(r); else location.hash=r; }
  function csv(){
    const table=page()?.querySelector('table'); if(!table)return toast('No table on this page','error');
    const rows=[...table.querySelectorAll('tr')].filter(r=>r.offsetParent!==null);
    const text=rows.map(r=>[...r.children].map(c=>'"'+c.innerText.replace(/"/g,'""').replace(/\n/g,' ')+'"').join(',')).join('\n');
    const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'}));a.download=`shine-time-${route().replace(/\//g,'-')}-${new Date().toISOString().slice(0,10)}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),500);toast('CSV exported','success');
  }
  function filterRisk(kind){
    const rows=[...(page()?.querySelectorAll('tbody tr')||[])];
    rows.forEach(row=>{const text=row.innerText.toUpperCase();let show=true;if(kind==='risk')show=/RED|ORANGE|AT RISK|RESCUE/.test(text);if(kind==='rescue')show=/RESCUE/.test(text);if(kind==='unassigned')show=/UNASSIGNED|UNASSIGNED/.test(text);row.style.display=show?'':'none';});
    document.querySelectorAll('.st-command-surface [data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===kind));
  }
  function clearFilter(){(page()?.querySelectorAll('tbody tr')||[]).forEach(r=>r.style.display='');document.querySelectorAll('.st-command-surface [data-filter]').forEach(b=>b.classList.remove('active'));}
  function build(){
    const p=page(); if(!p||!['admin/live','admin/jobs','admin/tomorrow'].includes(route()))return;
    if(p.querySelector('.st-command-surface'))return;
    const surface=document.createElement('section');surface.className='st-command-surface';surface.innerHTML=`
      <div class="st-command-main"><div class="st-command-title"><span class="st-command-pulse"></span><div><strong>Operations command</strong><small>Fast controls for the current board</small></div></div>
      <div class="st-command-actions"><button class="st-cmd" data-filter="risk">⚠ Risk</button><button class="st-cmd" data-filter="rescue">↯ Rescue</button><button class="st-cmd" data-filter="unassigned">○ Unassigned</button><button class="st-cmd" data-filter="all">All</button><button class="st-cmd" data-export>⇩ CSV</button><button class="st-cmd primary" data-refresh>↻ Refresh</button></div></div>
      <div class="st-command-hints"><span><kbd>R</kbd> refresh</span><span><kbd>1</kbd> live</span><span><kbd>2</kbd> jobs</span><span><kbd>3</kbd> tomorrow</span><span><kbd>/</kbd> search</span></div>`;
    p.prepend(surface);
    surface.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>b.dataset.filter==='all'?clearFilter():filterRisk(b.dataset.filter));
    surface.querySelector('[data-export]').onclick=csv;
    surface.querySelector('[data-refresh]').onclick=()=>{if(typeof window.render==='function')window.render();};
  }
  function enhance(){
    const r=route();
    if(r!==state.route){state.route=r;state.ready=false;}
    build();
    const search=page()?.querySelector('#job-search');
    if(search&&!search.dataset.commandFocus){search.dataset.commandFocus='1';}
  }
  document.addEventListener('keydown',e=>{
    if(e.ctrlKey||e.metaKey||e.altKey)return;
    const tag=(e.target?.tagName||'').toLowerCase();
    if(['input','textarea','select'].includes(tag))return;
    const r=route();
    if(e.key.toLowerCase()==='r'&&['admin/live','admin/jobs','admin/tomorrow'].includes(r)){e.preventDefault();window.render?.();return;}
    if(e.key==='1'){e.preventDefault();nav('admin/live');}
    if(e.key==='2'){e.preventDefault();nav('admin/jobs');}
    if(e.key==='3'){e.preventDefault();nav('admin/tomorrow');}
    if(e.key==='/'){const s=page()?.querySelector('#job-search');if(s){e.preventDefault();s.focus();}}
  });
  const observer=new MutationObserver(()=>{if(!state.ready){state.ready=true;requestAnimationFrame(enhance);}});
  function init(){const root=app();if(!root)return setTimeout(init,100);observer.observe(root,{childList:true,subtree:true});enhance();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
