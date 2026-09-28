import {createRequire} from 'node:module';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const require=createRequire(import.meta.url);
const {chromium}=require('playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||process.cwd()+'/artifacts/browser/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://preview.test/**',async route=>{
  const relative=new URL(route.request().url()).pathname.replace(/^\//,'')||'index.html';
  const type=relative.endsWith('.css')?'text/css':relative.endsWith('.js')?'application/javascript':'text/html';
  await route.fulfill({body:await readFile(path.join('_site',relative)),contentType:type});
 });
 await page.goto('https://preview.test/');
 await page.waitForSelector('[data-board-bucket="review"]');
 assert.equal(await page.locator('.admin-mobile-job').count(),3);
 await page.locator('[data-board-bucket="review"]').click();
 assert.equal(await page.locator('.admin-mobile-job').count(),1);
 await page.locator('.admin-mobile-job button').click();
 await page.getByRole('button',{name:'Approve report',exact:true}).waitFor();
 await page.getByRole('button',{name:'Approve report',exact:true}).click();
 await page.getByText('Demo preview: editing is unavailable.',{exact:false}).waitFor();
 await page.evaluate(()=>closeModal());
 for(const role of ['OPERATIONS_MANAGER','CLEANER','OWNER','PROPERTY_MANAGER']){
  await page.locator('#preview-role').selectOption(role);
  await page.waitForFunction(role=>state.me?.role===role&&!renderRunning,role);
  assert.doesNotMatch(await page.locator('#page').innerText(),/Unable to load|No synthetic data/);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,role+' mobile width');
 }
 await page.locator('#preview-role').selectOption('ADMIN');
 await page.waitForSelector('[data-board-bucket="all"]');
 await page.locator('[data-board-bucket="all"]').click();
 await page.evaluate(()=>{scrollTo(0,0);document.getElementById('toast-root').replaceChildren()});
 await mkdir('artifacts',{recursive:true});await page.screenshot({path:'artifacts/preview-mobile.png',fullPage:true});
 assert.deepEqual(errors,[]);console.log('PASS built preview all five roles, review inspection, mutation guard and mobile layout');
}finally{await browser.close()}
