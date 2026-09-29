import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||process.cwd()+'/artifacts/browser/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844},serviceWorkers:'block'}),errors=[],requests=[];
 const user={id:'11111111-1111-4111-8111-111111111111',email:'synthetic@test.invalid',aud:'authenticated',role:'authenticated'};
 const token=[{alg:'HS256',typ:'JWT'},{sub:user.id,exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',role:'authenticated'},'test'].map(x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url')).join('.');
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://live.test/**',async r=>{const file=new URL(r.request().url()).pathname.slice(1)||'index.html';await r.fulfill({body:await readFile(path.join('_production',file)),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'})});
 await page.route('https://qbbtroiqioufuucrqair.supabase.co/**',async r=>{
  const req=r.request(),url=new URL(req.url());let body={};let status=200;
  if(url.pathname==='/auth/v1/token')body={access_token:token,token_type:'bearer',expires_in:3600,refresh_token:'synthetic-refresh',user};
  else if(url.pathname==='/auth/v1/user')body=user;
  else if(url.pathname==='/functions/v1/st-api'){
   const payload=req.postDataJSON();requests.push(payload);
   if(req.headers().authorization!==`Bearer ${token}`){status=401;body={error:'Authentication required'}}
   else if(payload.route==='me')body={user:{id:1,role:'ADMIN',full_name:'Synthetic operator',language:'en'},settings:{},apiVersion:'2026-09-07-scale1'};
   else if(payload.route==='admin/jobs')body={jobs:[]};
   else if(payload.route==='notifications')body={notifications:[],unread:0};
   else {status=404;body={error:'Unexpected test route '+payload.route}}
  }
  await r.fulfill({status,json:body,headers:{'Access-Control-Allow-Origin':'*'}});
 });
 await page.goto('https://live.test/');await page.locator('#login-form').waitFor();
 assert.equal(await page.locator('#preview-banner').count(),0);assert.equal(await page.locator('#admin-sidebar').count(),0);
 await page.locator('#login-form [name=email]').fill(user.email);await page.locator('#login-form [name=password]').fill('Synthetic-test-only-123');await page.locator('#login-form button').click();
 await page.locator('#admin-sidebar').waitFor();assert.equal(await page.locator('[data-board-bucket="review"]').count(),0);
 await page.reload();await page.locator('#admin-sidebar').waitFor();
 assert.ok(requests.length>=3);assert.ok(requests.every(r=>r.clientBuild==='2026-09-07-scale1'));
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);assert.deepEqual(errors,[]);
 console.log('PASS production bundle: real Supabase adapter, signed-out isolation, sign-in, session reload, pinned API contract and mobile layout (synthetic network responses).');
}finally{await browser.close()}
