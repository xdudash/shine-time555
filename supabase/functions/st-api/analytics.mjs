// Operational analytics computed from what actually happened: the jobs in the
// period and their event trail. Pure functions, so every number in the admin
// page is reproducible in a test instead of being a placeholder.
//
// Deliberate choices:
//  * "on time" is measured against each job's OWN deadline, never a global
//    15:00 — properties have their own windows since the window booking.
//  * every rate carries the denominator it was computed from, so the page can
//    say "of 12" instead of implying a percentage of nothing.

const toMinutes = (value) => {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || ''));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

const stamp = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};

// The deadline as an instant: the service day plus the job's deadline time, read
// in the operating timezone (fixed offset is enough for a daily deadline).
function deadlineAt(job, offsetMinutes = 120) {
  const minutes = toMinutes(job.deadline);
  if (minutes === null || !job.service_date) return null;
  const base = new Date(`${job.service_date}T00:00:00.000Z`);
  if (!Number.isFinite(base.getTime())) return null;
  return new Date(base.getTime() + (minutes - offsetMinutes) * 60000);
}

// The operating-timezone offset for a given day, so a deadline written as a
// wall-clock time is compared at the right instant across the DST change.
export function zoneOffsetMinutes(isoDate, timeZone = 'Europe/Bratislava') {
  const at = new Date(`${isoDate}T12:00:00Z`);
  if (!Number.isFinite(at.getTime())) return 0;
  const local = new Date(`${at.toLocaleString('sv-SE', {timeZone}).replace(' ', 'T')}Z`);
  return Number.isFinite(local.getTime()) ? Math.round((local.getTime() - at.getTime()) / 60000) : 0;
}

const IMPORT_EVENTS = ['CRM_IMPORT', 'CRM_IMPORT_SAME_DAY'];

const percent = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

export function minutesBetween(from, to) {
  const start = stamp(from);
  const finish = stamp(to);
  if (!start || !finish) return null;
  return Math.round((finish.getTime() - start.getTime()) / 60000);
}

/**
 * @param jobs    st_jobs rows in the period
 * @param events  st_job_events rows for those jobs
 * @param issues  st_issues rows created in the period
 * @param offsetMinutes  operating timezone offset, Europe/Bratislava = 120 in summer
 */
