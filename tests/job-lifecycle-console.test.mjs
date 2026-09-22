import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');

test('job lifecycle console maps only backend-supported transitions', () => {
  const source = read('assets/job-lifecycle-console.js');
  assert.match(source, /EN_ROUTE:\{label:'Accept \/ en route',from:\['ACCEPTED'\],to:'EN_ROUTE',action:'status'/);
  assert.match(source, /ARRIVED:\{label:'Arrived',from:\['EN_ROUTE'\],to:'ARRIVED',action:'status'/);
  assert.match(source, /CLEANING:\{label:'Start cleaning',from:\['ARRIVED'\],to:'CLEANING',action:'status'/);
  assert.match(source, /COMPLETE:\{label:'Complete',from:\['CLEANING'\],to:'COMPLETED',action:'complete'/);
});

test('job lifecycle console uses authenticated API commands and idempotency keys', () => {
  const source = read('assets/job-lifecycle-console.js');
  assert.match(source, /\/api\/admin\/jobs\/\$\{encodeURIComponent\(jobId\)\}\/\$\{spec\.action\}/);
  assert.match(source, /method:'POST'/);
  assert.match(source, /requestId:crypto\.randomUUID\(\)/);
  assert.doesNotMatch(source, /localStorage/);
});
