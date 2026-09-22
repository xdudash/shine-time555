import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('..',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');

test('shift planner exposes weekly workload and conflict calculations',()=>{
 const s=read('assets/shift-planner.js');
 assert.match(s,/ShineTimeShiftPlanner/);assert.match(s,/workload/);assert.match(s,/balance/);assert.match(s,/conflicts/);assert.match(s,/nextAvailable/);
});

test('payout engine exposes batch, threshold and reconciliation calculations',()=>{
 const s=read('assets/payout-engine.js');
 assert.match(s,/ShineTimePayouts/);assert.match(s,/calculate/);assert.match(s,/batch/);assert.match(s,/threshold/);assert.match(s,/reconcile/);assert.match(s,/OVERPAID/);
});
