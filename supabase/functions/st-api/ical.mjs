// iCal (RFC 5545) reading for Airbnb / Booking.com calendar exports.
// Pure functions: no network, no database, so they run under Deno and Node tests alike.

// Hosts whose calendar exports we fetch. The server fetches the link itself, so a free-form URL
// would let anyone make it call internal or arbitrary addresses (SSRF). Channel managers are
// listed because many owners export one combined calendar from them.
const ALLOWED_HOSTS = [
  'airbnb.com', 'airbnb.co.uk', 'airbnb.de', 'airbnb.sk', 'airbnb.cz', 'airbnb.at', 'airbnb.pl', 'airbnb.hu', 'airbnb.fr', 'airbnb.it', 'airbnb.es',
  'booking.com',
  'vrbo.com', 'homeaway.com', 'calendar.google.com', 'outlook.office365.com', 'outlook.live.com',
  'smoobu.com', 'beds24.com', 'hostaway.com', 'lodgify.com', 'guesty.com', 'hospitable.com',
];

export function calendarHostAllowed(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/\.$/, '');
  return ALLOWED_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

export function sourceForHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (/(^|\.)airbnb\./.test(host)) return 'AIRBNB';
  if (/(^|\.)booking\.com$/.test(host)) return 'BOOKING';
  return 'OTHER';
}

// Returns {url, source} or throws an Error whose message is safe to show to the owner.
export function validateCalendarUrl(raw) {
  const text = String(raw || '').trim().replace(/^webcal:\/\//i, 'https://');
  if (!text) throw new Error('Paste the calendar export link');
  if (text.length > 2000) throw new Error('The calendar link is too long');
  let url;
  try { url = new URL(text); } catch { throw new Error('This is not a valid link'); }
  if (url.protocol !== 'https:') throw new Error('The calendar link must start with https://');
  if (url.username || url.password) throw new Error('This is not a valid link');
  if (url.port && url.port !== '443') throw new Error('This is not a valid link');
  if (!calendarHostAllowed(url.hostname)) {
    throw new Error('Use the iCal export link from Airbnb, Booking.com, VRBO, Google Calendar or your channel manager');
  }
  url.hash = '';
  return { url: url.toString(), source: sourceForHost(url.hostname) };
}

// What the owner sees instead of the link: links carry private tokens.
export function calendarUrlPreview(raw) {
  try {
    const url = new URL(String(raw));
    const tail = (url.pathname + url.search).replace(/[^A-Za-z0-9]/g, '').slice(-4);
    return `${url.hostname}/…${tail}`;
  } catch { return '…'; }
}

function unfold(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n[ \t]/g, '');
}

function unescapeText(value) {
  return String(value || '').replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
}

// "DTSTART;VALUE=DATE:20261121" → {name:'DTSTART', params:{VALUE:'DATE'}, value:'20261121'}
function parseLine(line) {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const head = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const [name, ...rawParams] = head.split(';');
  const params = {};
  for (const param of rawParams) {
    const eq = param.indexOf('=');
    if (eq > 0) params[param.slice(0, eq).toUpperCase()] = param.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value };
}

const bratislavaDate = (date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(date);

// An iCal date or date-time as a Europe/Bratislava calendar date "YYYY-MM-DD".
export function icalDate(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!match) return null;
  const [, y, m, d, hh, mm, ss, zulu] = match;
  if (zulu) return bratislavaDate(new Date(Date.UTC(+y, +m - 1, +d, +hh, +mm, +(ss || 0))));
  const iso = `${y}-${m}-${d}`;
  const check = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(check.getTime()) || check.toISOString().slice(0, 10) !== iso ? null : iso;
}

const addDays = (iso, days) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

// Airbnb marks owner-blocked dates "Airbnb (Not available)" and reservations "Reserved".
// Booking.com marks every unavailable range "CLOSED - Not available", reservation or not, so its
// events are all taken as stays and the owner can switch automatic cleanings off for it.
export function isBlockedEvent(summary, source) {
  const text = String(summary || '');
  if (source === 'AIRBNB') return /not available|blocked/i.test(text);
  if (source === 'BOOKING') return false;
  return /^(blocked|not available|unavailable)\b/i.test(text.trim());
}

// Reads an export into stays. today bounds the window: stays that ended more than 60 days ago or
// start more than 400 days ahead are ignored, which keeps a long history out of every sync.
export function parseIcal(text, { source = 'OTHER', today = bratislavaDate(new Date()) } = {}) {
  const body = unfold(text);
  if (!/BEGIN:VCALENDAR/i.test(body)) throw new Error('The link did not return a calendar');
  const events = [];
  let skipped = 0;
  let current = null;
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (/^BEGIN:VEVENT$/i.test(line)) { current = {}; continue; }
    if (/^END:VEVENT$/i.test(line)) {
      if (current) events.push(current);
      current = null;
      continue;
    }
    if (!current) continue;
    const prop = parseLine(line);
    if (!prop) continue;
    if (prop.name === 'DTSTART') current.start = icalDate(prop.value);
    else if (prop.name === 'DTEND') current.end = icalDate(prop.value);
    else if (prop.name === 'UID') current.uid = prop.value.trim();
    else if (prop.name === 'SUMMARY') current.summary = unescapeText(prop.value);
    else if (prop.name === 'STATUS') current.status = prop.value.trim().toUpperCase();
  }
  const from = addDays(today, -60);
  const until = addDays(today, 400);
  const byUid = new Map();
  for (const event of events) {
    if (!event.start || event.status === 'CANCELLED') { skipped++; continue; }
    const checkIn = event.start;
    const checkOut = event.end && event.end > checkIn ? event.end : addDays(checkIn, 1);
    if (isBlockedEvent(event.summary, source)) { skipped++; continue; }
    if (checkOut < from || checkIn > until) { skipped++; continue; }
    const uid = (event.uid || `${checkIn}/${checkOut}`).slice(0, 300);
    byUid.set(uid, { uid, checkIn, checkOut, summary: (event.summary || '').slice(0, 200) });
  }
  return { events: [...byUid.values()].sort((a, b) => a.checkIn.localeCompare(b.checkIn)), skipped };
}
