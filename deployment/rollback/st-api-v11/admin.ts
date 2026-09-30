import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { activeAssignmentStatuses, availableBookingSlots, cleanerEarningsSummary, clientAccountRows, coordinatesForStorage, financeBoardReport, marketplaceForCleaner, riskForJob, roleCapabilities, settingsFromRows } from './logic.mjs';
import { marketplaceJobs, projectResponse } from './security.mjs';
import { operationsRoute } from './operations.mjs';
import { validatePhoto, validateMedia } from './media.mjs';
type AnyRow = Record<string, any>;
export function createAdmin(deps: any) {
    const { SUPABASE_URL, SERVICE_KEY, PUBLIC_KEY, MEDIA_BUCKET, APP_BUILD, COMPATIBLE_BUILDS, service, ApiError, cors, json, today, currentTime, toMinutes, toTime, same, unique, number, truthy, validLanguage, normalizedEmail, validEmail, code, objectCoordinates, baseChecklist, monthEnd, result, one, settings, authOnly, context, requireRole, publicUser, bootstrap, account, insertEvent, jobCommand, notify, fetchRows, hydrateJobs, getJob, jobFor, jobDetails, activeCleaners, capacity, reschedule, ensureJobChecklist, createJob } = deps;
    async function createManagedUser(role: string, body: AnyRow) {
        if (!body.email || !body.password || !body.fullName)
            throw new ApiError('email, password and fullName are required');
        if (!validEmail(body.email))
            throw new ApiError('Valid email is required');
        if (String(body.password).length < 8)
            throw new ApiError('Password must be at least 8 characters');
        const email = normalizedEmail(body.email);
        const { data, error } = await service.auth.admin.createUser({ email, password: String(body.password), email_confirm: true, user_metadata: {} });
        if (error || !data.user)
            throw new ApiError(error?.message || 'Cannot create account', 409);
        try {
            const user = await one(service.from('st_users').insert({ auth_user_id: data.user.id, email, role, full_name: String(body.fullName), phone: String(body.phone || ''), language: validLanguage(body.language) }).select().single()) as AnyRow;
            if (role === 'CLEANER') {
                const cleaner = await one(service.from('st_cleaners').insert({ user_id: user.id, mode: body.mode === 'GUARANTEE' ? 'GUARANTEE' : 'FLEX', reliability_score: number(body.reliabilityScore, 95), rating: number(body.rating, 5), transport: ['CAR', 'PUBLIC', 'WALKING'].includes(body.transport) ? body.transport : 'PUBLIC', preferred_zones: Array.isArray(body.preferredZones) ? body.preferredZones : [], max_jobs_day: number(body.maxJobsDay, 5) }).select().single()) as AnyRow;
                return { user, cleaner };
            }
            const client = await one(service.from('st_client_accounts').insert({ user_id: user.id, account_type: role, company_name: body.companyName || null, billing_name: body.billingName || null, ico: body.ico || null, dic: body.dic || null, ic_dph: body.icDph || null, billing_address: body.billingAddress || null, notes: body.notes || null }).select().single()) as AnyRow;
            return { client };
        }
        catch (error) {
            await service.auth.admin.deleteUser(data.user.id);
            throw error;
        }
    }
    async function updateManagedLoginEmail(user: AnyRow, value: unknown) {
        const email = normalizedEmail(value);
        if (!validEmail(email))
            throw new ApiError('Valid email is required');
        if (email === normalizedEmail(user.email))
            return;
        const duplicate = await result(service.from('st_users').select('id').eq('email', email).neq('id', user.id).maybeSingle()) as AnyRow | null;
        if (duplicate)
            throw new ApiError('This email is already used by another account', 409);
        await result(service.auth.admin.updateUserById(user.auth_user_id, { email, email_confirm: true }));
        await result(service.from('st_users').update({ email }).eq('id', user.id));
    }
    async function routeAdmin(ctx: any, route: string, method: string, query: AnyRow, body: AnyRow) {
        const capabilities = roleCapabilities(ctx.appUser.role);
        if (!capabilities.operations)
            throw new ApiError('Forbidden', 403);
        const accountRoute = route === 'admin/settings'
            || (route === 'admin/cleaners' && method === 'POST')
            || (route === 'admin/clients' && method === 'POST')
            || /^admin\/(cleaners|clients)\/\d+(?:\/password)?$/.test(route);
        if ((route.startsWith('admin/finance') && !capabilities.finance) || (accountRoute && !capabilities.access))
            throw new ApiError('Forbidden', 403);
        if (body.serviceCategory !== undefined && !['SHORT_STAY', 'HOME', 'OFFICE', 'COMMON_AREAS', 'OTHER'].includes(body.serviceCategory))
            throw new ApiError('Invalid service category');
        const portfolio = route.match(/^admin\/clients\/(\d+)\/properties(?:\/(\d+))?$/);
        if (portfolio) {
            if (ctx.appUser.role !== 'ADMIN')
                throw new ApiError('Forbidden', 403);
            const manager = await one(service.from('st_client_accounts').select('id,user_id,account_type').eq('id', Number(portfolio[1])).single());
            const managerUser = await one(service.from('st_users').select('role,active').eq('id', manager.user_id).single());
            if (manager.account_type !== 'PROPERTY_MANAGER' || managerUser.role !== 'PROPERTY_MANAGER' || !managerUser.active)
                throw new ApiError('Active property manager required');
            if (method === 'GET' && !portfolio[2])
                return { objectIds: (await result(service.from('st_manager_properties').select('object_id').eq('manager_client_id', manager.id))).map((r: AnyRow) => r.object_id) };
            const objectId = Number(portfolio[2] || body.objectId);
            if (!Number.isSafeInteger(objectId) || objectId <= 0)
                throw new ApiError('Choose a property');
            await one(service.from('st_objects').select('id').eq('id', objectId).single());
            if (method === 'POST' && !portfolio[2]) {
                await result(service.from('st_manager_properties').upsert({ manager_client_id: manager.id, object_id: objectId, assigned_by_user_id: ctx.appUser.id }, { onConflict: 'manager_client_id,object_id' }));
                return { ok: true };
            }
            if (method === 'DELETE' && portfolio[2]) {
                await result(service.from('st_manager_properties').delete().eq('manager_client_id', manager.id).eq('object_id', objectId));
                return { ok: true };
            }
            throw new ApiError('Method not allowed', 405);
        }
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
            if (items.length)
                await result(service.from('st_checklist_items').insert(items.map((item: AnyRow, index: number) => ({ object_id: objectId, label: String(item.label || ''), required: item.required !== false, photo_required: truthy(item.photoRequired), photo_category: item.photoCategory || null, sort_order: index + 1 }))));
            return { ok: true };
        }
        const objectRoute = route.match(/^admin\/objects\/(\d+)$/);
        if (objectRoute) {
            const id = number(objectRoute[1]);
            if (method === 'GET')
                return { object: await one(service.from('st_objects').select('*').eq('id', id).single()) };
            if (method === 'PATCH') {
                const map: AnyRow = { name: body.name, address: body.address, zone: body.zone, service_category: body.serviceCategory, apartment_type: body.apartmentType, bedrooms: body.bedrooms, bathrooms: body.bathrooms, lat: body.lat, lng: body.lng, checkout_time: body.checkoutTime, deadline_time: body.deadlineTime, duration_minutes: body.durationMinutes, payout: body.payout, client_price: body.clientPrice, active: body.active, approval_status: body.approvalStatus, client_id: body.clientId, access_instructions: body.accessInstructions, key_instructions: body.keyInstructions, parking: body.parking, linen_location: body.linenLocation, supplies_location: body.suppliesLocation, wifi: body.wifi, notes: body.notes };
                if (body.lat !== undefined || body.lng !== undefined) {
                    const current = await one(service.from('st_objects').select('lat,lng').eq('id', id).single()) as AnyRow;
                    const coordinates = objectCoordinates(body.lat !== undefined ? body.lat : current.lat, body.lng !== undefined ? body.lng : current.lng);
                    map.lat = coordinates.lat;
                    map.lng = coordinates.lng;
                }
                const updates = Object.fromEntries(Object.entries(map).filter(([, value]) => value !== undefined));
                if (!Object.keys(updates).length)
                    return { object: await one(service.from('st_objects').select('*').eq('id', id).single()) };
                return { object: await one(service.from('st_objects').update(updates).eq('id', id).select().single()) };
            }
            if (method === 'DELETE') {
                await result(service.from('st_objects').delete().eq('id', id));
                return { ok: true };
            }
        }
        if (route === 'admin/jobs' && method === 'GET') {
            let builder: any = service.from('st_jobs').select('*').eq('service_date', date).order('planned_start');
            if (query.status)
                builder = builder.eq('status', query.status);
            if (query.cleanerId)
                builder = builder.eq('assigned_cleaner_id', number(query.cleanerId));
            return { jobs: await hydrateJobs(await result(builder) as AnyRow[]) };
        }
        if (route === 'admin/jobs' && method === 'POST') {
            const job = await createJob(ctx, body);
            await insertEvent(job.id, ctx.appUser.id, 'JOB_CREATED', { serviceDate: body.serviceDate });
            return { job: (await hydrateJobs([job]))[0] };
        }
        if (route === 'admin/jobs/generate' && method === 'POST') {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.serviceDate || '')))
                throw new ApiError('serviceDate required');
            const objects = body.objectIds?.length ? await fetchRows('st_objects', body.objectIds) : await result(service.from('st_objects').select('*').eq('active', true)) as AnyRow[];
            const created: number[] = [], skipped: number[] = [];
            for (const object of objects) {
                try {
                    const job = await createJob(ctx, { objectId: object.id, serviceDate: body.serviceDate, marketplaceVisible: body.publish !== false });
                    created.push(job.id);
                    await insertEvent(job.id, ctx.appUser.id, 'JOB_GENERATED', { serviceDate: body.serviceDate });
                }
                catch (error) {
                    if (error instanceof ApiError && error.status === 409)
                        skipped.push(object.id);
                    else
                        throw error;
                }
            }
            return { created: created.length, skipped, jobIds: created };
        }
        const jobRoute = route.match(/^admin\/jobs\/(\d+)(?:\/(assign|rescue|bonus|cancel))?$/);
        if (jobRoute) {
            const id = number(jobRoute[1]);
            const action = jobRoute[2] || '';
            if (!action && method === 'GET')
                return jobDetails(ctx, id);
            if (action === 'cancel' && method === 'POST')
                return { job: (await hydrateJobs([await jobCommand(ctx, id, 'cancel', body)]))[0] };
            if (!action && method === 'PATCH') {
                return { job: (await hydrateJobs([await jobCommand(ctx, id, 'patch', body)]))[0] };
            }
            const job = await getJob(id);
            const terminal = ['COMPLETED', 'CANCELLED'].includes(job.status);
            if (['assign', 'rescue'].includes(action) && terminal)
                throw new ApiError('Completed or cancelled jobs cannot be reassigned', 409);
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
            const byId = new Map(rows.map((item) => [String(item.id), item]));
            const userById = new Map(users.map((item) => [String(item.id), item]));
            return { cleaners: all.map((cleaner) => ({ ...cleaner, ...userById.get(String(cleaner.user_id)), ...(byId.get(String(cleaner.id)) || { available: false, availability: { online: false, fromTime: '10:00', toTime: '15:00' } }), id: cleaner.id, today_jobs: rawJobs.filter((job) => same(job.assigned_cleaner_id, cleaner.id) && job.status !== 'CANCELLED').length, today_earnings: rawJobs.filter((job) => same(job.assigned_cleaner_id, cleaner.id) && job.status === 'COMPLETED').reduce((sum, job) => sum + number(job.payout) + number(job.bonus), 0) })) };
        }
        if (route === 'admin/cleaners' && method === 'POST')
            return createManagedUser('CLEANER', body);
        const cleanerRoute = route.match(/^admin\/cleaners\/(\d+)(?:\/(password))?$/);
        if (cleanerRoute) {
            const cleanerId = number(cleanerRoute[1]);
            const cleaner = await one(service.from('st_cleaners').select('*').eq('id', cleanerId).single()) as AnyRow;
            if (cleanerRoute[2] === 'password' && method === 'POST') {
                if (String(body.password || '').length < 10)
                    throw new ApiError('Temporary password must be at least 10 characters');
                const user = await one(service.from('st_users').select('*').eq('id', cleaner.user_id).single()) as AnyRow;
                await result(service.auth.admin.updateUserById(user.auth_user_id, { password: String(body.password) }));
                await notify(user.id, 'SECURITY', 'Password reset', 'Operations reset your login password.');
                return { ok: true };
            }
            if (method === 'PATCH') {
                const updates: AnyRow = { mode: body.mode, reliability_score: body.reliabilityScore, rating: body.rating, transport: body.transport, preferred_zones: body.preferredZones, max_jobs_day: body.maxJobsDay, active: body.active };
                await result(service.from('st_cleaners').update(Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined))).eq('id', cleanerId));
                const user = await one(service.from('st_users').select('*').eq('id', cleaner.user_id).single()) as AnyRow;
                if (body.email !== undefined)
                    await updateManagedLoginEmail(user, body.email);
                const userUpdates: AnyRow = { active: body.active, full_name: body.fullName, phone: body.phone, language: body.language && validLanguage(body.language) };
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
        if (route === 'admin/clients' && method === 'POST')
            return createManagedUser(['PROPERTY_MANAGER', 'MANAGER'].includes(String(body.accountType)) ? 'PROPERTY_MANAGER' : 'OWNER', body);
        const clientRoute = route.match(/^admin\/clients\/(\d+)(?:\/(password))?$/);
        if (clientRoute) {
            const clientId = number(clientRoute[1]);
            const client = await one(service.from('st_client_accounts').select('*').eq('id', clientId).single()) as AnyRow;
            const user = await one(service.from('st_users').select('*').eq('id', client.user_id).single()) as AnyRow;
            if (clientRoute[2] === 'password' && method === 'POST') {
                if (String(body.password || '').length < 10)
                    throw new ApiError('Temporary password must be at least 10 characters');
                await result(service.auth.admin.updateUserById(user.auth_user_id, { password: String(body.password) }));
                return { ok: true };
            }
            if (method === 'PATCH') {
                if (body.email !== undefined)
                    await updateManagedLoginEmail(user, body.email);
                await result(service.from('st_users').update({ full_name: body.fullName ?? user.full_name, phone: body.phone ?? user.phone, language: body.language ? validLanguage(body.language) : user.language, active: body.active ?? user.active }).eq('id', user.id));
                const updates: AnyRow = { account_type: body.accountType === 'MANAGER' ? 'PROPERTY_MANAGER' : body.accountType, company_name: body.companyName, billing_name: body.billingName, ico: body.ico, dic: body.dic, ic_dph: body.icDph, billing_address: body.billingAddress, notes: body.notes };
                const accountUpdates = Object.fromEntries(Object.entries(updates).filter(([, value]) => value !== undefined));
                if (!Object.keys(accountUpdates).length)
                    return { client };
                return { client: await one(service.from('st_client_accounts').update(accountUpdates).eq('id', clientId).select().single()) };
            }
        }
        if (route === 'admin/finance' && method === 'GET') {
            const month = /^\d{4}-\d{2}$/.test(String(query.month || '')) ? String(query.month) : today().slice(0, 7);
            const from = `${month}-01`, to = monthEnd(month);
            const trendStart = new Date(`${month}-01T12:00:00Z`);
            trendStart.setUTCMonth(trendStart.getUTCMonth() - 11);
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
            if (number(body.amount) <= 0 || !['INCOME', 'EXPENSE'].includes(String(body.entryType)))
                throw new ApiError('Valid type and positive amount are required');
            return { entry: await one(service.from('st_financial_entries').insert({ entry_date: body.entryDate || today(), entry_type: body.entryType, category: body.category || 'OTHER', amount: number(body.amount), description: body.description || null, client_id: body.clientId || null, object_id: body.objectId || null, job_id: body.jobId || null, created_by_user_id: ctx.appUser.id }).select().single()) };
        }
        const financeEntry = route.match(/^admin\/finance\/entries\/(\d+)$/);
        if (financeEntry && method === 'DELETE') {
            await result(service.from('st_financial_entries').delete().eq('id', number(financeEntry[1])));
            return { ok: true };
        }
        if (route === 'admin/issues' && method === 'GET') {
            const issues = await result(service.from('st_issues').select('*').order('status').order('priority').order('id', { ascending: false })) as AnyRow[];
            const jobs = await fetchRows('st_jobs', issues.map((issue) => issue.job_id));
            const hydrated = await hydrateJobs(jobs);
            const jobById = new Map(hydrated.map((job) => [String(job.id), job]));
            return { issues: issues.map((issue) => ({ ...issue, ...{ object_code: jobById.get(String(issue.job_id))?.object_code, address: jobById.get(String(issue.job_id))?.address, cleaner_name: jobById.get(String(issue.job_id))?.cleaner_name, service_date: jobById.get(String(issue.job_id))?.service_date }, photos: issue.photos_json || [] })) };
        }
        const issueRoute = route.match(/^admin\/issues\/(\d+)$/);
        if (issueRoute && method === 'PATCH') {
            const issue = await one(service.from('st_issues').update({ status: body.status || 'OPEN', resolution_note: body.resolutionNote || null, resolved_at: body.status === 'RESOLVED' ? new Date().toISOString() : null }).eq('id', number(issueRoute[1])).select().single()) as AnyRow;
            if (issue.status === 'RESOLVED') {
                const remaining = await result(service.from('st_issues').select('id').eq('job_id', issue.job_id).eq('status', 'OPEN')) as AnyRow[];
                if (!remaining.length)
                    await result(service.from('st_jobs').update({ issue_flag: false }).eq('id', issue.job_id));
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
        if (route === 'admin/settings' && method === 'GET')
            return { settings: await settings() };
        if (route === 'admin/settings' && method === 'PATCH') {
            const updates = Object.entries(body).filter(([key]) => key !== "requestId").map(([key, value]) => ({ setting_key: key, value_json: value }));
            if (updates.length)
                await result(service.from('st_settings').upsert(updates, { onConflict: 'setting_key' }));
            return { settings: await settings() };
        }
        throw new ApiError('Route not found', 404);
    }
    return { createManagedUser, updateManagedLoginEmail, routeAdmin };
}
