// A small SMTP client for the domain's own mailbox (Hostinger), written against
// the protocol rather than a library: the Edge Function bundle stays dependency
// free and the whole conversation is testable with a fake transport.
//
// Supported: implicit TLS (port 465) and STARTTLS (port 587), AUTH LOGIN,
// one message per connection. Bodies are base64, so no dot-stuffing and no
// line-length limits to worry about.

const encoder = new TextEncoder();

export function encodeHeaderValue(value) {
  const text = String(value ?? '');
  // Plain ASCII headers stay readable; anything else becomes an encoded word.
  if (/^[\x20-\x7e]*$/.test(text)) return text;
  return `=?UTF-8?B?${btoa(String.fromCharCode(...encoder.encode(text)))}?=`;
}

export function base64Body(text) {
  const bytes = encoder.encode(String(text ?? ''));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return (btoa(binary).match(/.{1,76}/g) || []).join('\r\n');
}

function addressOnly(value) {
  const match = String(value).match(/<([^>]+)>/);
  return (match ? match[1] : String(value)).trim();
}

export function buildMessage({from, fromName, to, toName, subject, text, html, messageId, date = new Date(), listUnsubscribe}) {
  const boundary = `st-${messageId.replace(/[^A-Za-z0-9]/g, '').slice(0, 24)}`;
  const headers = [
    `From: ${fromName ? `${encodeHeaderValue(fromName)} <${addressOnly(from)}>` : addressOnly(from)}`,
    `To: ${toName ? `${encodeHeaderValue(toName)} <${addressOnly(to)}>` : addressOnly(to)}`,
    `Subject: ${encodeHeaderValue(subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: <${messageId}>`,
    'MIME-Version: 1.0',
    'Auto-Submitted: auto-generated',
  ];
  if (listUnsubscribe) headers.push(`List-Unsubscribe: <${listUnsubscribe}>`);
  if (!html) {
    headers.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64');
    return `${headers.join('\r\n')}\r\n\r\n${base64Body(text)}\r\n`;
  }
  headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
  const parts = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(text),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Body(html),
    `--${boundary}--`,
    '',
  ];
  return `${headers.join('\r\n')}\r\n\r\n${parts.join('\r\n')}`;
}

class SmtpError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

// A transport is {read(), write(text), startTls(), close()} so the protocol can
// be exercised without a socket. Deno's implementation is below.
export async function smtpConversation(transport, {host, user, password, from, to, message}) {
  let buffer = '';
  const nextReply = async () => {
    for (;;) {
      // A reply ends with a line whose code is followed by a space.
      const lines = buffer.split('\r\n');
      const complete = lines.findIndex((line) => /^\d{3} /.test(line));
      if (complete >= 0) {
        const reply = lines.slice(0, complete + 1).join('\r\n');
        buffer = lines.slice(complete + 1).join('\r\n');
        return {code: Number(reply.match(/^\d{3}/)[0]), text: reply};
      }
      const chunk = await transport.read();
      if (chunk === null || chunk === undefined) throw new SmtpError('The mail server closed the connection', 0);
      buffer += chunk;
    }
  };
  const expect = async (codes, step) => {
    const reply = await nextReply();
    if (!codes.includes(reply.code)) throw new SmtpError(`${step} failed: ${reply.text.split('\r\n')[0]}`, reply.code);
    return reply;
  };
  const send = async (line, codes, step) => { await transport.write(`${line}\r\n`); return expect(codes, step); };

  await expect([220], 'greeting');
  let greeting = await send(`EHLO ${host}`, [250], 'EHLO');
  if (transport.startTls && /STARTTLS/i.test(greeting.text)) {
    await send('STARTTLS', [220], 'STARTTLS');
    await transport.startTls();
    buffer = '';
    greeting = await send(`EHLO ${host}`, [250], 'EHLO after STARTTLS');
  }
  if (user) {
    if (!/AUTH[ =-].*LOGIN/i.test(greeting.text)) throw new SmtpError('The mail server does not offer AUTH LOGIN', 0);
    await send('AUTH LOGIN', [334], 'AUTH LOGIN');
    await send(btoa(user), [334], 'AUTH user');
    await send(btoa(password), [235], 'AUTH password');
  }
  await send(`MAIL FROM:<${addressOnly(from)}>`, [250], 'MAIL FROM');
  await send(`RCPT TO:<${addressOnly(to)}>`, [250, 251], 'RCPT TO');
  await send('DATA', [354], 'DATA');
  await transport.write(message.endsWith('\r\n') ? `${message}.\r\n` : `${message}\r\n.\r\n`);
  const accepted = await expect([250], 'message body');
  try { await send('QUIT', [221], 'QUIT'); } catch { /* the server may just close */ }
  return {ok: true, reply: accepted.text.split('\r\n')[0]};
}

// Deno sockets. Port 465 is TLS from the first byte; 587 starts plain and is
// upgraded by STARTTLS above.
export function denoTransport({hostname, port, implicitTls = port === 465}) {
  let connection = null;
  const decoder = new TextDecoder();
  return {
    async open() {
      connection = implicitTls
        ? await Deno.connectTls({hostname, port})
        : await Deno.connect({hostname, port});
      return this;
    },
    async read() {
      const chunk = new Uint8Array(4096);
      const read = await connection.read(chunk);
      return read === null ? null : decoder.decode(chunk.subarray(0, read));
    },
    async write(text) { await connection.write(encoder.encode(text)); },
    startTls: implicitTls ? null : async () => { connection = await Deno.startTls(connection, {hostname}); },
    close() { try { connection?.close(); } catch { /* already closed */ } },
  };
}

export async function sendMail({config, message, to, toName, subject, text, html, messageId, date, openTransport}) {
  const body = message || buildMessage({
    from: config.from, fromName: config.fromName, to, toName, subject, text, html,
    messageId: messageId || `${crypto.randomUUID()}@${String(config.from).split('@').pop()}`, date,
  });
  const transport = openTransport
    ? await openTransport()
    : await denoTransport({hostname: config.host, port: config.port}).open();
  try {
    return await smtpConversation(transport, {
      host: config.heloName || String(config.from).split('@').pop(),
      user: config.user, password: config.password, from: config.from, to, message: body,
    });
  } finally {
    transport.close();
  }
}
