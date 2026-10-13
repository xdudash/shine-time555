const MARKETPLACE_FIELDS = [
  'id', 'object_id', 'service_date', 'earliest_start', 'deadline', 'duration_minutes',
  'status', 'planned_start', 'risk_score', 'risk_level', 'risk_reasons', 'rescue_state',
  'object_code', 'object_name', 'zone', 'apartment_type', 'bedrooms', 'bathrooms',
  'payout', 'bonus', 'feasible', 'feasibility_reason', 'projected_finish', 'earliest_feasible_start', 'latest_start', 'client_note',
];

const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$/;
const PASSWORD_MIN_LENGTH = 12;

export function marketplaceJob(job) {
  return Object.fromEntries(MARKETPLACE_FIELDS.filter((key) => job[key] !== undefined).map((key) => [key, job[key]]));
}

export function marketplaceJobs(jobs) {
  return jobs.map(marketplaceJob);
}

export function projectResponse(value,role){
  if(role==='ADMIN')return value;
  // A client complaint is addressed to operations, not to the cleaner: the
  // cleaner sees their rating as a number, never the client's words about them.
  const hidden=new Set(role==='CLEANER'?['client_price','object_client_price','extra_revenue','extra_cost','client_company','client_name','client_id','financial_status','feedback_comment','feedback_complaint','complaint_description']:
    role==='OPERATIONS_MANAGER'?['client_price','object_client_price','extra_revenue','extra_cost','financial_status','month_revenue','chargedCents','receivedCents','dueCents']:
    ['payout','bonus','extra_cost','object_notes','cleaner_reliability','review_note','reviewed_by_user_id','completion_counted','cleaner_phone','cleaner_mode','checkin_lat','checkin_lng','checkin_distance_m','escalated_at']);
  // Entry details (door codes, keys, Wi-Fi) reach a cleaner only while the job is actively theirs.
  const privateGuide=new Set(['access_instructions','key_instructions','parking','linen_location','supplies_location','wifi','object_notes']);
  const activeGuide=new Set(['ACCEPTED','EN_ROUTE','ARRIVED','CLEANING']);
  const visit=item=>Array.isArray(item)?item.map(visit):item&&typeof item==='object'?Object.fromEntries(Object.entries(item).filter(([key])=>!hidden.has(key)&&!(role==='CLEANER'&&item.object_id!==undefined&&!activeGuide.has(item.status)&&privateGuide.has(key))).map(([key,value])=>[key,visit(value)])):item;
  return visit(value);
}

/** Accept only bounded printable request IDs; invalid values are replaced server-side. */
export function normalizeRequestId(value, fallback) {
  const candidate = String(value ?? '').trim();
  return REQUEST_ID_RE.test(candidate) ? candidate : fallback;
}

/** One password policy for all managed-account creation and resets. */
export function isStrongPassword(value) {
  const password = String(value ?? '');
  return password.length >= PASSWORD_MIN_LENGTH && password.length <= 256;
}

export const SECURITY_LIMITS = Object.freeze({
  passwordMinLength: PASSWORD_MIN_LENGTH,
  requestIdMaxLength: 96,
});
