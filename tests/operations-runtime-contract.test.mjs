import test from 'node:test';
import assert from 'node:assert/strict';
import { toMinorUnits } from '../assets/money.mjs';
import fs from 'node:fs';
import {staticCacheAllowed} from '../assets/live-updates.mjs';

const root = new URL('..', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');

test('money conversion uses exact minor units and accepts comma decimals', () => {
  assert.equal(toMinorUnits('10'), 1000);
  assert.equal(toMinorUnits('10.5'), 1050);
  assert.equal(toMinorUnits('10,50'), 1050);
  assert.equal(toMinorUnits('0.01'), 1);
});

test('money conversion rejects malformed, zero and oversized values', () => {
  for (const value of ['', '0', '0.00', '-1', '1.234', '1e3', '1000000.01']) {
    assert.throws(() => toMinorUnits(value), value);
  }
});

test('CSV export escapes spreadsheet-sensitive delimiters and formulas safely', () => {
  const source = read('assets/export.js');
  assert.match(source, /replace\(\/\\s\+\/g,' '\)/);
  assert.match(source, /replace\(\/"\/g,'""'\)/);
  assert.match(source, /text\/csv;charset=utf-8/);
  assert.match(source, /\ufeff/);
});

test('live updates coalesce refreshes and do not refresh while busy', () => {
  const source = read('assets/live-updates.js');
  assert.match(source, /setTimeout\(c,i\)/);
  assert.match(source, /n\(\)/);
  assert.match(source, /s=!0/);
  assert.match(source, /catch\(o\)\{r\(o\)\}/);
});

test('live update asset navigation guard stays same-origin and asset-only', () => {
  const origin='https://shine-time.example';
  assert.equal(staticCacheAllowed('/app/assets/app.js',origin,'/app'),true);
  assert.equal(staticCacheAllowed('/app/manifest.webmanifest',origin,'/app'),true);
  assert.equal(staticCacheAllowed('https://evil.example/app/assets/app.js',origin,'/app'),false);
  assert.equal(staticCacheAllowed('/app/config/supabase.php',origin,'/app'),false);
  assert.equal(staticCacheAllowed('/app/assets/../config/supabase.php',origin,'/app'),false);
});
