import test from 'node:test';
import assert from 'node:assert/strict';
import {createChecklistDrafts,CHECKLIST_DRAFT_KEY,CHECKLIST_DRAFT_TTL_MS} from '../assets/checklist-drafts.mjs';
function fixture() {
 const map=new Map(); const storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};
 let time=1000;return {storage,map,advance:ms=>time+=ms,create:()=>createChecklistDrafts({storage,now:()=>time})};
}
const job=()=>({id:'job',status:'CLEANING',checklist:[{id:'item',completed:false}]});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('reload, latest edit, scope isolation, prototype identifiers and data minimization',()=>{
 const f=fixture(),d=f.create();d.set('u','job','item',true);d.set('u','job','item',false);d.set('other','job','item',true);d.set('__proto__','constructor','toString',true);
 assert.deepEqual(f.create().list('u','job'),[{itemId:'item',completed:false}]);
 assert.deepEqual(d.list('__proto__','constructor'),[{itemId:'toString',completed:true}]);
 d.clearUser('u');assert.equal(d.list('u','job').length,0);assert.equal(d.list('other','job').length,1);
 const rows=JSON.parse(f.map.get(CHECKLIST_DRAFT_KEY));assert.deepEqual(Object.keys(rows[0]).sort(),['completed','itemId','jobId','revision','updatedAt','userId']);
 assert.throws(()=>d.set('u','job','i',{notes:'secret'}),TypeError);
});
test('24-hour expiry persists pruning',()=>{const f=fixture(),d=f.create();d.set('u','job','item',true);f.advance(CHECKLIST_DRAFT_TTL_MS);assert.deepEqual(d.list('u','job'),[]);assert.equal(f.map.size,0);});
test('malformed and unavailable storage fail explicitly without claiming success',()=>{
 const f=fixture();for(const bad of ['{','{}','[{"notes":"secret"}]']){f.map.set(CHECKLIST_DRAFT_KEY,bad);assert.throws(()=>f.create().list('u','job'),{code:'STORAGE_CORRUPT'});}
 const d=createChecklistDrafts({storage:{getItem:()=>null,setItem:()=>{throw Error('quota');}}});assert.throws(()=>d.set('u','job','item',true),{code:'STORAGE_UNAVAILABLE'});
 assert.throws(()=>createChecklistDrafts({storage:{getItem:()=>{throw Error();}}}).list('u','job'),{code:'STORAGE_UNAVAILABLE'});
});
test('reconcile clears confirmed and removed items and preserves differing intent',()=>{
 const d=fixture().create();for(const i of ['a','b','c'])d.set('u','job',i,true);
 assert.deepEqual(d.reconcile('u','job',[{id:'a',completed:true},{id:'b',completed:false}],true),{pending:[{itemId:'b',completed:true}],conflicts:[{itemId:'c',reason:'item_removed'}]});
 assert.equal(d.reconcile('u','job',[],false).conflicts[0].reason,'job_unavailable');
});
test('network retry retains draft, refreshes authoritative detail, then confirms',async()=>{
 const d=fixture().create();d.set('u','job','item',true);let calls=0;
 const options={userId:'u',jobId:'job',loadJob:async()=>{calls++;return job();},saveItem:async()=>{throw Error('offline');}};
 assert.equal((await d.flush(options)).offline,true);assert.equal(d.list('u','job').length,1);
 const writes=[];const result=await d.flush({...options,saveItem:async(...args)=>writes.push(args)});
 assert.equal(calls,2);assert.deepEqual(writes,[['job','item',true]]);assert.equal(result.saved,1);assert.deepEqual(result.pending,[]);
});
test('new edits during save survive including same-value edits; duplicate flush shares work',async()=>{
 const d=fixture().create();d.set('u','job','item',true);const wait=deferred(),entered=deferred();
 const options={userId:'u',jobId:'job',loadJob:async()=>job(),saveItem:async()=>{entered.resolve();await wait.promise;}};
 const first=d.flush(options);assert.equal(first,d.flush(options));await entered.promise;d.set('u','job','item',true);wait.resolve();
 assert.deepEqual((await first).pending,[{itemId:'item',completed:true}]);
});
test('revocation or terminal state discards only affected job without sending writes',async()=>{
 for(const mode of ['403','404','COMPLETED','CANCELLED']){
  const d=fixture().create();d.set('u','job','item',true);d.set('other','job','item',true);let saves=0;
  const r=await d.flush({userId:'u',jobId:'job',loadJob:async()=>{if(/^\d/.test(mode))throw {status:Number(mode)};return {...job(),status:mode};},saveItem:async()=>saves++});
  assert.equal(saves,0);assert.equal(r.pending.length,0);assert.equal(r.conflicts.length,1);assert.equal(d.list('other','job').length,1);
 }
});
test('session switch during load never sends a queued write',async()=>{
 const d=fixture().create();d.set('u','job','item',true);let active=true,saves=0;const wait=deferred();
 const p=d.flush({userId:'u',jobId:'job',loadJob:()=>wait.promise,saveItem:async()=>saves++,isCurrent:()=>active});active=false;d.clearUser('u');wait.resolve(job());
 assert.equal((await p).cancelled,true);assert.equal(saves,0);
});
test('new edit during authoritative fetch is deferred to next flush',async()=>{
 const d=fixture().create();d.set('u','job','item',true);let saves=0;const wait=deferred();
 const p=d.flush({userId:'u',jobId:'job',loadJob:()=>wait.promise,saveItem:async()=>saves++});d.set('u','job','item',false);wait.resolve(job());
 assert.equal(saves,0);assert.deepEqual((await p).pending,[{itemId:'item',completed:false}]);
});
test('fresh authorization is checked again between writes; revocation during save clears scope',async()=>{
 const d=fixture().create();d.set('u','job','item',true);d.set('u','job','second',true);let loads=0,writes=0;
 const r=await d.flush({userId:'u',jobId:'job',loadJob:async()=>{loads++;if(loads>1)throw {status:403};return {...job(),checklist:[...job().checklist,{id:'second',completed:false}]};},saveItem:async()=>writes++});
 assert.equal(loads,2);assert.equal(writes,1);assert.deepEqual(r.conflicts,[{itemId:'second',reason:'access_revoked'}]);
 d.set('u','job','item',true);const revoked=await d.flush({userId:'u',jobId:'job',loadJob:async()=>job(),saveItem:async()=>{throw {status:404};}});
 assert.equal(revoked.pending.length,0);assert.equal(revoked.conflicts[0].reason,'access_revoked');
});
test('already-confirmed intent and deleted items are never sent',async()=>{
 const d=fixture().create();d.set('u','job','item',true);d.set('u','job','deleted',true);let writes=0;
 const r=await d.flush({userId:'u',jobId:'job',loadJob:async()=>({...job(),checklist:[{id:'item',completed:true}]}),saveItem:async()=>writes++});
 assert.equal(writes,0);assert.equal(r.saved,0);assert.deepEqual(r.pending,[]);assert.deepEqual(r.conflicts,[{itemId:'deleted',reason:'item_removed'}]);
});
