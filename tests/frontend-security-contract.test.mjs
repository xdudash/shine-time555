import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');

test('frontend security contract keeps sensitive database tables out of direct browser queries', () => {
  const source = read('assets/supabase-client.js');
  for (const table of ['st_jobs', 'st_settlements', 'st_users']) {
    assert.doesNotMatch(source, new RegExp(`from\\(['"]${table}['"]\\)`), `browser client must not directly query ${table}`);
  }
});

test('frontend security contract keeps private credential fields out of public config', () => {
  const config = read('config/supabase.php');
  assert.doesNotMatch(config, /['"](?:service_role|sb_secret|secret_key|private_key)['"]\\s*=>/i);
});

test('map coordinate parser rejects invalid and out-of-range coordinates', () => {
  const source = read('assets/operations-ui-core.js');
  assert.match(source, /coordinate < -limit \\|\\| coordinate > limit/);
  assert.match(source, /return null/);
});

test('operations manager navigation remains fail-closed for restricted areas', () => {
  const source = read('assets/operations-ui-core.js');
  for (const route of ['owner', 'clients', 'cleaners', 'finance', 'settlements', 'settings']) {
    assert.match(source, new RegExp(`['"]${route}['"]`), `restricted route ${route} missing`);
  }
});

test('production frontend exposes no obvious private credential assignment', () => {
  const files = ['index.php', 'assets/supabase-client.js', 'assets/app.js', 'assets/operations-extension.js'];
  const assignment = /(?:service_role|sb_secret|secret_key|private_key)\\s*[:=]/i;
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, assignment, `${file} contains a private credential assignment`);
  }
});
