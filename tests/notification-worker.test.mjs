import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {drainOutbox, workerConfigFromEnv, secretMatches, channelReadiness} from '../supabase/functions/st-api/notification-worker.mjs';
import {bytesToB64url} from '../supabase/functions/st-api/webpush.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;
const root = new URL('..', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');

const env = (values) => ({get: (key) => values[key]});

test('the worker configuration comes from the function secrets, with sane fallbacks', () => {
  const full = workerConfigFromEnv(env({
    ST_WORKER_SECRET: 'worker-secret', ST_APP_URL: 'https://shinetime.sk/app',
    VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:ops@shinetime.sk',
    SMTP_HOST: 'smtp.hostinger.com', SMTP_PORT: '587', SMTP_USER: 'info@shinetime.sk',
    SMTP_PASSWORD: 'secret-not-real', SMTP_FROM_NAME: 'Shine Time',
  }));
  assert.equal(full.secret, 'worker-secret');
  assert.equal(full.appUrl, 'https://shinetime.sk/app');
  assert.deepEqual(full.vapid, {publicKey: 'pub', privateKey: 'priv', subject: 'mailto:ops@shinetime.sk'});
  assert.equal(full.smtp.port, 587);
  assert.equal(full.smtp.from, 'info@shinetime.sk', 'the sender defaults to the mailbox we authenticate as');

  const empty = workerConfigFromEnv(env({}));
  assert.equal(empty.smtp.port, 465);
  assert.equal(empty.vapid.subject, 'mailto:info@shinetime.sk');
  assert.deepEqual(channelReadiness(empty), {push: false, email: false});
  assert.deepEqual(channelReadiness(workerConfigFromEnv(env({VAPID_PUBLIC_KEY: 'a', VAPID_PRIVATE_KEY: 'b'}))), {push: true, email: false});
  assert.deepEqual(channelReadiness(workerConfigFromEnv(env({SMTP_HOST: 'h', SMTP_USER: 'u@v.w'}))), {push: false, email: true});
  assert.equal(workerConfigFromEnv(env({SMTP_PORT: 'nonsense'})).smtp.port, 465);
});

test('the worker secret is compared whole, and an empty secret never matches', () => {
  assert.equal(secretMatches('abc123', 'abc123'), true);
  assert.equal(secretMatches('abc123', 'abc124'), false);
  assert.equal(secretMatches('abc123', 'abc12'), false);
  assert.equal(secretMatches('abc123', ''), false);
  assert.equal(secretMatches('', ''), false, 'an unset secret cannot be satisfied by sending nothing');
  assert.equal(secretMatches('', 'anything'), false);
  assert.equal(secretMatches(undefined, undefined), false);
});

async function pushSubscription(id) {
  const pair = await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return {id, endpoint: `https://push.example.invalid/${id}`, p256dh: bytesToB64url(raw), auth: bytesToB64url(crypto.getRandomValues(new Uint8Array(16)))};
}

async function vapid() {
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return {publicKey: bytesToB64url(raw), privateKey: jwk.d, subject: 'mailto:info@shinetime.sk'};
}

test('an empty outbox is one claim and no sending at all', async () => {
  let reported = 0;
  const summary = await drainOutbox({
    config: {vapid: await vapid(), smtp: {host: 'h', from: 'a@b.c'}, appUrl: 'https://shinetime.sk/app'},
    claim: async () => ({rows: []}),
    report: async () => { reported++; return {}; },
    sendMailImpl: async () => { throw new Error('should not send'); },
    fetchImpl: async () => { throw new Error('should not post'); },
  });
  assert.deepEqual(summary, {claimed: 0, sent: 0, failed: 0, skipped: 0, results: []});
  assert.equal(reported, 0, 'nothing to report means no second round trip');
});

test('a mixed batch: push and email are delivered on their own channels and every row is reported', async () => {
  const config = {vapid: await vapid(), smtp: {host: 'smtp.hostinger.com', port: 465, from: 'info@shinetime.sk'}, appUrl: 'https://shinetime.sk/app'};
  const rows = [
    {id: 1, channel: 'PUSH', type: 'MARKETPLACE', title: 'New cleaning available', message: 'TEST-1', language: 'sk', subscriptions: [await pushSubscription(11)]},
    {id: 2, channel: 'EMAIL', type: 'RESCUE', title: 'Urgent cleaning', message: 'TEST-2', language: 'ru', email: 'cleaner@test.invalid', recipientName: 'Иван', subscriptions: []},
    {id: 3, channel: 'PUSH', type: 'RESCUE', title: 'Urgent cleaning', message: 'TEST-3', language: 'uk', subscriptions: [await pushSubscription(12), await pushSubscription(13)]},
    {id: 4, channel: 'SMS', type: 'RESCUE', title: 'x', message: 'y', subscriptions: []},
  ];
  const mails = [];
  const posts = [];
  let claimedWith = 'unset';
  const summary = await drainOutbox({
    config,
    limit: 10,
    claim: async (limit) => { claimedWith = limit; return {rows}; },
    report: async (results) => ({sent: results.filter((r) => r.ok).length, prunedSubscriptions: 1}),
    sendMailImpl: async (args) => { mails.push(args); },
    fetchImpl: async (url) => { posts.push(url); return {status: url.endsWith('/13') ? 410 : 201}; },
  });
  assert.equal(claimedWith, 10);
  assert.equal(summary.claimed, 4);
  assert.equal(summary.sent, 3, 'two push rows and one email');
  assert.equal(summary.failed, 1, 'the unknown channel is the only failure');
  assert.equal(summary.prunedSubscriptions, 1);
  assert.equal(summary.results.find((r) => r.id === 4).error, 'unknown channel SMS');
  assert.deepEqual(summary.results.find((r) => r.id === 3).goneSubscriptionIds, [13]);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, 'cleaner@test.invalid');
  assert.equal(mails[0].subject, 'Urgent cleaning');
  assert.match(mails[0].text, /Здравствуйте, Иван/, 'the email is written in the recipient language');
  assert.match(mails[0].text, /https:\/\/shinetime\.sk\/app/);
  assert.equal(posts.length, 3);
});

