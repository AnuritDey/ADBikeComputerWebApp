/**
 * Route fetching via the FOSSGIS-sponsored public OSRM server.
 *
 * NOTE: this is deliberately NOT router.project-osrm.org. That server
 * (OSRM's original demo instance) only ever runs the car/driving profile
 * -- it accepts "bike" or "foot" in the URL without validating it and
 * silently serves a car route anyway, no error. Confirmed by OSRM's own
 * maintainers: https://github.com/Project-OSRM/osrm-backend/issues/4034
 *
 * routing.openstreetmap.de runs car/bike/foot as genuinely separate
 * backend instances, selected via the routed-{profile} path segment --
 * the /driving/ later in the URL is just the fixed OSRM API mode-word and
 * doesn't need to change per profile. Info: https://routing.openstreetmap.de/about.html
 *
 * Usage policy: personal/light use, run by a volunteer org (FOSSGIS), no
 * published rate limit or uptime guarantee. Fine for planning your own
 * rides -- if you outgrow it, self-host OSRM and change OSRM_BASE below.
 */
const OSRM_BASE = 'https://routing.openstreetmap.de/routed-bike/route/v1/driving';

/**
 * @param {{lat: number, lon: number}} start
 * @param {{lat: number, lon: number}} end
 * @returns {Promise<{coordinates: {lat:number, lon:number}[], distanceM: number, durationS: number}>}
 */
export async function fetchRoute(start, end) {
  const coords = `${start.lon},${start.lat};${end.lon},${end.lat}`;
  const url = `${OSRM_BASE}/${coords}?overview=full&geometries=geojson`;

  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error('Could not reach the routing server -- check your connection.');
  }

  if (!response.ok) {
    throw new Error(`Routing server error (HTTP ${response.status})`);
  }

  const data = await response.json();
  if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
    throw new Error(data.message || 'No cycling route found between these points.');
  }

  const route = data.routes[0];
  return {
    // GeoJSON coordinates are [lon, lat] -- flip to the {lat, lon} shape
    // used everywhere else in this app to avoid mixing conventions.
    coordinates: route.geometry.coordinates.map(([lon, lat]) => ({ lat, lon })),
    distanceM: route.distance,
    durationS: route.duration,
  };
}
