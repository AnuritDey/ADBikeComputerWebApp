/**
 * Entry point for the route planner screen. Wires the map controller
 * (map.js), the routing call (routing.js), and the BLE send flow (ble.js)
 * to the DOM.
 */
import { fetchRoute } from './routing.js';
import { createMapController } from './map.js';
import { BleConnection } from './ble.js';
import { makeLocalFrame } from './geo.js';

const instructionsEl = document.getElementById('instructions');
const distanceEl = document.getElementById('stat-distance');
const timeEl = document.getElementById('stat-time');
const pointsEl = document.getElementById('stat-points');
const statusEl = document.getElementById('telemetry-status');
const planBtn = document.getElementById('plan-btn');
const resetBtn = document.getElementById('reset-btn');
const locateBtn = document.getElementById('locate-btn');
const toastEl = document.getElementById('toast');
const sendBtn = document.getElementById('send-btn');
const bleStatusEl = document.getElementById('ble-status');

let currentRoute = null; // { coordinates, distanceM, durationS } once planned
let toastTimer = null;

const ble = new BleConnection();
ble.onDisconnected = () => {
  bleStatusEl.textContent = 'Disconnected';
  sendBtn.textContent = 'Send to Bike Computer';
};

if (!navigator.bluetooth) {
  bleStatusEl.textContent = 'Web Bluetooth unavailable \u2014 use Chrome on Android';
}

const mapController = createMapController('map', { onPointsChanged: handlePointsChanged });

function handlePointsChanged({ startPoint, endPoint }) {
  currentRoute = null;
  updateStats(null);
  sendBtn.disabled = true;

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
    sendBtn.disabled = false;
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
  sendBtn.disabled = true;
  sendBtn.textContent = 'Send to Bike Computer';
});

locateBtn.addEventListener('click', () => {
  mapController.locateMe();
});

sendBtn.addEventListener('click', async () => {
  if (!currentRoute) return;

  sendBtn.disabled = true;

  try {
    if (!ble.isConnected) {
      bleStatusEl.textContent = 'Connecting\u2026';
      await ble.connect();
      bleStatusEl.textContent = `Connected to ${ble.device.name || 'bike computer'}`;
    }

    sendBtn.textContent = 'Sending map\u2026';
    // Origin = the route's own start point, so the firmware's (0,0) lines
    // up with where you actually start riding -- same convention the
    // Python pipeline used (map_builder.py's build_main_route).
    const origin = currentRoute.coordinates[0];
    const frame = makeLocalFrame(origin.lat, origin.lon);
    const localPoints = currentRoute.coordinates.map((c) => frame.toLocal(c.lat, c.lon));

    await ble.sendMap(localPoints);

    sendBtn.textContent = 'Sent \u2014 tap to resend';
    showToast('Map sent \u2014 check the bike computer screen.');
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Could not send the route to the bike computer.', true);
    sendBtn.textContent = 'Send to Bike Computer';
  } finally {
    sendBtn.disabled = false;
  }
});
