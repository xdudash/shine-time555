let activeRender=null;
const $ = (s,root=document)=>{if(root===document&&activeRender){if(s==='#page')return activeRender.page;const found=activeRender.page.querySelector(s);if(found)return found;}return root.querySelector(s)};
const $$ = (s,root=document)=>{const list=root===document&&activeRender?[...activeRender.page.querySelectorAll(s)]:[];return list.length?list:[...root.querySelectorAll(s)]};
const app = $('#app');
const state = { me:null, settings:null, map:null, csrf:null, locale:ST_I18N.getLocale(), clients:null };
window.ShineTimeApp={getState:()=>state};
const t=(key,fallback)=>ST_I18N.t(key,fallback);
const checklistDrafts=window.ShineTimeChecklistDrafts?.createChecklistDrafts({storage:{getItem:key=>localStorage.getItem(key),setItem:(key,value)=>localStorage.setItem(key,value),removeItem:key=>localStorage.removeItem(key)}});
let checklistSession=0;
const intlLocale=()=>({ru:'ru-RU',sk:'sk-SK',uk:'uk-UA',en:'en-GB'}[ST_I18N.getLocale()]||'ru-RU');
const BASE = (window.ST_BASE || './').replace(/\/?$/, '/');
const apiUrl = path => path.startsWith('/api/') ? BASE + 'api/' + path.slice(5) : path;

const esc = v => String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const money = v => new Intl.NumberFormat(intlLocale(),{style:'currency',currency:'EUR',currencyDisplay:'narrowSymbol',minimumFractionDigits:Number(v||0)%1?2:0,maximumFractionDigits:2}).format(Number(v||0));
const coordinate = (value, axis) => window.ShineTimeUi.parseCoordinate(value, axis);
const coordinatesFrom = form => { const rawLat=String(form.get('lat')||'').trim(); const rawLng=String(form.get('lng')||'').trim(); const lat=coordinate(rawLat,'lat'); const lng=coordinate(rawLng,'lng'); if((rawLat||rawLng)&&(lat===null||lng===null))throw new Error('Enter valid latitude and longitude using a dot or comma'); return {lat,lng}; };
const fmtDate = v => { if(!v)return '—'; try{return new Intl.DateTimeFormat(intlLocale(),{day:'2-digit',month:'short',year:'numeric'}).format(new Date(v+'T12:00:00'))}catch{return v} };
const fmtStamp = v => { if(!v)return '—'; try{return new Intl.DateTimeFormat(intlLocale(),{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(v))}catch{return v} };
const today = () => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Bratislava'}).format(new Date());
const tomorrow = () => { const d=new Date(); d.setDate(d.getDate()+1); return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Bratislava'}).format(d); };

async function api(path,opts={}) {
  if(!window.ShineTimeSupabase?.request)throw new Error('Supabase client did not load. Refresh once or check the uploaded assets.');
  return window.ShineTimeSupabase.request(path,opts);
}
function toast(msg,type=''){const d=document.createElement('div');d.className=`toast ${type}`;d.textContent=msg;$('#toast-root').appendChild(d);setTimeout(()=>d.remove(),3200)}
function closeModal(){ $('#modal-root').innerHTML='';state.editing=false;liveUpdates?.resume(); }
function modal(title,body,foot=''){ $('#modal-root').innerHTML=`<div class="modal-backdrop" onclick="if(event.target===this)closeModal()"><div class="modal"><div class="modal-head"><h3>${title}</h3><button class="close-x" onclick="closeModal()">×</button></div><div class="modal-body">${body}</div>${foot?`<div class="modal-foot">${foot}</div>`:''}</div></div>`; }
window.closeModal=closeModal;
/* In-app dialogs replace native prompt()/confirm(), which are blocked or ugly on mobile PWAs. */
function askDialog({title,message='',label='',value='',required=false,confirmLabel='OK',danger=false,multiline=false,inputType='text',minLength=0}){
  return new Promise(resolve=>{
    const field=label?`<div class="field wide"><label for="ask-input">${esc(t(label,label))}</label>${multiline?`<textarea id="ask-input" class="textarea" rows="3" maxlength="1000">${esc(value)}</textarea>`:`<input id="ask-input" class="input" type="${inputType}" value="${esc(value)}" ${minLength?`minlength="${minLength}"`:''} autocomplete="off">`}<small id="ask-error" class="error-text" role="alert"></small></div>`:'';
    modal(esc(t(title,title)),`${message?`<p>${esc(t(message,message))}</p>`:''}${field}`,`<button class="btn" id="ask-cancel">${esc(t('Cancel','Cancel'))}</button><button class="btn ${danger?'red':'primary'}" id="ask-ok">${esc(t(confirmLabel,confirmLabel))}</button>`);
    let done=false;const finish=v=>{if(done)return;done=true;closeModal();resolve(v)};
    const input=document.getElementById('ask-input');
    const submit=()=>{const v=input?input.value.trim():'';if(input&&required&&!v){document.getElementById('ask-error').textContent=t('This field is required','This field is required');input.focus();return}if(input&&minLength&&v.length<minLength){document.getElementById('ask-error').textContent=t('Too short','Too short')+` (${minLength}+)`;input.focus();return}finish(input?v:true)};
    document.getElementById('ask-ok').onclick=submit;document.getElementById('ask-cancel').onclick=()=>finish(null);
    document.querySelector('#modal-root .close-x')?.addEventListener('click',()=>finish(null));
    document.querySelector('#modal-root .modal-backdrop')?.addEventListener('click',e=>{if(e.target===e.currentTarget)finish(null)});
    input?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!multiline){e.preventDefault();submit()}});
    setTimeout(()=>input?.focus(),30);
  });
}
const askConfirm=(title,message,confirmLabel='Confirm',danger=true)=>askDialog({title,message,confirmLabel,danger});
window.askDialog=askDialog;window.askConfirm=askConfirm;
window.notificationModal=async()=>{try{const d=await api('/api/notifications');modal('Notifications',`<div>${d.notifications.length?d.notifications.map(n=>`<div class="event"><time>${fmtStamp(n.created_at)}</time><div><strong>${esc(n.title)}</strong><br><span class="subtle">${esc(n.message)}</span></div></div>`).join(''):'<div class="empty">No notifications.</div>'}</div>`,`<button class="btn primary" onclick="closeModal()">Close</button>`);if(d.unread)api('/api/notifications/read',{method:'POST',body:{}}).catch(()=>{})}catch(e){toast(e.message,'error')}};


/* Notifications outside the application: Web Push for this browser and email for
   the account. The browser keeps its own subscription, so the card has to read
   the real state of this browser, not just the stored preference. */
const pushSupported=()=>!window.STPreview&&'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
function urlB64ToUint8Array(value){const padded=(value+'='.repeat((4-value.length%4)%4)).replace(/-/g,'+').replace(/_/g,'/');const raw=atob(padded);return Uint8Array.from(Array.from(raw).map(ch=>ch.charCodeAt(0)))}
async function browserSubscription(){ if(!pushSupported())return null; try{const reg=await navigator.serviceWorker.ready;return await reg.pushManager.getSubscription()}catch{return null} }
async function refreshPushState(){ const sub=await browserSubscription(); state.pushEndpoint=sub?sub.endpoint:null; const host=document.querySelector('#notification-card'); if(host)host.outerHTML=notificationCard(); }
window.refreshPushState=refreshPushState;
function notificationCard(){
  const push=state.push||{};
  const browserOn=Boolean(state.pushEndpoint);
  const blocked=pushSupported()&&window.Notification?.permission==='denied';
  const lines=[];
  if(!push.enabled)lines.push(`<p class="subtle">${esc(t('Push notifications are not configured on the server yet.','Push notifications are not configured on the server yet.'))}</p>`);
  else if(!pushSupported())lines.push(`<p class="subtle">${esc(t('This browser cannot show notifications. On iPhone add the application to the home screen first.','This browser cannot show notifications. On iPhone add the application to the home screen first.'))}</p>`);
  else if(blocked)lines.push(`<p class="subtle">${esc(t('Notifications are blocked in the browser settings for this site.','Notifications are blocked in the browser settings for this site.'))}</p>`);
  else if(browserOn)lines.push(`<p class="subtle">${esc(t('This browser receives notifications.','This browser receives notifications.'))}</p><div class="row-actions"><button class="btn sm" onclick="sendTestPush()">${esc(t('Send a test notification','Send a test notification'))}</button><button class="btn sm" onclick="disableBrowserPush()">${esc(t('Turn off on this browser','Turn off on this browser'))}</button></div>`);
  else lines.push(`<button class="btn primary full" onclick="enableBrowserPush()">${esc(t('Turn on notifications in this browser','Turn on notifications in this browser'))}</button>`);
  const toggle=(channel,on,label)=>`<label class="switch-row"><input type="checkbox" ${on?'checked':''} onchange="setNotificationChannel('${channel}',this.checked)"><span>${esc(t(label,label))}</span></label>`;
  return `<div class="job-card" id="notification-card"><strong>${esc(t('Notifications','Notifications'))}</strong>
    ${lines.join('')}
    <div style="margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
      ${toggle('push',state.me?.notify_push!==false,'Send me push notifications')}
      ${toggle('email',state.me?.notify_email!==false,'Send me email notifications')}
      <small class="subtle">${esc(t('Email is used for bookings, rescue, expired cleanings and settlements.','Email is used for bookings, rescue, expired cleanings and settlements.'))}</small>
    </div></div>`;
}
async function enableBrowserPush(){
  try{
    if(!state.push?.enabled)throw new Error(t('Push notifications are not configured on the server yet.','Push notifications are not configured on the server yet.'));
    if(!pushSupported())throw new Error(t('This browser cannot show notifications. On iPhone add the application to the home screen first.','This browser cannot show notifications. On iPhone add the application to the home screen first.'));
    const permission=await Notification.requestPermission();
    if(permission!=='granted')throw new Error(t('Notifications are blocked in the browser settings for this site.','Notifications are blocked in the browser settings for this site.'));
    const reg=await navigator.serviceWorker.ready;
    const subscription=await reg.pushManager.getSubscription()||await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:urlB64ToUint8Array(state.push.publicKey)});
    const keys=subscription.toJSON().keys||{};
    await api('/api/account/push',{method:'POST',body:{endpoint:subscription.endpoint,p256dh:keys.p256dh,auth:keys.auth,userAgent:navigator.userAgent}});
    if(state.me&&state.me.notify_push===false){await api('/api/account/notifications',{method:'PATCH',body:{push:true}});state.me.notify_push=true}
    state.pushEndpoint=subscription.endpoint;
    toast(t('Notifications on','Notifications on'),'success');
    await refreshPushState();
  }catch(e){toast(e.message,'error')}
}
async function disableBrowserPush(){
  try{
    const subscription=await browserSubscription();
    if(subscription){await api('/api/account/push',{method:'DELETE',body:{endpoint:subscription.endpoint}});await subscription.unsubscribe().catch(()=>{})}
    state.pushEndpoint=null;
    toast(t('Notifications off for this browser','Notifications off for this browser'),'success');
    await refreshPushState();
  }catch(e){toast(e.message,'error')}
}
async function sendTestPush(){ try{const r=await api('/api/account/push/test',{method:'POST',body:{}});toast(t('Test notification sent','Test notification sent')+` (${r.browsers})`,'success')}catch(e){toast(e.message,'error')} }
async function setNotificationChannel(channel,on){
  try{
    const saved=await api('/api/account/notifications',{method:'PATCH',body:{[channel]:Boolean(on)}});
    if(state.me){state.me.notify_push=saved.push;state.me.notify_email=saved.email}
    toast(t('Saved','Saved'),'success');
    await refreshPushState();
  }catch(e){toast(e.message,'error');await refreshPushState()}
}
window.enableBrowserPush=enableBrowserPush;window.disableBrowserPush=disableBrowserPush;window.sendTestPush=sendTestPush;window.setNotificationChannel=setNotificationChannel;window.notificationCard=notificationCard;
/* A tap on a delivered notification focuses the window: show what it was about. */
navigator.serviceWorker?.addEventListener?.('message',event=>{
  if(event.data?.type!=='NOTIFICATION_CLICK')return;
  liveUpdates?.invalidate();
  if(state.me)notificationModal();
});

/* What the client said about a finished cleaning, shown to operations in the
   job modal. The cleaner never sees these words, only the rating. */
function clientFeedbackNote(feedback){
 if(!feedback)return '';
 const colour=Number(feedback.rating)>=4?'green':Number(feedback.rating)>=3?'orange':'red';
 return `<div class="feedback-note"><strong>${t('Client rating','Client rating')}: <span class="pill ${colour}">★ ${feedback.rating}/5</span></strong>${feedback.complaint?` <span class="pill red">${t('Complaint','Complaint')}</span>`:''}${feedback.comment?`<p>${esc(feedback.comment)}</p>`:''}<small class="subtle">${fmtStamp(feedback.updated_at||feedback.created_at)}</small></div>`;
}
window.clientFeedbackNote=clientFeedbackNote;
function statusPill(s){const map={COMPLETED:'green',CLEANING:'blue',ARRIVED:'blue',EN_ROUTE:'blue',ACCEPTED:'violet',UNASSIGNED:'orange',OFFERED:'orange',AT_RISK:'red',RESCUE:'red',CANCELLED:'gray',EXPIRED:'gray'};const label=(s||'UNKNOWN').replaceAll('_',' ');return `<span class="pill ${map[s]||'gray'}"><span class="dot"></span>${esc(t(label,label))}</span>`}
function riskPill(level,score){const c=level==='RED'?'red':level==='ORANGE'?'orange':'green';return `<span class="pill ${c}">${esc(t(level||'GREEN',level||'GREEN'))} ${score??0}</span>`}
function shellTitle(title,subtitle=''){ document.title=`${title} · ${state.settings?.companyName||'Shine Time'}`; $('.page-title h1')?.replaceChildren(document.createTextNode(title)); $('.page-title p')?.replaceChildren(document.createTextNode(subtitle)); }
function initials(name='User'){return name.split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase()}
function route(){const fallback=['ADMIN','OPERATIONS_MANAGER'].includes(state.me?.role)?'admin/today':state.me?.role==='CLEANER'?'cleaner/home':'client/home';return location.hash.replace(/^#/,'')||fallback}
function navTo(r){location.hash=r}
window.navTo=navTo;
function closeAdminMenu(){
  const shell=document.querySelector('.app-shell');
  if(!shell)return;
  shell.classList.remove('menu-open');
  const trigger=shell.querySelector('.mobile-menu-trigger');
  trigger?.setAttribute('aria-expanded','false');
}
function toggleAdminMenu(){
  const shell=document.querySelector('.app-shell');
  if(!shell)return;
  const open=shell.classList.toggle('menu-open');
  shell.querySelector('.mobile-menu-trigger')?.setAttribute('aria-expanded',String(open));
  if(open)shell.querySelector('.sidebar .nav button.active')?.focus();
}
window.toggleAdminMenu=toggleAdminMenu;
window.closeAdminMenu=closeAdminMenu;
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeAdminMenu()});

let stopLiveUpdates=null,liveUpdates=null,connectionState='connecting',refreshInterval=null,recoverySubscription=null;
function liveBusy(){return !!(state.editing||state.uploading||document.querySelector('#modal-root .modal')||document.hidden)}
function showLiveStatus(){
  let el=document.getElementById('live-state');
  if(!el){el=document.createElement('button');el.id='live-state';el.className='live-state';el.type='button';el.onclick=()=>{if(!liveBusy())liveUpdates?.invalidate();};document.body.appendChild(el);}
  el.hidden=!state.me;
  if(window.STPreview){el.dataset.status='demo';el.textContent='Demo · synthetic data';return;}
  const pending=liveUpdates?.pending;
  el.dataset.status=navigator.onLine?connectionState:'offline';
  el.textContent=!navigator.onLine?t('Offline — changes need a connection','Offline — changes need a connection'):pending&&liveBusy()?t('Updates ready · finish editing','Updates ready · finish editing'):connectionState==='live'?t('Live','Live'):t('Reconnecting…','Reconnecting…');
}
function startLiveUpdates(){
  stopLiveUpdates?.();liveUpdates?.stop();clearInterval(refreshInterval);
  liveUpdates=window.ShineTimeLive.createLiveUpdates({isBusy:liveBusy,refresh:()=>state.me&&render({background:true}),onPending:showLiveStatus,onError:()=>{connectionState='reconnecting';showLiveStatus();}});
  stopLiveUpdates=window.ShineTimeSupabase?.subscribeJobs?.(()=>liveUpdates.invalidate(),status=>{connectionState=status==='SUBSCRIBED'?'live':'reconnecting';showLiveStatus();if(status==='SUBSCRIBED')liveUpdates.invalidate();});
  // Bounded reconciliation covers changes made while disconnected and other entities.
  refreshInterval=setInterval(()=>{if(state.me&&!document.hidden)liveUpdates.invalidate()},60000);
  showLiveStatus();
}
window.addEventListener('online',()=>{connectionState='connecting';showLiveStatus();liveUpdates?.invalidate()});
window.addEventListener('offline',showLiveStatus);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)liveUpdates?.invalidate()});
document.addEventListener('input',event=>{if(event.target.matches('input:not([type=date]):not([type=month]):not([type=checkbox]),textarea')){state.editing=true;showLiveStatus();}});
async function bootstrap(){
  recoverySubscription?.unsubscribe();
  recoverySubscription=window.ShineTimeSupabase?.onRecovery?.(()=>recoveryModal());
  try{const data=await api('/api/me');if(!releaseCompatible(data))return;state.me=data.user;state.settings=data.settings;state.push=data.push||{enabled:false,publicKey:''};state.csrf=data.csrf||state.csrf;state.locale=ST_I18N.setLocale(data.user.language||state.locale);startLiveUpdates();ensureRoute();render();}
  catch{renderLogin()}
  if(!window.STPreview&&'serviceWorker' in navigator) navigator.serviceWorker.register(BASE+'sw.js').then(()=>refreshPushState()).catch(()=>{});
}
function releaseCompatible(data){
  const expected=window.ST_SUPABASE?.apiBuild||window.ST_BUILD;
  if(!expected||data?.apiVersion===expected)return true;
  state.me=null;state.csrf=null;
  app.innerHTML=`<div class="login-page"><section class="login-box-wrap"><div class="login-box"><div class="brand-mark">ST</div><h2>Update in progress</h2><p class="subtle">The browser build and the server build do not match yet. Upload the complete release and refresh this page after the Edge Function is deployed.</p><p class="subtle">Browser: ${esc(window.ST_BUILD)} · API: ${esc(data?.apiVersion||'not reported')}</p><button class="btn primary full" onclick="location.reload()">Refresh</button></div></section></div>`;
  return false;
}
function ensureRoute(){const r=route();if(['ADMIN','OPERATIONS_MANAGER'].includes(state.me?.role)&&!r.startsWith('admin/'))location.hash='admin/today';if(state.me?.role==='CLEANER'&&!r.startsWith('cleaner/'))location.hash='cleaner/home';if(['OWNER','PROPERTY_MANAGER'].includes(state.me?.role)&&!r.startsWith('client/'))location.hash='client/home'}

function renderLogin(){
  state.me=null;state.csrf=null;
  app.innerHTML=`<div class="login-page"><section class="login-hero"><div><div class="brand-mark">ST</div><h1>Your team. Every job. In sync.</h1><p>A dispatch platform for short-term rental cleaning. Cleaner freedom on the front end, operational control and rescue capacity behind it.</p><div class="login-stats"><div class="login-stat"><strong>24/7</strong><span>individual service windows</span></div><div class="login-stat"><strong>Live</strong><span>risk & rescue board</span></div><div class="login-stat"><strong>Proof</strong><span>checklists + photos</span></div></div></div><small>Shine Time Operations · Bratislava</small></section><section class="login-box-wrap"><div class="login-box"><div style="display:flex;justify-content:space-between;align-items:center;gap:12px"><div class="brand-mark">ST</div>${ST_I18N.selector(true)}</div><h2 style="margin-top:18px">Sign in</h2><p class="subtle">Use your operations or cleaner account.</p><form id="login-form"><div class="field"><label>Email</label><input class="input" name="email" type="email" autocomplete="username" required></div><div class="field"><label>Password</label><input class="input" name="password" type="password" autocomplete="current-password" required></div><button class="btn primary full">Sign in</button></form><button class="btn ghost full" type="button" onclick="forgotPassword()" style="margin-top:12px">Forgot password?</button><div class="demo-accounts"><span class="subtle">Use the account created during installation or credentials provided by Operations.</span></div></div></section></div>`;
  $('#login-form').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.currentTarget);try{const data=await api('/api/login',{method:'POST',body:{email:f.get('email'),password:f.get('password')}});state.me=data.user;state.csrf=data.csrf||null;state.locale=ST_I18N.setLocale(data.user.language||state.locale);const me=await api('/api/me');if(!releaseCompatible(me))return;state.settings=me.settings;state.csrf=me.csrf||state.csrf;startLiveUpdates();location.hash=['ADMIN','OPERATIONS_MANAGER'].includes(state.me.role)?'admin/today':state.me.role==='CLEANER'?'cleaner/home':'client/home';render()}catch(err){toast(err.message,'error')}};
}
window.fillLogin=(email,password)=>{const f=$('#login-form');f.email.value=email;f.password.value=password};
async function logout(){
  try{await api('/api/logout',{method:'POST'})}catch(e){toast(e.message,'error');return;}
  checklistSession++;
  try{if(state.me)checklistDrafts?.clearUser(state.me.id)}catch{try{localStorage.removeItem(window.ShineTimeChecklistDrafts.CHECKLIST_DRAFT_KEY)}catch{}}
  state.activeChecklist=null;state.board=null;state.boardJobs=null;
  stopLiveUpdates?.();liveUpdates?.stop();clearInterval(refreshInterval);stopLiveUpdates=null;
  state.me=null;state.csrf=null;state.editing=false;state.clients=null;state.cleaners=null;
  navigator.serviceWorker?.controller?.postMessage({type:'CLEAR_PRIVATE_DATA'});
  closeModal();location.hash='';renderLogin();showLiveStatus();
}window.logout=logout;
window.setAppLanguage=async locale=>{state.locale=ST_I18N.setLocale(locale);lastShellRole=null;if(state.me){state.me.language=state.locale;try{await api('/api/account/language',{method:'PATCH',body:{language:state.locale}})}catch(e){toast(e.message,'error')}}state.me?render():renderLogin()};

/* Fix 21: the nine approved sections. The screens behind them are unchanged;
   what used to be sixteen menu entries with three separate finance pages is now
   nine sections, several of which carry sub-tabs. Old page names still route
   (ShineTimeUi.adminSectionFor), so bookmarks keep working. */
