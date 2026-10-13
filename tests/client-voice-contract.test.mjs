import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {projectResponse} from '../supabase/functions/st-api/security.mjs';
const root = new URL('..', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');

const api = read('supabase/functions/st-api/index.ts');
const app = read('assets/app.js');
const migration = read('supabase/migrations/20261012170000_client_feedback_recurring.sql');

test('a complaint reaches operations, never the cleaner', () => {
  const payload = {
    jobs: [{
      id: 1, object_id: 11, status: 'COMPLETED', payout: 20, bonus: 6, client_price: 40,
      feedback_rating: 2, feedback_comment: 'Bathroom was not cleaned', feedback_complaint: true,
      complaint_description: 'Bathroom was not cleaned',
    }],
  };
  const cleaner = projectResponse(payload, 'CLEANER').jobs[0];
  assert.equal(cleaner.feedback_rating, 2, 'the cleaner does see the number');
  assert.equal(cleaner.feedback_comment, undefined);
  assert.equal(cleaner.feedback_complaint, undefined);
  assert.equal(cleaner.complaint_description, undefined);
  assert.equal(cleaner.client_price, undefined, 'the money rules still hold');

  for (const role of ['ADMIN', 'OPERATIONS_MANAGER']) {
    const staff = projectResponse(payload, role).jobs[0];
    assert.equal(staff.feedback_comment, 'Bathroom was not cleaned', `${role} must read the complaint`);
    assert.equal(staff.feedback_complaint, true);
  }
  const client = projectResponse(payload, 'OWNER').jobs[0];
  assert.equal(client.feedback_comment, 'Bathroom was not cleaned', 'the client wrote it, so they see it');
  assert.equal(client.payout, undefined);
});

test('rating, note and recurring go through the database functions, not through table writes', () => {
  for (const fn of ['st_submit_job_feedback', 'st_update_booking_note', 'st_client_recurring', 'st_client_recurring_save', 'st_client_recurring_delete', 'st_cleaner_earnings']) {
    assert.match(api, new RegExp(`service\\.rpc\\('${fn}'`), `${fn} must be called from the API`);
    assert.match(migration, new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to service_role`), `${fn} must be granted to service_role only`);
    assert.match(migration, new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public,anon,authenticated`), `${fn} must be revoked from clients`);
  }
  assert.match(migration, /revoke all on public\.st_job_feedback from anon, authenticated/);
  assert.match(migration, /create policy st_job_feedback_backend_only[\s\S]{0,120}using \(false\) with check \(false\)/);
  // No route may write these tables directly.
  assert.ok(!/from\('st_job_feedback'\)[\s\S]{0,40}\.(insert|update|upsert|delete)\(/.test(api), 'feedback is only written by its RPC');
  assert.ok(!/from\('st_recurring'\)[\s\S]{0,40}\.(insert|update|upsert|delete)\(/.test(api), 'client schedules are only written by their RPC');
});

test('every new route checks the caller scope before acting', () => {
  const bookingBlock = api.slice(api.indexOf("const booking = route.match"), api.indexOf("if (route === 'client/recurring'"));
  for (const action of ['feedback', 'note']) {
    const branch = bookingBlock.slice(bookingBlock.indexOf(`booking[2] === '${action}'`));
    assert.ok(branch.indexOf('await jobFor(ctx, jobId)') < branch.indexOf('service.rpc'),
      `client/bookings/{id}/${action} must resolve the caller's own booking first`);
  }
  assert.match(bookingBlock, /route\.match\(\/\^client\\\/bookings\\\/\(\\d\+\)\(\?:\\\/\(cancel\|feedback\|note\)\)\?\$\//);
  // The admin note edit lives behind the admin router, which requires operations.
  const adminBlock = api.slice(api.indexOf("const jobRoute = route.match"), api.indexOf("if (route === 'admin/settings'"));
  assert.match(adminBlock, /action === 'note' && method === 'PATCH'/);
  assert.match(adminBlock, /st_update_booking_note/);
});

test('the rating window and the cleaner rating are the database decision, not the browser', () => {
  assert.match(migration, /feedbackWindowDays/);
  assert.match(migration, /The rating window for this cleaning has closed/);
  assert.match(migration, /if j\.status <> 'COMPLETED' then raise exception 'Only a finished cleaning can be rated'/);
  assert.match(migration, /create or replace function public\.st_refresh_cleaner_rating/);
  assert.match(migration, /set rating = coalesce\(\(select round\(avg\(f\.rating\)/, 'the rating is an average, not a nudge');
  // The browser asks, it does not decide.
  assert.match(api, /canRate: job\.status === 'COMPLETED'/);
  assert.match(app, /d\.rating\?\.canRate/);
  assert.ok(!/canRate\s*=\s*true/.test(app));
});

test('the cleaner earnings page renders server amounts and never sums money itself', () => {
  const page = app.slice(app.indexOf('async function cleanerEarnings()'), app.indexOf('async function cleanerProfile()'));
  for (const field of ['week', 'month', 'waitingReview', 'payable', 'paid']) {
    assert.match(page, new RegExp(`e\\.${field}`), `the ${field} card must come from the server`);
  }
  assert.match(page, /const cents=v=>money\(Number\(v\|\|0\)\/100\)/, 'the server speaks in cents');
  assert.ok(!/reduce\(/.test(page), 'no money is added up in the browser');
  assert.match(migration, /'waitingReview', coalesce\(\(select sum\(earned_cents - paid_cents\) from rows where review_status <> 'APPROVED'\)/);
  assert.match(migration, /'payable', coalesce\(\(select sum\(greatest\(earned_cents - paid_cents,0\)\) from rows where review_status = 'APPROVED'\)/);
});

test('a schedule that produced cleanings is switched off instead of deleted', () => {
  assert.match(migration, /select count\(\*\) into used from public\.st_jobs j where j\.recurring_id=sched\.id/);
  assert.match(migration, /if used > 0 then\s*\n\s*update public\.st_recurring set active=false/);
  assert.match(migration, /jsonb_build_object\('deleted',0,'deactivated',touched,'generatedJobs',used\)/);
  // The browser says which of the two happened rather than claiming a delete.
  assert.match(app, /r\.deleted\?t\('Schedule deleted'/);
  assert.match(app, /Schedule paused because it already created cleanings/);
});
