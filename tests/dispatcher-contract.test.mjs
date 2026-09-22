import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root=new URL('..',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');

test('smart dispatcher exposes priority, ETA and explainable assignment plan',()=>{const s=read('assets/dispatcher.js');assert.match(s,/ShineTimeDispatcher/);assert.match(s,/priority/);assert.match(s,/etaMinutes/);assert.match(s,/BEST_FIT/);assert.match(s,/NO_ELIGIBLE_CLEANER/);assert.match(s,/RESCUE_PRIORITY/)});
