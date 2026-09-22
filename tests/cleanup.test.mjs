import test from 'node:test';
import assert from 'node:assert/strict';
import {operationsRoute} from '../supabase/functions/st-api/operations.mjs';
test('expired upload cleanup preserves referenced media and does not discard tickets on storage failure',async()=>{
 const removed=[],deleted=[];
 const tickets=[{id:'referenced',storage_path:'1/ref.jpg'},{id:'orphan',storage_path:'1/orphan.jpg'},{id:'failed',storage_path:'1/failed.jpg'}];
 const service={from(table){let path,id,del=false;const q={select(){return q},is(){return q},lt(){return q},eq(k,v){if(k==='storage_path')path=v;if(k==='id')id=v;return q},limit(){return q},delete(){del=true;return q},then(resolve){if(del){deleted.push(id);return Promise.resolve({data:null,error:null}).then(resolve)}return Promise.resolve({data:table==='st_upload_tickets'?tickets:path==='1/ref.jpg'?[{id:10}]:[],error:null}).then(resolve)}};return q},storage:{from(){return {remove:async([path])=>{if(path==='1/failed.jpg')return {error:new Error('Unavailable')};removed.push(path);return {data:[],error:null}}}}}};
 const result=async q=>{const r=await q;if(r.error)throw r.error;return r.data};
 const args={ctx:{appUser:{id:1,role:'ADMIN'}},route:'admin/media/cleanup',method:'POST',body:{},query:{},service,result,ApiError:Error,today:()=> '2026-09-07'};
 const response=await operationsRoute(args);
 assert.deepEqual(removed,['1/orphan.jpg']);assert.deepEqual(deleted,['orphan']);assert.equal(response.outcomes.length,3);
 await assert.rejects(operationsRoute({...args,ctx:{appUser:{id:2,role:'CLEANER'}}}),/Forbidden/);
});
