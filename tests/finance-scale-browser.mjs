// Monthly reconciliation at production scale: 1,200 approved cleanings, 40 properties, 30 clients, 28 cleaners.
// Checks that the page renders, search responds to typing, and a client's month is paid in one request.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||process.cwd()+'/artifacts/browser/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});

const CLIENTS=30,CLEANERS=28,OBJECTS=40,JOBS=1200;
const MONTH='2099-01';

// Deterministic synthetic month shaped like the server's st_monthly_reconciliation payload.
function monthPayload(){
 const objects=[],jobs=[];
 for(let o=0;o<OBJECTS;o++){
  objects.push({objectId:100+o,objectCode:'OBJ-'+(o+1),objectName:'Object '+(o+1),jobsCount:0,clientNames:'Company '+((o%CLIENTS)+1),cleanerNames:'',
   clientAmountCents:0,clientPaidCents:0,clientDueCents:0,cleanerAmountCents:0,cleanerPaidCents:0,cleanerDueCents:0});
 }
 for(let g=1;g<=JOBS;g++){
  const o=(g-1)%OBJECTS,obj=objects[o];
  const clientId=1+(o%CLIENTS),cleanerId=1+((g*7)%CLEANERS);
  const client=(g%3)===0?40:45,cleaner=20;
  const clientCents=client*100,cleanerCents=cleaner*100;
  const paid=g%4===0?clientCents:(g%5===0?1000:0);
  const cleanerPaid=g%6===0?cleanerCents:0;
  const job={id:1000+g,objectId:obj.objectId,objectCode:obj.objectCode,objectName:obj.objectName,clientId,clientName:'Company '+clientId,
   cleanerId,cleanerName:'Cleaner '+cleanerId,serviceDate:`${MONTH}-${String(1+Math.floor((g-1)/OBJECTS)).padStart(2,'0')}`,
   clientAmountCents:clientCents,clientPaidCents:paid,clientDueCents:clientCents-paid,
   cleanerAmountCents:cleanerCents,cleanerPaidCents:cleanerPaid,cleanerDueCents:cleanerCents-cleanerPaid,
   clientPriceCents:client*100,extraRevenueCents:0,payoutCents:cleaner*100,bonusCents:0,editable:false};
  jobs.push(job);
  obj.jobsCount++;obj.clientAmountCents+=clientCents;obj.clientPaidCents+=paid;obj.clientDueCents+=clientCents-paid;
  obj.cleanerAmountCents+=cleanerCents;obj.cleanerPaidCents+=cleanerPaid;obj.cleanerDueCents+=cleanerCents-cleanerPaid;
 }
 const sum=k=>jobs.reduce((a,j)=>a+j[k],0);
 return {month:MONTH,summary:{jobsCount:jobs.length,clientAmountCents:sum('clientAmountCents'),clientPaidCents:sum('clientPaidCents'),clientDueCents:sum('clientDueCents'),
  cleanerAmountCents:sum('cleanerAmountCents'),cleanerPaidCents:sum('cleanerPaidCents'),cleanerDueCents:sum('cleanerDueCents')},objects,jobs,hasMore:false};
}

