/**
 * Entry point for the route planner screen. Wires the map controller
 * (map.js), the routing call (routing.js), and the BLE send flow (ble.js)
 * to the DOM.
 */
import { fetchRoute } from './routing.js';
import { createMapController } from './map.js';
import { BleConnection } from './ble.js';
import { makeLocalFrame } from './geo.js';
import { searchPlace } from './geocoding.js';

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
const testGpsBtn = document.getElementById('test-gps-btn');
const gpsDiagnosticEl = document.getElementById('gps-diagnostic-output');
const startSearchInput = document.getElementById('start-search-input');
const startSearchBtn = document.getElementById('start-search-btn');
const startSearchResults = document.getElementById('start-search-results');
const endSearchInput = document.getElementById('end-search-input');
const endSearchBtn = document.getElementById('end-search-btn');
const endSearchResults = document.getElementById('end-search-results');

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
    instructionsEl.innerHTML = 'Search, or tap the map, to set your <strong class="text-start">start</strong> point.';
    planBtn.disabled = true;
  } else if (!endPoint) {
    instructionsEl.innerHTML = 'Search, or tap the map, to set your <strong class="text-end">end</strong> point.';
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
  startSearchInput.value = '';
  endSearchInput.value = '';
  startSearchResults.hidden = true;
  endSearchResults.hidden = true;
});

locateBtn.addEventListener('click', () => {
  mapController.locateMe({
    onFound: (e) => {
      showToast(`Location found (\u00b1${Math.round(e.accuracy)}m) \u2014 set as start.`);
    },
    onError: (e) => {
      showToast(e.message || 'Could not get your location.', true);
    },
  });
});

/**
 * Wires one search field (input + button + results dropdown) to Nominatim.
 * Fires only on Enter or the button -- never on 'input' -- per Nominatim's
 * usage policy, which explicitly forbids client-side autocomplete against
 * the public API. Shared between the start and end fields below.
 */
function wireSearchField({ inputEl, buttonEl, resultsEl, onSelect }) {
  async function runSearch() {
    const query = inputEl.value.trim();
    if (!query) return;

    buttonEl.disabled = true;
    resultsEl.hidden = false;
    resultsEl.innerHTML = '<li class="search-no-results">Searching\u2026</li>';

    try {
      const results = await searchPlace(query);
      if (results.length === 0) {
        resultsEl.innerHTML = '<li class="search-no-results">No matches \u2014 try a different search, or tap the map.</li>';
        return;
      }
      resultsEl.innerHTML = '';
      for (const result of results) {
        const li = document.createElement('li');
        li.className = 'search-result-item';
        li.textContent = result.label;
        li.tabIndex = 0;
        li.addEventListener('click', () => {
          onSelect(result);
          resultsEl.hidden = true;
          inputEl.value = result.label;
        });
        resultsEl.appendChild(li);
      }
    } catch (err) {
      console.error(err);
      resultsEl.innerHTML = `<li class="search-no-results">${err.message || 'Search failed.'}</li>`;
    } finally {
      buttonEl.disabled = false;
    }
  }

  buttonEl.addEventListener('click', runSearch);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearch();
    }
  });
}

wireSearchField({
  inputEl: startSearchInput,
  buttonEl: startSearchBtn,
  resultsEl: startSearchResults,
  onSelect: (result) => mapController.setStartPoint(result.lat, result.lon),
});

wireSearchField({
  inputEl: endSearchInput,
  buttonEl: endSearchBtn,
  resultsEl: endSearchResults,
  onSelect: (result) => mapController.setEndPoint(result.lat, result.lon),
});

