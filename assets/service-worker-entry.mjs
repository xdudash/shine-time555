import {staticCacheAllowed} from './live-updates.mjs';
const BUILD='2026-09-07-scale1';
const CACHE=`shinetime-shell-${BUILD}`;
const BASE=new URL(self.registration.scope).pathname;
const SHELL=['assets/styles.css','assets/ui-system.css','assets/mobile-ui.css','assets/job-lifecycle.css','assets/i18n.js','assets/supabase-client.js','assets/operations-ui-core.js','assets/live-updates.js','assets/app.js','assets/money.js','assets/operations-extension.js','assets/monitoring-extension.js','assets/export.js','manifest.webmanifest','assets/icon-192.png','assets/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(SHELL.map(p=>BASE+p))).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(Promise.all([
  self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('shinetime-shell-')&&k!==CACHE).map(k=>caches.delete(k)))),
])));
self.addEventListener('message',event=>{if(event.data?.type==='CLEAR_PRIVATE_DATA')event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('shinetime-')).map(k=>caches.delete(k)))));});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET'||!staticCacheAllowed(event.request.url,self.location.origin,BASE))return;
  event.respondWith(fetch(event.request).then(response=>{
    if(response.ok&&response.type==='basic'){const copy=response.clone();event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));}
    return response;
  }).catch(async()=>await caches.match(event.request)||new Response('Offline',{status:503})));
});
