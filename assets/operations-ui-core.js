(() => {
  function parseCoordinate(value, axis) {
    const normalized = String(value ?? '').trim().replace(',', '.');
    if (!/^[+-]?(?:\d+|\d+\.\d+|\.\d+)$/.test(normalized)) return null;
    const coordinate = Number(normalized);
    if (!Number.isFinite(coordinate)) return null;
    const limit = axis === 'lat' ? 90 : axis === 'lng' ? 180 : null;
    if (limit === null || coordinate < -limit || coordinate > limit) return null;
    return coordinate;
  }

  function mapPoints(objects = [], jobs = []) {
    const jobByObject = new Map(jobs.map((job) => [String(job.object_id), job]));
    return objects.map((object) => {
      const lat = parseCoordinate(object.lat, 'lat');
      const lng = parseCoordinate(object.lng, 'lng');
      if (lat === null || lng === null) return null;
      const job = jobByObject.get(String(object.id));
      if (job) {
        return {
          id: job.id,
          lat,
          lng,
          name: `${job.object_code || object.code || 'Object'} · ${job.status || 'UNASSIGNED'}`,
          detail: `${job.address || object.address || ''} · ${job.cleaner_name || 'Unassigned'}`,
          status: job.status || 'UNASSIGNED',
          job: true,
        };
      }
      return {
        id: object.id,
        lat,
        lng,
        name: `${object.code || 'Object'} · ${object.name || 'Unnamed object'}`,
        detail: `${object.address || ''} · ${object.zone || ''}`,
        status: 'OBJECT',
        job: false,
      };
    }).filter(Boolean);
  }

  const restrictedAdminRoutes = new Set(['owner', 'clients', 'finance', 'settlements', 'statements', 'settings']);
  /* The nine approved sections (fix 21). The old page names still work, so a
     bookmark or an old link keeps opening the right screen; this maps them to
     the section that now hosts them. */
  const adminSectionAliases = {
    live: 'today', map: 'today', tomorrow: 'today', monitoring: 'today',
    jobs: 'cleanings', schedule: 'cleanings', recurring: 'cleanings',
    issues: 'review',
    cleaners: 'team', managers: 'team',
    // 'finance' is its own section; the three screens that used to be separate
    // menu entries are its tabs.
    owner: 'finance', settlements: 'finance', statements: 'finance', entries: 'finance',
  };
  const adminSectionFor = (page) => adminSectionAliases[String(page)] || String(page);
  function adminRouteAllowed(page, role) {
    if (role === 'ADMIN') return true;
    if (role !== 'OPERATIONS_MANAGER') return false;
    return !restrictedAdminRoutes.has(page) && !restrictedAdminRoutes.has(adminSectionFor(page));
  }
  function adminNavigationForRole(items, role) {
    return items.filter(([page]) => adminRouteAllowed(page, role));
  }

  function navigationRoute(route) {
    const [area, page] = String(route).split('?')[0].split('/');
    if (area === 'admin') return `admin/${adminSectionFor(page || 'today')}`;
    if (area === 'cleaner' && page === 'job') return 'cleaner/myday';
    if (area === 'client' && page === 'booking') return 'client/bookings';
    return `${area}/${page}`;
  }

  window.ShineTimeUi = { navigationRoute, adminRouteAllowed, adminNavigationForRole, adminSectionFor, parseCoordinate, mapPoints };
})();
