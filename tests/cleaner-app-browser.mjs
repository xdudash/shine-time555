// Cleaner app on a phone, against the real preview build: the job screen, the profile and
// the admin cleaning-standard editor. Each check matches a problem seen in production.
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||process.cwd()+'/artifacts/browser/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});

const job=(over={})=>({id:777,object_id:11,object_code:'CRM-8CE28620',object_name:'Florianska 12 C201',address:'Florianska 12 C201',zone:'Bratislava',
 status:'EN_ROUTE',risk_level:'GREEN',risk_score:0,payout:16,bonus:0,duration_minutes:90,earliest_start:'10:00',deadline:'19:00',review_status:'NOT_SUBMITTED',
 access_instructions:null,key_instructions:null,parking:null,linen_location:null,supplies_location:null,object_notes:null,
 checklist:[{id:1,label:'Complete property instructions',required:true,completed:false,photo_required:false},{id:2,label:'Final quality inspection',required:true,completed:false,photo_required:false},{id:3,label:'Final proof photo',required:true,completed:false,photo_required:true,photo_category:'Final'}],
 photos:[],issues:[],...over});

async function open(locale){
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://preview.test/**',async route=>{
  const rel=new URL(route.request().url()).pathname.replace(/^\//,'')||'index.html';
  const type=rel.endsWith('.css')?'text/css':rel.endsWith('.js')?'application/javascript':rel.endsWith('.svg')?'image/svg+xml':rel.endsWith('.png')?'image/png':'text/html';
  try{await route.fulfill({body:await readFile(path.join('_site',rel)),contentType:type})}catch{await route.fulfill({status:404,body:''})}
 });
 await page.route(/^https:\/\/(unpkg\.com|[a-z]\.tile\.openstreetmap\.org)\//,r=>r.fulfill({status:404,body:''}));
 await page.addInitScript(l=>localStorage.setItem('st_locale',l),locale);
 await page.goto('https://preview.test/');
 await page.waitForFunction(()=>window.STPreview&&typeof state==='object');
 await page.evaluate(l=>{
  for(const v of Object.values(STPreview.identities))v.language=l;
  ST_I18N.setLocale(l);
  window.jobOverride=null;window.objectReply=null;
  const base=ShineTimeSupabase.request;
  ShineTimeSupabase.request=(p,o={})=>{
   if(p==='/api/cleaner/jobs/777'&&window.jobOverride)return Promise.resolve(structuredClone(window.jobOverride));
   if(/^\/api\/admin\/objects\/11$/.test(p)&&window.objectReply)return Promise.resolve(structuredClone(window.objectReply));
   return base(p,o);
  };
 },locale);
 return {page,errors};
}
async function showJob(page,data){
 await page.evaluate(async d=>{window.jobOverride=d;STPreview.switchRole('CLEANER');location.hash='cleaner/job/777';await render()},data);
 await page.locator('.active-job-head h2').waitFor();
}