// Close whichever results dropdown is open when tapping elsewhere on the page.
document.addEventListener('click', (e) => {
  for (const el of document.querySelectorAll('.search-results')) {
    if (!el.parentElement.contains(e.target)) el.hidden = true;
  }
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

  // Adaptive smoothing: a small diff is treated as GPS noise and eased in
  // gently (0.3), which is what keeps heading stable during straight
  // travel. But that same gentleness made a REAL turn take ~6-7 fixes to
  // catch up (0.7^n residual error), which showed up as the marker
  // drifting ~10m off for a few seconds after an actual turn before
  // slowly correcting. A large diff is much more likely a genuine turn
  // than noise, so react fast (0.7) instead.
  const TURN_THRESHOLD_DEG = 30;
  const factor = Math.abs(diff) > TURN_THRESHOLD_DEG ? 0.7 : 0.3;

  smoothedHeading = (smoothedHeading + factor * diff + 360) % 360;
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

async function handleGpsFix(pos) {
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
}

function handleGpsError(err) {
  console.error(err);
  // GeolocationPositionError fires repeatedly while no fix is available --
  // only toast once per distinct error type so it doesn't spam the screen
  // the whole time you're waiting for a fix.
  if (err.code !== lastGeoErrorCode) {
    showToast(geolocationErrorMessage(err), true);
    lastGeoErrorCode = err.code;
  }
  rideStatusEl.textContent = `Live GPS: ${geolocationErrorMessage(err)}`;
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

  rideStatusEl.textContent = 'Live GPS: acquiring first fix\u2026';
  lastFix = null;
  smoothedHeading = null;   // reset from any previous ride
  lastGeoErrorCode = null;
  startRideBtn.disabled = true;
  stopRideBtn.disabled = false;
  sendBtn.disabled = true;  // avoid an accidental resend interrupting the M5Stack mid-ride

  await requestWakeLock();  // must come after button state, before watchPosition

  // Warm up with a single one-shot fix before starting the continuous
  // watch. This isn't just about speed -- on some Android/Chrome
  // combinations, watchPosition's first callback is meaningfully less
  // reliable than a plain getCurrentPosition call (a known class of
  // browser quirk, independent of permissions or signal). Getting one
  // clean fix this way first, then handing off to watchPosition for the
  // ongoing stream, sidesteps that gap.
  await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => { await handleGpsFix(pos); resolve(); },
      (err) => { handleGpsError(err); resolve(); }, // don't block the ride on one bad fix
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
    );
  });

  telemetryWatchId = navigator.geolocation.watchPosition(
    handleGpsFix,
    handleGpsError,
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
testGpsBtn.addEventListener('click', runGpsDiagnostic);

/**
 * Standalone GPS diagnostic, independent of route/BLE state -- isolates
 * "is the browser's geolocation actually working here, with these
 * permissions" from everything else in the app. Reports the raw
 * Permissions API state plus either a real fix (with accuracy/heading/
 * speed) or the exact error code, so a failure here points at browser/OS
 * permissions specifically rather than anything in the BLE or route code.
 */
async function runGpsDiagnostic() {
  const lines = [];
  gpsDiagnosticEl.hidden = false;
  gpsDiagnosticEl.textContent = 'Checking permission state\u2026';

  if (navigator.permissions?.query) {
    try {
      const status = await navigator.permissions.query({ name: 'geolocation' });
      lines.push(`Permission state: ${status.state}`);
      if (status.state === 'prompt') {
        lines.push('(Chrome should show a permission popup now \u2014 look for it, it can be easy to miss.)');
      }
    } catch (err) {
      lines.push(`Permission query failed: ${err.message}`);
    }
  } else {
    lines.push('Permissions API not available in this browser.');
  }

  lines.push('Requesting a GPS fix (up to 20s)\u2026');
  gpsDiagnosticEl.textContent = lines.join('\n');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const c = pos.coords;
      lines.push('--- Fix received ---');
      lines.push(`lat: ${c.latitude.toFixed(6)}`);
      lines.push(`lon: ${c.longitude.toFixed(6)}`);
      lines.push(`accuracy: \u00b1${Math.round(c.accuracy)}m`);
      lines.push(`heading: ${c.heading ?? 'null (not moving, or unsupported)'}`);
      lines.push(`speed: ${c.speed ?? 'null'}`);
      lines.push(`fix age: ${Math.round((Date.now() - pos.timestamp) / 1000)}s`);
      gpsDiagnosticEl.textContent = lines.join('\n');
    },
    (err) => {
      const codeName = ['UNKNOWN', 'PERMISSION_DENIED', 'POSITION_UNAVAILABLE', 'TIMEOUT'][err.code] || 'UNKNOWN';
      lines.push('--- Error ---');
      lines.push(`code: ${err.code} (${codeName})`);
      lines.push(`message: ${err.message}`);
      gpsDiagnosticEl.textContent = lines.join('\n');
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 }
  );
}
