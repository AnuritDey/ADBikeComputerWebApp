/**
 * Entry point for the route planner screen. Wires the map controller
 * (map.js) and the routing call (routing.js) to the DOM. No BLE yet --
 * that's phase 2, which will pick up currentRoute.coordinates from here
 * and feed it into the same binary protocol the Python companion_app used
 * (see ../../companion_app/protocol.py for the format it needs to match).
 */
import { fetchRoute } from './routing.js';
import { createMapController } from './map.js';

const instructionsEl = document.getElementById('instructions');
const distanceEl = document.getElementById('stat-distance');
const timeEl = document.getElementById('stat-time');
const pointsEl = document.getElementById('stat-points');
const statusEl = document.getElementById('telemetry-status');
const planBtn = document.getElementById('plan-btn');
const resetBtn = document.getElementById('reset-btn');
const locateBtn = document.getElementById('locate-btn');
const toastEl = document.getElementById('toast');

let currentRoute = null; // { coordinates, distanceM, durationS } once planned
let toastTimer = null;

const mapController = createMapController('map', { onPointsChanged: handlePointsChanged });

function handlePointsChanged({ startPoint, endPoint }) {
  currentRoute = null;
  updateStats(null);

  if (!startPoint) {
    instructionsEl.innerHTML = 'Tap the map to set your <strong class="text-start">start</strong> point.';
    planBtn.disabled = true;
  } else if (!endPoint) {
    instructionsEl.innerHTML = 'Tap the map to set your <strong class="text-end">end</strong> point.';
    planBtn.disabled = true;
  } else {
    instructionsEl.innerHTML = 'Start and end set. Tap <strong>Plan route</strong>, or Reset to move a pin.';
    planBtn.disabled = false;
  }
}

function updateStats(route) {
  if (!route) {
    distanceEl.textContent = '\u2014';
    timeEl.textContent = '\u2014';
    pointsEl.textContent = '\u2014';
    statusEl.classList.remove('is-live');
    return;
  }
  distanceEl.textContent = `${(route.distanceM / 1000).toFixed(1)} km`;
  timeEl.textContent = formatDuration(route.durationS);
  pointsEl.textContent = String(route.coordinates.length);
  statusEl.classList.add('is-live');
}

function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remainder = mins % 60;
  return `${hours}h ${remainder}m`;
}

function showToast(message, isError = false) {
  toastEl.textContent = message;
  toastEl.hidden = false;
  toastEl.classList.toggle('toast-error', isError);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.hidden = true; }, 4000);
}

planBtn.addEventListener('click', async () => {
  const { startPoint, endPoint } = mapController.getPoints();
  if (!startPoint || !endPoint) return;

  planBtn.disabled = true;
  planBtn.textContent = 'Planning\u2026';
  instructionsEl.textContent = 'Requesting route\u2026';

  try {
    const route = await fetchRoute(startPoint, endPoint);
    currentRoute = route;
    mapController.drawRoute(route.coordinates);
    updateStats(route);
    instructionsEl.innerHTML = 'Route planned. Reset to try a different route.';
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Could not plan a route between these points.', true);
    instructionsEl.innerHTML = 'Route planning failed \u2014 tap <strong>Plan route</strong> to retry, or Reset.';
  } finally {
    planBtn.disabled = false;
    planBtn.textContent = 'Plan route';
  }
});

resetBtn.addEventListener('click', () => {
  mapController.reset();
  currentRoute = null;
});

locateBtn.addEventListener('click', () => {
  mapController.locateMe();
});
