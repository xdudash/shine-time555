import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const retired=['operations-automation','operations-command-center','operations-dashboard','operations-command-surface','notifications-center','dispatch-console','job-lifecycle-console','form-tools','payout-queue','shift-board','activity-log','ops-charts','ops-dashboard-widgets','shift-planner','auto-assignment','rescue-automation','bulk-operations','dispatch-engine','dispatch-workflow','dispatch-planner','dispatch-recommendations','performance-engine','operations-brain','command-center-live','notifications-tools','payout-engine','finance-tools','schedule-tools'];

test('failed foreground rendering replaces stale content with an escaped retry screen',async()=>{
  const source=read('assets/app.js');
  let page={innerHTML:'Previous screen',cloneNode:()=>({innerHTML:''}),replaceWith(next){page=next;}};
  const context=vm.createContext({window:{scrollTo:()=>{},dispatchEvent:()=>{}},document:{querySelector:s=>s==='#page'?page:null,querySelectorAll:()=>[]},state:{me:{role:'ADMIN'},map:null},route:()=> 'admin/jobs',ensureRoute:()=>{},renderAdminShell:()=>{},renderAdmin:async()=>{throw Error('<broken>')},liveBusy:()=>false,showLiveStatus:()=>{},toast:()=>{},activeRender:null,esc:s=>s.replace(/</g,'&lt;').replace(/>/g,'&gt;'),t:(k,f)=>f});
  vm.runInContext(source.slice(source.indexOf('let renderRunning='),source.indexOf("window.addEventListener('hashchange'")),context);
  await context.render();
  assert.match(page.innerHTML,/&lt;broken&gt;/);
  assert.match(page.innerHTML,/render\(\)/);
  assert.doesNotMatch(page.innerHTML,/Previous screen/);
});

test('repeated preview bootstrap releases the recovery listener and does not register a worker',async()=>{
  const source=read('assets/app.js');let released=0,registered=0;
  const context=vm.createContext({window:{STPreview:{},ShineTimeSupabase:{onRecovery:()=>({unsubscribe:()=>released++})}},navigator:{serviceWorker:{register:()=>{registered++;return Promise.resolve()}}},BASE:'./',api:async()=>{throw Error('signed out')},renderLogin:()=>{},recoverySubscription:null});
  vm.runInContext(source.slice(source.indexOf('async function bootstrap()'),source.indexOf('function releaseCompatible(')),context);
  await context.bootstrap();await context.bootstrap();
  assert.equal(released,1);
  assert.equal(registered,0);
});

test('runtime retains core workflows without duplicate or simulated control panels',()=>{
  const index=read('index.php');
  for(const name of retired)assert.ok(!index.includes(`src="assets/${name}.js`),name);
  for(const name of ['app','operations-extension','cleaner-gps-enforcement','monitoring-extension'])assert.ok(index.includes(`src="assets/${name}.js`),name);
});

test('direct extension routes enforce the same operations-manager boundary as navigation',async()=>{
  const calls=[];
  const context=vm.createContext({window:{},state:{me:{role:'OPERATIONS_MANAGER'}},adminNav:[],renderAdmin:async p=>calls.push(p),renderCleaner:()=>{},clientFinance:()=>{},navTo:p=>calls.push(p),settlementScreen:()=>calls.push('settlement'),scheduleScreen:()=>calls.push('schedule')});
  vm.runInContext(read('assets/operations-ui-core.js'),context);
  vm.runInContext(read('assets/operations-extension.js').split('async function scheduleScreen')[0],context);
  await context.renderAdmin('settlements');
  assert.equal(calls.includes('settlement'),false);
  assert.ok(calls.includes('admin/live'));
  calls.length=0;
  await context.renderAdmin('schedule');
  assert.deepEqual(calls,['schedule']);
  context.state.me.role='ADMIN';
  await context.renderAdmin('settlements');
  assert.equal(calls.at(-1),'settlement');
});

test('password reset keeps the deployment directory',async()=>{
  const source=read('assets/supabase-client-entry.mjs');
  const reset=source.slice(source.indexOf('async function resetPassword('),source.indexOf('async function recoverPassword('));
  for(const [base,href,expected] of [['./','https://example.test/shine-time555/#client/home','https://example.test/shine-time555/'],['/app/','https://example.test/app/index.php','https://example.test/app/']]){
    let received;
    const context=vm.createContext({window:{ST_BASE:base},location:{href,origin:'https://example.test'},URL,getClient:()=>({auth:{resetPasswordForEmail:async(email,options)=>{received=options.redirectTo;return {};}}})});
    vm.runInContext(reset,context);
    await context.resetPassword('test@example.invalid');
    assert.equal(received,expected);
  }
});

test('export neutralizes formula cells and uses the selected month and visible rows',()=>{
  let content,filename;
  const rows=[{hidden:false,style:{},querySelectorAll:()=>[{innerText:'Name'},{innerText:'Amount'}]}, {hidden:false,style:{},querySelectorAll:()=>[{innerText:' =HYPERLINK("https://example.invalid")'},{innerText:'123'}]}, {hidden:true,style:{},querySelectorAll:()=>[{innerText:'hidden record'}]}];
  const context=vm.createContext({window:{ShineTimeApp:{getState:()=>({settlementMonth:'2026-08',financeMonth:'2026-07'})},addEventListener:()=>{}},document:{querySelector:()=>({querySelectorAll:()=>rows}),createElement:()=>({set download(v){filename=v},click:()=>{}}),getElementById:()=>null,body:{}},location:{hash:'#admin/settlements'},Blob:class {constructor(parts){content=parts.join('')}},URL:{createObjectURL:()=>'',revokeObjectURL:()=>{}},setTimeout:()=>{},MutationObserver:class {observe(){}}});
  vm.runInContext(read('assets/export.js'),context);
  context.window.exportVisibleTable();
  assert.match(filename,/2026-08\.csv$/);
  assert.ok(content.includes("'=HYPERLINK"));
  assert.ok(!content.includes('hidden record'));
  context.location.hash='#admin/finance';
  context.window.exportVisibleTable();
  assert.match(filename,/2026-07\.csv$/);
});

test('finance mutation redraws pass through the shared render lifecycle',async()=>{
  const lines=read('assets/app.js').split('\n').filter(line=>/^window\.(saveFinanceEntry|deleteFinanceEntry)=/.test(line));
  let rendered=0;const context=vm.createContext({window:{},state:{},$:()=>({value:'2026-08'}),api:async()=>({}),confirm:()=>true,closeModal:()=>{},toast:()=>{},render:async()=>rendered++,FormData:class {get(){return ''}}});
  vm.runInContext(lines.join('\n'),context);
  await context.window.saveFinanceEntry();
  await context.window.deleteFinanceEntry(1);
  assert.equal(rendered,2);
  assert.equal(context.state.financeMonth,'2026-08');
});

test('cleaner detail failures reach the central renderer without replacing job content',async()=>{
  const source=read('assets/app.js').split('\n').find(line=>line.startsWith('async function cleanerJobDetail('));
  const page={innerHTML:'Current job'};
  const context=vm.createContext({cleanerHeaderAvailability:async()=>{},api:async()=>{throw Error('Network unavailable')},$:()=>page,esc:s=>s});
  vm.runInContext(source,context);
  await assert.rejects(context.cleanerJobDetail(1),/Network unavailable/);
  assert.equal(page.innerHTML,'Current job');
});
