import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('production entrypoint loads every operational frontend extension', () => {
  const index = read('index.php');
  const required = [
    'assets/i18n.js',
    'assets/supabase-client.js',
    'assets/operations-ui-core.js',
    'assets/live-updates.js',
    'assets/app.js',
    'assets/money.js',
    'assets/operations-extension.js',
    'assets/monitoring-extension.js',
    'assets/export.js',
  ];
  for (const asset of required) assert.match(index, new RegExp(escapeRegExp(asset)));
  assert.match(index, /<script>bootstrap\(\);<\/script>/);
});

test('service-worker shell contains every production frontend extension', () => {
  const source = read('assets/service-worker-entry.mjs');
  const generated = read('sw.js');
  for (const asset of ['assets/monitoring-extension.js', 'assets/export.js']) {
    assert.match(source, new RegExp(escapeRegExp(asset)), `service-worker source misses ${asset}`);
    assert.match(generated, new RegExp(escapeRegExp(asset)), `generated service-worker misses ${asset}`);
  }
});

test('production UI contract keeps all supported locales and public build config', () => {
  const i18n = read('assets/i18n.js');
  for (const locale of ['ru', 'sk', 'uk', 'en']) assert.match(i18n, new RegExp(`\\b${locale}: \\{`));
  assert.match(i18n, /const LANGS = \['ru','sk','uk','en'\]/);
  const config = read('config/supabase.php');
  assert.match(config, /release_build/);
  assert.doesNotMatch(config, /['\"](?:service_role|sb_secret)['\"]\s*=>/i);
});

test('operational extensions expose monitoring, CSV export and exact-money entry points', () => {
  assert.match(read('assets/monitoring-extension.js'), /monitoringScreen/);
  assert.match(read('assets/export.js'), /window\.exportVisibleTable/);
  assert.match(read('assets/money.js'), /window\.ShineTimeMoney=\{toMinorUnits/);
});
