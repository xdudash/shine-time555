import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {encodeHeaderValue, base64Body, buildMessage, smtpConversation, sendMail} from '../supabase/functions/st-api/smtp.mjs';
import {renderNotificationEmail, deliverEmail, emailLocale} from '../supabase/functions/st-api/notification-text.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

// A scripted mail server: every client line is recorded, every reply is served
// in order, so the whole conversation is asserted without a socket.
function fakeServer(script, {supportsStartTls = false, implicit = true} = {}) {
  const sent = [];
  const replies = [...script];
  let tlsStarted = implicit;
  const transport = {
    sent,
    async read() { return replies.length ? replies.shift() : null; },
    async write(text) { sent.push(text.replace(/\r\n$/, '')); },
    startTls: implicit ? null : async () => { tlsStarted = true; },
    close() { transport.closed = true; },
    get tlsStarted() { return tlsStarted; },
  };
  if (!supportsStartTls) return transport;
  return transport;
}

const okScript = [
  '220 smtp.hostinger.com ESMTP ready\r\n',
  '250-smtp.hostinger.com\r\n250-SIZE 52428800\r\n250-AUTH LOGIN PLAIN\r\n250 8BITMIME\r\n',
  '334 VXNlcm5hbWU6\r\n',
  '334 UGFzc3dvcmQ6\r\n',
  '235 2.7.0 Authentication succeeded\r\n',
  '250 2.1.0 Ok\r\n',
  '250 2.1.5 Ok\r\n',
  '354 End data with <CR><LF>.<CR><LF>\r\n',
  '250 2.0.0 Ok: queued as 4ABCD\r\n',
  '221 2.0.0 Bye\r\n',
];

test('header values stay readable in ASCII and become encoded words otherwise', () => {
  assert.equal(encodeHeaderValue('New client booking'), 'New client booking');
  assert.equal(encodeHeaderValue('Срочная уборка'), `=?UTF-8?B?${Buffer.from('Срочная уборка', 'utf8').toString('base64')}?=`);
  assert.equal(encodeHeaderValue('Upratovanie čaká'), `=?UTF-8?B?${Buffer.from('Upratovanie čaká', 'utf8').toString('base64')}?=`);
});

