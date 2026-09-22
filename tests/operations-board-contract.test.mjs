import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('..',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');

test('shift board exposes planning actions and conflict protection',()=>{const s=read('assets/shift-board.js');assert.match(s,/ShineTimeShiftBoard/);assert.match(s,/conflicts/);assert.match(s,/workload/);assert.match(s,/Quick shift/)});
test('payout queue exposes enqueue, eligibility and payment state',()=>{const s=read('assets/payout-queue.js');assert.match(s,/ShineTimePayoutQueue/);assert.match(s,/enqueue/);assert.match(s,/eligible/);assert.match(s,/Mark paid/)});
test('activity log exposes durable operator audit trail',()=>{const s=read('assets/activity-log.js');assert.match(s,/ShineTimeActivity/);assert.match(s,/localStorage/);assert.match(s,/add/);assert.match(s,/Activity Log/)});
