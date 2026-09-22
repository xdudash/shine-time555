const minutes = (value) => {
  const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(value || ''));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
};

const time = (value) => `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

export function availableBookingSlots({ object, cleaners, jobs, windows, durationMinutes, settings, stepMinutes }) {
  const safety = Math.max(0, Number(settings?.safetyBuffer ?? 10));
  const buffer = safety + Math.max(0, Number(settings?.travelBuffer ?? 15));
  const duration = Number(durationMinutes);
  const step = Number(stepMinutes);
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(step) || step <= 0) return [];
  const cleanerRows = cleaners?.length ? cleaners.filter((item) => item.active !== false) : windows.map((window) => ({ id: window.cleaner_id, active: true }));
  const objectStart = minutes(object?.checkout_time ?? object?.earliest_start ?? '00:00');
  const objectEnd = minutes(object?.deadline_time ?? object?.deadline ?? '23:59');
  if (objectStart === null || objectEnd === null || objectStart >= objectEnd) return [];
  const output = new Set();
  for (const cleaner of cleanerRows) {
    const window = windows.find((item) => String(item.cleaner_id ?? item.cleanerId) === String(cleaner.id))
      ?? (!cleaners?.length ? windows.find((item) => item.online) : null);
    if (!window?.online) continue;
    const assigned = jobs.filter((job) => job.status !== 'CANCELLED' && String(job.assigned_cleaner_id) === String(cleaner.id));
    const max = Number(cleaner.max_jobs_day);
    if (Number.isFinite(max) && assigned.length >= max) continue;
    const occupied = assigned.map((job) => {
      const start = minutes(job.planned_start || job.earliest_start);
      return start === null ? null : { start, end: start + Number(job.duration_minutes || 0) };
    }).filter(Boolean);
    const from = minutes(window.from_time ?? window.fromTime);
    const to = minutes(window.to_time ?? window.toTime);
    if (from === null || to === null || from >= to) continue;
    const start = Math.max(from, objectStart);
    const end = Math.min(to, objectEnd);
    for (let candidate = start; candidate + duration + safety <= end; candidate += step) {
      const candidateEnd = candidate + duration;
      const clashes = occupied.some((item) => candidate < item.end + buffer && candidateEnd + buffer > item.start);
      if (!clashes) output.add(time(candidate));
    }
  }
  return [...output].sort();
}

export function riskForJob(job, currentTime) {
  const reasons = [];
  let score = 0;
  if (!job.assigned_cleaner_id && ['UNASSIGNED', 'AT_RISK', 'RESCUE'].includes(job.status)) {
    score += 60;
    reasons.push('Unassigned');
  }
  const remaining = minutes(job.deadline || '15:00') - minutes(currentTime);
  if (remaining <= Number(job.duration_minutes || 0)) {
    score += 35;
    reasons.push('Deadline pressure');
  }
  if (job.status === 'RESCUE') {
    score = Math.max(score, 90);
    if (!reasons.includes('Rescue')) reasons.push('Rescue');
  }
  const level = score >= 75 ? 'RED' : score >= 45 ? 'ORANGE' : 'GREEN';
  return { score: Math.min(100, score), level, reasons };
}

export function settingsFromRows(rows) {
  return Object.fromEntries(rows.map((row) => [row.setting_key, row.value_json]));
}

export function roleCapabilities(role) {
  if (role === 'ADMIN') return { operations: true, finance: true, access: true, portfolio: 'all' };
  if (role === 'OPERATIONS_MANAGER') return { operations: true, finance: false, access: false, portfolio: 'all' };
  if (role === 'PROPERTY_MANAGER') return { operations: false, finance: false, access: false, portfolio: 'assigned' };
  return { operations: false, finance: false, access: false, portfolio: 'owned' };
}

const toNumber = (value) => Number(value || 0);

export function financeBreakdown({ jobs, entries }) {
  const byClient = new Map();
  const byObject = new Map();
  const add = (bucket, item, revenue, cost, jobsCount = 0) => {
    if (!item?.id) return;
    const current = bucket.get(item.id) || { ...item, jobs: 0, revenue: 0, cost: 0, profit: 0 };
    current.jobs += jobsCount;
    current.revenue += revenue;
    current.cost += cost;
    current.profit = current.revenue - current.cost;
    bucket.set(item.id, current);
  };

  const completed = jobs.filter((job) => job.status === 'COMPLETED');
  for (const job of completed) {
    const revenue = toNumber(job.client_price) + toNumber(job.extra_revenue);
    const cost = toNumber(job.payout) + toNumber(job.bonus) + toNumber(job.extra_cost);
    add(byClient, { id: job.client_id, name: job.client_name || 'Unassigned client' }, revenue, cost, 1);
    add(byObject, { id: job.object_id, code: job.object_code || '—', name: job.object_name || 'Unnamed object' }, revenue, cost, 1);
  }
  for (const entry of entries) {
    const revenue = entry.entry_type === 'INCOME' ? toNumber(entry.amount) : 0;
    const cost = entry.entry_type === 'EXPENSE' ? toNumber(entry.amount) : 0;
    add(byClient, { id: entry.client_id, name: entry.client_name || 'Unassigned client' }, revenue, cost);
    add(byObject, { id: entry.object_id, code: entry.object_code || '—', name: entry.object_name || 'Unnamed object' }, revenue, cost);
  }
  const totalRevenue = completed.reduce((sum, job) => sum + toNumber(job.client_price) + toNumber(job.extra_revenue), 0) + entries.filter((entry) => entry.entry_type === 'INCOME').reduce((sum, entry) => sum + toNumber(entry.amount), 0);
  const totalExpenses = completed.reduce((sum, job) => sum + toNumber(job.payout) + toNumber(job.bonus) + toNumber(job.extra_cost), 0) + entries.filter((entry) => entry.entry_type === 'EXPENSE').reduce((sum, entry) => sum + toNumber(entry.amount), 0);
  const order = (items) => [...items.values()].sort((a, b) => b.revenue - a.revenue || a.name.localeCompare(b.name));
  return { summary: { totalRevenue, totalExpenses, profit: totalRevenue - totalExpenses, completedJobs: completed.length }, byClient: order(byClient), byObject: order(byObject) };
}

function twelveMonthTrend(jobs, entries, month) {
  const anchor = new Date(`${month}-01T12:00:00Z`);
  const points = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const point = new Date(anchor);
    point.setUTCMonth(point.getUTCMonth() - offset);
    const label = point.toISOString().slice(0, 7);
    const report = financeBreakdown({
      jobs: jobs.filter((job) => String(job.service_date || '').slice(0, 7) === label),
      entries: entries.filter((entry) => String(entry.entry_date || '').slice(0, 7) === label),
    });
    points.push({
      month: label,
      revenue: report.summary.totalRevenue,
      expenses: report.summary.totalExpenses,
      profit: report.summary.profit,
    });
  }
  return points;
}

export function financeBoardReport({ jobs, entries, month, trendJobs = jobs, trendEntries = entries }) {
  const report = financeBreakdown({ jobs, entries });
  const completed = jobs.filter((job) => job.status === 'COMPLETED');
  const sum = (items, predicate, value) => items.filter(predicate).reduce((total, item) => total + toNumber(value(item)), 0);
  const cleaningRevenue = sum(completed, () => true, (job) => toNumber(job.client_price) + toNumber(job.extra_revenue));
  const manualIncome = sum(entries, (entry) => entry.entry_type === 'INCOME', (entry) => entry.amount);
  const cleanerPayouts = sum(completed, () => true, (job) => job.payout);
  const cleanerBonuses = sum(completed, () => true, (job) => job.bonus);
  const jobExtraCosts = sum(completed, () => true, (job) => job.extra_cost);
  const manualExpenses = sum(entries, (entry) => entry.entry_type === 'EXPENSE', (entry) => entry.amount);
  const totalRevenue = report.summary.totalRevenue;
  const completedJobs = report.summary.completedJobs;

  return {
    summary: {
      ...report.summary,
      cleaningRevenue,
      manualIncome,
      cleanerPayouts,
      cleanerBonuses,
      jobExtraCosts,
      manualExpenses,
      marginPct: totalRevenue ? Math.round((report.summary.profit / totalRevenue) * 1000) / 10 : 0,
      avgRevenuePerJob: completedJobs ? totalRevenue / completedJobs : 0,
      avgProfitPerJob: completedJobs ? report.summary.profit / completedJobs : 0,
    },
    byClient: report.byClient,
    byObject: report.byObject,
    trend: twelveMonthTrend(trendJobs, trendEntries, month),
  };
}

export function clientAccountRows({ clients, users, objects, jobs, month }) {
  const userById = new Map(users.map((user) => [String(user.id), user]));
  return clients.map((client) => {
    const user = userById.get(String(client.user_id));
    const clientObjects = objects.filter((object) => String(object.client_id) === String(client.id));
    const monthJobs = jobs.filter((job) => String(job.client_id) === String(client.id)
      && String(job.service_date || '').slice(0, 7) === month
      && job.status !== 'CANCELLED');
    const completedJobs = monthJobs.filter((job) => job.status === 'COMPLETED');
    return {
      ...client,
      full_name: user?.full_name || '',
      email: user?.email || '',
      phone: user?.phone || '',
      language: user?.language || 'ru',
      user_active: Boolean(user?.active),
      objects: clientObjects.length,
      approved_objects: clientObjects.filter((object) => object.active && object.approval_status === 'APPROVED').length,
      month_jobs: monthJobs.length,
      month_revenue: completedJobs.reduce((sum, job) => sum + toNumber(job.client_price) + toNumber(job.extra_revenue), 0),
    };
  });
}

function storedCoordinate(value, axis) {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const normalized = String(value).trim().replace(',', '.');
  if (!/^[+-]?(?:\d+|\d+\.\d+|\.\d+)$/.test(normalized)) throw new Error(`Invalid ${axis === 'lat' ? 'latitude' : 'longitude'}`);
  const coordinate = Number(normalized);
  const limit = axis === 'lat' ? 90 : 180;
  if (!Number.isFinite(coordinate) || coordinate < -limit || coordinate > limit) throw new Error(`Invalid ${axis === 'lat' ? 'latitude' : 'longitude'}`);
  return coordinate;
}

export function coordinatesForStorage({ lat, lng }) {
  const latitude = storedCoordinate(lat, 'lat');
  const longitude = storedCoordinate(lng, 'lng');
  if ((latitude === null) !== (longitude === null)) throw new Error('Provide both latitude and longitude, or leave both empty');
  return { lat: latitude, lng: longitude };
}

const clock = (value, fallback) => {
  const candidate = minutes(value || fallback);
  return candidate === null ? minutes(fallback) : candidate;
};

const online = (value) => value === true || value === 1 || value === '1' || value === 'true';

export const activeAssignmentStatuses = ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'CLEANING'];

export function cleanerStatusTransitionAllowed(from, to) {
  return (
    (from === 'ACCEPTED' && to === 'EN_ROUTE')
    || (from === 'EN_ROUTE' && to === 'ARRIVED')
    || (from === 'ARRIVED' && to === 'CLEANING')
  );
}

export function marketplaceForCleaner({ cleaner, availability, assignedJobs, jobs, settings, now }) {
  const from = clock(availability?.from_time || availability?.fromTime, '10:00');
  const configuredEnd = clock(availability?.to_time || availability?.toTime, '15:00');
  const current = clock(now, '00:00');
  const safetyBuffer = Number(settings?.safetyBuffer ?? 10);
  const travelBuffer = Number(settings?.travelBuffer ?? 15);
  const configuredMax = Number(cleaner?.max_jobs_day);
  const maxJobs = Number.isFinite(configuredMax) ? Math.max(0, configuredMax) : 5;
  const activeAssigned = assignedJobs.filter((job) => job.status !== 'CANCELLED');
  const assignedIntervals = activeAssigned.map((job) => {
    const start = clock(job.planned_start || job.earliest_start, '10:00');
    return { start, finish: start + Math.max(0, Number(job.duration_minutes || 0)) + safetyBuffer };
  });

  const resultJobs = jobs.map((job) => {
    const start = clock(job.planned_start || job.earliest_start, '10:00');
    const projectedFinish = start + Math.max(0, Number(job.duration_minutes || 0)) + safetyBuffer;
    let feasibilityReason = null;
    if (!online(availability?.online)) feasibilityReason = 'Cleaner is offline';
    else if (activeAssigned.length >= maxJobs) feasibilityReason = 'Daily limit reached';
    else if (start < current) feasibilityReason = 'Job start has already passed';
    else if (start < from || projectedFinish > configuredEnd) feasibilityReason = 'Outside cleaner availability';
    else if (projectedFinish > clock(job.deadline, '23:59')) feasibilityReason = 'Outside object window';
    else if (assignedIntervals.some((item) => start < item.finish + travelBuffer && projectedFinish + travelBuffer > item.start)) feasibilityReason = 'Conflicts with an assigned job';
    return {
      ...job,
      feasible: !feasibilityReason,
      feasibility_reason: feasibilityReason,
      projected_finish: time(projectedFinish),
    };
  });

  return { jobs: resultJobs, bundles: [] };
}

export function cleanerEarningsSummary({ jobs, date }) {
  const completed = jobs.filter((job) => job.status === 'COMPLETED');
  const amount = (job) => toNumber(job.payout) + toNumber(job.bonus);
  return {
    total: completed.reduce((sum, job) => sum + amount(job), 0),
    completed: completed.length,
    today: completed.filter((job) => job.service_date === date).reduce((sum, job) => sum + amount(job), 0),
  };
}
