import test from 'node:test';
import assert from 'node:assert/strict';
import { parseIcal, icalDate, validateCalendarUrl, calendarUrlPreview, calendarHostAllowed, isBlockedEvent } from '../supabase/functions/st-api/ical.mjs';
import { fetchCalendar } from '../supabase/functions/st-api/calendars.mjs';

const TODAY = '2026-11-20';
const airbnb = [
  'BEGIN:VCALENDAR', 'PRODID;X-RICAL-TZSOURCE=TZINFO:-//Airbnb Inc//Hosting Calendar 0.8.8//EN', 'VERSION:2.0',
  'BEGIN:VEVENT', 'DTEND;VALUE=DATE:20261124', 'DTSTART;VALUE=DATE:20261121', 'UID:1418fb94e984-abc@airbnb.com',
  'DESCRIPTION:Reservation URL: https://www.airbnb.com/hosting/reservations/details/HMABCDEF\\nPhone Number (Last 4 Dig', ' its): 1234', 'SUMMARY:Reserved', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTEND;VALUE=DATE:20261202', 'DTSTART;VALUE=DATE:20261128', 'UID:blocked-1@airbnb.com', 'SUMMARY:Airbnb (Not available)', 'END:VEVENT',
  'BEGIN:VEVENT', 'DTEND;VALUE=DATE:20250101', 'DTSTART;VALUE=DATE:20241228', 'UID:old@airbnb.com', 'SUMMARY:Reserved', 'END:VEVENT',
  'END:VCALENDAR', '',
].join('\r\n');

test('Airbnb export: reservations become stays, blocked dates and old stays are skipped', () => {
  const { events, skipped } = parseIcal(airbnb, { source: 'AIRBNB', today: TODAY });
  assert.deepEqual(events, [{ uid: '1418fb94e984-abc@airbnb.com', checkIn: '2026-11-21', checkOut: '2026-11-24', summary: 'Reserved' }]);
  assert.equal(skipped, 2);
});

test('Booking.com export: every closed range is a stay, folded lines and missing DTEND are handled', () => {
  const booking = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//admin.booking.com//EN',
    'BEGIN:VEVENT', 'UID:b1@booking.com', 'DTSTART;VALUE=DATE:20261125', 'DTEND;VALUE=DATE:20261127', 'SUMMARY:CLOSED - Not avai', ' lable', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:b2@booking.com', 'DTSTART;VALUE=DATE:20261130', 'SUMMARY:CLOSED - Not available', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:b3@booking.com', 'DTSTART;VALUE=DATE:20261201', 'DTEND;VALUE=DATE:20261203', 'STATUS:CANCELLED', 'END:VEVENT',
    'END:VCALENDAR'].join('\n');
  const { events } = parseIcal(booking, { source: 'BOOKING', today: TODAY });
  assert.deepEqual(events.map((e) => [e.uid, e.checkIn, e.checkOut]), [['b1@booking.com', '2026-11-25', '2026-11-27'], ['b2@booking.com', '2026-11-30', '2026-12-01']]);
  assert.equal(events[0].summary, 'CLOSED - Not available');
});

test('dates: all-day, local and UTC times map to the Bratislava calendar date', () => {
  assert.equal(icalDate('20261121'), '2026-11-21');
  assert.equal(icalDate('20261121T100000'), '2026-11-21');
  assert.equal(icalDate('20261120T233000Z'), '2026-11-21', 'UTC 23:30 is already the next day in Bratislava');
  assert.equal(icalDate('20260230'), null);
  assert.equal(icalDate('garbage'), null);
});

test('a page that is not a calendar is refused', () => {
  assert.throws(() => parseIcal('<html>login</html>', { today: TODAY }), /did not return a calendar/);
});

test('blocked-date rules per platform', () => {
  assert.equal(isBlockedEvent('Airbnb (Not available)', 'AIRBNB'), true);
  assert.equal(isBlockedEvent('Reserved', 'AIRBNB'), false);
  assert.equal(isBlockedEvent('CLOSED - Not available', 'BOOKING'), false);
  assert.equal(isBlockedEvent('Blocked', 'OTHER'), true);
});

test('only https links to calendar platforms are accepted', () => {
  assert.deepEqual(validateCalendarUrl('https://www.airbnb.com/calendar/ical/123.ics?s=abc'), { url: 'https://www.airbnb.com/calendar/ical/123.ics?s=abc', source: 'AIRBNB' });
  assert.equal(validateCalendarUrl('https://ical.booking.com/v1/export?t=abc').source, 'BOOKING');
  assert.equal(validateCalendarUrl('webcal://www.airbnb.sk/calendar/ical/1.ics').url, 'https://www.airbnb.sk/calendar/ical/1.ics');
  for (const bad of ['http://www.airbnb.com/calendar/ical/1.ics', 'https://localhost/x.ics', 'https://169.254.169.254/latest', 'https://evil.example/airbnb.com.ics',
    'https://airbnb.com.evil.example/x', 'https://user:pw@www.airbnb.com/x', 'https://www.airbnb.com:8443/x', 'ftp://booking.com/x', '']) {
    assert.throws(() => validateCalendarUrl(bad), Error, bad);
  }
  assert.equal(calendarHostAllowed('notairbnb.com'), false);
});

test('the link preview never shows the private token', () => {
  const preview = calendarUrlPreview('https://www.airbnb.com/calendar/ical/123.ics?s=secrettoken9f3a');
  assert.equal(preview, 'www.airbnb.com/…9f3a');
  assert.ok(!preview.includes('secrettoken'));
});

test('fetching follows redirects only to allowed hosts', async () => {
  const response = (status, headers = {}, text = '') => ({ status, ok: status >= 200 && status < 300, headers: new Headers(headers), body: null, text: async () => text });
  const hops = [];
  const ok = async (url) => { hops.push(url); return hops.length === 1 ? response(302, { location: 'https://calendar.airbnb.com/next.ics' }) : response(200, {}, 'BEGIN:VCALENDAR\nEND:VCALENDAR'); };
  assert.match(await fetchCalendar('https://www.airbnb.com/a.ics', { fetchImpl: ok }), /VCALENDAR/);
  assert.deepEqual(hops, ['https://www.airbnb.com/a.ics', 'https://calendar.airbnb.com/next.ics']);
  const evil = async () => response(302, { location: 'http://169.254.169.254/' });
  await assert.rejects(fetchCalendar('https://www.airbnb.com/a.ics', { fetchImpl: evil }), /unsupported address/);
  await assert.rejects(fetchCalendar('https://www.airbnb.com/a.ics', { fetchImpl: async () => response(404) }), /no longer works/);
});
