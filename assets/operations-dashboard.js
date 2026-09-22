/* Additive dashboard widgets: shift clock, workload meter, quick actions and local activity feed. */
(()=>{
 const q=(s,r=document)=>r.querySelector(s),t=(k,f)=>window.ST_I18N?.t?.(k,f)||f;
 const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
 const api=(p,o={})=>window.ShineTimeSupabase?.request?.(p,o);
 const key='shine-time-dashboard-feed';
 const now=()=>new Date();
 const time=()=>new Intl.DateTimeFormat(window.ST_I18N?.getLocale?.()||'en',{hour:'2-digit',minute:'2-digit'}).format(now());
 let feed=[];
 try{feed=JSON.parse(localStorage.getItem(key)||'[]')}catch{}
 function addFeed(type,text){feed.unshift({type,text,at:Date.now()});feed=feed.slice(0,20);localStorage.setItem(key,JSON.stringify(feed));renderFeed()}
 function renderFeed(){const el=q('#st-activity-feed');if(!el)return;el.innerHTML=feed.length?feed.map(x=>`<div class="event"><time>${new Date(x.at).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</time><div><strong>${esc(x.type)}</strong><br><span class="subtle">${esc(x.text)}</span></div></div>`).join(''):`<div class="empty">${t('No local activity yet','No local activity yet')}</div>`}
 async function loadStats(){
   if(!window.state?.me||!['ADMIN','OPERATIONS_MANAGER'].includes(window.state.me.role))return;
   try{
    const [analytics,issues,capacity]=await Promise.all([api('/api/admin/analytics'),api('/api/admin/issues'),api(`/api/admin/capacity?date=${new Intl.DateTimeFormat('en-CA').format(now())}`)]);
    const cards=q('#st-dashboard-cards');if(!cards)return;
    const open=(issues?.issues||[]).filter(x=>!['RESOLVED','CLOSED'].includes(x.status)).length;
    const rescue=(analytics?.risk||analytics?.rescueRisk||0);
    const jobs=capacity?.total||capacity?.jobs||analytics?.jobsToday||0;
    const done=capacity?.completed||analytics?.completedToday||0;
    const rate=jobs?Math.round(done/jobs*100):0;
    cards.innerHTML=[
      ['Jobs today',jobs,''],['Completed',done,`${rate}%`],['Open issues',open,open?'attention':''],['Rescue risk',rescue||0,'']
    ].map(([a,b,c])=>`<div class="kpi"><span>${t(a,a)}</span><strong>${esc(b)}</strong><small>${esc(c)}</small></div>`).join('');
   }catch{}
 }
 function inject(){
  const page=q('#page');if(!page||!location.hash.startsWith('#admin/'))return;
  if(!q('#st-dashboard')){
   const wrap=document.createElement('section');wrap.id='st-dashboard';wrap.className='panel st-dashboard';
   wrap.innerHTML=`<div class="section-head"><div><h3>${t('Operations pulse','Operations pulse')}</h3><p class="subtle">${t('Live workload and local operator activity','Live workload and local operator activity')}</p></div><div class="row"><span class="pill blue"><span class="dot"></span><span id="st-clock">--:--</span></span><button class="btn sm" id="st-pulse-refresh">↻</button></div></div><div id="st-dashboard-cards" class="kpi-grid"></div><div class="st-dashboard-grid"><div><h4>${t('Quick actions','Quick actions')}</h4><div class="button-grid"><button class="btn" data-st-action="live">${t('Live board','Live board')}</button><button class="btn" data-st-action="tomorrow">${t('Tomorrow','Tomorrow')}</button><button class="btn" data-st-action="schedule">${t('Recurring jobs','Recurring jobs')}</button><button class="btn" data-st-action="issues">${t('Issues','Issues')}</button></div></div><div><h4>${t('Activity','Activity')}</h4><div id="st-activity-feed"></div></div></div>`;
   page.prepend(wrap);
   q('#st-pulse-refresh').onclick=()=>loadStats();
   qa('[data-st-action]',wrap).forEach(b=>b.onclick=()=>{const r=b.dataset.stAction;window.navTo?.(`admin/${r}`);addFeed('Navigation',b.innerText)});
  }
  renderFeed();loadStats();
  const clock=q('#st-clock');if(clock){clock.textContent=time();clearInterval(window.__stClock);window.__stClock=setInterval(()=>{if(q('#st-clock'))q('#st-clock').textContent=time()},30000)}
 }
 const qa=(s,r=document)=>[...r.querySelectorAll(s)];
 window.ShineTimeDashboard={inject,addFeed,loadStats};
 new MutationObserver(()=>setTimeout(inject,0)).observe(document.body,{childList:true,subtree:true});
 window.addEventListener('hashchange',()=>setTimeout(inject,50));
 setTimeout(inject,150);
})();
