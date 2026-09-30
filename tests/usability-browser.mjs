import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||process.cwd()+'/artifacts/browser/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});

// Synthetic API with state, so each flow is checked by the request it sends and by what the UI shows next.
async function openApp(viewport={width:1280,height:900},locale='en'){
 const page=await browser.newPage({viewport}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://usability.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>'}));
 await page.route('https://nominatim.openstreetmap.org/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify([{lat:'48.1459',lon:'17.1077',display_name:'Dunajská 15, Bratislava'}])}));
 await page.goto('https://usability.test/');
 await page.evaluate(l=>localStorage.setItem('st_locale',l),locale);
 for(const name of ['styles.css','ui-system.css','mobile-ui.css','operations-workspace.css'])await page.addStyleTag({content:await readFile('assets/'+name,'utf8')});
 for(const name of ['i18n.js','operations-ui-core.js','live-updates.js','operations-board.js','checklist-drafts.js','workspace-i18n.js'])await page.addScriptTag({content:await readFile('assets/'+name,'utf8')});
 await page.evaluate(()=>{
  window.ST_BASE='/';window.calls=[];
  window.linked=new Set([12]);
  window.jobs=[
   {id:101,object_id:11,object_code:'BA-101',object_name:'Dunajská apartment',address:'Dunajská 15, Bratislava',lat:48.1459,lng:17.1077,zone:'Staré Mesto',status:'EN_ROUTE',review_status:'NOT_SUBMITTED',review_version:0,assigned_cleaner_id:1,cleaner_name:'Test Cleaner',cleaner_phone:'+421 900 000 000',earliest_start:'10:00:00',deadline:'15:00:00',duration_minutes:90,marketplace_visible:false,payout:20,bonus:0,client_price:40,service_date:'2099-01-01',access_instructions:'Code 0000',checklist:[{id:7,label:'Kitchen',required:true,completed:false}],photos:[],issues:[],events:[{event_type:'CLEANER_ACCEPTED',created_at:'2099-01-01T08:00:00Z'},{event_type:'STATUS_EN_ROUTE',created_at:'2099-01-01T09:00:00Z'}]},
  ];
  window.objects=[{id:11,code:'BA-101',name:'Dunajská apartment',address:'Dunajská 15, Bratislava',zone:'Staré Mesto',client_id:4,active:true,approval_status:'APPROVED'},{id:12,code:'BA-102',name:'Riverside',address:'Pribinova 8',zone:'Ružinov',client_id:4,active:true,approval_status:'APPROVED'}];
  window.ShineTimeSupabase={subscribeJobs(){return()=>{}},onRecovery(){},request:async(path,opts={})=>{
   calls.push({path,method:opts.method||'GET',body:opts.body});
   const job=id=>jobs.find(x=>x.id===Number(id));
   let m;
   if(path.startsWith('/api/admin/jobs?')||path==='/api/admin/jobs')return {jobs:structuredClone(jobs)};
   if(path==='/api/admin/cleaners')return {cleaners:[{id:1,full_name:'Test Cleaner',mode:'FLEX',reliability_score:95,active:true}]};
   if(path==='/api/admin/clients')return {clients:[{id:5,full_name:'Manager',email:'m@test.invalid',account_type:'PROPERTY_MANAGER',user_active:true,language:'en'}]};
   if(path==='/api/admin/objects')return {objects:structuredClone(objects)};
   if(m=path.match(/^\/api\/admin\/clients\/5\/properties(?:\/(\d+))?$/)){
    if((opts.method||'GET')==='GET')return {objectIds:[...linked]};
    if(opts.method==='POST'){linked.add(Number(opts.body.objectId));return {ok:true}}
    if(opts.method==='DELETE'){linked.delete(Number(m[1]));return {ok:true}}
   }
   if(m=path.match(/^\/api\/admin\/jobs\/(\d+)\/cancel$/)){Object.assign(job(m[1]),{status:'CANCELLED',cancellation_reason:opts.body.reason});return {job:structuredClone(job(m[1]))}}
   if((m=path.match(/^\/api\/admin\/jobs\/(\d+)$/))&&opts.method==='PATCH'){const j=job(m[1]);Object.assign(j,{earliest_start:opts.body.earliestStart,deadline:opts.body.deadline,duration_minutes:opts.body.durationMinutes,marketplace_visible:opts.body.marketplaceVisible});return {job:structuredClone(j)}}
   if(m=path.match(/^\/api\/(?:admin|cleaner)\/jobs\/(\d+)$/))return structuredClone(job(m[1]));
   if(m=path.match(/^\/api\/cleaner\/jobs\/(\d+)\/cancel$/)){Object.assign(job(m[1]),{status:'UNASSIGNED',assigned_cleaner_id:null});return {job:structuredClone(job(m[1]))}}
   if(path.startsWith('/api/cleaner/dashboard'))return {availability:{online:true,fromTime:'08:00',toTime:'20:00'},jobs:[],total:0,earnings:0};
   if(m=path.match(/^\/api\/client\/bookings\/(\d+)$/))return {booking:structuredClone(job(m[1])),photos:[],issues:[]};
   if(path.startsWith('/api/admin/settlements/monthly')){const q=new URL(path,'https://x.test').searchParams;window.monthlyCalls=(window.monthlyCalls||0)+1;if(q.get('partyId'))return {jobs:window.batchDone?[]:[{id:201,object_name:'Flat A',service_date:'2099-01-05',chargedCents:4000,paidCents:0,dueCents:4000},{id:202,object_name:'Flat B',service_date:'2099-01-06',chargedCents:3550,paidCents:0,dueCents:3550}],hasMore:false};return {groups:[{id:4,name:'Demo stays',count:2,chargedCents:7550,paidCents:window.batchDone?7550:0,dueCents:window.batchDone?0:7550}],jobs:[],hasMore:false,waitingReviewJobs:1}}
   if(path==='/api/admin/settlements/batch'){window.batchBodies=(window.batchBodies||[]).concat([opts.body]);window.batchDone=true;return {count:opts.body.items.length,amountCents:opts.body.items.reduce((n,i)=>n+i.amountCents,0)}}
   if(path.startsWith('/api/admin/settlements'))return {summary:{},jobs:[],hasMore:false};
   if(path==='/api/notifications')return {notifications:[],unread:0};
   if(path==='/api/account/language')return {ok:true};
   throw Error('Unexpected route '+path);
  }};
 });
 await page.addScriptTag({content:await readFile('assets/app.js','utf8')});
 await page.addScriptTag({content:await readFile('assets/property-photos.js','utf8')});
 for(const name of ['money.js','operations-extension.js'])await page.addScriptTag({content:await readFile('assets/'+name,'utf8')});
 return {page,errors};
}
const lastCall=(page,re,method)=>page.evaluate(([src,m])=>calls.filter(c=>new RegExp(src).test(c.path)&&(!m||c.method===m)).at(-1),[re.source,method]);

try {
 // Admin: schedule edit, readable history, maps link, in-app cancel dialog.
 {
  const {page,errors}=await openApp();
  await page.evaluate(async()=>{state.me={id:1,role:'ADMIN',full_name:'Admin',language:'en'};state.settings={};location.hash='admin/jobs';await new Promise(r=>setTimeout(r,100));await render();await openAdminJob(101)});
  await page.locator('#job-deadline').waitFor();
  assert.match(await page.locator('.modal').innerText(),/Cleaner on the way/,'history uses readable labels');
  assert.doesNotMatch(await page.locator('.modal').innerText(),/STATUS_EN_ROUTE/);
  assert.match(await page.locator('.modal a[href*="google.com/maps/dir"]').first().getAttribute('href'),/48\.1459%2C17\.1077/);
  assert.equal(await page.locator('.modal a[href^="tel:"]').count(),1,'cleaner phone is callable');
  await page.fill('#job-deadline','14:30');await page.fill('#job-duration','75');
  await page.getByRole('button',{name:'Save schedule'}).click();
  await page.waitForFunction(()=>calls.some(c=>c.method==='PATCH'));
  const patch=await lastCall(page,/\/api\/admin\/jobs\/101$/,'PATCH');
  assert.deepEqual(patch.body,{earliestStart:'10:00',deadline:'14:30',durationMinutes:75,marketplaceVisible:false});
  await page.locator('#job-deadline').waitFor();
  await page.getByRole('button',{name:'Cancel job'}).click();
  await page.locator('#ask-input').waitFor();
  await page.locator('#ask-ok').click();
  assert.match(await page.locator('#ask-error').innerText(),/required/i,'reason is required before cancelling');
  await page.fill('#ask-input','Guest extended stay');await page.locator('#ask-ok').click();
  await page.waitForFunction(()=>calls.some(c=>/\/cancel$/.test(c.path)));
  assert.deepEqual((await lastCall(page,/\/api\/admin\/jobs\/101\/cancel$/,'POST')).body,{reason:'Guest extended stay'});
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS admin schedule edit, cancel dialog, readable history, maps and phone links');
 }
 // Admin: property-manager portfolio linking.
 {
  const {page,errors}=await openApp();
  await page.evaluate(async()=>{state.me={id:1,role:'ADMIN',full_name:'Admin',language:'en'};state.settings={};location.hash='admin/clients';await new Promise(r=>setTimeout(r,100));await render().catch(()=>{});state.clients=(await ShineTimeSupabase.request('/api/admin/clients')).clients;clientAdminModal(5)});
  await page.locator('#pm-portfolio .portfolio-row').first().waitFor();
  assert.equal(await page.locator('#pm-portfolio input:checked').count(),1);
  await page.locator('#pm-portfolio .portfolio-row',{hasText:'BA-101'}).locator('input').check();
  await page.waitForFunction(()=>linked.has(11));
  assert.deepEqual((await lastCall(page,/properties$/,'POST')).body,{objectId:11});
  await page.locator('#pm-portfolio .portfolio-row',{hasText:'BA-102'}).locator('input').uncheck();
  await page.waitForFunction(()=>!linked.has(12));
  assert.equal((await lastCall(page,/properties\/12$/,'DELETE')).method,'DELETE');
  await page.fill('.portfolio-panel input[type=search]','riverside');
  assert.equal(await page.locator('#pm-portfolio .portfolio-row:not([hidden])').count(),1);
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS property-manager portfolio link, unlink and search');
 }
 // Object form: coordinates from address instead of typing numbers.
 {
  const {page,errors}=await openApp({width:390,height:844});
  await page.evaluate(()=>{state.me={id:4,role:'OWNER',full_name:'Owner',language:'en'};document.getElementById('modal-root').innerHTML='<form id="f"><input name="address" value="Dunajská 15, Bratislava"><input name="lat"><input name="lng"></form>';document.getElementById('f').insertAdjacentHTML('beforeend',geoActions())});
  await page.locator('.geo-actions button').first().click();
  await page.waitForFunction(()=>document.querySelector('[name=lat]').value!=='');
  assert.equal(await page.inputValue('[name=lat]'),'48.145900');assert.equal(await page.inputValue('[name=lng]'),'17.107700');
  assert.match(await page.locator('.geo-status').innerText(),/Found/);
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS address geocoding fills coordinates');
 }
 // Cleaner: navigation links and cancel dialog; client: progress tracker; Russian labels.
 {
  const {page,errors}=await openApp({width:390,height:844},'ru');
  await page.evaluate(async()=>{state.me={id:3,role:'CLEANER',full_name:'Cleaner',language:'ru'};state.settings={};location.hash='cleaner/job/101';await render()});
  await page.locator('.active-job-head .nav-links a').first().waitFor();
  assert.equal(await page.locator('.active-job-head .nav-links a').count(),2,'Google Maps and Waze');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no horizontal scroll');
  await page.evaluate(()=>{jobs[0].status='ACCEPTED'});await page.evaluate(()=>render());
  await page.locator('.sticky-action .btn.red').click();
  await page.locator('#ask-input').waitFor();
  assert.match(await page.locator('.modal').innerText(),/диспетчер/i,'dialog is translated');
  await page.fill('#ask-input','Ill');await page.locator('#ask-ok').click();
  await page.waitForFunction(()=>calls.some(c=>/cleaner\/jobs\/101\/cancel$/.test(c.path)));
  assert.deepEqual((await lastCall(page,/cleaner\/jobs\/101\/cancel$/,'POST')).body,{reason:'Ill'});
  await page.evaluate(async()=>{Object.assign(jobs[0],{status:'CLEANING',assigned_cleaner_id:1});state.me={id:4,role:'OWNER',full_name:'Owner',language:'ru'};lastShellRole=null;location.hash='client/booking/101';await render()});
  await page.locator('.progress-track').waitFor();
  assert.equal(await page.locator('.progress-track li.done').count(),4);
  assert.match(await page.locator('.progress-track li[aria-current=step]').innerText(),/Уборка/);
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS cleaner navigation and release dialog, client progress tracker, Russian labels');
 }
 // Admin: one monthly receipt covering several approved jobs.
 {
  const {page,errors}=await openApp();
  await page.evaluate(async()=>{state.me={id:1,role:'ADMIN',full_name:'Admin',language:'en'};state.settings={};location.hash='admin/settlements';await new Promise(r=>setTimeout(r,100));await render();monthlySettlementModal('CLIENT')});
  await page.getByRole('button',{name:'Select jobs'}).click();
  await page.locator('#monthly-jobs input[data-job]').first().waitFor();
  assert.match(await page.locator('.modal').innerText(),/waiting for quality review/);
  assert.match(await page.locator('#monthly-submit').innerText(),/2 · €75\.50/);
  await page.locator('#monthly-jobs input[data-job="202"]').uncheck();
  assert.match(await page.locator('#monthly-submit').innerText(),/1 · €40/);
  await page.fill('#monthly-note','Bank ref 42');
  await page.locator('#monthly-submit').click();
  await page.waitForFunction(()=>window.batchBodies?.length===1);
  const body=await page.evaluate(()=>batchBodies[0]);
  assert.equal(body.side,'CLIENT');assert.equal(body.partyId,4);assert.equal(body.note,'Bank ref 42');
  assert.deepEqual(body.items,[{jobId:201,amountCents:4000}]);assert.match(body.requestId,/^[0-9a-f-]{36}$/);
  await page.getByText('Settled').waitFor();
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS monthly batch settlement: approved-only notice, selection total, idempotent request');
 }
 // Language switch re-renders navigation, not only the page body.
 {
  const {page,errors}=await openApp();
  await page.evaluate(async()=>{state.me={id:1,role:'ADMIN',full_name:'Admin',language:'en'};state.settings={};location.hash='admin/jobs';await render()});
  await page.locator('#admin-sidebar').waitFor();
  await page.evaluate(()=>setAppLanguage('uk'));
  await page.waitForFunction(()=>document.querySelector('#admin-sidebar')?.innerText.includes('Прибирання')||document.querySelector('#admin-sidebar')?.innerText.includes('Об’єкти'));
  assert.doesNotMatch(await page.locator('#admin-sidebar').innerText(),/Live Operations/);
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS language switch translates navigation');
 }
} finally {await browser.close()}
