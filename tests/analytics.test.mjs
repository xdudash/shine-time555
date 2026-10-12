import test from 'node:test';
import assert from 'node:assert/strict';
import {operationsAnalytics, objectAnalytics, minutesBetween, zoneOffsetMinutes} from '../supabase/functions/st-api/analytics.mjs';

const job = (overrides) => ({
  id: 1, object_id: 11, service_date: '2026-10-05', earliest_start: '10:00', deadline: '15:00',
  duration_minutes: 90, status: 'COMPLETED', review_status: 'APPROVED', rescue_state: 'NONE',
  created_at: '2026-10-04T08:00:00Z', ...overrides,
});
const event = (jobId, type, at) => ({job_id: jobId, event_type: type, created_at: at});

test('minutes between two stamps, and nothing invented from a missing one', () => {
  assert.equal(minutesBetween('2026-10-05T10:00:00Z', '2026-10-05T11:30:00Z'), 90);
  assert.equal(minutesBetween('2026-10-05T11:30:00Z', '2026-10-05T10:00:00Z'), -90);
  assert.equal(minutesBetween(null, '2026-10-05T10:00:00Z'), null);
  assert.equal(minutesBetween('2026-10-05T10:00:00Z', undefined), null);
  assert.equal(minutesBetween('nonsense', '2026-10-05T10:00:00Z'), null);
});

test('on time is measured against each job own deadline, not a global cutoff', () => {
  // Deadline 15:00 Bratislava = 13:00Z. One finishes at 12:30Z (in time),
  // one at 13:40Z (40 minutes over), one has a 20:00 deadline and finishes
  // at 17:00Z, which a global 15:00 rule would have called late.
  const jobs = [
    job({id: 1, completed_at: '2026-10-05T12:30:00Z'}),
    job({id: 2, completed_at: '2026-10-05T13:40:00Z'}),
    job({id: 3, deadline: '20:00', completed_at: '2026-10-05T17:00:00Z'}),
  ];
  const {summary} = operationsAnalytics({jobs});
  assert.equal(summary.onTimeOf, 3);
  assert.equal(summary.onTimePct, 66.7);
  assert.equal(summary.medianOverrunMinutes, 40);
});

test('a completed job without a timestamp is left out of the rate instead of counted as on time', () => {
  const {summary} = operationsAnalytics({jobs: [job({id: 1, completed_at: null}), job({id: 2, completed_at: '2026-10-05T12:00:00Z'})]});
  assert.equal(summary.completed, 2);
  assert.equal(summary.onTimeOf, 1, 'only the measurable one is in the denominator');
  assert.equal(summary.onTimePct, 100);
});

test('an empty period reports null rates rather than a comforting 100%', () => {
  const {summary, byDate, funnel} = operationsAnalytics({});
  assert.equal(summary.jobs, 0);
  assert.equal(summary.onTimePct, null);
  assert.equal(summary.reworkPct, null);
  assert.equal(summary.medianMinutesToAccept, null);
  assert.deepEqual(byDate, []);
  assert.deepEqual(funnel.map((step) => step.jobs), [0, 0, 0, 0, 0]);
});

test('time to accept comes from the event trail and uses the median', () => {
  const jobs = [job({id: 1}), job({id: 2}), job({id: 3}), job({id: 4, created_at: '2026-10-04T08:00:00Z'})];
  const events = [
    event(1, 'JOB_CREATED', '2026-10-04T08:00:00Z'), event(1, 'CLEANER_ACCEPTED', '2026-10-04T08:30:00Z'),
    event(2, 'JOB_CREATED', '2026-10-04T08:00:00Z'), event(2, 'CLEANER_ACCEPTED', '2026-10-04T10:00:00Z'),
    event(3, 'JOB_CREATED', '2026-10-04T08:00:00Z'), event(3, 'ADMIN_ASSIGNED', '2026-10-04T09:00:00Z'),
    // job 4 was never taken: it must not count as an instant acceptance
  ];
  const {summary} = operationsAnalytics({jobs, events});
  assert.equal(summary.acceptedOf, 3);
  assert.equal(summary.medianMinutesToAccept, 60);
});

