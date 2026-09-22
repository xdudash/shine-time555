/* Additive notification center: polling, unread badge, severity grouping and browser notification opt-in. */
(()=>{
 const t=(k,f)=>window.ST_I18N?.t?.(k,f)||f;
 const api=(p,o={})=>window.ShineTimeSupabase?.request?.(p,o);
 const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
 let cache=[],timer=0,open=false;
 const unreadCount=()=>cache.filter(x=>!x.read_at&&!x.is_read).length;
 function badge(){
   document.querySelectorAll('button').forEach(b=>{
     const label=(b.getAttribute('aria-label')||b.innerText||'').toLowerCase();
     if(!label.includes('notification')&&!label.includes('уведом')&&!label.includes('notifik'))return;
     let x=b.querySelector('.st-notification-badge');const n=unreadCount();
     if(!x){x=document.createElement('span');x.className='st-notification-badge';b.appendChild(x)}
     x.textContent=n>99?'99+':String(n);x.hidden=!n;
   });
 }
 function severity(x){return String(x.severity||x.level||'info').toLowerCase()}
 function grouped(){return cache.reduce((m,x)=>{const k=severity(x);(m[k] ||= []).push(x);return m},{})}
 function panel(){
  let root=document.getElementById('st-notifications-panel');
  if(root){root.remove();open=false;return}
  open=true;root=document.createElement('div');root.id='st-notifications-panel';root.className='modal-backdrop';
  root.innerHTML=`<div class="modal" role="dialog" aria-modal="true" aria-label="${t('Notifications','Notifications')}"><div class="modal-head"><h3>${t('Notifications','Notifications')}</h3><button class="close-x" type="button">×</button></div><div class="modal-body"><div class="row" style="justify-content:flex-end"><button class="btn sm" data-n-read>${t('Mark all read','Mark all read')}</button><button class="btn sm" data-n-permission>${t('Browser alerts','Browser alerts')}</button></div><div id="st-notification-list" style="margin-top:12px"></div></div></div>`;
  document.body.appendChild(root);root.querySelector('.close-x').onclick=()=>{root.remove();open=false};root.onclick=e=>{if(e.target===root){root.remove();open=false}};
  root.querySelector('[data-n-read]').onclick=markAllRead;root.querySelector('[data-n-permission]').onclick=permission;render();
 }
 function render(){
  const box=document.getElementById('st-notification-list');if(!box)return;
  if(!cache.length){box.innerHTML=`<div class="empty">${t('No notifications','No notifications')}</div>`;return}
  const groups=grouped();
  box.innerHTML=Object.entries(groups).map(([level,items])=>`<section class="notification-group"><h4>${esc(level)}</h4>${items.map((x,i)=>`<button type="button" class="notification-item ${x.read_at||x.is_read?'read':''}" data-notification-index="${cache.indexOf(x)}"><span class="pill">${esc(level)}</span><span><strong>${esc(x.title||x.subject||t('Operations alert','Operations alert'))}</strong><br><span class="subtle">${esc(x.message||x.body||'')}</span></span><time>${esc(x.created_at||x.createdAt||'')}</time></button>`).join('')}</section>`).join('');
  box.querySelectorAll('[data-notification-index]').forEach(b=>b.onclick=()=>markOne(Number(b.dataset.notificationIndex)));
 }
 async function fetchNotifications(){
  if(!window.state?.me)return;
  try{const data=await api('/api/notifications');cache=Array.isArray(data)?data:(data.notifications||[]);badge();render()}catch{}
 }
 async function markOne(i){const x=cache[i];if(!x)return;try{await api('/api/notifications/read',{method:'POST',body:{id:x.id}});x.read_at=new Date().toISOString();x.is_read=true;badge();render()}catch(e){window.toast?.(e.message,'error')}}
 async function markAllRead(){try{await api('/api/notifications/read',{method:'POST',body:{}});cache.forEach(x=>{x.read_at=x.read_at||new Date().toISOString();x.is_read=true});badge();render()}catch(e){window.toast?.(e.message,'error')}}
 async function permission(){if(!('Notification'in window)){window.toast?.(t('Browser notifications are unavailable','Browser notifications are unavailable'),'error');return}const result=await Notification.requestPermission();window.toast?.(result==='granted'?t('Browser alerts enabled','Browser alerts enabled'):t('Browser alerts not enabled','Browser alerts not enabled'),result==='granted'?'success':'error')}
 function hookBell(){document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;const label=(b.getAttribute('aria-label')||b.innerText||'').toLowerCase();if(label.includes('notification')||label.includes('уведом')||label.includes('notifik')){setTimeout(()=>panel(),0)}})}
 function boot(){hookBell();fetchNotifications();clearInterval(timer);timer=setInterval(fetchNotifications,45000)}
 window.ShineTimeNotifications={open:panel,refresh:fetchNotifications,markAllRead,requestPermission:permission,get unread(){return unreadCount()}};
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