const adminNav=[['today','⌁','Today'],['cleanings','☷','Cleanings'],['review','✔','Review'],['objects','▣','Objects'],['clients','♧','Clients'],['team','♙','Team'],['finance','€','Finance'],['analytics','▥','Analytics'],['settings','⚙','Settings']];
const ADMIN_SECTION_TABS={
 today:[['board','Dispatch','live'],['map','Map','map'],['tomorrow','Tomorrow','tomorrow'],['monitoring','Monitoring','monitoring']],
 cleanings:[['all','All cleanings','jobs'],['recurring','Repeating','schedule']],
 review:[['queue','Awaiting review','review'],['issues','Issues and complaints','issues']],
 finance:[['overview','Overview','owner'],['statements','Statements','statements'],['settlements','Payments and payouts','settlements'],['entries','Records','finance']],
};
const adminSectionTab=(section,tab)=>{
 const tabs=ADMIN_SECTION_TABS[section];
 if(!tabs)return null;
 return tabs.find(([key])=>key===tab)||tabs[0];
};
function adminTabBar(section,current){
 const tabs=ADMIN_SECTION_TABS[section];
 if(!tabs)return '';
 const allowed=tabs.filter(([,,page])=>window.ShineTimeUi.adminRouteAllowed(page,state.me.role));
 if(allowed.length<2)return '';
 return `<div class="section-tabs" role="tablist">${allowed.map(([key,label])=>`<button role="tab" class="btn sm ${key===current?'primary':''}" aria-selected="${key===current}" onclick="navTo('admin/${section}/${key}')">${esc(t(label,label))}</button>`).join('')}</div>`;
}
const cleanerNav=[['home','⌂','Home'],['jobs','☷','Jobs'],['myday','◷','My Day'],['earnings','€','Earnings'],['profile','○','Profile']];
const clientNav=[['home','⌂','Home'],['book','＋','Book Cleaning'],['recurring','↻','Repeat'],['objects','▣','Objects'],['bookings','◷','Bookings'],['finance','€','Finance'],['profile','○','Profile']];
function renderAdminShell(){const current=route().split('/')[1];app.innerHTML=`<div class="app-shell"><div class="mobile-menu-backdrop" onclick="closeAdminMenu()"></div><aside id="admin-sidebar" class="sidebar" aria-label="Operations navigation"><div class="side-brand"><div class="brand-mark">ST</div><div><strong>${esc(String(state.settings?.companyName||'Shine Time'))}</strong><small>${esc(t('Operations','Operations'))}</small></div><button class="mobile-menu-close" aria-label="Close menu" onclick="closeAdminMenu()">×</button></div><nav class="nav">${window.ShineTimeUi.adminNavigationForRole(adminNav,state.me.role).map(([r,i,l])=>`<button data-route="admin/${r}" class="${current===r?'active':''}" onclick="navTo('admin/${r}');closeAdminMenu()"><span class="nav-icon">${i}</span><span class="nav-label">${l}</span></button>`).join('')}</nav><div class="side-footer"><div class="profile-mini"><div class="avatar">${initials(state.me.full_name)}</div><div><strong>${esc(state.me.full_name)}</strong><small>${state.me.role==='OPERATIONS_MANAGER'?'Operations manager':'Administrator'}</small></div></div>${ST_I18N.selector()}<button class="btn ghost sm full" style="color:#d7deea;border-color:#384458;margin-top:6px" onclick="logout()">Sign out</button></div></aside><main class="main"><header class="topbar"><button class="mobile-menu-trigger" aria-label="Open menu" aria-controls="admin-sidebar" aria-expanded="false" onclick="toggleAdminMenu()">☰</button><div class="page-title"><h1>Operations</h1><p>Loading…</p></div><div class="top-actions"><button class="btn sm" aria-label="Notifications" onclick="notificationModal()">🔔</button><span class="pill green"><span class="dot"></span>Bratislava</span><button class="btn sm" aria-label="Refresh" onclick="render()"><span aria-hidden="true">↻</span><span class="refresh-label">Refresh</span></button></div></header><div id="page" class="content"></div></main></div>`}
function renderCleanerShell(){const current=route().split('/')[1];app.innerHTML=`<div class="cleaner-shell"><header class="cleaner-top"><div class="row"><div><h1>${esc(state.me.full_name)}</h1><small>Shine Time Cleaner</small></div><div style="display:flex;gap:8px;align-items:center">${ST_I18N.selector(true)}<button class="btn sm" onclick="notificationModal()">🔔</button><button id="online-toggle" class="online-toggle">Loading…</button></div></div></header><main id="page" class="cleaner-content"></main><nav class="bottom-nav">${cleanerNav.map(([r,i,l])=>`<button data-route="cleaner/${r}" class="${current===r?'active':''}" onclick="navTo('cleaner/${r}')"><span>${i}</span>${l}</button>`).join('')}</nav></div>`}
function renderClientShell(){
  const current=(route().split('/')[1]||'home').split('?')[0];
  const navigation=clientNav;
  const navClass=' owner-client-nav';
  const nav=navigation.map(([name,icon,label])=>'<button data-route="client/'+name+'" class="'+(current===name?'active':'')+'" onclick="navTo(&quot;client/'+name+'&quot;)"><span>'+icon+'</span>'+label+'</button>').join('');
  app.innerHTML='<div class="cleaner-shell client-shell'+(state.me.role==='PROPERTY_MANAGER'?' manager-client':'')+'"><header class="cleaner-top client-top"><div class="row"><div><h1>'+esc(state.me.company_name||state.me.full_name)+'</h1><small>'+(state.me.role==='PROPERTY_MANAGER'?'Property manager':'Owner')+' · Shine Time</small></div><div style="display:flex;gap:8px;align-items:center">'+ST_I18N.selector(true)+'<button class="btn sm" onclick="notificationModal()">🔔</button></div></div></header><main id="page" class="cleaner-content client-content"></main><nav class="bottom-nav client-nav'+navClass+'">'+nav+'</nav></div>';
}
let renderRunning=false,queuedRender=null,lastShellRole=null,lastRoute=null;
async function render(options={}){
  const wanted={route:route(),background:!!options.background};
  if(wanted.background&&liveBusy())return;
  queuedRender=wanted;
  if(renderRunning)return;
  renderRunning=true;
  try{
    while(queuedRender){
      const task=queuedRender;queuedRender=null;
      if(!state.me){renderLogin();break;}
      ensureRoute();const r=route();
      if(task.background&&liveBusy())continue;
      const role=state.me.role;
      if(!task.background){state.editing=false;}
      if(lastShellRole!==role||!document.querySelector('#page')){
        if(['ADMIN','OPERATIONS_MANAGER'].includes(role))renderAdminShell();
        else if(role==='CLEANER')renderCleanerShell();else renderClientShell();
        lastShellRole=role;
      }
      const currentPage=document.querySelector('#page');
      const staging=currentPage.cloneNode(false);
      if(state.map){try{state.map.remove()}catch{}state.map=null;}
      activeRender={route:r,page:staging};
      try{
        if(['ADMIN','OPERATIONS_MANAGER'].includes(role))await renderAdmin(r.split('/')[1]||'today',(r.split('/')[2]||'').split('?')[0]);
        else if(role==='CLEANER'){
          if(r.startsWith('cleaner/job/'))await cleanerJobDetail(Number(r.split('/')[2]));
          else await renderCleaner(r.split('/')[1]||'home');
        }else if(r.startsWith('client/booking/'))await clientBookingDetail(Number((r.split('/')[2]||'').split('?')[0]));
        else await renderClient((r.split('/')[1]||'home').split('?')[0]);
        if(route()===r&&state.me?.role===role&&!(task.background&&liveBusy())){
          currentPage.replaceWith(staging);
          const cleanerTop=document.querySelector('.cleaner-top');if(cleanerTop)cleanerTop.style.display=r.startsWith('cleaner/job/')?'none':'';
          document.querySelectorAll('.nav button,.bottom-nav button').forEach(button=>{const active=button.dataset.route===window.ShineTimeUi.navigationRoute(r);button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
          if(lastRoute!==r)window.scrollTo(0,0);lastRoute=r;
          state.map?.invalidateSize?.();
          window.dispatchEvent(new CustomEvent('shine:rendered',{detail:{route:r,role,background:task.background}}));
        }
      }catch(error){
        if(route()===r&&state.me?.role===role){
          if(task.background)toast(error.message||'Unable to load','error');
          else{
            staging.innerHTML=`<div class="card pad" role="alert"><h2>${t('Unable to load','Unable to load')}</h2><p>${esc(error.message||'Unable to load')}</p><button class="btn primary" onclick="render()">${t('Retry','Retry')}</button></div>`;
            currentPage.replaceWith(staging);
          }
        }
      }
      finally{activeRender=null;}
      if(route()!==r)queuedRender={route:route(),background:false};
      showLiveStatus();
    }
  }finally{renderRunning=false;activeRender=null;}
}
window.addEventListener('hashchange',()=>{closeAdminMenu();closeModal();state.editing=false;if(state.me)render();});

/* Sections resolve to the page renderers below, which the extensions wrap. */
async function renderAdmin(section,tab){
 const key=String(section||'today');
 const direct=window.ShineTimeUi.adminSectionFor(key)===key?key:null;
 const chosen=adminSectionTab(key,String(tab||''));
 if(chosen){
  const page=window.ShineTimeUi.adminRouteAllowed(chosen[2],state.me.role)?chosen[2]:ADMIN_SECTION_TABS[key].find(([,,p])=>window.ShineTimeUi.adminRouteAllowed(p,state.me.role))?.[2];
  if(!page){navTo('admin/today');return renderAdminPage('live')}
  state.adminSection={section:key,tab:chosen[0]};
  await renderAdminPage(page);
  const host=activeRender?.page||document.querySelector('#page');
  const bar=adminTabBar(key,chosen[0]);
  if(bar&&host)host.insertAdjacentHTML('afterbegin',bar);
  return;
 }
 state.adminSection={section:direct||key,tab:''};
 return renderAdminPage(key);
}
async function renderAdminPage(page){if(!window.ShineTimeUi.adminRouteAllowed(page,state.me.role)){navTo('admin/today');return adminLive()}if(page==='owner')return adminOwnerBoard();if(page==='live')return adminLive();if(page==='map')return adminMap();if(page==='tomorrow')return adminTomorrow();if(page==='jobs')return adminJobs();if(page==='objects')return adminObjects();if(page==='clients')return adminClients();if(page==='cleaners'||page==='team')return adminCleaners();if(page==='finance')return adminFinance(state.financeMonth);if(page==='issues')return adminIssues();if(page==='review')return adminReviewQueue();if(page==='analytics')return adminAnalytics();if(page==='settings')return adminSettings();return adminLive()}

async function adminOwnerBoard(){shellTitle('Owner board','Portfolio, delivery quality, capacity and contribution profit');const month=new Date().toISOString().slice(0,7);const [live,capacityData,analytics,finance]=await Promise.all([api('/api/admin/dashboard'),api(`/api/admin/capacity?date=${today()}`),api(`/api/admin/analytics?from=${month}-01&to=${today()}`),api(`/api/admin/finance?month=${month}${state.financeCursor?`&before=${state.financeCursor}`:''}`)]);const f=finance.summary;$('#page').innerHTML=`<div class="section-head"><div><h2>Company control room</h2><p>Every card opens the operational board where it can be acted on.</p></div><button class="btn primary" onclick="navTo('admin/live')">Open live dispatch</button></div><div class="grid kpis" style="grid-template-columns:repeat(4,1fr)"><button class="card kpi" onclick="navTo('admin/live')"><div class="label">Today jobs</div><div class="value">${live.kpis.total}</div><div class="hint">${live.kpis.completed} complete · ${live.kpis.unassigned} unassigned</div></button><button class="card kpi ${live.kpis.rescue?'danger':''}" onclick="navTo('admin/jobs')"><div class="label">Rescue / SLA risk</div><div class="value">${live.kpis.rescue+live.kpis.atRisk}</div><div class="hint">Projected SLA ${live.sla.projectedReadyPct}%</div></button><button class="card kpi" onclick="navTo('admin/tomorrow')"><div class="label">Available capacity</div><div class="value">${capacityData.capacity.freeMinutes||0}m</div><div class="hint">Reserve ${capacityData.capacity.reservePct||0}%</div></button><button class="card kpi ${f.profit<0?'danger':''}" onclick="navTo('admin/finance')"><div class="label">Month contribution</div><div class="value small-money ${f.profit>=0?'profit-pos':'profit-neg'}">${money(f.profit)}</div><div class="hint">${f.marginPct}% margin · ${money(f.totalRevenue)} revenue</div></button></div><div style="height:14px"></div><div class="two-col"><div class="card pad"><div class="section-head compact"><div><h2>Quality & team</h2><p>Operational performance for the current month</p></div><button class="btn sm" onclick="navTo('admin/analytics')">Details</button></div><div class="detail-grid"><div class="detail-item"><div class="k">Completed</div><div class="v">${analytics.summary.completed}/${analytics.summary.jobs}</div></div><div class="detail-item"><div class="k">On time</div><div class="v">${analytics.summary.onTimePct}%</div></div><div class="detail-item"><div class="k">Issues</div><div class="v">${analytics.summary.issues}</div></div><div class="detail-item"><div class="k">Rescues</div><div class="v">${analytics.summary.rescue}</div></div></div></div><div class="card pad"><div class="section-head compact"><div><h2>Portfolio finance</h2><p>Revenue, costs and profitability by client/object</p></div><button class="btn sm" onclick="navTo('admin/finance')">Open finance</button></div><div class="detail-grid"><div class="detail-item"><div class="k">Revenue</div><div class="v">${money(f.totalRevenue)}</div></div><div class="detail-item"><div class="k">Costs</div><div class="v">${money(f.totalExpenses)}</div></div><div class="detail-item"><div class="k">Outstanding control</div><div class="v">${live.kpis.unassigned}</div></div><div class="detail-item"><div class="k">Objects / clients</div><div class="v">${finance.byObject.length} / ${finance.byClient.length}</div></div></div></div></div>`}

async function adminLive(){return adminJobs(true)}
function timelineHtml(jobs){const start=600,end=900,span=end-start;return `<div class="timeline"><div class="time-axis"><span>10:00</span><span>11:00</span><span>12:00</span><span>13:00</span><span>14:00</span><span>15:00</span></div>${jobs.map(j=>{const tm=t=>{const [h,m]=(t||'10:00').split(':').map(Number);return h*60+m};const s=Math.max(start,tm(j.planned_start||'10:00'));const e=Math.min(end,tm(j.eta||j.deadline||'15:00'));const left=Math.max(0,(s-start)/span*100),width=Math.max(1,(e-s)/span*100);return `<div class="timeline-row"><div class="timeline-label">${esc(j.object_code)}</div><div class="timeline-track"><div title="${esc(j.status)} ${esc(j.planned_start||'')}–${esc(j.eta||'')}" class="timeline-block ${j.status}" style="left:${left}%;width:${width}%"></div></div></div>`}).join('')}</div>`}

function qualityReviewEnabled(){return window.ST_SUPABASE?.capabilities?.qualityReview!==false}
function canSettleJob(job){return !!job&&(job.review_status==='APPROVED'||(!qualityReviewEnabled()&&!job.review_status))}
const boardLabels={all:'All jobs',unassigned:'Unassigned',assigned:'Assigned',active:'In progress',atRisk:'At risk',review:'Awaiting review',completed:'Approved',cancelled:'Cancelled'};
function reviewPill(job){
  const labels={PENDING:['orange','Awaiting review'],APPROVED:['green','Report approved'],REWORK_REQUIRED:['red','Rework required']};
  const item=labels[job?.review_status];
  return item?`<span class="pill ${item[0]}" data-review-status="${esc(job.review_status)}">${esc(t(item[1],item[1]))}</span>`:'';
}
function deliveryPill(job){return reviewPill(job)||statusPill(job.status)}
async function adminJobs(live=false){
  state.board ||= {date:today(),query:'',bucket:'all',zone:'',cleanerId:''};
  const f=state.board;
  shellTitle(live?'Live Operations':'Jobs',t('Dispatch, delivery and quality in one place','Dispatch, delivery and quality in one place'));
  const d=await api(`/api/admin/jobs?date=${encodeURIComponent(f.date)}`);
  state.boardJobs=d.jobs;
  const board=window.ShineTimeBoard.deriveBoard(d.jobs,f);
  const p=$('#page');
  p.innerHTML=`<section class="operations-workspace"><div class="section-head"><div><div class="eyebrow">SHINE TIME / ${esc(t('Operations','Operations'))}</div><h2>${esc(t('Daily operations','Daily operations'))}</h2><p>${esc(fmtDate(f.date))} · ${d.jobs.length} ${esc(t('Jobs','Jobs'))}</p></div><div class="board-create"><button class="btn" onclick="generateJobsModal()">${t('Generate','Generate')}</button><button class="btn primary" onclick="createJobModal()">${t('+ New job','+ New job')}</button></div></div>
  <div class="board-summary"><div><strong data-board-count="active">${board.counts.active}</strong><span>${t('In progress','In progress')}</span></div><div><strong data-board-count="atRisk">${board.counts.atRisk}</strong><span>${t('At risk','At risk')}</span></div>${qualityReviewEnabled()?`<div><strong data-board-count="review">${board.counts.review}</strong><span>${t('Awaiting review','Awaiting review')}</span></div>`:''}<div><strong data-board-count="completed">${board.counts.completed}</strong><span>${t(qualityReviewEnabled()?'Approved':'Completed',qualityReviewEnabled()?'Approved':'Completed')}</span></div></div>
  <div class="board-filters"><label><span>${t('Service date','Service date')}</span><input id="job-date" class="input" type="date" value="${esc(f.date)}"></label><label class="board-search"><span>${t('Search','Search')}</span><input id="job-search" class="input" value="${esc(f.query)}" placeholder="${t('Search object / cleaner / area','Search object / cleaner / area')}"></label><label><span>${t('Zones','Zones')}</span><select id="board-zone" class="select"><option value="">${t('All areas','All areas')}</option>${board.zones.map(z=>`<option value="${esc(z)}" ${z===f.zone?'selected':''}>${esc(z)}</option>`).join('')}</select></label><label><span>${t('Cleaner','Cleaner')}</span><select id="board-cleaner" class="select"><option value="">${t('All cleaners','All cleaners')}</option>${board.cleaners.map(c=>`<option value="${esc(c.id)}" ${String(c.id)===String(f.cleanerId)?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label></div>
  <div id="board-buckets" class="board-buckets" aria-label="${t('Job queues','Job queues')}"></div><div id="jobs-table"></div><p class="board-footnote">${qualityReviewEnabled()?t('Counts cover the selected day and filters. Reports await manager approval.','Counts cover the selected day and filters. Reports await manager approval.'):t('Counts cover the selected day and filters.','Counts cover the selected day and filters.')}</p></section>`;
  $('#job-search').oninput=e=>{f.query=e.target.value;state.editing=false;paintOperationsBoard()};
  $('#board-zone').onchange=e=>{f.zone=e.target.value;paintOperationsBoard()};
  $('#board-cleaner').onchange=e=>{f.cleanerId=e.target.value;paintOperationsBoard()};
  $('#job-date').onchange=e=>{if(e.target.value){f.date=e.target.value;state.editing=false;render()}};
  paintOperationsBoard();
}
function paintOperationsBoard(){
  const d=window.ShineTimeBoard.deriveBoard(state.boardJobs||[],state.board);
  $$('[data-board-count]').forEach(el=>el.textContent=String(d.counts[el.dataset.boardCount]));
  $('#board-buckets').innerHTML=Object.entries(boardLabels).filter(([key])=>qualityReviewEnabled()||key!=='review').map(([key,originalLabel])=>{const label=key==='completed'&&!qualityReviewEnabled()?'Completed':originalLabel;return `<button type="button" data-board-bucket="${key}" aria-pressed="${state.board.bucket===key}" onclick="selectBoardBucket('${key}')"><span>${esc(t(label,label))}</span><strong>${d.counts[key]}</strong></button>`}).join('');
  $('#jobs-table').innerHTML=jobsTable(d.jobs);
}
window.selectBoardBucket=key=>{if(!Object.hasOwn(boardLabels,key))return;state.board.bucket=key;paintOperationsBoard()};
function mobileJobCards(jobs){return `<div class="admin-mobile-jobs" aria-label="Cleaning jobs">${jobs.map(j=>`<article class="admin-mobile-job"><div class="admin-mobile-job-head"><div><small>${esc(j.object_code)}</small><strong>${esc(j.object_name||j.zone||'Cleaning')}</strong></div>${riskPill(j.risk_level,j.risk_score)}</div><p>${esc(j.address||j.zone||'')}</p><div class="admin-mobile-job-meta"><span>${deliveryPill(j)}</span><span>${esc(j.planned_start||'—')} → ${esc(j.eta||j.deadline||'—')}</span></div><div class="admin-mobile-job-foot"><span>${esc(j.cleaner_name||'Unassigned')} · ${money(Number(j.payout||0)+Number(j.bonus||0))}</span><button class="btn primary sm" onclick="openAdminJob(${Number(j.id)})">Open job</button></div></article>`).join('')||'<div class="card pad empty">No jobs for this selection.</div>'}</div>`}
function jobsTable(jobs){return `<div class="card admin-job-table"><div class="table-wrap"><table><thead><tr><th>Object</th><th>Address / zone</th><th>Cleaner</th><th>Status</th><th>Risk</th><th>Plan / ETA</th><th>Amount</th><th></th></tr></thead><tbody>${jobs.map(j=>`<tr><td><strong>${esc(j.object_code)}</strong><br><span class="subtle">${esc(j.apartment_type)}</span></td><td>${esc(j.address)}<br><span class="subtle">${esc(j.zone)}</span></td><td>${esc(j.cleaner_name||'Unassigned')}</td><td>${deliveryPill(j)}</td><td>${riskPill(j.risk_level,j.risk_score)}</td><td class="mono">${esc(j.planned_start||'—')} → ${esc(j.eta||'—')}</td><td>${money(Number(j.payout)+Number(j.bonus))}</td><td><button class="btn sm" onclick="openAdminJob(${j.id})">Open</button></td></tr>`).join('')||'<tr><td colspan="8"><div class="empty">No jobs.</div></td></tr>'}</tbody></table></div></div>${mobileJobCards(jobs)}`}
window.loadAdminJobsFilters=()=>render();
function filterVisibleRows(sel,q){q=q.toLowerCase();$$('tbody tr',$(sel)).forEach(r=>r.style.display=r.textContent.toLowerCase().includes(q)?'':'none');$$('.admin-mobile-job',$(sel)).forEach(card=>card.style.display=card.textContent.toLowerCase().includes(q)?'':'none')}

/* Admin job creation: the same fields the server accepts, prefilled from the
   property, validated by the same rule (start + duration must fit the window). */
async function createJobModal(){
 try{
  const o=await api('/api/admin/objects');
  const objects=o.objects.filter(x=>x.active&&x.approval_status==='APPROVED');
  if(!objects.length){toast(t('No approved property to book','No approved property to book'),'error');return}
  state.jobCreateObjects=objects;
  const finance=state.me?.role==='ADMIN';
  modal(esc(t('Create cleaning','Create cleaning')),`<form id="job-create" class="form-grid">
   <div class="field wide"><label for="jc-object">${esc(t('Property','Property'))}</label><select class="select" id="jc-object" name="objectId" onchange="prefillJobCreate()">${objects.map(x=>`<option value="${x.id}">${esc(x.code)} — ${esc(x.name)}</option>`).join('')}</select></div>
   <div class="field"><label for="jc-date">${esc(t('Service date','Service date'))}</label><input class="input" id="jc-date" name="serviceDate" type="date" min="${today()}" value="${tomorrow()}" required></div>
   <div class="field"><label for="jc-duration">${esc(t('Duration (min)','Duration (min)'))}</label><input class="input" id="jc-duration" name="durationMinutes" type="number" min="15" max="1440" step="15" oninput="checkJobCreateWindow()"></div>
   <div class="field"><label for="jc-from">${esc(t('Not before','Not before'))}</label><input class="input" id="jc-from" name="earliestStart" type="time" step="900" oninput="checkJobCreateWindow()"></div>
   <div class="field"><label for="jc-to">${esc(t('Ready by','Ready by'))}</label><input class="input" id="jc-to" name="deadline" type="time" step="900" oninput="checkJobCreateWindow()"></div>
   ${finance?`<div class="field"><label for="jc-payout">${esc(t('Cleaner payout (€)','Cleaner payout (€)'))}</label><input class="input" id="jc-payout" name="payout" type="number" min="0" step="0.5"></div>
   <div class="field"><label for="jc-price">${esc(t('Client price (€)','Client price (€)'))}</label><input class="input" id="jc-price" name="clientPrice" type="number" min="0" step="0.5"></div>`:''}
   <div class="field"><label for="jc-bonus">${esc(t('Bonus (€)','Bonus (€)'))}</label><input class="input" id="jc-bonus" name="bonus" type="number" min="0" step="0.5" value="0"></div>
   <div class="field"><label for="jc-market">${esc(t('Marketplace','Marketplace'))}</label><select class="select" id="jc-market" name="marketplaceVisible"><option value="true">${esc(t('Published to cleaners','Published to cleaners'))}</option><option value="false">${esc(t('Hidden, assign by hand','Hidden, assign by hand'))}</option></select></div>
   <div class="field wide"><label for="jc-note">${esc(t('Note for the cleaner (optional)','Note for the cleaner (optional)'))}</label><textarea class="textarea" id="jc-note" name="note" maxlength="1000" rows="2"></textarea></div>
   <small class="wide subtle" id="jc-hint" role="status"></small>
  </form>`,`<button class="btn" onclick="closeModal()">${esc(t('Cancel','Cancel'))}</button><button class="btn primary" id="jc-submit" onclick="submitCreateJob()">${esc(t('Create cleaning','Create cleaning'))}</button>`);
  prefillJobCreate();
 }catch(e){toast(e.message,'error')}
}
window.createJobModal=createJobModal;
window.prefillJobCreate=()=>{
 const object=(state.jobCreateObjects||[]).find(x=>String(x.id)===String($('#jc-object')?.value));
 if(!object)return;
 const set=(id,value)=>{const el=document.getElementById(id);if(el&&value!==null&&value!==undefined)el.value=value};
 set('jc-from',String(object.checkout_time||'10:00').slice(0,5));
 set('jc-to',String(object.deadline_time||'15:00').slice(0,5));
 set('jc-duration',object.duration_minutes??90);
 set('jc-payout',object.payout??0);
 set('jc-price',object.client_price??0);
 checkJobCreateWindow();
};
window.checkJobCreateWindow=()=>{
 const hint=document.getElementById('jc-hint'),submit=document.getElementById('jc-submit');
 if(!hint)return true;
 const toMin=v=>{const m=/^(\d{1,2}):(\d{2})/.exec(String(v||''));return m?Number(m[1])*60+Number(m[2]):null};
 const from=toMin($('#jc-from')?.value),to=toMin($('#jc-to')?.value),duration=Number($('#jc-duration')?.value||0);
 let error='';
 if(from===null||to===null)error=t('Enter the cleaning window','Enter the cleaning window');
 else if(to<=from)error=t('Ready-by time must be after the start','Ready-by time must be after the start');
 else if(!(duration>=15))error=t('Duration must be at least 15 minutes','Duration must be at least 15 minutes');
 else if(from+duration>to)error=`${t('The window is too short for this cleaning','The window is too short for this cleaning')} (${duration} ${t('min','min')})`;
 hint.textContent=error||`${t('Fits the window','Fits the window')} · ${t('latest start','latest start')} ${String(Math.floor((to-duration)/60)).padStart(2,'0')}:${String((to-duration)%60).padStart(2,'0')}`;
 hint.className=`wide ${error?'error-text':'subtle'}`;
 if(submit)submit.disabled=Boolean(error);
 return !error;
};
window.submitCreateJob=async()=>{
 if(!checkJobCreateWindow())return;
 const f=new FormData($('#job-create'));
 const body={objectId:Number(f.get('objectId')),serviceDate:f.get('serviceDate'),earliestStart:f.get('earliestStart'),deadline:f.get('deadline'),
  durationMinutes:Number(f.get('durationMinutes')),bonus:Number(f.get('bonus')||0),marketplaceVisible:f.get('marketplaceVisible')==='true',
  note:String(f.get('note')||'').trim()};
 if(f.get('payout')!==null)body.payout=Number(f.get('payout'));
 if(f.get('clientPrice')!==null)body.clientPrice=Number(f.get('clientPrice'));
 try{await api('/api/admin/jobs',{method:'POST',body});closeModal();toast(t('Cleaning created','Cleaning created'),'success');render()}catch(e){toast(e.message,'error')}
};
async function generateJobsModal(){const o=await api('/api/admin/objects');modal('Generate jobs',`<form id="gen-jobs"><div class="form-grid"><div class="field"><label>Date</label><input class="input" name="serviceDate" type="date" value="${tomorrow()}"></div><div class="field"><label>Publish</label><select class="select" name="publish"><option value="true">Yes — marketplace</option><option value="false">No — draft</option></select></div><div class="field wide"><label>Objects (${o.objects.filter(x=>x.active).length} active)</label><div style="max-height:280px;overflow:auto;border:1px solid var(--line);border-radius:12px;padding:8px">${o.objects.filter(x=>x.active).map(x=>`<label class="check-item"><input type="checkbox" name="objectIds" value="${x.id}" checked><span>${esc(x.code)} · ${esc(x.name)}</span><span class="subtle">${x.duration_minutes} min</span></label>`).join('')}</div></div></div></form>`,`<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="submitGenerateJobs()">Generate</button>`)}window.generateJobsModal=generateJobsModal;
window.submitGenerateJobs=async()=>{const f=new FormData($('#gen-jobs'));const ids=f.getAll('objectIds').map(Number);try{const d=await api('/api/admin/jobs/generate',{method:'POST',body:{serviceDate:f.get('serviceDate'),objectIds:ids,publish:f.get('publish')==='true'}});closeModal();toast(`Created ${d.created}; skipped ${d.skipped.length}`,'success');render()}catch(e){toast(e.message,'error')}};

async function openAdminJob(id){
  try{
    const [j,c]=await Promise.all([api(`/api/admin/jobs/${id}`),api('/api/admin/cleaners')]);
    const required=j.checklist.filter(x=>x.required).length,done=j.checklist.filter(x=>x.required&&x.completed).length;
    const clientTotal=Number(j.client_price||0)+Number(j.extra_revenue||0);
    const jobCost=Number(j.payout||0)+Number(j.bonus||0)+Number(j.extra_cost||0);
    const jobProfit=clientTotal-jobCost;
    const margin=clientTotal>0?Math.round(jobProfit/clientTotal*1000)/10:0;const terminal=['COMPLETED','CANCELLED'].includes(j.status);
    modal(`${esc(j.object_code)} · ${esc(j.object_name)}`,`
      <div class="detail-grid">
        <div class="detail-item"><div class="k">Status</div><div class="v">${deliveryPill(j)}</div></div>
        <div class="detail-item"><div class="k">Risk</div><div class="v">${riskPill(j.risk_level,j.risk_score)}</div></div>
        <div class="detail-item"><div class="k">Cleaner</div><div class="v">${esc(j.cleaner_name||'Unassigned')}${j.cleaner_phone?`<div class="nav-links">${telLink(j.cleaner_phone)}</div>`:''}</div></div>
        <div class="detail-item"><div class="k">Client</div><div class="v">${esc(j.client_company||j.client_name||'—')}</div></div>
        <div class="detail-item"><div class="k">Plan / ETA</div><div class="v mono">${esc(j.planned_start||'—')} → ${esc(j.eta||'—')}</div></div>
        <div class="detail-item"><div class="k">Address</div><div class="v">${esc(j.address)}${mapsLinks(j.address,j.lat,j.lng)}</div></div>
        <div class="detail-item"><div class="k">Proof</div><div class="v">${done}/${required} checklist · ${j.photos.length} photos</div></div>
        ${j.client_note?`<div class="detail-item wide"><div class="k">${t('Client note','Client note')}</div><div class="v">${esc(j.client_note)}</div></div>`:''}${j.checkin_distance_m!=null?`<div class="detail-item"><div class="k">${t('Check-in distance','Check-in distance')}</div><div class="v">${Number(j.checkin_distance_m)} m</div></div>`:''}
        <div class="detail-item"><div class="k">Open issues</div><div class="v">${j.issues.filter(x=>x.status==='OPEN').length}</div></div>
      </div>
      ${state.me.role==='ADMIN'?`<h4>Finance</h4>
      <div class="finance-job-summary">
        <div><span>Client total</span><strong>${money(clientTotal)}</strong></div>
        <div><span>Total cost</span><strong>${money(jobCost)}</strong></div>
        <div><span>Profit</span><strong class="${jobProfit>=0?'profit-pos':'profit-neg'}">${money(jobProfit)}</strong></div>
        <div><span>Margin</span><strong class="${jobProfit>=0?'profit-pos':'profit-neg'}">${margin}%</strong></div>
      </div>
      <div class="form-grid">
        <div class="field"><label>Client price €</label><input id="job-client-price" class="input" type="number" min="0" step="0.01" value="${Number(j.client_price||0)}"></div>
        <div class="field"><label>Extra revenue €</label><input id="job-extra-revenue" class="input" type="number" min="0" step="0.01" value="${Number(j.extra_revenue||0)}"></div>
        <div class="field"><label>Cleaner payout €</label><input id="job-payout" class="input" type="number" min="0" step="0.01" value="${Number(j.payout||0)}"></div>
        <div class="field"><label>Extra cost €</label><input id="job-extra-cost" class="input" type="number" min="0" step="0.01" value="${Number(j.extra_cost||0)}"></div>
        <div class="field"><label>Financial status</label><select id="job-financial-status" class="select">${['PENDING','INVOICED','PAID','CANCELLED'].map(x=>`<option value="${x}" ${String(j.financial_status||'PENDING')===x?'selected':''}>${esc(financialLabel(x))}</option>`).join('')}</select></div>
        <div class="field"><label>Cleaner bonus €</label><input id="assign-bonus" class="input" type="number" min="0" step="0.01" value="${Number(j.bonus||0)}"></div>
      </div>
      <div class="job-actions"><button class="btn primary" ${terminal?'disabled':''} onclick="saveJobFinance(${j.id})">Save finance</button></div>`:`<div class="field"><label>Cleaner bonus €</label><input id="assign-bonus" class="input" type="number" min="0" step="0.01" value="${Number(j.bonus||0)}"></div>`}
      <h4>Assignment & rescue</h4>
      <div class="form-grid"><div class="field wide"><label>Cleaner</label><select class="select" id="assign-cleaner"><option value="">Select cleaner</option>${c.cleaners.filter(x=>x.active).map(x=>`<option value="${x.id}" ${x.id===j.assigned_cleaner_id?'selected':''}>${esc(x.full_name)} · ${x.mode} · ${Math.round(x.reliability_score)}</option>`).join('')}</select></div></div>
      <div class="job-actions"><button class="btn blue" ${terminal?'disabled':''} onclick="adminAssign(${j.id})">Assign</button><button class="btn red" ${terminal?'disabled':''} onclick="adminRescue(${j.id})">Rescue assign</button><button class="btn orange" ${terminal?'disabled':''} onclick="adminBonus(${j.id})">Update bonus</button></div>
      ${terminal?'':`<h4>${t('Schedule','Schedule')}</h4>
      <div class="form-grid"><div class="field"><label>${t('Earliest start','Earliest start')}</label><input id="job-earliest" class="input" type="time" value="${esc(String(j.earliest_start||'').slice(0,5))}"></div><div class="field"><label>${t('Deadline','Deadline')}</label><input id="job-deadline" class="input" type="time" value="${esc(String(j.deadline||'').slice(0,5))}"></div><div class="field"><label>${t('Duration (min)','Duration (min)')}</label><input id="job-duration" class="input" type="number" min="15" max="1440" step="5" value="${Number(j.duration_minutes||60)}"></div><div class="field"><label>${t('Visible in marketplace','Visible in marketplace')}</label><select id="job-market" class="select"><option value="true" ${j.marketplace_visible?'selected':''}>${t('Yes','Yes')}</option><option value="false" ${!j.marketplace_visible?'selected':''}>${t('No','No')}</option></select></div></div>
      <div class="job-actions"><button class="btn" onclick="saveJobSchedule(${j.id})">${t('Save schedule','Save schedule')}</button><button class="btn red" onclick="adminCancelJob(${j.id})">${t('Cancel job','Cancel job')}</button></div>`}
      <h4>Access & standard</h4>
      <div class="detail-grid"><div class="detail-item"><div class="k">Access</div><div class="v">${esc(j.access_instructions||'—')}</div></div><div class="detail-item"><div class="k">Key</div><div class="v">${esc(j.key_instructions||'—')}</div></div><div class="detail-item"><div class="k">Linen</div><div class="v">${esc(j.linen_location||'—')}</div></div><div class="detail-item"><div class="k">Supplies</div><div class="v">${esc(j.supplies_location||'—')}</div></div></div>
      <h4>Proof photos</h4><div class="photo-grid">${j.photos.length?j.photos.map(p=>proofMedia(p)).join(''):'<div class="subtle">No proof photos yet.</div>'}</div>
      ${reviewPanel(j)}
      <h4>Audit trail</h4><div>${j.events.slice(0,12).map(e=>`<div class="event"><time>${fmtStamp(e.created_at)}</time><div><strong>${esc(eventLabel(e.event_type))}</strong><br><span class="subtle">${esc(e.actor_name||'System')}</span></div></div>`).join('')||'<div class="empty">No events.</div>'}</div>
    `)
  }catch(e){toast(e.message,'error')}
}
const EVENT_LABELS={CREATED:'Job created',JOB_CREATED:'Job created',CLIENT_BOOKED:'Booked by client',CLEANER_ACCEPTED:'Cleaner accepted',ADMIN_ASSIGNED:'Assigned by Operations',AUTO_ASSIGNED:'Assigned automatically',STATUS_EN_ROUTE:'Cleaner on the way',STATUS_ARRIVED:'Cleaner arrived',STATUS_CLEANING:'Cleaning started',COMPLETED:'Report submitted',QUALITY_APPROVED:'Report approved',QUALITY_REWORK_REQUIRED:'Rework requested',CLEANER_CANCELLED:'Cleaner released the job',CLIENT_CANCELLED:'Cancelled by client',ADMIN_CANCELLED:'Cancelled by Operations',RESCUE_OPENED:'Rescue opened',JOB_UPDATED:'Job updated',BONUS_UPDATED:'Bonus updated',PHOTO_UPLOADED:'Photo uploaded',ISSUE_REPORTED:'Issue reported',CHECKLIST_UPDATED:'Checklist updated',CLIENT_PAYMENT:'Client payment recorded',CLIENT_REFUND:'Client refund recorded',CLEANER_PAYOUT:'Cleaner payout recorded',CLEANER_RETURN:'Cleaner return recorded'};
function eventLabel(type){const key=String(type||'');const label=EVENT_LABELS[key]||key.replaceAll('_',' ').toLowerCase().replace(/^./,c=>c.toUpperCase());return t(label,label)}
window.eventLabel=eventLabel;
function mapsLinks(address,lat,lng){const hasPoint=Number.isFinite(Number(lat))&&Number.isFinite(Number(lng))&&lat!==null&&lng!==null&&lat!==''&&lng!=='';const q=hasPoint?`${Number(lat)},${Number(lng)}`:String(address||'');if(!q)return '';const g=`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;const w=hasPoint?`https://waze.com/ul?ll=${encodeURIComponent(q)}&navigate=yes`:`https://waze.com/ul?q=${encodeURIComponent(q)}&navigate=yes`;return `<div class="nav-links"><a class="btn sm" href="${g}" target="_blank" rel="noopener">🧭 ${esc(t('Google Maps','Google Maps'))}</a><a class="btn sm" href="${w}" target="_blank" rel="noopener">${esc(t('Waze','Waze'))}</a></div>`}
function telLink(phone){const p=String(phone||'').replace(/[^+\d]/g,'');return p?`<a class="btn sm" href="tel:${esc(p)}">📞 ${esc(phone)}</a>`:''}
window.mapsLinks=mapsLinks;
/* Address -> coordinates without typing numbers: OpenStreetMap search or the device location. */
function geoActions(){return `<div class="field wide geo-field"><div class="geo-actions"><button type="button" class="btn sm" onclick="geocodeObjectAddress(this)">📍 ${esc(t('Find coordinates from address','Find coordinates from address'))}</button><button type="button" class="btn sm" onclick="useDeviceLocation(this)">◎ ${esc(t('Use my current location','Use my current location'))}</button></div><small class="subtle geo-status" role="status">${esc(t('Coordinates are used for routes and GPS check-in.','Coordinates are used for routes and GPS check-in.'))}</small></div>`}
function setGeo(form,lat,lng,message){form.querySelector('[name=lat]').value=Number(lat).toFixed(6);form.querySelector('[name=lng]').value=Number(lng).toFixed(6);const status=form.querySelector('.geo-status');if(status)status.textContent=message}
window.geocodeObjectAddress=async button=>{
  const form=button.closest('form');const address=String(form.querySelector('[name=address]')?.value||'').trim();const status=form.querySelector('.geo-status');
  if(address.length<5){status.textContent=t('Enter the full address first','Enter the full address first');return}
  button.disabled=true;status.textContent=t('Searching…','Searching…');
  try{
    const url=`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=sk,cz,at,hu,pl,ua&accept-language=${encodeURIComponent(ST_I18N.getLocale())}&q=${encodeURIComponent(address)}`;
    const res=await fetch(url,{headers:{Accept:'application/json'}});if(!res.ok)throw new Error(String(res.status));
    const [hit]=await res.json();
    if(!hit){status.textContent=t('Address not found. Check the spelling or use your current location on site.','Address not found. Check the spelling or use your current location on site.');return}
    setGeo(form,hit.lat,hit.lon,`${t('Found','Found')}: ${hit.display_name}`);
  }catch{status.textContent=t('Address search is unavailable right now. Try again or enter coordinates.','Address search is unavailable right now. Try again or enter coordinates.')}
  finally{button.disabled=false}
};
window.useDeviceLocation=button=>{
  const form=button.closest('form');const status=form.querySelector('.geo-status');
  if(!navigator.geolocation){status.textContent=t('Location is not available on this device','Location is not available on this device');return}
  button.disabled=true;status.textContent=t('Getting location…','Getting location…');
  navigator.geolocation.getCurrentPosition(pos=>{setGeo(form,pos.coords.latitude,pos.coords.longitude,`${t('Location set','Location set')} (±${Math.round(pos.coords.accuracy)} m)`);button.disabled=false},()=>{status.textContent=t('Location permission denied','Location permission denied');button.disabled=false},{enableHighAccuracy:true,timeout:10000});
};
function reviewPanel(j){
  if(!qualityReviewEnabled())return '';
  const pending=j.status==='COMPLETED'&&j.review_status==='PENDING';
  return `<section class="review-panel"><h4>${t('Quality review','Quality review')}</h4>${clientFeedbackNote(j.feedback)}${reviewPill(j)}${j.review_note?`<p>${esc(j.review_note)}</p>`:''}${pending?`<p>${t('Inspect the checklist and proof before accepting this report.','Inspect the checklist and proof before accepting this report.')}</p><ul class="review-checklist">${(j.checklist||[]).map(i=>`<li>${i.completed?'✓':'○'} ${esc(i.label)}</li>`).join('')}</ul><label for="review-note">${t('Feedback for the cleaner','Feedback for the cleaner')}</label><textarea id="review-note" class="input" maxlength="2000" rows="3"></textarea><div class="job-actions"><button class="btn green" data-review-action onclick="reviewJob(${Number(j.id)},'APPROVED',${Number(j.review_version)})">${t('Approve report','Approve report')}</button><button class="btn orange" data-review-action onclick="reviewJob(${Number(j.id)},'REWORK_REQUIRED',${Number(j.review_version)})">${t('Request rework','Request rework')}</button></div>`:''}</section>`;
}
const reviewRequests=new Map();
window.reviewJob=async(id,decision,expectedVersion)=>{
  const note=$('#review-note')?.value.trim()||'';
  if(decision==='REWORK_REQUIRED'&&!note)return toast(t('Explain what needs to be corrected','Explain what needs to be corrected'),'error');
  const key=JSON.stringify([id,decision,expectedVersion,note]);
  if(!reviewRequests.has(key))reviewRequests.set(key,crypto.randomUUID());
  const buttons=$$('[data-review-action]');buttons.forEach(b=>b.disabled=true);
  try{await api(`/api/admin/jobs/${id}/review`,{method:'POST',body:{decision,note,expectedVersion,requestId:reviewRequests.get(key)}});reviewRequests.delete(key);closeModal();toast(t('Review saved','Review saved'),'success');await render();}
  catch(e){if(e.status>=400&&e.status<500)reviewRequests.delete(key);toast(e.message,'error');buttons.forEach(b=>b.disabled=false);}
};
window.openAdminJob=openAdminJob;
window.saveJobFinance=async id=>{
  try{
    await api(`/api/admin/jobs/${id}`,{method:'PATCH',body:{
      clientPrice:Number($('#job-client-price').value||0),extraRevenue:Number($('#job-extra-revenue').value||0),
      payout:Number($('#job-payout').value||0),extraCost:Number($('#job-extra-cost').value||0),
      financialStatus:$('#job-financial-status').value,bonus:Number($('#assign-bonus').value||0)
    }});
    toast('Finance saved','success');openAdminJob(id)
  }catch(e){toast(e.message,'error')}
};
window.saveJobSchedule=async id=>{
  const body={earliestStart:$('#job-earliest').value,deadline:$('#job-deadline').value,durationMinutes:Number($('#job-duration').value),marketplaceVisible:$('#job-market').value==='true'};
  if(!body.earliestStart||!body.deadline||body.earliestStart>=body.deadline)return toast(t('Deadline must be after the earliest start','Deadline must be after the earliest start'),'error');
  if(!Number.isInteger(body.durationMinutes)||body.durationMinutes<15)return toast(t('Duration must be at least 15 minutes','Duration must be at least 15 minutes'),'error');
  try{await api(`/api/admin/jobs/${id}`,{method:'PATCH',body});toast(t('Schedule saved','Schedule saved'),'success');openAdminJob(id);render({background:true})}catch(e){toast(e.message,'error')}
};
window.adminCancelJob=async id=>{
  const reason=await askDialog({title:'Cancel job',message:'The cleaner and client will see this job as cancelled. This cannot be undone.',label:'Reason',multiline:true,required:true,confirmLabel:'Cancel job',danger:true});
  if(reason===null)return;
  try{await api(`/api/admin/jobs/${id}/cancel`,{method:'POST',body:{reason}});toast(t('Job cancelled','Job cancelled'),'success');render()}catch(e){toast(e.message,'error')}
};
window.adminAssign=async id=>{const cleanerId=Number($('#assign-cleaner').value);if(!cleanerId)return toast('Select cleaner','error');try{await api(`/api/admin/jobs/${id}/assign`,{method:'POST',body:{cleanerId}});closeModal();toast('Cleaner assigned','success');render()}catch(e){toast(e.message,'error')}};
window.adminRescue=async id=>{const cleanerId=Number($('#assign-cleaner').value),bonus=Number($('#assign-bonus').value||6);try{await api(`/api/admin/jobs/${id}/rescue`,{method:'POST',body:{cleanerId:cleanerId||undefined,bonus}});closeModal();toast(cleanerId?'Rescue assigned':'Rescue opened','success');render()}catch(e){toast(e.message,'error')}};
window.adminBonus=async id=>{try{await api(`/api/admin/jobs/${id}/bonus`,{method:'POST',body:{bonus:Number($('#assign-bonus').value||0)}});toast('Bonus updated','success');openAdminJob(id)}catch(e){toast(e.message,'error')}};

async function adminObjects(){shellTitle('Objects','Permanent property database and cleaning standards');const [d,clients]=await Promise.all([api('/api/admin/objects'),api('/api/admin/clients')]);state.clients=clients.clients;$('#page').innerHTML=`<div class="section-head"><div><h2>Properties</h2><p>${d.objects.filter(x=>x.active).length} active objects · ${d.objects.filter(x=>x.approval_status==='PENDING').length} pending approval</p></div><button class="btn primary" onclick="objectModal()">+ Add object</button></div><div class="toolbar"><input id="object-search" class="input search" placeholder="Search code, address, zone"></div><div id="object-table" class="card"><div class="table-wrap"><table><thead><tr><th>Code</th><th>Name</th><th>Client</th><th>Address</th><th>Duration</th><th>Client price</th><th>Payout</th><th>Margin</th><th>State</th><th></th></tr></thead><tbody>${d.objects.map(o=>{const gross=Number(o.client_price||0)-Number(o.payout||0);const stateBadge=o.approval_status==='PENDING'?'<span class="pill orange">Pending approval</span>':o.approval_status==='REJECTED'?'<span class="pill red">Rejected</span>':o.active?'<span class="pill green">Active</span>':'<span class="pill gray">Inactive</span>';return `<tr><td><strong>${esc(o.code)}</strong></td><td>${propertyPhotoCard(o.id)}${esc(o.name)}</td><td>${esc(o.company_name||o.client_name||'—')}</td><td>${esc(o.address)}<br><span class="subtle">${esc(o.zone)}</span></td><td>${o.duration_minutes} min</td><td><strong>${money(o.client_price)}</strong></td><td>${money(o.payout)}</td><td class="${gross>=0?'profit-pos':'profit-neg'}">${money(gross)}</td><td>${stateBadge}</td><td>${o.approval_status==='PENDING'?`<button class="btn sm green" onclick="approveObject(${o.id})">Approve</button> `:''}<div class="row-actions"><button class="btn sm" onclick="objectModal(${o.id})">Edit</button><button class="btn sm blue" onclick="checklistModal(${o.id})">Standard</button>${o.approval_status==='APPROVED'?`<button class="btn sm" onclick="setObjectActive(${o.id},${!o.active})">${o.active?t('Archive','Archive'):t('Activate','Activate')}</button>`:''}<button class="btn sm red" aria-label="${esc(t('Delete property','Delete property'))}" onclick="deleteObject(${o.id},${esc(JSON.stringify(o.code))})">🗑</button></div></td></tr>`}).join('')}</tbody></table></div></div>`;$('#object-search').oninput=()=>filterVisibleRows('#object-table table',$('#object-search').value)}
window.setObjectActive=async(id,active)=>{
  if(!active&&!await askConfirm('Archive property','Archived properties cannot be booked and do not appear in new jobs. History and finance stay intact.','Archive',false))return;
  try{await api(`/api/admin/objects/${id}`,{method:'PATCH',body:{active}});toast(active?t('Property activated','Property activated'):t('Property archived','Property archived'),'success');render()}catch(e){toast(e.message,'error')}
};
window.deleteObject=async(id,code)=>{
  if(!await askConfirm('Delete property',`${code}: ${t('The property, its photos and checklist will be deleted permanently. Properties with cleaning history cannot be deleted — archive them instead.','The property, its photos and checklist will be deleted permanently. Properties with cleaning history cannot be deleted — archive them instead.')}`,'Delete'))return;
  try{await api(`/api/admin/objects/${id}`,{method:'DELETE'});toast(t('Property deleted','Property deleted'),'success');render()}
  catch(e){toast(/foreign key|violates|restrict|st_jobs/i.test(e.message)?t('This property has cleaning history. Archive it instead.','This property has cleaning history. Archive it instead.'):e.message,'error')}
};
window.approveObject=async id=>{try{await api(`/api/admin/objects/${id}`,{method:'PATCH',body:{approvalStatus:'APPROVED',active:true}});toast('Object approved','success');render()}catch(e){toast(e.message,'error')}};
async function objectModal(id){try{const [clients,d]=await Promise.all([api('/api/admin/clients'),id?api(`/api/admin/objects/${id}`):Promise.resolve({object:{}})]);const o=d.object||{};state.clients=clients.clients;modal(id?'Edit object':'Add object',`<form id="object-form" class="form-grid">${serviceCategoryField(o.service_category)}<div class="field"><label>Code</label><input class="input" name="code" required value="${esc(o.code||'')}"></div><div class="field"><label>Name</label><input class="input" name="name" required value="${esc(o.name||'')}"></div><div class="field wide"><label>Client</label><select class="select" name="clientId"><option value="">—</option>${clients.clients.map(c=>`<option value="${c.id}" ${Number(o.client_id)===Number(c.id)?'selected':''}>${esc(c.company_name||c.full_name)} · ${esc(c.account_type)}</option>`).join('')}</select></div><div class="field wide"><label>Address</label><input class="input" name="address" required value="${esc(o.address||'')}"></div><div class="field"><label>Zone</label><input class="input" name="zone" required value="${esc(o.zone||'Nivy')}"></div><div class="field"><label>Apartment type</label><input class="input" name="apartmentType" value="${esc(o.apartment_type||'Apartment')}"></div><div class="field"><label>Bedrooms</label><input class="input" name="bedrooms" type="number" min="0" value="${o.bedrooms??1}"></div><div class="field"><label>Bathrooms</label><input class="input" name="bathrooms" type="number" min="1" value="${o.bathrooms??1}"></div><div class="field"><label>Standard duration (min)</label><input class="input" name="durationMinutes" type="number" min="20" value="${o.duration_minutes??60}"></div><div class="field"><label>Cleaner payout €</label><input class="input" name="payout" type="number" step=".5" min="0" value="${o.payout??20}"></div><div class="field"><label>Client price €</label><input class="input" name="clientPrice" type="number" step=".5" min="0" value="${o.client_price??0}"></div><div class="field"><label>Checkout / earliest start</label><input class="input" name="checkoutTime" type="time" value="${o.checkout_time||'10:00'}"></div><div class="field"><label>Hard deadline</label><input class="input" name="deadlineTime" type="time" value="${o.deadline_time||'15:00'}"></div><div class="field"><label>Approval</label><select class="select" name="approvalStatus">${['APPROVED','PENDING','REJECTED'].map(x=>`<option value="${x}" ${String(o.approval_status||'APPROVED')===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>State</label><select class="select" name="active"><option value="true" ${o.active!==false?'selected':''}>Active</option><option value="false" ${o.active===false?'selected':''}>Inactive</option></select></div><div class="field"><label>Latitude</label><input class="input" name="lat" type="text" inputmode="decimal" autocomplete="off" placeholder="48.177333" value="${o.lat??''}"></div><div class="field"><label>Longitude</label><input class="input" name="lng" type="text" inputmode="decimal" autocomplete="off" placeholder="17.126286" value="${o.lng??''}"></div>${geoActions()}<div class="field wide"><label>Access instructions</label><textarea class="textarea" name="accessInstructions">${esc(o.access_instructions||'')}</textarea></div><div class="field"><label>Key instructions</label><textarea class="textarea" name="keyInstructions">${esc(o.key_instructions||'')}</textarea></div><div class="field"><label>Parking</label><textarea class="textarea" name="parking">${esc(o.parking||'')}</textarea></div><div class="field"><label>Linen location</label><input class="input" name="linenLocation" value="${esc(o.linen_location||'')}"></div><div class="field"><label>Supplies location</label><input class="input" name="suppliesLocation" value="${esc(o.supplies_location||'')}"></div><div class="field"><label>Wi-Fi / network note</label><input class="input" name="wifi" value="${esc(o.wifi||'')}"></div><div class="field wide"><label>Notes</label><textarea class="textarea" name="notes">${esc(o.notes||'')}</textarea></div></form>`,`<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveObject(${id||0})">Save</button>`)}catch(e){toast(e.message,'error')}}window.objectModal=objectModal;
window.saveObject=async id=>{const f=new FormData($('#object-form'));let coordinates;try{coordinates=coordinatesFrom(f)}catch(e){return toast(e.message,'error')}const body={clientId:f.get('clientId')?Number(f.get('clientId')):null,code:f.get('code'),name:f.get('name'),address:f.get('address'),zone:f.get('zone'),serviceCategory:f.get('serviceCategory')||'SHORT_STAY',apartmentType:f.get('apartmentType'),bedrooms:Number(f.get('bedrooms')),bathrooms:Number(f.get('bathrooms')),durationMinutes:Number(f.get('durationMinutes')),payout:Number(f.get('payout')),clientPrice:Number(f.get('clientPrice')),checkoutTime:f.get('checkoutTime'),deadlineTime:f.get('deadlineTime'),approvalStatus:f.get('approvalStatus'),active:f.get('active')==='true',lat:coordinates.lat,lng:coordinates.lng,accessInstructions:f.get('accessInstructions'),keyInstructions:f.get('keyInstructions'),parking:f.get('parking'),linenLocation:f.get('linenLocation'),suppliesLocation:f.get('suppliesLocation'),wifi:f.get('wifi'),notes:f.get('notes')};try{await api(id?`/api/admin/objects/${id}`:'/api/admin/objects',{method:id?'PATCH':'POST',body});closeModal();toast('Object saved','success');render()}catch(e){toast(e.message,'error')}};
async function checklistModal(id){try{const d=await api(`/api/admin/objects/${id}`);modal(`Cleaning standard · ${esc(d.object.code)}`,`<div class="subtle" style="margin-bottom:12px">This template is copied into every newly generated cleaning job for this object.</div><div id="standard-items">${d.checklist.map((x,i)=>standardRow(x,i)).join('')}</div><button class="btn sm" style="margin-top:10px" onclick="addStandardRow()">+ Add item</button>`,`<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveStandard(${id})">Save standard</button>`)}catch(e){toast(e.message,'error')}}
function standardRow(x={},i=0){return `<div class="check-item standard-edit"><span class="subtle mono">${i+1}</span><div><input class="input std-label" value="${esc(x.label||'')}" placeholder="Checklist item"><div style="display:flex;gap:10px;margin-top:7px;font-size:10px;color:var(--muted)"><label><input class="std-required" type="checkbox" ${x.required!==0?'checked':''}> required</label><label><input class="std-photo" type="checkbox" ${x.photo_required?'checked':''}> photo</label></div></div><input class="input std-category" style="width:130px" value="${esc(x.photo_category||'')}" placeholder="Photo category"></div>`}
window.checklistModal=checklistModal;window.addStandardRow=()=>{$('#standard-items').insertAdjacentHTML('beforeend',standardRow({},$$('.standard-edit').length))};window.saveStandard=async id=>{const items=$$('.standard-edit').map(r=>({label:$('.std-label',r).value.trim(),required:$('.std-required',r).checked,photoRequired:$('.std-photo',r).checked,photoCategory:$('.std-category',r).value.trim()||null})).filter(x=>x.label);if(!items.length)return toast('Add at least one checklist item','error');try{await api(`/api/admin/objects/${id}/checklist`,{method:'PUT',body:{items}});closeModal();toast('Cleaning standard saved','success')}catch(e){toast(e.message,'error')}};


async function adminClients(){shellTitle('Clients','Owners and managers with self-service booking access');const d=await api('/api/admin/clients');state.clients=d.clients;$('#page').innerHTML=`<div class="section-head"><div><h2>Client accounts</h2><p>${d.clients.filter(x=>x.user_active).length} active · ${d.clients.length} total</p></div><button class="btn primary" onclick="clientAdminModal()">+ Add client</button></div><div class="grid kpis" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px"><div class="card kpi"><div class="label">Clients</div><div class="value">${d.clients.length}</div></div><div class="card kpi"><div class="label">Owners</div><div class="value">${d.clients.filter(x=>x.account_type==='OWNER').length}</div></div><div class="card kpi"><div class="label">Property managers</div><div class="value">${d.clients.filter(x=>x.account_type==='PROPERTY_MANAGER').length}</div></div><div class="card kpi"><div class="label">Month revenue</div><div class="value small-money">${money(d.clients.reduce((a,x)=>a+Number(x.month_revenue||0),0))}</div></div></div><div class="card"><div class="table-wrap"><table><thead><tr><th>Client</th><th>Account type</th><th>Company name</th><th>Objects count</th><th>Approved</th><th>Month jobs</th><th>Month revenue</th><th>Language</th><th>State</th><th></th></tr></thead><tbody>${d.clients.map(c=>`<tr><td><strong>${esc(c.full_name)}</strong><br><span class="subtle">${esc(c.email)} · ${esc(c.phone||'')}</span></td><td><span class="pill ${c.account_type==='PROPERTY_MANAGER'?'violet':'blue'}">${esc(t(c.account_type==='PROPERTY_MANAGER'?'Property manager':'Owner',c.account_type==='PROPERTY_MANAGER'?'Property manager':'Owner'))}</span></td><td>${esc(c.company_name||'—')}</td><td>${c.objects}</td><td>${c.approved_objects}</td><td>${c.month_jobs}</td><td><strong>${money(c.month_revenue)}</strong></td><td>${esc(ST_I18N.NAMES[c.language]||c.language)}</td><td>${c.user_active?'<span class="pill green">Active</span>':'<span class="pill gray">Inactive</span>'}</td><td><div class="row-actions"><button class="btn sm" onclick="clientAdminModal(${c.id})">Edit</button><button class="btn sm ${c.user_active?'':'green'}" onclick="setClientActive(${c.id},${!c.user_active})">${c.user_active?t('Deactivate','Deactivate'):t('Activate','Activate')}</button></div></td></tr>`).join('')||'<tr><td colspan="10"><div class="empty">No clients.</div></td></tr>'}</tbody></table></div></div>`}
window.clientAdminModal=id=>{const c=id?(state.clients||[]).find(x=>x.id===id):{};modal(id?'Edit client':'Add client',`<form id="admin-client-form" class="form-grid"><div class="field"><label>Account type</label><select class="select" name="accountType"><option value="OWNER" ${c?.account_type!=='PROPERTY_MANAGER'?'selected':''}>${t('Owner','Owner')}</option><option value="PROPERTY_MANAGER" ${c?.account_type==='PROPERTY_MANAGER'?'selected':''}>${t('Property manager','Property manager')}</option></select></div><div class="field"><label>Language</label><select class="select" name="language">${ST_I18N.LANGS.map(l=>`<option value="${l}" ${String(c?.language||'ru')===l?'selected':''}>${ST_I18N.NAMES[l]}</option>`).join('')}</select></div><div class="field"><label>Full name</label><input class="input" name="fullName" required value="${esc(c?.full_name||'')}"></div><div class="field"><label>Company name</label><input class="input" name="companyName" value="${esc(c?.company_name||'')}"></div><div class="field"><label>Email</label><input class="input" type="email" name="email" required value="${esc(c?.email||'')}"></div><div class="field"><label>Phone</label><input class="input" name="phone" value="${esc(c?.phone||'')}"></div>${id?'':`<div class="field wide"><label>Initial password</label><input class="input" type="password" name="password" minlength="12" required placeholder="Temporary password (12+ chars)"></div>`}<div class="field"><label>Billing name</label><input class="input" name="billingName" value="${esc(c?.billing_name||'')}"></div><div class="field"><label>ICO</label><input class="input" name="ico" value="${esc(c?.ico||'')}"></div><div class="field"><label>DIC</label><input class="input" name="dic" value="${esc(c?.dic||'')}"></div><div class="field"><label>IC DPH</label><input class="input" name="icDph" value="${esc(c?.ic_dph||'')}"></div><div class="field wide"><label>Billing address</label><input class="input" name="billingAddress" value="${esc(c?.billing_address||'')}"></div>${id?`<div class="field"><label>State</label><select class="select" name="active"><option value="true" ${c.user_active?'selected':''}>Active</option><option value="false" ${!c.user_active?'selected':''}>Inactive</option></select></div>`:''}</form>${id&&c?.account_type==='PROPERTY_MANAGER'?`<section class="portfolio-panel"><h4>${t('Managed properties','Managed properties')}</h4><p class="subtle">${t('The manager sees jobs, photos and bookings only for the properties ticked here.','The manager sees jobs, photos and bookings only for the properties ticked here.')}</p><input class="input" type="search" placeholder="${esc(t('Search properties','Search properties'))}" oninput="filterPortfolio(this.value)"><div id="pm-portfolio" class="portfolio-list"><div class="empty">${t('Loading…','Loading…')}</div></div></section>`:''}`,`${id?`<button class="btn orange" onclick="resetClientPassword(${id})">Reset password</button>`:''}<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveAdminClient(${id||0})">Save</button>`);if(id&&c?.account_type==='PROPERTY_MANAGER')loadPortfolio(id)};
async function loadPortfolio(clientId){
  const box=document.getElementById('pm-portfolio');if(!box)return;
  try{
    const [links,objects]=await Promise.all([api(`/api/admin/clients/${clientId}/properties`),api('/api/admin/objects')]);
    const linked=new Set((links.objectIds||[]).map(Number));
    const rows=(objects.objects||[]).slice().sort((a,b)=>Number(linked.has(b.id))-Number(linked.has(a.id))||String(a.code).localeCompare(String(b.code)));
    box.innerHTML=rows.map(o=>`<label class="portfolio-row" data-search="${esc(`${o.code} ${o.name} ${o.address} ${o.zone}`.toLowerCase())}"><input type="checkbox" ${linked.has(Number(o.id))?'checked':''} onchange="togglePortfolio(${Number(clientId)},${Number(o.id)},this)"><span><strong>${esc(o.code)} · ${esc(o.name)}</strong><small>${esc(o.address||'')}${o.zone?` · ${esc(o.zone)}`:''}</small></span></label>`).join('')||`<div class="empty">${t('No properties yet.','No properties yet.')}</div>`;
  }catch(e){box.innerHTML=`<div class="empty error-text">${esc(e.message)}</div>`}
}
window.filterPortfolio=q=>{q=String(q||'').toLowerCase().trim();document.querySelectorAll('#pm-portfolio .portfolio-row').forEach(r=>{r.hidden=!!q&&!r.dataset.search.includes(q)})};
window.togglePortfolio=async(clientId,objectId,box)=>{
  box.disabled=true;
  try{
    if(box.checked)await api(`/api/admin/clients/${clientId}/properties`,{method:'POST',body:{objectId}});
    else await api(`/api/admin/clients/${clientId}/properties/${objectId}`,{method:'DELETE'});
    toast(box.checked?t('Property linked to manager','Property linked to manager'):t('Property removed from manager','Property removed from manager'),'success');
  }catch(e){box.checked=!box.checked;toast(e.message,'error')}
  finally{box.disabled=false}
};
window.saveAdminClient=async id=>{const f=new FormData($('#admin-client-form'));const body={accountType:f.get('accountType'),language:f.get('language'),fullName:f.get('fullName'),companyName:f.get('companyName'),email:f.get('email'),phone:f.get('phone'),billingName:f.get('billingName'),ico:f.get('ico'),dic:f.get('dic'),icDph:f.get('icDph'),billingAddress:f.get('billingAddress')};if(id)body.active=f.get('active')==='true';else body.password=f.get('password');try{await api(id?`/api/admin/clients/${id}`:'/api/admin/clients',{method:id?'PATCH':'POST',body});closeModal();toast('Client saved','success');render()}catch(e){toast(e.message,'error')}};
window.setClientActive=async(id,active)=>{
  if(!active&&!await askConfirm('Deactivate client','The client can no longer sign in or book. Properties, bookings and finance history stay intact.','Deactivate'))return;
  try{await api(`/api/admin/clients/${id}`,{method:'PATCH',body:{active}});toast(active?t('Account activated','Account activated'):t('Account deactivated','Account deactivated'),'success');render()}catch(e){toast(e.message,'error')}
};
window.resetClientPassword=async id=>{const password=await askDialog({title:'Reset password',label:'New temporary password (minimum 12 characters)',inputType:'password',required:true,minLength:12,confirmLabel:'Reset password'});if(password===null)return;try{await api(`/api/admin/clients/${id}/password`,{method:'POST',body:{password}});toast('Password changed','success')}catch(e){toast(e.message,'error')}};

async function adminFinance(month=(new Date()).toISOString().slice(0,7)){shellTitle('Finance','Monthly revenue, cleaner costs and contribution profit');const d=await api(`/api/admin/finance?month=${encodeURIComponent(month)}`);state.finance=d;const s=d.summary,max=Math.max(1,...d.trend.map(x=>Math.max(Number(x.revenue),Number(x.expenses))));$('#page').innerHTML=`<div class="section-head"><div><h2>Finance overview</h2><p>${fmtDate(d.from)} — ${fmtDate(d.to)} · ${s.completedJobs} completed jobs</p></div><div style="display:flex;gap:8px;align-items:center"><input id="finance-month" class="input" style="width:165px" type="month" value="${d.month}" onchange="setFinancePeriod(this.value)"><button class="btn primary" onclick="financeEntryModal()">+ Add entry</button></div></div><div class="grid finance-kpis"><div class="card kpi"><div class="label">Revenue</div><div class="value small-money">${money(s.totalRevenue)}</div><div class="hint">cleaning ${money(s.cleaningRevenue)} + other ${money(s.manualIncome)}</div></div><div class="card kpi"><div class="label">Cleaner payouts</div><div class="value small-money">${money(s.cleanerPayouts+s.cleanerBonuses)}</div><div class="hint">base ${money(s.cleanerPayouts)} + bonuses ${money(s.cleanerBonuses)}</div></div><div class="card kpi"><div class="label">Expenses</div><div class="value small-money">${money(s.totalExpenses)}</div><div class="hint">job extras ${money(s.jobExtraCosts)} + other ${money(s.manualExpenses)}</div></div><div class="card kpi ${s.profit<0?'danger':''}"><div class="label">Profit</div><div class="value small-money ${s.profit>=0?'profit-pos':'profit-neg'}">${money(s.profit)}</div><div class="hint">${s.marginPct}% Margin</div></div><div class="card kpi"><div class="label">Average revenue / job</div><div class="value small-money">${money(s.avgRevenuePerJob)}</div></div><div class="card kpi"><div class="label">Average profit / job</div><div class="value small-money">${money(s.avgProfitPerJob)}</div></div></div><div style="height:14px"></div><div class="card pad"><div class="section-head compact"><div><h2>12 month trend</h2><p>Revenue / expenses / contribution profit</p></div></div><div class="finance-trend">${d.trend.map(x=>`<div class="trend-col"><div class="trend-bars"><span class="trend-revenue" title="Revenue ${money(x.revenue)}" style="height:${Math.max(3,Number(x.revenue)/max*100)}%"></span><span class="trend-expense" title="Expenses ${money(x.expenses)}" style="height:${Math.max(3,Number(x.expenses)/max*100)}%"></span></div><strong>${x.month.slice(5)}</strong><small class="${Number(x.profit)>=0?'profit-pos':'profit-neg'}">${money(x.profit)}</small></div>`).join('')}</div></div><div style="height:14px"></div><div class="two-col"><div class="card pad"><h2 style="margin-top:0">By client</h2><div class="table-wrap"><table><thead><tr><th>Client</th><th>Jobs</th><th>Revenue</th><th>Expenses</th><th>Profit</th></tr></thead><tbody>${d.byClient.map(x=>`<tr><td><strong>${esc(x.name)}</strong></td><td>${x.jobs}</td><td>${money(x.revenue)}</td><td>${money(x.cost)}</td><td class="${x.profit>=0?'profit-pos':'profit-neg'}"><strong>${money(x.profit)}</strong></td></tr>`).join('')||'<tr><td colspan="5">—</td></tr>'}</tbody></table></div></div><div class="card pad"><h2 style="margin-top:0">By object</h2><div class="table-wrap"><table><thead><tr><th>Object</th><th>Jobs</th><th>Revenue</th><th>Expenses</th><th>Profit</th></tr></thead><tbody>${d.byObject.slice(0,20).map(x=>`<tr><td><strong>${esc(x.code)}</strong><br><span class="subtle">${esc(x.name)}</span></td><td>${x.jobs}</td><td>${money(x.revenue)}</td><td>${money(x.cost)}</td><td class="${x.profit>=0?'profit-pos':'profit-neg'}"><strong>${money(x.profit)}</strong></td></tr>`).join('')||'<tr><td colspan="5">—</td></tr>'}</tbody></table></div></div></div><div style="height:14px"></div><div class="card"><div class="section-head pad compact"><div><h2>Manual entries</h2><p>${d.entries.length} entries</p><div class="toolbar">${state.financeCursor?'<button class="btn sm" onclick="financePage(null)">First page</button>':''}${d.entriesHasMore?`<button class="btn sm" onclick="financePage(${Number(d.entriesNextCursor)})">Next page</button>`:''}</div></div></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th>Client</th><th>Object</th><th>Amount</th><th></th></tr></thead><tbody>${d.entries.map(e=>`<tr><td>${fmtDate(e.entry_date)}</td><td><span class="pill ${e.entry_type==='INCOME'?'green':'red'}">${e.entry_type==='INCOME'?'Income':'Expense'}</span></td><td>${esc(e.category)}</td><td>${esc(e.description||'—')}</td><td>${esc(e.company_name||e.client_name||'—')}</td><td>${esc(e.object_code||'—')}</td><td class="${e.entry_type==='INCOME'?'profit-pos':'profit-neg'}"><strong>${e.entry_type==='INCOME'?'+':'−'}${money(e.amount)}</strong></td><td><div class="row-actions"><button class="btn sm" onclick="financeEntryModal(${e.id})">${esc(t('Edit','Edit'))}</button><button class="btn sm red" onclick="deleteFinanceEntry(${e.id})">${esc(t('Delete','Delete'))}</button></div></td></tr>`).join('')||'<tr><td colspan="8"><div class="empty">No entries.</div></td></tr>'}</tbody></table></div></div>`}
window.adminFinance=adminFinance;
/* Fix 25: an entry can be corrected instead of deleted and re-typed. Every
   change goes through the audited command, and the trail is readable here. */
window.financeEntryModal=async(entryId=null)=>{
 try{
  const [c,o]=await Promise.all([api('/api/admin/clients'),api('/api/admin/objects')]);
  const entry=entryId?(state.finance?.entries||[]).find(x=>String(x.id)===String(entryId)):null;
  const categories=['LAUNDRY','SUPPLIES','MAINTENANCE','PARKING','REFUND','EXTRA_SERVICE','OTHER'];
  const selected=(value,option)=>String(value||'')===String(option)?'selected':'';
  modal(esc(t(entry?'Edit finance entry':'Add finance entry',entry?'Edit finance entry':'Add finance entry')),`<form id="finance-entry-form" class="form-grid">
   <input type="hidden" name="id" value="${entry?entry.id:''}">
   <div class="field"><label for="fe-date">${esc(t('Date','Date'))}</label><input class="input" id="fe-date" type="date" name="entryDate" value="${esc(entry?entry.entry_date:today())}" required></div>
   <div class="field"><label for="fe-type">${esc(t('Type','Type'))}</label><select class="select" id="fe-type" name="entryType"><option value="EXPENSE" ${selected(entry?.entry_type,'EXPENSE')}>${esc(t('Expense','Expense'))}</option><option value="INCOME" ${selected(entry?.entry_type,'INCOME')}>${esc(t('Income','Income'))}</option></select></div>
   <div class="field"><label for="fe-category">${esc(t('Category','Category'))}</label><select class="select" id="fe-category" name="category">${categories.map(x=>`<option value="${x}" ${selected(entry?.category,x)}>${x}</option>`).join('')}</select></div>
   <div class="field"><label for="fe-amount">${esc(t('Amount €','Amount €'))}</label><input class="input" id="fe-amount" type="number" min="0.01" step="0.01" name="amount" value="${entry?Number(entry.amount):''}" required></div>
   <div class="field"><label for="fe-client">${esc(t('Client','Client'))}</label><select class="select" id="fe-client" name="clientId"><option value="">—</option>${c.clients.map(x=>`<option value="${x.id}" ${selected(entry?.client_id,x.id)}>${esc(x.company_name||x.full_name)}</option>`).join('')}</select></div>
   <div class="field"><label for="fe-object">${esc(t('Object','Object'))}</label><select class="select" id="fe-object" name="objectId"><option value="">—</option>${o.objects.map(x=>`<option value="${x.id}" ${selected(entry?.object_id,x.id)}>${esc(x.code)} · ${esc(x.name)}</option>`).join('')}</select></div>
   <div class="field wide"><label for="fe-description">${esc(t('Description','Description'))}</label><input class="input" id="fe-description" name="description" maxlength="500" value="${esc(entry?.description||'')}"></div>
   ${entry?`<div class="field wide"><label for="fe-reason">${esc(t('Why is it being changed? (kept in the history)','Why is it being changed? (kept in the history)'))}</label><input class="input" id="fe-reason" name="reason" maxlength="300"></div><div class="wide" id="fe-history"><button class="btn sm" type="button" onclick="loadFinanceEntryHistory(${entry.id})">${esc(t('Show change history','Show change history'))}</button></div>`:''}
  </form>`,`<button class="btn" onclick="closeModal()">${esc(t('Cancel','Cancel'))}</button><button class="btn primary" onclick="saveFinanceEntry()">${esc(t('Save','Save'))}</button>`);
 }catch(e){toast(e.message,'error')}
};
window.loadFinanceEntryHistory=async id=>{
 const host=document.getElementById('fe-history');if(!host)return;
 host.innerHTML=`<div class="empty">${esc(t('Loading…','Loading…'))}</div>`;
 try{
  const d=await api(`/api/admin/finance/entries/${id}/history`);
  const amount=row=>row?money(Number(row.amount||0)):'—';
  host.innerHTML=(d.history||[]).length?`<div class="table-wrap"><table><thead><tr><th>${esc(t('When','When'))}</th><th>${esc(t('Action','Action'))}</th><th>${esc(t('Who','Who'))}</th><th>${esc(t('Before','Before'))}</th><th>${esc(t('After','After'))}</th><th>${esc(t('Reason','Reason'))}</th></tr></thead><tbody>${d.history.map(h=>`<tr><td>${esc(fmtStamp(h.created_at))}</td><td>${esc(t(h.action,h.action))}</td><td>${esc(h.actor||'—')}</td><td>${amount(h.before)}</td><td>${amount(h.after)}</td><td>${esc(h.reason||'—')}</td></tr>`).join('')}</tbody></table></div>`:`<div class="empty">${esc(t('No changes recorded yet.','No changes recorded yet.'))}</div>`;
 }catch(e){host.innerHTML=`<div class="empty error-text">${esc(e.message)}</div>`}
};
window.saveFinanceEntry=async()=>{
 const f=new FormData($('#finance-entry-form'));
 const id=String(f.get('id')||'');
 const body={entryDate:f.get('entryDate'),entryType:f.get('entryType'),category:f.get('category'),amount:Number(f.get('amount')),
  clientId:f.get('clientId')?Number(f.get('clientId')):null,objectId:f.get('objectId')?Number(f.get('objectId')):null,
  description:f.get('description'),reason:f.get('reason')||''};
 try{
  await api(id?`/api/admin/finance/entries/${id}`:'/api/admin/finance/entries',{method:id?'PATCH':'POST',body});
  closeModal();toast(t('Finance entry saved','Finance entry saved'),'success');
  state.financeMonth=$('#finance-month')?.value||new Date().toISOString().slice(0,7);await render();
 }catch(e){toast(e.message,'error')}
};
window.deleteFinanceEntry=async id=>{
 const reason=await askDialog({title:'Delete entry',message:'The entry is removed from the reports, and the deletion is kept in the history with your reason.',label:'Reason',confirmLabel:'Delete',danger:true});
 if(reason===null)return;
 try{
  const month=$('#finance-month')?.value||new Date().toISOString().slice(0,7);
  await api(`/api/admin/finance/entries/${id}`,{method:'DELETE',body:{reason}});
  toast(t('Deleted','Deleted'),'success');state.financeMonth=month;await render();
 }catch(e){toast(e.message,'error')}
};

async function adminCleaners(){shellTitle('Team','Cleaners and operations managers');const d=await api('/api/admin/cleaners');$('#page').innerHTML=`<div class="section-head"><div><h2>Cleaner network</h2><p>${d.cleaners.filter(x=>x.active).length} active cleaners</p></div>${state.me.role==='ADMIN'?'<button class="btn primary" onclick="cleanerModal()">+ Add cleaner</button>':''}</div><div class="grid three-col" style="margin-bottom:14px">${d.cleaners.slice(0,3).map(c=>`<div class="card pad"><div style="display:flex;justify-content:space-between"><div><strong>${esc(c.full_name)}</strong><div class="subtle">${esc(c.mode)} · ${esc(c.transport)}</div></div><div class="risk-score" style="background:#edf9f3;color:#087a4d">${Math.round(c.reliability_score)}</div></div><div class="detail-grid" style="margin-top:12px"><div class="detail-item"><div class="k">Today jobs</div><div class="v">${c.today_jobs}</div></div><div class="detail-item"><div class="k">Rating</div><div class="v">★ ${c.rating}</div></div></div></div>`).join('')}</div><div class="card"><div class="table-wrap"><table><thead><tr><th>Cleaner</th><th>Mode</th><th>Reliability</th><th>Today</th><th>Completed</th><th>Cancel</th><th>Zones</th><th></th></tr></thead><tbody>${d.cleaners.map(c=>`<tr><td><strong>${esc(c.full_name)}</strong><br><span class="subtle">${esc(c.email)}</span></td><td>${c.mode==='GUARANTEE'?'<span class="pill violet">GUARANTEE</span>':'<span class="pill gray">FLEX</span>'}</td><td><strong>${Math.round(c.reliability_score)}</strong> · ★${c.rating}</td><td>${c.today_jobs} jobs<br><span class="subtle">${money(c.today_earnings)}</span></td><td>${c.completed_jobs}</td><td>${Number(c.cancellation_rate).toFixed(1)}%</td><td>${(c.preferred_zones||[]).map(z=>`<span class="pill gray">${esc(z)}</span>`).join(' ')}</td><td>${state.me.role==='ADMIN'?`<div class="row-actions"><button class="btn sm" onclick="cleanerModal(${c.id})">Edit</button><button class="btn sm ${c.active?'':'green'}" onclick="setCleanerActive(${c.id},${!c.active})">${c.active?t('Deactivate','Deactivate'):t('Activate','Activate')}</button></div>`:(c.phone?telLink(c.phone):'')}</td></tr>`).join('')}</tbody></table></div></div>${state.me.role==='ADMIN'?'<div id="managers-card" class="card pad" style="margin-top:14px"><div class="empty">…</div></div>':''}`;state.cleaners=d.cleaners;if(state.me.role==='ADMIN')loadManagers()}
async function loadManagers(){const box=$('#managers-card');if(!box)return;try{const d=await api('/api/admin/managers');state.managers=d.managers;box.innerHTML=`<div class="section-head compact"><div><h2>${t('Operations managers','Operations managers')}</h2><p>${t('Dispatch, quality review and issues. No prices, finance or settings.','Dispatch, quality review and issues. No prices, finance or settings.')}</p></div><button class="btn primary" onclick="managerModal()">+ ${t('Add manager','Add manager')}</button></div><div class="table-wrap"><table><thead><tr><th>${t('Name','Name')}</th><th>Email</th><th>${t('Phone','Phone')}</th><th>${t('State','State')}</th><th></th></tr></thead><tbody>${d.managers.map(m=>`<tr><td><strong>${esc(m.full_name)}</strong></td><td>${esc(m.email)}</td><td>${esc(m.phone||'—')}</td><td>${m.active?`<span class="pill green">${t('Active','Active')}</span>`:`<span class="pill gray">${t('Inactive','Inactive')}</span>`}</td><td><div class="row-actions"><button class="btn sm" onclick="managerModal(${m.id})">${t('Edit','Edit')}</button><button class="btn sm" onclick="setManagerActive(${m.id},${!m.active})">${m.active?t('Deactivate','Deactivate'):t('Activate','Activate')}</button><button class="btn sm orange" onclick="resetManagerPassword(${m.id})">${t('Reset password','Reset password')}</button></div></td></tr>`).join('')||`<tr><td colspan="5"><div class="empty">${t('No managers yet.','No managers yet.')}</div></td></tr>`}</tbody></table></div>`}catch(e){box.innerHTML=`<div class="empty error-text">${esc(e.message)}</div>`}}
window.managerModal=id=>{const m=id?(state.managers||[]).find(x=>x.id===id)||{}:{};modal(t(id?'Edit manager':'Add manager',id?'Edit manager':'Add manager'),`<form id="manager-form" class="form-grid"><div class="field"><label>${t('Full name','Full name')}</label><input class="input" name="fullName" required value="${esc(m.full_name||'')}"></div><div class="field"><label>Email</label><input class="input" type="email" name="email" required value="${esc(m.email||'')}"></div><div class="field"><label>${t('Phone','Phone')}</label><input class="input" name="phone" value="${esc(m.phone||'')}"></div><div class="field"><label>${t('Language','Language')}</label><select class="select" name="language">${ST_I18N.LANGS.map(l=>`<option value="${l}" ${String(m.language||'ru')===l?'selected':''}>${ST_I18N.NAMES[l]}</option>`).join('')}</select></div>${id?'':`<div class="field wide"><label>${t('Initial password','Initial password')}</label><input class="input" type="password" name="password" minlength="12" required placeholder="${esc(t('Temporary password (12+ chars)','Temporary password (12+ chars)'))}"></div>`}</form>`,`<button class="btn" onclick="closeModal()">${t('Cancel','Cancel')}</button><button class="btn primary" onclick="saveManager(${id||0})">${t('Save','Save')}</button>`)};
window.saveManager=async id=>{const form=$('#manager-form');if(!form.reportValidity())return;const f=new FormData(form);const body={fullName:f.get('fullName'),email:f.get('email'),phone:f.get('phone'),language:f.get('language')};if(!id)body.password=f.get('password');try{await api(id?`/api/admin/managers/${id}`:'/api/admin/managers',{method:id?'PATCH':'POST',body});closeModal();toast(t('Manager saved','Manager saved'),'success');render()}catch(e){toast(e.message,'error')}};
window.setManagerActive=async(id,active)=>{if(!active&&!await askConfirm('Deactivate manager','The manager can no longer sign in.','Deactivate'))return;try{await api(`/api/admin/managers/${id}`,{method:'PATCH',body:{active}});render()}catch(e){toast(e.message,'error')}};
window.resetManagerPassword=async id=>{const password=await askDialog({title:'Reset password',label:'New temporary password (minimum 12 characters)',inputType:'password',required:true,minLength:12,confirmLabel:'Reset password'});if(password===null)return;try{await api(`/api/admin/managers/${id}/password`,{method:'POST',body:{password}});toast(t('Password changed','Password changed'),'success')}catch(e){toast(e.message,'error')}};
async function cleanerModal(id){let c=id?(state.cleaners||[]).find(x=>x.id===id):{};modal(id?'Edit cleaner':'Add cleaner',`<form id="cleaner-form" class="form-grid"><div class="field"><label>Full name</label><input class="input" name="fullName" required value="${esc(c?.full_name||'')}"></div><div class="field"><label>Email</label><input class="input" name="email" type="email" required value="${esc(c?.email||'')}"></div>${id?'':`<div class="field"><label>Initial password</label><input class="input" name="password" type="password" minlength="12" placeholder="Temporary password (12+ chars)" required></div>`}<div class="field"><label>Phone</label><input class="input" name="phone" value="${esc(c?.phone||'')}"></div><div class="field"><label>Language</label><select class="select" name="language">${ST_I18N.LANGS.map(l=>`<option value="${l}" ${String(c?.language||'ru')===l?'selected':''}>${ST_I18N.NAMES[l]}</option>`).join('')}</select></div><div class="field"><label>Mode</label><select class="select" name="mode"><option ${c?.mode==='FLEX'?'selected':''}>FLEX</option><option ${c?.mode==='GUARANTEE'?'selected':''}>GUARANTEE</option></select></div><div class="field"><label>Transport</label><select class="select" name="transport">${['CAR','PUBLIC','WALKING'].map(x=>`<option ${c?.transport===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Max jobs/day</label><input class="input" name="maxJobsDay" type="number" min="1" max="20" value="${c?.max_jobs_day||5}"></div><div class="field"><label>Preferred zones (comma separated)</label><input class="input" name="preferredZones" value="${esc((c?.preferred_zones||[]).join(', '))}"></div>${id?`<div class="field"><label>Reliability</label><input class="input" name="reliabilityScore" type="number" min="0" max="100" value="${c.reliability_score}"></div><div class="field"><label>Active</label><select class="select" name="active"><option value="true" ${c.active?'selected':''}>Active</option><option value="false" ${!c.active?'selected':''}>Inactive</option></select></div>`:''}</form>`,`${id?`<button class="btn orange" onclick="resetCleanerPassword(${id})">Reset password</button>`:''}<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveCleaner(${id||0})">Save</button>`)}window.cleanerModal=cleanerModal;
window.setCleanerActive=async(id,active)=>{
  if(!active&&!await askConfirm('Deactivate cleaner','The cleaner can no longer sign in or take jobs. Completed work and payouts stay intact. Reassign their upcoming jobs.','Deactivate'))return;
  try{await api(`/api/admin/cleaners/${id}`,{method:'PATCH',body:{active}});toast(active?t('Account activated','Account activated'):t('Account deactivated','Account deactivated'),'success');render()}catch(e){toast(e.message,'error')}
};
window.resetCleanerPassword=async id=>{const password=await askDialog({title:'Reset password',label:'New temporary password (minimum 12 characters)',inputType:'password',required:true,minLength:12,confirmLabel:'Reset password'});if(password===null)return;try{await api(`/api/admin/cleaners/${id}/password`,{method:'POST',body:{password}});toast('Cleaner password reset','success')}catch(e){toast(e.message,'error')}};
window.saveCleaner=async id=>{const f=new FormData($('#cleaner-form'));const body={fullName:f.get('fullName'),email:f.get('email'),phone:f.get('phone'),language:f.get('language'),mode:f.get('mode'),transport:f.get('transport'),maxJobsDay:Number(f.get('maxJobsDay')),preferredZones:String(f.get('preferredZones')||'').split(',').map(x=>x.trim()).filter(Boolean)};if(id){body.reliabilityScore=Number(f.get('reliabilityScore'));body.active=f.get('active')==='true'}else body.password=f.get('password');try{await api(id?`/api/admin/cleaners/${id}`:'/api/admin/cleaners',{method:id?'PATCH':'POST',body});closeModal();toast('Cleaner saved','success');render()}catch(e){toast(e.message,'error')}};

/* Fix 21: the Review section. The approval queue used to be only a bucket on
   the day board; here it is a screen of its own next to issues and complaints. */
async function adminReviewQueue(){
 shellTitle(t('Review','Review'),t('Reports waiting for your decision','Reports waiting for your decision'));
 const d=await api('/api/admin/jobs?review=PENDING');
 const rows=(d.jobs||[]).filter(j=>j.status==='COMPLETED'&&j.review_status==='PENDING');
 $('#page').innerHTML=`<div class="section-head"><div><h2>${esc(t('Awaiting review','Awaiting review'))}</h2><p>${rows.length} ${esc(t('reports','reports'))}</p></div><button class="btn" onclick="navTo('admin/review/issues')">${esc(t('Issues and complaints','Issues and complaints'))}</button></div>
 ${rows.length?`<div class="card"><div class="table-wrap"><table><thead><tr><th>${esc(t('Date','Date'))}</th><th>${esc(t('Property','Property'))}</th><th>${esc(t('Cleaner','Cleaner'))}</th><th>${esc(t('Completed','Completed'))}</th><th>${esc(t('Proof','Proof'))}</th><th></th></tr></thead><tbody>
 ${rows.map(j=>`<tr><td>${esc(fmtDate(j.service_date))}</td><td><strong>${esc(j.object_code)}</strong><br><small class="subtle">${esc(j.object_name)}</small></td><td>${esc(j.cleaner_name||'—')}</td><td>${esc(fmtStamp(j.completed_at))}</td><td>${Number(j.photo_count||0)} ${esc(t('photos','photos'))}</td><td><button class="btn sm primary" onclick="openAdminJob(${j.id})">${esc(t('Open','Open'))}</button></td></tr>`).join('')}
 </tbody></table></div></div>`:`<div class="card pad"><div class="empty">${esc(t('Nothing is waiting for review.','Nothing is waiting for review.'))}</div></div>`}`;
}
async function adminIssues(){shellTitle('Issues','Operational exceptions and resolution queue');const d=await api('/api/admin/issues');$('#page').innerHTML=`<div class="section-head"><div><h2>Issue queue</h2><p>${d.issues.filter(x=>x.status==='OPEN').length} open</p></div></div><div class="card"><div class="table-wrap"><table><thead><tr><th>Priority</th><th>Object</th><th>Type</th><th>Cleaner</th><th>Description</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${d.issues.map(i=>`<tr><td>${i.priority==='HIGH'?'<span class="pill red">HIGH</span>':'<span class="pill gray">NORMAL</span>'}</td><td><strong>${esc(i.object_code)}</strong></td><td>${esc(i.type)}</td><td>${esc(i.cleaner_name||'—')}</td><td>${esc(i.description||'—')}</td><td>${i.status==='OPEN'?'<span class="pill orange">OPEN</span>':'<span class="pill green">RESOLVED</span>'}</td><td>${fmtStamp(i.created_at)}</td><td>${i.status==='OPEN'?`<button class="btn green sm" onclick="resolveIssue(${i.id})">Resolve</button>`:''}</td></tr>`).join('')||'<tr><td colspan="8"><div class="empty">No issues.</div></td></tr>'}</tbody></table></div></div>`}
window.resolveIssue=async id=>{const note=await askDialog({title:'Resolve issue',label:'Resolution note',value:'Resolved by operations',multiline:true,required:true,confirmLabel:'Resolve'});if(note===null)return;try{await api(`/api/admin/issues/${id}`,{method:'PATCH',body:{status:'RESOLVED',resolutionNote:note}});toast('Issue resolved','success');render()}catch(e){toast(e.message,'error')}};

async function adminTomorrow(){shellTitle('Tomorrow','Capacity reserve and pre-publishing');const date=tomorrow(),d=await api(`/api/admin/capacity?date=${date}`);$('#page').innerHTML=`<div class="section-head"><div><h2>${fmtDate(date)}</h2><p>Pre-plan demand before cleaners start choosing jobs.</p></div><button class="btn primary" onclick="generateJobsModal()">Generate tomorrow jobs</button></div><div class="grid kpis" style="grid-template-columns:repeat(5,1fr)"><div class="card kpi"><div class="label">Planned cleanings</div><div class="value">${d.jobs.length}</div></div><div class="card kpi"><div class="label">Available cleaners</div><div class="value">${d.capacity.cleaners}</div></div><div class="card kpi"><div class="label">Demand hours</div><div class="value">${(d.capacity.demandMinutes/60).toFixed(1)}</div></div><div class="card kpi"><div class="label">Capacity hours</div><div class="value">${(d.capacity.capacityMinutes/60).toFixed(1)}</div></div><div class="card kpi ${d.capacity.health==='RED'?'danger':d.capacity.health==='ORANGE'?'warn':''}"><div class="label">Reserve</div><div class="value">${d.capacity.reservePct}%</div><div class="hint">target ≥ ${state.settings.reserveTargetPct}%</div></div></div><div style="height:14px"></div><div class="two-col"><div class="card pad"><h2 style="margin-top:0">Tomorrow jobs</h2>${jobsTable(d.jobs)}</div><div class="card pad"><h2 style="margin-top:0">Cleaner availability</h2>${d.cleaners.map(c=>`<div class="risk-row"><div class="avatar">${initials(c.full_name)}</div><div><strong>${esc(c.full_name)}</strong><small>${c.mode} · ${c.available?'online/available':'not declared'} · ${c.availability.fromTime}–${c.availability.toTime}</small></div><span class="pill ${c.available?'green':'gray'}">${c.available?'Available':'Unknown'}</span></div>`).join('')||'<div class="empty">No availability for tomorrow yet.</div>'}</div></div>`}

const ANALYTICS_PERIODS=[['7','Last 7 days'],['30','Last 30 days'],['90','Last 90 days'],['month','This month'],['all','All time']];
function analyticsRange(period){
 const to=today();
 if(period==='all')return {from:'2020-01-01',to};
 if(period==='month')return {from:to.slice(0,8)+'01',to};
 const days=Number(period)||30;
 const start=new Date(`${to}T12:00:00Z`);start.setUTCDate(start.getUTCDate()-(days-1));
 return {from:start.toISOString().slice(0,10),to};
}
/* A small inline chart: no library, readable at 390px, and it says plainly when
   there is nothing to draw instead of showing an empty frame. */
function trendChart(series,{key='jobs',label='Cleanings'}={}){
 const points=series.filter(d=>Number.isFinite(Number(d[key])));
 if(points.length<2)return `<div class="empty">${esc(t('Not enough days in this period to draw a trend.','Not enough days in this period to draw a trend.'))}</div>`;
 const w=600,h=140,pad=24;
 const max=Math.max(...points.map(d=>Number(d[key])),1);
 const x=i=>pad+(i*(w-pad*2))/(points.length-1);
 const y=v=>h-pad-((Number(v)||0)*(h-pad*2))/max;
 const line=points.map((d,i)=>`${i?'L':'M'}${x(i).toFixed(1)},${y(d[key]).toFixed(1)}`).join(' ');
 const area=`${line} L${x(points.length-1).toFixed(1)},${h-pad} L${x(0).toFixed(1)},${h-pad} Z`;
 const ticks=[points[0],points[Math.floor(points.length/2)],points[points.length-1]];
 return `<figure class="trend" aria-label="${esc(t(label,label))}">
  <svg viewBox="0 0 ${w} ${h}" role="img" preserveAspectRatio="none">
   <line x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}" class="trend-axis"></line>
   <path d="${area}" class="trend-area"></path>
   <path d="${line}" class="trend-line"></path>
   ${points.map((d,i)=>`<circle cx="${x(i).toFixed(1)}" cy="${y(d[key]).toFixed(1)}" r="2.5" class="trend-dot"><title>${esc(fmtDate(d.date))}: ${Number(d[key])}</title></circle>`).join('')}
  </svg>
  <figcaption>${ticks.map(d=>`<span>${esc(fmtDate(d.date))}</span>`).join('')}</figcaption>
 </figure>`;
}
const kpi=(label,value,hint='')=>`<div class="card kpi"><div class="label">${esc(t(label,label))}</div><div class="value">${esc(String(value))}</div>${hint?`<small class="subtle">${esc(hint)}</small>`:''}</div>`;
const pct=(value,of)=>value===null||value===undefined?'—':`${value}%`;
const mins=value=>value===null||value===undefined?'—':`${value} ${t('min','min')}`;
async function adminAnalytics(period){
 state.analyticsPeriod=period||state.analyticsPeriod||'30';
 const {from,to}=analyticsRange(state.analyticsPeriod);
 shellTitle(t('Analytics','Analytics'),t('Measured from the job history, not estimated','Measured from the job history, not estimated'));
 $('#page').innerHTML=`<div class="empty">${t('Loading…','Loading…')}</div>`;
 const d=await api(`/api/admin/analytics?from=${from}&to=${to}`);
 const s=d.summary,funnelMax=Math.max(...d.funnel.map(step=>step.jobs),1);
 $('#page').innerHTML=`
 <div class="row-actions" style="margin-bottom:12px">${ANALYTICS_PERIODS.map(([value,label])=>`<button class="btn sm ${state.analyticsPeriod===value?'primary':''}" onclick="adminAnalytics('${value}')">${esc(t(label,label))}</button>`).join('')}<span class="subtle">${esc(fmtDate(d.from))} – ${esc(fmtDate(d.to))}</span></div>
 <div class="grid kpis" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">
  ${kpi('Cleanings',s.jobs)}
  ${kpi('Completed',s.completed)}
  ${kpi('On time',pct(s.onTimePct),s.onTimeOf?`${t('of','of')} ${s.onTimeOf}`:t('nothing measurable yet','nothing measurable yet'))}
  ${kpi('Median time to take',mins(s.medianMinutesToAccept),s.acceptedOf?`${t('of','of')} ${s.acceptedOf}`:'')}
  ${kpi('Expired without a cleaner',s.expired,pct(s.unassignedRatePct)==='—'?'':`${pct(s.unassignedRatePct)} ${t('of all','of all')}`)}
  ${kpi('Rescue opened',s.rescue)}
  ${kpi('Escalated to operations',s.escalated)}
  ${kpi('Rework required',pct(s.reworkPct),s.reworkOf?`${t('of','of')} ${s.reworkOf} ${t('completed','completed')}`:'')}
  ${kpi('Check-ins outside the property',s.outsideRadius)}
  ${kpi('Late releases by cleaners',s.lateReleases)}
  ${kpi('Issues',s.issues)}
  ${kpi('Overrun when late',mins(s.medianOverrunMinutes))}
 </div>
 <div style="height:14px"></div>
 <div class="two-col">
  <div class="card pad"><h2 style="margin-top:0">${esc(t('Cleanings per day','Cleanings per day'))}</h2>${trendChart(d.byDate,{key:'jobs',label:'Cleanings per day'})}</div>
  <div class="card pad"><h2 style="margin-top:0">${esc(t('On time per day','On time per day'))}</h2>${trendChart(d.byDate.filter(day=>day.onTimePct!==null),{key:'onTimePct',label:'On time per day'})}</div>
 </div>
 <div style="height:14px"></div>
 <div class="two-col">
  <div class="card pad"><h2 style="margin-top:0">${esc(t('How far cleanings got','How far cleanings got'))}</h2>
   ${d.funnel.map(step=>`<div class="funnel-row"><span class="funnel-label">${esc(t(step.step,step.step))}</span><span class="funnel-bar"><span style="width:${Math.round(step.jobs/funnelMax*100)}%"></span></span><strong>${step.jobs}</strong></div>`).join('')}
   <small class="subtle">${esc(t('Cancelled and expired cleanings stop where they stopped, so the steps always add up.','Cancelled and expired cleanings stop where they stopped, so the steps always add up.'))}</small>
   <div class="detail-grid" style="margin-top:12px"><div class="detail-item"><div class="k">${esc(t('Cancelled by client','Cancelled by client'))}</div><div class="v">${s.cancelledBy.client}</div></div><div class="detail-item"><div class="k">${esc(t('Cancelled by operations','Cancelled by operations'))}</div><div class="v">${s.cancelledBy.operations}</div></div><div class="detail-item"><div class="k">${esc(t('Cancelled otherwise','Cancelled otherwise'))}</div><div class="v">${s.cancelledBy.other}</div></div></div>
  </div>
  <div class="card pad"><h2 style="margin-top:0">${esc(t('Cleaner reliability','Cleaner reliability'))}</h2><div class="table-wrap"><table><thead><tr><th>${esc(t('Cleaner','Cleaner'))}</th><th>${esc(t('Reliability','Reliability'))}</th><th>${esc(t('Rating','Rating'))}</th><th>${esc(t('Completed','Completed'))}</th><th>${esc(t('Reclean','Reclean'))}</th><th>${esc(t('Cancel','Cancel'))}</th></tr></thead><tbody>${d.cleanerRanking.map(c=>`<tr><td><strong>${esc(c.full_name)}</strong></td><td>${Math.round(c.reliability_score)}</td><td>★${c.rating}</td><td>${c.completed_jobs}</td><td>${Number(c.reclean_rate).toFixed(1)}%</td><td>${Number(c.cancellation_rate).toFixed(1)}%</td></tr>`).join('')||`<tr><td colspan="6">${esc(t('No cleaners yet.','No cleaners yet.'))}</td></tr>`}</tbody></table></div></div>
 </div>
 <div style="height:14px"></div>
 <div class="card pad"><h2 style="margin-top:0">${esc(t('Property standards against reality','Property standards against reality'))}</h2>
  <p class="subtle">${esc(t('Worked time is measured from the start of cleaning to completion. A standard far from reality is a planning problem.','Worked time is measured from the start of cleaning to completion. A standard far from reality is a planning problem.'))}</p>
  <div class="table-wrap"><table><thead><tr><th>${esc(t('Property','Property'))}</th><th>${esc(t('Cleanings','Cleanings'))}</th><th>${esc(t('Expired','Expired'))}</th><th>${esc(t('Standard','Standard'))}</th><th>${esc(t('Worked','Worked'))}</th><th>${esc(t('Difference','Difference'))}</th></tr></thead><tbody>
  ${d.objectPerformance.filter(o=>o.jobs).slice(0,25).map(o=>`<tr><td><strong>${esc(o.code)}</strong><br><small class="subtle">${esc(o.name)}</small></td><td>${o.jobs}</td><td>${o.expired||0}</td><td>${o.duration_minutes} ${t('min','min')}</td><td>${o.avg_worked_minutes===null?'—':`${o.avg_worked_minutes} ${t('min','min')}`}</td><td>${o.over_standard_minutes===null?'—':`<span class="pill ${o.over_standard_minutes>10?'red':o.over_standard_minutes<-10?'orange':'green'}">${o.over_standard_minutes>0?'+':''}${o.over_standard_minutes} ${t('min','min')}</span>`}</td></tr>`).join('')||`<tr><td colspan="6">${esc(t('No cleanings in this period.','No cleanings in this period.'))}</td></tr>`}
  </tbody></table></div></div>`;
}
window.adminAnalytics=adminAnalytics;

async function adminSettings(){
 shellTitle(t('Settings','Settings'),t('Operational rules controlling dispatch and SLA','Operational rules controlling dispatch and SLA'));
 const s=(await api('/api/admin/settings')).settings;
 /* Every field below is read by the server (see settings() in st-api); nothing
    here is decoration. The dispatch group is what stage 1 added. */
 const num=(name,label,extra='')=>`<div class="field"><label for="set-${name}">${esc(t(label,label))}</label><input class="input" id="set-${name}" name="${name}" type="number" ${extra} value="${esc(String(s[name]??''))}"></div>`;
 const txt=(name,label,extra='')=>`<div class="field"><label for="set-${name}">${esc(t(label,label))}</label><input class="input" id="set-${name}" name="${name}" ${extra} value="${esc(String(s[name]??''))}"></div>`;
 $('#page').innerHTML=`<div class="card pad" style="max-width:880px"><form id="settings-form" class="form-grid">
  ${txt('companyName','Company')}
  <div class="field"><label for="set-timezone">${esc(t('Timezone','Timezone'))}</label><input class="input" id="set-timezone" value="${esc(String(s.timezone||''))}" disabled></div>
  <h3 class="wide settings-group">${esc(t('Planning','Planning'))}</h3>
  ${txt('windowStart','Default day start','type="time"')}
  ${num('travelBuffer','Travel buffer between cleanings (min)','min="0"')}
  ${num('safetyBuffer','Safety buffer per cleaning (min)','min="0"')}
  ${num('reserveTargetPct','Reserve target %','min="0" max="100"')}
  ${num('checkinRadiusMeters','Check-in radius (m)','min="25"')}
  <h3 class="wide settings-group">${esc(t('Dispatch','Dispatch'))}</h3>
  ${num('managerEscalationHours','Warn operations this many hours before an unassigned cleaning','min="1"')}
  ${num('rescueHours','Open rescue this many hours before the start','min="1"')}
  ${num('rescueBonus','Rescue bonus (€)','min="0" step="0.5"')}
  ${num('cleanerCancellationCutoffMinutes','A cleaner release later than this many minutes before the start counts as late','min="0"')}
  <h3 class="wide settings-group">${esc(t('Notifications','Notifications'))}</h3>
  <div class="field wide"><label for="set-emailNotificationTypes">${esc(t('Notification types sent by email','Notification types sent by email'))}</label><input class="input" id="set-emailNotificationTypes" name="emailNotificationTypes" value="${esc((Array.isArray(s.emailNotificationTypes)?s.emailNotificationTypes:[]).join(', '))}"><small class="subtle">${esc(t('Push is sent for every type. Comma-separated, e.g. CLIENT_BOOKING, RESCUE, EXPIRED.','Push is sent for every type. Comma-separated, e.g. CLIENT_BOOKING, RESCUE, EXPIRED.'))}</small></div>
  ${num('notificationRetryLimit','Delivery attempts before a message is given up','min="1" max="20"')}
  ${num('notificationBatchSize','Messages sent per run','min="1" max="100"')}
  <div class="wide"><button class="btn primary" type="button" onclick="saveSettings()">${esc(t('Save settings','Save settings'))}</button></div>
 </form><div style="height:18px"></div>${notificationCard()}<div style="border-top:1px solid var(--line);padding-top:16px"><strong>${esc(t('Account security','Account security'))}</strong><p class="subtle">${esc(t('Change the password for this administrator account.','Change the password for this administrator account.'))}</p><button class="btn" type="button" onclick="passwordModal()">${esc(t('Change password','Change password'))}</button></div></div>`;
}

/* The saved keys are exactly the editable keys of settings(); the contract test
   tests/settings-contract.test.mjs fails if the two lists drift apart. */
const SETTING_FIELDS={companyName:'text',windowStart:'text',travelBuffer:'number',safetyBuffer:'number',reserveTargetPct:'number',checkinRadiusMeters:'number',managerEscalationHours:'number',rescueHours:'number',rescueBonus:'number',cleanerCancellationCutoffMinutes:'number',emailNotificationTypes:'list',notificationRetryLimit:'number',notificationBatchSize:'number'};
window.saveSettings=async()=>{
 const f=new FormData($('#settings-form'));
 const body={};
 for(const [name,kind] of Object.entries(SETTING_FIELDS)){
  const raw=f.get(name);
  if(raw===null)continue;
  if(kind==='number'){const value=Number(raw);if(!Number.isFinite(value)){toast(t('Enter a number','Enter a number')+`: ${name}`,'error');return}body[name]=value}
  else if(kind==='list')body[name]=String(raw).split(',').map(part=>part.trim().toUpperCase()).filter(Boolean);
  else body[name]=String(raw);
 }
 try{const d=await api('/api/admin/settings',{method:'PATCH',body});state.settings=d.settings;toast(t('Settings saved','Settings saved'),'success')}catch(e){toast(e.message,'error')}
};

async function adminMap(){shellTitle('Operations Map','All objects and today jobs by operational status');const [d,objectsData]=await Promise.all([api('/api/admin/dashboard'),api('/api/admin/objects')]);const points=window.ShineTimeUi.mapPoints(objectsData.objects,d.jobs);$('#page').innerHTML='<div class="card pad"><div id="admin-map" class="map"></div></div><div style="height:14px"></div>'+jobsTable(d.jobs);setTimeout(()=>renderLeaflet('admin-map',points,p=>p.job?openAdminJob(p.id):navTo('admin/objects')),20)}
let leafletPromise=null;function loadLeaflet(){if(window.L)return Promise.resolve(true);if(leafletPromise)return leafletPromise;leafletPromise=new Promise(resolve=>{if(!document.querySelector('link[data-leaflet]')){const css=document.createElement('link');css.rel='stylesheet';css.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';css.dataset.leaflet='1';document.head.appendChild(css)}const script=document.createElement('script');script.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';script.dataset.leaflet='1';let done=false;const finish=ok=>{if(done)return;done=true;resolve(ok&&!!window.L)};script.onload=()=>finish(true);script.onerror=()=>finish(false);document.head.appendChild(script);setTimeout(()=>finish(false),3500)});return leafletPromise}async function renderLeaflet(id,points,onClick){const el=document.getElementById(id);if(!el)return;const ok=await loadLeaflet();if(!ok||!window.L){el.innerHTML=`<div class="pin-fallback" style="padding:12px">${points.map(p=>`<div class="map-list-card"><strong>${esc(p.name)}</strong><small>${esc(p.detail)}</small></div>`).join('')}</div>`;return}if(!document.getElementById(id))return;state.map=L.map(id).setView([48.1486,17.1077],12);L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap'}).addTo(state.map);const bounds=[];points.filter(p=>Number.isFinite(Number(p.lat))&&Number.isFinite(Number(p.lng))).forEach(p=>{const marker=L.marker([Number(p.lat),Number(p.lng)]).addTo(state.map).bindPopup(`<strong>${esc(p.name)}</strong><br>${esc(p.detail||'')}`);if(onClick)marker.on('click',()=>setTimeout(()=>onClick(p),150));bounds.push([Number(p.lat),Number(p.lng)])});if(bounds.length===1)state.map.setView(bounds[0],15);else if(bounds.length>1)state.map.fitBounds(bounds,{padding:[28,28]})}

async function renderCleaner(page){if(page==='home')return cleanerHome();if(page==='jobs')return cleanerJobs();if(page==='map')return cleanerMap();if(page==='myday')return cleanerMyDay();if(page==='earnings')return cleanerEarnings();if(page==='profile')return cleanerProfile();return cleanerHome()}
async function cleanerHeaderAvailability(date=today()){const d=await api(`/api/cleaner/dashboard?date=${date}`);const b=$('#online-toggle');if(b){b.textContent=d.availability.online?'● ONLINE':'○ OFFLINE';b.classList.toggle('on',d.availability.online);b.onclick=()=>toggleOnline(!d.availability.online,d.availability,date)}return d}
async function toggleOnline(online,av,date=today()){try{await api('/api/cleaner/availability',{method:'PATCH',body:{date,online,fromTime:av?.fromTime||'10:00',toTime:av?.toTime||'15:00'}});toast(online?'You are online':'You are offline','success');render()}catch(e){toast(e.message,'error')}}

async function cleanerHome(){const d=await cleanerHeaderAvailability();const active=d.nextJob;$('#page').innerHTML=`<div class="mobile-kpis"><div class="mobile-kpi"><div class="v">${d.total}</div><div class="k">TODAY JOBS</div></div><div class="mobile-kpi"><div class="v">${money(d.earnings)}</div><div class="k">EARNED</div></div><div class="mobile-kpi"><div class="v">${esc(d.projectedFinish||'—')}</div><div class="k">PROJECTED FINISH</div></div></div>${active?`<div class="next-job"><div class="eyebrow">Next cleaning</div><div style="display:flex;justify-content:space-between;gap:10px"><div><h3>${esc(active.object_code)} · ${esc(active.object_name)}</h3><div class="address">${esc(active.address)}</div></div>${deliveryPill(active)}</div><div class="job-meta"><span class="meta-chip">◷ ${active.duration_minutes} min</span><span class="meta-chip">⌖ ${esc(active.zone)}</span><span class="meta-chip">${money(Number(active.payout)+Number(active.bonus))}</span><span class="meta-chip">ETA ${esc(active.projected_finish||active.eta||'—')}</span></div><button class="btn primary full" onclick="navTo('cleaner/job/${active.id}')">Open cleaning</button></div>`:`<div class="next-job"><div class="eyebrow">You're clear</div><h3>No assigned cleaning right now</h3><p class="subtle">Choose work from the marketplace. Choose work that fits your availability and each property’s service window.</p><button class="btn primary full" onclick="navTo('cleaner/jobs')">Browse jobs</button></div>`}<div class="section-head" style="margin-top:18px"><div><h2>Your day</h2><p>${d.availability.fromTime}–${d.availability.toTime}</p></div><button class="btn sm" onclick="editAvailability('${d.availability.fromTime}','${d.availability.toTime}',${d.availability.online})">Availability</button></div>${miniDay(d.jobs)}`}
window.editAvailability=(from,to,online,date=today())=>modal(`${date===today()?'Today':'Tomorrow'} availability`,`<form id="av-form" class="form-grid"><input type="hidden" name="date" value="${date}"><div class="field"><label>From</label><input class="input" type="time" name="fromTime" value="${from}"></div><div class="field"><label>To</label><input class="input" type="time" name="toTime" value="${to}"></div><div class="field wide"><label>Status</label><select class="select" name="online"><option value="true" ${online?'selected':''}>Online</option><option value="false" ${!online?'selected':''}>Offline</option></select></div></form>`,`<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveAvailability()">Save</button>`);
window.saveAvailability=async()=>{const f=new FormData($('#av-form'));try{await api('/api/cleaner/availability',{method:'PATCH',body:{date:f.get('date'),online:f.get('online')==='true',fromTime:f.get('fromTime'),toTime:f.get('toTime')}});closeModal();toast('Availability updated','success');render()}catch(e){toast(e.message,'error')}};
function miniDay(jobs){return jobs.length?`<div class="myday-line">${jobs.map(j=>`<div class="day-job ${j.status==='COMPLETED'?'done':['CLEANING','ARRIVED','EN_ROUTE'].includes(j.status)?'active':''}" onclick="navTo('cleaner/job/${j.id}')"><div style="display:flex;justify-content:space-between"><strong>${esc(j.object_code)}</strong>${deliveryPill(j)}</div><div class="address">${esc(j.zone)} · ${esc(j.projected_start||j.planned_start)}–${esc(j.projected_finish||j.eta||'—')}</div></div>`).join('')}</div>`:'<div class="job-card"><div class="empty">No jobs accepted yet.</div></div>'}

function dayList(n){const out=[];for(let i=0;i<n;i++){const d=new Date(Date.parse(today()+'T12:00:00Z')+i*864e5);out.push(d.toISOString().slice(0,10))}return out}
function dayChip(date){if(date===today())return t('Today','Today');if(date===tomorrow())return t('Tomorrow','Tomorrow');try{return new Intl.DateTimeFormat(intlLocale(),{weekday:'short',day:'numeric'}).format(new Date(date+'T12:00:00'))}catch{return date}}
function startOptions(from,to){const out=[];if(!from||!to)return out;let [h,m]=from.split(':').map(Number);const [eh,em]=to.split(':').map(Number);while(h*60+m<=eh*60+em&&out.length<64){out.push(`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`);m+=15;if(m>=60){h++;m-=60}}return out}
async function cleanerJobs(){const date=state.marketDate||today();const [d,m]=await Promise.all([cleanerHeaderAvailability(date),api(`/api/cleaner/marketplace?date=${date}`)]);const days=dayList(7);
$('#page').innerHTML=`<div class="day-chips" role="tablist">${days.map(x=>`<button class="btn sm ${x===date?'primary':''}" role="tab" aria-selected="${x===date}" onclick="setCleanerMarketDate('${x}')">${esc(dayChip(x))}</button>`).join('')}</div>
<div class="section-head"><div><h2>${t('Available cleanings','Available cleanings')}</h2><p>${t('Pick a job and the time you will start inside the client window.','Pick a job and the time you will start inside the client window.')}</p></div><span class="pill green">${m.jobs.filter(x=>x.feasible).length} ${t('feasible','feasible')}</span></div>
${m.jobs.map(j=>{const opts=startOptions(j.earliest_feasible_start,j.latest_start);return `<div class="job-card"><div class="head"><div><h3>${esc(j.object_code)} · ${esc(j.zone)}</h3><div class="address">${t('Window','Window')} ${esc(String(j.earliest_start||'').slice(0,5))}–${esc(String(j.deadline||'').slice(0,5))} · ${Number(j.duration_minutes)} ${t('min','min')}${j.apartment_type?` · ${esc(j.apartment_type)}`:''}</div></div><div style="text-align:right"><div class="price">${money(Number(j.payout)+Number(j.bonus))}</div>${Number(j.bonus)?`<div class="bonus">${t('Urgent','Urgent')} +${money(j.bonus)}</div>`:''}</div></div>${j.client_note?`<p class="subtle">“${esc(j.client_note)}”</p>`:''}${j.feasible?`<div class="take-row"><label class="subtle" for="start-${j.id}">${t('I start at','I start at')}</label><select class="select" id="start-${j.id}">${opts.map(o=>`<option ${o===j.earliest_feasible_start?'selected':''}>${o}</option>`).join('')}</select><button class="btn primary" onclick="acceptJob(${j.id},'${date}')">${t('Take cleaning','Take cleaning')}</button></div>`:`<button class="btn full" disabled>${esc(t(j.feasibility_reason||'Not feasible',j.feasibility_reason||'Not feasible'))}</button>`}</div>`}).join('')||`<div class="job-card"><div class="empty">${t('No open cleanings for this day.','No open cleanings for this day.')}</div></div>`}`}
window.setCleanerMarketDate=date=>{state.marketDate=date;render()};
window.acceptJob=async(id,date=today())=>{const plannedStart=$(`#start-${id}`)?.value;try{await api(`/api/cleaner/jobs/${id}/accept`,{method:'POST',body:plannedStart?{plannedStart}:{}});state.myDayDate=date;toast(t('Cleaning added to My Day','Cleaning added to My Day'),'success');render()}catch(e){toast(e.message,'error')}};
window.takeBundle=async(ids,date=today())=>{for(const id of String(ids).split(',').map(Number)){try{await api(`/api/cleaner/jobs/${id}/accept`,{method:'POST',body:{}})}catch(e){toast(`Route stopped: ${e.message}`,'error');return}}state.myDayDate=date;toast('Route accepted','success');navTo('cleaner/myday')};

async function cleanerMyDay(){const date=state.myDayDate||today();const d=await cleanerHeaderAvailability(date);const dayName=date===today()?'Today':'Tomorrow';$('#page').innerHTML=`<div class="toolbar" style="margin-bottom:12px"><button class="btn sm ${date===today()?'primary':''}" onclick="setMyDayDate('${today()}')">Today</button><button class="btn sm ${date===tomorrow()?'primary':''}" onclick="setMyDayDate('${tomorrow()}')">Tomorrow</button></div><div class="section-head"><div><h2>${dayName} · My Day</h2><p>${t('Projected finish','Projected finish')} ${esc(d.projectedFinish||'—')}${d.jobs.length?` · ${t('latest deadline','latest deadline')} ${esc(d.jobs.map(j=>String(j.deadline||'').slice(0,5)).filter(Boolean).sort().at(-1)||'—')}`:''}</p></div></div>${miniDay(d.jobs)}<div class="job-card"><div class="detail-grid"><div class="detail-item"><div class="k">Jobs</div><div class="v">${d.total}</div></div><div class="detail-item"><div class="k">Earned completed</div><div class="v">${money(d.earnings)}</div></div></div></div>`}
window.setMyDayDate=date=>{state.myDayDate=date;cleanerMyDay()};
async function cleanerEarnings(){
 await cleanerHeaderAvailability();
 const d=await api('/api/cleaner/earnings');
 const e=d.earnings||{};
 const cents=v=>money(Number(v||0)/100);
 $('#page').innerHTML=`<div class="mobile-kpis earnings-kpis">
  <div class="mobile-kpi"><div class="v">${cents(e.week)}</div><div class="k">${t('This week','This week')}</div><small>${e.completedWeek||0} ${t('cleanings','cleanings')}</small></div>
  <div class="mobile-kpi"><div class="v">${cents(e.month)}</div><div class="k">${t('This month','This month')}</div><small>${e.completedMonth||0} ${t('cleanings','cleanings')}</small></div>
  <div class="mobile-kpi"><div class="v">${cents(e.waitingReview)}</div><div class="k">${t('Waiting for review','Waiting for review')}</div><small>${t('paid after approval','paid after approval')}</small></div>
  <div class="mobile-kpi"><div class="v">${cents(e.payable)}</div><div class="k">${t('Ready to be paid','Ready to be paid')}</div><small>${t('approved, not paid yet','approved, not paid yet')}</small></div>
  <div class="mobile-kpi"><div class="v">${cents(e.paid)}</div><div class="k">${t('Already paid','Already paid')}</div></div>
  <div class="mobile-kpi"><div class="v">★ ${Number(e.rating||0).toFixed(2)}</div><div class="k">${t('Rating','Rating')}</div><small>${t('Reliability','Reliability')} ${Math.round(Number(e.reliability||0))}</small></div>
 </div>
 <small class="subtle">${t('This week from','This week from')} ${fmtDate(e.weekStart)} · ${t('this month from','this month from')} ${fmtDate(e.monthStart)}. ${t('Amounts are base payout plus bonus.','Amounts are base payout plus bonus.')}</small>
 <button class="btn full" style="margin-top:12px" onclick="navTo('cleaner/settlements')">${t('Payments by month','Payments by month')}</button>
 <div class="section-head" style="margin-top:18px"><div><h2>${t('Completed cleanings','Completed cleanings')}</h2><p>${t('Base payout + rescue bonus','Base payout + rescue bonus')}</p></div></div>
 ${d.jobs.map(j=>`<div class="job-card"><div class="head"><div><h3>${esc(j.object_code)} · ${esc(j.object_name)}</h3><div class="address">${fmtDate(j.service_date)} · ${esc(j.zone||'')}</div>${reviewPill(j)}${j.feedback_rating?` <span class="pill ${Number(j.feedback_rating)>=4?'green':Number(j.feedback_rating)>=3?'orange':'red'}">★ ${j.feedback_rating}</span>`:''}</div><div style="text-align:right"><div class="price">${money(Number(j.payout)+Number(j.bonus))}</div>${j.bonus?`<div class="bonus">+${money(j.bonus)} ${t('bonus','bonus')}</div>`:''}</div></div></div>`).join('')||`<div class="job-card"><div class="empty">${t('No completed cleanings yet.','No completed cleanings yet.')}</div></div>`}`;
}
async function cleanerProfile(){const d=await cleanerHeaderAvailability();$('#page').innerHTML=`<div class="job-card"><div style="display:flex;align-items:center;gap:12px"><div class="avatar" style="width:52px;height:52px;font-size:17px">${initials(state.me.full_name)}</div><div><h2 style="margin:0">${esc(state.me.full_name)}</h2><div class="address">${esc(state.me.email)}</div></div></div><div class="detail-grid" style="margin-top:15px"><div class="detail-item"><div class="k">Mode</div><div class="v">${esc(state.me.cleaner_mode)}</div></div><div class="detail-item"><div class="k">Reliability</div><div class="v">${Math.round(state.me.reliability_score||0)}/100</div></div><div class="detail-item"><div class="k">Rating</div><div class="v">★ ${state.me.rating||'—'}</div></div><div class="detail-item"><div class="k">Transport</div><div class="v">${esc(state.me.transport||'—')}</div></div><div class="detail-item wide"><div class="k">Preferred zones</div><div class="v">${(state.me.preferred_zones||[]).map(x=>`<span class="pill gray">${esc(x)}</span>`).join(' ')||'—'}</div></div></div></div><div class="job-card"><strong>Availability today</strong><p class="subtle">${d.availability.fromTime}–${d.availability.toTime} · ${d.availability.online?'ONLINE':'OFFLINE'}</p><button class="btn full" onclick="editAvailability('${d.availability.fromTime}','${d.availability.toTime}',${d.availability.online})">Edit availability</button></div>${notificationCard()}<div class="job-card"><strong>Account security</strong><p class="subtle">Use a personal password instead of the initial password sent by operations.</p><button class="btn full" onclick="passwordModal()">Change password</button></div><button class="btn red full" onclick="logout()">Sign out</button>`}
async function cleanerMap(){const [d,m]=await Promise.all([cleanerHeaderAvailability(),api('/api/cleaner/marketplace')]);const points=[...d.jobs.map(j=>({lat:j.lat,lng:j.lng,name:`${j.object_code} · ${j.status}`,detail:j.address,id:j.id,assigned:true})),...m.jobs.map(j=>({lat:j.lat,lng:j.lng,name:`${j.object_code} · available`,detail:`${j.zone} · ${money(Number(j.payout)+Number(j.bonus))}`,id:j.id,assigned:false}))];$('#page').innerHTML=`<div id="cleaner-map" class="map compact"></div><div style="height:10px"></div><div class="job-card"><strong>Map legend</strong><p class="subtle">Assigned jobs include full address. Marketplace access instructions remain hidden until you take the cleaning.</p></div>`;setTimeout(()=>renderLeaflet('cleaner-map',points,p=>p.assigned?navTo(`cleaner/job/${p.id}`):null),20)}

async function cleanerJobDetail(id){await cleanerHeaderAvailability();const j=await api(`/api/cleaner/jobs/${id}`);state.activeChecklist=j;if(['COMPLETED','CANCELLED'].includes(j.status)&&checklistDrafts){const pending=checklistDrafts.list(state.me.id,j.id);checklistDrafts.clearJob(state.me.id,j.id);if(pending.length)toast(t('Job changed. Local checklist changes were discarded.','Job changed. Local checklist changes were discarded.'),'error')}const required=j.checklist.filter(x=>x.required).length,done=j.checklist.filter(x=>x.required&&x.completed).length;const requiredCats=[...new Set(j.checklist.filter(x=>x.photo_required).map(x=>x.photo_category))];const photoCats=new Set(j.photos.filter(x=>x.mime?.startsWith('image/')).map(x=>x.category));$('#page').className='';$('#page').innerHTML=`<div class="active-job-head"><button class="back" onclick="navTo('cleaner/myday')">← My Day</button><h2>${esc(j.object_code)} · ${esc(j.object_name)}</h2><div class="address" style="color:#b7c0cf">${esc(j.address)}</div>${['COMPLETED','CANCELLED'].includes(j.status)?'':mapsLinks(j.address,j.lat,j.lng)}<div class="job-meta">${deliveryPill(j)} ${riskPill(j.risk_level,j.risk_score)} <span class="meta-chip">${money(Number(j.payout)+Number(j.bonus))}</span><span class="meta-chip">${t('Window','Window')} ${esc(String(j.earliest_start||j.planned_start||'').slice(0,5))}–${esc(String(j.deadline||'').slice(0,5))}</span></div></div><div class="active-job-body">${j.review_status==='REWORK_REQUIRED'?`<div class="instruction rework-note"><h4>${t('Rework required','Rework required')}</h4><p>${esc(j.review_note||'')}</p></div>`:''}${j.client_note?`<div class="instruction rework-note"><h4>${t('Client note','Client note')}</h4><p>${esc(j.client_note)}</p></div>`:''}${['ACCEPTED','EN_ROUTE','ARRIVED','CLEANING'].includes(j.status)?propertyPhotoCard(j.id,true):''}<div id="checklist-sync"></div><div class="instruction"><h4>Access</h4><p>${esc(j.access_instructions||'No instructions')}</p></div><div class="detail-grid" style="margin-bottom:10px"><div class="detail-item"><div class="k">Key</div><div class="v">${esc(j.key_instructions||'—')}</div></div><div class="detail-item"><div class="k">Parking</div><div class="v">${esc(j.parking||'—')}</div></div><div class="detail-item"><div class="k">Linen</div><div class="v">${esc(j.linen_location||'—')}</div></div><div class="detail-item"><div class="k">Supplies</div><div class="v">${esc(j.supplies_location||'—')}</div></div></div><div class="instruction"><div style="display:flex;justify-content:space-between;align-items:center"><h4 style="margin:0">Cleaning checklist</h4><strong>${done}/${required}</strong></div><div class="meter" style="margin:10px 0 3px"><span style="width:${required?done/required*100:100}%"></span></div>${j.checklist.map(i=>`<div class="check-item"><button data-check-item="${i.id}" ${['COMPLETED','CANCELLED'].includes(j.status)?'disabled':''} aria-pressed="${!!i.completed}" class="check-btn ${i.completed?'done':''}" onclick="toggleCheck(${j.id},${i.id},${!i.completed})">${i.completed?'✓':''}</button><span>${esc(i.label)}${i.required?' <span class="subtle">*</span>':''}</span>${i.photo_required?`<span class="photo-tag">📷 ${esc(i.photo_category)}</span>`:''}</div>`).join('')}</div><div class="instruction"><h4>Required photo proof</h4><div class="photo-grid">${requiredCats.map(c=>{const ph=j.photos.find(p=>p.category===c&&p.mime?.startsWith('image/'));return `<label class="photo-slot ${ph?'done':''}" style="${ph?'padding:0;overflow:hidden;display:block':''}">${ph?`<img src="${esc(ph.url)}" alt="${esc(c)}" style="width:100%;height:82px;object-fit:cover;display:block"><span style="display:block;padding:5px">✓ ${esc(c)}</span>`:`<span>＋<br>${esc(c)}</span><input hidden ${['COMPLETED','CANCELLED'].includes(j.status)?'disabled':''} type="file" accept="image/*" onchange="uploadProof(${j.id},${esc(JSON.stringify(c))},this)">`}</label>`}).join('')}</div></div><div class="instruction"><h4>Additional report</h4><div class="photo-grid">${j.photos.filter(p=>p.category==='Additional').map(p=>proofMedia(p)).join('')}</div>${!['COMPLETED','CANCELLED'].includes(j.status)?`<label class="btn">Add photo or video<input hidden type="file" accept="image/*,video/mp4,video/webm" onchange="uploadProof(${j.id},'Additional',this)"></label>`:''}</div>${j.issues.length?`<div class="instruction"><h4>Issues</h4>${j.issues.map(i=>`<div class="risk-row ${i.status==='OPEN'?'orange':''}"><div class="risk-score" style="width:36px;height:36px">!</div><div><strong>${esc(i.type)}</strong><small>${esc(i.description||'')} · ${esc(i.status)}</small></div></div>`).join('')}</div>`:''}<div class="instruction"><h4>Notes</h4><p>${esc(j.object_notes||'No special notes.')}</p></div></div><div class="sticky-action">${jobActionButtons(j,done,required,requiredCats,photoCats)}</div>`;paintChecklistDrafts(j)}
function jobActionButtons(j,done,required,requiredCats,photoCats){const completeReady=done===required&&requiredCats.every(x=>photoCats.has(x));if(j.status==='COMPLETED')return `<button class="btn green full" disabled>${t(j.review_status==='PENDING'?'Awaiting review':j.review_status==='APPROVED'?'Report approved':'Completed',j.review_status==='PENDING'?'Awaiting review':j.review_status==='APPROVED'?'Report approved':'Completed')}</button>`;if(['CANCELLED','EXPIRED'].includes(j.status))return `<button class="btn full" disabled>${t(j.status==='EXPIRED'?'Expired':'Cancelled',j.status==='EXPIRED'?'Expired':'Cancelled')}</button>`;if(j.status==='ACCEPTED')return `<button class="btn red" onclick="cancelCleanerJob(${j.id})">Can't do</button><button class="btn" onclick="reportIssue(${j.id})">Issue</button><button class="btn primary" onclick="jobStatus(${j.id},'EN_ROUTE')">I'm on my way</button>`;if(j.status==='EN_ROUTE')return `<button class="btn red" onclick="cancelCleanerJob(${j.id})">Can't do</button><button class="btn" onclick="reportIssue(${j.id})">Issue</button><button class="btn primary" onclick="checkInJob(${j.id})">Arrived / Check in</button>`;if(j.status==='ARRIVED')return `<button class="btn" onclick="reportIssue(${j.id})">Issue</button><button class="btn primary" onclick="jobStatus(${j.id},'CLEANING')">Start cleaning</button>`;return `<button class="btn" onclick="reportIssue(${j.id})">Issue</button><button class="btn green" ${completeReady?'':'disabled'} onclick="completeJob(${j.id})">${t('Submit report','Submit report')}</button>`}
window.cancelCleanerJob=async id=>{const reason=await askDialog({title:'Release this cleaning back to Operations?',message:'Operations will be notified. A late cancellation opens a rescue.',label:'Why can’t you do this cleaning?',multiline:true,required:true,confirmLabel:'Release cleaning',danger:true});if(reason===null)return;try{const d=await api(`/api/cleaner/jobs/${id}/cancel`,{method:'POST',body:{reason}});toast(t('Cleaning released. Operations has been notified.','Cleaning released. Operations has been notified.'),'success');navTo('cleaner/myday')}catch(e){toast(e.message,'error')}};
window.jobStatus=async(id,status)=>{try{await api(`/api/cleaner/jobs/${id}/status`,{method:'POST',body:{status}});toast(t({EN_ROUTE:'On the way',ARRIVED:'Checked in',CLEANING:'Cleaning started'}[status]||status,{EN_ROUTE:'On the way',ARRIVED:'Checked in',CLEANING:'Cleaning started'}[status]||status),'success');await render()}catch(e){toast(e.message,'error')}};
window.checkInJob=id=>{if(navigator.geolocation)navigator.geolocation.getCurrentPosition(async pos=>{try{const d=await api(`/api/cleaner/jobs/${id}/status`,{method:'POST',body:{status:'ARRIVED',lat:pos.coords.latitude,lng:pos.coords.longitude}});toast(d.warning||'Checked in',d.warning?'error':'success');await render()}catch(e){toast(e.message,'error')}},()=>jobStatus(id,'ARRIVED'),{enableHighAccuracy:true,timeout:6000});else jobStatus(id,'ARRIVED')};
function paintChecklistDrafts(j=state.activeChecklist){
  if(!j||!state.me||!checklistDrafts)return;
  const host=$('#checklist-sync');if(!host)return;
  let pending=[];
  try{pending=checklistDrafts.list(state.me.id,j.id)}catch(e){host.innerHTML=`<p role="alert">${t('Cannot save checklist on this device','Cannot save checklist on this device')}</p>`;return;}
  const edits=new Map(pending.map(i=>[String(i.itemId),i.completed]));
  for(const item of j.checklist){const button=$(`[data-check-item="${item.id}"]`);if(!button)continue;const value=edits.has(String(item.id))?edits.get(String(item.id)):item.completed;button.classList.toggle('done',value);button.textContent=value?'✓':'';button.setAttribute('aria-pressed',String(!!value));button.disabled=['COMPLETED','CANCELLED'].includes(j.status);button.onclick=()=>toggleCheck(j.id,item.id,!value);}
  host.innerHTML=pending.length?`<div class="draft-notice" data-checklist-sync="pending" role="status"><strong>${t('Checklist saved on this phone','Checklist saved on this phone')}</strong><p>${pending.length} · ${t('Waiting for server confirmation','Waiting for server confirmation')}</p><button class="btn sm" onclick="syncChecklist(${Number(j.id)})">${t('Sync checklist','Sync checklist')}</button></div>`:'';
  if(pending.length)for(const button of $$('.sticky-action button'))if(button.getAttribute('onclick')?.includes('completeJob'))button.disabled=true;
}
window.toggleCheck=async(jobId,itemId,completed)=>{
  if(!state.me||!checklistDrafts)return;
  try{checklistDrafts.set(state.me.id,jobId,itemId,completed);paintChecklistDrafts();if(navigator.onLine)await syncChecklist(jobId)}catch(e){toast(t('Cannot save checklist on this device','Cannot save checklist on this device'),'error')}
};
window.syncChecklist=async jobId=>{
  if(!state.me||!checklistDrafts)return;
  const userId=state.me.id,session=checklistSession;
  try{const result=await checklistDrafts.flush({userId,jobId,loadJob:id=>api(`/api/cleaner/jobs/${id}`),saveItem:(jobId,itemId,completed)=>api(`/api/cleaner/jobs/${jobId}/checklist/${itemId}`,{method:'PATCH',body:{completed}}),isCurrent:()=>state.me?.id===userId&&checklistSession===session});
    if(state.me?.id!==userId||checklistSession!==session)return;
    if(result.conflicts.length)toast(t('Job changed. Local checklist changes were discarded.','Job changed. Local checklist changes were discarded.'),'error');
    if(route()===`cleaner/job/${jobId}`){if(result.offline)paintChecklistDrafts();else{await render();if(result.pending.length&&!result.cancelled)queueMicrotask(()=>{if(state.me?.id===userId&&checklistSession===session)syncChecklist(jobId)});}}
  }catch(e){toast(t('Cannot save checklist on this device','Cannot save checklist on this device'),'error')}
};
window.addEventListener('online',()=>{if(state.me?.role==='CLEANER'&&route().startsWith('cleaner/job/'))syncChecklist(Number(route().split('/')[2]))});

window.uploadProof=async(jobId,category,input)=>{const file=input.files?.[0];if(!file||state.uploading)return;state.uploading=true;input.disabled=true;try{let prepared=file;if(!file.type.startsWith('video/')){const data=await compressProof(file);const blob=await (await fetch(data)).blob();prepared=new File([blob],(file.name||'photo').replace(/\.[^.]+$/,'')+'.jpg',{type:'image/jpeg'})}else if(!['video/mp4','video/webm'].includes(file.type)||file.size>50*1024*1024)throw new Error('Video must be MP4 or WebM under 50 MB');await window.ShineTimeSupabase.uploadProofFile(jobId,category,prepared,stage=>toast(t(stage,stage),'info'));toast(`${category} uploaded`,'success');state.uploading=false;await render()}catch(e){toast(e.message||'Photo upload failed','error')}finally{state.uploading=false;input.disabled=false}};async function compressProof(file){if(file.size>12*1024*1024)throw new Error('Photo must be under 12 MB');const url=URL.createObjectURL(file);try{const img=await new Promise((resolve,reject)=>{const i=new Image();i.onload=()=>resolve(i);i.onerror=()=>reject(new Error('Cannot read photo'));i.src=url});const max=1600,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight)),w=Math.max(1,Math.round(img.naturalWidth*scale)),h=Math.max(1,Math.round(img.naturalHeight*scale));const c=document.createElement('canvas');c.width=w;c.height=h;const ctx=c.getContext('2d');ctx.drawImage(img,0,0,w,h);return c.toDataURL('image/jpeg',.82)}finally{URL.revokeObjectURL(url)}}
window.reportIssue=id=>modal('Report issue',`<form id="issue-form" class="form-grid"><div class="field wide"><label>Type</label><select class="select" name="type">${['Damage','Missing linen','Guest still inside','Extreme dirt','Missing key','Maintenance','Missing supplies','Other'].map(x=>`<option>${x}</option>`).join('')}</select></div><div class="field wide"><label>Description</label><textarea class="textarea" name="description" placeholder="What happened?"></textarea></div></form>`,`<button class="btn" onclick="closeModal()">Cancel</button><button class="btn red" onclick="submitIssue(${id})">Send issue</button>`);
window.submitIssue=async id=>{const f=new FormData($('#issue-form'));try{await api(`/api/cleaner/jobs/${id}/issues`,{method:'POST',body:{type:f.get('type'),description:f.get('description')}});closeModal();toast('Operations notified','success');await render()}catch(e){toast(e.message,'error')}};
window.completeJob=async id=>{try{if(checklistDrafts?.list(state.me.id,id).length)return toast(t('Sync the checklist before submitting','Sync the checklist before submitting'),'error');await api(`/api/cleaner/jobs/${id}/complete`,{method:'POST',body:{}});toast(t('Report submitted for review','Report submitted for review'),'success');navTo('cleaner/myday')}catch(e){if(e.data?.missingPhotos?.length)toast(`Missing photos: ${e.data.missingPhotos.join(', ')}`,'error');else toast(e.message,'error')}};


async function renderClient(page){
    if(page==='home')return clientHome();
    if(page==='book')return clientBook();
    if(page==='objects')return clientObjects();
    if(page==='bookings')return clientBookings();
    if(page==='recurring')return clientRecurring();
    if(page==='finance'){
      return clientFinance();
    }
    if(page==='profile')return clientProfile();
    return clientHome();
}

async function clientHome(){const d=await api('/api/client/dashboard');$('#page').innerHTML=`<div class="client-welcome"><span class="eyebrow">Shine Time</span><h2>${esc(state.me.company_name||state.me.full_name)}</h2><p>Your team. Every job. In sync.</p></div><div class="mobile-kpis"><div class="job-card mini"><span>Objects</span><strong>${d.objects.total}</strong><small>${d.objects.approved} Approved</small></div><div class="job-card mini"><span>Pending approval</span><strong>${d.objects.pending}</strong><small>Awaiting Operations</small></div><div class="job-card mini"><span>Upcoming cleanings</span><strong>${d.upcoming.length}</strong><small>${d.completedToday} Completed today</small></div></div>${d.nextBooking?`<div class="section-head client-section"><div><h2>Next cleaning</h2><p>${fmtDate(d.nextBooking.service_date)}</p></div></div><button class="job-card client-next" onclick="navTo('client/booking/${d.nextBooking.id}')"><div class="job-card-top"><div><strong>${esc(d.nextBooking.object_code)} · ${esc(d.nextBooking.object_name)}</strong><span>${esc(d.nextBooking.address)}</span></div>${statusPill(d.nextBooking.status)}</div><div class="route-line"><span>${esc(d.nextBooking.planned_start||d.nextBooking.earliest_start)} → ${esc(d.nextBooking.deadline)}</span><strong>${money(Number(d.nextBooking.client_price)+Number(d.nextBooking.extra_revenue||0))}</strong></div></button>`:`<div class="job-card"><strong>No upcoming cleanings.</strong><p class="subtle">Reserve your next cleaning when you are ready.</p><button class="btn primary full" onclick="navTo('client/book')">Book Cleaning</button></div>`}<div class="section-head client-section"><div><h2>Upcoming cleanings</h2></div><button class="btn sm" onclick="navTo('client/bookings')">Open</button></div>${d.upcoming.slice(0,5).map(b=>`<button class="job-card compact-card" onclick="navTo('client/booking/${b.id}')"><div><strong>${fmtDate(b.service_date)} · ${esc(b.object_code)}</strong><span>${esc(b.planned_start||b.earliest_start)} · ${esc(b.address)}</span></div>${deliveryPill(b)}</button>`).join('')||'<div class="job-card"><span class="subtle">No bookings yet.</span></div>'}`}

async function clientObjects(){const d=await api('/api/client/objects');state.clientObjects=d.objects;$('#page').innerHTML=`<div class="section-head client-section"><div><h2>My properties</h2><p>Add a property and wait for Operations approval before booking.</p></div><button class="btn primary" onclick="clientObjectModal()">+ Add property</button></div>${d.objects.map(o=>`<div class="job-card">${propertyPhotoCard(o.id)}<div class="job-card-top"><div><strong>${esc(o.code)} · ${esc(o.name)}</strong><span>${esc(o.address)} · ${esc(o.zone)}</span></div>${o.approval_status==='APPROVED'&&o.active?'<span class="pill green">Approved</span>':o.approval_status==='PENDING'?'<span class="pill orange">Pending approval</span>':'<span class="pill gray">'+esc(o.approval_status)+'</span>'}</div><div class="detail-grid" style="margin-top:10px"><div class="detail-item"><div class="k">Type</div><div class="v">${esc(o.apartment_type)}</div></div><div class="detail-item"><div class="k">Price per cleaning</div><div class="v">${Number(o.client_price)>0?money(o.client_price):'—'}</div></div></div><div class="job-actions"><button class="btn sm" onclick="clientObjectModal(${o.id})">Edit</button>${o.approval_status==='APPROVED'&&o.active?`<button class="btn primary sm" onclick="navTo('client/book?object=${o.id}')">Book Cleaning</button>`:''}</div></div>`).join('')||'<div class="job-card"><div class="empty">No properties yet.</div></div>'}`}

window.clientObjectModal=async id=>{try{const o=id?(await api(`/api/client/objects/${id}`)).object:{};modal(id?'Edit property':'Add property',`<form id="client-object-form" class="form-grid"><div class="field"><label>Name</label><input class="input" name="name" required value="${esc(o.name||'')}"></div>${id?`<div class="field"><label>Code</label><input class="input" value="${esc(o.code||'')}" disabled></div>`:''}<div class="field wide"><label>Address</label><input class="input" name="address" required value="${esc(o.address||'')}"></div><div class="field"><label>Zone</label><input class="input" name="zone" required value="${esc(o.zone||'')}"></div><div class="field"><label>Apartment type</label><input class="input" name="apartmentType" value="${esc(o.apartment_type||'Apartment')}"></div><div class="field"><label>Bedrooms</label><input class="input" type="number" min="0" name="bedrooms" value="${o.bedrooms??1}"></div><div class="field"><label>Bathrooms</label><input class="input" type="number" min="1" name="bathrooms" value="${o.bathrooms??1}"></div><div class="field"><label>Latitude</label><input class="input" name="lat" type="text" inputmode="decimal" autocomplete="off" placeholder="48.177333" value="${o.lat??''}"></div><div class="field"><label>Longitude</label><input class="input" name="lng" type="text" inputmode="decimal" autocomplete="off" placeholder="17.126286" value="${o.lng??''}"></div>${geoActions()}<div class="field wide"><label>Access instructions</label><textarea class="textarea" name="accessInstructions">${esc(o.access_instructions||'')}</textarea></div><div class="field"><label>Key instructions</label><textarea class="textarea" name="keyInstructions">${esc(o.key_instructions||'')}</textarea></div><div class="field"><label>Parking</label><textarea class="textarea" name="parking">${esc(o.parking||'')}</textarea></div><div class="field"><label>Linen location</label><input class="input" name="linenLocation" value="${esc(o.linen_location||'')}"></div><div class="field"><label>Supplies location</label><input class="input" name="suppliesLocation" value="${esc(o.supplies_location||'')}"></div><div class="field wide"><label>Notes</label><textarea class="textarea" name="notes">${esc(o.notes||'')}</textarea></div>${id&&o.approval_status==='APPROVED'?'<div class="wide notice-inline">Changing the address or basic property parameters sends the object back to Operations for approval.</div>':''}</form>`,`<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="saveClientObject(${id||0})">Save</button>`)}catch(e){toast(e.message,'error')}};
window.saveClientObject=async id=>{const f=new FormData($('#client-object-form'));let coordinates;try{coordinates=coordinatesFrom(f)}catch(e){return toast(e.message,'error')}const body={name:f.get('name'),address:f.get('address'),zone:f.get('zone'),serviceCategory:f.get('serviceCategory')||'SHORT_STAY',apartmentType:f.get('apartmentType'),bedrooms:Number(f.get('bedrooms')),bathrooms:Number(f.get('bathrooms')),lat:coordinates.lat,lng:coordinates.lng,accessInstructions:f.get('accessInstructions'),keyInstructions:f.get('keyInstructions'),parking:f.get('parking'),linenLocation:f.get('linenLocation'),suppliesLocation:f.get('suppliesLocation'),notes:f.get('notes')};try{await api(id?`/api/client/objects/${id}`:'/api/client/objects',{method:id?'PATCH':'POST',body});closeModal();toast('Object saved','success');clientObjects()}catch(e){toast(e.message,'error')}};

async function clientBook(){const d=await api('/api/client/objects');const objects=d.objects.filter(o=>o.approval_status==='APPROVED'&&o.active);const query=new URLSearchParams(location.hash.split('?')[1]||'');const selected=Number(query.get('object')||objects[0]?.id||0);$('#page').innerHTML=`<div class="section-head client-section"><div><h2>${t('Reserve a cleaning','Reserve a cleaning')}</h2><p>${t('Choose the property, the day and the window when the flat is free.','Choose the property, the day and the window when the flat is free.')}</p></div></div>${objects.length?`<div class="job-card"><form id="client-book-form" class="form-grid"><div class="field wide"><label>Property</label><select class="select" name="objectId" onchange="loadClientSlots()">${objects.map(o=>`<option value="${o.id}" ${o.id===selected?'selected':''}>${esc(o.code)} · ${esc(o.name)} · ${Number(o.client_price)>0?money(o.client_price):'price by agreement'}</option>`).join('')}</select></div><div class="field wide"><label>Date</label><input class="input" type="date" name="serviceDate" min="${today()}" value="${tomorrow()}" onchange="loadClientSlots()"></div></form><div id="client-slots"><div class="empty">Loading…</div></div></div>`:`<div class="job-card"><strong>No approved properties.</strong><p class="subtle">Object is awaiting approval.</p><button class="btn" onclick="navTo('client/objects')">Objects</button></div>`}`;if(objects.length)loadClientSlots()}
window.loadClientSlots=async()=>{const f=$('#client-book-form');if(!f)return;const objectId=Number(f.objectId.value),date=f.serviceDate.value;const box=$('#client-slots');box.innerHTML='<div class="empty">'+t('Loading…','Loading…')+'</div>';try{const d=await api(`/api/client/slots?objectId=${objectId}&date=${date}`);const w=d.window||{from:'10:00',to:'15:00',durationMinutes:d.object?.duration_minutes};box.innerHTML=`<div class="client-price-row"><span>${esc(d.object.name)} · ${Number(w.durationMinutes)||''} ${t('min','min')}</span><strong>${Number(d.object.client_price)>0?money(d.object.client_price):'—'}</strong></div><h4>${t('Cleaning window','Cleaning window')}</h4><p class="subtle">${t('From guest check-out to the next check-in. A cleaner takes the job and arrives inside this window.','From guest check-out to the next check-in. A cleaner takes the job and arrives inside this window.')}</p><div class="form-grid"><div class="field"><label>${t('Not before','Not before')}</label><input class="input" type="time" step="900" id="window-from" value="${esc(w.from)}"></div><div class="field"><label>${t('Ready by','Ready by')}</label><input class="input" type="time" step="900" id="window-to" value="${esc(w.to)}"></div><div class="field wide"><label>${t('Note for the cleaner (optional)','Note for the cleaner (optional)')}</label><textarea class="textarea" id="booking-note" maxlength="1000" placeholder="${esc(t('e.g. guests arrive at 16:00, change all linen','e.g. guests arrive at 16:00, change all linen'))}"></textarea></div></div><button id="reserve-cleaning-btn" class="btn primary full" onclick="reserveClientCleaning()">${t('Reserve cleaning','Reserve cleaning')}</button>`}catch(e){box.innerHTML=`<div class="empty error-text">${esc(e.message)}</div>`}};
window.selectClientSlot=()=>{};
window.reserveClientCleaning=async()=>{const f=$('#client-book-form'),from=$('#window-from')?.value,to=$('#window-to')?.value;if(!from||!to||from>=to)return toast(t('Ready-by time must be after the start','Ready-by time must be after the start'),'error');const btn=$('#reserve-cleaning-btn');btn.disabled=true;try{const d=await api('/api/client/bookings',{method:'POST',body:{objectId:Number(f.objectId.value),serviceDate:f.serviceDate.value,windowFrom:from,windowTo:to,note:$('#booking-note')?.value||''}});toast(t('Reservation created','Reservation created'),'success');navTo(`client/booking/${d.booking.id}`)}catch(e){toast(e.message,'error');btn.disabled=false}};


/* The client's own voice: a rating on a finished cleaning, and a complaint that
   goes to operations rather than to the cleaner. */
const STAR_WORDS=['Very bad','Bad','Acceptable','Good','Excellent'];
function ratingBlock(d){
 const j=d.booking,f=d.feedback,can=d.rating?.canRate;
 if(j.status!=='COMPLETED'&&!f)return '';
 if(f&&!can)return `<div class="instruction"><h4>${t('Your rating','Your rating')}</h4><p>${stars(f.rating)} ${f.complaint?`<span class="pill red">${t('Complaint','Complaint')}</span>`:''}</p>${f.comment?`<p class="subtle">${esc(f.comment)}</p>`:''}<small class="subtle">${t('The rating window has closed.','The rating window has closed.')}</small></div>`;
 if(!can)return '';
 const current=f?.rating||0;
 return `<div class="instruction"><h4>${f?t('Your rating','Your rating'):t('Rate this cleaning','Rate this cleaning')}</h4>
  <div class="star-row" id="rating-stars">${[1,2,3,4,5].map(n=>`<button type="button" class="star ${n<=current?'on':''}" data-rating="${n}" aria-label="${n}" onclick="pickRating(${n})">★</button>`).join('')}<span class="subtle" id="rating-word">${current?t(STAR_WORDS[current-1],STAR_WORDS[current-1]):''}</span></div>
  <textarea class="textarea" id="rating-comment" rows="2" maxlength="1000" placeholder="${esc(t('What went well, what did not (optional)','What went well, what did not (optional)'))}">${f?esc(f.comment||''):''}</textarea>
  <label class="switch-row"><input type="checkbox" id="rating-complaint" ${f?.complaint?'checked':''}><span>${t('This is a complaint — operations should look at it','This is a complaint — operations should look at it')}</span></label>
  <button class="btn primary full" onclick="submitRating(${j.id})">${f?t('Update the rating','Update the rating'):t('Send the rating','Send the rating')}</button>
  <small class="subtle">${t('You can rate a cleaning within','You can rate a cleaning within')} ${d.rating.windowDays} ${t('days','days')}.</small></div>`;
}
const stars=n=>`<span class="stars" aria-label="${n}/5">${'★'.repeat(Math.round(n))}${'☆'.repeat(5-Math.round(n))}</span>`;
window.pickRating=n=>{
 state.pickedRating=n;
 document.querySelectorAll('#rating-stars .star').forEach(el=>el.classList.toggle('on',Number(el.dataset.rating)<=n));
 const word=document.getElementById('rating-word');if(word)word.textContent=t(STAR_WORDS[n-1],STAR_WORDS[n-1]);
};
window.submitRating=async id=>{
 const rating=state.pickedRating||Number(document.querySelector('#rating-stars .star.on:last-of-type')?.dataset.rating||0);
 const comment=document.getElementById('rating-comment')?.value.trim()||'';
 const complaint=Boolean(document.getElementById('rating-complaint')?.checked);
 if(!rating){toast(t('Choose from one to five stars','Choose from one to five stars'),'error');return}
 if(complaint&&!comment){toast(t('A complaint needs a description','A complaint needs a description'),'error');return}
 try{
  await api(`/api/client/bookings/${id}/feedback`,{method:'POST',body:{rating,comment,complaint}});
  state.pickedRating=null;
  toast(complaint?t('Operations notified','Operations notified'):t('Thank you','Thank you'),'success');
  await clientBookingDetail(id);
 }catch(e){toast(e.message,'error')}
};
window.editBookingNote=async id=>{
 const current=document.getElementById('booking-note-text')?.textContent?.trim()||'';
 const value=await askDialog({title:'Note for the cleaner',label:'Note',value:current==='No note yet.'?'':current,multiline:true,confirmLabel:'Save'});
 if(value===null)return;
 try{await api(`/api/client/bookings/${id}/note`,{method:'PATCH',body:{note:value}});toast(t('Note saved','Note saved'),'success');await clientBookingDetail(id)}catch(e){toast(e.message,'error')}
};

/* Recurring bookings the client manages: the worker that turns them into
   cleanings already runs every night. */
const WEEKDAYS=[[1,'Mon'],[2,'Tue'],[3,'Wed'],[4,'Thu'],[5,'Fri'],[6,'Sat'],[7,'Sun']];
async function clientRecurring(){
 shellTitle(t('Repeat','Repeat'),t('Cleanings that repeat every week','Cleanings that repeat every week'));
 const [d,objects]=await Promise.all([api('/api/client/recurring'),api('/api/client/objects')]);
 state.recurringObjects=objects.objects.filter(o=>o.active&&o.approval_status==='APPROVED');
 $('#page').innerHTML=`<div class="section-head client-section"><div><h2>${t('Repeating cleanings','Repeating cleanings')}</h2><p>${d.schedules.length} ${t('schedules','schedules')}</p></div><button class="btn primary" onclick="clientRecurringModal()">${t('New schedule','New schedule')}</button></div>
 ${d.schedules.map(r=>`<div class="job-card"><div class="head"><div><h3>${esc(r.object_code)} · ${esc(r.object_name)}</h3><div class="address">${WEEKDAYS.filter(([n])=>r.weekdays.includes(n)).map(([,label])=>t(label,label)).join(' · ')} · ${esc(String(r.planned_start).slice(0,5))}</div><small class="subtle">${t('From','From')} ${fmtDate(r.start_date)}${r.end_date?` ${t('to','to')} ${fmtDate(r.end_date)}`:''} · ${r.generated} ${t('cleanings created','cleanings created')}</small></div><div>${r.active?`<span class="pill green"><span class="dot"></span>${t('Active','Active')}</span>`:`<span class="pill gray">${t('Paused','Paused')}</span>`}</div></div>
  <div class="row-actions"><button class="btn sm" onclick='clientRecurringModal(${JSON.stringify(r).replace(/'/g,"&#39;")})'>${t('Edit','Edit')}</button><button class="btn sm" onclick="toggleClientRecurring(${r.id},${!r.active})">${r.active?t('Pause','Pause'):t('Resume','Resume')}</button><button class="btn sm red" onclick="removeClientRecurring(${r.id})">${t('Delete','Delete')}</button></div></div>`).join('')||`<div class="job-card"><div class="empty">${t('No repeating cleanings yet.','No repeating cleanings yet.')}</div></div>`}`;
}
window.clientRecurringModal=(schedule=null)=>{
 const objects=state.recurringObjects||[];
 if(!objects.length){toast(t('No approved property to book','No approved property to book'),'error');return}
 const days=schedule?schedule.weekdays:[1];
 modal(esc(schedule?t('Edit schedule','Edit schedule'):t('New schedule','New schedule')),`<form id="recurring-form" class="form-grid">
  <input type="hidden" name="id" value="${schedule?schedule.id:''}">
  <div class="field wide"><label for="rc-object">${t('Property','Property')}</label><select class="select" id="rc-object" name="objectId" ${schedule?'disabled':''}>${objects.map(o=>`<option value="${o.id}" ${schedule&&String(schedule.object_id)===String(o.id)?'selected':''}>${esc(o.code)} — ${esc(o.name)}</option>`).join('')}</select>${schedule?`<small class="subtle">${t('A schedule stays with its property.','A schedule stays with its property.')}</small>`:''}</div>
  <div class="field wide"><label>${t('Weekdays','Weekdays')}</label><div class="row-actions" id="rc-days">${WEEKDAYS.map(([n,label])=>`<label class="chip-toggle"><input type="checkbox" name="weekday" value="${n}" ${days.includes(n)?'checked':''}><span>${t(label,label)}</span></label>`).join('')}</div></div>
  <div class="field"><label for="rc-start">${t('Start time','Start time')}</label><input class="input" id="rc-start" name="plannedStart" type="time" step="900" value="${schedule?String(schedule.planned_start).slice(0,5):'10:00'}"></div>
  <div class="field"><label for="rc-from">${t('First day','First day')}</label><input class="input" id="rc-from" name="startDate" type="date" value="${schedule?schedule.start_date:today()}"></div>
  <div class="field"><label for="rc-to">${t('Last day (optional)','Last day (optional)')}</label><input class="input" id="rc-to" name="endDate" type="date" value="${schedule?.end_date||''}"></div>
 </form>`,`<button class="btn" onclick="closeModal()">${t('Cancel','Cancel')}</button><button class="btn primary" onclick="saveClientRecurring()">${t('Save','Save')}</button>`);
};
window.saveClientRecurring=async()=>{
 const form=$('#recurring-form');
 const weekdays=[...form.querySelectorAll('input[name=weekday]:checked')].map(el=>Number(el.value));
 if(!weekdays.length){toast(t('Choose at least one weekday','Choose at least one weekday'),'error');return}
 const f=new FormData(form);
 const body={id:f.get('id')||null,objectId:Number(f.get('objectId')||$('#rc-object').value),weekdays,plannedStart:f.get('plannedStart'),startDate:f.get('startDate'),endDate:f.get('endDate')||null};
 try{await api('/api/client/recurring',{method:'POST',body});closeModal();toast(t('Schedule saved','Schedule saved'),'success');await clientRecurring()}catch(e){toast(e.message,'error')}
};
window.toggleClientRecurring=async(id,active)=>{
 const schedule=(await api('/api/client/recurring')).schedules.find(r=>String(r.id)===String(id));
 if(!schedule)return;
 try{await api('/api/client/recurring',{method:'POST',body:{id,objectId:schedule.object_id,weekdays:schedule.weekdays,plannedStart:String(schedule.planned_start).slice(0,5),startDate:schedule.start_date,endDate:schedule.end_date,active}});toast(active?t('Schedule resumed','Schedule resumed'):t('Schedule paused','Schedule paused'),'success');await clientRecurring()}catch(e){toast(e.message,'error')}
};
window.removeClientRecurring=async id=>{
 if(!await askConfirm('Delete this schedule?','Cleanings it already created stay as they are.','Delete'))return;
 try{const r=await api(`/api/client/recurring/${id}`,{method:'DELETE'});toast(r.deleted?t('Schedule deleted','Schedule deleted'):t('Schedule paused because it already created cleanings','Schedule paused because it already created cleanings'),'success');await clientRecurring()}catch(e){toast(e.message,'error')}
};

/* Fix 23: the owner's archive — filters, totals over the whole filtered set,
   and a table the existing CSV export can pick up. */
const BOOKING_STATUS_FILTERS=[['ALL','All'],['OPEN','In progress'],['COMPLETED','Completed'],['CANCELLED','Cancelled'],['EXPIRED','Expired']];
async function clientBookings(){
 const f=state.bookingFilters||(state.bookingFilters={status:'ALL',objectId:'',from:'',to:''});
 const query=new URLSearchParams();
 if(f.status&&f.status!=='ALL')query.set('status',f.status);
 if(f.objectId)query.set('objectId',f.objectId);
 if(f.from)query.set('from',f.from);
 if(f.to)query.set('to',f.to);
 const d=await api(`/api/client/bookings${query.toString()?'?'+query:''}`);
 const rows=d.bookings,s=d.summary||{};
 const properties=d.properties||[];
 shellTitle(t('Bookings','Bookings'),t('Every cleaning of your properties','Every cleaning of your properties'));
 $('#page').innerHTML=`<div class="section-head client-section"><div><h2>${esc(t('Bookings','Bookings'))}</h2><p>${s.bookings||0} ${esc(t('cleanings','cleanings'))} · ${esc(t('charged','charged'))} ${money((s.chargedCents||0)/100)}</p></div><button class="btn primary" onclick="navTo('client/book')">${esc(t('Book Cleaning','Book Cleaning'))}</button></div>
 <div class="card pad" style="margin-bottom:12px"><form id="booking-filters" class="form-grid">
  <div class="field"><label for="bf-status">${esc(t('State','State'))}</label><select class="select" id="bf-status" onchange="setBookingFilter('status',this.value)">${BOOKING_STATUS_FILTERS.map(([value,label])=>`<option value="${value}" ${f.status===value?'selected':''}>${esc(t(label,label))}</option>`).join('')}</select></div>
  <div class="field"><label for="bf-object">${esc(t('Property','Property'))}</label><select class="select" id="bf-object" onchange="setBookingFilter('objectId',this.value)"><option value="">${esc(t('All properties','All properties'))}</option>${properties.map(o=>`<option value="${o.id}" ${String(f.objectId)===String(o.id)?'selected':''}>${esc(o.code)} — ${esc(o.name)}</option>`).join('')}</select></div>
  <div class="field"><label for="bf-from">${esc(t('From','From'))}</label><input class="input" id="bf-from" type="date" value="${esc(f.from)}" onchange="setBookingFilter('from',this.value)"></div>
  <div class="field"><label for="bf-to">${esc(t('To','To'))}</label><input class="input" id="bf-to" type="date" value="${esc(f.to)}" onchange="setBookingFilter('to',this.value)"></div>
  <div class="wide row-actions"><button class="btn sm" type="button" onclick="resetBookingFilters()">${esc(t('Clear filters','Clear filters'))}</button><span class="subtle">${s.completed||0} ${esc(t('completed','completed'))} · ${s.cancelled||0} ${esc(t('cancelled','cancelled'))} · ${s.expired||0} ${esc(t('expired','expired'))}</span></div>
 </form></div>
 ${rows.length?`<div class="card"><div class="table-wrap"><table><thead><tr><th>${esc(t('Date','Date'))}</th><th>${esc(t('Property','Property'))}</th><th>${esc(t('Window','Window'))}</th><th>${esc(t('State','State'))}</th><th>${esc(t('Charged','Charged'))}</th><th></th></tr></thead><tbody>
 ${rows.map(b=>`<tr><td>${esc(fmtDate(b.service_date))}</td><td><strong>${esc(b.object_code)}</strong><br><small class="subtle">${esc(b.object_name)}</small></td><td>${esc(String(b.earliest_start||'').slice(0,5))}–${esc(String(b.deadline||'').slice(0,5))}</td><td>${statusPill(b.status)}</td><td>${b.status==='COMPLETED'?money(Number(b.client_price||0)+Number(b.extra_revenue||0)):'—'}</td><td><button class="btn sm" onclick="navTo('client/booking/${b.id}')">${esc(t('Open','Open'))}</button></td></tr>`).join('')}
 </tbody></table></div>${d.hasMore?`<div class="pad subtle">${esc(t('Showing the most recent results. Narrow the dates to see older ones.','Showing the most recent results. Narrow the dates to see older ones.'))}</div>`:''}</div>`:`<div class="job-card"><div class="empty">${esc(t('No cleanings match these filters.','No cleanings match these filters.'))}</div></div>`}`;
}
window.setBookingFilter=(key,value)=>{state.bookingFilters={...(state.bookingFilters||{}),[key]:value};clientBookings()};
window.resetBookingFilters=()=>{state.bookingFilters={status:'ALL',objectId:'',from:'',to:''};clientBookings()};

function progressTracker(j){
  if(j.status==='CANCELLED')return `<div class="progress-track cancelled"><strong>${esc(t('Cancelled','Cancelled'))}</strong>${j.cancellation_reason?`<small>${esc(j.cancellation_reason)}</small>`:''}</div>`;
  const steps=[['BOOKED','Booked'],['ACCEPTED','Cleaner assigned'],['EN_ROUTE','On the way'],['ARRIVED','Arrived'],['CLEANING','Cleaning'],['COMPLETED','Done']];
  const order={UNASSIGNED:0,OFFERED:0,AT_RISK:0,RESCUE:0,ACCEPTED:1,EN_ROUTE:2,ARRIVED:3,CLEANING:4,COMPLETED:5};
  const current=order[j.status]??0;
  const doneLabel=j.status==='COMPLETED'&&j.review_status==='PENDING'?'Quality check':j.status==='COMPLETED'&&j.review_status==='APPROVED'?'Approved':'Done';
  return `<ol class="progress-track" aria-label="${esc(t('Cleaning progress','Cleaning progress'))}">${steps.map(([key,label],i)=>`<li class="${i<current?'done':i===current?'current':''}"${i===current?' aria-current="step"':''}><span class="dot"></span><span>${esc(t(i===5?doneLabel:label,i===5?doneLabel:label))}</span></li>`).join('')}</ol>`;
}
const FINANCIAL_LABELS={PENDING:'Not invoiced',INVOICED:'Invoiced',PAID:'Paid',CANCELLED:'Cancelled'};
function financialLabel(v){const l=FINANCIAL_LABELS[v||'PENDING']||String(v);return t(l,l)}
async function clientBookingDetail(id){try{const d=await api(`/api/client/bookings/${id}`),j=d.booking;$('#page').innerHTML=`<div class="active-job-head client-detail-head"><button class="back" onclick="navTo('client/bookings')">← Bookings</button><h2>${esc(j.object_code)} · ${esc(j.object_name)}</h2><div class="address" style="color:#b7c0cf">${esc(j.address)}</div><div class="job-meta">${deliveryPill(j)} <span class="meta-chip">${fmtDate(j.service_date)}</span><span class="meta-chip">${esc(j.planned_start||j.earliest_start)}–${esc(j.deadline)}</span><span class="meta-chip">${money(Number(j.client_price)+Number(j.extra_revenue||0))}</span></div></div><div class="active-job-body"><div class="instruction"><h4>${t('Your note','Your note')}</h4><p id="booking-note-text">${j.client_note?esc(j.client_note):`<span class="subtle">${t('No note yet.','No note yet.')}</span>`}</p>${['ARRIVED','CLEANING','COMPLETED','CANCELLED','EXPIRED'].includes(j.status)?`<small class="subtle">${t('The note can be changed until the cleaner arrives.','The note can be changed until the cleaner arrives.')}</small>`:`<button class="btn sm" onclick="editBookingNote(${j.id})">${t('Change the note','Change the note')}</button>`}</div>${ratingBlock(d)}<div class="instruction"><h4>${t('Progress','Progress')}</h4>${progressTracker(j)}${j.cleaner_name&&!['UNASSIGNED','CANCELLED'].includes(j.status)?`<p class="subtle" style="margin-top:8px">${t('Cleaner','Cleaner')}: <strong>${esc(String(j.cleaner_name).split(' ')[0])}</strong></p>`:''}</div><div class="instruction"><h4>Cleaning</h4><div class="detail-grid"><div class="detail-item"><div class="k">Status</div><div class="v">${deliveryPill(j)}</div></div><div class="detail-item"><div class="k">ETA</div><div class="v">${esc(j.eta||'—')}</div></div><div class="detail-item"><div class="k">Price</div><div class="v">${money(Number(j.client_price)+Number(j.extra_revenue||0))}</div></div><div class="detail-item"><div class="k">Financial status</div><div class="v">${esc(financialLabel(j.financial_status))}</div></div></div></div>${d.photos.length?`<div class="instruction"><h4>Proof photos</h4><div class="photo-grid">${d.photos.map(p=>proofMedia(p)).join('')}</div></div>`:''}${d.issues.length?`<div class="instruction"><h4>Issues</h4>${d.issues.map(i=>`<div class="risk-row"><div class="risk-score">!</div><div><strong>${esc(i.type)}</strong><small>${esc(i.description||'')} · ${esc(i.status)}</small></div></div>`).join('')}</div>`:''}</div>${!['COMPLETED','CANCELLED','EXPIRED','ARRIVED','CLEANING'].includes(j.status)&&j.service_date>=today()?`<div class="sticky-action"><button class="btn red full" onclick="cancelClientBooking(${j.id})">Cancel booking</button></div>`:''}`;}catch(e){$('#page').innerHTML=`<div class="job-card"><strong>${esc(e.message)}</strong><button class="btn full" onclick="navTo('client/bookings')">Back</button></div>`}}
async function clientFinance(){
  const month=state.clientFinanceMonth||new Date().toISOString().slice(0,7);
  const data=await api('/api/client/finance?month='+encodeURIComponent(month));
  const summary=data.summary||{};
  const points=Array.isArray(data.trend)?data.trend:[];
  const scale=Math.max(1,...points.flatMap(point=>[Number(point.revenue||0),Number(point.expenses||0)]));
  const trend=points.map(point=>{
    const revenue=Math.max(3,Math.round(Number(point.revenue||0)/scale*100));
    const expenses=Math.max(3,Math.round(Number(point.expenses||0)/scale*100));
    return '<div class="trend-col"><div class="trend-bars" title="'+esc(point.month)+'"><span class="trend-revenue" style="height:'+revenue+'%"></span><span class="trend-expense" style="height:'+expenses+'%"></span></div><strong>'+esc(point.month.slice(5))+'</strong><small>'+money(point.profit)+'</small></div>';
  }).join('')||'<div class="empty">No portfolio activity for this period.</div>';
  const objectRows=(data.byObject||[]).map(row=>'<tr><td><strong>'+esc(row.code||'—')+'</strong><br><span class="subtle">'+esc(row.name||'Unnamed property')+'</span></td><td>'+Number(row.jobs||0)+'</td><td>'+money(row.revenue)+'</td><td>'+money(row.cost)+'</td><td class="'+(Number(row.profit||0)>=0?'profit-pos':'profit-neg')+'">'+money(row.profit)+'</td></tr>').join('')||'<tr><td colspan="5" class="empty">No completed cleanings in this month.</td></tr>';
  const entries=(data.entries||[]).map(entry=>'<div class="risk-row"><div class="risk-score" style="background:'+(entry.entry_type==='INCOME'?'#e9f7f0':'#ffeaec')+';color:'+(entry.entry_type==='INCOME'?'#087b4d':'#b52634')+'">'+(entry.entry_type==='INCOME'?'+':'−')+'</div><div><strong>'+esc(entry.category||entry.entry_type)+'</strong><small>'+fmtDate(entry.entry_date)+' · '+esc(entry.object_code||'Portfolio')+(entry.description?' · '+esc(entry.description):'')+'</small></div><strong class="'+(entry.entry_type==='INCOME'?'profit-pos':'profit-neg')+'">'+(entry.entry_type==='INCOME'?'+':'−')+money(entry.amount)+'</strong></div>').join('')||'<div class="empty">No additional financial entries for this month.</div>';
  $('#page').innerHTML='<div class="section-head client-section"><div><h2>Portfolio finance</h2><p>Completed cleanings, operating costs and profitability.</p></div><input class="input" type="month" value="'+esc(data.month||month)+'" onchange="setClientFinanceMonth(this.value)" style="width:auto"></div><div class="mobile-kpis" style="grid-template-columns:repeat(3,1fr)"><div class="job-card mini"><span>Revenue</span><strong>'+money(summary.totalRevenue)+'</strong><small>'+Number(summary.completedJobs||0)+' completed cleanings</small></div><div class="job-card mini"><span>Costs</span><strong>'+money(summary.totalExpenses)+'</strong><small>Cleaner payout and extras</small></div><div class="job-card mini"><span>Profit</span><strong class="'+(Number(summary.profit||0)>=0?'profit-pos':'profit-neg')+'">'+money(summary.profit)+'</strong><small>'+Number(summary.marginPct||0)+'% margin</small></div></div><div class="job-card"><div class="section-head compact"><div><h2>12-month trend</h2><p>Blue: revenue · orange: costs</p></div></div><div class="finance-trend">'+trend+'</div></div><div class="job-card"><div class="section-head compact"><div><h2>By property</h2><p>Only your portfolio and completed cleanings.</p></div></div><div class="table-wrap"><table><thead><tr><th>Property</th><th>Jobs</th><th>Revenue</th><th>Costs</th><th>Profit</th></tr></thead><tbody>'+objectRows+'</tbody></table></div></div><div class="job-card"><div class="section-head compact"><div><h2>Adjustments</h2><p>Income and expense entries tied to your portfolio.</p></div></div>'+entries+'</div>';
}
window.setClientFinanceMonth=month=>{if(!/^\d{4}-\d{2}$/.test(String(month||'')))return;state.clientFinanceMonth=month;clientFinance().catch(error=>toast(error.message,'error'));};

window.cancelClientBooking=async id=>{const reason=await askDialog({title:'Cancel this cleaning reservation?',label:'Cancellation reason',multiline:true,confirmLabel:'Cancel reservation',danger:true});if(reason===null)return;try{await api(`/api/client/bookings/${id}/cancel`,{method:'POST',body:{reason}});toast('Booking cancelled','success');navTo('client/bookings')}catch(e){toast(e.message,'error')}};

async function clientProfile(){const d=await api('/api/client/profile'),c=d.client||{};$('#page').innerHTML=`<div class="section-head client-section"><div><h2>Client profile</h2><p>${esc(c.account_type||state.me.role)}</p></div></div><div class="job-card"><form id="client-profile-form" class="form-grid"><div class="field"><label>Full name</label><input class="input" name="fullName" value="${esc(c.full_name||state.me.full_name)}"></div><div class="field"><label>Login email</label><input class="input" type="email" value="${esc(c.email||state.me.email)}" readonly aria-readonly="true"><small class="subtle">To change the login email, contact Operations.</small></div><div class="field"><label>Phone</label><input class="input" name="phone" value="${esc(c.phone||state.me.phone||'')}"></div><div class="field"><label>Language</label><select class="select" name="language">${ST_I18N.LANGS.map(l=>`<option value="${l}" ${String(c.language||state.me.language||'ru')===l?'selected':''}>${ST_I18N.NAMES[l]}</option>`).join('')}</select></div><div class="field wide"><label>Company name</label><input class="input" name="companyName" value="${esc(c.company_name||'')}"></div><div class="field"><label>Billing name</label><input class="input" name="billingName" value="${esc(c.billing_name||'')}"></div><div class="field"><label>ICO</label><input class="input" name="ico" value="${esc(c.ico||'')}"></div><div class="field"><label>DIC</label><input class="input" name="dic" value="${esc(c.dic||'')}"></div><div class="field"><label>IC DPH</label><input class="input" name="icDph" value="${esc(c.ic_dph||'')}"></div><div class="field wide"><label>Billing address</label><input class="input" name="billingAddress" value="${esc(c.billing_address||'')}"></div><div class="wide"><button type="button" class="btn primary full" onclick="saveClientProfile()">Save profile</button></div></form></div>${notificationCard()}<div class="job-card"><div style="height:14px;border-top:1px solid var(--line);margin-top:14px;padding-top:14px"><button class="btn full" onclick="passwordModal()">Change password</button><button class="btn ghost full" style="margin-top:8px" onclick="logout()">Sign out</button></div></div>`}
window.saveClientProfile=async()=>{const f=new FormData($('#client-profile-form'));try{const lang=f.get('language');await api('/api/client/profile',{method:'PATCH',body:{fullName:f.get('fullName'),phone:f.get('phone'),language:lang,companyName:f.get('companyName'),billingName:f.get('billingName'),ico:f.get('ico'),dic:f.get('dic'),icDph:f.get('icDph'),billingAddress:f.get('billingAddress')}});state.me.language=lang;state.locale=ST_I18N.setLocale(lang);toast('Profile saved','success');render()}catch(e){toast(e.message,'error')}};
const openClientObjectModal=window.clientObjectModal;
window.clientObjectModal=async id=>{if(!id&&state.me?.role!=='OWNER')return toast('Only the owner can add a property','error');return openClientObjectModal(id);};

window.passwordModal=()=>modal('Change password',`<form id="password-form" class="form-grid"><div class="field wide"><label>Current password</label><input class="input" type="password" name="currentPassword" required></div><div class="field wide"><label>New password</label><input class="input" type="password" name="newPassword" minlength="12" required></div><div class="field wide"><label>Repeat new password</label><input class="input" type="password" name="repeatPassword" minlength="12" required></div></form>`,`<button class="btn" onclick="closeModal()">Cancel</button><button class="btn primary" onclick="savePassword()">Update password</button>`);window.savePassword=async()=>{const f=new FormData($('#password-form')),a=f.get('newPassword'),b=f.get('repeatPassword');if(a!==b)return toast('New passwords do not match','error');try{await api('/api/account/password',{method:'POST',body:{currentPassword:f.get('currentPassword'),newPassword:a}});closeModal();toast('Password changed','success')}catch(e){toast(e.message,'error')}};

window.forgotPassword=()=>modal(t('Reset password','Reset password'),`<form id="reset-password-form"><div class="field"><label>Email</label><input class="input" type="email" name="email" autocomplete="email" required></div><p class="subtle">${t('We will send you a secure recovery link.','We will send you a secure recovery link.')}</p></form>`,`<button class="btn" onclick="closeModal()">${t('Cancel','Cancel')}</button><button class="btn primary" onclick="sendResetPassword()">${t('Send link','Send link')}</button>`);
window.sendResetPassword=async()=>{const form=$('#reset-password-form');if(!form.reportValidity())return;try{await window.ShineTimeSupabase.resetPassword(form.email.value.trim());closeModal();toast(t('If the account exists, a recovery link will arrive shortly.','If the account exists, a recovery link will arrive shortly.'),'success')}catch(e){toast(e.message,'error')}};
window.recoveryModal=()=>modal(t('Set new password','Set new password'),`<form id="recovery-form"><div class="field"><label>${t('New password','New password')}</label><input class="input" name="password" type="password" autocomplete="new-password" minlength="12" required></div><div class="field"><label>${t('Repeat new password','Repeat new password')}</label><input class="input" name="repeat" type="password" autocomplete="new-password" minlength="12" required></div></form>`,`<button class="btn primary" onclick="finishRecovery()">${t('Save','Save')}</button>`);
window.finishRecovery=async()=>{const form=$('#recovery-form');if(!form.reportValidity())return;if(form.password.value!==form.repeat.value)return toast(t('New passwords do not match','New passwords do not match'),'error');try{await window.ShineTimeSupabase.recoverPassword(form.password.value);closeModal();toast(t('Password changed','Password changed'),'success');await bootstrap()}catch(e){toast(e.message,'error')}};

window.setFinancePeriod=month=>{state.financeMonth=month;state.financeCursor=null;render()};
window.financePage=cursor=>{state.financeCursor=cursor;render()};

function proofMedia(p){return p.mime?.startsWith('video/')?`<video controls preload="metadata" src="${esc(p.url)}" style="width:100%;max-height:240px"></video>`:`<a href="${esc(p.url)}" target="_blank" rel="noopener"><img src="${esc(p.url)}" alt="${esc(p.category)}" style="width:100%;height:105px;object-fit:cover"></a>`}
