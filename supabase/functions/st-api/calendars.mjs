// Airbnb / Booking.com calendar links per property: connect, list, sync, and the scheduled worker.
import { calendarHostAllowed, calendarUrlPreview, parseIcal, validateCalendarUrl } from './ical.mjs';

const MAX_BYTES = 2 * 1024 * 1024;
const STAFF = new Set(['ADMIN', 'OPERATIONS_MANAGER']);
const CLIENT = new Set(['OWNER', 'PROPERTY_MANAGER']);

// Fetches an export link, following at most three redirects, each to an allowed host.
export async function fetchCalendar(rawUrl, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  let url = rawUrl;
  for (let hop = 0; hop < 4; hop++) {
    const response = await fetchImpl(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'User-Agent': 'ShineTime-calendar/1.0', Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.1' },
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const next = response.headers.get('location');
      if (!next) throw new Error('The calendar link redirected nowhere');
      const target = new URL(next, url);
      if (target.protocol !== 'https:' || !calendarHostAllowed(target.hostname)) throw new Error('The calendar link redirected to an unsupported address');
      url = target.toString();
      continue;
    }
    if (response.status === 404 || response.status === 403 || response.status === 410) {
      throw new Error('The calendar link no longer works. Copy a fresh export link from the platform');
    }
    if (!response.ok) throw new Error(`The calendar service answered ${response.status}. It will be retried`);
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_BYTES) throw new Error('The calendar is too large');
    const reader = response.body?.getReader();
    if (!reader) return await response.text();
    const chunks = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { await reader.cancel(); throw new Error('The calendar is too large'); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new TextDecoder().decode(bytes);
  }
  throw new Error('The calendar link redirected too many times');
}

// Fetch, parse and apply one calendar. Never throws for a feed problem: the error is recorded on
// the calendar so the owner sees it, and existing stays and cleanings are left alone.
export async function syncCalendar({ calendar, service, result, fetchImpl, today }) {
  let events;
  try {
    const text = await fetchCalendar(calendar.url, { fetchImpl });
    events = parseIcal(text, { source: calendar.source, today }).events;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const answer = await result(service.rpc('st_sync_calendar', { p_calendar_id: calendar.id, p_events: [], p_error: message.slice(0, 300) }));
    return { calendarId: calendar.id, ...(answer || {}), error: message };
  }
  const answer = await result(service.rpc('st_sync_calendar', { p_calendar_id: calendar.id, p_events: events }));
  return { calendarId: calendar.id, ...(answer || {}) };
}

const publicCalendar = (row) => ({
  id: row.id, object_id: row.object_id, source: row.source, urlPreview: calendarUrlPreview(row.url),
  auto_create: row.auto_create, last_synced_at: row.last_synced_at, last_status: row.last_status,
  last_error: row.last_error, last_summary: row.last_summary, created_at: row.created_at,
});

async function objectAccess({ ctx, objectId, service, result, ApiError, clientObject }) {
  const role = ctx.appUser.role;
  if (STAFF.has(role)) {
    const object = await result(service.from('st_objects').select('id,code,name').eq('id', objectId).maybeSingle());
    if (!object) throw new ApiError('Property not found', 404);
    return object;
  }
  if (CLIENT.has(role)) return clientObject(ctx, objectId);
  throw new ApiError('Forbidden', 403);
}

async function accessibleObjectIds({ ctx, service, result }) {
  const role = ctx.appUser.role;
  if (STAFF.has(role)) return null; // all properties
  if (role === 'OWNER') return ((await result(service.from('st_objects').select('id').eq('client_id', ctx.client?.id))) || []).map((row) => row.id);
  if (role === 'PROPERTY_MANAGER') return ((await result(service.from('st_manager_properties').select('object_id').eq('manager_client_id', ctx.client?.id))) || []).map((row) => row.object_id);
  return [];
}

async function staysWithJobs({ service, result, stays }) {
  const jobIds = [...new Set(stays.map((stay) => stay.job_id).filter(Boolean))];
  const objectIds = [...new Set(stays.map((stay) => stay.object_id))];
  const jobs = jobIds.length ? await result(service.from('st_jobs').select('id,status,service_date,earliest_start,deadline,assigned_cleaner_id').in('id', jobIds)) : [];
  const objects = objectIds.length ? await result(service.from('st_objects').select('id,code,name').in('id', objectIds)) : [];
  const calendars = stays.length ? await result(service.from('st_object_calendars').select('id,source').in('id', [...new Set(stays.map((stay) => stay.calendar_id))])) : [];
  const jobById = new Map(jobs.map((job) => [String(job.id), job]));
  const objectById = new Map(objects.map((object) => [String(object.id), object]));
  const sourceById = new Map(calendars.map((calendar) => [String(calendar.id), calendar.source]));
  return stays.map((stay) => {
    const job = stay.job_id ? jobById.get(String(stay.job_id)) : null;
    const object = objectById.get(String(stay.object_id));
    return {
      id: stay.id, object_id: stay.object_id, object_code: object?.code || '', object_name: object?.name || '',
      source: sourceById.get(String(stay.calendar_id)) || 'OTHER', check_in: stay.check_in, check_out: stay.check_out,
      status: stay.status, summary: stay.summary, last_error: stay.last_error,
      job: job ? { id: job.id, status: job.status, service_date: job.service_date, assigned: !!job.assigned_cleaner_id } : null,
    };
  });
}

const addDays = (iso, days) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