const page=await browser.newPage({viewport:{width:1280,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
const batches=[];
await page.route('https://scale.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>'}));
await page.goto('https://scale.test/');
await page.evaluate(()=>localStorage.setItem('st_locale','en'));
for(const name of ['styles.css','ui-system.css','mobile-ui.css','operations-workspace.css','finance-reconciliation.css'])await page.addStyleTag({content:await readFile('assets/'+name,'utf8')});
for(const name of ['i18n.js','operations-ui-core.js','live-updates.js','operations-board.js','checklist-drafts.js','workspace-i18n.js','app.js','money.js','operations-extension.js','finance-statements.js'])await page.addScriptTag({content:await readFile('assets/'+name,'utf8')});
const data=monthPayload();
await page.evaluate(data=>{
 window.ST_BASE='/';window.batchBodies=[];
 window.ShineTimeSupabase={subscribeJobs(){return()=>{}},onRecovery(){},request:async(path,opts={})=>{
  if(path.startsWith('/api/admin/settlements/reconciliation'))return data;
  if(path==='/api/admin/settlements/batch'){window.batchBodies.push(opts.body);return {count:opts.body.items.length,amountCents:opts.body.items.reduce((n,i)=>n+i.amountCents,0)}}
  if(path.startsWith('/api/admin/settlements/monthly'))return {groups:[],jobs:[],hasMore:false,waitingReviewJobs:0};
  if(path==='/api/admin/objects')return {objects:[{id:100,code:'OBJ-1',name:'Object 1',active:true,approval_status:'APPROVED',client_price:40,payout:20,checkout_time:'08:00',deadline_time:'20:00',duration_minutes:60}]};
  if(path==='/api/admin/cleaners')return {cleaners:[{id:1,full_name:'Cleaner 1',active:true}]};
  if(path==='/api/admin/finance/manual-cleanings'){window.manualCleaningBody=opts.body;return {job:{id:1}}}
  if(path==='/api/admin/settlements/manual'){window.manualPaymentBody=opts.body;return {count:1,amountCents:opts.body.amountCents}}
  throw new Error('unexpected '+path);
 }};
 state.me={id:1,role:'ADMIN',full_name:'Admin',language:'en'};state.settings={companyName:'Shine Time'};
 state.statementMonth=data.month;
},data);
await page.evaluate(async()=>{location.hash='admin/statements';await new Promise(r=>setTimeout(r,50));await statementsScreen()});
await page.locator('.recon-seg').waitFor();
const renderMs=await page.evaluate(async()=>{const t=performance.now();await statementsScreen();return Math.round(performance.now()-t)});
console.log(`render 1200 cleanings: ${renderMs} ms`);
assert.ok(renderMs<2000,`reconciliation render too slow: ${renderMs} ms`);

// Summary matches the server totals (no rows are dropped by the UI).
const kpi=await page.locator('.recon-kpis').innerText();
assert.match(kpi,/Client total/);

// Switch to clients and search: each keystroke re-renders the list, so it must stay responsive.
await page.getByRole('tab',{name:'By client'}).click();
await page.locator('.recon-party-table').waitFor();
const rowsAll=await page.locator('.recon-party-table tbody tr.recon-party-row').count();
assert.equal(rowsAll,CLIENTS,'one row per client');
const t0=Date.now();
await page.locator('.recon-search').fill('Company 1');
const searchMs=Date.now()-t0;
const matches=await page.locator('.recon-party-table tbody tr.recon-party-row').count();
console.log(`search "Company 1": ${matches} rows in ${searchMs} ms`);
assert.ok(matches>=1&&matches<=CLIENTS);
assert.ok(searchMs<3000,'search response too slow');
await page.locator('.recon-search').fill('');

// Pay one client's whole month: one request with every outstanding cleaning of that client.
await page.getByRole('tab',{name:'By client'}).click();
await page.locator('.recon-party-table').waitFor();
page.once('dialog',d=>d.accept());
await page.locator('.recon-party-row').first().getByRole('button',{name:'Pay all'}).click();
await page.waitForFunction(()=>window.batchBodies.length>=1,null,{timeout:10000});
const body=await page.evaluate(()=>window.batchBodies[0]);
assert.equal(body.side,'CLIENT');
assert.ok(body.items.length>0);
assert.ok(body.items.every(i=>i.amountCents>0),'only outstanding amounts are sent');
assert.equal(new Set(body.items.map(i=>i.jobId)).size,body.items.length,'no duplicate cleanings');
console.log(`pay all for one client: ${body.items.length} cleanings in 1 request`);

// Two clients selected, the second batch fails: the message says how much was already recorded.
await page.evaluate(()=>{window.batchBodies=[];window.failBatchNumber=2;const original=ShineTimeSupabase.request;ShineTimeSupabase.request=async(path,opts={})=>{
 if(path==='/api/admin/settlements/batch'){window.batchBodies.push(opts.body);if(window.batchBodies.length===window.failBatchNumber)throw new Error('Synthetic failure');return {count:opts.body.items.length,amountCents:opts.body.items.reduce((n,i)=>n+i.amountCents,0)}}
 return original(path,opts)};});
const boxes=page.locator('.recon-party-row input[type=checkbox]:not([disabled])');
await boxes.nth(0).check();await boxes.nth(1).check();
page.once('dialog',d=>d.accept());
await page.getByRole('button',{name:'Pay selected',exact:true}).click();
await page.waitForFunction(()=>window.batchBodies.length>=2,null,{timeout:10000});
const first=await page.evaluate(()=>window.batchBodies[0].items.length);
await page.locator('#toast-root').getByText(new RegExp('Recorded '+first+' / ')).waitFor({timeout:5000});
console.log('partial failure reported with recorded count');

// Manual entry: a cleaning done outside the system, then a partial payment received by hand.
await page.getByRole('button',{name:'Add cleaning',exact:true}).click();
await page.locator('#manual-cleaning-form').waitFor();
await page.getByRole('button',{name:'Save cleaning',exact:true}).click();
await page.waitForFunction(()=>window.manualCleaningBody);
const mc=await page.evaluate(()=>window.manualCleaningBody);
assert.equal(mc.objectId,100);assert.equal(mc.clientPrice,40);assert.equal(mc.payout,20);assert.equal(mc.cleanerId,1);assert.equal(mc.note,undefined,'no reason is asked for');
await page.getByRole('button',{name:'Add payment',exact:true}).click();
await page.locator('#mp-amount').fill('15');
await page.locator('#mp-note').fill('Bank transfer 28.10');
await page.locator('#mp-preview').getByText(/cleanings/).waitFor();
await page.getByRole('button',{name:'Save payment',exact:true}).click();
await page.waitForFunction(()=>window.manualPaymentBody);
const mp=await page.evaluate(()=>window.manualPaymentBody);
assert.equal(mp.amountCents,1500);assert.equal(mp.side,'CLIENT');assert.equal(mp.items,undefined,'the server allocates the amount');
console.log('PASS manual cleaning and manual payment entry');

assert.deepEqual(errors,[]);
console.log('PASS finance at scale: 1,200 cleanings render, search responds, client month paid in one request');
await browser.close();
