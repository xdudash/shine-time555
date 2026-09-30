import { propertyPhotosRoute } from './property-photos.mjs';
import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { activeAssignmentStatuses, availableBookingSlots, cleanerEarningsSummary, clientAccountRows, coordinatesForStorage, financeBoardReport, marketplaceForCleaner, riskForJob, roleCapabilities, settingsFromRows } from './logic.mjs';
import { marketplaceJobs, projectResponse } from './security.mjs';
import { operationsRoute } from './operations.mjs';
import { validatePhoto, validateMedia } from './media.mjs';
export function createHandler(deps: any) {
    const { SUPABASE_URL, SERVICE_KEY, PUBLIC_KEY, MEDIA_BUCKET, APP_BUILD, COMPATIBLE_BUILDS, service, ApiError, cors, json, today, currentTime, toMinutes, toTime, same, unique, number, truthy, validLanguage, normalizedEmail, validEmail, code, objectCoordinates, baseChecklist, monthEnd, result, one, settings, authOnly, context, requireRole, publicUser, bootstrap, account, insertEvent, jobCommand, notify, fetchRows, hydrateJobs, getJob, jobFor, jobDetails, activeCleaners, capacity, reschedule, ensureJobChecklist, createJob, routeCleaner, clientObject, clientPortfolioObjects, routeClient, createManagedUser, updateManagedLoginEmail, routeAdmin } = deps;
    return async (req: Request) => {
        if (req.method === 'OPTIONS')
            return new Response('ok', { headers: cors });
        try {
            if (req.method !== 'POST')
                throw new ApiError('Method not allowed', 405);
            const request = await req.json();
            const clientBuild = String(request.clientBuild || '').trim();
            if (clientBuild && !COMPATIBLE_BUILDS.has(clientBuild)) {
                throw new ApiError('The browser release is outdated. Refresh after the complete release is deployed.', 409, { apiVersion: APP_BUILD });
            }
            const route = String(request.route || '').replace(/^\/+|\/+$/g, '');
            const method = String(request.method || 'GET').toUpperCase();
            const query = request.query && typeof request.query === 'object' ? request.query : {};
            const body = request.body && typeof request.body === 'object' ? request.body : {};
            if (route === 'bootstrap' && method === 'POST')
                return json(await bootstrap(req, body), 201);
            const ctx = await context(req);
            if (route === 'me' && method === 'GET')
                return json({ user: await publicUser(ctx), settings: await settings(), csrf: 'supabase', apiVersion: APP_BUILD });
            if (route === 'health' && method === 'GET')
                return json({ ok: true, service: 'Shine Time Operations', date: today(), time: currentTime(), apiVersion: APP_BUILD });
            if (route === 'notifications' && method === 'GET') {
                const notifications = await result(service.from('st_notifications').select('*').eq('user_id', ctx.appUser.id).order('id', { ascending: false }).limit(50)) as AnyRow[];
                return json({ notifications, unread: notifications.filter((item) => !item.read_at).length });
            }
            if (route === 'notifications/read' && method === 'POST') {
                await result(service.from('st_notifications').update({ read_at: new Date().toISOString() }).eq('user_id', ctx.appUser.id).is('read_at', null));
                return json({ ok: true });
            }
            const propertyPhotos = await propertyPhotosRoute({ctx,route,method,body,service,result,ApiError,jobFor,clientObject});
            if (propertyPhotos !== null)
                return new Response(JSON.stringify(propertyPhotos), {headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
            const extended = await operationsRoute({ ctx, route, method, query, body, service, result, ApiError, today });
            if (extended !== null)
                return json(extended);
            if (route.startsWith('account/'))
                return json(await account(ctx, route, method, body));
            if (route.startsWith('cleaner/'))
                return json(projectResponse(await routeCleaner(ctx, route, method, query, body), ctx.appUser.role));
            if (route.startsWith('client/'))
                return json(projectResponse(await routeClient(ctx, route, method, query, body), ctx.appUser.role));
            if (route.startsWith('admin/'))
                return json(projectResponse(await routeAdmin(ctx, route, method, query, body), ctx.appUser.role));
            throw new ApiError('Route not found', 404);
        }
        catch (error) {
            const apiError = error instanceof ApiError ? error : new ApiError(error instanceof Error ? error.message : 'Unexpected server error', 500);
            return json({ error: apiError.message, ...apiError.extra }, apiError.status);
        }
    };
}
