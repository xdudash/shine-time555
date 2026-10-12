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

  const completed = jobs.filter((job) => job.status === 'COMPLETED');
  const expired = jobs.filter((job) => job.status === 'EXPIRED');
  const cancelled = jobs.filter((job) => job.status === 'CANCELLED');

  // On time = finished before the job's own deadline.
  const measurable = completed.filter((job) => job.completed_at && deadlineAt(job, offsetMinutes));
  const onTime = measurable.filter((job) => stamp(job.completed_at) <= deadlineAt(job, offsetMinutes));
  const overrunMinutes = measurable
    .map((job) => minutesBetween(deadlineAt(job, offsetMinutes), job.completed_at))
    .filter((value) => Number.isFinite(value) && value > 0);

  // How long a published cleaning waits for a cleaner.
  const acceptanceMinutes = [];
  for (const job of jobs) {
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
  const funnel = [
    {step: 'booked', jobs: jobs.length},
    {step: 'taken', jobs: reached(['CLEANER_ACCEPTED', 'ADMIN_ASSIGNED'])},
    {step: 'arrived', jobs: reached(['STATUS_ARRIVED'])},
    {step: 'completed', jobs: completed.length},
    {step: 'approved', jobs: completed.filter((job) => job.review_status === 'APPROVED').length},
  ];

  const byDate = [...new Set(jobs.map((job) => job.service_date))].filter(Boolean).sort().map((date) => {
    const dayJobs = jobs.filter((job) => job.service_date === date);
    const dayCompleted = dayJobs.filter((job) => job.status === 'COMPLETED');
    const dayMeasurable = dayCompleted.filter((job) => job.completed_at && deadlineAt(job, offsetMinutes));
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
