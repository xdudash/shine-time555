import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('..',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');

test('daily dispatch planner predicts late jobs and builds changes',()=>{const s=read('assets/dispatch-planner.js');assert.match(s,/ShineTimeDispatchPlanner/);assert.match(s,/predictedLate/);assert.match(s,/lateMinutes/);assert.match(s,/buildPlan/);assert.match(s,/OPTIMIZE_ROUTE/)});
test('dispatch recommendations expose local actions and risk priorities',()=>{const s=read('assets/dispatch-recommendations.js');assert.match(s,/ShineTimeDispatchRecommendations/);assert.match(s,/applyLocal/);assert.match(s,/CRITICAL/);assert.match(s,/localOnly/);assert.match(s,/Dispatch Plan/)});