test('expiry, rescue, escalation, rework, radius and late releases are read from the trail', () => {
  const jobs = [
    job({id: 1, status: 'EXPIRED'}),
    job({id: 2, status: 'RESCUE', rescue_state: 'ACTIVE'}),
    job({id: 3, escalated_at: '2026-10-04T09:00:00Z', status: 'UNASSIGNED', review_status: 'NOT_SUBMITTED'}),
    job({id: 4, completed_at: '2026-10-05T12:00:00Z'}),
    job({id: 5, completed_at: '2026-10-05T12:00:00Z'}),
  ];
  const events = [
    event(4, 'REVIEW_REJECTED', '2026-10-05T13:00:00Z'),
    event(5, 'CHECKIN_OUTSIDE_RADIUS', '2026-10-05T10:05:00Z'),
    event(2, 'CLEANER_CANCELLED_LATE', '2026-10-05T07:00:00Z'),
    event(2, 'RESCUE_OPENED', '2026-10-05T07:00:01Z'),
  ];
  const {summary} = operationsAnalytics({jobs, events, issues: [{id: 1}, {id: 2}]});
  assert.equal(summary.expired, 1);
  assert.equal(summary.unassignedRatePct, 20);
  assert.equal(summary.rescue, 1);
  assert.equal(summary.escalated, 1);
  assert.equal(summary.outsideRadius, 1);
  assert.equal(summary.lateReleases, 1);
  assert.equal(summary.reworkOf, 2, 'rework is a share of completed jobs');
  assert.equal(summary.reworkPct, 50);
  assert.equal(summary.issues, 2);
});

test('cancellations are split by who cancelled, and the rest is not attributed to anyone', () => {
  const jobs = [job({id: 1, status: 'CANCELLED'}), job({id: 2, status: 'CANCELLED'}), job({id: 3, status: 'CANCELLED'})];
  const events = [event(1, 'CLIENT_CANCELLED', '2026-10-04T09:00:00Z'), event(2, 'ADMIN_CANCELLED', '2026-10-04T09:00:00Z')];
  const {summary} = operationsAnalytics({jobs, events});
  assert.equal(summary.cancelled, 3);
  assert.deepEqual(summary.cancelledBy, {client: 1, operations: 1, other: 1});
});

test('the funnel counts how far each cleaning got and never exceeds the jobs in the period', () => {
  const jobs = [
    job({id: 1, status: 'UNASSIGNED', review_status: 'NOT_SUBMITTED'}),
    job({id: 2, status: 'ACCEPTED', review_status: 'NOT_SUBMITTED'}),
    job({id: 3, status: 'CLEANING', review_status: 'NOT_SUBMITTED'}),
    job({id: 4, completed_at: '2026-10-05T12:00:00Z', review_status: 'PENDING'}),
    job({id: 5, completed_at: '2026-10-05T12:00:00Z', review_status: 'APPROVED'}),
  ];
  const events = [
    event(2, 'CLEANER_ACCEPTED', '2026-10-04T09:00:00Z'),
    event(3, 'CLEANER_ACCEPTED', '2026-10-04T09:00:00Z'), event(3, 'STATUS_ARRIVED', '2026-10-05T10:00:00Z'),
    event(4, 'CLEANER_ACCEPTED', '2026-10-04T09:00:00Z'), event(4, 'STATUS_ARRIVED', '2026-10-05T10:00:00Z'),
    event(5, 'ADMIN_ASSIGNED', '2026-10-04T09:00:00Z'), event(5, 'STATUS_ARRIVED', '2026-10-05T10:00:00Z'),
  ];
  const {funnel} = operationsAnalytics({jobs, events});
  assert.deepEqual(funnel, [
    {step: 'booked', jobs: 5},
    {step: 'taken', jobs: 4},
    {step: 'arrived', jobs: 3},
    {step: 'completed', jobs: 2},
    {step: 'approved', jobs: 1},
  ]);
  for (const step of funnel) assert.ok(step.jobs <= jobs.length);
});

