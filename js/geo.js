/**
 * Converts WGS84 lat/lon into local (x, y) meters, relative to a chosen
 * origin point -- the same kind of local space main_route/side_stubs used
 * to live in on the Python side (companion_app/geo.py), just built
 * differently here.
 *
 * companion_app/geo.py had to match osmnx's specific map projection
 * because its route and its live GPS fixes came from two different
 * sources that needed reconciling. Here, both the route (from OSRM) and
 * live GPS fixes (from the browser, in phase 3) are already lat/lon --
 * so a flat-earth (equirectangular) approximation applied consistently to
 * both is enough. Accurate to a fraction of a percent over the few-km
 * scale a ride covers; no projection library needed.
 */
const EARTH_RADIUS_M = 6371000;

/**
 * @param {number} originLat
 * @param {number} originLon
 * @returns {{toLocal: (lat:number, lon:number) => {x:number, y:number}}}
 */
export function makeLocalFrame(originLat, originLon) {
  const originLatRad = (originLat * Math.PI) / 180;
  const metersPerDegLat = (Math.PI / 180) * EARTH_RADIUS_M;
  const metersPerDegLon = (Math.PI / 180) * EARTH_RADIUS_M * Math.cos(originLatRad);

  return {
    toLocal(lat, lon) {
      return {
        x: (lon - originLon) * metersPerDegLon,
        y: (lat - originLat) * metersPerDegLat,
      };
    },
  };
}
