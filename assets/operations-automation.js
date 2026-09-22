/* Additive operations automation: command center, shortcuts, refresh hints and safe UI helpers. */
(()=>{
  const state=window.state||null;
  const tr=(k,f)=>window.ST_I18N?.t?.(k,f)||f;
  const toast=(m,t)=>window.toast?.(m,t);
  const routes={
    admin:[['owner','Owner board'],['live','Live Operations'],['map','Map'],['tomorrow','Tomorrow'],['jobs','Jobs'],['objects','Objects'],['clients','Clients'],['cleaners','Cleaners'],['finance','Finance'],['issues','Issues'],['analytics','Analytics'],['settings','Settings']],
    cleaner:[['home','Home'],['jobs','Jobs'],['myday','My Day'],['earnings','Earnings'],['profile','Profile']],
    client:[['home','Home'],['book','Book Cleaning'],['objects','Objects'],['bookings','Bookings'],['finance','Finance'],['profile','Profile']]
  };
  let paletteOpen=false,shortcutBound=false,refreshTimer=0,lastActivity=Date.now();
  const rolePrefix=()=>{
    const role=window.state?.me?.role;
    if(['ADMIN','OPERATIONS_MANAGER'].includes(role))return'admin';
    if(role==='CLEANER')return'cleaner';
    return'client';
  };
  const go=r=>{window.navTo?.(`${rolePrefix()}/${r}`);closePalette()};
  const closePalette=()=>{document.getElementById('st-command-palette')?.remove();paletteOpen=false};
  const openPalette=()=>{
    if(paletteOpen)return;
    paletteOpen=true;
    const wrap=document.createElement('div');wrap.id='st-command-palette';wrap.className='modal-backdrop';
    const items=routes[rolePrefix()]||[];
    wrap.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-label="${tr('Command center','Command center')}"><div class="modal-head"><h3>${tr('Command center','Command center')}</h3><button class="close-x" type="button" aria-label="${tr('Close','Close')}">×</button></div><div class="modal-body"><input id="st-command-search" class="input" autocomplete="off" placeholder="${tr('Search operations…','Search operations…')}"/><div id="st-command-results" class="command-results" style="margin-top:12px"></div><p class="subtle" style="margin-top:12px">${tr('Enter to open · Esc to close · Ctrl/⌘ K to open','Enter to open · Esc to close · Ctrl/⌘ K to open')}</p></div></div>`;
    document.body.appendChild(wrap);
    wrap.querySelector('.close-x').onclick=closePalette;
    wrap.onclick=e=>{if(e.target===wrap)closePalette()};
    const input=wrap.querySelector('#st-command-search'),results=wrap.querySelector('#st-command-results');
    const paint=()=>{
      const q=input.value.trim().toLowerCase();
      const filtered=items.filter(x=>!q||x[0].toLowerCase().includes(q)||x[1].toLowerCase().includes(q));
      results.innerHTML=filtered.map((x,i)=>`<button type="button" class="btn ghost full command-item" data-route="${x[0]}" style="justify-content:flex-start;text-align:left;margin-bottom:6px"><strong>${i+1}</strong>&nbsp; ${tr(x[1],x[1])}</button>`).join('')||`<div class="empty">${tr('Nothing found','Nothing found')}</div>`;
      results.querySelectorAll('[data-route]').forEach(b=>b.onclick=()=>go(b.dataset.route));
    };
    input.oninput=paint;
    input.onkeydown=e=>{if(e.key==='Escape'){e.preventDefault();closePalette()}else if(e.key==='Enter'){const b=results.querySelector('[data-route]');if(b){e.preventDefault();go(b.dataset.route)}}};
    paint();input.focus();
  };
  const bindShortcuts=()=>{
    if(shortcutBound)return;shortcutBound=true;
    document.addEventListener('keydown',e=>{
      if(e.key==='Escape'&&paletteOpen){closePalette();return}
      if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();openPalette();return}
      if(e.target.matches('input,textarea,select,[contenteditable="true"]'))return;
      if(e.key==='r'&&!e.ctrlKey&&!e.metaKey){window.render?.();return}
      const map={'1':'home','2':'jobs','3':'myday','4':'earnings','5':'live','6':'map','7':'issues','8':'analytics'};
      const route=map[e.key];if(route&&window.state?.me){e.preventDefault();go(route)}
    });
  };
  const activity=()=>{lastActivity=Date.now()};
  const installRefreshHint=()=>{
    clearTimeout(refreshTimer);
    refreshTimer=window.setTimeout(()=>{
      if(document.hidden||!window.state?.me)return installRefreshHint();
      const age=Date.now()-lastActivity;
      if(age>30000&&!document.querySelector('#modal-root .modal')&&!document.querySelector('#st-command-palette')){
        let el=document.getElementById('st-refresh-hint');
        if(!el){el=document.createElement('button');el.id='st-refresh-hint';el.className='live-state';el.type='button';el.onclick=()=>{window.render?.();el.remove()};document.body.appendChild(el)}
        el.textContent=tr('Refresh available','Refresh available');el.title=tr('Refresh the current operational view','Refresh the current operational view');
      }
      installRefreshHint();
    },30000);
  };
  const markDirty=()=>{if(window.state)window.state.editing=true;activity()};
  const decorateTables=()=>{
    document.querySelectorAll('#page table').forEach(table=>{
      table.querySelectorAll('tbody tr').forEach(row=>{
        if(row.dataset.stDecorated==='1')return;
        row.dataset.stDecorated='1';row.tabIndex=0;
        row.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&row.querySelector('button')){e.preventDefault();row.querySelector('button').click()}});
      });
    });
  };
  const announce=()=>{
    if(!window.state?.me)return;
    let live=document.getElementById('st-announcer');
    if(!live){live=document.createElement('div');live.id='st-announcer';live.setAttribute('aria-live','polite');live.setAttribute('aria-atomic','true');live.style.cssText='position:fixed;left:-10000px;width:1px;height:1px;overflow:hidden';document.body.appendChild(live)}
    const page=location.hash.replace(/^#/,'').split('/').pop()||'home';live.textContent=tr(page,page);
  };
  const observer=new MutationObserver(()=>{decorateTables();announce()});
  const boot=()=>{
    if(!document.body)return;
    bindShortcuts();
    document.addEventListener('pointerdown',activity,{passive:true});
    document.addEventListener('keydown',activity,{passive:true});
    document.addEventListener('input',markDirty,{passive:true});
    observer.observe(document.body,{childList:true,subtree:true});
    window.addEventListener('hashchange',()=>{closePalette();setTimeout(announce,0)});
    window.addEventListener('online',()=>toast(tr('Connection restored','Connection restored'),'success'));
    window.addEventListener('offline',()=>toast(tr('Connection lost — changes are paused','Connection lost — changes are paused'),'error'));
    installRefreshHint();decorateTables();announce();
  };
  window.ShineTimeAutomation={openCommandCenter:openPalette,closeCommandCenter:closePalette,go,decorateTables};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
  window.addEventListener('beforeunload',e=>{if(window.state?.editing&&!window.state?.uploading){e.preventDefault();e.returnValue=''}});
  window.addEventListener('hashchange',()=>{if(window.state)window.state.editing=false});
  void state;
})();
