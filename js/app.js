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
const statusEl = document.getElementById('telemetry-status'); // small pulse dot -- route-planned indicator only
const planBtn = document.getElementById('plan-btn');
const resetBtn = document.getElementById('reset-btn');
const locateBtn = document.getElementById('locate-btn');
const toastEl = document.getElementById('toast');
const sendBtn = document.getElementById('send-btn');
const bleStatusEl = document.getElementById('ble-status');
const startRideBtn = document.getElementById('start-ride-btn');
const stopRideBtn = document.getElementById('stop-ride-btn');
const rideStatusEl = document.getElementById('ride-status');

let currentRoute = null; // { coordinates, distanceM, durationS } once planned
let toastTimer = null;
let currentFrame = null;     // local frame for this route
let telemetryWatchId = null; // geolocation watch handle
let lastFix = null;
let sending = false;        // in-flight BLE write guard, drop a fix rather than queue it
let smoothedHeading = null; // exponential heading smoothing state
let wakeLock = null;        // screen wake lock handle, held while a ride is active
let lastGeoErrorCode = null; // last geolocation error code shown, to avoid re-toasting the same error every retry

const ble = new BleConnection();
ble.onDisconnected = () => {
  stopTelemetry();
  bleStatusEl.textContent = 'Disconnected';
  sendBtn.textContent = 'Send to Bike Computer';
};

if (!navigator.bluetooth) {
  bleStatusEl.textContent = 'Web Bluetooth unavailable \u2014 use Chrome on Android';
}

const mapController = createMapController('map', { onPointsChanged: handlePointsChanged });

function handlePointsChanged({ startPoint, endPoint }) {
  stopTelemetry();        // a pin move always invalidates the active ride
  currentRoute = null;
  currentFrame = null;
  updateStats(null);
  sendBtn.disabled = true;
  startRideBtn.disabled = true;

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
    const origin = route.coordinates[0];
    currentFrame = makeLocalFrame(origin.lat, origin.lon);
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
  stopTelemetry();
  mapController.reset();
  currentRoute = null;
  currentFrame = null;
  sendBtn.disabled = true;
  sendBtn.textContent = 'Send to Bike Computer';
  startRideBtn.disabled = true;
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
    const localPoints = currentRoute.coordinates.map((c) => currentFrame.toLocal(c.lat, c.lon));

    await ble.sendMap(localPoints);

    sendBtn.textContent = 'Sent \u2014 tap to resend';
    showToast('Map sent \u2014 enable Start Ride to stream GPS.');

    startRideBtn.disabled = false;
  } catch (err) {
    console.error(err);
    showToast(err.message || 'Could not send the route to the bike computer.', true);
    sendBtn.textContent = 'Send to Bike Computer';
  } finally {
    sendBtn.disabled = false;
  }
});

function computeBearing(fromLat, fromLon, toLat, toLon) {
  const φ1 = (fromLat * Math.PI) / 180;
  const φ2 = (toLat * Math.PI) / 180;
  const Δλ = ((toLon - fromLon) * Math.PI) / 180;

  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) -
            Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  let deg = (Math.atan2(y, x) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

function smoothBearing(newHeading) {
  if (smoothedHeading === null) { smoothedHeading = newHeading; return newHeading; }
  const diff = ((newHeading - smoothedHeading + 540) % 360) - 180;
  smoothedHeading = (smoothedHeading + 0.3 * diff + 360) % 360;
  return smoothedHeading;
}

async function requestWakeLock() {
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (err) {
    console.warn('Wake lock failed:', err);
  }
}

async function startTelemetry() {
  if (!currentRoute || !currentFrame) {
    showToast('Plan and send a route before starting telemetry.', true);
    return;
  }
  if (!ble.isConnected) {
    showToast('Connect and send the map first.', true);
    return;
  }
  if (!navigator.geolocation) {
    showToast('Geolocation not available in this browser.', true);
    return;
  }

  rideStatusEl.textContent = 'Live GPS: starting\u2026';
  lastFix = null;
  smoothedHeading = null;   // reset from any previous ride
  lastGeoErrorCode = null;
  startRideBtn.disabled = true;
  stopRideBtn.disabled = false;
  sendBtn.disabled = true;  // avoid an accidental resend interrupting the M5Stack mid-ride

  await requestWakeLock();  // must come after button state, before watchPosition

  telemetryWatchId = navigator.geolocation.watchPosition(
    async (pos) => {
      if (sending) return;              // rate-limit guard, first line in callback
      sending = true;
      try {
        if (pos.coords.accuracy > 25) { // accuracy filter, right after entering try
          rideStatusEl.textContent = `Live GPS: weak fix (\u00b1${Math.round(pos.coords.accuracy)}m)`;
          return;
        }

        const lat = pos.coords.latitude;
        const lon = pos.coords.longitude;
        const { x, y } = currentFrame.toLocal(lat, lon);

        const rawHeading = lastFix ? computeBearing(lastFix.lat, lastFix.lon, lat, lon) : 0;
        const headingDeg = lastFix ? smoothBearing(rawHeading) : 0; // smoothing applied here
        lastFix = { lat, lon };

        await ble.sendTelemetry(x, y, headingDeg);
        rideStatusEl.textContent = 'Live GPS: streaming\u2026';
        lastGeoErrorCode = null; // a good fix arrived -- clear any earlier error state
      } catch (err) {
        console.error(err);
        rideStatusEl.textContent = 'Live GPS: send error';
      } finally {
        sending = false;                // always release the guard
      }
    },
    (err) => {
      console.error(err);
      // GeolocationPositionError fires repeatedly while no fix is available
      // (e.g. every ~20s here) -- only toast once per distinct error type so
      // it doesn't spam the screen the whole time you're waiting for a fix.
      if (err.code !== lastGeoErrorCode) {
        showToast(geolocationErrorMessage(err), true);
        lastGeoErrorCode = err.code;
      }
      rideStatusEl.textContent = `Live GPS: ${geolocationErrorMessage(err)}`;
    },
    // enableHighAccuracy uses the GPS chip rather than WiFi/cell positioning
    // -- necessary for real riding, but a cold-start GPS fix (especially
    // indoors, or right after enabling location) can easily take longer
    // than a few seconds. 20s gives it real room before reporting a timeout.
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 }
  );
}

function geolocationErrorMessage(err) {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return 'Location permission denied \u2014 enable it in Chrome settings.';
    case err.POSITION_UNAVAILABLE:
      return 'Location unavailable right now.';
    case err.TIMEOUT:
      return 'Waiting for GPS signal \u2014 try moving outdoors or near a window.';
    default:
      return 'Location error.';
  }
}

async function stopTelemetry() {
  if (telemetryWatchId !== null) {
    navigator.geolocation.clearWatch(telemetryWatchId);
    telemetryWatchId = null;
  }
  if (wakeLock) {
    await wakeLock.release();
    wakeLock = null;
  }
  rideStatusEl.textContent = 'Live GPS: stopped';
  lastFix = null;
  smoothedHeading = null;         // reset alongside lastFix
  startRideBtn.disabled = false;
  stopRideBtn.disabled = true;
  sendBtn.disabled = false;
}

startRideBtn.addEventListener('click', startTelemetry);
stopRideBtn.addEventListener('click', stopTelemetry);
