import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const dir = new URL('../supabase/migrations/', import.meta.url);

test('migration versions are unique 14-digit timestamps in a deterministic order', async () => {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql'));
  const versions = files.map((f) => f.split('_')[0]);
  for (const v of versions) assert.match(v, /^\d{14}$/, `ambiguous migration version ${v}`);
  assert.equal(new Set(versions).size, versions.length, 'duplicate migration version');
});

test('no migration grants browser roles access to raw job rows', async () => {
  for (const f of (await readdir(dir)).filter((name) => name.endsWith('.sql'))) {
    const sql = (await readFile(new URL(f, dir), 'utf8')).replace(/--[^\n]*/g, '');
    for (const statement of sql.split(';')) {
      if (/\bgrant\b/i.test(statement) && /\bst_jobs\b/i.test(statement)) {
        assert.doesNotMatch(statement, /\bto\s+[^;]*\b(anon|authenticated|public)\b/i, `${f} grants st_jobs to a browser role`);
      }
    }
  }
});

test('production-only migrations are present so fresh environments match production', async () => {
  const files = await readdir(dir);
  for (const name of ['20260909150213_monthly_settlements.sql', '20260909220128_property_reference_photos.sql', '20260930120000_production_reconcile.sql']) {
    assert.ok(files.includes(name), name);
  }
});