test('an unconfigured channel fails its own rows and still delivers the other channel', async () => {
  const rows = [
    {id: 1, channel: 'PUSH', title: 't', message: 'm', type: 'RESCUE', subscriptions: [await pushSubscription(1)]},
    {id: 2, channel: 'EMAIL', title: 't', message: 'm', type: 'RESCUE', email: 'a@b.c', subscriptions: []},
  ];
  const mails = [];
  const summary = await drainOutbox({
    config: {vapid: {publicKey: '', privateKey: '', subject: 'mailto:x@y.z'}, smtp: {host: 'smtp.hostinger.com', from: 'info@shinetime.sk'}, appUrl: 'x'},
    claim: async () => ({rows}),
    report: async () => ({}),
    sendMailImpl: async (args) => { mails.push(args); },
    fetchImpl: async () => { throw new Error('push must not be attempted without keys'); },
  });
  assert.equal(summary.results.find((r) => r.id === 1).error, 'VAPID keys are not configured');
  assert.equal(summary.results.find((r) => r.id === 2).ok, true);
  assert.equal(mails.length, 1);

  const noSmtp = await drainOutbox({
    config: {vapid: await vapid(), smtp: {}, appUrl: 'x'},
    claim: async () => ({rows: [rows[1]]}),
    report: async () => ({}),
    sendMailImpl: async () => { throw new Error('smtp must not be attempted without a host'); },
  });
  assert.equal(noSmtp.results[0].error, 'SMTP is not configured');
});

test('a failing mail server does not stop the batch and every outcome reaches the report', async () => {
  const rows = [
    {id: 1, channel: 'EMAIL', title: 't', message: 'm', type: 'RESCUE', email: 'first@test.invalid', subscriptions: []},
    {id: 2, channel: 'EMAIL', title: 't', message: 'm', type: 'RESCUE', email: 'second@test.invalid', subscriptions: []},
  ];
  let reportedResults = null;
  const summary = await drainOutbox({
    config: {vapid: await vapid(), smtp: {host: 'smtp.hostinger.com', from: 'info@shinetime.sk'}, appUrl: 'x'},
    claim: async () => ({rows}),
    report: async (results) => { reportedResults = results; return {}; },
    sendMailImpl: async ({to}) => { if (to === 'first@test.invalid') throw new Error('535 Authentication credentials invalid'); },
  });
  assert.equal(summary.sent, 1);
  assert.equal(summary.failed, 1);
  assert.equal(reportedResults.length, 2);
  assert.match(reportedResults.find((r) => r.id === 1).error, /535/);
  assert.equal(reportedResults.find((r) => r.id === 2).ok, true);
});

test('the Edge Function guards the worker route and keeps subscriptions behind the API', () => {
  const source = read('supabase/functions/st-api/index.ts');
  assert.match(source, /route === 'dispatch\/outbox' && method === 'POST'/);
  assert.match(source, /secretMatches\(notificationConfig\.secret, req\.headers\.get\('x-st-worker-secret'\)\)/);
  assert.match(source, /if \(!notificationConfig\.secret\) throw new ApiError/, 'an unconfigured worker refuses instead of running open');
  // The guard has to sit before the request is turned into a user context,
  // because the scheduled call has a service-role token and no app user.
  assert.ok(source.indexOf("route === 'dispatch/outbox'") < source.indexOf('const ctx = await context(req)'));
  assert.match(source, /st_save_push_subscription/);
  assert.match(source, /st_delete_push_subscription/);
  assert.match(source, /st_set_notification_preferences/);
  assert.match(source, /account\/push\/test/);
  assert.match(source, /push: \{ publicKey: notificationConfig\.vapid\.publicKey \|\| '', enabled: channelReadiness\(notificationConfig\)\.push \}/);
  assert.ok(!/VAPID_PRIVATE_KEY/.test(read('assets/app.js')), 'no private key is ever referenced by the browser bundle');
  assert.ok(!/SMTP_PASSWORD/.test(read('assets/app.js')));

  const migration = read('supabase/migrations/20261012120000_notification_delivery.sql');
  assert.match(migration, /revoke all on public\.st_push_subscriptions, public\.st_notification_outbox from anon, authenticated/);
  assert.match(migration, /grant execute on function public\.st_claim_notifications\(integer\) to service_role/);
  assert.ok(!/grant execute on function public\.st_claim_notifications\(integer\) to authenticated/.test(migration));
});

test('no secret value is committed anywhere in the repository', () => {
  for (const path of ['deployment/notifications-schedule.sql', 'supabase/functions/st-api/notification-worker.mjs', 'supabase/migrations/20261012120000_notification_delivery.sql']) {
    const source = read(path);
    assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(source), `${path} must not contain a JWT`);
    // A real key, not the words: the deployment notes name the key format on purpose.
    assert.ok(!/sb_secret_[A-Za-z0-9_-]{10,}/.test(source), `${path} must not contain a secret API key`);
    assert.ok(!/service_role_key\s*=\s*['"][^'"]{10,}/i.test(source), `${path} must not contain a service key`);
  }
  const schedule = read('deployment/notifications-schedule.sql');
  assert.match(schedule, /<SERVICE_ROLE_KEY>/);
  assert.match(schedule, /<WORKER_SECRET>/);
});
