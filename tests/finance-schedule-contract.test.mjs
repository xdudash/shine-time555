import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('..',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');

test('finance tools expose exact settlement calculations and payment states',()=>{
 const s=read('assets/finance-tools.js');
 assert.match(s,/ShineTimeFinance/);assert.match(s,/grossMinor/);assert.match(s,/cleanerMinor/);assert.match(s,/marginPercent/);assert.match(s,/UNPAID/);assert.match(s,/PARTIAL/);assert.match(s,/OVERPAID/);
});
test('schedule tools expose slot generation and conflict detection',()=>{
 const s=read('assets/schedule-tools.js');
 assert.match(s,/ShineTimeSchedule/);assert.match(s,/while\(a\+d<=b\)/);assert.match(s,/conflicts/);assert.match(s,/overlap/);assert.match(s,/weeklyHours/);assert.match(s,/nextWeekday/);
});
test('production entrypoint excludes unused finance and schedule layers',()=>{
 const s=read('index.php');assert.doesNotMatch(s,/assets\/finance-tools\.js/);assert.doesNotMatch(s,/assets\/schedule-tools\.js/);
});
