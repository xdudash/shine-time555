import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('..',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');

test('form tools expose draft lifecycle and required-field helpers',()=>{
 const s=read('assets/form-tools.js');
 assert.match(s,/ShineTimeForms/);assert.match(s,/localStorage/);assert.match(s,/serialize/);assert.match(s,/restore/);assert.match(s,/required/);assert.match(s,/savedAt/);
});

test('table tools expose search sorting and row copy',()=>{
 const s=read('assets/table-tools.js');
 assert.match(s,/ShineTimeTables/);assert.match(s,/sort/);assert.match(s,/search/);assert.match(s,/copyRow/);assert.match(s,/localeCompare/);
});

test('pwa layer exposes install action and update handling',()=>{
 const s=read('assets/pwa-actions.js');
 assert.match(s,/beforeinstallprompt/);assert.match(s,/ShineTimePwa/);assert.match(s,/SKIP_WAITING/);assert.match(s,/serviceWorker/);
});

test('production entrypoint retains table and PWA tools but excludes account-unscoped drafts',()=>{
 const s=read('index.php');
 assert.doesNotMatch(s,/assets\/form-tools\.js/);assert.match(s,/assets\/table-tools\.js/);assert.match(s,/assets\/pwa-actions\.js/);
});
