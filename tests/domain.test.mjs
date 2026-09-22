import test from 'node:test';
import assert from 'node:assert/strict';

import { availableBookingSlots, marketplaceForCleaner } from '../supabase/functions/st-api/logic.mjs';
import { marketplaceJob } from '../supabase/functions/st-api/security.mjs';

const settings = { safetyBuffer: 0, travelBuffer: 0 };

test('a busy cleaner does not consume another cleaner booking capacity', () => {
  const fixture = {
    object: { checkout_time: '10:00', deadline_time: '15:00' },
    cleaners: [{ id: 1, active: true, max_jobs_day: 5 }, { id: 2, active: true, max_jobs_day: 5 }],
    windows: [
      { cleaner_id: 1, online: true, from_time: '10:00', to_time: '15:00' },
      { cleaner_id: 2, online: true, from_time: '10:00', to_time: '15:00' },
    ],
    jobs: [{ assigned_cleaner_id: 1, planned_start: '10:00', duration_minutes: 60, status: 'ACCEPTED' }],
    durationMinutes: 60, settings, stepMinutes: 30,
  };
  assert.ok(availableBookingSlots(fixture).includes('10:00'));
});

test('object service window limits client booking slots', () => {
  const slots = availableBookingSlots({
    object: { checkout_time: '16:00', deadline_time: '19:00' },
    cleaners: [{ id: 1, active: true, max_jobs_day: 5 }],
    windows: [{ cleaner_id: 1, online: true, from_time: '10:00', to_time: '21:00' }],
    jobs: [], durationMinutes: 60, settings, stepMinutes: 30,
  });
  assert.equal(slots[0], '16:00');
  assert.equal(slots.at(-1), '18:00');
});

test('cleaner daily capacity is applied independently', () => {
  const slots = availableBookingSlots({
    object: { checkout_time: '10:00', deadline_time: '12:00' },
    cleaners: [{ id: 1, active: true, max_jobs_day: 1 }, { id: 2, active: true, max_jobs_day: 1 }],
    windows: [{ cleaner_id: 1, online: true, from_time: '10:00', to_time: '12:00' }, { cleaner_id: 2, online: true, from_time: '10:00', to_time: '12:00' }],
    jobs: [{ assigned_cleaner_id: 1, planned_start: '11:00', duration_minutes: 30, status: 'ACCEPTED' }],
    durationMinutes: 30, settings, stepMinutes: 30,
  });
  assert.deepEqual(slots, ['10:00', '10:30', '11:00', '11:30']);
});

test('evening marketplace offer uses object and cleaner windows without global cutoff', () => {
  const { jobs } = marketplaceForCleaner({
    cleaner: { id: 1, max_jobs_day: 5 },
    availability: { online: true, from_time: '10:00', to_time: '19:00' },
    assignedJobs: [],
    jobs: [{ id: 8, service_date: '2026-09-07', planned_start: '16:00', earliest_start: '16:00', deadline: '19:00', duration_minutes: 60, status: 'UNASSIGNED' }],
    settings: { windowEnd: '15:00', safetyBuffer: 0, travelBuffer: 0 }, now: '12:00',
  });
  assert.equal(jobs[0].feasible, true);
});

test('marketplace rejects an expired object window', () => {
  const { jobs } = marketplaceForCleaner({
    cleaner: { id: 1, max_jobs_day: 5 }, availability: { online: true, from_time: '10:00', to_time: '20:00' }, assignedJobs: [],
    jobs: [{ planned_start: '18:30', deadline: '19:00', duration_minutes: 60, status: 'UNASSIGNED' }], settings, now: '12:00',
  });
  assert.equal(jobs[0].feasible, false);
  assert.match(jobs[0].feasibility_reason, /object window/i);
});

test('marketplace rejects a start in the past', () => {
  const { jobs } = marketplaceForCleaner({
    cleaner: { id: 1, max_jobs_day: 5 }, availability: { online: true, from_time: '10:00', to_time: '20:00' }, assignedJobs: [],
    jobs: [{ planned_start: '11:00', deadline: '19:00', duration_minutes: 60, status: 'UNASSIGNED' }], settings, now: '12:00',
  });
  assert.equal(jobs[0].feasible, false);
  assert.match(jobs[0].feasibility_reason, /passed/i);
});

test('marketplace projection omits access and commercial secrets', () => {
  const projected = marketplaceJob({
    id: 1, object_id: 2, service_date: '2026-09-07', planned_start: '16:00', deadline: '19:00', duration_minutes: 60,
    object_name: 'Flat', object_code: 'ST-1', address: 'Main 1', zone: 'Centre', payout: 20, bonus: 3,
    access_instructions: 'door 1234', key_instructions: 'under mat', wifi: 'secret', client_price: 80,
    extra_revenue: 10, extra_cost: 5, client_name: 'Client', client_company: 'Corp', cleaner_phone: 'x', notes: 'private',
  });
  assert.equal(projected.access_instructions, undefined);
  assert.equal(projected.key_instructions, undefined);
  assert.equal(projected.wifi, undefined);
  assert.equal(projected.client_price, undefined);
  assert.equal(projected.extra_revenue, undefined);
  assert.equal(projected.extra_cost, undefined);
  assert.equal(projected.client_name, undefined);
  assert.equal(projected.client_company, undefined);
  assert.equal(projected.address, undefined);
  assert.equal(projected.payout, 20);
});

test('API role projection strips internal prices from cleaner and owner payloads',async()=>{
 const {projectResponse}=await import('../supabase/functions/st-api/security.mjs');
 const payload={jobs:[{id:1,payout:20,bonus:5,client_price:40,extra_cost:2,access_instructions:'assigned-secret'}]};
 const cleaner=projectResponse(payload,'CLEANER');
 assert.equal(cleaner.jobs[0].payout,20);assert.equal(cleaner.jobs[0].client_price,undefined);
 const owner=projectResponse(payload,'OWNER');assert.equal(owner.jobs[0].payout,undefined);assert.equal(owner.jobs[0].client_price,40);
});

test('booking slots reserve safety and travel time and accept numeric duration strings',()=>{
 const slots=availableBookingSlots({object:{checkout_time:'10:00',deadline_time:'13:00'},cleaners:[{id:1,active:true,max_jobs_day:5}],windows:[{cleaner_id:1,online:true,from_time:'10:00',to_time:'13:00'}],jobs:[{assigned_cleaner_id:1,planned_start:'10:00',duration_minutes:60,status:'ACCEPTED'}],durationMinutes:'60',settings:{safetyBuffer:10,travelBuffer:15},stepMinutes:15});
 assert.deepEqual(slots,['11:30','11:45']);
});
