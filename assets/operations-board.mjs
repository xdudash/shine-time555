/** Pure presentation derivation for jobs already authorized and scoped to a day by the API. */
const BUCKETS = ['all', 'unassigned', 'assigned', 'active', 'atRisk', 'review', 'completed', 'cancelled'];
const scalar = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const normalized = value => scalar(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const upper = value => scalar(value).toUpperCase();
const cleanerId = job => scalar(job.assigned_cleaner_id);
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;

/**
 * Exclusive primary bucket; review/rework and terminal state outrank stale risk.
 * An offer is not an accepted assignment. Unknown states remain visible using
 * cleaner presence, and historical COMPLETED rows without review are complete.
 */
export function bucketForJob(job) {
  const status = upper(job?.status), review = upper(job?.review_status);
  if (status === 'CANCELLED') return 'cancelled';
  if (review === 'PENDING') return 'review';
  if (review === 'REWORK_REQUIRED') return 'active';
  if (status === 'COMPLETED') return 'completed';
  if (['RED', 'ORANGE'].includes(upper(job?.risk_level)) || ['AT_RISK', 'RESCUE'].includes(status)) return 'atRisk';
  if (['UNASSIGNED', 'OFFERED'].includes(status)) return 'unassigned';
  if (['ARRIVED', 'CLEANING'].includes(status)) return 'active';
  return job && cleanerId(job) ? 'assigned' : 'unassigned';
}

function timeOrder(value) {
  // API exposes local service-day clock times; do not reinterpret in browser TZ.
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(scalar(value));
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] || 0) > 59) return Infinity;
  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3] || 0);
}

function riskOrder(job) {
  const status = upper(job.status);
  return Math.max(({RED:3, ORANGE:2, GREEN:1})[upper(job.risk_level)] || 0,
    ['RESCUE', 'AT_RISK'].includes(status) ? 3 : 0);
}

function score(job) {
  const value = Number(scalar(job.risk_score));
  return Number.isFinite(value) ? value : 0;
}

function compareIds(a, b) {
  const left = scalar(a), right = scalar(b);
  if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
    const difference = compareText(BigInt(left), BigInt(right));
    if (difference) return difference;
  }
  return compareText(left, right);
}

function urgency(a, b) {
  return riskOrder(b) - riskOrder(a)
    || score(b) - score(a)
    || timeOrder(a.deadline) - timeOrder(b.deadline)
    || timeOrder(a.planned_start) - timeOrder(b.planned_start)
    || compareIds(a.id, b.id);
}

/**
 * Counts apply query, zone and cleaner filters before the selected bucket, so
 * switching tabs does not change other tab counts. Their sum (excluding all)
 * equals all. Options use the full supplied day, remaining stable under filters.
 * Returns original job references in a fresh array; never mutates caller data.
 * This module does not authorize records or calculate server risk thresholds.
 * @returns {{jobs: object[], counts: object, zones: string[], cleaners: {id: string, name: string}[]}}
 */
export function deriveBoard(jobs, options = {}) {
  const rows = Array.isArray(jobs) ? jobs.filter(job => job && typeof job === 'object' && !Array.isArray(job)) : [];
  const { query = '', bucket = 'all', zone = '', cleanerId: selectedCleaner = '' } = options || {};
  const search = normalized(query), zoneFilter = scalar(zone), cleanerFilter = scalar(selectedCleaner);
  const counts = Object.fromEntries(BUCKETS.map(key => [key, 0]));
  const cleanerMap = new Map();
  for (const job of rows) {
    const id = cleanerId(job), name = scalar(job.cleaner_name);
    if (id && (!cleanerMap.has(id) || (name && (!cleanerMap.get(id) || compareText(name, cleanerMap.get(id)) < 0)))) cleanerMap.set(id, name);
  }
  const filtered = rows.filter(job => {
    if (zoneFilter && scalar(job.zone) !== zoneFilter) return false;
    if (cleanerFilter && cleanerId(job) !== cleanerFilter) return false;
    return !search || ['object_code', 'object_name', 'address', 'cleaner_name', 'zone']
      .some(key => normalized(job[key]).includes(search));
  });
  for (const job of filtered) { counts.all++; counts[bucketForJob(job)]++; }
  const chosenBucket = BUCKETS.includes(bucket) ? bucket : 'all';
  return {
    jobs: filtered.filter(job => chosenBucket === 'all' || bucketForJob(job) === chosenBucket).sort(urgency),
    counts,
    zones: [...new Set(rows.map(job => scalar(job.zone)).filter(Boolean))].sort((a,b) => compareText(normalized(a), normalized(b)) || compareText(a,b)),
    cleaners: [...cleanerMap].map(([id,name]) => ({id,name:name || id})).sort((a,b) => compareText(normalized(a.name), normalized(b.name)) || compareIds(a.id,b.id)),
  };
}
