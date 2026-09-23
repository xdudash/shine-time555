import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');

test('operations automation exposes a command center and role-aware navigation',()=>{
  const source=read('assets/operations-automation.js');
  assert.match(source,/ShineTimeAutomation/);
  assert.match(source,/openCommandCenter/);
  assert.match(source,/rolePrefix/);
  assert.match(source,/admin:\[/);
  assert.match(source,/cleaner:\[/);
  assert.match(source,/client:\[/);
});

test('operations automation provides keyboard navigation without hijacking form fields',()=>{
  const source=read('assets/operations-automation.js');
  assert.match(source,/ctrlKey\|\|e\.metaKey/);
  assert.match(source,/e\.key\.toLowerCase\(\)==='k'/);
  assert.match(source,/e\.target\.matches\('input,textarea,select/);
  assert.match(source,/e\.key==='r'/);
});

test('operations automation adds offline and stale-data feedback',()=>{
  const source=read('assets/operations-automation.js');
  assert.match(source,/addEventListener\('online'/);
  assert.match(source,/addEventListener\('offline'/);
  assert.match(source,/Refresh available/);
  assert.match(source,/Connection lost/);
});

test('operations automation improves keyboard accessibility for data rows',()=>{
  const source=read('assets/operations-automation.js');
  assert.match(source,/row\.tabIndex=0/);
  assert.match(source,/row\.addEventListener\('keydown'/);
  assert.match(source,/row\.querySelector\('button'\)\.click\(\)/);
});

test('production entrypoint retires duplicate automation and retains core live coordination',()=>{
  const source=read('index.php');
  assert.doesNotMatch(source,/assets\/operations-automation\.js/);
  assert.match(source,/assets\/live-updates\.js/);
  assert.match(source,/assets\/app\.js/);
});
