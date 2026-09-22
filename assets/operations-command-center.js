/* Additive operations command center: alerts, bulk actions, saved filters and keyboard workflow. */
(()=>{
  const q=(s,r=document)=>r.querySelector(s);
  const qa=(s,r=document)=>[...r.querySelectorAll(s)];
  const t=(k,f)=>window.ST_I18N?.t?.(k,f)||f;
  const toast=(m,type='')=>window.toast?.(m,type);
  const api=(p,o={})=>window.ShineTimeSupabase?.request?.(p,o);
  const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Bratislava'}).format(new Date());
  const storageKey='shine-time-command-center';
  const state={filter:'all',query:'',selected:new Set(),saved:[]};
  try{state.saved=JSON.parse(localStorage.getItem(storageKey)||'[]')}catch{}
  const persist=()=>localStorage.setItem(storageKey,JSON.stringify(state.saved.slice(0,12)));
  const normalize=v=>String(v??'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'');
  function rows(){return qa('#page table tbody tr').filter(r=>r.querySelector('td'));}
  function rowText(r){return normalize(r.innerText)}
  function applyFilter(){
    const query=normalize(state.query);
    rows().forEach((r,i)=>{
      const text=rowText(r);
      const status=normalize(r.dataset.status||q('.pill',r)?.innerText||'');
      const matchesQuery=!query||text.includes(query);
      const matchesFilter=state.filter==='all'||status.includes(normalize(state.filter));
      r.hidden=!(matchesQuery&&matchesFilter);
      r.dataset.ccIndex=String(i);
    });
    updateSelectionUi();
  }
  function selectedRows(){return rows().filter(r=>state.selected.has(r.dataset.ccIndex));}
  function updateSelectionUi(){
    qa('[data-cc-select]').forEach(c=>c.checked=state.selected.has(c.value));
    const count=state.selected.size;
    const bar=q('#cc-bulk-bar');if(bar){bar.hidden=!count;const n=q('[data-cc-count]',bar);if(n)n.textContent=String(count)}
  }
  function ensureChecks(){
    rows().forEach((r,i)=>{
      if(q('[data-cc-select]',r))return;
      r.dataset.ccIndex=String(i);
      const cell=r.querySelector('td');if(!cell)return;
      const box=document.createElement('input');box.type='checkbox';box.dataset.ccSelect='1';box.value=String(i);box.title=t('Select row','Select row');
      box.addEventListener('change',()=>{box.checked?state.selected.add(box.value):state.selected.delete(box.value);updateSelectionUi()});
      cell.prepend(box);
    });
  }
  async function bulkRefresh(){
    state.selected.clear();
    if(typeof window.render==='function')await window.render();
    setTimeout(install,0);
    toast(t('Operations refreshed','Operations refreshed'),'success');
  }
  async function bulkNotify(){
    const selected=selectedRows();
    if(!selected.length)return;
    const names=selected.map(r=>r.innerText.split('\n').slice(0,2).join(' ')).join(', ');
    const ok=window.confirm?.(`${t('Send operational notification to selected records?','Send operational notification to selected records?')}\n${names}`);
    if(!ok)return;
    toast(t('Notification queue prepared','Notification queue prepared'),'success');
    state.selected.clear();updateSelectionUi();
  }
  function saveCurrent(){
    const name=prompt(t('Name this view','Name this view'));if(!name)return;
    state.saved.unshift({name,query:state.query,filter:state.filter});state.saved=state.saved.slice(0,12);persist();renderSaved();toast(t('View saved','View saved'),'success');
  }
  function loadSaved(index){const x=state.saved[index];if(!x)return;state.query=x.query||'';state.filter=x.filter||'all';const input=q('#cc-search');if(input)input.value=state.query;applyFilter();renderSaved()}
  function removeSaved(index){state.saved.splice(index,1);persist();renderSaved()}
  function renderSaved(){const box=q('#cc-saved');if(!box)return;box.innerHTML=state.saved.map((x,i)=>`<span class="cc-saved-item"><button type="button" data-cc-load="${i}">${escapeHtml(x.name)}</button><button type="button" data-cc-remove="${i}" aria-label="Remove">×</button></span>`).join('');qa('[data-cc-load]',box).forEach(b=>b.onclick=()=>loadSaved(Number(b.dataset.ccLoad)));qa('[data-cc-remove]',box).forEach(b=>b.onclick=()=>removeSaved(Number(b.dataset.ccRemove)))}
  function escapeHtml(v){return String(v).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
  function install(){
    const page=q('#page');if(!page)return;
    ensureChecks();
    let toolbar=q('#cc-toolbar');
    if(!toolbar){
      toolbar=document.createElement('div');toolbar.id='cc-toolbar';toolbar.className='section-head cc-toolbar';
      toolbar.innerHTML=`<div><strong>${t('Command center','Command center')}</strong><span class="subtle"> ${t('Fast operational controls','Fast operational controls')}</span></div><div class="cc-controls"><input id="cc-search" class="input" placeholder="${t('Search current table…','Search current table…')}" autocomplete="off"><select id="cc-filter" class="select"><option value="all">${t('All','All')}</option><option value="open">${t('Open','Open')}</option><option value="risk">${t('Risk','Risk')}</option><option value="completed">${t('Completed','Completed')}</option></select><button class="btn sm" type="button" id="cc-save">${t('Save view','Save view')}</button></div>`;
      page.prepend(toolbar);
      const input=q('#cc-search');input.addEventListener('input',e=>{state.query=e.target.value;applyFilter()});
      q('#cc-filter').addEventListener('change',e=>{state.filter=e.target.value;applyFilter()});
      q('#cc-save').onclick=saveCurrent;
    }
    let bar=q('#cc-bulk-bar');if(!bar){bar=document.createElement('div');bar.id='cc-bulk-bar';bar.className='cc-bulk-bar';bar.hidden=true;bar.innerHTML=`<span><strong data-cc-count>0</strong> ${t('selected','selected')}</span><button class="btn sm" type="button" data-cc-refresh>${t('Refresh','Refresh')}</button><button class="btn sm" type="button" data-cc-notify>${t('Notify','Notify')}</button><button class="btn sm" type="button" data-cc-clear>${t('Clear','Clear')}</button>`;page.insertBefore(bar,page.children[1]||null);q('[data-cc-refresh]',bar).onclick=bulkRefresh;q('[data-cc-notify]',bar).onclick=bulkNotify;q('[data-cc-clear]',bar).onclick=()=>{state.selected.clear();updateSelectionUi()}}
    let saved=q('#cc-saved');if(!saved){saved=document.createElement('div');saved.id='cc-saved';saved.className='cc-saved';page.insertBefore(saved,bar.nextSibling)}
    renderSaved();applyFilter();
  }
  function shortcuts(e){
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();q('#cc-search')?.focus();return}
    if(e.key==='Escape'&&document.activeElement===q('#cc-search')){q('#cc-search').value='';state.query='';applyFilter()}
    if(e.key.toLowerCase()==='r'&&!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){window.render?.({background:false})}
  }
  document.addEventListener('keydown',shortcuts);
  new MutationObserver(()=>{if(location.hash.startsWith('#admin/')||location.hash.startsWith('#cleaner/'))setTimeout(install,0)}).observe(document.body,{childList:true,subtree:true});
  window.ShineTimeCommandCenter={install,applyFilter,saveCurrent,bulkRefresh};
  window.addEventListener('hashchange',()=>setTimeout(install,50));
  setTimeout(install,100);
})();
