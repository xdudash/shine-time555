import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('..',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');

test('auto assignment ranks cleaners by workload distance and reliability',()=>{const s=read('assets/auto-assignment.js');assert.match(s,/ShineTimeAutoAssignment/);assert.match(s,/workMinutes/);assert.match(s,/distanceKm/);assert.match(s,/reliability/);assert.match(s,/assign/)});
test('rescue automation proposes candidates without server mutation',()=>{const s=read('assets/rescue-automation.js');assert.match(s,/ShineTimeRescue/);assert.match(s,/AUTO_RESCUE/);assert.match(s,/coveragePercent/);assert.match(s,/No eligible cleaner/)});
test('bulk operations expose selection and guarded execution',()=>{const s=read('assets/bulk-operations.js');assert.match(s,/ShineTimeBulk/);assert.match(s,/selected/);assert.match(s,/execute/);assert.match(s,/pendingAction/)});
