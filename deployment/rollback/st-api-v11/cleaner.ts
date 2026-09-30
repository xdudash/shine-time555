import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { activeAssignmentStatuses, availableBookingSlots, cleanerEarningsSummary, clientAccountRows, coordinatesForStorage, financeBoardReport, marketplaceForCleaner, riskForJob, roleCapabilities, settingsFromRows } from './logic.mjs';
import { marketplaceJobs, projectResponse } from './security.mjs';
import { operationsRoute } from './operations.mjs';
import { validatePhoto, validateMedia } from './media.mjs';
type AnyRow = Record<string, any>;
export function createCleaner(deps: any) {
    const { SUPABASE_URL, SERVICE_KEY, PUBLIC_KEY, MEDIA_BUCKET, APP_BUILD, COMPATIBLE_BUILDS, service, ApiError, cors, json, today, currentTime, toMinutes, toTime, same, unique, number, truthy, validLanguage, normalizedEmail, validEmail, code, objectCoordinates, baseChecklist, monthEnd, result, one, settings, authOnly, context, requireRole, publicUser, bootstrap, account, insertEvent, jobCommand, notify, fetchRows, hydrateJobs, getJob, jobFor, jobDetails, activeCleaners, capacity, reschedule, ensureJobChecklist, createJob } = deps;
    async function routeCleaner(ctx: any, route: string, method: string, query: AnyRow, body: AnyRow) {
        requireRole(ctx, 'CLEANER');
        const cleanerId = ctx.cleaner?.id;
        if (!cleanerId)
            throw new ApiError('Cleaner account is not configured', 403);
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
            if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(from) || !/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(to) || toMinutes(from) >= toMinutes(to))
                throw new ApiError('Availability must be a valid time range');
            await result(service.from('st_cleaner_availability').upsert({ cleaner_id: cleanerId, service_date: serviceDate, online: truthy(body.online), from_time: from, to_time: to }, { onConflict: 'cleaner_id,service_date' }));
            if (body.lat !== undefined && body.lng !== undefined)
                await result(service.from('st_cleaners').update({ last_lat: number(body.lat), last_lng: number(body.lng), last_location_at: new Date().toISOString() }).eq('id', cleanerId));
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
        if (!match)
            throw new ApiError('Route not found', 404);
        const jobId = number(match[1]);
        const action = match[2] || '';
        if (!action && method === 'GET')
            return jobDetails(ctx, jobId);
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
            if (['COMPLETED', 'CANCELLED'].includes(job.status))
                throw new ApiError('Completed or cancelled jobs cannot be changed', 409);
            const itemId = number(match[3]);
            if (typeof body.completed !== 'boolean')
                throw new ApiError('Completed must be boolean');
            await result(service.rpc('st_update_job_checklist', { p_actor_id: ctx.appUser.id, p_job_id: jobId, p_item_id: itemId, p_completed: body.completed }));
            return { ok: true };
        }
        if (action === 'photos/prepare' && method === 'POST') {
            if (['COMPLETED', 'CANCELLED'].includes(job.status))
                throw new ApiError('Terminal job cannot be changed', 409);
            const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'video/mp4': 'mp4', 'video/webm': 'webm' };
            const extension = extensions[String(body.mime)];
            if (!extension || !Number.isSafeInteger(body.fileSize) || body.fileSize < 1 || body.fileSize > (String(body.mime).startsWith('video/') ? 52428800 : 5242880))
                throw new ApiError('Invalid photo format or size');
            const id = crypto.randomUUID(), path = `${jobId}/${id}.${extension}`;
            await result(service.from('st_upload_tickets').insert({ id, actor_id: ctx.appUser.id, job_id: jobId, category: String(body.category || 'Proof'), storage_path: path, file_name: String(body.fileName || `photo.${extension}`).slice(0, 255), mime: body.mime, file_size: body.fileSize }));
            const signed = await result(service.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path));
            return { uploadId: id, path, token: signed.token, bucket: MEDIA_BUCKET };
        }
        if (action === 'photos/finalize' && method === 'POST') {
            const ticket = await result(service.from('st_upload_tickets').select('*').eq('id', String(body.uploadId)).eq('actor_id', ctx.appUser.id).eq('job_id', jobId).single());
            if (!ticket.photo_id) {
                if (Date.parse(ticket.expires_at) < Date.now())
                    throw new ApiError('Upload expired', 409);
                const file = await result(service.storage.from(MEDIA_BUCKET).download(ticket.storage_path));
                if (file.size !== Number(ticket.file_size))
                    throw new ApiError('Uploaded file size does not match');
                try {
                    validateMedia(new Uint8Array(await file.arrayBuffer()), ticket.mime);
                }
                catch (error) {
                    throw new ApiError(error.message);
                }
            }
            const photo = await result(service.rpc('st_finalize_upload', { p_actor_id: ctx.appUser.id, p_ticket: ticket.id }).single());
            const signed = await result(service.storage.from(MEDIA_BUCKET).createSignedUrl(photo.storage_path, 3600));
            return { photo: { ...photo, url: signed.signedUrl } };
        }
        if (action === 'photos' && method === 'POST') {
            if (['COMPLETED', 'CANCELLED'].includes(job.status))
                throw new ApiError('Completed or cancelled jobs cannot be changed', 409);
            const dataUrl = String(body.dataBase64 || '');
            const encoded = dataUrl.includes(',') ? dataUrl.split(',', 2)[1] : dataUrl;
            if (!encoded)
                throw new ApiError('Photo data is required');
            if (encoded.length > 7 * 1024 * 1024)
                throw new ApiError('Photo is too large', 413);
            let bytes: Uint8Array;
            try {
                bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
            }
            catch {
                throw new ApiError('Invalid photo encoding');
            }
            const mime = String(body.mime || 'image/jpeg');
            let extension: string;
            try {
                extension = validatePhoto(bytes, mime);
            }
            catch (error) {
                throw new ApiError(error.message);
            }
            const path = `${jobId}/${crypto.randomUUID()}.${extension}`;
            await result(service.storage.from(MEDIA_BUCKET).upload(path, bytes, { contentType: mime, upsert: false }));
            let photo: AnyRow;
            try {
                photo = await result(service.rpc('st_record_job_photo', { p_actor_id: ctx.appUser.id, p_job_id: jobId, p_category: String(body.category || 'Proof'), p_path: path, p_name: String(body.fileName || `photo.${extension}`), p_mime: mime, p_size: bytes.length }).single());
            }
            catch (error) {
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
    return { routeCleaner };
}
