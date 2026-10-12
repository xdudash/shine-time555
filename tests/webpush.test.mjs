import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {b64urlToBytes, bytesToB64url, hkdf, buildVapidAuthorization, encryptPayload, classifyPushResponse, sendPushMessage, deliverPush} from '../supabase/functions/st-api/webpush.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const encoder = new TextEncoder();
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const fromHex = (value) => new Uint8Array(Buffer.from(value, 'hex'));

test('HKDF matches RFC 5869 test case 1', async () => {
  const okm = await hkdf(
    fromHex('000102030405060708090a0b0c'),
    fromHex('0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b'),
    fromHex('f0f1f2f3f4f5f6f7f8f9'),
    42);
  assert.equal(hex(okm), '3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
});

test('base64url round-trips bytes the push API uses', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(65));
  assert.equal(hex(b64urlToBytes(bytesToB64url(bytes))), hex(bytes));
  assert.match(bytesToB64url(bytes), /^[A-Za-z0-9_-]+$/);
});

// An independent decryption written straight from RFC 8291 §3.4 and RFC 8188 §2:
// if our encryption disagrees with the spec's key schedule, this fails.
async function decryptAsBrowserWould(body, {uaKeyPair, uaPublicRaw, authSecret}) {
  const salt = body.subarray(0, 16);
  const recordSize = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0, false);
  const keyIdLength = body[20];
  const asPublicRaw = body.subarray(21, 21 + keyIdLength);
  const ciphertext = body.subarray(21 + keyIdLength);

  const asPublic = await crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256',
    x: bytesToB64url(asPublicRaw.subarray(1, 33)),
    y: bytesToB64url(asPublicRaw.subarray(33, 65)),
  }, {name: 'ECDH', namedCurve: 'P-256'}, true, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({name: 'ECDH', public: asPublic}, uaKeyPair.privateKey, 256));

  const withNul = (text) => {
    const label = encoder.encode(text);
    const out = new Uint8Array(label.length + 1);
    out.set(label);
    return out;
  };
  const keyInfo = new Uint8Array(withNul('WebPush: info').length + uaPublicRaw.length + asPublicRaw.length);
  keyInfo.set(withNul('WebPush: info'), 0);
  keyInfo.set(uaPublicRaw, withNul('WebPush: info').length);
  keyInfo.set(asPublicRaw, withNul('WebPush: info').length + uaPublicRaw.length);

  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, withNul('Content-Encoding: aes128gcm'), 16);
  const nonce = await hkdf(salt, ikm, withNul('Content-Encoding: nonce'), 12);
  const key = await crypto.subtle.importKey('raw', cek, {name: 'AES-GCM'}, false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({name: 'AES-GCM', iv: nonce, tagLength: 128}, key, ciphertext));
  assert.equal(padded[padded.length - 1], 2, 'last record carries the 0x02 delimiter');
  return {text: new TextDecoder().decode(padded.subarray(0, padded.length - 1)), recordSize, asPublicRaw, salt};
}

async function browserSubscription() {
  const uaKeyPair = await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']);
  const uaPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', uaKeyPair.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return {
    uaKeyPair, uaPublicRaw, authSecret,
    subscription: {id: 7, endpoint: 'https://push.example.invalid/f/abc', p256dh: bytesToB64url(uaPublicRaw), auth: bytesToB64url(authSecret)},
  };
}

test('an encrypted payload decrypts back to the plaintext with the subscription keys', async () => {
  const {uaKeyPair, uaPublicRaw, authSecret, subscription} = await browserSubscription();
  const body = await encryptPayload('When I grow up, I want to be a watermelon', {p256dh: subscription.p256dh, auth: subscription.auth});
  const decrypted = await decryptAsBrowserWould(body, {uaKeyPair, uaPublicRaw, authSecret});
  assert.equal(decrypted.text, 'When I grow up, I want to be a watermelon');
  assert.equal(decrypted.recordSize, 4096);
  assert.equal(decrypted.asPublicRaw.length, 65);
  assert.equal(decrypted.asPublicRaw[0], 4);
  assert.equal(decrypted.salt.length, 16);
  assert.equal(body.length, 16 + 4 + 1 + 65 + 'When I grow up, I want to be a watermelon'.length + 1 + 16);
});

test('a different browser cannot decrypt another browser message, and the salt changes every time', async () => {
  const first = await browserSubscription();
  const second = await browserSubscription();
  const body = await encryptPayload('secret', {p256dh: first.subscription.p256dh, auth: first.subscription.auth});
  await assert.rejects(decryptAsBrowserWould(body, {uaKeyPair: second.uaKeyPair, uaPublicRaw: second.uaPublicRaw, authSecret: second.authSecret}));
  const again = await encryptPayload('secret', {p256dh: first.subscription.p256dh, auth: first.subscription.auth});
  assert.notEqual(hex(body.subarray(0, 16)), hex(again.subarray(0, 16)));
  assert.notEqual(hex(body), hex(again));
});

test('an oversized payload is refused instead of silently truncated', async () => {
  const {subscription} = await browserSubscription();
  await assert.rejects(encryptPayload('x'.repeat(4096), {p256dh: subscription.p256dh, auth: subscription.auth}), /too long/i);
});

async function vapidKeys() {
  const pair = await crypto.subtle.generateKey({name: 'ECDSA', namedCurve: 'P-256'}, true, ['sign', 'verify']);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return {publicKey: bytesToB64url(publicRaw), privateKey: jwk.d, verifyKey: pair.publicKey};
}

