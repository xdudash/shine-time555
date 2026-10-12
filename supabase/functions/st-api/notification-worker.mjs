// Drains the notification outbox: claim a batch, send each row on its channel,
// report every outcome back. Dependencies are injected so the whole worker can
// run in a test without a database, a socket or a push service.

import {deliverPush} from './webpush.mjs';
import {deliverEmail} from './notification-text.mjs';

export function workerConfigFromEnv(env) {
  const read = (key) => env.get(key) || '';
  const port = Number(read('SMTP_PORT') || 465);
  return {
    secret: read('ST_WORKER_SECRET'),
    appUrl: read('ST_APP_URL') || 'https://xdudash.github.io/shine-time555/',
    vapid: {
      publicKey: read('VAPID_PUBLIC_KEY'),
      privateKey: read('VAPID_PRIVATE_KEY'),
      subject: read('VAPID_SUBJECT') || 'mailto:info@shinetime.sk',
    },
    smtp: {
      host: read('SMTP_HOST'),
      port: Number.isFinite(port) && port > 0 ? port : 465,
      user: read('SMTP_USER'),
      password: read('SMTP_PASSWORD'),
      from: read('SMTP_FROM') || read('SMTP_USER'),
      fromName: read('SMTP_FROM_NAME') || 'Shine Time',
      heloName: read('SMTP_HELO') || '',
    },
  };
}

// Equal-length comparison so a wrong secret cannot be guessed byte by byte.
export function secretMatches(expected, provided) {
  const a = String(expected || '');
  const b = String(provided || '');
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function channelReadiness(config) {
  return {
    push: Boolean(config.vapid.publicKey && config.vapid.privateKey),
    email: Boolean(config.smtp.host && config.smtp.from),
  };
}

export async function drainOutbox({config, claim, report, sendMailImpl, fetchImpl = fetch, limit, now = Date.now()}) {
  const claimed = await claim(limit);
  const rows = Array.isArray(claimed?.rows) ? claimed.rows : [];
  if (!rows.length) return {claimed: 0, sent: 0, failed: 0, skipped: 0, results: []};
  const ready = channelReadiness(config);
  const results = [];
  for (const row of rows) {
    if (row.channel === 'PUSH') {
      if (!ready.push) { results.push({id: row.id, ok: false, error: 'VAPID keys are not configured'}); continue; }
      results.push(await deliverPush({row, vapid: config.vapid, fetchImpl, now}));
    } else if (row.channel === 'EMAIL') {
      if (!ready.email) { results.push({id: row.id, ok: false, error: 'SMTP is not configured'}); continue; }
      results.push(await deliverEmail({row, config: config.smtp, appUrl: config.appUrl, sendMailImpl}));
    } else {
      results.push({id: row.id, ok: false, error: `unknown channel ${row.channel}`});
    }
  }
  const reported = await report(results);
  return {
    claimed: rows.length,
    sent: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    prunedSubscriptions: reported?.prunedSubscriptions ?? 0,
    results,
  };
}