try{
 // Job screen in Ukrainian: one title, translated checklist, nothing covering the main button.
 {
  const {page,errors}=await open('uk');
  await showJob(page,job());
  assert.equal((await page.locator('.active-job-head h2').innerText()).trim(),'Florianska 12 C201','title shows the place once');
  assert.equal((await page.locator('.active-job-head .job-sub').innerText()).trim(),'CRM-8CE28620','address is not repeated, code stays small');
  assert.doesNotMatch(await page.locator('.active-job-head .job-meta').innerText(),/НИЗЬКИЙ|LOW|GREEN/i,'cleaners do not see a risk score');
  const body=await page.locator('.active-job-body').innerText();
  assert.match(body,/Виконати інструкції об’єкта/,'default checklist is translated');
  assert.match(body,/Фінальна перевірка якості/);
  assert.match(body,/Підсумок/,'photo category is translated');
  assert.match(body,/немає інструкцій/,'empty instructions collapse into one line');
  assert.doesNotMatch(body,/КЛЮЧ|ПАРКУВАННЯ|БІЛИЗНА|^—$/m,'empty instruction fields are not shown');
  assert.doesNotMatch(body,/НОТАТКИ|Нотатки/,'empty notes are not shown');
  const primary=page.locator('.sticky-action>.btn.primary');
  assert.equal((await primary.innerText()).trim(),'Я на місці','check-in button is translated and not cut');
  const [bar,btn]=await Promise.all([page.locator('.sticky-action').boundingBox(),primary.boundingBox()]);
  assert.ok(btn.width>=bar.width*0.85,'main action takes the full width');
  assert.equal(await page.locator('#live-state').isVisible(),false,'connection badge is hidden for cleaners while live');
  assert.equal(await primary.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width-12,r.y+r.height/2))}),true,'nothing covers the right edge of the main button');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no horizontal scroll');
  // Filled instructions appear as rows; notes appear when present.
  await showJob(page,job({key_instructions:'Key box 1234 at the door',parking:'Blue zone',object_notes:'Spare towels in the hall'}));
  const info=await page.locator('.job-info').innerText();
  assert.match(info,/Ключ[\s\S]*Key box 1234/);assert.match(info,/Паркування[\s\S]*Blue zone/);
  assert.equal(await page.locator('.job-info .info-row').count(),2,'only filled instructions are listed');
  assert.match(await page.locator('.active-job-body').innerText(),/Spare towels in the hall/);
  // While cleaning, the report button explains what is still missing.
  await showJob(page,job({status:'CLEANING'}));
  assert.equal(await page.locator('.sticky-action>.btn.green').isDisabled(),true);
  assert.match(await page.locator('.action-hint').innerText(),/Чек-лист 0\/3 · Бракує фото: 1/);
  // The issue type is sent as a stable value, not as the translated label.
  await page.locator('.sticky-action .action-row .btn').first().click();
  await page.locator('#issue-form select[name=type]').waitFor();
  assert.deepEqual(await page.locator('#issue-form select[name=type] option').evaluateAll(o=>o.slice(0,2).map(x=>[x.value,x.textContent])),[['Damage','Пошкодження'],['Missing linen','Немає білизни']]);
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS cleaner job: one title, translated checklist, clear instructions, uncovered full-width action');
 }

 // Profile in Russian: stats, work details, availability for today and tomorrow, language.
 {
  const {page,errors}=await open('ru');
  await page.evaluate(async()=>{STPreview.switchRole('CLEANER');location.hash='cleaner/profile';await render()});
  await page.locator('.profile-stats').waitFor();
  const text=await page.locator('#page').innerText();
  assert.match(text,/★ 4\.9[\s\S]*Рейтинг/);assert.match(text,/40[\s\S]*Завершено/);assert.doesNotMatch(text,/Надёжность|\/100/,'no invented reliability score');
  assert.match(text,/Гибкий/,'mode is translated');assert.match(text,/Авто/,'transport is translated');
  assert.equal(await page.locator('.profile-day').count(),2,'availability for today and tomorrow');
  assert.match(await page.locator('.profile-day').nth(1).innerText(),/Завтра/);
  assert.equal(await page.locator('#page .lang-select').count(),1,'language can be changed from the profile');
  assert.doesNotMatch(text,/\b(Mode|Reliability|Transport|Preferred zones|Availability today|Edit availability|Account security|Sign out)\b/,'no English labels');
  await page.locator('.profile-day .btn').nth(1).click();
  await page.locator('#av-form input[name=date]').waitFor({state:'attached'});
  assert.equal(await page.locator('#av-form input[name=date]').inputValue(),await page.evaluate(()=>tomorrow()),'tomorrow is edited for tomorrow');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,'no horizontal scroll');
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS cleaner profile: stats, work details, two-day availability, language, translated');
 }

 // Admin cleaning standard: opens with the saved items and never starts from an empty list by mistake.
 {
  const {page,errors}=await open('ru');
  await page.evaluate(()=>{STPreview.switchRole('ADMIN');location.hash='admin/objects'});
  await page.locator('[onclick^="checklistModal(11"]').first().waitFor({state:'attached'});
  await page.waitForTimeout(300);
  await page.evaluate(()=>checklistModal(11));
  await page.locator('.standard-edit').first().waitFor();
  assert.equal(await page.locator('.standard-edit').count(),2,'saved items are loaded');
  assert.deepEqual(await page.locator('.std-required').evaluateAll(x=>x.map(i=>i.checked)),[true,false],'optional items stay optional');
  // Items can be added, moved and removed again.
  const labels=()=>page.locator('.std-label').evaluateAll(x=>x.map(i=>i.value));
  const first=(await labels())[0];
  await page.locator('.std-tools button').nth(1).click();
  assert.equal((await labels())[1],first,'item moved down');
  await page.getByRole('button',{name:/\+/}).last().click();
  assert.equal(await page.locator('.standard-edit').count(),3,'an item is added');
  await page.locator('.std-label').last().fill('Check balcony');
  await page.locator('.standard-edit').first().locator('.std-tools button').last().click();
  assert.equal(await page.locator('.standard-edit').count(),2,'an item is removed');
  assert.equal(await page.locator('.std-num').last().innerText(),'2','numbers follow the new order');
  await page.evaluate(()=>closeModal());
  await page.evaluate(async()=>{window.objectReply={object:{id:11,code:'BA-001'}};await checklistModal(11)});
  await page.locator('#toast-root .toast,.toast').first().waitFor();
  assert.equal(await page.locator('.standard-edit').count(),0,'without the saved list the editor does not open');
  assert.deepEqual(errors,[]);
  await page.close();
  console.log('PASS admin cleaning standard: loads saved items, refuses to open without them');
 }
}finally{await browser.close()}
