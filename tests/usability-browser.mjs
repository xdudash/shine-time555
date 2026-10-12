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
   if(path==='/api/admin/jobs'&&opts.method==='POST'){window.createdJob=opts.body;return {job:{id:501,status:'UNASSIGNED'}}}
   if(path.startsWith('/api/admin/jobs?')||path==='/api/admin/jobs')return {jobs:structuredClone(jobs)};
   if(path==='/api/admin/cleaners')return {cleaners:[{id:1,full_name:'Test Cleaner',mode:'FLEX',reliability_score:95,active:true}]};
   if(path==='/api/admin/clients'&&(opts.method||'GET')==='GET')return {clients:[{id:5,full_name:'Manager',email:'m@test.invalid',account_type:'PROPERTY_MANAGER',user_active:true,language:'en'},{id:4,full_name:'Olga Owner',company_name:'Demo stays',billing_name:'Demo stays s.r.o.',billing_address:'Hlavná 1, Bratislava',ico:'12345678',email:'o@test.invalid',account_type:'OWNER',user_active:true,language:'en'}]};
   if((m=path.match(/^\/api\/admin\/(clients|cleaners|objects)\/(\d+)$/))&&['PATCH','DELETE'].includes(opts.method)){window.mutations=(window.mutations||[]).concat([{path,method:opts.method,body:opts.body}]);if(opts.method==='DELETE'&&m[2]==='11')throw Object.assign(Error('update or delete on table "st_objects" violates foreign key constraint on table "st_jobs"'),{status:409});return {ok:true}}
   if(path.startsWith('/api/admin/finance?'))return {entries:[{id:1,client_id:4,entry_date:'2099-01-09',entry_type:'INCOME',category:'LAUNDRY',amount:12,description:'Towels'}]};
   if(m=path.match(/^\/api\/objects\/11\/reference-photos(?:\/(\d+))?$/)){window.photos ||= [{id:1,caption:'Entrance',mime:'image/png'},{id:2,caption:'Door',mime:'image/png'}];if(opts.method==='DELETE'){photos=photos.filter(p=>p.id!==Number(m[1]));return {ok:true}}if(m[1])return {dataUrl:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aBZkAAAAASUVORK5CYII='};return {photos:structuredClone(photos)}}
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
   if(path.startsWith('/api/client/slots'))return {object:{id:11,name:'Dunajská apartment',client_price:42,duration_minutes:90},window:{from:'11:00',to:'15:00',durationMinutes:90},slots:[]};
   if(path==='/api/client/bookings'&&opts.method==='POST'){window.bookings=(window.bookings||[]).concat([opts.body]);return {booking:{id:301,status:'UNASSIGNED'}}}
   if(path==='/api/client/objects')return {objects:[{id:11,code:'BA-101',name:'Dunajská apartment',address:'Dunajská 15',zone:'Staré Mesto',active:true,approval_status:'APPROVED',client_price:42,apartment_type:'2 rooms'}]};
   if(path.startsWith('/api/cleaner/marketplace'))return {jobs:[{id:401,object_code:'BA-101',zone:'Staré Mesto',earliest_start:'11:00',deadline:'15:00',duration_minutes:90,payout:24,bonus:0,client_note:'Guests at 16:00',feasible:true,earliest_feasible_start:'11:00',latest_start:'13:30'},{id:402,object_code:'BA-102',zone:'Ružinov',earliest_start:'09:00',deadline:'10:00',duration_minutes:90,payout:20,bonus:6,feasible:false,feasibility_reason:'Not enough time left before the deadline'}]};
   if(m=path.match(/^\/api\/cleaner\/jobs\/(\d+)\/accept$/)){window.accepts=(window.accepts||[]).concat([{id:Number(m[1]),body:opts.body}]);return {job:{id:Number(m[1]),status:'ACCEPTED'}}}
   if(path==='/api/admin/managers'&&(opts.method||'GET')==='GET')return {managers:[{id:7,full_name:'Dispatcher One',email:'d1@test.invalid',phone:'',language:'en',active:true}]};
   if(path==='/api/admin/managers'&&opts.method==='POST'){window.createdManager=opts.body;return {manager:{id:8}}}
   if(path==='/api/notifications')return {notifications:[],unread:0};
   if(path.startsWith('/api/admin/analytics')){
    const q=new URL(path,'https://x.test').searchParams;
    window.analyticsCalls=(window.analyticsCalls||[]).concat([{from:q.get('from'),to:q.get('to')}]);
    return {from:q.get('from'),to:q.get('to'),
     summary:{jobs:12,completed:8,expired:2,cancelled:2,cancelledBy:{client:1,operations:1,other:0},rescue:3,escalated:1,issues:4,
      onTimePct:75,onTimeOf:8,medianOverrunMinutes:25,medianMinutesToAccept:95,acceptedOf:9,unassignedRatePct:16.7,
      reworkPct:12.5,reworkOf:8,outsideRadius:1,lateReleases:2},
     funnel:[{step:'booked',jobs:12},{step:'taken',jobs:9},{step:'arrived',jobs:8},{step:'completed',jobs:8},{step:'approved',jobs:7}],
     byDate:[{date:'2099-01-01',jobs:3,completed:2,expired:1,rescue:1,onTimePct:50},{date:'2099-01-02',jobs:4,completed:3,expired:0,rescue:1,onTimePct:100},{date:'2099-01-03',jobs:5,completed:3,expired:1,rescue:1,onTimePct:66.7}],
     cleanerRanking:[{full_name:'Test Cleaner',reliability_score:95,rating:4.8,completed_jobs:40,reclean_rate:2.5,cancellation_rate:1.2}],
     objectPerformance:[{id:11,code:'BA-101',name:'Dunajská apartment',duration_minutes:90,jobs:7,completed:6,expired:1,avg_worked_minutes:112,over_standard_minutes:22},
      {id:12,code:'BA-102',name:'Riverside',duration_minutes:60,jobs:0,completed:0,expired:0,avg_worked_minutes:null,over_standard_minutes:null}]};
   }
   if(path==='/api/account/push'&&opts.method==='POST'){window.savedSubscription=opts.body;return {subscription:{id:1,endpoint:opts.body.endpoint}}}
   if(path==='/api/account/push'&&opts.method==='DELETE'){window.removedSubscription=opts.body;return {removed:1}}
   if(path==='/api/account/push/test'){window.testPushes=(window.testPushes||0)+1;return {ok:true,browsers:1,removed:0}}
   if(path==='/api/account/notifications'){window.channelPatches=(window.channelPatches||[]).concat([opts.body]);return {push:opts.body.push!==undefined?opts.body.push:true,email:opts.body.email!==undefined?opts.body.email:true}}
   if(path==='/api/account/language')return {ok:true};
   throw Error('Unexpected route '+path);
  }};
 });
 await page.addScriptTag({content:await readFile('assets/app.js','utf8')});
 await page.addScriptTag({content:await readFile('assets/property-photos.js','utf8')});
 for(const name of ['money.js','operations-extension.js','finance-statements.js'])await page.addScriptTag({content:await readFile('assets/'+name,'utf8')});
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
 // Admin: client statement with 12-month debt, CSV and printable report.
 {
  const {page,errors}=await openApp();
  await page.evaluate(async()=>{state.me={id:1,role:'ADMIN',full_name:'Admin',language:'en'};state.settings={companyName:'Shine Time'};location.hash='admin/statements';await new Promise(r=>setTimeout(r,100));await render()});
  await page.getByRole('button',{name:'Statement',exact:true}).first().waitFor();
  assert.match(await page.locator('#page').innerText(),/€906/,'12-month outstanding sums every month');
  assert.match(await page.locator('#admin-sidebar').innerText(),/Statements/);
  await page.getByRole('button',{name:'Statement',exact:true}).first().click();
  await page.locator('.statement-head').waitFor();
  const text=await page.locator('.modal').innerText();
  assert.match(text,/Flat A/);assert.match(text,/Flat B/);assert.match(text,/€75\.50/);assert.match(text,/Towels/);
  const [popup]=await Promise.all([page.waitForEvent('popup'),page.getByRole('button',{name:/Print/}).click()]);
  await popup.waitForLoadState();
  const report=await popup.content();
  assert.match(report,/Demo stays s\.r\.o\./);assert.match(report,/IČO 12345678/);assert.match(report,/Amount due: €75\.50/);assert.doesNotMatch(report,/<script/i);
  await popup.close();
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'CSV'}).click()]);
  assert.match(download.suggestedFilename(),/^statement-Demo-stays-\d{4}-\d{2}\.csv$/);
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS client statement: 12-month debt, job lines, extras, printable report and CSV');
 }
 // Edit/delete controls: archive or delete property, deactivate accounts, delete reference photo.
 {
  const {page,errors}=await openApp();
  await page.evaluate(()=>{state.me={id:1,role:'ADMIN',full_name:'Admin',language:'en'};state.settings={}});
  await page.evaluate(()=>{setObjectActive(12,false)});await page.locator('#ask-ok').click();
  await page.waitForFunction(()=>window.mutations?.length===1);
  assert.deepEqual(await page.evaluate(()=>mutations[0]),{path:'/api/admin/objects/12',method:'PATCH',body:{active:false}});
  await page.evaluate(()=>{deleteObject(11,'BA-101')});await page.locator('#ask-ok').click();
  await page.waitForFunction(()=>document.querySelector('#toast-root')?.innerText.includes('Archive it instead'));
  await page.evaluate(()=>{setCleanerActive(1,false)});await page.locator('#ask-ok').click();
  await page.waitForFunction(()=>window.mutations?.some(m=>m.path==='/api/admin/cleaners/1'));
  assert.deepEqual(await page.evaluate(()=>mutations.find(m=>m.path==='/api/admin/cleaners/1').body),{active:false});
  await page.evaluate(()=>{document.querySelector('#app').innerHTML='<div id="page">'+propertyPhotoCard(11)+'</div>'});
  await page.locator('.property-photo-card button').click();
  await page.locator('#reference-gallery .photo-delete').first().waitFor();
  assert.equal(await page.locator('#reference-gallery figure').count(),2);
  await page.locator('#reference-gallery .photo-delete').first().click();
  assert.match(await page.locator('#reference-gallery .photo-delete').first().innerText(),/Tap again/);
  await page.locator('#reference-gallery .photo-delete').first().click();
  await page.waitForFunction(()=>document.querySelectorAll('#reference-gallery figure').length===1);
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS archive/delete property, deactivate cleaner, delete reference photo');
 }
 // Client books a window, not a fixed slot; the note reaches the server.
 {
  const {page,errors}=await openApp({width:390,height:844});
  await page.evaluate(async()=>{state.me={id:4,role:'OWNER',full_name:'Owner',language:'en'};state.settings={};location.hash='client/book';await new Promise(r=>setTimeout(r,100));await render()});
  await page.locator('#window-from').waitFor();
  assert.equal(await page.inputValue('#window-from'),'11:00');
  assert.equal(await page.inputValue('#window-to'),'15:00');
  assert.equal(await page.locator('.slot-grid').count(),0,'fixed slots are gone');
  await page.fill('#window-to','10:00');
  await page.locator('#reserve-cleaning-btn').click();
  await page.waitForFunction(()=>document.querySelector('#toast-root')?.innerText.includes('Ready-by'));
  await page.fill('#window-to','16:00');await page.fill('#booking-note','Guests at 16:00');
  await page.locator('#reserve-cleaning-btn').click();
  await page.waitForFunction(()=>window.bookings?.length===1);
  const sent=await page.evaluate(()=>bookings[0]);
  assert.equal(sent.objectId,11);assert.equal(sent.windowFrom,'11:00');assert.equal(sent.windowTo,'16:00');assert.equal(sent.note,'Guests at 16:00');
  assert.match(sent.serviceDate,/^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS client books a window with a note; no shift-dependent slots');
 }
 // Cleaner marketplace: seven days, start picker inside the window, honest refusal.
 {
  const {page,errors}=await openApp({width:390,height:844});
  await page.evaluate(async()=>{state.me={id:3,role:'CLEANER',full_name:'Cleaner',language:'en'};state.settings={};location.hash='cleaner/jobs';await new Promise(r=>setTimeout(r,100));await render()});
  await page.locator('#start-401').waitFor();
  assert.equal(await page.locator('.day-chips button').count(),7,'a week of days');
  const options=await page.locator('#start-401 option').allInnerTexts();
  assert.equal(options.at(0),'11:00');assert.equal(options.at(-1),'13:30');
  assert.match(await page.locator('.job-card',{hasText:'BA-101'}).innerText(),/Guests at 16:00/);
  assert.equal(await page.locator('.job-card',{hasText:'BA-102'}).locator('button[disabled]').count(),1);
  await page.selectOption('#start-401','12:30');
  await page.locator('.job-card',{hasText:'BA-101'}).getByRole('button',{name:'Take cleaning'}).click();
  await page.waitForFunction(()=>window.accepts?.length===1);
  assert.deepEqual(await page.evaluate(()=>accepts[0]),{id:401,body:{plannedStart:'12:30'}});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS cleaner marketplace: 7 days, start picker, client note, honest refusal');
 }
 // Admin creates an operations manager; the password rule is 12 characters.
 {
  const {page,errors}=await openApp();
  await page.evaluate(async()=>{state.me={id:1,role:'ADMIN',full_name:'Admin',language:'en'};state.settings={};location.hash='admin/cleaners';await new Promise(r=>setTimeout(r,100));await render()});
  await page.locator('#managers-card table').waitFor();
  assert.match(await page.locator('#managers-card').innerText(),/Dispatcher One/);
  await page.getByRole('button',{name:'Add manager'}).click();
  await page.locator('#manager-form').waitFor();
  assert.equal(await page.locator('#manager-form [name=password]').getAttribute('minlength'),'12');
  await page.fill('#manager-form [name=fullName]','New dispatcher');
  await page.fill('#manager-form [name=email]','new@test.invalid');
  await page.fill('#manager-form [name=password]','Long-enough-pass-2026');
  await page.getByRole('button',{name:'Save'}).click();
  await page.waitForFunction(()=>window.createdManager);
  assert.equal((await page.evaluate(()=>createdManager)).fullName,'New dispatcher');
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS admin adds an operations manager with a 12-character password');
 }
 // Notifications: this browser subscribes to push, can test it, and the account toggles are stored server side.
 {
  const {page,errors}=await openApp({width:390,height:844});
  await page.evaluate(async()=>{
   // A stand-in push manager: the real one needs a registered service worker,
   // which this harness does not have. Everything else is the real app code.
   window.__subscription=null;
   const subscription={endpoint:'https://push.example.invalid/f/abc',toJSON:()=>({keys:{p256dh:'BPc1-key',auth:'c2VjcmV0'}}),unsubscribe:async()=>{window.__subscription=null;return true}};
   Object.defineProperty(navigator,'serviceWorker',{configurable:true,value:{
    ready:Promise.resolve({pushManager:{
     getSubscription:async()=>window.__subscription,
     subscribe:async options=>{window.__subscribeOptions={userVisibleOnly:options.userVisibleOnly,keyBytes:options.applicationServerKey.length};window.__subscription=subscription;return subscription},
    }}),
    addEventListener(){},register:async()=>({}),
   }});
   window.Notification={permission:'default',requestPermission:async()=>{window.Notification.permission='granted';return 'granted'}};
   state.me={id:2,role:'CLEANER',full_name:'Test Cleaner',language:'en',notify_push:true,notify_email:true,cleaner_mode:'FLEX',reliability_score:95};
   state.settings={};
   state.push={enabled:true,publicKey:'BPc1'+'a'.repeat(83)};
   location.hash='cleaner/profile';
   await render();
  });
  await page.locator('#notification-card').waitFor();
  assert.match(await page.locator('#notification-card').innerText(),/Turn on notifications in this browser/);
  await page.getByRole('button',{name:'Turn on notifications in this browser'}).click();
  await page.waitForFunction(()=>window.savedSubscription);
  const saved=await page.evaluate(()=>savedSubscription);
  assert.equal(saved.endpoint,'https://push.example.invalid/f/abc');
  assert.equal(saved.p256dh,'BPc1-key');
  assert.equal(saved.auth,'c2VjcmV0');
  assert.ok(saved.userAgent,'the browser is identified so the owner can tell subscriptions apart');
  assert.deepEqual(await page.evaluate(()=>__subscribeOptions),{userVisibleOnly:true,keyBytes:65},'the VAPID key is sent as 65 raw bytes');
  await page.waitForFunction(()=>document.querySelector('#notification-card')?.innerText.includes('This browser receives notifications'));

  await page.getByRole('button',{name:'Send a test notification'}).click();
  await page.waitForFunction(()=>window.testPushes===1);

  // Turning the account-wide channel off is stored, not only shown.
  await page.locator('#notification-card input[type=checkbox]').last().uncheck();
  await page.waitForFunction(()=>window.channelPatches?.length);
  assert.deepEqual(await page.evaluate(()=>channelPatches.at(-1)),{email:false});

  await page.getByRole('button',{name:'Turn off on this browser'}).click();
  await page.waitForFunction(()=>window.removedSubscription);
  assert.equal((await page.evaluate(()=>removedSubscription)).endpoint,'https://push.example.invalid/f/abc');
  assert.equal(await page.evaluate(()=>__subscription),null,'the browser subscription itself is dropped too');
  await page.waitForFunction(()=>document.querySelector('#notification-card')?.innerText.includes('Turn on notifications in this browser'));

  // A browser that blocked notifications is told so instead of being offered a dead button.
  await page.evaluate(async()=>{window.Notification.permission='denied';await refreshPushState()});
  assert.match(await page.locator('#notification-card').innerText(),/blocked in the browser settings/);
  assert.equal(await page.getByRole('button',{name:'Turn on notifications in this browser'}).count(),0);

  // And a server without keys never offers the flow at all.
  await page.evaluate(async()=>{window.Notification.permission='default';state.push={enabled:false,publicKey:''};await refreshPushState()});
  assert.match(await page.locator('#notification-card').innerText(),/not configured on the server/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS notifications: push subscribe, test, channel toggles, unsubscribe, blocked and unconfigured states');
 }
 // Analytics: every number comes from the API, the period selector drives the query, and empty data is said out loud.
 {
  const {page,errors}=await openApp();
  await page.evaluate(async()=>{state.me={id:1,role:'ADMIN',full_name:'Admin',language:'en'};state.settings={companyName:'Shine Time'};location.hash='admin/analytics';await render()});
  await page.locator('.kpis').waitFor();
  const kpis=await page.locator('.kpis').innerText();
  assert.match(kpis,/On time[\s\S]*75%/,'the on-time rate is the one the API computed');
  assert.match(kpis,/of 8/,'the denominator is shown, not implied');
  assert.match(kpis,/95 min/,'median time to take a cleaning');
  assert.match(kpis,/16\.7% of all/,'the expiry share is shown next to the count');
  assert.match(kpis,/12\.5%/,'rework share of completed cleanings');
  assert.equal(await page.locator('.trend svg').count(),2,'both trends are drawn inline, without a chart library');
  assert.equal(await page.locator('.trend-dot').count(),6,'three days per chart');
  assert.match(await page.locator('.funnel-row').first().innerText(),/booked[\s\S]*12/i);
  assert.equal(await page.locator('.funnel-row').count(),5);
  // the funnel bars shrink monotonically, so a wider later step would be visible
  const widths=await page.locator('.funnel-bar>span').evaluateAll(els=>els.map(el=>parseFloat(el.style.width)));
  assert.deepEqual(widths,[...widths].sort((a,b)=>b-a));
  assert.match(await page.locator('.card.pad').last().innerText(),/\+22 min/,'a standard far from reality is flagged');
  assert.doesNotMatch(await page.locator('.card.pad').last().innerText(),/Riverside/,'a property with no cleanings in the period is left out');

  const first=await page.evaluate(()=>analyticsCalls.at(-1));
  await page.getByRole('button',{name:'Last 7 days'}).click();
  await page.waitForFunction(()=>analyticsCalls.length>1);
  const second=await page.evaluate(()=>analyticsCalls.at(-1));
  assert.notEqual(second.from,first.from,'the period selector actually changes the query');
  assert.equal(second.to,first.to);
  assert.equal(Math.round((new Date(second.to)-new Date(second.from))/86400000),6,'seven days inclusive');

  // An empty period must not claim a perfect record.
  await page.evaluate(()=>{window.__realRequest=ShineTimeSupabase.request;ShineTimeSupabase.request=async(path,opts)=>path.startsWith('/api/admin/analytics')?({from:'2099-02-01',to:'2099-02-01',summary:{jobs:0,completed:0,expired:0,cancelled:0,cancelledBy:{client:0,operations:0,other:0},rescue:0,escalated:0,issues:0,onTimePct:null,onTimeOf:0,medianOverrunMinutes:null,medianMinutesToAccept:null,acceptedOf:0,unassignedRatePct:null,reworkPct:null,reworkOf:0,outsideRadius:0,lateReleases:0},funnel:[{step:'booked',jobs:0},{step:'taken',jobs:0},{step:'arrived',jobs:0},{step:'completed',jobs:0},{step:'approved',jobs:0}],byDate:[],cleanerRanking:[],objectPerformance:[]}):window.__realRequest(path,opts)});
  await page.evaluate(()=>adminAnalytics('month'));
  await page.waitForFunction(()=>document.querySelector('.kpis')?.innerText.includes('—'));
  const empty=await page.locator('.kpis').innerText();
  assert.doesNotMatch(empty,/100%/,'an empty period never reports a perfect on-time rate');
  assert.match(empty,/nothing measurable yet/);
  assert.match(await page.locator('.two-col').first().innerText(),/Not enough days in this period/);
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS analytics: measured KPIs with denominators, inline trends, funnel, period selector and an honest empty period');
 }
 // Admin job creation: the full window, prefilled from the property and validated like the server.
 {
  const {page,errors}=await openApp();
  await page.evaluate(async()=>{state.me={id:1,role:'ADMIN',full_name:'Admin',language:'en'};state.settings={};location.hash='admin/jobs';await new Promise(r=>setTimeout(r,100));await render()});
  await page.evaluate(()=>createJobModal());
  await page.locator('#job-create').waitFor();
  // Prefilled from the property the select opened on.
  assert.equal(await page.locator('#jc-from').inputValue(),'10:00');
  assert.equal(await page.locator('#jc-to').inputValue(),'15:00');
  assert.equal(await page.locator('#jc-duration').inputValue(),'90');
  assert.match(await page.locator('#jc-hint').innerText(),/Fits the window.*latest start 13:30/);

  // The same rule the server applies: start + duration must fit the window.
  await page.fill('#jc-duration','400');
  await page.waitForFunction(()=>document.querySelector('#jc-hint')?.className.includes('error-text'));
  assert.match(await page.locator('#jc-hint').innerText(),/window is too short/i);
  assert.equal(await page.locator('#jc-submit').isDisabled(),true,'a window that cannot fit cannot be submitted');
  await page.fill('#jc-to','09:00');
  assert.match(await page.locator('#jc-hint').innerText(),/must be after the start/i);

  await page.fill('#jc-duration','120');
  await page.fill('#jc-to','16:00');
  await page.fill('#jc-bonus','6');
  await page.fill('#jc-payout','24');
  await page.fill('#jc-price','48');
  await page.fill('#jc-note','Guests arrive at 17:00');
  await page.selectOption('#jc-market','false');
  await page.waitForFunction(()=>!document.querySelector('#jc-submit').disabled);
  await page.locator('#jc-submit').click();
  await page.waitForFunction(()=>window.createdJob);
  const created=await page.evaluate(()=>createdJob);
  assert.match(created.serviceDate,/^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual({...created,serviceDate:undefined},{objectId:11,serviceDate:undefined,earliestStart:'10:00',deadline:'16:00',durationMinutes:120,bonus:6,marketplaceVisible:false,note:'Guests arrive at 17:00',payout:24,clientPrice:48});
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS admin creates a cleaning with window, duration, money, visibility and a note');
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
