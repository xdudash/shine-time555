import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { activeAssignmentStatuses, availableBookingSlots, cleanerEarningsSummary, clientAccountRows, coordinatesForStorage, financeBoardReport, marketplaceForCleaner, riskForJob, roleCapabilities, settingsFromRows } from './logic.mjs';
import { marketplaceJobs, projectResponse } from './security.mjs';
import { operationsRoute } from './operations.mjs';
import { validatePhoto, validateMedia } from './media.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const PUBLIC_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '';
const MEDIA_BUCKET = 'st-cleaning-media';
const APP_BUILD = '2026-09-07-scale1';
const COMPATIBLE_BUILDS = new Set([APP_BUILD, '2026-09-01-r1']);
const service = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type AnyRow = Record<string, any>;

class ApiError extends Error {
  constructor(message: string, readonly status = 400, readonly extra: AnyRow = {}) { super(message); }
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...cors, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bratislava' }).format(new Date());
const currentTime = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Bratislava', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
const toMinutes = (value: string | null | undefined) => {
  const [hours, minutes] = String(value || '00:00').slice(0, 5).split(':').map(Number);
  return hours * 60 + minutes;
};
const toTime = (value: number) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
const same = (a: unknown, b: unknown) => String(a ?? '') === String(b ?? '');
const unique = <T>(values: T[]) => [...new Set(values)];
const number = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const truthy = (value: unknown) => value === true || value === 1 || value === '1' || value === 'true';
const validLanguage = (value: unknown) => ['ru', 'sk', 'uk', 'en'].includes(String(value)) ? String(value) : 'ru';
const normalizedEmail = (value: unknown) => String(value || '').trim().toLowerCase();
const validEmail = (value: unknown) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail(value));
const code = () => `ST-${new Date().getFullYear()}-${crypto.randomUUID().replaceAll('-', '').slice(0, 6).toUpperCase()}`;
function monthEnd(month: string) {
  const next = new Date(`${month}-01T12:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  next.setUTCDate(0);
  return next.toISOString().slice(0, 10);
}
const objectCoordinates = (lat: unknown, lng: unknown) => {
  try { return coordinatesForStorage({ lat, lng }); }
  catch (error) { throw new ApiError(error instanceof Error ? error.message : 'Invalid coordinates'); }
};

async function result<T>(query: PromiseLike<{ data: T; error: any }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new ApiError(error.message, Number(error.code) === 23505 ? 409 : 400);
  return data;
}

async function one<T>(query: PromiseLike<{ data: T; error: any }>): Promise<T> {
  return result(query);
}

async function settings() {
  const rows = await result(service.from('st_settings').select('setting_key,value_json')) as AnyRow[];
  return {
    windowStart: '10:00', windowEnd: '15:00', travelBuffer: 15, sameZoneTravelBuffer: 10, safetyBuffer: 10,
    rescueStart: '13:30', surge2Start: '11:30', surge4Start: '12:30', surge6Start: '13:30',
    checkinRadiusMeters: 250, reserveTargetPct: 20, cleanerCancellationCutoffMinutes: 90,
    companyName: 'Shine Time Operations', timezone: 'Europe/Bratislava', clientBookingStepMinutes: 30,
    clientCancellationCutoffHours: 12, defaultLanguage: 'ru', ...settingsFromRows(rows),
  };
}

async function authOnly(req: Request) {
  const authorization = req.headers.get('authorization') || '';
  if (!authorization.toLowerCase().startsWith('bearer ')) throw new ApiError('Authentication required', 401);
  const client = createClient(SUPABASE_URL, PUBLIC_KEY, {
    auth: { persistSession: false }, global: { headers: { Authorization: authorization } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new ApiError('Authentication required', 401);
  return { authUser: data.user, userClient: client };
}

async function context(req: Request) {
  const identity = await authOnly(req);
  const { data: appUser, error } = await service.from('st_users').select('*').eq('auth_user_id', identity.authUser.id).maybeSingle();
  if (error) throw new ApiError(error.message, 400);
  if (!appUser || !appUser.active) throw new ApiError('This account is not activated by Operations', 403);
  const [cleaner, client] = await Promise.all([
    appUser.role === 'CLEANER' ? result(service.from('st_cleaners').select('*').eq('user_id', appUser.id).maybeSingle()) : null,
    ['OWNER', 'PROPERTY_MANAGER'].includes(appUser.role) ? result(service.from('st_client_accounts').select('*').eq('user_id', appUser.id).maybeSingle()) : null,
  ]);
  return { ...identity, appUser, cleaner, client };
}

function requireRole(ctx: any, roles: string | string[]) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  if (!allowed.includes(ctx.appUser.role)) throw new ApiError('Forbidden', 403);
}

async function publicUser(ctx: any) {
  return {
    id: ctx.appUser.id,
    email: ctx.appUser.email,
    role: ctx.appUser.role,
    full_name: ctx.appUser.full_name,
    phone: ctx.appUser.phone || '',
    language: ctx.appUser.language,
    cleaner_id: ctx.cleaner?.id ?? null,
    cleaner_mode: ctx.cleaner?.mode ?? null,
    reliability_score: ctx.cleaner?.reliability_score ?? null,
    rating: ctx.cleaner?.rating ?? null,
    transport: ctx.cleaner?.transport ?? null,
    preferred_zones: ctx.cleaner?.preferred_zones ?? [],
    max_jobs_day: ctx.cleaner?.max_jobs_day ?? null,
    client_id: ctx.client?.id ?? null,
    client_account_type: ctx.client?.account_type ?? null,
    company_name: ctx.client?.company_name ?? null,
    billing_name: ctx.client?.billing_name ?? null,
  };
}

async function insertEvent(jobId: number | null, userId: number | null, eventType: string, payload: AnyRow = {}) {
  await result(service.from('st_job_events').insert({ job_id: jobId, user_id: userId, event_type: eventType, payload_json: payload }));
}

async function jobCommand(ctx: any, jobId: number, action: string, body: AnyRow = {}) {
  const appSettings = await settings();
  const commandBody = {
    ...body,
    nowTime: body.nowTime ?? currentTime(),
    safetyBuffer: number(appSettings.safetyBuffer, 10),
    travelBuffer: number(appSettings.travelBuffer, 15),
  };
  const { data, error } = await service.rpc('st_job_command', {
    p_actor_id: ctx.appUser.id,
    p_job_id: jobId,
    p_action: action,
    p_body: commandBody,
    p_request_id: String(body.requestId || crypto.randomUUID()),
  }).single();
  if (error) {
    const denied = /forbidden|assigned to you|only a cleaner|actor is not active/i.test(error.message);
    throw new ApiError(error.message, denied ? 403 : 409);
  }
  return data as AnyRow;
}

async function notify(userId: number, type: string, title: string, message: string) {
  await result(service.from('st_notifications').insert({ user_id: userId, type, title, message }));
}

async function fetchRows(table: string, ids: unknown[], columns = '*') {
  const values = unique(ids.filter((id) => id !== null && id !== undefined));
  if (!values.length) return [] as AnyRow[];
  return result(service.from(table).select(columns).in('id', values)) as Promise<AnyRow[]>;
}

async function hydrateJobs(input: AnyRow[]) {
  if (!input.length) return [];
  const [objects, cleaners, clients] = await Promise.all([
    fetchRows('st_objects', input.map((job) => job.object_id)),
    fetchRows('st_cleaners', input.map((job) => job.assigned_cleaner_id)),
    fetchRows('st_client_accounts', input.map((job) => job.client_id)),
  ]);
  const users = await fetchRows('st_users', [
    ...cleaners.map((item) => item.user_id),
    ...clients.map((item) => item.user_id),
  ]);
  const objectById = new Map(objects.map((item) => [String(item.id), item]));
  const cleanerById = new Map(cleaners.map((item) => [String(item.id), item]));
  const clientById = new Map(clients.map((item) => [String(item.id), item]));
  const userById = new Map(users.map((item) => [String(item.id), item]));
  const now = currentTime();
  return input.map((job) => {
    const object = objectById.get(String(job.object_id)) || {};
    const cleaner = cleanerById.get(String(job.assigned_cleaner_id));
    const client = clientById.get(String(job.client_id));
    const risk = riskForJob(job, job.service_date===today()?now:'00:00');
    return {
      ...job,
      ...risk,
      risk_score:risk.score,risk_level:risk.level,risk_reasons:risk.reasons,
      object_code: object.code,
      object_name: object.name,
      address: object.address,
      zone: object.zone,
      lat: object.lat,
      lng: object.lng,
      apartment_type: object.apartment_type,
      bedrooms: object.bedrooms,
      bathrooms: object.bathrooms,
      access_instructions: object.access_instructions,
      key_instructions: object.key_instructions,
      parking: object.parking,
      linen_location: object.linen_location,
      supplies_location: object.supplies_location,
      wifi: object.wifi,
      object_notes: object.notes,
      object_client_price: object.client_price,
      cleaner_name: cleaner ? userById.get(String(cleaner.user_id))?.full_name : null,
      cleaner_phone: cleaner ? userById.get(String(cleaner.user_id))?.phone : null,
      cleaner_mode: cleaner?.mode ?? null,
      cleaner_reliability: cleaner?.reliability_score ?? null,
      client_company: client?.company_name ?? null,
      client_name: client ? userById.get(String(client.user_id))?.full_name : null,
    };
  });
}

async function getJob(id: number) {
  return one(service.from('st_jobs').select('*').eq('id', id).single()) as Promise<AnyRow>;
}

async function jobFor(ctx: any, id: number) {
  const job = await getJob(id);
  if (ctx.appUser.role === 'CLEANER' && !same(job.assigned_cleaner_id, ctx.cleaner?.id)) throw new ApiError('This job is not assigned to you', 403);
  if (ctx.appUser.role === 'OWNER' && !same(job.client_id, ctx.client?.id)) throw new ApiError('Forbidden', 403);
  if (ctx.appUser.role === 'PROPERTY_MANAGER') {
    const link = await result(service.from('st_manager_properties').select('id').eq('manager_client_id', ctx.client?.id).eq('object_id', job.object_id).limit(1)) as AnyRow[];
    if (!link.length) throw new ApiError('Forbidden', 403);
  }
  return job;
}

async function jobDetails(ctx: any, id: number) {
  const job = await jobFor(ctx, id);
  const [full] = await hydrateJobs([job]);
  const [checklist, photos, issues, events] = await Promise.all([
    result(service.from('st_job_checklist').select('*').eq('job_id', id).order('sort_order').order('id')) as Promise<AnyRow[]>,
    result(service.from('st_job_photos').select('*').eq('job_id', id).order('created_at')) as Promise<AnyRow[]>,
    result(service.from('st_issues').select('*').eq('job_id', id).order('created_at', { ascending: false })) as Promise<AnyRow[]>,
    result(service.from('st_job_events').select('*').eq('job_id', id).order('id', { ascending: false }).limit(100)) as Promise<AnyRow[]>,
  ]);
  const actors = await fetchRows('st_users', events.map((event) => event.user_id));
  const actorById = new Map(actors.map((actor) => [String(actor.id), actor]));
  const photoUrls = await Promise.all(photos.map(async (photo) => {
    const signed = await result(service.storage.from(MEDIA_BUCKET).createSignedUrl(photo.storage_path, 3600));
    return { ...photo, url: signed.signedUrl };
  }));
  return {
    ...full,
    checklist,
    photos: photoUrls,
    issues: issues.map((issue) => ({ ...issue, photos: issue.photos_json || [] })),
    events: events.map((event) => ({ ...event, payload: event.payload_json || {}, actor_name: actorById.get(String(event.user_id))?.full_name || null })),
  };
}

async function activeCleaners(date: string) {
  const [cleaners, availability, users] = await Promise.all([
    result(service.from('st_cleaners').select('*').eq('active', true)) as Promise<AnyRow[]>,
    result(service.from('st_cleaner_availability').select('*').eq('service_date', date)) as Promise<AnyRow[]>,
    result(service.from('st_users').select('*').eq('active', true)) as Promise<AnyRow[]>,
  ]);
  const availabilityByCleaner = new Map(availability.map((item) => [String(item.cleaner_id), item]));
  const userById = new Map(users.map((item) => [String(item.id), item]));
  return cleaners.filter((item) => userById.has(String(item.user_id))).map((item) => {
    const row = availabilityByCleaner.get(String(item.id));
    return {
      ...item,
      ...userById.get(String(item.user_id)),
      preferred_zones: item.preferred_zones || [],
      available: row ? Boolean(row.online) : false,
      availability: { online: Boolean(row?.online), fromTime: String(row?.from_time || '10:00').slice(0, 5), toTime: String(row?.to_time || '15:00').slice(0, 5) },
    };
  });
}

function capacity(cleaners: AnyRow[], jobs: AnyRow[], appSettings: AnyRow) {
  const online = cleaners.filter((cleaner) => cleaner.available);
  const capacityMinutes = online.reduce((sum, cleaner) => sum + Math.max(0, toMinutes(cleaner.availability.toTime) - toMinutes(cleaner.availability.fromTime)), 0);
  const demandMinutes = jobs.filter((job) => job.status !== 'CANCELLED').reduce((sum, job) => sum + number(job.duration_minutes) + number(appSettings.safetyBuffer, 10), 0);
  const reservePct = capacityMinutes ? Math.round(((capacityMinutes - demandMinutes) / capacityMinutes) * 100) : (demandMinutes ? -100 : 100);
  return { cleaners: online.length, capacityMinutes, demandMinutes, reservePct, health: reservePct < 0 ? 'RED' : reservePct < number(appSettings.reserveTargetPct, 20) ? 'ORANGE' : 'GREEN' };
}

async function reschedule(cleanerId: number, date: string, appSettings: AnyRow) {
  const jobs = await result(service.from('st_jobs').select('*').eq('assigned_cleaner_id', cleanerId).eq('service_date', date).in('status', activeAssignmentStatuses).order('planned_start').order('earliest_start')) as AnyRow[];
  const availabilityRows = await result(service.from('st_cleaner_availability').select('*').eq('cleaner_id', cleanerId).eq('service_date', date).limit(1)) as AnyRow[];
  const availability = availabilityRows[0] ?? null;
  let cursor = toMinutes(availability?.from_time || appSettings.windowStart || '10:00');
  for (const job of jobs) {
    cursor = Math.max(cursor, toMinutes(job.earliest_start));
    const finish = cursor + number(job.duration_minutes) + number(appSettings.safetyBuffer, 10);
    await result(service.from('st_jobs').update({ planned_start: toTime(cursor), eta: toTime(finish) }).eq('id', job.id));
    cursor = finish + number(appSettings.travelBuffer, 15);
  }
}

const baseChecklist = [
  ['Remove old linen', true, false, null], ['Make beds', true, true, 'Bedroom'], ['Bathroom', true, true, 'Bathroom'], ['Toilet', true, false, null],
  ['Kitchen', true, true, 'Kitchen'], ['Check refrigerator', true, false, null], ['Take out trash', true, false, null], ['Vacuum', true, false, null],
  ['Mop floor', true, false, null], ['Fresh towels', true, false, null], ['Toilet paper', true, false, null], ['Soap / amenities', true, false, null],
  ['Check windows', true, false, null], ['Lights off', true, false, null], ['Final living-area photo', true, true, 'Living area'], ['Final walkthrough', true, false, null],
];

async function ensureJobChecklist(jobId: number, objectId: number) {
  const existing = await result(service.from('st_job_checklist').select('id').eq('job_id', jobId).limit(1)) as AnyRow[];
  if (existing.length) return;
  let items = await result(service.from('st_checklist_items').select('*').eq('object_id', objectId).order('sort_order').order('id')) as AnyRow[];
  if (!items.length) {
    items = await result(service.from('st_checklist_items').insert(baseChecklist.map(([label, required, photoRequired, photoCategory], index) => ({
      object_id: objectId, label, required, photo_required: photoRequired, photo_category: photoCategory, sort_order: index + 1,
    }))).select()) as AnyRow[];
  }
  await result(service.from('st_job_checklist').insert(items.map((item, index) => ({
    job_id: jobId, checklist_item_id: item.id, label: item.label, required: item.required, photo_required: item.photo_required,
    photo_category: item.photo_category, sort_order: item.sort_order ?? index + 1,
  }))));
}

async function createJob(ctx: any, body: AnyRow) {
  return one(service.rpc('st_create_job',{p_actor_id:ctx.appUser.id,p_body:body}).single()) as Promise<AnyRow>;
}

async function routeCleaner(ctx: any, route: string, method: string, query: AnyRow, body: AnyRow) {
  requireRole(ctx, 'CLEANER');
  const cleanerId = ctx.cleaner?.id;
  if (!cleanerId) throw new ApiError('Cleaner account is not configured', 403);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date || '')) ? String(query.date) : today();
  if (route === 'cleaner/dashboard' && method === 'GET') {
    const [availability, raw] = await Promise.all([
      result(service.from('st_cleaner_availability').select('*').eq('cleaner_id', cleanerId).eq('service_date', date).maybeSingle()) as Promise<AnyRow | null>,
      result(service.from('st_jobs').select('*').eq('assigned_cleaner_id', cleanerId).eq('service_date', date).neq('status', 'CANCELLED').order('planned_start')) as Promise<AnyRow[]>,
    ]);
    const jobs = await hydrateJobs(raw);
    const completed = jobs.filter((job) => job.status === 'COMPLETED');
    const nextJob = jobs.find((job) => !['COMPLETED', 'CANCELLED'].includes(job.status)) || null;
    return { date, availability: { online: Boolean(availability?.online), fromTime: String(availability?.from_time || '10:00').slice(0, 5), toTime: String(availability?.to_time || '15:00').slice(0, 5) }, jobs, nextJob, projectedFinish: jobs.at(-1)?.eta ?? null, earnings: completed.reduce((sum, job) => sum + number(job.payout) + number(job.bonus), 0), completed: completed.length, total: jobs.length };
  }
  if (route === 'cleaner/availability' && method === 'PATCH') {
    const serviceDate = String(body.date || date);
    const from = String(body.fromTime || '10:00');
    const to = String(body.toTime || '15:00');
    if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(from) || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(to) || toMinutes(from) >= toMinutes(to)) throw new ApiError('Availability must be a valid time range');
    await result(service.from('st_cleaner_availability').upsert({ cleaner_id: cleanerId, service_date: serviceDate, online: truthy(body.online), from_time: from, to_time: to }, { onConflict: 'cleaner_id,service_date' }));
    if (body.lat !== undefined && body.lng !== undefined) await result(service.from('st_cleaners').update({ last_lat: number(body.lat), last_lng: number(body.lng), last_location_at: new Date().toISOString() }).eq('id', cleanerId));
    return { availability: { online: truthy(body.online), fromTime: from, toTime: to, date: serviceDate } };
  }
  if (route === 'cleaner/marketplace' && method === 'GET') {
    const [rows, availabilityRows, assignedJobs, appSettings] = await Promise.all([
      result(service.from('st_jobs').select('*').eq('service_date', date).eq('marketplace_visible', true).in('status', ['UNASSIGNED', 'AT_RISK', 'RESCUE']).order('planned_start')) as Promise<AnyRow[]>,
      result(service.from('st_cleaner_availability').select('*').eq('cleaner_id', cleanerId).eq('service_date', date).limit(1)) as Promise<AnyRow[]>,
      result(service.from('st_jobs').select('*').eq('assigned_cleaner_id', cleanerId).eq('service_date', date).neq('status', 'CANCELLED').order('planned_start')) as Promise<AnyRow[]>,
      settings(),
    ]);
    const marketplace = marketplaceForCleaner({
      cleaner: ctx.cleaner,
      availability: availabilityRows[0] || { online: false },
      assignedJobs,
      jobs: await hydrateJobs(rows),
      settings: appSettings,
      now: date === today() ? currentTime() : '00:00',
    });
    return { date, ...marketplace, jobs: marketplaceJobs(marketplace.jobs) };
  }
  if (route === 'cleaner/earnings' && method === 'GET') {
    const rows = await result(service.from('st_jobs').select('*').eq('assigned_cleaner_id', cleanerId).neq('status', 'CANCELLED').order('service_date', { ascending: false })) as AnyRow[];
    const completed = rows.filter((job) => job.status === 'COMPLETED');
    return { jobs: await hydrateJobs(completed), ...cleanerEarningsSummary({ jobs: rows, date: today() }) };
  }
  const match = route.match(/^cleaner\/jobs\/(\d+)(?:\/(accept|status|checklist\/(\d+)|photos(?:\/(?:prepare|finalize))?|issues|complete|cancel))?$/);
  if (!match) throw new ApiError('Route not found', 404);
  const jobId = number(match[1]);
  const action = match[2] || '';
  if (!action && method === 'GET') return jobDetails(ctx, jobId);
  if (action === 'accept' && method === 'POST') {
    const offered = await getJob(jobId);
    const job = await jobCommand(ctx, jobId, 'accept', { ...body, nowTime: offered.service_date === today() ? currentTime() : '00:00' });
    await jobFor(ctx, jobId); // Recheck access before hydrating a replayed snapshot.
    return { job: (await hydrateJobs([job]))[0] };
  }
  if (action === 'cancel' && method === 'POST') {
    await jobCommand(ctx, jobId, 'cancel', body);
    return { ok: true };
  }
  const job = await jobFor(ctx, jobId);
  if (action === 'status' && method === 'POST') {
    return { job: (await hydrateJobs([await jobCommand(ctx, jobId, 'status', body)]))[0] };
  }
  if (action.startsWith('checklist/') && method === 'PATCH') {
    if (['COMPLETED', 'CANCELLED'].includes(job.status)) throw new ApiError('Completed or cancelled jobs cannot be changed', 409);
    const itemId = number(match[3]);
    if (typeof body.completed !== 'boolean') throw new ApiError('Completed must be boolean');
    await result(service.rpc('st_update_job_checklist', {p_actor_id:ctx.appUser.id,p_job_id:jobId,p_item_id:itemId,p_completed:body.completed}));
    return { ok: true };
  }
  if (action === 'photos/prepare' && method === 'POST') {
    if (['COMPLETED','CANCELLED'].includes(job.status)) throw new ApiError('Terminal job cannot be changed',409);
    const extensions = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','video/mp4':'mp4','video/webm':'webm'};
    const extension = extensions[String(body.mime)];
    if (!extension || !Number.isSafeInteger(body.fileSize) || body.fileSize<1 || body.fileSize>(String(body.mime).startsWith('video/')?52428800:5242880)) throw new ApiError('Invalid photo format or size');
    const id=crypto.randomUUID(), path=`${jobId}/${id}.${extension}`;
    await result(service.from('st_upload_tickets').insert({id,actor_id:ctx.appUser.id,job_id:jobId,category:String(body.category||'Proof'),storage_path:path,file_name:String(body.fileName||`photo.${extension}`).slice(0,255),mime:body.mime,file_size:body.fileSize}));
    const signed=await result(service.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path));
    return {uploadId:id,path,token:signed.token,bucket:MEDIA_BUCKET};
  }
  if (action === 'photos/finalize' && method === 'POST') {
    const ticket=await result(service.from('st_upload_tickets').select('*').eq('id',String(body.uploadId)).eq('actor_id',ctx.appUser.id).eq('job_id',jobId).single());
    if(!ticket.photo_id) {
      if(Date.parse(ticket.expires_at)<Date.now())throw new ApiError('Upload expired',409);
      const file=await result(service.storage.from(MEDIA_BUCKET).download(ticket.storage_path));
      if(file.size!==Number(ticket.file_size))throw new ApiError('Uploaded file size does not match');
      try{validateMedia(new Uint8Array(await file.arrayBuffer()),ticket.mime)}catch(error){throw new ApiError(error.message)}
    }
    const photo=await result(service.rpc('st_finalize_upload',{p_actor_id:ctx.appUser.id,p_ticket:ticket.id}).single());
    const signed=await result(service.storage.from(MEDIA_BUCKET).createSignedUrl(photo.storage_path,3600));
    return {photo:{...photo,url:signed.signedUrl}};
  }
  if (action === 'photos' && method === 'POST') {
    if (['COMPLETED', 'CANCELLED'].includes(job.status)) throw new ApiError('Completed or cancelled jobs cannot be changed', 409);
    const dataUrl = String(body.dataBase64 || '');
    const encoded = dataUrl.includes(',') ? dataUrl.split(',', 2)[1] : dataUrl;
    if (!encoded) throw new ApiError('Photo data is required');
    if (encoded.length > 7 * 1024 * 1024) throw new ApiError('Photo is too large', 413);
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0)); }
    catch { throw new ApiError('Invalid photo encoding'); }
    const mime = String(body.mime || 'image/jpeg');
    let extension: string;
    try { extension = validatePhoto(bytes, mime); }
    catch (error) { throw new ApiError(error.message); }
    const path = `${jobId}/${crypto.randomUUID()}.${extension}`;
    await result(service.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: mime, upsert: false }));
    let photo: AnyRow;
    try {
      photo = await result(service.rpc('st_record_job_photo', {p_actor_id:ctx.appUser.id,p_job_id:jobId,p_category:String(body.category || 'Proof'),p_path:path,p_name:String(body.fileName || `photo.${extension}`),p_mime:mime,p_size:bytes.length}).single());
    } catch (error) {
      // Do not delete here: a lost RPC response can follow a committed insert.
      // Unreferenced objects require a separate retention-aware cleanup job.
      throw error;
    }
    const signed = await result(service.storage.from(MEDIA_BUCKET).createSignedUrl(path, 3600));
    return { photo: { ...photo, url: signed.signedUrl } };
  }
  if (action === 'issues' && method === 'POST') {
    const issue = await one(service.from('st_issues').insert({ job_id: jobId, cleaner_id: cleanerId, type: String(body.type || 'OTHER'), description: String(body.description || ''), priority: String(body.priority || 'HIGH') }).select().single()) as AnyRow;
    await result(service.from('st_jobs').update({ issue_flag: true }).eq('id', jobId));
    await insertEvent(jobId, ctx.appUser.id, 'ISSUE_REPORTED', { issueId: issue.id });
    const admins = await result(service.from('st_users').select('id').eq('role', 'ADMIN').eq('active', true)) as AnyRow[];
    await Promise.all(admins.map((admin) => notify(admin.id, 'ISSUE', 'New cleaning issue', `${job.object_id} · ${issue.type}`)));
    return { issue };
  }
  if (action === 'complete' && method === 'POST') {
    // The transactional command validates proof and returns the stored result on retry.
    return { job: (await hydrateJobs([await jobCommand(ctx, jobId, 'complete', body)]))[0] };
  }
  throw new ApiError('Route not found', 404);
}

async function clientObject(ctx: any, id: number) {
  const object = await one(service.from('st_objects').select('*').eq('id', id).single()) as AnyRow;
  if (ctx.appUser.role === 'OWNER' && !same(object.client_id, ctx.client?.id)) throw new ApiError('Forbidden', 403);
  if (ctx.appUser.role === 'PROPERTY_MANAGER') {
    const link = await result(service.from('st_manager_properties').select('id').eq('manager_client_id', ctx.client?.id).eq('object_id', id).maybeSingle()) as AnyRow | null;
    if (!link) throw new ApiError('Forbidden', 403);
  }
  return object;
}

async function clientPortfolioObjects(ctx: any) {
  if (ctx.appUser.role === 'OWNER') return result(service.from('st_objects').select('*').eq('client_id', ctx.client.id).order('code')) as Promise<AnyRow[]>;
  const links = await result(service.from('st_manager_properties').select('object_id').eq('manager_client_id', ctx.client.id)) as AnyRow[];
  if (!links.length) return [] as AnyRow[];
  return result(service.from('st_objects').select('*').in('id', links.map((link) => link.object_id)).order('code')) as Promise<AnyRow[]>;
}

async function routeClient(ctx: any, route: string, method: string, query: AnyRow, body: AnyRow) {
  requireRole(ctx, ['OWNER', 'PROPERTY_MANAGER']);
  const clientId = ctx.client?.id;
  if (!clientId) throw new ApiError('Client account is not configured', 403);
  if (route === 'client/dashboard' && method === 'GET') {
    const objects = await clientPortfolioObjects(ctx);
    const raw = objects.length ? await result(service.from('st_jobs').select('*').in('object_id', objects.map((object) => object.id)).order('service_date')) as AnyRow[] : [];
    const jobs = await hydrateJobs(raw);
    const upcoming = jobs.filter((job) => job.status !== 'CANCELLED' && job.service_date >= today());
    return { objects: { total: objects.length, approved: objects.filter((item) => item.approval_status === 'APPROVED' && item.active).length, pending: objects.filter((item) => item.approval_status === 'PENDING').length }, upcoming, nextBooking: upcoming[0] || null, completedToday: jobs.filter((job) => job.service_date === today() && job.status === 'COMPLETED').length };
  }
  if (route === 'client/finance' && method === 'GET') return result(service.rpc('st_settlement_report',{p_actor_id:ctx.appUser.id,p_month:query.month||today().slice(0,7)}));
  if (route === 'client/objects' && method === 'GET') return { objects: await clientPortfolioObjects(ctx) };
  if (route === 'client/objects' && method === 'POST') {
    if (ctx.appUser.role !== 'OWNER') throw new ApiError('A property manager can only work with assigned properties', 403);
    const coordinates = objectCoordinates(body.lat, body.lng);
    const object = await one(service.from('st_objects').insert({ client_id: clientId, code: code(), name: String(body.name || ''), address: String(body.address || ''), zone: String(body.zone || 'Bratislava'), service_category: String(body.serviceCategory || 'SHORT_STAY'), apartment_type: String(body.apartmentType || 'Apartment'), bedrooms: number(body.bedrooms, 1), bathrooms: number(body.bathrooms, 1), lat: coordinates.lat, lng: coordinates.lng, access_instructions: body.accessInstructions || null, key_instructions: body.keyInstructions || null, parking: body.parking || null, linen_location: body.linenLocation || null, supplies_location: body.suppliesLocation || null, notes: body.notes || null, active: false, approval_status: 'PENDING' }).select().single()) as AnyRow;
    const admins = await result(service.from('st_users').select('id').eq('role', 'ADMIN').eq('active', true)) as AnyRow[];
    await Promise.all(admins.map((admin) => notify(admin.id, 'OBJECT_APPROVAL', 'Property needs approval', object.name)));
    return { object };
  }
  const objectMatch = route.match(/^client\/objects\/(\d+)$/);
  if (objectMatch) {
    const objectId = number(objectMatch[1]);
    if (method === 'GET') return { object: await clientObject(ctx, objectId) };
    if (method === 'PATCH') {
      const existing = await clientObject(ctx, objectId);
      const structural = ['address', 'zone', 'apartmentType', 'bedrooms', 'bathrooms', 'lat', 'lng'].some((key) => body[key] !== undefined);
      const coordinates = objectCoordinates(body.lat !== undefined ? body.lat : existing.lat, body.lng !== undefined ? body.lng : existing.lng);
      const updates: AnyRow = {
        name: body.name ?? existing.name, address: body.address ?? existing.address, zone: body.zone ?? existing.zone,
        apartment_type: body.apartmentType ?? existing.apartment_type, bedrooms: body.bedrooms ?? existing.bedrooms, bathrooms: body.bathrooms ?? existing.bathrooms,
        lat: coordinates.lat, lng: coordinates.lng, access_instructions: body.accessInstructions ?? existing.access_instructions,
        key_instructions: body.keyInstructions ?? existing.key_instructions, parking: body.parking ?? existing.parking,
        linen_location: body.linenLocation ?? existing.linen_location, supplies_location: body.suppliesLocation ?? existing.supplies_location, notes: body.notes ?? existing.notes,
      };
      if (structural) { updates.approval_status = 'PENDING'; updates.active = false; }
      return { object: await one(service.from('st_objects').update(updates).eq('id', objectId).select().single()) };
    }
  }
  if (route === 'client/slots' && method === 'GET') {
    const objectId = number(query.objectId);
    const date = String(query.date || '');
    if (!objectId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today()) throw new ApiError('objectId and a future date are required');
    const object = await clientObject(ctx, objectId);
    if (!object.active || object.approval_status !== 'APPROVED') throw new ApiError('Object is not approved for booking', 404);
    const [jobs, availability, appSettings, cleaners] = await Promise.all([
      result(service.from('st_jobs').select('*').eq('service_date', date)) as Promise<AnyRow[]>,
      result(service.from('st_cleaner_availability').select('*').eq('service_date', date)) as Promise<AnyRow[]>,
      settings(), activeCleaners(date),
    ]);
    const windows = availability;
    return { date, object, slots: availableBookingSlots({ object, jobs, windows, cleaners, durationMinutes: object.duration_minutes, settings: appSettings, stepMinutes: number(appSettings.clientBookingStepMinutes, 30) }).filter(slot => date !== today() || slot > currentTime()), capacity: cleaners.filter((cleaner) => cleaner.available).length };
  }
  if (route === 'client/bookings' && method === 'GET') {
    const objects = await clientPortfolioObjects(ctx);
    const rows = objects.length ? await result(service.from('st_jobs').select('*').in('object_id', objects.map((object) => object.id)).order('service_date', { ascending: false })) as AnyRow[] : [];
    return { bookings: await hydrateJobs(rows) };
  }
  if (route === 'client/bookings' && method === 'POST') {
    const object = await clientObject(ctx, number(body.objectId));
    const slotsResult = await routeClient(ctx, 'client/slots', 'GET', { objectId: body.objectId, date: body.serviceDate }, {});
    if (!slotsResult.slots.includes(String(body.startTime))) throw new ApiError('This cleaning slot is no longer available', 409, { availableSlots: slotsResult.slots });
    const job = await createJob(ctx, { objectId: object.id, serviceDate: body.serviceDate, clientId: object.client_id, plannedStart: body.startTime, earliestStart: body.startTime, deadline: String(object.deadline_time).slice(0, 5), bookingSource: 'CLIENT_BOOKING', marketplaceVisible: true });
    await insertEvent(job.id, ctx.appUser.id, 'CLIENT_BOOKED', { startTime: body.startTime });
    const admins = await result(service.from('st_users').select('id').eq('role', 'ADMIN').eq('active', true)) as AnyRow[];
    await Promise.all(admins.map((admin) => notify(admin.id, 'CLIENT_BOOKING', 'New client cleaning reservation', `${object.code} · ${body.serviceDate} ${body.startTime}`)));
    return { booking: (await hydrateJobs([job]))[0] };
  }
  const booking = route.match(/^client\/bookings\/(\d+)(?:\/(cancel))?$/);
  if (booking) {
    const jobId = number(booking[1]);
    if (!booking[2] && method === 'GET') {
      const job = await jobFor(ctx, jobId);
      const details = await jobDetails(ctx, jobId);
      return { booking: (await hydrateJobs([job]))[0], photos: details.photos, issues: details.issues };
    }
    if (booking[2] === 'cancel' && method === 'POST') {
      const job = await jobFor(ctx, jobId);
      if (job.status === 'COMPLETED') throw new ApiError('Completed booking cannot be cancelled', 409);
      await jobCommand(ctx, jobId, 'cancel', body);
      return { ok: true };
    }
  }
  if (route === 'client/profile' && method === 'GET') return { client: ctx.client, user: await publicUser(ctx) };
  if (route === 'client/profile' && method === 'PATCH') {
    const user = await one(service.from('st_users').update({ full_name: body.fullName ?? ctx.appUser.full_name, phone: body.phone ?? ctx.appUser.phone, language: validLanguage(body.language) }).eq('id', ctx.appUser.id).select().single()) as AnyRow;
    const client = await one(service.from('st_client_accounts').update({ company_name: body.companyName ?? ctx.client.company_name, billing_name: body.billingName ?? ctx.client.billing_name, ico: body.ico ?? ctx.client.ico, dic: body.dic ?? ctx.client.dic, ic_dph: body.icDph ?? ctx.client.ic_dph, billing_address: body.billingAddress ?? ctx.client.billing_address }).eq('id', clientId).select().single()) as AnyRow;
    return { client, user };
  }
  throw new ApiError('Route not found', 404);
}

async function createManagedUser(role: string, body: AnyRow) {
  if (!body.email || !body.password || !body.fullName) throw new ApiError('email, password and fullName are required');
  if (!validEmail(body.email)) throw new ApiError('Valid email is required');
  if (String(body.password).length < 8) throw new ApiError('Password must be at least 8 characters');
  const email = normalizedEmail(body.email);
  const { data, error } = await service.auth.admin.createUser({ email, password: String(body.password), email_confirm: true, user_metadata: {} });
  if (error || !data.user) throw new ApiError(error?.message || 'Cannot create account', 409);
  try {
    const user = await one(service.from('st_users').insert({ auth_user_id: data.user.id, email, role, full_name: String(body.fullName), phone: String(body.phone || ''), language: validLanguage(body.language) }).select().single()) as AnyRow;
    if (role === 'CLEANER') {
      const cleaner = await one(service.from('st_cleaners').insert({ user_id: user.id, mode: body.mode === 'GUARANTEE' ? 'GUARANTEE' : 'FLEX', reliability_score: number(body.reliabilityScore, 95), rating: number(body.rating, 5), transport: ['CAR', 'PUBLIC', 'WALKING'].includes(body.transport) ? body.transport : 'PUBLIC', preferred_zones: Array.isArray(body.preferredZones) ? body.preferredZones : [], max_jobs_day: number(body.maxJobsDay, 5) }).select().single()) as AnyRow;
      return { user, cleaner };
    }
    const client = await one(service.from('st_client_accounts').insert({ user_id: user.id, account_type: role, company_name: body.companyName || null, billing_name: body.billingName || null, ico: body.ico || null, dic: body.dic || null, ic_dph: body.icDph || null, billing_address: body.billingAddress || null, notes: body.notes || null }).select().single()) as AnyRow;
    return { client };
  } catch (error) {
    await service.auth.admin.deleteUser(data.user.id);
    throw error;
  }
}

async function updateManagedLoginEmail(user: AnyRow, value: unknown) {
  const email = normalizedEmail(value);
  if (!validEmail(email)) throw new ApiError('Valid email is required');
  if (email === normalizedEmail(user.email)) return;
  const duplicate = await result(service.from('st_users').select('id').eq('email', email).neq('id', user.id).maybeSingle()) as AnyRow | null;
  if (duplicate) throw new ApiError('This email is already used by another account', 409);
  await result(service.auth.admin.updateUserById(user.auth_user_id, { email, email_confirm: true }));
  await result(service.from('st_users').update({ email }).eq('id', user.id));
}

async function routeAdmin(ctx: any, route: string, method: string, query: AnyRow, body: AnyRow) {
  const capabilities = roleCapabilities(ctx.appUser.role);
  if (!capabilities.operations) throw new ApiError('Forbidden', 403);
  const accountRoute = route === 'admin/settings'
    || (route === 'admin/cleaners' && method === 'POST')
    || (route === 'admin/clients' && method === 'POST')
    || /^admin\/(cleaners|clients)\/\d+(?:\/password)?$/.test(route);
  if ((route.startsWith('admin/finance') && !capabilities.finance) || (accountRoute && !capabilities.access)) throw new ApiError('Forbidden', 403);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date || '')) ? String(query.date) : today();
  if (route === 'admin/dashboard' && method === 'GET') {
    const [raw, cleaners, appSettings] = await Promise.all([
      result(service.from('st_jobs').select('*').eq('service_date', date).order('planned_start')) as Promise<AnyRow[]>, activeCleaners(date), settings(),
    ]);
    const jobs = await hydrateJobs(raw);
    const summary = capacity(cleaners, jobs, appSettings);
    const kpis = { total: jobs.length, completed: jobs.filter((item) => item.status === 'COMPLETED').length, cleaning: jobs.filter((item) => item.status === 'CLEANING').length, assigned: jobs.filter((item) => ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'CLEANING'].includes(item.status)).length, unassigned: jobs.filter((item) => item.status === 'UNASSIGNED').length, atRisk: jobs.filter((item) => item.risk_level === 'ORANGE').length, rescue: jobs.filter((item) => item.status === 'RESCUE').length };
    const ready = jobs.filter((item) => item.status === 'COMPLETED' || (item.eta && item.eta <= item.deadline)).length;
    return { date, kpis, jobs, capacity: summary, sla: { projectedReadyPct: jobs.length ? Math.round(ready / jobs.length * 100) : 100, health: summary.health } };
  }
  if (route === 'admin/objects' && method === 'GET') {
    const objects = await result(service.from('st_objects').select('*').order('approval_status').order('active', { ascending: false }).order('code')) as AnyRow[];
    const clients = await fetchRows('st_client_accounts', objects.map((item) => item.client_id));
    const users = await fetchRows('st_users', clients.map((item) => item.user_id));
    const clientById = new Map(clients.map((item) => [String(item.id), item]));
    const userById = new Map(users.map((item) => [String(item.id), item]));
    return { objects: objects.map((object) => ({ ...object, company_name: clientById.get(String(object.client_id))?.company_name || null, client_name: userById.get(String(clientById.get(String(object.client_id))?.user_id))?.full_name || null })) };
  }
  if (route === 'admin/objects' && method === 'POST') {
    const coordinates = objectCoordinates(body.lat, body.lng);
    const object = await one(service.from('st_objects').insert({ code: body.code || code(), client_id: body.clientId || null, name: String(body.name || ''), address: String(body.address || ''), zone: String(body.zone || 'Bratislava'), service_category: String(body.serviceCategory || 'SHORT_STAY'), apartment_type: String(body.apartmentType || 'Apartment'), bedrooms: number(body.bedrooms, 1), bathrooms: number(body.bathrooms, 1), lat: coordinates.lat, lng: coordinates.lng, checkout_time: body.checkoutTime || '10:00', deadline_time: body.deadlineTime || '15:00', duration_minutes: number(body.durationMinutes, 120), payout: number(body.payout), client_price: number(body.clientPrice), active: body.active !== false, approval_status: body.approvalStatus || 'APPROVED', access_instructions: body.accessInstructions || null, key_instructions: body.keyInstructions || null, parking: body.parking || null, linen_location: body.linenLocation || null, supplies_location: body.suppliesLocation || null, wifi: body.wifi || null, notes: body.notes || null }).select().single()) as AnyRow;
    return { object };
  }
  const objectChecklist = route.match(/^admin\/objects\/(\d+)\/checklist$/);
  if (objectChecklist && method === 'PUT') {
    const objectId = number(objectChecklist[1]);
    await result(service.from('st_checklist_items').delete().eq('object_id', objectId));
    const items = Array.isArray(body.items) ? body.items : [];
    if (items.length) await result(service.from('st_checklist_items').insert(items.map((item: AnyRow, index: number) => ({ object_id: objectId, label: String(item.label || ''), required: item.required !== false, photo_required: truthy(item.photoRequired), photo_category: item.photoCategory || null, sort_order: index + 1 }))));
    return { ok: true };
  }
  const objectRoute = route.match(/^admin\/objects\/(\d+)$/);
  if (objectRoute) {
    const id = number(objectRoute[1]);
    if (method === 'GET') return { object: await one(service.from('st_objects').select('*').eq('id', id).single()) };
    if (method === 'PATCH') {
      const map: AnyRow = { name: body.name, address: body.address, zone: body.zone, service_category:body.serviceCategory, apartment_type: body.apartmentType, bedrooms: body.bedrooms, bathrooms: body.bathrooms, lat: body.lat, lng: body.lng, checkout_time: body.checkoutTime, deadline_time: body.deadlineTime, duration_minutes: body.durationMinutes, payout: body.payout, client_price: body.clientPrice, active: body.active, approval_status: body.approvalStatus, client_id: body.clientId, access_instructions: body.accessInstructions, key_instructions: body.keyInstructions, parking: body.parking, linen_location: body.linenLocation, supplies_location: body.suppliesLocation, wifi: body.wifi, notes: body.notes };
      if (body.lat !== undefined || body.lng !== undefined) {
        const current = await one(service.from('st_objects').select('lat,lng').eq('id', id).single()) as AnyRow;
        const coordinates = objectCoordinates(body.lat !== undefined ? body.lat : current.lat, body.lng !== undefined ? body.lng : current.lng);
        map.lat = coordinates.lat;
        map.lng = coordinates.lng;
      }
      const updates = Object.fromEntries(Object.entries(map).filter(([, value]) => value !== undefined));
      return { object: await one(service.from('st_objects').update(updates).eq('id', id).select().single()) };
    }
    if (method === 'DELETE') { await result(service.from('st_objects').delete().eq('id', id)); return { ok: true }; }
  }
  if (route === 'admin/jobs' && method === 'GET') {
    let builder: any = service.from('st_jobs').select('*').eq('service_date', date).order('planned_start');
    if (query.status) builder = builder.eq('status', query.status);
    if (query.cleanerId) builder = builder.eq('assigned_cleaner_id', number(query.cleanerId));
    return { jobs: await hydrateJobs(await result(builder) as AnyRow[]) };
  }
  if (route === 'admin/jobs' && method === 'POST') {
    const job = await createJob(ctx, body);
    await insertEvent(job.id, ctx.appUser.id, 'JOB_CREATED', { serviceDate: body.serviceDate });
    return { job: (await hydrateJobs([job]))[0] };
  }
  if (route === 'admin/jobs/generate' && method === 'POST') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.serviceDate || ''))) throw new ApiError('serviceDate required');
    const objects = body.objectIds?.length ? await fetchRows('st_objects', body.objectIds) : await result(service.from('st_objects').select('*').eq('active', true)) as AnyRow[];
    const created: number[] = [], skipped: number[] = [];
    for (const object of objects) {
      try { const job = await createJob(ctx, { objectId: object.id, serviceDate: body.serviceDate, marketplaceVisible: body.publish !== false }); created.push(job.id); await insertEvent(job.id, ctx.appUser.id, 'JOB_GENERATED', { serviceDate: body.serviceDate }); }
      catch (error) { if (error instanceof ApiError && error.status === 409) skipped.push(object.id); else throw error; }
    }
    return { created: created.length, skipped, jobIds: created };
  }
  const jobRoute = route.match(/^admin\/jobs\/(\d+)(?:\/(assign|rescue|bonus))?$/);
  if (jobRoute) {
    const id = number(jobRoute[1]);
    const action = jobRoute[2] || '';
    if (!action && method === 'GET') return jobDetails(ctx, id);
    if (!action && method === 'PATCH') {
      return { job: (await hydrateJobs([await jobCommand(ctx, id, 'patch', body)]))[0] };
    }
    const job = await getJob(id);
    const terminal = ['COMPLETED', 'CANCELLED'].includes(job.status);
    if (['assign', 'rescue'].includes(action) && terminal) throw new ApiError('Completed or cancelled jobs cannot be reassigned', 409);
    if (action === 'assign' && method === 'POST') {
      const cleanerId = number(body.cleanerId);
      const cleaner = await one(service.from('st_cleaners').select('*').eq('id', cleanerId).eq('active', true).single()) as AnyRow;
      const updated = await jobCommand(ctx, id, 'assign', body);
      return { job: (await hydrateJobs([updated]))[0] };
    }
    if (action === 'rescue' && method === 'POST') {
      const cleanerId = number(body.cleanerId);
      const bonus = number(body.bonus, Math.max(number(job.bonus), 6));
      if (cleanerId) {
        return routeAdmin(ctx, `admin/jobs/${id}/assign`, 'POST', {}, { ...body, cleanerId, bonus });
      }
      return { job: (await hydrateJobs([await jobCommand(ctx, id, 'rescue', { ...body, bonus })]))[0] };
    }
    if (action === 'bonus' && method === 'POST') {
      return { job: (await hydrateJobs([await jobCommand(ctx, id, 'patch', { ...body, bonus: number(body.bonus) })]))[0] };
    }
  }
  if (route === 'admin/cleaners' && method === 'GET') {
    const rows = await activeCleaners(date);
    const all = await result(service.from('st_cleaners').select('*').order('active', { ascending: false }).order('reliability_score', { ascending: false })) as AnyRow[];
    const users = await fetchRows('st_users', all.map((item) => item.user_id));
    const rawJobs = await result(service.from('st_jobs').select('*').eq('service_date', date)) as AnyRow[];
    const byId = new Map(rows.map((item) => [String(item.id), item])); const userById = new Map(users.map((item) => [String(item.id), item]));
    return { cleaners: all.map((cleaner) => ({ ...cleaner, ...userById.get(String(cleaner.user_id)), ...(byId.get(String(cleaner.id)) || { available: false, availability: { online: false, fromTime: '10:00', toTime: '15:00' } }), today_jobs: rawJobs.filter((job) => same(job.assigned_cleaner_id, cleaner.id) && job.status !== 'CANCELLED').length, today_earnings: rawJobs.filter((job) => same(job.assigned_cleaner_id, cleaner.id) && job.status === 'COMPLETED').reduce((sum, job) => sum + number(job.payout) + number(job.bonus), 0) })) };
  }
  if (route === 'admin/cleaners' && method === 'POST') return createManagedUser('CLEANER', body);
  const cleanerRoute = route.match(/^admin\/cleaners\/(\d+)(?:\/(password))?$/);
  if (cleanerRoute) {
    const cleanerId = number(cleanerRoute[1]);
    const cleaner = await one(service.from('st_cleaners').select('*').eq('id', cleanerId).single()) as AnyRow;
    if (cleanerRoute[2] === 'password' && method === 'POST') {
      if (String(body.password || '').length < 10) throw new ApiError('Temporary password must be at least 10 characters');
      const user = await one(service.from('st_users').select('*').eq('id', cleaner.user_id).single()) as AnyRow;
      await result(service.auth.admin.updateUserById(user.auth_user_id, { password: String(body.password) }));
      await notify(user.id, 'SECURITY', 'Password reset', 'Operations reset your login password.');
      return { ok: true };
    }
    if (method === 'PATCH') {
      const updates: AnyRow = { mode: body.mode, reliability_score: body.reliabilityScore, rating: body.rating, transport: body.transport, preferred_zones: body.preferredZones, max_jobs_day: body.maxJobsDay, active: body.active };
      await result(service.from('st_cleaners').update(Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined))).eq('id', cleanerId));
      const user = await one(service.from('st_users').select('*').eq('id', cleaner.user_id).single()) as AnyRow;
      if (body.email !== undefined) await updateManagedLoginEmail(user, body.email);
      const userUpdates: AnyRow = { full_name: body.fullName, phone: body.phone, language: body.language && validLanguage(body.language) };
      await result(service.from('st_users').update(Object.fromEntries(Object.entries(userUpdates).filter(([, value]) => value !== undefined))).eq('id', cleaner.user_id));
      return { cleaner: await one(service.from('st_cleaners').select('*').eq('id', cleanerId).single()) };
    }
  }
  if (route === 'admin/clients' && method === 'GET') {
    const month = today().slice(0, 7);
    const [clients, objects, jobs] = await Promise.all([
      result(service.from('st_client_accounts').select('*').order('created_at', { ascending: false })) as Promise<AnyRow[]>,
      result(service.from('st_objects').select('id,client_id,active,approval_status')) as Promise<AnyRow[]>,
      result(service.from('st_jobs').select('client_id,service_date,status,client_price,extra_revenue').gte('service_date', `${month}-01`).lte('service_date', monthEnd(month))) as Promise<AnyRow[]>,
    ]);
    const users = await fetchRows('st_users', clients.map((item) => item.user_id));
    return { clients: clientAccountRows({ clients, users, objects, jobs, month }) };
  }
  if (route === 'admin/clients' && method === 'POST') return createManagedUser(['PROPERTY_MANAGER', 'MANAGER'].includes(String(body.accountType)) ? 'PROPERTY_MANAGER' : 'OWNER', body);
  const clientRoute = route.match(/^admin\/clients\/(\d+)(?:\/(password))?$/);
  if (clientRoute) {
    const clientId = number(clientRoute[1]);
    const client = await one(service.from('st_client_accounts').select('*').eq('id', clientId).single()) as AnyRow;
    const user = await one(service.from('st_users').select('*').eq('id', client.user_id).single()) as AnyRow;
    if (clientRoute[2] === 'password' && method === 'POST') {
      if (String(body.password || '').length < 10) throw new ApiError('Temporary password must be at least 10 characters');
      await result(service.auth.admin.updateUserById(user.auth_user_id, { password: String(body.password) }));
      return { ok: true };
    }
    if (method === 'PATCH') {
      if (body.email !== undefined) await updateManagedLoginEmail(user, body.email);
      await result(service.from('st_users').update({ full_name: body.fullName ?? user.full_name, phone: body.phone ?? user.phone, language: body.language ? validLanguage(body.language) : user.language, active: body.active ?? user.active }).eq('id', user.id));
      const updates: AnyRow = { account_type: body.accountType === 'MANAGER' ? 'PROPERTY_MANAGER' : body.accountType, company_name: body.companyName, billing_name: body.billingName, ico: body.ico, dic: body.dic, ic_dph: body.icDph, billing_address: body.billingAddress, notes: body.notes };
      return { client: await one(service.from('st_client_accounts').update(Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined))).eq('id', clientId).select().single()) };
    }
  }
  if (route === 'admin/finance' && method === 'GET') {
    const month = /^\d{4}-\d{2}$/.test(String(query.month || '')) ? String(query.month) : today().slice(0, 7);
    const from = `${month}-01`, to = monthEnd(month);
    const trendStart = new Date(`${month}-01T12:00:00Z`); trendStart.setUTCMonth(trendStart.getUTCMonth() - 11);
    const [rawJobs, entries, trendJobs, trendEntries] = await Promise.all([
      result(service.from('st_jobs').select('*').gte('service_date', from).lte('service_date', to).order('service_date')) as Promise<AnyRow[]>,
      result(service.from('st_financial_entries').select('*').gte('entry_date', from).lte('entry_date', to).order('entry_date', { ascending: false })) as Promise<AnyRow[]>,
      result(service.from('st_jobs').select('*').gte('service_date', trendStart.toISOString().slice(0, 10)).lte('service_date', to)) as Promise<AnyRow[]>,
      result(service.from('st_financial_entries').select('*').gte('entry_date', trendStart.toISOString().slice(0, 10)).lte('entry_date', to)) as Promise<AnyRow[]>,
    ]);
    const jobs = await hydrateJobs(rawJobs);
    const clients = await fetchRows('st_client_accounts', entries.map((entry) => entry.client_id));
    const objects = await fetchRows('st_objects', entries.map((entry) => entry.object_id));
    const users = await fetchRows('st_users', clients.map((client) => client.user_id));
    const clientById = new Map(clients.map((client) => [String(client.id), client]));
    const objectById = new Map(objects.map((object) => [String(object.id), object]));
    const userById = new Map(users.map((user) => [String(user.id), user]));
    const detailedEntries = entries.map((entry) => ({ ...entry, client_name: userById.get(String(clientById.get(String(entry.client_id))?.user_id))?.full_name || null, company_name: clientById.get(String(entry.client_id))?.company_name || null, object_code: objectById.get(String(entry.object_id))?.code || null, object_name: objectById.get(String(entry.object_id))?.name || null }));
    const report = financeBoardReport({ jobs, entries: detailedEntries, month, trendJobs, trendEntries });
    return { month, from, to, ...report, entries: detailedEntries, jobs };
  }
  if (route === 'admin/finance/entries' && method === 'POST') {
    if (number(body.amount) <= 0 || !['INCOME', 'EXPENSE'].includes(String(body.entryType))) throw new ApiError('Valid type and positive amount are required');
    return { entry: await one(service.from('st_financial_entries').insert({ entry_date: body.entryDate || today(), entry_type: body.entryType, category: body.category || 'OTHER', amount: number(body.amount), description: body.description || null, client_id: body.clientId || null, object_id: body.objectId || null, job_id: body.jobId || null, created_by_user_id: ctx.appUser.id }).select().single()) };
  }
  const financeEntry = route.match(/^admin\/finance\/entries\/(\d+)$/);
  if (financeEntry && method === 'DELETE') { await result(service.from('st_financial_entries').delete().eq('id', number(financeEntry[1]))); return { ok: true }; }
  if (route === 'admin/issues' && method === 'GET') {
    const issues = await result(service.from('st_issues').select('*').order('status').order('priority').order('id', { ascending: false })) as AnyRow[];
    const jobs = await fetchRows('st_jobs', issues.map((issue) => issue.job_id)); const hydrated = await hydrateJobs(jobs);
    const jobById = new Map(hydrated.map((job) => [String(job.id), job]));
    return { issues: issues.map((issue) => ({ ...issue, ...{ object_code: jobById.get(String(issue.job_id))?.object_code, address: jobById.get(String(issue.job_id))?.address, cleaner_name: jobById.get(String(issue.job_id))?.cleaner_name, service_date: jobById.get(String(issue.job_id))?.service_date }, photos: issue.photos_json || [] })) };
  }
  const issueRoute = route.match(/^admin\/issues\/(\d+)$/);
  if (issueRoute && method === 'PATCH') {
    const issue = await one(service.from('st_issues').update({ status: body.status || 'OPEN', resolution_note: body.resolutionNote || null, resolved_at: body.status === 'RESOLVED' ? new Date().toISOString() : null }).eq('id', number(issueRoute[1])).select().single()) as AnyRow;
    if (issue.status === 'RESOLVED') {
      const remaining = await result(service.from('st_issues').select('id').eq('job_id', issue.job_id).eq('status', 'OPEN')) as AnyRow[];
      if (!remaining.length) await result(service.from('st_jobs').update({ issue_flag: false }).eq('id', issue.job_id));
    }
    await insertEvent(issue.job_id, ctx.appUser.id, 'ISSUE_UPDATED', { issueId: issue.id, status: issue.status });
    return { issue };
  }
  if (route === 'admin/capacity' && method === 'GET') {
    const [raw, cleaners, appSettings] = await Promise.all([result(service.from('st_jobs').select('*').eq('service_date', date).neq('status', 'CANCELLED')) as Promise<AnyRow[]>, activeCleaners(date), settings()]);
    return { date, capacity: capacity(cleaners, raw, appSettings), cleaners, jobs: await hydrateJobs(raw) };
  }
  if (route === 'admin/analytics' && method === 'GET') {
    const from = String(query.from || '2000-01-01'), to = String(query.to || '2099-12-31');
    const [raw, issues, cleaners] = await Promise.all([
      result(service.from('st_jobs').select('*').gte('service_date', from).lte('service_date', to).order('service_date')) as Promise<AnyRow[]>,
      result(service.from('st_issues').select('id').gte('created_at', `${from}T00:00:00`).lte('created_at', `${to}T23:59:59`)) as Promise<AnyRow[]>,
      activeCleaners(date),
    ]);
    const completed = raw.filter((job) => job.status === 'COMPLETED');
    const onTime = completed.filter((job) => job.completed_at && new Date(job.completed_at).getHours() <= 15);
    const objects = await result(service.from('st_objects').select('*').order('code')) as AnyRow[];
    return { summary: { jobs: raw.length, completed: completed.length, onTimePct: completed.length ? Math.round(onTime.length / completed.length * 1000) / 10 : 100, rescue: raw.filter((job) => job.rescue_state !== 'NONE').length, cancelled: raw.filter((job) => job.status === 'CANCELLED').length, issues: issues.length }, byDate: [], cleanerRanking: cleaners, objectPerformance: objects.map((object) => ({ ...object, jobs: raw.filter((job) => same(job.object_id, object.id)).length, avg_duration: raw.filter((job) => same(job.object_id, object.id)).length ? Math.round(raw.filter((job) => same(job.object_id, object.id)).reduce((sum, job) => sum + number(job.duration_minutes), 0) / raw.filter((job) => same(job.object_id, object.id)).length) : null })) };
  }
  if (route === 'admin/settings' && method === 'GET') return { settings: await settings() };
  if (route === 'admin/settings' && method === 'PATCH') {
    const updates = Object.entries(body).map(([key, value]) => ({ setting_key: key, value_json: value }));
    if (updates.length) await result(service.from('st_settings').upsert(updates, { onConflict: 'setting_key' }));
    return { settings: await settings() };
  }
  throw new ApiError('Route not found', 404);
}

async function bootstrap(req: Request, body: AnyRow) {
  const { authUser } = await authOnly(req);
  const fullName = String(body.fullName || '').trim();
  if (!fullName) throw new ApiError('Full name is required');
  const existing = await result(service.from('st_users').select('*').eq('auth_user_id', authUser.id).maybeSingle()) as AnyRow | null;
  if (existing) return { user: existing };
  const claimed = await result(service.from('st_bootstrap_state')
    .update({ initialized_auth_user_id: authUser.id, initialized_at: new Date().toISOString() })
    .eq('id', 1).is('initialized_auth_user_id', null).select()) as AnyRow[];
  if (!claimed.length) throw new ApiError('Initial administrator already exists', 403);
  try {
    const user = await one(service.from('st_users').insert({
      auth_user_id: authUser.id, email: String(authUser.email || '').toLowerCase(), role: 'ADMIN',
      full_name: fullName, phone: String(body.phone || ''), language: validLanguage(body.language), active: true,
    }).select().single()) as AnyRow;
    return { user };
  } catch (error) {
    await result(service.from('st_bootstrap_state').update({ initialized_auth_user_id: null, initialized_at: null }).eq('id', 1).eq('initialized_auth_user_id', authUser.id));
    throw error;
  }
}

async function account(ctx: any, route: string, method: string, body: AnyRow) {
  if (route === 'account/language' && method === 'PATCH') {
    const language = validLanguage(body.language);
    await result(service.from('st_users').update({ language }).eq('id', ctx.appUser.id));
    return { language };
  }
  if (route === 'account/password' && method === 'POST') {
    const currentPassword = String(body.currentPassword || ''), newPassword = String(body.newPassword || '');
    if (!currentPassword || newPassword.length < 8) throw new ApiError('Current password and a new password of at least 8 characters are required');
    const { error } = await ctx.userClient.auth.signInWithPassword({ email: ctx.authUser.email || '', password: currentPassword });
    if (error) throw new ApiError('Current password is incorrect', 403);
    await result(service.auth.admin.updateUserById(ctx.authUser.id, { password: newPassword }));
    return { ok: true };
  }
  throw new ApiError('Route not found', 404);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (req.method !== 'POST') throw new ApiError('Method not allowed', 405);
    const request = await req.json();
    const clientBuild = String(request.clientBuild || '').trim();
    if (clientBuild && !COMPATIBLE_BUILDS.has(clientBuild)) {
      throw new ApiError('The browser release is outdated. Refresh after the complete release is deployed.', 409, { apiVersion: APP_BUILD });
    }
    const route = String(request.route || '').replace(/^\/+|\/+$/g, '');
    const method = String(request.method || 'GET').toUpperCase();
    const query = request.query && typeof request.query === 'object' ? request.query : {};
    const body = request.body && typeof request.body === 'object' ? request.body : {};
    if (route === 'bootstrap' && method === 'POST') return json(await bootstrap(req, body), 201);
    const ctx = await context(req);
    if (route === 'me' && method === 'GET') return json({ user: await publicUser(ctx), settings: await settings(), csrf: 'supabase', apiVersion: APP_BUILD });
    if (route === 'health' && method === 'GET') return json({ ok: true, service: 'Shine Time Operations', date: today(), time: currentTime(), apiVersion: APP_BUILD });
    if (route === 'notifications' && method === 'GET') {
      const notifications = await result(service.from('st_notifications').select('*').eq('user_id', ctx.appUser.id).order('id', { ascending: false }).limit(50)) as AnyRow[];
      return json({ notifications, unread: notifications.filter((item) => !item.read_at).length });
    }
    if (route === 'notifications/read' && method === 'POST') { await result(service.from('st_notifications').update({ read_at: new Date().toISOString() }).eq('user_id', ctx.appUser.id).is('read_at', null)); return json({ ok: true }); }
    const extended=await operationsRoute({ctx,route,method,query,body,service,result,ApiError,today});
    if(extended!==null)return json(extended);
    if (route.startsWith('account/')) return json(await account(ctx, route, method, body));
    if (route.startsWith('cleaner/')) return json(projectResponse(await routeCleaner(ctx, route, method, query, body),ctx.appUser.role));
    if (route.startsWith('client/')) return json(projectResponse(await routeClient(ctx, route, method, query, body),ctx.appUser.role));
    if (route.startsWith('admin/')) return json(projectResponse(await routeAdmin(ctx, route, method, query, body),ctx.appUser.role));
    throw new ApiError('Route not found', 404);
  } catch (error) {
    const apiError = error instanceof ApiError ? error : new ApiError(error instanceof Error ? error.message : 'Unexpected server error', 500);
    return json({ error: apiError.message, ...apiError.extra }, apiError.status);
  }
});
