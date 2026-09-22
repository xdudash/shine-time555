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

  function adminNavigationForRole(items, role) {
    if (role !== 'OPERATIONS_MANAGER') return items;
    const restricted = new Set(['owner', 'clients', 'cleaners', 'finance', 'settlements', 'settings']);
    return items.filter(([route]) => !restricted.has(route));
  }

  window.ShineTimeUi = { adminNavigationForRole, parseCoordinate, mapPoints };
})();
