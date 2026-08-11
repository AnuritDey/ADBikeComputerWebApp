/**
 * Owns the Leaflet map: tile layer, tap-to-place start/end pins, and
 * drawing a fetched route. Doesn't know about routing.js or the DOM
 * outside the map -- app.js wires this to the rest of the page via the
 * onPointsChanged callback and the returned controller methods.
 */

// Keep in sync with --accent-route in css/style.css -- Leaflet needs a
// literal color string, it can't resolve CSS custom properties itself.
const ROUTE_COLOR = '#3DDBD0';
// Matches --accent-warn -- distinct from the route, and from the start
// (green)/end (red) pins, so a live ride position is never confused with
// either at a glance.
const LIVE_POSITION_COLOR = '#F2A93B';
// Matches --text-muted -- overlays the already-covered portion of the
// route line to visualize ride progress.
const TRAVELED_ROUTE_COLOR = '#7B8794';

const DEFAULT_CENTER = [60.1699, 24.9384]; // Helsinki -- swap for your own city if you like
const DEFAULT_ZOOM = 13;

/**
 * A "you are here" dot + accuracy circle, as a small self-contained unit
 * so the planning-time "Locate Me" feature and live ride tracking can
 * each have their own independent instance -- same visual language,
 * fully separate state, so neither can ever interfere with the other
 * (e.g. tapping Locate Me mid-ride doesn't touch the ride's own marker).
 * Mutates the existing marker/circle in place on repeat calls rather
 * than removing and recreating them, since live tracking calls this
 * roughly once a second for the whole ride.
 */
function createPositionDot(map, color) {
  let marker = null;
  let circle = null;
  return {
    update(latlng, accuracyM) {
      if (marker) {
        marker.setLatLng(latlng);
      } else {
        marker = L.circleMarker(latlng, {
          radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1,
        }).addTo(map);
      }
      if (circle) {
        circle.setLatLng(latlng);
        circle.setRadius(accuracyM);
      } else {
        circle = L.circle(latlng, { radius: accuracyM, color, weight: 1, fillOpacity: 0.08 }).addTo(map);
      }
    },
    clear() {
      if (marker) { map.removeLayer(marker); marker = null; }
      if (circle) { map.removeLayer(circle); circle = null; }
    },
  };
}

/**
 * @param {string} mapElementId
 * @param {{onPointsChanged?: (points: {startPoint: object|null, endPoint: object|null}) => void}} options
 */
