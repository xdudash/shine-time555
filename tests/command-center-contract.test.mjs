import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('..',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');

test('live command center exposes operational aggregation',()=>{
 const s=read('assets/command-center-live.js');
 assert.match(s,/ShineTimeCommandLive/);assert.match(s,/Priority alerts/);assert.match(s,/Payout queue/);assert.match(s,/At-risk jobs/);assert.match(s,/riskScore/);
});

test('ops charts expose dependency-free sparkline and bars',()=>{
 const s=read('assets/ops-charts.js');
 assert.match(s,/ShineTimeCharts/);assert.match(s,/polyline/);assert.match(s,/bars/);assert.match(s,/data-st-spark/);
});
