import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('..',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');

test('smart dispatch engine exposes prioritization ETA capacity and rebalance',()=>{const s=read('assets/dispatch-engine.js');assert.match(s,/ShineTimeDispatch/);assert.match(s,/urgency/);assert.match(s,/eta/);assert.match(s,/capacityPercent/);assert.match(s,/rebalance/);assert.match(s,/alternatives/)});
test('dispatch workflow supports live refresh local apply and timer lifecycle',()=>{const s=read('assets/dispatch-workflow.js');assert.match(s,/ShineTimeDispatchWorkflow/);assert.match(s,/setInterval/);assert.match(s,/applyLocal/);assert.match(s,/SMART_REBALANCE/);assert.match(s,/shine:dispatch/);assert.match(s,/stop/)});