test('bodies are base64 in 76-character lines, so no line needs dot-stuffing', () => {
  const body = base64Body('Строка с кириллицей и очень длинным текстом, '.repeat(6));
  for (const line of body.split('\r\n')) {
    assert.ok(line.length <= 76);
    assert.ok(!line.startsWith('.'));
  }
  assert.equal(Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8').startsWith('Строка'), true);
});

test('a multipart message carries both a text and an HTML part with the right headers', () => {
  const message = buildMessage({
    from: 'info@shinetime.sk', fromName: 'Shine Time', to: 'cleaner@test.invalid', toName: 'Ján Čistič',
    subject: 'Срочная уборка', text: 'plain', html: '<p>rich</p>', messageId: 'abc-123@shinetime.sk',
    date: new Date(Date.UTC(2026, 9, 12, 10, 30, 0)),
  });
  assert.match(message, /^From: Shine Time <info@shinetime\.sk>\r\n/);
  assert.match(message, /\r\nTo: =\?UTF-8\?B\?[\w+/=]+\?= <cleaner@test\.invalid>\r\n/);
  assert.match(message, /\r\nSubject: =\?UTF-8\?B\?/);
  assert.match(message, /\r\nDate: Mon, 12 Oct 2026 10:30:00 GMT\r\n/);
  assert.match(message, /\r\nMessage-ID: <abc-123@shinetime\.sk>\r\n/);
  assert.match(message, /\r\nAuto-Submitted: auto-generated\r\n/);
  assert.match(message, /Content-Type: multipart\/alternative; boundary="st-abc123shinetimesk"/);
  assert.equal((message.match(/Content-Transfer-Encoding: base64/g) || []).length, 2);
  assert.ok(message.includes(Buffer.from('plain', 'utf8').toString('base64')));
  assert.ok(message.includes(Buffer.from('<p>rich</p>', 'utf8').toString('base64')));
  assert.match(message, /\r\n--st-abc123shinetimesk--\r\n$/);

  const plainOnly = buildMessage({from: 'info@shinetime.sk', to: 'a@b.c', subject: 'x', text: 'y', messageId: 'm@shinetime.sk'});
  assert.match(plainOnly, /Content-Type: text\/plain; charset=UTF-8/);
  assert.ok(!plainOnly.includes('multipart'));
});

test('the SMTP conversation follows the protocol and terminates the body correctly', async () => {
  const server = fakeServer(okScript);
  const result = await smtpConversation(server, {
    host: 'shinetime.sk', user: 'info@shinetime.sk', password: 'secret-not-real',
    from: 'Shine Time <info@shinetime.sk>', to: 'cleaner@test.invalid', message: 'Subject: x\r\n\r\nbody',
  });
  assert.equal(result.ok, true);
  assert.match(result.reply, /queued as 4ABCD/);
  assert.deepEqual(server.sent, [
    'EHLO shinetime.sk',
    'AUTH LOGIN',
    Buffer.from('info@shinetime.sk').toString('base64'),
    Buffer.from('secret-not-real').toString('base64'),
    'MAIL FROM:<info@shinetime.sk>',
    'RCPT TO:<cleaner@test.invalid>',
    'DATA',
    'Subject: x\r\n\r\nbody\r\n.',
    'QUIT',
  ]);
});

test('a multi-line greeting is read as one reply and STARTTLS is used when offered', async () => {
  const server = fakeServer([
    '220 ready\r\n',
    '250-smtp\r\n250-STARTTLS\r\n250 AUTH LOGIN\r\n',
    '220 go ahead\r\n',
    '250-smtp\r\n250 AUTH LOGIN\r\n',
    '334 VXNlcm5hbWU6\r\n', '334 UGFzc3dvcmQ6\r\n', '235 ok\r\n',
    '250 ok\r\n', '250 ok\r\n', '354 go\r\n', '250 queued\r\n', '221 bye\r\n',
  ], {implicit: false});
  await smtpConversation(server, {host: 'shinetime.sk', user: 'u', password: 'p', from: 'a@b.c', to: 'd@e.f', message: 'x'});
  assert.equal(server.tlsStarted, true, 'the socket was upgraded before AUTH');
  assert.equal(server.sent[0], 'EHLO shinetime.sk');
  assert.equal(server.sent[1], 'STARTTLS');
  assert.equal(server.sent[2], 'EHLO shinetime.sk', 'EHLO is repeated after the upgrade');
  assert.equal(server.sent[3], 'AUTH LOGIN');
});

test('a rejected password, a refused recipient and a dropped connection are reported, not swallowed', async () => {
  const rejected = fakeServer([
    '220 ready\r\n', '250-smtp\r\n250 AUTH LOGIN\r\n', '334 VXNlcm5hbWU6\r\n', '334 UGFzc3dvcmQ6\r\n',
    '535 5.7.8 Authentication credentials invalid\r\n',
  ]);
  await assert.rejects(smtpConversation(rejected, {host: 'h', user: 'u', password: 'bad', from: 'a@b.c', to: 'd@e.f', message: 'x'}),
    /AUTH password failed.*535/s);

  const refused = fakeServer([
    '220 ready\r\n', '250-smtp\r\n250 AUTH LOGIN\r\n', '334 a\r\n', '334 b\r\n', '235 ok\r\n',
    '250 ok\r\n', '550 5.1.1 No such user\r\n',
  ]);
  await assert.rejects(smtpConversation(refused, {host: 'h', user: 'u', password: 'p', from: 'a@b.c', to: 'nobody@e.f', message: 'x'}),
    /RCPT TO failed.*550/s);

  const dropped = fakeServer(['220 ready\r\n']);
  await assert.rejects(smtpConversation(dropped, {host: 'h', user: 'u', password: 'p', from: 'a@b.c', to: 'd@e.f', message: 'x'}),
    /closed the connection/i);

  const noAuth = fakeServer(['220 ready\r\n', '250-smtp\r\n250 SIZE 100\r\n']);
  await assert.rejects(smtpConversation(noAuth, {host: 'h', user: 'u', password: 'p', from: 'a@b.c', to: 'd@e.f', message: 'x'}),
    /does not offer AUTH LOGIN/i);
});

test('sendMail builds the message, uses the injected transport and always closes it', async () => {
  const server = fakeServer(okScript);
  const result = await sendMail({
    config: {host: 'smtp.hostinger.com', port: 465, user: 'info@shinetime.sk', password: 'secret-not-real', from: 'info@shinetime.sk', fromName: 'Shine Time'},
    to: 'owner@test.invalid', toName: 'Owner', subject: 'Nová rezervácia', text: 'detail', html: '<p>detail</p>',
    messageId: 'id-1@shinetime.sk', date: new Date(Date.UTC(2026, 9, 12, 11, 0, 0)),
    openTransport: async () => server,
  });
  assert.equal(result.ok, true);
  assert.equal(server.closed, true);
  const data = server.sent.find((line) => line.startsWith('From:'));
  assert.match(data, /^From: Shine Time <info@shinetime\.sk>/);
  assert.match(data, /\r\n\.$/, 'the body ends with the single-dot terminator');
  assert.ok(!server.sent.some((line) => line.includes('secret-not-real')), 'the password is only ever sent base64-encoded');
});

test('the notification email is localized, escapes the message and links to the app', () => {
  const ru = renderNotificationEmail({title: 'Срочная уборка', message: 'TEST-1 <b>сегодня</b>', recipientName: 'Иван', language: 'ru', appUrl: 'https://shinetime.sk/app'});
  assert.equal(ru.subject, 'Срочная уборка');
  assert.match(ru.text, /^Здравствуйте, Иван,/);
  assert.match(ru.text, /Открыть Shine Time: https:\/\/shinetime\.sk\/app/);
  assert.match(ru.text, /email-уведомления/);
  assert.ok(ru.html.includes('&lt;b&gt;сегодня&lt;/b&gt;'), 'message text is escaped into the HTML part');
  assert.ok(!ru.html.includes('<b>сегодня</b>'));
  assert.ok(ru.html.includes('href="https://shinetime.sk/app"'));

  for (const [language, marker] of [['sk', 'Dobrý deň'], ['uk', 'Добрий день'], ['en', 'Hello']]) {
    const rendered = renderNotificationEmail({title: 't', message: 'm', recipientName: 'X', language});
    assert.ok(rendered.text.startsWith(marker), `${language} greeting`);
  }
  assert.equal(emailLocale('pt'), emailLocale('sk'), 'an unknown language falls back to Slovak');
  assert.match(renderNotificationEmail({title: 't', message: 'm', language: 'sk'}).text, /^Dobrý deň,/, 'no name is fine');
});

test('deliverEmail reports a failure per row instead of throwing', async () => {
  const config = {host: 'smtp.hostinger.com', port: 465, from: 'info@shinetime.sk'};
  const row = {id: 5, title: 'Nová rezervácia', message: 'TEST-1', recipientName: 'Owner', email: 'owner@test.invalid', language: 'sk'};
  const calls = [];
  const ok = await deliverEmail({row, config, appUrl: 'https://shinetime.sk/app', sendMailImpl: async (args) => { calls.push(args); }});
  assert.deepEqual(ok, {id: 5, ok: true});
  assert.equal(calls[0].to, 'owner@test.invalid');
  assert.equal(calls[0].subject, 'Nová rezervácia');

  const failed = await deliverEmail({row, config, sendMailImpl: async () => { throw new Error('535 Authentication credentials invalid'); }});
  assert.equal(failed.ok, false);
  assert.match(failed.error, /535/);

  assert.deepEqual(await deliverEmail({row, config: {}, sendMailImpl: async () => {}}), {id: 5, ok: false, error: 'SMTP is not configured'});
  assert.deepEqual(await deliverEmail({row: {...row, email: null}, config, sendMailImpl: async () => {}}),
    {id: 5, ok: false, error: 'recipient has no email address'});
});
