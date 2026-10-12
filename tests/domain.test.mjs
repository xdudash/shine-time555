import test from 'node:test';
import assert from 'node:assert/strict';

import { marketplaceForCleaner } from '../supabase/functions/st-api/logic.mjs';
import { marketplaceJob } from '../supabase/functions/st-api/security.mjs';

const settings = { safetyBuffer: 0, travelBuffer: 0 };

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

test('marketplace rejects a window that can no longer fit the cleaning', () => {
  const { jobs } = marketplaceForCleaner({
    cleaner: { id: 1, max_jobs_day: 5 }, availability: null, assignedJobs: [],
    jobs: [{ earliest_start: '10:00', deadline: '13:00', duration_minutes: 90, status: 'UNASSIGNED' }], settings, now: '12:00',
  });
  assert.equal(jobs[0].feasible, false);
  assert.match(jobs[0].feasibility_reason, /deadline/i);
});

test('marketplace keeps a job open after its window started while time remains', () => {
  const { jobs } = marketplaceForCleaner({
    cleaner: { id: 1, max_jobs_day: 5 }, availability: null, assignedJobs: [],
    jobs: [{ earliest_start: '10:00', deadline: '17:00', duration_minutes: 90, status: 'UNASSIGNED' }], settings, now: '12:00',
  });
  assert.equal(jobs[0].feasible, true);
  assert.equal(jobs[0].earliest_feasible_start, '12:15');
  assert.equal(jobs[0].latest_start, '15:30');
});

test('marketplace skips past a conflicting job to the next free start', () => {
  const { jobs } = marketplaceForCleaner({
    cleaner: { id: 1, max_jobs_day: 5 }, availability: null,
    assignedJobs: [{ planned_start: '10:00', duration_minutes: 60, status: 'ACCEPTED' }],
    jobs: [{ earliest_start: '10:00', deadline: '15:00', duration_minutes: 60, status: 'UNASSIGNED' }], settings, now: '00:00',
  });
  assert.equal(jobs[0].feasible, true);
  assert.ok(jobs[0].earliest_feasible_start >= '11:00');
});

test('a day the cleaner explicitly marked off hides nothing but blocks taking', () => {
  const { jobs } = marketplaceForCleaner({
    cleaner: { id: 1, max_jobs_day: 5 }, availability: { online: false, explicit: true }, assignedJobs: [],
    jobs: [{ earliest_start: '10:00', deadline: '15:00', duration_minutes: 60, status: 'UNASSIGNED' }], settings, now: '00:00',
  });
  assert.equal(jobs[0].feasible, false);
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