export function operationsAnalytics({jobs = [], events = [], issues = [], offsetMinutes = 120} = {}) {
  const eventsByJob = new Map();
  for (const event of events) {
    const list = eventsByJob.get(event.job_id) || [];
    list.push(event);
    eventsByJob.set(event.job_id, list);
  }
  const firstEvent = (jobId, types) => (eventsByJob.get(jobId) || [])
    .filter((event) => types.includes(event.event_type))
    .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0] || null;

  // Cleanings brought in from the old CRM carry no real check-in, finish or take-up times: their
  // "completed" moment is just the service day. They count as cleanings but never feed a timing measure.
  const imported = new Set(jobs.filter((job) => (eventsByJob.get(job.id) || []).some((event) => IMPORT_EVENTS.includes(event.event_type))).map((job) => job.id));
  const live = (job) => !imported.has(job.id);

  const completed = jobs.filter((job) => job.status === 'COMPLETED');
  const expired = jobs.filter((job) => job.status === 'EXPIRED');
  const cancelled = jobs.filter((job) => job.status === 'CANCELLED');

  // On time = finished before the job's own deadline.
  const measurable = completed.filter((job) => live(job) && job.completed_at && deadlineAt(job, offsetMinutes));
  const onTime = measurable.filter((job) => stamp(job.completed_at) <= deadlineAt(job, offsetMinutes));
  const overrunMinutes = measurable
    .map((job) => minutesBetween(deadlineAt(job, offsetMinutes), job.completed_at))
    .filter((value) => Number.isFinite(value) && value > 0);

  // How long a published cleaning waits for a cleaner.
  const acceptanceMinutes = [];
  for (const job of jobs.filter(live)) {
    const created = firstEvent(job.id, ['JOB_CREATED', 'CLIENT_BOOKED']);
    const accepted = firstEvent(job.id, ['CLEANER_ACCEPTED', 'ADMIN_ASSIGNED']);
    const from = created?.created_at || job.created_at;
    if (!from || !accepted) continue;
    const minutes = minutesBetween(from, accepted.created_at);
    if (Number.isFinite(minutes) && minutes >= 0) acceptanceMinutes.push(minutes);
  }

  const rework = jobs.filter((job) => (eventsByJob.get(job.id) || []).some((event) => event.event_type === 'REVIEW_REJECTED'));
  const outsideRadius = jobs.filter((job) => (eventsByJob.get(job.id) || []).some((event) => event.event_type === 'CHECKIN_OUTSIDE_RADIUS'));
  const lateReleases = jobs.filter((job) => (eventsByJob.get(job.id) || []).some((event) => event.event_type === 'CLEANER_CANCELLED_LATE'));
  const escalated = jobs.filter((job) => job.escalated_at);
  const rescue = jobs.filter((job) => job.status === 'RESCUE' || (job.rescue_state && job.rescue_state !== 'NONE')
    || (eventsByJob.get(job.id) || []).some((event) => event.event_type === 'RESCUE_OPENED'));

  const cancelledBy = {
    client: cancelled.filter((job) => (eventsByJob.get(job.id) || []).some((event) => event.event_type === 'CLIENT_CANCELLED')).length,
    operations: cancelled.filter((job) => (eventsByJob.get(job.id) || []).some((event) => event.event_type === 'ADMIN_CANCELLED')).length,
  };
  cancelledBy.other = Math.max(0, cancelled.length - cancelledBy.client - cancelledBy.operations);

  // The funnel: how far each cleaning got. Terminal states are counted where
  // they stopped, so the steps always add up to the jobs in the period.
  const reached = (types) => jobs.filter((job) => (eventsByJob.get(job.id) || []).some((event) => types.includes(event.event_type))).length;
  // A cleaning that was completed was necessarily taken and visited, whether or not the trail says so.
  const wentThrough = (types) => jobs.filter((job) => job.status === 'COMPLETED' || (eventsByJob.get(job.id) || []).some((event) => types.includes(event.event_type))).length;
  const funnel = [
    {step: 'booked', jobs: jobs.length},
    {step: 'taken', jobs: jobs.filter((job) => job.assigned_cleaner_id || job.status === 'COMPLETED' || (eventsByJob.get(job.id) || []).some((event) => ['CLEANER_ACCEPTED', 'ADMIN_ASSIGNED'].includes(event.event_type))).length},
    {step: 'arrived', jobs: wentThrough(['STATUS_ARRIVED'])},
    {step: 'completed', jobs: completed.length},
    {step: 'approved', jobs: completed.filter((job) => job.review_status === 'APPROVED').length},
  ];

  const byDate = [...new Set(jobs.map((job) => job.service_date))].filter(Boolean).sort().map((date) => {
    const dayJobs = jobs.filter((job) => job.service_date === date);
    const dayCompleted = dayJobs.filter((job) => job.status === 'COMPLETED');
    const dayMeasurable = dayCompleted.filter((job) => live(job) && job.completed_at && deadlineAt(job, offsetMinutes));
    return {
      date,
      jobs: dayJobs.length,
      completed: dayCompleted.length,
      expired: dayJobs.filter((job) => job.status === 'EXPIRED').length,
      rescue: dayJobs.filter((job) => rescue.includes(job)).length,
      onTimePct: percent(dayMeasurable.filter((job) => stamp(job.completed_at) <= deadlineAt(job, offsetMinutes)).length, dayMeasurable.length),
    };
  });

  return {
    summary: {
      jobs: jobs.length,
      completed: completed.length,
      expired: expired.length,
      cancelled: cancelled.length,
      cancelledBy,
      rescue: rescue.length,
      escalated: escalated.length,
      issues: issues.length,
      onTimePct: percent(onTime.length, measurable.length),
      onTimeOf: measurable.length,
      importedJobs: jobs.filter((job) => imported.has(job.id)).length,
      medianOverrunMinutes: median(overrunMinutes),
      medianMinutesToAccept: median(acceptanceMinutes),
      acceptedOf: acceptanceMinutes.length,
      unassignedRatePct: percent(expired.length, jobs.length),
      reworkPct: percent(rework.length, completed.length),
      reworkOf: completed.length,
      outsideRadius: outsideRadius.length,
      lateReleases: lateReleases.length,
    },
    funnel,
    byDate,
  };
}

