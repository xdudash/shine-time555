// Web Push (RFC 8030) with VAPID (RFC 8292) and aes128gcm payloads
// (RFC 8188 + RFC 8291), on WebCrypto only. No third-party dependency, so the
// Edge Function bundle has nothing to fetch and every step is testable in Node.
//
// Vocabulary used below:
//   ua_public / auth  the browser's subscription keys (p256dh, auth)
//   as_public         our ephemeral per-message public key, carried in the header
//   vapid keys        our long-lived identity, the same pair in every message

const encoder = new TextEncoder();

export function b64urlToBytes(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function bytesToB64url(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concat(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}

const info = (text) => concat(encoder.encode(text), new Uint8Array([0]));

// HKDF-Extract + HKDF-Expand (RFC 5869). WebCrypto's own HKDF would do, but
// the two steps are needed separately here: RFC 8291 extracts with the auth
// secret, RFC 8188 then extracts again with the record salt.
export async function hkdf(salt, ikm, infoBytes, length) {
  const extractKey = await crypto.subtle.importKey('raw', salt, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const prk = new Uint8Array(await crypto.subtle.sign('HMAC', extractKey, ikm));
  const expandKey = await crypto.subtle.importKey('raw', prk, {name: 'HMAC', hash: 'SHA-256'}, false, ['sign']);
  const out = new Uint8Array(length);
  let previous = new Uint8Array(0);
  let position = 0;
  for (let counter = 1; position < length; counter++) {
    previous = new Uint8Array(await crypto.subtle.sign('HMAC', expandKey,
      concat(previous, infoBytes, new Uint8Array([counter]))));
    const take = Math.min(previous.length, length - position);
    out.set(previous.subarray(0, take), position);
    position += take;
  }
  return out;
}

function rawPublicToJwk(raw) {
  if (raw.length !== 65 || raw[0] !== 4) throw new Error('Public key must be a 65-byte uncompressed P-256 point');
  return {kty: 'EC', crv: 'P-256', x: bytesToB64url(raw.subarray(1, 33)), y: bytesToB64url(raw.subarray(33, 65)), ext: true};
}

async function importPublicKey(raw, usage) {
  return crypto.subtle.importKey('jwk', rawPublicToJwk(raw),
    usage === 'verify' ? {name: 'ECDSA', namedCurve: 'P-256'} : {name: 'ECDH', namedCurve: 'P-256'},
    true, usage === 'verify' ? ['verify'] : []);
}

async function importVapidPrivateKey(publicRaw, privateRaw) {
  const jwk = {...rawPublicToJwk(publicRaw), d: bytesToB64url(privateRaw), key_ops: ['sign']};
  return crypto.subtle.importKey('jwk', jwk, {name: 'ECDSA', namedCurve: 'P-256'}, false, ['sign']);
}

// RFC 8292: a short-lived ES256 JWT naming the push service and ourselves.
export async function buildVapidAuthorization({endpoint, subject, publicKey, privateKey, now = Date.now(), ttlSeconds = 12 * 3600}) {
  if (!publicKey || !privateKey) throw new Error('VAPID keys are not configured');
  const audience = new URL(endpoint).origin;
  const header = bytesToB64url(encoder.encode(JSON.stringify({typ: 'JWT', alg: 'ES256'})));
  const claims = bytesToB64url(encoder.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(now / 1000) + Math.min(ttlSeconds, 24 * 3600),
    sub: subject,
  })))
  ;
  const signingInput = encoder.encode(`${header}.${claims}`);
  const key = await importVapidPrivateKey(b64urlToBytes(publicKey), b64urlToBytes(privateKey));
  // WebCrypto returns the raw r||s signature ECDSA/JWS wants.
  const signature = new Uint8Array(await crypto.subtle.sign({name: 'ECDSA', hash: 'SHA-256'}, key, signingInput));
  const token = `${header}.${claims}.${bytesToB64url(signature)}`;
  return {authorization: `vapid t=${token}, k=${publicKey}`, token, audience};
}