test('the daily series is sorted, one row per service date, with its own on-time rate', () => {
  const jobs = [
    job({id: 1, service_date: '2026-10-06', completed_at: '2026-10-06T12:00:00Z'}),
    job({id: 2, service_date: '2026-10-05', completed_at: '2026-10-05T14:00:00Z'}),
    job({id: 3, service_date: '2026-10-05', completed_at: '2026-10-05T12:00:00Z'}),
    job({id: 4, service_date: '2026-10-05', status: 'EXPIRED'}),
  ];
  const {byDate} = operationsAnalytics({jobs});
  assert.deepEqual(byDate.map((day) => day.date), ['2026-10-05', '2026-10-06']);
  assert.deepEqual(byDate[0], {date: '2026-10-05', jobs: 3, completed: 2, expired: 1, rescue: 0, onTimePct: 50});
  assert.equal(byDate[1].onTimePct, 100);
});

test('object performance uses the worked time and shows how far the standard is off', () => {
  const objects = [{id: 11, code: 'BA-101', name: 'Dunajská', duration_minutes: 90}, {id: 12, code: 'BA-102', name: 'Riverside', duration_minutes: 60}];
  const jobs = [
    job({id: 1, object_id: 11, actual_start: '2026-10-05T10:00:00Z', completed_at: '2026-10-05T11:50:00Z'}),
    job({id: 2, object_id: 11, actual_start: '2026-10-06T10:00:00Z', completed_at: '2026-10-06T11:40:00Z'}),
    job({id: 3, object_id: 11, status: 'EXPIRED'}),
    job({id: 4, object_id: 12, status: 'UNASSIGNED'}),
  ];
  const [first, second] = objectAnalytics({objects, jobs});
  assert.equal(first.code, 'BA-101');
  assert.equal(first.jobs, 3);
  assert.equal(first.completed, 2);
  assert.equal(first.expired, 1);
  assert.equal(first.avg_worked_minutes, 105);
  assert.equal(first.over_standard_minutes, 15, 'the standard is 15 minutes short of reality');
  assert.equal(second.code, 'BA-102');
  assert.equal(second.avg_worked_minutes, null, 'nothing was worked, so nothing is averaged');
  assert.equal(second.over_standard_minutes, null);
});

test('the deadline is read in the operating timezone, not in UTC', () => {
  // Deadline 23:30 Bratislava = 21:30Z. Finishing 21:45Z is 15 minutes late,
  // finishing 21:00Z is in time. Reading the deadline as UTC would invert both.
  const late = operationsAnalytics({jobs: [job({id: 1, deadline: '23:30', completed_at: '2026-10-05T21:45:00Z'})]});
  assert.equal(late.summary.onTimePct, 0);
  assert.equal(late.summary.medianOverrunMinutes, 15);
  const inTime = operationsAnalytics({jobs: [job({id: 1, deadline: '23:30', completed_at: '2026-10-05T21:00:00Z'})]});
  assert.equal(inTime.summary.onTimePct, 100);
  assert.equal(inTime.summary.medianOverrunMinutes, null);
  // Winter, when the offset is 60 minutes, is the caller's to pass in.
  const winter = operationsAnalytics({jobs: [job({id: 1, service_date: '2026-01-15', deadline: '15:00', completed_at: '2026-01-15T14:30:00Z'})], offsetMinutes: 60});
  assert.equal(winter.summary.onTimePct, 0, '14:30Z is 15:30 local in winter');
});

test('the operating offset follows the Bratislava DST change', () => {
  assert.equal(zoneOffsetMinutes('2026-07-15'), 120, 'summer time');
  assert.equal(zoneOffsetMinutes('2026-01-15'), 60, 'winter time');
  assert.equal(zoneOffsetMinutes('2026-10-25'), 60, 'the day the clocks go back');
  assert.equal(zoneOffsetMinutes('2026-10-24'), 120, 'the day before');
  assert.equal(zoneOffsetMinutes('nonsense'), 0, 'a broken date degrades to UTC instead of throwing');
});
