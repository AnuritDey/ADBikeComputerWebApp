/**
 * Owns the Leaflet map: tile layer, tap-to-place start/end pins, and
 * drawing a fetched route. Doesn't know about routing.js or the DOM
 * outside the map -- app.js wires this to the rest of the page via the
 * onPointsChanged callback and the returned controller methods.
 */

// Keep in sync with --accent-route in css/style.css -- Leaflet needs a
// literal color string, it can't resolve CSS custom properties itself.
const ROUTE_COLOR = '#3DDBD0';

const DEFAULT_CENTER = [60.1699, 24.9384]; // Helsinki -- swap for your own city if you like
const DEFAULT_ZOOM = 13;

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
  let currentLocationMarker = null;
  let currentLocationCircle = null;

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

  function drawRoute(coordinates) {
    if (routeLine) map.removeLayer(routeLine);
    const latlngs = coordinates.map((c) => [c.lat, c.lon]);
    routeLine = L.polyline(latlngs, { color: ROUTE_COLOR, weight: 4, opacity: 0.9 }).addTo(map);
    map.fitBounds(routeLine.getBounds(), { padding: [48, 48] });
  }

  function reset() {
    startPoint = null;
    endPoint = null;
    if (startMarker) { map.removeLayer(startMarker); startMarker = null; }
    if (endMarker) { map.removeLayer(endMarker); endMarker = null; }
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
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
      if (currentLocationMarker) map.removeLayer(currentLocationMarker);
      if (currentLocationCircle) map.removeLayer(currentLocationCircle);

      currentLocationMarker = L.circleMarker(e.latlng, {
        radius: 7, color: '#fff', weight: 2, fillColor: ROUTE_COLOR, fillOpacity: 1,
      }).addTo(map);
      currentLocationCircle = L.circle(e.latlng, {
        radius: e.accuracy, color: ROUTE_COLOR, weight: 1, fillOpacity: 0.08,
      }).addTo(map);

      map.setView(e.latlng, 15);
      placeStart(e.latlng.lat, e.latlng.lng);

      if (onFound) onFound(e);
    });
    map.once('locationerror', (e) => {
      if (onError) onError(e);
    });
    map.locate({ enableHighAccuracy: true, timeout: 20000 });
  }

  return {
    drawRoute,
    reset,
    locateMe,
    setStartPoint: placeStart,
    setEndPoint: placeEnd,
    getPoints: () => ({ startPoint, endPoint }),
  };
}
