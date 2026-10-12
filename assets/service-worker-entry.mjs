import {staticCacheAllowed} from './live-updates.mjs';
const BUILD='2026-10-12-stage2';
const CACHE=`shinetime-shell-${BUILD}`;
const BASE=new URL(self.registration.scope).pathname;
const SHELL=['assets/styles.css','assets/ui-system.css','assets/mobile-ui.css','assets/job-lifecycle.css','assets/i18n.js','assets/supabase-client.js','assets/operations-ui-core.js','assets/live-updates.js','assets/operations-board.js','assets/checklist-drafts.js','assets/workspace-i18n.js','assets/operations-workspace.css','assets/app.js','assets/property-photos.js','assets/money.js','assets/operations-extension.js','assets/monitoring-extension.js','assets/export.js','manifest.webmanifest','assets/icon-192.png','assets/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL.map(p=>BASE+p))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([
  self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('shinetime-shell-')&&k!==CACHE).map(k=>caches.delete(k)))),
])));
self.addEventListener('message',event=>{if(event.data?.type==='CLEAR_PRIVATE_DATA')event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('shinetime-')).map(k=>caches.delete(k)))));});
/* Web Push: the payload is the JSON the API encrypted (title, body, type). */
const ROUTE_FOR_TYPE={MARKETPLACE:'#cleaner/jobs',RESCUE:'#cleaner/jobs',ASSIGNED:'#cleaner/home',CLIENT_BOOKING:'#admin/live',ESCALATION:'#admin/live',EXPIRED:'#admin/jobs',CHECKIN:'#admin/live',SETTLEMENT:'#admin/finance'};
self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?event.data.json():{}}catch{data={title:'Shine Time',body:event.data?event.data.text():''}}
  const title=data.title||'Shine Time';
  event.waitUntil(self.registration.showNotification(title,{
    body:data.body||'',
    tag:data.type||'shinetime',
    renotify:true,
    lang:data.language||'sk',
    icon:BASE+'assets/icon-192.png',
    badge:BASE+'assets/icon-192.png',
    data:{type:data.type||'',notificationId:data.notificationId||null,url:BASE+(ROUTE_FOR_TYPE[data.type]||'')},
  }));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const info=event.notification.data||{};
  const scope=new URL(BASE,self.location.origin).href;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:'window',includeUncontrolled:true});
    for(const client of windows){
      if(!client.url.startsWith(scope))continue;
      await client.focus().catch(()=>{});
      client.postMessage({type:'NOTIFICATION_CLICK',data:info});
      return;
    }
    await self.clients.openWindow(new URL(info.url||BASE,self.location.origin).href);
  })());
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||!staticCacheAllowed(event.request.url,self.location.origin,BASE))return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok&&response.type==='basic'){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}
    return response;
  }).catch(async()=>await caches.match(event.request)||new Response('Offline',{status:503})));
});
