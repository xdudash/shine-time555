/**
 * Converts the existing v4 browser API contract into the payload accepted by
 * the Supabase Edge Function. Keeping this boundary stable means the v4 UI
 * (roles, routes, forms and screens) does not need to be reimplemented.
 */
export function toEdgeRequest(path, method = 'GET', body = null, clientBuild = null) {
  const url = new URL(path, 'https://shinetime.local');
  const route = url.pathname.replace(/^\/api\/?/, '').replace(/^\/+|\/+$/g, '');

  return {
    route,
    method: String(method || 'GET').toUpperCase(),
    query: Object.fromEntries(url.searchParams.entries()),
    body: body ?? null,
    clientBuild,
  };
}
