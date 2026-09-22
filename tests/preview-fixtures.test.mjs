import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../preview/fixtures.js',import.meta.url),'utf8');
function preview(){
  const context={window:{ST_BUILD:'preview-test'},Intl,Date,URL,structuredClone,Promise};
  vm.runInNewContext(source,context);
  return context.window.STPreview;
}

test('demo API covers primary admin, cleaner and client screens with Bratislava and Prague examples',async()=>{
  const demo=preview();
  const routes=[
    '/api/admin/dashboard','/api/admin/jobs','/api/admin/objects','/api/admin/clients',
    '/api/admin/cleaners','/api/admin/capacity?date=2026-09-23',
    '/api/admin/analytics','/api/admin/finance?month=2026-09',
    '/api/admin/issues','/api/admin/settings','/api/admin/recurring',
    '/api/admin/settlements','/api/cleaner/dashboard','/api/cleaner/marketplace',
    '/api/cleaner/jobs/101','/api/cleaner/settlements','/api/client/dashboard',
    '/api/client/objects','/api/client/objects/11','/api/client/slots?objectId=11',
    '/api/client/bookings','/api/client/bookings/101','/api/client/profile',
    '/api/client/settlements','/api/notifications'
  ];
  for(const route of routes)assert.ok(await demo.request(route),route);
  const objects=(await demo.request('/api/admin/objects')).objects;
  assert.equal(objects.length,4);
  assert.ok(objects.some(object=>object.address.includes('Bratislava')));
  assert.ok(objects.some(object=>object.address.includes('Praha')));
  assert.ok(objects.every(object=>Number.isFinite(object.lat)&&Number.isFinite(object.lng)));
  const clients=(await demo.request('/api/admin/clients')).clients;
  assert.ok(clients.every(client=>Number.isInteger(client.objects)&&Number.isInteger(client.approved_objects)&&Number.isInteger(client.month_jobs)));
  assert.ok((await demo.request('/api/cleaner/marketplace')).jobs.every(job=>job.projected_finish));
  const settlement=await demo.request('/api/client/settlements');
  assert.equal(settlement.summary.chargedCents,settlement.jobs.reduce((sum,job)=>sum+job.chargedCents,0));
});

test('demo responses stay isolated and mutations cannot change the preview',async()=>{
  const demo=preview();
  const client=(await demo.request('/api/client/objects')).objects;
  assert.equal('payout' in client[0],false);
  const marketplace=(await demo.request('/api/cleaner/marketplace')).jobs;
  assert.equal('client_price' in marketplace[0],false);
  assert.equal('access_instructions' in marketplace[0],false);
  client[0].name='Modified locally';
  assert.notEqual((await demo.request('/api/client/objects')).objects[0].name,'Modified locally');
  await assert.rejects(demo.request('/api/client/bookings',{method:'POST'}),/editing is unavailable/);
  assert.equal((await demo.request('/api/client/bookings')).bookings.length,5);
});

test('preview builder removes the redundant widget and keeps the role banner in normal page flow',async()=>{
  const source=await readFile(new URL('../scripts/build-preview.mjs',import.meta.url),'utf8');
  assert.match(source,/script!==['"]assets\/operations-dashboard\.js['"]/);
  assert.match(source,/position:sticky/);
  assert.match(source,/assetVersion=encodeURIComponent\(commit\.slice\(0,12\)\)/);
  assert.match(source,/preview-fixtures\.js[^\n]+assetVersion/);
  assert.doesNotMatch(source,/position:fixed;z-index:99999;bottom:0/);
});
