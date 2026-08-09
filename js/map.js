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

  map.on('click', (e) => {
    if (!startPoint) {
      startPoint = { lat: e.latlng.lat, lon: e.latlng.lng };
      startMarker = L.marker(e.latlng, { icon: startIcon }).addTo(map);
      notify();
    } else if (!endPoint) {
      endPoint = { lat: e.latlng.lat, lon: e.latlng.lng };
      endMarker = L.marker(e.latlng, { icon: endIcon }).addTo(map);
      notify();
    }
    // Both already set: ignore further taps until Reset. Otherwise an
    // accidental tap while looking at a planned route would silently move
    // your end pin without you noticing.
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

  function locateMe() {
    map.locate({ setView: true, maxZoom: 15 });
  }

  return {
    drawRoute,
    reset,
    locateMe,
    getPoints: () => ({ startPoint, endPoint }),
  };
}
