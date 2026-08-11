/**
 * Converts WGS84 lat/lon into local (x, y) meters, relative to a chosen
 * origin point -- the same kind of local space main_route/side_stubs used
 * to live in on the Python side (companion_app/geo.py), just built
 * differently here.
 *
 * companion_app/geo.py had to match osmnx's specific map projection
 * because its route and its live GPS fixes came from two different
 * sources that needed reconciling. Here, both the route (from OSRM) and
 * live GPS fixes (from the browser) are already lat/lon -- so a
 * flat-earth (equirectangular) approximation applied consistently is
 * enough. No projection library needed.
 *
 * IMPORTANT: the cos(lat) scale factor for longitude->meters is fixed to
 * REGION_ORIGIN_LAT, NOT to whatever origin a particular frame is built
 * around. This matters once the SD grid system is in play: a route's
 * local frame (built from that route's own start point) and the
 * region-wide absolute frame (built from REGION_ORIGIN_LAT/LON, used for
 * SD grid-cell lookups) get added together on the firmware side
 * (originAbs + telemetryLocal). If each frame used its own origin's
 * latitude for the cos(lat) factor, that sum would be combining two
 * slightly different "meters" -- small per-frame, but real, and it's
 * exactly the kind of subtle mismatch that already cost real debugging
 * time once this session (see the route/area-context origin mismatch).
 * One global scale factor, used everywhere, removes the risk instead of
 * bounding how small each usage's error might be. Must stay identical to
 * map_tools/generate_region_grid.py's equivalent constant.
 */
import { REGION_ORIGIN_LAT } from './config.js';

const EARTH_RADIUS_M = 6371000;

const SCALE_LAT_RAD = (REGION_ORIGIN_LAT * Math.PI) / 180;
const METERS_PER_DEG_LAT = (Math.PI / 180) * EARTH_RADIUS_M;
const METERS_PER_DEG_LON = (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(SCALE_LAT_RAD);

/**
 * @param {number} originLat
 * @param {number} originLon
 * @returns {{originLat:number, originLon:number, toLocal: (lat:number, lon:number) => {x:number, y:number}}}
 */
export function makeLocalFrame(originLat, originLon) {
  return {
    originLat,
    originLon,
    toLocal(lat, lon) {
      return {
        x: (lon - originLon) * METERS_PER_DEG_LON,
        y: (lat - originLat) * METERS_PER_DEG_LAT,
      };
    },
  };
}
