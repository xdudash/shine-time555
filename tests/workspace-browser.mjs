import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||process.cwd()+'/artifacts/browser/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try {
 const page=await browser.newPage({viewport:{width:390,height:844}}), errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://workspace.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><div id="modal-root"></div><div id="toast-root"></div>'}));
 await page.goto('https://workspace.test/');
 for(const name of ['styles.css','ui-system.css','mobile-ui.css','operations-workspace.css']){try{await page.addStyleTag({content:await readFile('assets/'+name,'utf8')})}catch(e){if(e.code!=='ENOENT')throw e}}
 for(const name of ['i18n.js','operations-ui-core.js','live-updates.js','operations-board.js','checklist-drafts.js','workspace-i18n.js']){try{await page.addScriptTag({content:await readFile('assets/'+name,'utf8')})}catch(e){if(e.code!=='ENOENT')throw e}}
 await page.evaluate(()=>{
  window.ST_BASE='/';window.calls=[];window.failChecklist=false;
  window.jobs=[
   {id:101,object_code:'BA-101',object_name:'Dunajská apartment',address:'Dunajská 15',zone:'Staré Mesto',status:'COMPLETED',review_status:'PENDING',review_version:1,assigned_cleaner_id:1,cleaner_name:'Test Cleaner',deadline:'15:00',payout:20,bonus:0,checklist:[],photos:[],issues:[],events:[]},
   {id:102,object_code:'BA-102',object_name:'Riverside',zone:'Ružinov',status:'CLEANING',review_status:'NOT_SUBMITTED',review_version:0,assigned_cleaner_id:1,cleaner_name:'Test Cleaner',deadline:'14:00',payout:20,bonus:0,checklist:[{id:7,label:'Kitchen',required:true,completed:false}],photos:[],issues:[],events:[]}
  ];
  window.ShineTimeSupabase={subscribeJobs(){return()=>{}},request:async(path,opts={})=>{
   calls.push({path,opts});
   if(path.startsWith('/api/admin/jobs?')||path==='/api/admin/jobs')return {jobs:structuredClone(jobs)};
   if(path==='/api/admin/cleaners')return {cleaners:[]};
   if(path.startsWith('/api/cleaner/dashboard'))return {availability:{online:true,fromTime:'08:00',toTime:'20:00'},jobs:[],total:0};
   if(path==='/api/notifications')return {notifications:[],unread:0};
   const review=path.match(/\/admin\/jobs\/(\d+)\/review$/);
   if(review){const j=jobs.find(x=>x.id===Number(review[1]));if(opts.body.expectedVersion!==j.review_version)throw Error('Stale review');j.review_status=opts.body.decision;j.review_version++;return {job:structuredClone(j)}}
   const check=path.match(/\/cleaner\/jobs\/(\d+)\/checklist\/(\d+)$/);
   if(check){if(failChecklist)throw new TypeError('Failed to fetch');jobs.find(x=>x.id===Number(check[1])).checklist.find(x=>x.id===Number(check[2])).completed=opts.body.completed;return {ok:true}}
   const detail=path.match(/\/(?:admin|cleaner)\/jobs\/(\d+)$/);
   if(detail)return structuredClone(jobs.find(x=>x.id===Number(detail[1])));
   const booking=path.match(/\/client\/bookings\/(\d+)$/);
   if(booking)return {booking:structuredClone(jobs.find(x=>x.id===Number(booking[1]))),photos:[],issues:[]};
   throw Error('Unexpected route '+path);
  }};
 });
 await page.addScriptTag({content:await readFile('assets/app.js','utf8')});
 await page.evaluate(async()=>{state.me={id:1,role:'OPERATIONS_MANAGER',full_name:'Manager',language:'en'};state.settings={};ST_I18N.setLocale('en');location.hash='admin/jobs';await render()});
 await page.waitForSelector('[data-board-bucket="review"]',{timeout:3000});
 await page.locator('#job-search').fill('missing property');
 assert.deepEqual(await page.locator('.board-summary strong').allTextContents(),['0','0','0','0'],'summary follows filters');
 await page.locator('#job-search').fill('');
 await page.locator('[data-board-bucket="review"]').click();
 assert.equal(await page.locator('.admin-mobile-job').count(),1);
 assert.match(await page.locator('.admin-mobile-job').innerText(),/Awaiting review/);
 await page.locator('.admin-mobile-job button').click();
 assert.equal(await page.getByRole('button',{name:'Save finance',exact:true}).count(),0,'operations manager sees no inaccessible finance form');
 await page.getByRole('button',{name:'Approve report',exact:true}).click();
 await page.waitForFunction(()=>jobs[0].review_status==='APPROVED');
 const sent=await page.evaluate(()=>calls.find(c=>c.path.endsWith('/review')).opts.body);
 assert.equal(sent.expectedVersion,1);assert.ok(sent.requestId);
 await page.evaluate(()=>closeModal());
 await page.evaluate(async()=>{await render({background:true})});
 assert.equal(await page.locator('[data-board-bucket="review"]').getAttribute('aria-pressed'),'true','selected bucket retained');
 console.log('PASS board filter and versioned review');
 await page.evaluate(async()=>{state.me={id:2,role:'CLEANER',full_name:'Cleaner',language:'en'};location.hash='cleaner/job/102';await render();window.failChecklist=true});
 await page.locator('.check-btn').click();
 await page.waitForSelector('[data-checklist-sync="pending"]');
 assert.equal(await page.locator('.check-btn').getAttribute('aria-pressed'),'true');
 await page.evaluate(async()=>{await render()});
 assert.equal(await page.locator('.check-btn').getAttribute('aria-pressed'),'true','draft retained after render');
 assert.equal(await page.getByRole('button',{name:'Submit report',exact:true}).isDisabled(),true);
 await page.evaluate(()=>window.failChecklist=false);
 await page.getByRole('button',{name:'Sync checklist',exact:true}).click();
 await page.waitForFunction(()=>jobs[1].checklist[0].completed);
 await page.waitForSelector('[data-checklist-sync="pending"]',{state:'detached'});
 console.log('PASS offline checklist draft and retry');
 // The user changes their mind while the first PATCH is still in flight.
 await page.evaluate(async()=>{
  jobs[1].checklist[0].completed=false;await render();
  const original=ShineTimeSupabase.request;window.firstPatch=true;
  ShineTimeSupabase.request=async(path,opts={})=>{
   if(firstPatch&&path.endsWith('/checklist/7')){firstPatch=false;await new Promise(resolve=>window.releasePatch=resolve);}
   return original(path,opts);
  };
 });
 await page.locator('.check-btn').click();
 await page.waitForFunction(()=>typeof releasePatch==='function');
 await page.locator('.check-btn').click();
 assert.equal(await page.locator('.check-btn').getAttribute('aria-pressed'),'false');
 await page.evaluate(()=>releasePatch());
 await page.waitForSelector('[data-checklist-sync="pending"]',{state:'detached'});
 assert.equal(await page.evaluate(()=>jobs[1].checklist[0].completed),false,'latest intent survives in-flight acknowledgement');
 console.log('PASS opposite checklist edits while request in flight');

 await page.evaluate(async()=>{jobs[0].review_status='PENDING';state.me={id:4,role:'OWNER',full_name:'Owner',language:'en'};location.hash='client/booking/101';await render()});
 assert.match(await page.locator('#page').innerText(),/Awaiting review/);
 assert.equal(await page.getByRole('button',{name:'Approve report',exact:true}).count(),0);
 for(const width of [320,390,430]){await page.setViewportSize({width,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'owner viewport '+width)}
 await page.evaluate(async()=>{state.me={id:1,role:'OPERATIONS_MANAGER',full_name:'Manager',language:'en'};location.hash='admin/jobs';await render()});
 for(const width of [320,390,430,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'board viewport '+width)}
 await page.setViewportSize({width:390,height:844});
 await page.locator('[data-board-bucket="all"]').click();
 await page.evaluate(()=>{window.scrollTo(0,0);document.getElementById('toast-root').replaceChildren()});
 await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/operations-workspace-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS owner status, mobile layouts and console');
} finally {await browser.close()}
