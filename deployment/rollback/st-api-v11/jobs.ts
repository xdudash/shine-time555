import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { activeAssignmentStatuses, availableBookingSlots, cleanerEarningsSummary, clientAccountRows, coordinatesForStorage, financeBoardReport, marketplaceForCleaner, riskForJob, roleCapabilities, settingsFromRows } from './logic.mjs';
import { marketplaceJobs, projectResponse } from './security.mjs';
import { operationsRoute } from './operations.mjs';
import { validatePhoto, validateMedia } from './media.mjs';
type AnyRow = Record<string, any>;
export function createJobs(deps: any) {
    const { SUPABASE_URL, SERVICE_KEY, PUBLIC_KEY, MEDIA_BUCKET, APP_BUILD, COMPATIBLE_BUILDS, service, ApiError, cors, json, today, currentTime, toMinutes, toTime, same, unique, number, truthy, validLanguage, normalizedEmail, validEmail, code, objectCoordinates, baseChecklist, monthEnd, result, one, settings, authOnly, context, requireRole, publicUser, bootstrap, account } = deps;
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
        if (!values.length)
            return [] as AnyRow[];
        return result(service.from(table).select(columns).in('id', values)) as Promise<AnyRow[]>;
    }
    async function hydrateJobs(input: AnyRow[]) {
        if (!input.length)
            return [];
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
            const risk = riskForJob(job, job.service_date === today() ? now : '00:00');
            return {
                ...job,
                ...risk,
                risk_score: risk.score, risk_level: risk.level, risk_reasons: risk.reasons,
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
        if (ctx.appUser.role === 'CLEANER' && !same(job.assigned_cleaner_id, ctx.cleaner?.id))
            throw new ApiError('This job is not assigned to you', 403);
        if (ctx.appUser.role === 'OWNER' && !same(job.client_id, ctx.client?.id))
            throw new ApiError('Forbidden', 403);
        if (ctx.appUser.role === 'PROPERTY_MANAGER') {
            const link = await result(service.from('st_manager_properties').select('id').eq('manager_client_id', ctx.client?.id).eq('object_id', job.object_id).limit(1)) as AnyRow[];
            if (!link.length)
                throw new ApiError('Forbidden', 403);
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
    async function ensureJobChecklist(jobId: number, objectId: number) {
        const existing = await result(service.from('st_job_checklist').select('id').eq('job_id', jobId).limit(1)) as AnyRow[];
        if (existing.length)
            return;
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
        return one(service.rpc('st_create_job', { p_actor_id: ctx.appUser.id, p_body: body }).single()) as Promise<AnyRow>;
    }
    return { insertEvent, jobCommand, notify, fetchRows, hydrateJobs, getJob, jobFor, jobDetails, activeCleaners, capacity, reschedule, ensureJobChecklist, createJob };
}