// Per-object performance from what was actually worked, not from the configured
// standard: the standard is shown next to it so a wrong standard is visible.
export function objectAnalytics({objects = [], jobs = []} = {}) {
  return objects.map((object) => {
    const own = jobs.filter((job) => String(job.object_id) === String(object.id));
    const worked = own
      .map((job) => minutesBetween(job.actual_start, job.completed_at))
      .filter((value) => Number.isFinite(value) && value > 0);
    const completed = own.filter((job) => job.status === 'COMPLETED').length;
    return {
      id: object.id,
      code: object.code,
      name: object.name,
      duration_minutes: object.duration_minutes,
      jobs: own.length,
      completed,
      expired: own.filter((job) => job.status === 'EXPIRED').length,
      avg_worked_minutes: worked.length ? Math.round(worked.reduce((sum, value) => sum + value, 0) / worked.length) : null,
      over_standard_minutes: worked.length && Number(object.duration_minutes)
        ? Math.round(worked.reduce((sum, value) => sum + value, 0) / worked.length) - Number(object.duration_minutes)
        : null,
    };
  }).sort((a, b) => b.jobs - a.jobs);
}

/**
 * Per-cleaner figures from the cleanings themselves. The stored reliability and rating columns are
 * starting values (95 and 5.0 for everyone), so they are not shown; what is shown is counted:
 * cleanings and completed ones in the period, the average of real client ratings, and on-time only
 * from cleanings that have a real finish time.
 */
export function cleanerAnalytics({cleaners = [], jobs = [], events = [], feedback = [], offsetMinutes = 120} = {}) {
  const importedIds = new Set(events.filter((event) => IMPORT_EVENTS.includes(event.event_type)).map((event) => String(event.job_id)));
  const trail = new Map();
  for (const event of events) trail.set(String(event.job_id), [...(trail.get(String(event.job_id)) || []), event.event_type]);
  const eventTypes = (jobId) => trail.get(String(jobId)) || [];
  const ratingByJob = new Map(feedback.map((row) => [String(row.job_id), Number(row.rating)]));
  const byCleaner = new Map();
  for (const job of jobs) {
    if (!job.assigned_cleaner_id) continue;
    const key = String(job.assigned_cleaner_id);
    byCleaner.set(key, [...(byCleaner.get(key) || []), job]);
  }
  return cleaners.map((cleaner) => {
    const own = byCleaner.get(String(cleaner.id)) || [];
    const completed = own.filter((job) => job.status === 'COMPLETED');
    const measurable = completed.filter((job) => !importedIds.has(String(job.id)) && job.completed_at && deadlineAt(job, offsetMinutes));
    const ratings = own.map((job) => ratingByJob.get(String(job.id))).filter((value) => Number.isFinite(value) && value > 0);
    const reworked = own.filter((job) => eventTypes(job.id).includes('REVIEW_REJECTED')).length;
    const released = own.filter((job) => eventTypes(job.id).includes('CLEANER_CANCELLED_LATE')).length;
    return {
      id: cleaner.id,
      full_name: cleaner.full_name || '',
      active: cleaner.active !== false,
      jobs: own.length,
      completed: completed.length,
      onTimePct: percent(measurable.filter((job) => stamp(job.completed_at) <= deadlineAt(job, offsetMinutes)).length, measurable.length),
      onTimeOf: measurable.length,
      rating: ratings.length ? Math.round((ratings.reduce((sum, value) => sum + value, 0) / ratings.length) * 10) / 10 : null,
      ratedOf: ratings.length,
      reworkPct: percent(reworked, completed.length),
      lateReleases: released,
    };
  }).filter((row) => row.jobs > 0 || row.active).sort((a, b) => b.completed - a.completed || a.full_name.localeCompare(b.full_name));
}
