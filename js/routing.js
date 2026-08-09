/**
 * Route fetching via OSRM's public demo server.
 *
 * Endpoint docs: https://github.com/Project-OSRM/osrm-backend/wiki/Demo-server
 * Usage policy: max ~1 request/sec, personal/non-commercial use only, no
 * uptime guarantee. That's fine for planning your own rides -- if you
 * outgrow it (heavier use, need it to work when this server is down),
 * self-host OSRM and change OSRM_BASE below to point at your own instance.
 */
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/bike';

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
