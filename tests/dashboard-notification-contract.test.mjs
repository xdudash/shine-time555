import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('..',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');

test('dashboard widgets expose operational KPI calculations',()=>{
 const s=read('assets/ops-dashboard-widgets.js');
 assert.match(s,/ShineTimeWidgets/);assert.match(s,/completionPercent/);assert.match(s,/riskScore/);assert.match(s,/utilization/);assert.match(s,/trend/);
});

test('notification tools expose priority and quiet-hour logic',()=>{
 const s=read('assets/notifications-tools.js');
 assert.match(s,/ShineTimeNotificationTools/);assert.match(s,/dedupe/);assert.match(s,/critical/);assert.match(s,/inQuietHours/);assert.match(s,/digest/);
});

test('entrypoint excludes unused dashboard and notification helpers',()=>{
 const s=read('index.php');assert.doesNotMatch(s,/assets\/ops-dashboard-widgets\.js/);assert.doesNotMatch(s,/assets\/notifications-tools\.js/);
});
