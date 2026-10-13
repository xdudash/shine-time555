import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const root = new URL('..', import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), 'utf8');

const api = read('supabase/functions/st-api/index.ts');
const config = read('supabase/config.toml');

// The platform's own JWT gate is off for st-api: this project uses the new
// sb_secret_* API keys, which are not JWTs, so the scheduled pg_net call cannot
// satisfy verify_jwt. That makes the function's own checks the ONLY gate, so
// these are no longer belt-and-braces assertions — they are the boundary.
const handler = api.slice(api.indexOf('Deno.serve('));
const beforeAuth = handler.slice(0, handler.indexOf('const ctx = await context(req)'));

test('the function is the only gate, and it knows it', () => {
  assert.match(config, /verify_jwt\s*=\s*false/, 'this test exists because the platform gate is off');
  assert.match(api, /async function authOnly\(req: Request\)/);
  assert.match(api, /if \(!authorization\.toLowerCase\(\)\.startsWith\('bearer '\)\) throw new ApiError\('Authentication required', 401\)/);
  assert.match(api, /const \{ data, error \} = await client\.auth\.getUser\(\)/,
    'the bearer token is validated against Supabase, not merely present');
  assert.match(api, /if \(error \|\| !data\.user\) throw new ApiError\('Authentication required', 401\)/);
  // context() is what every route goes through, and it re-checks the account.
  assert.match(api, /if \(!appUser \|\| !appUser\.active\) throw new ApiError\('This account is not activated by Operations', 403\)/);
});

test('only the three known routes are served before authentication, and each guards itself', () => {
  const routesBeforeAuth = [...beforeAuth.matchAll(/route === '([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual([...new Set(routesBeforeAuth)].sort(), ['account/request', 'bootstrap', 'dispatch/outbox'],
    'a new route must sit after context(req), or it is open to the internet');

  // bootstrap still requires a signed-in Supabase user, and can only ever
  // create the very first administrator.
  const bootstrapBody = api.slice(api.indexOf('async function bootstrap(req: Request'), api.indexOf('async function account('));
  assert.match(bootstrapBody, /const \{ authUser \} = await authOnly\(req\)/);
  assert.match(bootstrapBody, /Initial administrator already exists/);

  // dispatch/outbox requires the worker secret and refuses when none is set.
  const dispatchBlock = beforeAuth.slice(beforeAuth.indexOf("route === 'dispatch/outbox'"));
  assert.match(dispatchBlock, /if \(!notificationConfig\.secret\) throw new ApiError\([^)]*503\)/);
  assert.match(dispatchBlock, /secretMatches\(notificationConfig\.secret, req\.headers\.get\('x-st-worker-secret'\)\)/);
  assert.ok(dispatchBlock.indexOf('secretMatches') < dispatchBlock.indexOf('drainOutbox'),
    'the secret is checked before any work is done');

  // account/request (stage 3) is the self-registration ask. It cannot sit
  // behind context(), which requires an ACTIVE application account, so it
  // authenticates the caller itself and takes the identity from the token —
  // never from the request body.
  const requestBlock = beforeAuth.slice(beforeAuth.indexOf("route === 'account/request'"), beforeAuth.indexOf("route === 'dispatch/outbox'"));
  assert.match(requestBlock, /const \{ authUser \} = await authOnly\(req\)/, 'the caller must be a signed-in Supabase user');
  assert.match(requestBlock, /p_auth_user_id: authUser\.id/, 'the account is bound to the token, not to a body field');
  assert.match(requestBlock, /p_email: String\(authUser\.email \|\| ''\)/, 'the email comes from the token too');
  assert.ok(!/role/i.test(requestBlock.replace(/\/\/[^\n]*/g, '')), 'the caller cannot ask for a role');
  // The account it creates is inactive, so context() keeps it out until a
  // human approves it, and the whole thing can be switched off from settings.
  const migration = read('supabase/migrations/20261012210000_self_registration.sql');
  assert.match(migration, /'OWNER', left\(v_name,200\),[\s\S]{0,200}false\)/, 'the new account is created inactive');
  assert.match(migration, /selfRegistrationOpen/);
  assert.match(migration, /raise exception 'Self-registration is closed at the moment'/);
  assert.match(migration, /if a\.role='OPERATIONS_MANAGER' then raise exception 'Forbidden: accounts require administrator'/);
});

test('no privileged client is used before the caller is known', () => {
  // The service-role client bypasses RLS, so it must not be reachable on an
  // unauthenticated path other than through the two guarded routes above.
  const guarded = beforeAuth.slice(beforeAuth.indexOf("route === 'bootstrap'"));
  const unguarded = beforeAuth.slice(0, beforeAuth.indexOf("route === 'bootstrap'"));
  assert.ok(!/service\./.test(unguarded), 'nothing touches the database before a route is matched');
  assert.ok(/service\.rpc\('st_claim_notifications'/.test(guarded), 'the worker route is the one that may');
});

test('the role guards still sit on every role-scoped router', () => {
  const routerBody = (name) => {
    const body = api.slice(api.indexOf(`async function ${name}(`));
    return body.slice(0, 900);
  };
  // Cleaner and client routers name their role outright.
  assert.match(routerBody('routeCleaner'), /requireRole\(ctx, 'CLEANER'\)/);
  assert.match(routerBody('routeClient'), /requireRole\(ctx, \['OWNER', 'PROPERTY_MANAGER'\]\)/);
  // The admin router guards by capability, which is what separates an
  // operations manager from an administrator inside the same router.
  const admin = routerBody('routeAdmin');
  assert.match(admin, /const capabilities = roleCapabilities\(ctx\.appUser\.role\)/);
  assert.match(admin, /if \(!capabilities\.operations\)\s*\n?\s*throw new ApiError\('Forbidden', 403\)/);
  assert.match(admin, /route\.startsWith\('admin\/finance'\) && !capabilities\.finance/);
  assert.match(admin, /accountRoute && !capabilities\.access/);
  // And the capability table itself keeps finance and account access to the administrator.
  const logic = read('supabase/functions/st-api/logic.mjs');
  assert.match(logic, /if \(role === 'ADMIN'\) return \{ operations: true, finance: true, access: true/);
  assert.match(logic, /if \(role === 'OPERATIONS_MANAGER'\) return \{ operations: true, finance: false, access: false/);
  assert.match(logic, /return \{ operations: false, finance: false, access: false/);
  assert.match(api, /function requireRole\(ctx: any, roles: string \| string\[\]\)/);
  assert.match(api, /if \(!allowed\.includes\(ctx\.appUser\.role\)\) throw new ApiError\('Forbidden', 403\)/);
});

test('the deployment configuration explains why the gate is off', () => {
  const block = config.slice(config.indexOf('[functions.st-api]'));
  assert.match(block, /ST_WORKER_SECRET/, 'the reason is written where the switch is');
  assert.match(block, /authOnly|JWT/i);
});