// RFC 8291 §3.4 + RFC 8188 §2: one record, one key, padding delimiter 0x02.
export async function encryptPayload(payload, {p256dh, auth, salt, serverKeys, recordSize = 4096}) {
  const uaPublicRaw = b64urlToBytes(p256dh);
  const authSecret = b64urlToBytes(auth);
  const recordSalt = salt ? b64urlToBytes(salt) : crypto.getRandomValues(new Uint8Array(16));
  const keyPair = serverKeys || await crypto.subtle.generateKey({name: 'ECDH', namedCurve: 'P-256'}, true, ['deriveBits']);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', keyPair.publicKey));

  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    {name: 'ECDH', public: await importPublicKey(uaPublicRaw, 'derive')}, keyPair.privateKey, 256));

  const ikm = await hkdf(authSecret, ecdhSecret,
    concat(info('WebPush: info'), uaPublicRaw, asPublicRaw), 32);
  const contentEncryptionKey = await hkdf(recordSalt, ikm, info('Content-Encoding: aes128gcm'), 16);
  const nonce = await hkdf(recordSalt, ikm, info('Content-Encoding: nonce'), 12);

  const plaintext = typeof payload === 'string' ? encoder.encode(payload) : payload;
  const maxPlaintext = recordSize - 16 /* tag */ - 1 /* delimiter */;
  if (plaintext.length > maxPlaintext) throw new Error('Push payload is too long');
  const key = await crypto.subtle.importKey('raw', contentEncryptionKey, {name: 'AES-GCM'}, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({name: 'AES-GCM', iv: nonce, tagLength: 128}, key,
    concat(plaintext, new Uint8Array([2]))));

  const recordSizeBytes = new Uint8Array(4);
  new DataView(recordSizeBytes.buffer).setUint32(0, recordSize, false);
  const header = concat(recordSalt, recordSizeBytes, new Uint8Array([asPublicRaw.length]), asPublicRaw);
  return concat(header, ciphertext);
}

// A push service answering 404 or 410 has thrown the subscription away; anything
// else may be transient and is reported as a failure so the row is retried.
export function classifyPushResponse(status) {
  if (status >= 200 && status < 300) return 'sent';
  if (status === 404 || status === 410) return 'gone';
  return 'failed';
}

export async function sendPushMessage({subscription, payload, vapid, fetchImpl = fetch, ttl = 3600, urgency = 'normal', now = Date.now()}) {
  const body = await encryptPayload(payload, {p256dh: subscription.p256dh, auth: subscription.auth});
  const {authorization} = await buildVapidAuthorization({
    endpoint: subscription.endpoint, subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey, now,
  });
  const response = await fetchImpl(subscription.endpoint, {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
  });
  const outcome = classifyPushResponse(response.status);
  return {outcome, status: response.status, subscriptionId: subscription.id};
}

// One notification, every browser the person has registered. The row counts as
// sent when at least one browser accepted it; endpoints the service has
// forgotten come back so the worker can delete them.
export async function deliverPush({row, vapid, fetchImpl = fetch, now = Date.now()}) {
  const payload = JSON.stringify({
    title: row.title, body: row.message, type: row.type,
    notificationId: row.notificationId ?? null, language: row.language || 'sk',
  });
  const gone = [];
  const errors = [];
  let delivered = 0;
  for (const subscription of row.subscriptions || []) {
    try {
      const result = await sendPushMessage({subscription, payload, vapid, fetchImpl, now});
      if (result.outcome === 'sent') delivered++;
      else if (result.outcome === 'gone') gone.push(subscription.id);
      else errors.push(`${result.status} from push service`);
    } catch (error) {
      errors.push(error?.message || 'push failed');
    }
  }
  if (delivered > 0) return {id: row.id, ok: true, goneSubscriptionIds: gone};
  if (gone.length && !errors.length) {
    // Every browser is gone: there is nobody left to deliver to, so stop retrying.
    return {id: row.id, ok: true, goneSubscriptionIds: gone, note: 'no live subscription'};
  }
  return {id: row.id, ok: false, error: errors.join('; ') || 'no push subscription', goneSubscriptionIds: gone};
}
