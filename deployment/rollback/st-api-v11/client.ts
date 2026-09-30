import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { activeAssignmentStatuses, availableBookingSlots, cleanerEarningsSummary, clientAccountRows, coordinatesForStorage, financeBoardReport, marketplaceForCleaner, riskForJob, roleCapabilities, settingsFromRows } from './logic.mjs';
import { marketplaceJobs, projectResponse } from './security.mjs';
import { operationsRoute } from './operations.mjs';
import { validatePhoto, validateMedia } from './media.mjs';
type AnyRow = Record<string, any>;
export function createClientRoutes(deps: any) {
    const { SUPABASE_URL, SERVICE_KEY, PUBLIC_KEY, MEDIA_BUCKET, APP_BUILD, COMPATIBLE_BUILDS, service, ApiError, cors, json, today, currentTime, toMinutes, toTime, same, unique, number, truthy, validLanguage, normalizedEmail, validEmail, code, objectCoordinates, baseChecklist, monthEnd, result, one, settings, authOnly, context, requireRole, publicUser, bootstrap, account, insertEvent, jobCommand, notify, fetchRows, hydrateJobs, getJob, jobFor, jobDetails, activeCleaners, capacity, reschedule, ensureJobChecklist, createJob } = deps;
    async function clientObject(ctx: any, id: number) {
        const object = await one(service.from('st_objects').select('*').eq('id', id).single()) as AnyRow;
        if (ctx.appUser.role === 'OWNER' && !same(object.client_id, ctx.client?.id))
            throw new ApiError('Forbidden', 403);
        if (ctx.appUser.role === 'PROPERTY_MANAGER') {
            const link = await result(service.from('st_manager_properties').select('id').eq('manager_client_id', ctx.client?.id).eq('object_id', id).maybeSingle()) as AnyRow | null;
            if (!link)
                throw new ApiError('Forbidden', 403);
        }
        return object;
    }
    async function clientPortfolioObjects(ctx: any) {
        if (ctx.appUser.role === 'OWNER')
            return result(service.from('st_objects').select('*').eq('client_id', ctx.client.id).order('code')) as Promise<AnyRow[]>;
        const links = await result(service.from('st_manager_properties').select('object_id').eq('manager_client_id', ctx.client.id)) as AnyRow[];
        if (!links.length)
            return [] as AnyRow[];
        return result(service.from('st_objects').select('*').in('id', links.map((link) => link.object_id)).order('code')) as Promise<AnyRow[]>;
    }
    async function routeClient(ctx: any, route: string, method: string, query: AnyRow, body: AnyRow) {
        requireRole(ctx, ['OWNER', 'PROPERTY_MANAGER']);
        const clientId = ctx.client?.id;
        if (!clientId)
            throw new ApiError('Client account is not configured', 403);
        if (route === 'client/dashboard' && method === 'GET') {
            const objects = await clientPortfolioObjects(ctx);
            const raw = objects.length ? await result(service.from('st_jobs').select('*').in('object_id', objects.map((object) => object.id)).order('service_date')) as AnyRow[] : [];
            const jobs = await hydrateJobs(raw);
            const upcoming = jobs.filter((job) => job.status !== 'CANCELLED' && job.service_date >= today());
            return { objects: { total: objects.length, approved: objects.filter((item) => item.approval_status === 'APPROVED' && item.active).length, pending: objects.filter((item) => item.approval_status === 'PENDING').length }, upcoming, nextBooking: upcoming[0] || null, completedToday: jobs.filter((job) => job.service_date === today() && job.status === 'COMPLETED').length };
        }
        if (route === 'client/finance' && method === 'GET')
            return result(service.rpc('st_settlement_report', { p_actor_id: ctx.appUser.id, p_month: query.month || today().slice(0, 7) }));
        if (route === 'client/objects' && method === 'GET')
            return { objects: await clientPortfolioObjects(ctx) };
        if (body.serviceCategory !== undefined && !['SHORT_STAY', 'HOME', 'OFFICE', 'COMMON_AREAS', 'OTHER'].includes(body.serviceCategory))
            throw new ApiError('Invalid service category');
        if (route === 'client/objects' && method === 'POST') {
            if (ctx.appUser.role !== 'OWNER')
                throw new ApiError('A property manager can only work with assigned properties', 403);
            const coordinates = objectCoordinates(body.lat, body.lng);
            const object = await one(service.from('st_objects').insert({ client_id: clientId, code: code(), name: String(body.name || ''), address: String(body.address || ''), zone: String(body.zone || 'Bratislava'), service_category: String(body.serviceCategory || 'SHORT_STAY'), apartment_type: String(body.apartmentType || 'Apartment'), bedrooms: number(body.bedrooms, 1), bathrooms: number(body.bathrooms, 1), lat: coordinates.lat, lng: coordinates.lng, access_instructions: body.accessInstructions || null, key_instructions: body.keyInstructions || null, parking: body.parking || null, linen_location: body.linenLocation || null, supplies_location: body.suppliesLocation || null, notes: body.notes || null, active: false, approval_status: 'PENDING' }).select().single()) as AnyRow;
            const admins = await result(service.from('st_users').select('id').eq('role', 'ADMIN').eq('active', true)) as AnyRow[];
            await Promise.all(admins.map((admin) => notify(admin.id, 'OBJECT_APPROVAL', 'Property needs approval', object.name)));
            return { object };
        }
        const objectMatch = route.match(/^client\/objects\/(\d+)$/);
        if (objectMatch) {
            const objectId = number(objectMatch[1]);
            if (method === 'GET')
                return { object: await clientObject(ctx, objectId) };
            if (method === 'PATCH') {
                const existing = await clientObject(ctx, objectId);
                const structural = ['serviceCategory', 'address', 'zone', 'apartmentType', 'bedrooms', 'bathrooms', 'lat', 'lng'].some((key) => body[key] !== undefined);
                const coordinates = objectCoordinates(body.lat !== undefined ? body.lat : existing.lat, body.lng !== undefined ? body.lng : existing.lng);
                const updates: AnyRow = {
                    service_category: body.serviceCategory ?? existing.service_category, name: body.name ?? existing.name, address: body.address ?? existing.address, zone: body.zone ?? existing.zone,
                    apartment_type: body.apartmentType ?? existing.apartment_type, bedrooms: body.bedrooms ?? existing.bedrooms, bathrooms: body.bathrooms ?? existing.bathrooms,
                    lat: coordinates.lat, lng: coordinates.lng, access_instructions: body.accessInstructions ?? existing.access_instructions,
                    key_instructions: body.keyInstructions ?? existing.key_instructions, parking: body.parking ?? existing.parking,
                    linen_location: body.linenLocation ?? existing.linen_location, supplies_location: body.suppliesLocation ?? existing.supplies_location, notes: body.notes ?? existing.notes,
                };
                if (structural) {
                    updates.approval_status = 'PENDING';
                    updates.active = false;
                }
                return { object: await one(service.from('st_objects').update(updates).eq('id', objectId).select().single()) };
            }
        }
        if (route === 'client/slots' && method === 'GET') {
            const objectId = number(query.objectId);
            const date = String(query.date || '');
            if (!objectId || !/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today())
                throw new ApiError('objectId and a future date are required');
            const object = await clientObject(ctx, objectId);
            if (!object.active || object.approval_status !== 'APPROVED')
                throw new ApiError('Object is not approved for booking', 404);
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
            if (!slotsResult.slots.includes(String(body.startTime)))
                throw new ApiError('This cleaning slot is no longer available', 409, { availableSlots: slotsResult.slots });
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
                if (job.status === 'COMPLETED')
                    throw new ApiError('Completed booking cannot be cancelled', 409);
                await jobCommand(ctx, jobId, 'cancel', body);
                return { ok: true };
            }
        }
        if (route === 'client/profile' && method === 'GET')
            return { client: ctx.client, user: await publicUser(ctx) };
        if (route === 'client/profile' && method === 'PATCH') {
            const user = await one(service.from('st_users').update({ full_name: body.fullName ?? ctx.appUser.full_name, phone: body.phone ?? ctx.appUser.phone, language: validLanguage(body.language) }).eq('id', ctx.appUser.id).select().single()) as AnyRow;
            const client = await one(service.from('st_client_accounts').update({ company_name: body.companyName ?? ctx.client.company_name, billing_name: body.billingName ?? ctx.client.billing_name, ico: body.ico ?? ctx.client.ico, dic: body.dic ?? ctx.client.dic, ic_dph: body.icDph ?? ctx.client.ic_dph, billing_address: body.billingAddress ?? ctx.client.billing_address }).eq('id', clientId).select().single()) as AnyRow;
            return { client, user };
        }
        throw new ApiError('Route not found', 404);
    }
    return { clientObject, clientPortfolioObjects, routeClient };
}
