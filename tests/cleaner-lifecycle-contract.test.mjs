import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');

test('cleaner lifecycle uses protected cleaner endpoints and proof gates', () => {
  const source = read('assets/app.js');
  for (const endpoint of [
    '/api/cleaner/jobs/${id}/status',
    '/api/cleaner/jobs/${jobId}/checklist/${itemId}',
    '/api/cleaner/jobs/${id}/issues',
    '/api/cleaner/jobs/${id}/complete',
  ]) assert.ok(source.includes(endpoint), `missing cleaner endpoint contract: ${endpoint}`);
  assert.match(source, /completeReady=done===required&&requiredCats\.every\(x=>photoCats\.has\(x\)\)/);
  assert.match(source, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(source, /lat:pos\.coords\.latitude,lng:pos\.coords\.longitude/);
});

test('cleaner GPS enforcement overrides the permissive check-in fallback', () => {
  const source = read('assets/cleaner-gps-enforcement.js');
  const index = read('index.php');
  assert.match(source, /window\.checkInJob=async id=>/);
  assert.match(source, /maximumAge:0/);
  assert.match(source, /accuracyMeters:position\.coords\.accuracy/);
  assert.doesNotMatch(source, /jobStatus\(id,'ARRIVED'\)/);
  assert.ok(index.indexOf('assets/app.js') < index.indexOf('assets/cleaner-gps-enforcement.js'));
});

test('operations dispatch console contains no quick-actions surface', () => {
  const source = read('assets/dispatch-console.js');
  assert.doesNotMatch(source, /Quick actions/i);
  assert.doesNotMatch(source, /data-quick/);
  assert.doesNotMatch(source, /Operator checklist/i);
});
