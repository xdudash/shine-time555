/* Additive notification tools: deduplication, priority queues and quiet-hour helpers. */
(()=>{
 const normalize=x=>({id:String(x?.id||x?.uuid||''),title:String(x?.title||x?.type||'Notification'),message:String(x?.message||x?.body||''),severity:String(x?.severity||'info').toLowerCase(),createdAt:x?.created_at||x?.createdAt||new Date().toISOString(),read:!!x?.read});
 const dedupe=(items=[])=>{const seen=new Set();return items.map(normalize).filter(x=>{const k=x.id||`${x.title}|${x.message}|${x.createdAt}`;if(seen.has(k))return false;seen.add(k);return true})};
 const priority=x=>({critical:4,error:3,warning:2,info:1}[String(x?.severity||'info').toLowerCase()]||0);
 const sort=(items=[])=>[...dedupe(items)].sort((a,b)=>priority(b)-priority(a)||new Date(b.createdAt)-new Date(a.createdAt));
 const unread=items=>dedupe(items).filter(x=>!x.read).length;
 const inQuietHours=(date=new Date(),start='22:00',end='07:00')=>{const mins=d=>{const [h,m]=String(d).split(':').map(Number);return h*60+m};const now=date.getHours()*60+date.getMinutes(),a=mins(start),b=mins(end);return a>b?now>=a||now<b:now>=a&&now<b};
 const digest=(items=[])=>{const all=sort(items),critical=all.filter(x=>priority(x)>=3),normal=all.filter(x=>priority(x)<3);return{total:all.length,unread:unread(all),critical,normal,latest:all[0]||null}};
 window.ShineTimeNotificationTools={normalize,dedupe,sort,unread,inQuietHours,digest};
})();