test('the VAPID header is a verifiable ES256 JWT for the push service origin', async () => {
  const keys = await vapidKeys();
  const now = Date.UTC(2026, 9, 12, 10, 0, 0);
  const {authorization, token} = await buildVapidAuthorization({
    endpoint: 'https://fcm.googleapis.com/fcm/send/abc?x=1', subject: 'mailto:info@shinetime.sk',
    publicKey: keys.publicKey, privateKey: keys.privateKey, now,
  });
  assert.match(authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.ok(authorization.endsWith(`k=${keys.publicKey}`));
  const [header, claims, signature] = token.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(header, 'base64url')), {typ: 'JWT', alg: 'ES256'});
  const payload = JSON.parse(Buffer.from(claims, 'base64url'));
  assert.equal(payload.aud, 'https://fcm.googleapis.com', 'audience is the origin, not the full endpoint');
  assert.equal(payload.sub, 'mailto:info@shinetime.sk');
  assert.equal(payload.exp, Math.floor(now / 1000) + 12 * 3600);
  const verified = await crypto.subtle.verify({name: 'ECDSA', hash: 'SHA-256'}, keys.verifyKey,
    b64urlToBytes(signature), encoder.encode(`${header}.${claims}`));
  assert.equal(verified, true);
  await assert.rejects(buildVapidAuthorization({endpoint: 'https://push.example.invalid/x', subject: 'mailto:a@b.c'}), /not configured/i);
});

test('the request carries the headers push services require', async () => {
  const keys = await vapidKeys();
  const {subscription} = await browserSubscription();
  let seen = null;
  const fetchImpl = async (url, init) => { seen = {url, init}; return {status: 201}; };
  const result = await sendPushMessage({subscription, payload: 'hello', vapid: {...keys, subject: 'mailto:info@shinetime.sk'}, fetchImpl});
  assert.equal(result.outcome, 'sent');
  assert.equal(seen.url, subscription.endpoint);
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(seen.init.headers['Content-Type'], 'application/octet-stream');
  assert.equal(seen.init.headers.TTL, '3600');
  assert.equal(seen.init.headers.Urgency, 'normal');
  assert.match(seen.init.headers.Authorization, /^vapid t=/);
  assert.ok(seen.init.body instanceof Uint8Array);
});

test('push service answers are classified so only hopeless rows stop retrying', () => {
  for (const status of [200, 201, 202]) assert.equal(classifyPushResponse(status), 'sent');
  for (const status of [404, 410]) assert.equal(classifyPushResponse(status), 'gone');
  for (const status of [400, 401, 429, 500, 502, 503]) assert.equal(classifyPushResponse(status), 'failed');
});

test('delivery across several browsers: one live endpoint is enough, dead ones come back to be pruned', async () => {
  const keys = {...await vapidKeys(), subject: 'mailto:info@shinetime.sk'};
  const live = await browserSubscription();
  const dead = await browserSubscription();
  const broken = await browserSubscription();
  const row = {
    id: 42, title: 'Urgent cleaning with bonus', message: 'TEST-1', type: 'RESCUE', language: 'uk',
    subscriptions: [
      {...live.subscription, id: 1},
      {...dead.subscription, id: 2, endpoint: 'https://push.example.invalid/gone'},
      {...broken.subscription, id: 3, endpoint: 'https://push.example.invalid/broken'},
    ],
  };
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({url, body: init.body});
    if (url.endsWith('/gone')) return {status: 410};
    if (url.endsWith('/broken')) return {status: 503};
    return {status: 201};
  };
  const result = await deliverPush({row, vapid: keys, fetchImpl});
  assert.equal(result.id, 42);
  assert.equal(result.ok, true, 'one delivered browser means the notification was delivered');
  assert.deepEqual(result.goneSubscriptionIds, [2]);
  assert.equal(sent.length, 3);

  // The payload the service worker will read.
  const decrypted = await decryptAsBrowserWould(sent[0].body, live);
  assert.deepEqual(JSON.parse(decrypted.text), {title: 'Urgent cleaning with bonus', body: 'TEST-1', type: 'RESCUE', notificationId: null, language: 'uk'});
});

test('a row with no live browser left is not retried forever, and a transient failure is', async () => {
  const keys = {...await vapidKeys(), subject: 'mailto:info@shinetime.sk'};
  const only = await browserSubscription();
  const goneOnly = await deliverPush({row: {id: 1, title: 't', message: 'm', type: 'RESCUE', subscriptions: [{...only.subscription, id: 9}]},
    vapid: keys, fetchImpl: async () => ({status: 410})});
  assert.equal(goneOnly.ok, true);
  assert.deepEqual(goneOnly.goneSubscriptionIds, [9]);

  const transient = await deliverPush({row: {id: 2, title: 't', message: 'm', type: 'RESCUE', subscriptions: [{...only.subscription, id: 9}]},
    vapid: keys, fetchImpl: async () => ({status: 503})});
  assert.equal(transient.ok, false);
  assert.match(transient.error, /503/);

  const empty = await deliverPush({row: {id: 3, title: 't', message: 'm', type: 'RESCUE', subscriptions: []}, vapid: keys, fetchImpl: async () => ({status: 201})});
  assert.equal(empty.ok, false);
  assert.match(empty.error, /no push subscription/);
});