export function createMapController(mapElementId, { onPointsChanged } = {}) {
  const map = L.map(mapElementId, { zoomControl: false }).setView(DEFAULT_CENTER, DEFAULT_ZOOM);

  L.control.zoom({ position: 'bottomright' }).addTo(map);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(map);

  let startPoint = null;
  let endPoint = null;
  let startMarker = null;
  let endMarker = null;
  let routeLine = null;
  let traveledLine = null;
  const locateDot = createPositionDot(map, ROUTE_COLOR);
  const liveRideDot = createPositionDot(map, LIVE_POSITION_COLOR);

  const startIcon = L.divIcon({
    className: 'pin pin-start',
    html: '<span class="pin-label">S</span>',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
  });
  const endIcon = L.divIcon({
    className: 'pin pin-end',
    html: '<span class="pin-label">E</span>',
    iconSize: [28, 28],
    iconAnchor: [14, 28],
  });

  function notify() {
    if (onPointsChanged) onPointsChanged({ startPoint, endPoint });
  }

  // Shared by map taps, search results, and "use my location" -- whichever
  // one last set the start/end point wins, so all three stay consistent
  // with each other rather than each keeping separate state.
  function placeStart(lat, lon) {
    startPoint = { lat, lon };
    const latlng = L.latLng(lat, lon);
    if (startMarker) startMarker.setLatLng(latlng);
    else startMarker = L.marker(latlng, { icon: startIcon }).addTo(map);
    notify();
  }

  function placeEnd(lat, lon) {
    endPoint = { lat, lon };
    const latlng = L.latLng(lat, lon);
    if (endMarker) endMarker.setLatLng(latlng);
    else endMarker = L.marker(latlng, { icon: endIcon }).addTo(map);
    notify();
  }

  map.on('click', (e) => {
    if (!startPoint) {
      placeStart(e.latlng.lat, e.latlng.lng);
    } else if (!endPoint) {
      placeEnd(e.latlng.lat, e.latlng.lng);
    }
    // Both already set: ignore further taps until Reset. Otherwise an
    // accidental tap while looking at a planned route would silently move
    // your end pin without you noticing. Search results and "use my
    // location" deliberately don't have this restriction -- see
    // setStartPoint/setEndPoint and locateMe below.
  });

  function drawRoute(coordinates, { fitBounds = true } = {}) {
    if (routeLine) map.removeLayer(routeLine);
    // Also clear any "traveled" progress overlay from a previous route --
    // called both for the initial plan and by a reroute (see app.js's
    // triggerReroute), and a stale gray overlay from a route that no
    // longer exists would otherwise linger alongside the new one.
    if (traveledLine) { map.removeLayer(traveledLine); traveledLine = null; }
    const latlngs = coordinates.map((c) => [c.lat, c.lon]);
    routeLine = L.polyline(latlngs, { color: ROUTE_COLOR, weight: 4, opacity: 0.9 }).addTo(map);
    // fitBounds: true for the initial plan (you want to see the whole new
    // route immediately). A mid-ride reroute passes false -- forcibly
    // recentering would yank the view away from wherever you'd
    // deliberately panned/zoomed to watch your live progress.
    if (fitBounds) map.fitBounds(routeLine.getBounds(), { padding: [48, 48] });
  }

  function reset() {
    startPoint = null;
    endPoint = null;
    if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
    if (endMarker) { map.removeLayer(endMarker); endMarker = null; }
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    if (traveledLine) { map.removeLayer(traveledLine); traveledLine = null; }
    liveRideDot.clear();
    notify();
  }

  /**
   * Finds the device's current position and sets it as the start point --
   * a deliberate action, so (unlike a map tap) this always overrides
   * whatever start point was set before. Also drops a "you are here" dot
   * with an accuracy-radius circle, and reports success/failure via the
   * onFound/onError callbacks, since this doubles as a quick way to check
   * whether geolocation is working in this browser/page at all,
   * independent of the ride-telemetry code path.
   */
  function locateMe({ onFound, onError } = {}) {
    map.once('locationfound', (e) => {
      locateDot.update(e.latlng, e.accuracy);
      map.setView(e.latlng, 15);
      placeStart(e.latlng.lat, e.latlng.lng);
      if (onFound) onFound(e);
    });
    map.once('locationerror', (e) => {
      if (onError) onError(e);
    });
    map.locate({ enableHighAccuracy: true, timeout: 20000 });
  }

  /**
   * Updates the live ride position marker -- purely passive, no side
   * effects (doesn't touch start/end points, doesn't pan/zoom the map).
   * Deliberately simple, per the actual ask: a way to glance at the
   * planning map during a ride and see where you are and how far you've
   * gotten, not a second navigation UI competing with the M5Stack.
   */
  function updateLivePosition(lat, lon, accuracyM) {
    liveRideDot.update(L.latLng(lat, lon), accuracyM);
  }

  /**
   * Overlays the already-covered portion of the route in a muted color,
   * on top of the original route line -- a free, cheap way to visualize
   * progress using data already on the map, rather than a separate
   * progress bar or stat. traveledLatLngs is the route's own coordinates
   * from the start up to wherever you currently are, in [lat, lon] pairs
   * (same format drawRoute already uses).
   */
  function updateRouteProgress(traveledLatLngs) {
    if (traveledLine) { map.removeLayer(traveledLine); traveledLine = null; }
    if (traveledLatLngs.length < 2) return;
    traveledLine = L.polyline(traveledLatLngs, {
      color: TRAVELED_ROUTE_COLOR, weight: 5, opacity: 0.85,
    }).addTo(map);
  }

  return {
    drawRoute,
    reset,
    locateMe,
    updateLivePosition,
    updateRouteProgress,
    setStartPoint: placeStart,
    setEndPoint: placeEnd,
    getPoints: () => ({ startPoint, endPoint }),
  };
}
