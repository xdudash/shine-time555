import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { activeAssignmentStatuses, availableBookingSlots, cleanerEarningsSummary, clientAccountRows, coordinatesForStorage, financeBoardReport, marketplaceForCleaner, riskForJob, roleCapabilities, settingsFromRows } from './logic.mjs';
import { marketplaceJobs, projectResponse } from './security.mjs';
import { operationsRoute } from './operations.mjs';
import { validatePhoto, validateMedia } from './media.mjs';
type AnyRow = Record<string, any>;
export function createAuth(deps: any) {
    const { SUPABASE_URL, SERVICE_KEY, PUBLIC_KEY, MEDIA_BUCKET, APP_BUILD, COMPATIBLE_BUILDS, service, ApiError, cors, json, today, currentTime, toMinutes, toTime, same, unique, number, truthy, validLanguage, normalizedEmail, validEmail, code, objectCoordinates, baseChecklist, monthEnd, result, one, settings } = deps;
    async function authOnly(req: Request) {
        const authorization = req.headers.get('authorization') || '';
        if (!authorization.toLowerCase().startsWith('bearer '))
            throw new ApiError('Authentication required', 401);
        const client = createClient(SUPABASE_URL, PUBLIC_KEY, {
            auth: { persistSession: false }, global: { headers: { Authorization: authorization } },
        });
        const { data, error } = await client.auth.getUser();
        if (error || !data.user)
            throw new ApiError('Authentication required', 401);
        return { authUser: data.user, userClient: client };
    }
    async function context(req: Request) {
        const identity = await authOnly(req);
        const { data: appUser, error } = await service.from('st_users').select('*').eq('auth_user_id', identity.authUser.id).maybeSingle();
        if (error)
            throw new ApiError(error.message, 400);
        if (!appUser || !appUser.active)
            throw new ApiError('This account is not activated by Operations', 403);
        const [cleaner, client] = await Promise.all([
            appUser.role === 'CLEANER' ? result(service.from('st_cleaners').select('*').eq('user_id', appUser.id).maybeSingle()) : null,
            ['OWNER', 'PROPERTY_MANAGER'].includes(appUser.role) ? result(service.from('st_client_accounts').select('*').eq('user_id', appUser.id).maybeSingle()) : null,
        ]);
        return { ...identity, appUser, cleaner, client };
    }
    function requireRole(ctx: any, roles: string | string[]) {
        const allowed = Array.isArray(roles) ? roles : [roles];
        if (!allowed.includes(ctx.appUser.role))
            throw new ApiError('Forbidden', 403);
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
    async function bootstrap(req: Request, body: AnyRow) {
        const { authUser } = await authOnly(req);
        const fullName = String(body.fullName || '').trim();
        if (!fullName)
            throw new ApiError('Full name is required');
        const existing = await result(service.from('st_users').select('*').eq('auth_user_id', authUser.id).maybeSingle()) as AnyRow | null;
        if (existing)
            return { user: existing };
        const claimed = await result(service.from('st_bootstrap_state')
            .update({ initialized_auth_user_id: authUser.id, initialized_at: new Date().toISOString() })
            .eq('id', 1).is('initialized_auth_user_id', null).select()) as AnyRow[];
        if (!claimed.length)
            throw new ApiError('Initial administrator already exists', 403);
        try {
            const user = await one(service.from('st_users').insert({
                auth_user_id: authUser.id, email: String(authUser.email || '').toLowerCase(), role: 'ADMIN',
                full_name: fullName, phone: String(body.phone || ''), language: validLanguage(body.language), active: true,
            }).select().single()) as AnyRow;
            return { user };
        }
        catch (error) {
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
            if (!currentPassword || newPassword.length < 8)
                throw new ApiError('Current password and a new password of at least 8 characters are required');
            const { error } = await ctx.userClient.auth.signInWithPassword({ email: ctx.authUser.email || '', password: currentPassword });
            if (error)
                throw new ApiError('Current password is incorrect', 403);
            await result(service.auth.admin.updateUserById(ctx.authUser.id, { password: newPassword }));
            return { ok: true };
        }
        throw new ApiError('Route not found', 404);
    }
    return { authOnly, context, requireRole, publicUser, bootstrap, account };
}
