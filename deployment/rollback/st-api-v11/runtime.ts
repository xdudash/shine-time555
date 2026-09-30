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
const objectCoordinates = (lat: unknown, lng: unknown) => {
    try {
        return coordinatesForStorage({ lat, lng });
    }
    catch (error) {
        throw new ApiError(error instanceof Error ? error.message : 'Invalid coordinates');
    }
};
const baseChecklist = [
    ['Remove old linen', true, false, null], ['Make beds', true, true, 'Bedroom'], ['Bathroom', true, true, 'Bathroom'], ['Toilet', true, false, null],
    ['Kitchen', true, true, 'Kitchen'], ['Check refrigerator', true, false, null], ['Take out trash', true, false, null], ['Vacuum', true, false, null],
    ['Mop floor', true, false, null], ['Fresh towels', true, false, null], ['Toilet paper', true, false, null], ['Soap / amenities', true, false, null],
    ['Check windows', true, false, null], ['Lights off', true, false, null], ['Final living-area photo', true, true, 'Living area'], ['Final walkthrough', true, false, null],
];
function monthEnd(month: string) {
    const next = new Date(`${month}-01T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    next.setUTCDate(0);
    return next.toISOString().slice(0, 10);
}
async function result<T>(query: PromiseLike<{
    data: T;
    error: any;
}>): Promise<T> {
    const { data, error } = await query;
    if (error)
        throw new ApiError(error.message, Number(error.code) === 23505 ? 409 : 400);
    return data;
}
async function one<T>(query: PromiseLike<{
    data: T;
    error: any;
}>): Promise<T> {
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
export const runtime = { SUPABASE_URL, SERVICE_KEY, PUBLIC_KEY, MEDIA_BUCKET, APP_BUILD, COMPATIBLE_BUILDS, service, ApiError, cors, json, today, currentTime, toMinutes, toTime, same, unique, number, truthy, validLanguage, normalizedEmail, validEmail, code, objectCoordinates, baseChecklist, monthEnd, result, one, settings };
