import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveUpdates, staticCacheAllowed } from '../assets/live-updates.mjs';
const delay=ms=>new Promise(r=>setTimeout(r,ms));
test('incoming events coalesce and wait while a user edits',async()=>{
 let busy=true,calls=0;const live=createLiveUpdates({isBusy:()=>busy,refresh:async()=>{calls++},delay:5});
 live.invalidate();live.invalidate();await delay(15);assert.equal(calls,0);assert.equal(live.pending,true);
 busy=false;live.resume();await delay(15);assert.equal(calls,1);live.stop();
});
test('events received during a refresh are not lost or refreshed concurrently',async()=>{
 let calls=0,active=0,max=0;const live=createLiveUpdates({isBusy:()=>false,delay:2,refresh:async()=>{calls++;active++;max=Math.max(max,active);if(calls===1)live.invalidate();await delay(8);active--;}});
 live.invalidate();await delay(40);assert.equal(calls,2);assert.equal(max,1);live.stop();
});
test('private media and cross-origin resources are never shell cached',()=>{
 const origin='https://shinetime.sk';
 assert.equal(staticCacheAllowed('https://x.supabase.co/storage/v1/object/sign/bucket/secret',origin,'/app/'),false);
 assert.equal(staticCacheAllowed(origin+'/app/config/supabase.php',origin,'/app/'),false);
 assert.equal(staticCacheAllowed(origin+'/app/assets/styles.css?v=4',origin,'/app/'),true);
 assert.equal(staticCacheAllowed(origin+'/app/api/me',origin,'/app/'),false);
});
