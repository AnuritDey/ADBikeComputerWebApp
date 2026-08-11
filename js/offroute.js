/**
 * Off-route detection -- a JS port of firmware/map_data.cpp's
 * distanceFromRoute(), same point-to-segment-distance algorithm, so the
 * phone's rerouting trigger and the M5Stack's own visual warning border
 * agree on what "off route" means. Both take the SAME local (x, y) meter
 * space the route/telemetry already use (see geo.js's makeLocalFrame) --
 * this file has no knowledge of lat/lon at all, on purpose.
 */

/** Shortest distance from point (px, py) to the segment (x1,y1)-(x2,y2). */
function pointToSegmentDistance(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSq = dx * dx + dy * dy;

  if (lengthSq < 1e-6) {
    // Degenerate segment (a repeated point) -- just distance to the point.
    const ex = px - x1;
    const ey = py - y1;
    return Math.sqrt(ex * ex + ey * ey);
  }

  let t = ((px - x1) * dx + (py - y1) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = x1 + t * dx;
  const closestY = y1 + t * dy;
  const ex = px - closestX;
  const ey = py - closestY;
  return Math.sqrt(ex * ex + ey * ey);
}

/**
 * Shortest distance from (px, py) to any segment of the route polyline.
 * @param {{x:number, y:number}[]} routeLocalPoints
 */
export function distanceToRoute(routeLocalPoints, px, py) {
  if (!routeLocalPoints || routeLocalPoints.length < 2) return 0;

  let minDist = Infinity;
  for (let i = 1; i < routeLocalPoints.length; i++) {
    const a = routeLocalPoints[i - 1];
    const b = routeLocalPoints[i];
    const d = pointToSegmentDistance(px, py, a.x, a.y, b.x, b.y);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

/**
 * Index of the route vertex nearest to (px, py) -- used to split the
 * route into "already covered" vs "remaining" for the progress overlay
 * on the planning map (see map.js's updateRouteProgress). Deliberately
 * vertex-level, not segment-interpolated like distanceToRoute() above --
 * simpler, and precise enough at the point spacing a simplified route
 * actually has; this is a visualization, not a safety-relevant distance.
 * @param {{x:number, y:number}[]} routeLocalPoints
 */
export function nearestRouteIndex(routeLocalPoints, px, py) {
  if (!routeLocalPoints || routeLocalPoints.length === 0) return 0;

  let nearestIdx = 0;
  let minDistSq = Infinity;
  for (let i = 0; i < routeLocalPoints.length; i++) {
    const dx = routeLocalPoints[i].x - px;
    const dy = routeLocalPoints[i].y - py;
    const distSq = dx * dx + dy * dy;
    if (distSq < minDistSq) {
      minDistSq = distSq;
      nearestIdx = i;
    }
  }
  return nearestIdx;
}
