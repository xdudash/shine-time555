// Localized wrapper for an email notification. The title and message come from
// the notification row (already written by the database in the operator's
// wording); this only adds the greeting, the explanation of why the mail
// arrived, and the link back into the application.

const STRINGS = {
  sk: {
    greeting: (name) => (name ? `Dobrý deň, ${name},` : 'Dobrý deň,'),
    open: 'Otvoriť Shine Time',
    why: 'Túto správu ste dostali, pretože máte v Shine Time zapnuté e-mailové upozornenia.',
    off: 'Upozornenia si môžete vypnúť v aplikácii v časti Nastavenia.',
    signature: 'Shine Time',
  },
  ru: {
    greeting: (name) => (name ? `Здравствуйте, ${name},` : 'Здравствуйте,'),
    open: 'Открыть Shine Time',
    why: 'Вы получили это письмо, потому что в Shine Time включены email-уведомления.',
    off: 'Отключить уведомления можно в приложении, в разделе «Настройки».',
    signature: 'Shine Time',
  },
  uk: {
    greeting: (name) => (name ? `Добрий день, ${name},` : 'Добрий день,'),
    open: 'Відкрити Shine Time',
    why: 'Ви отримали цей лист, бо в Shine Time увімкнені email-повідомлення.',
    off: 'Вимкнути повідомлення можна в застосунку, у розділі «Налаштування».',
    signature: 'Shine Time',
  },
  en: {
    greeting: (name) => (name ? `Hello ${name},` : 'Hello,'),
    open: 'Open Shine Time',
    why: 'You received this message because email notifications are on for your Shine Time account.',
    off: 'You can turn notifications off in the application under Settings.',
    signature: 'Shine Time',
  },
};

export const emailLocale = (language) => STRINGS[String(language || '').toLowerCase()] || STRINGS.sk;

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function renderNotificationEmail({title, message, recipientName, language, appUrl}) {
  const strings = emailLocale(language);
  const link = appUrl || 'https://xdudash.github.io/shine-time555/';
  const text = [
    strings.greeting(recipientName),
    '',
    title,
    message,
    '',
    `${strings.open}: ${link}`,
    '',
    strings.why,
    strings.off,
    '',
    strings.signature,
  ].join('\n');
  const html = [
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f5f7fa;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#13223b">',
    '<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;padding:24px">',
    `<p style="margin:0 0 16px;color:#54637d">${escapeHtml(strings.greeting(recipientName))}</p>`,
    `<h1 style="margin:0 0 8px;font-size:19px;line-height:1.35">${escapeHtml(title)}</h1>`,
    `<p style="margin:0 0 20px;font-size:15px;line-height:1.5">${escapeHtml(message)}</p>`,
    `<p style="margin:0 0 24px"><a href="${escapeHtml(link)}" style="display:inline-block;background:#1f6feb;color:#fff;text-decoration:none;padding:11px 18px;border-radius:9px;font-weight:600">${escapeHtml(strings.open)}</a></p>`,
    `<p style="margin:0;font-size:12px;line-height:1.5;color:#77859c">${escapeHtml(strings.why)}<br>${escapeHtml(strings.off)}</p>`,
    '</div></body></html>',
  ].join('');
  return {subject: title, text, html};
}

// One outbox row, one email. Errors are returned, never thrown, so one bad
// address cannot stop the rest of the batch.
export async function deliverEmail({row, config, appUrl, sendMailImpl, date}) {
  if (!config?.host || !config?.from) return {id: row.id, ok: false, error: 'SMTP is not configured'};
  if (!row.email) return {id: row.id, ok: false, error: 'recipient has no email address'};
  const {subject, text, html} = renderNotificationEmail({
    title: row.title, message: row.message, recipientName: row.recipientName, language: row.language, appUrl,
  });
  try {
    await sendMailImpl({config, to: row.email, toName: row.recipientName, subject, text, html, date});
    return {id: row.id, ok: true};
  } catch (error) {
    return {id: row.id, ok: false, error: error?.message || 'smtp failed'};
  }
}
