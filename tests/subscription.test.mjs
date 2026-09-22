import test from 'node:test';
import assert from 'node:assert/strict';
import {subscribeJobChanges} from '../assets/job-subscription.mjs';
test('connection readiness catches missed changes and resets on reconnect',()=>{
 const handlers={},statuses=[],refreshes=[];let status,removed=false;
 const channel={on(type,filter,callback){handlers[type]=callback;return this;},subscribe(callback){status=callback;return this;}};
 const stop=subscribeJobChanges({channel:()=>channel,removeChannel:()=>{removed=true;}},()=>refreshes.push(true),s=>statuses.push(s));
 status('SUBSCRIBED');assert.deepEqual(statuses,['CONNECTING']);assert.equal(refreshes.length,0);
 handlers.system({extension:'postgres_changes',status:'ok'});assert.equal(statuses.at(-1),'SUBSCRIBED');assert.equal(refreshes.length,1);
 handlers.postgres_changes({new:{job_id:1}});assert.equal(refreshes.length,2);
 status('CHANNEL_ERROR');assert.equal(statuses.at(-1),'CHANNEL_ERROR');
 handlers.system({extension:'postgres_changes',status:'ok'});assert.equal(refreshes.length,3);
 stop();assert.equal(removed,true);
});
