import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = new URL('..', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');

const api = read('supabase/functions/st-api/index.ts');
const logic = read('supabase/functions/st-api/logic.mjs');
const operations = read('supabase/functions/st-api/operations.mjs');
const app = read('assets/app.js');
const migrations = fs.readdirSync(new URL('supabase/migrations/', root)).sort()
  .map((name) => read(`supabase/migrations/${name}`)).join('\n');
const schema = read('supabase/hostinger_schema.sql');

// The keys settings() hands out: the single source of what a setting even is.
function serverSettingKeys() {
  const body = api.slice(api.indexOf('return {', api.indexOf('async function settings()')), api.indexOf('...settingsFromRows(rows)'));
  return [...body.replace(/\/\/[^\n]*/g, '').matchAll(/([A-Za-z][A-Za-z0-9]*):/g)].map((match) => match[1]);
}

// The keys the settings form writes back.
function formSettingKeys() {
  const line = app.slice(app.indexOf('const SETTING_FIELDS={'));
  return [...line.slice(0, line.indexOf('};')).matchAll(/([A-Za-z][A-Za-z0-9]*):'(text|number|list)'/g)].map((match) => match[1]);
}

// Shown read-only: the application timezone is the database's, not a knob.
const DERIVED = new Set(['timezone']);

test('every setting the server defines is read by the server', () => {
  const unread = serverSettingKeys().filter((key) => {
    if (DERIVED.has(key)) return false;
    const readers = [
      new RegExp(`(appSettings|settings|s)\\.${key}\\b`).test(api),
      new RegExp(`\\b${key}\\b`).test(logic),
      new RegExp(`\\b${key}\\b`).test(operations),
      new RegExp(`setting_key\\s*=\\s*'${key}'`).test(migrations),
      new RegExp(`setting_key='${key}'`).test(migrations),
      // A label the interface prints is read too, just by the browser.
      new RegExp(`(settings|s)\\??\\.${key}\\b`).test(app),
    ];
    return !readers.some(Boolean);
  });
  assert.deepEqual(unread, [], 'a setting nobody reads must be removed, not left in the form');
});

test('every setting the form edits exists on the server, and every editable setting is in the form', () => {
  const server = serverSettingKeys().filter((key) => !DERIVED.has(key));
  const form = formSettingKeys();
  assert.deepEqual(form.filter((key) => !server.includes(key)), [], 'the form must not write keys the server does not know');
  assert.deepEqual(server.filter((key) => !form.includes(key)), [], 'an editable setting must be reachable in the interface');
  assert.equal(new Set(form).size, form.length, 'no duplicated field');
});

test('the settings removed as dead are gone from the server, the form and the stored rows', () => {
  const retired = ['windowEnd', 'rescueStart', 'sameZoneTravelBuffer', 'surge2Start', 'surge4Start', 'surge6Start',
    'clientCancellationCutoffHours', 'clientBookingStepMinutes', 'defaultLanguage'];
  for (const key of retired) {
    assert.ok(!serverSettingKeys().includes(key), `${key} is still a server setting`);
    assert.ok(!formSettingKeys().includes(key), `${key} is still in the settings form`);
    assert.ok(!new RegExp(`(appSettings|settings|s)\\.${key}\\b`).test(api), `${key} is still read in st-api`);
  }
  const cleanup = read('supabase/migrations/20261012140000_settings_cleanup.sql');
  for (const key of retired) assert.ok(cleanup.includes(`'${key}'`), `${key} is not deleted by the cleanup migration`);
  // The rows seeded by the base schema are the ones the cleanup has to remove.
  for (const key of retired) {
    if (new RegExp(`'${key}'`).test(schema)) assert.ok(cleanup.includes(`'${key}'`));
  }
});

test('the stage 1 dispatch and notification settings reached the interface', () => {
  const form = formSettingKeys();
  for (const key of ['managerEscalationHours', 'rescueHours', 'rescueBonus', 'cleanerCancellationCutoffMinutes',
    'emailNotificationTypes', 'notificationRetryLimit', 'notificationBatchSize']) {
    assert.ok(form.includes(key), `${key} is read by the server but cannot be changed anywhere`);
  }
});

test('the fixed-slot booking helper is gone with the setting that drove it', () => {
  assert.ok(!/export function availableBookingSlots/.test(logic));
  assert.ok(!/availableBookingSlots/.test(api));
  assert.ok(!/slots:/.test(api.slice(api.indexOf("route === 'client/slots'"), api.indexOf("route === 'client/bookings'"))),
    'the slots route returns the window and the price, not a pre-computed slot list');
});
