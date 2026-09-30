import test from 'node:test';
import assert from 'node:assert/strict';
import { isStrongPassword, marketplaceJob, normalizeRequestId, projectResponse, SECURITY_LIMITS } from '../supabase/functions/st-api/security.mjs';

test('request IDs are bounded and invalid values fall back to a server-generated ID', () => {
  assert.equal(normalizeRequestId('client-req-123456', 'server-id'), 'client-req-123456');
  assert.equal(normalizeRequestId('', 'server-id'), 'server-id');
  assert.equal(normalizeRequestId('short', 'server-id'), 'server-id');
  assert.equal(normalizeRequestId('x'.repeat(97), 'server-id'), 'server-id');
  assert.equal(normalizeRequestId('bad value 123456', 'server-id'), 'server-id');
});

test('managed-account password policy has one explicit minimum', () => {
  assert.equal(SECURITY_LIMITS.passwordMinLength, 12);
  assert.equal(isStrongPassword('short-pass'), false);
  assert.equal(isStrongPassword('twelve-char'), false);
  assert.equal(isStrongPassword('twelve-char!'), true);
  assert.equal(isStrongPassword('x'.repeat(256)), true);
  assert.equal(isStrongPassword('x'.repeat(257)), false);
});

test('marketplace projection is an explicit allow-list', () => {
  const projected = marketplaceJob({ id: 1, status: 'UNASSIGNED', payout: 20, client_price: 80, secret_token: 'never-return' });
  assert.deepEqual(projected, { id: 1, status: 'UNASSIGNED', payout: 20 });
});

test('cleaner responses do not expose client-side financial data', () => {
  const result = projectResponse({
    id: 1,
    payout: 25,
    client_price: 100,
    object_client_price: 100,
    extra_revenue: 10,
    client_id: 77,
    nested: { financial_status: 'OPEN', safe: true },
  }, 'CLEANER');
  assert.equal(result.payout, 25);
  assert.equal(result.client_price, undefined);
  assert.equal(result.object_client_price, undefined);
  assert.equal(result.extra_revenue, undefined);
  assert.equal(result.client_id, undefined);
  assert.deepEqual(result.nested, { safe: true });
});

test('owner responses do not expose cleaner-only operational data', () => {
  const result = projectResponse({ payout: 25, bonus: 5, cleaner_reliability: 99, object_notes: 'private ops note', safe: true }, 'OWNER');
  assert.deepEqual(result, { safe: true });
});

test('cleaner receives entry details only while the job is actively assigned', () => {
  const job = (status) => ({ id: 1, object_id: 7, status, access_instructions: 'code 1234', wifi: 'net', key_instructions: 'box', object_name: 'Flat' });
  for (const status of ['ACCEPTED', 'EN_ROUTE', 'ARRIVED', 'CLEANING']) {
    assert.equal(projectResponse({ job: job(status) }, 'CLEANER').job.access_instructions, 'code 1234', status);
  }
  for (const status of ['UNASSIGNED', 'RESCUE', 'COMPLETED', 'CANCELLED']) {
    const projected = projectResponse({ jobs: [job(status)] }, 'CLEANER').jobs[0];
    assert.equal(projected.access_instructions, undefined, status);
    assert.equal(projected.wifi, undefined, status);
    assert.equal(projected.key_instructions, undefined, status);
    assert.equal(projected.object_name, 'Flat');
  }
  assert.equal(projectResponse({ job: job('COMPLETED') }, 'OWNER').job.access_instructions, 'code 1234');
  assert.equal(projectResponse({ job: job('COMPLETED') }, 'ADMIN').job.access_instructions, 'code 1234');
});