export async function calendarsRoute({ ctx, route, method, query, body, service, result, ApiError, clientObject, today, fetchImpl }) {
  const objectRoute = route.match(/^objects\/(\d+)\/calendars$/);
  const calendarRoute = route.match(/^calendars\/(\d+)(\/sync)?$/);
  if (!objectRoute && !calendarRoute && route !== 'stays') return null;
  const role = ctx.appUser.role;
  if (!STAFF.has(role) && !CLIENT.has(role)) throw new ApiError('Forbidden', 403);

  if (route === 'stays' && method === 'GET') {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(query.from || '')) ? String(query.from) : today();
    const to = /^\d{4}-\d{2}-\d{2}$/.test(String(query.to || '')) ? String(query.to) : addDays(from, 14);
    if (to < from || to > addDays(from, 120)) throw new ApiError('Choose a range of at most 120 days');
    const ids = await accessibleObjectIds({ ctx, service, result });
    if (ids && !ids.length) return { stays: [], from, to };
    let builder = service.from('st_stays').select('*').eq('status', 'ACTIVE').gte('check_out', from).lte('check_in', to).order('check_out').limit(500);
    if (query.objectId) builder = builder.eq('object_id', Number(query.objectId));
    if (ids) builder = builder.in('object_id', ids);
    if (query.objectId && ids && !ids.map(String).includes(String(query.objectId))) throw new ApiError('Forbidden', 403);
    return { stays: await staysWithJobs({ service, result, stays: (await result(builder)) || [] }), from, to };
  }

  if (objectRoute) {
    const objectId = Number(objectRoute[1]);
    await objectAccess({ ctx, objectId, service, result, ApiError, clientObject });
    if (method === 'GET') {
      const calendars = (await result(service.from('st_object_calendars').select('*').eq('object_id', objectId).eq('active', true).order('id'))) || [];
      const stays = (await result(service.from('st_stays').select('*').eq('object_id', objectId).eq('status', 'ACTIVE').gte('check_out', addDays(today(), -1)).order('check_out').limit(60))) || [];
      return { calendars: calendars.map(publicCalendar), stays: await staysWithJobs({ service, result, stays }) };
    }
    if (method === 'POST') {
      let checked;
      try { checked = validateCalendarUrl(body.url); } catch (error) { throw new ApiError(error.message); }
      const source = ['AIRBNB', 'BOOKING', 'OTHER'].includes(String(body.source)) ? String(body.source) : checked.source;
      const count = (await result(service.from('st_object_calendars').select('id').eq('object_id', objectId).eq('active', true))) || [];
      if (count.length >= 5) throw new ApiError('A property can have at most five calendars');
      const existing = await result(service.from('st_object_calendars').select('id').eq('object_id', objectId).eq('url', checked.url).eq('active', true).maybeSingle());
      if (existing) throw new ApiError('This calendar is already connected');
      const calendar = await result(service.from('st_object_calendars').insert({
        object_id: objectId, source, url: checked.url, auto_create: body.autoCreate !== false, created_by_user_id: ctx.appUser.id,
      }).select('*').single());
      const sync = await syncCalendar({ calendar, service, result, fetchImpl, today: today() });
      const fresh = await result(service.from('st_object_calendars').select('*').eq('id', calendar.id).single());
      return { calendar: publicCalendar(fresh), sync };
    }
    throw new ApiError('Route not found', 404);
  }

  const id = Number(calendarRoute[1]);
  const calendar = await result(service.from('st_object_calendars').select('*').eq('id', id).eq('active', true).maybeSingle());
  if (!calendar) throw new ApiError('Calendar not found', 404);
  await objectAccess({ ctx, objectId: calendar.object_id, service, result, ApiError, clientObject });
  if (calendarRoute[2] && method === 'POST') {
    // A manual refresh is cheap for us but not for the platforms: once a minute is enough.
    if (calendar.last_synced_at && Date.now() - Date.parse(calendar.last_synced_at) < 60000) {
      return { calendar: publicCalendar(calendar), sync: { skipped: true } };
    }
    const sync = await syncCalendar({ calendar, service, result, fetchImpl, today: today() });
    const fresh = await result(service.from('st_object_calendars').select('*').eq('id', id).single());
    return { calendar: publicCalendar(fresh), sync };
  }
  if (!calendarRoute[2] && method === 'PATCH') {
    if (typeof body.autoCreate !== 'boolean') throw new ApiError('Nothing to change');
    const fresh = await result(service.from('st_object_calendars').update({ auto_create: body.autoCreate }).eq('id', id).select('*').single());
    return { calendar: publicCalendar(fresh) };
  }
  if (!calendarRoute[2] && method === 'DELETE') {
    // Disconnecting stops future syncs; cleanings already booked stay as they are.
    await result(service.from('st_object_calendars').update({ active: false }).eq('id', id));
    return { ok: true };
  }
  throw new ApiError('Route not found', 404);
}

// Scheduled worker: syncs calendars not refreshed in the last 25 minutes, oldest first.
export async function drainCalendars({ service, result, fetchImpl, today, limit = 20 }) {
  const cutoff = new Date(Date.now() - 25 * 60000).toISOString();
  const due = (await result(service.from('st_object_calendars').select('*').eq('active', true)
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`).order('last_synced_at', { ascending: true, nullsFirst: true }).limit(limit))) || [];
  const results = [];
  for (const calendar of due) {
    try { results.push(await syncCalendar({ calendar, service, result, fetchImpl, today: today() })); }
    catch (error) { results.push({ calendarId: calendar.id, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { synced: results.length, failed: results.filter((item) => item.error).length, results };
}
