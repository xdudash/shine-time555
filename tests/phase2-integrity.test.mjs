import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const sql = await readFile(new URL('../supabase/migrations/20260914090000_phase2_integrity.sql', import.meta.url), 'utf8');

test('phase2 migration enforces the same 96-char request-id contract at the database boundary', () => {
  assert.match(sql, /new\.request_id !~ '\^\[A-Za-z0-9\]\[A-Za-z0-9\._:-\]\{7,95\}\$'/);
  assert.match(sql, /create trigger st_job_command_request_id_guard/);
});

test('phase2 migration adds fail-closed nonnegative finance invariants', () => {
  assert.match(sql, /payout >= 0 and client_price >= 0 and bonus >= 0 and extra_revenue >= 0 and extra_cost >= 0/);
  assert.match(sql, /st_jobs_nonnegative_finance_ck/);
});

test('phase2 migration protects service-window integrity and settlement bounds', () => {
  assert.match(sql, /st_jobs_service_window_ck/);
  assert.match(sql, /earliest_start < deadline/);
  assert.match(sql, /duration_minutes between 15 and 1440/);
  assert.match(sql, /st_settlements_amount_ck/);
});
