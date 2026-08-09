# Bike Nav — Phone Web App

Runs entirely on your Android phone in Chrome. No app store, no build
step — this is the primary path for real rides going forward; the laptop
+ Python `companion_app/` is now mainly useful as an offline dev/testing
tool (see its README).

## Current status: Phase 3 — live GPS telemetry while riding

Full loop now works: plan a route, send it to the M5Stack, tap **Start
Ride**, and it streams live position + heading from your phone's GPS to
the firmware in real time, using the browser's Geolocation API
(`navigator.geolocation.watchPosition`).

A few implementation details worth knowing:
- **Heading** comes from consecutive GPS fixes (a great-circle bearing
  calculation), smoothed with an exponential filter tuned for angle
  wraparound (so e.g. drifting from 350\u00b0 to 10\u00b0 moves the short way
  through 0\u00b0, not the long way through 180\u00b0) -- this avoids the jittery
  heading you'd get from raw consecutive-fix bearings alone.
- **Weak fixes are filtered**: any GPS reading with accuracy worse than
  25m is skipped rather than sent, so a bad fix under trees or between
  buildings doesn't jerk the M5Stack's marker around.
- **Screen wake lock**: the phone screen is kept on for the duration of
  a ride (`navigator.wakeLock`) -- without this, Android will eventually
  sleep the screen and pause the page, which stops GPS updates and can
  drop the BLE connection.
- **In-flight write guard**: if a new GPS fix arrives before the
  previous telemetry packet finished sending over BLE, the new fix is
  dropped rather than queued -- keeps the M5Stack showing your most
  recent position instead of catching up through a backlog of stale ones.
- Moving a start/end pin, or a BLE disconnect, automatically stops an
  active ride (releases the wake lock, clears the GPS watch) rather than
  leaving it running against stale state.

**Foreground only, for now**: this all depends on the browser tab
staying open and visible. Backgrounding the tab (switching apps, locking
the phone) will pause geolocation updates and likely drop the BLE
connection -- keep the phone mounted and the screen on during a ride
until a background-friendly approach is worth the added complexity.

### Known rough edges and how they're handled

- **First connection attempt sometimes fails.** ESP32 NimBLE peripherals
  are commonly flaky on the very first GATT connection after a boot or a
  prior session -- a widely-reported class of issue, not specific to
  this firmware. `ble.js` retries automatically (4 attempts, with
  increasing backoff and a clean disconnect between tries) before giving
  up, so this should mostly be invisible now. If it still fails after
  all 4 attempts, the likely remaining cause is Android's cached BLE
  service data for this device going stale -- especially common right
  after reflashing the firmware, since the underlying GATT handles can
  change even though the UUIDs stay the same. Fix: open
  `chrome://bluetooth-internals/#devices` in Chrome, find `M5Stack_Nav`,
  and remove it, or toggle Bluetooth off/on. No firmware change needed
  for this.
- **"Timeout expired" / GPS never gets a fix.** `enableHighAccuracy: true`
  requires an actual GPS-chip fix, not just WiFi/cell positioning --
  cold-start acquisition (first fix after not using GPS for a while) can
  easily take 10-20+ seconds, and indoors it may not resolve at all
  regardless of how long you wait, since GPS signals don't penetrate most
  buildings. The watch timeout is set to 20s to give real fixes room to
  arrive; if you're still seeing repeated timeouts, test outdoors or
  right next to a window first, to rule out "no GPS signal available
  here at all" before assuming it's a code problem.

## Running it

You cannot just double-click `index.html` and open it as a `file://`
URL — two things require a real HTTP(S) server:
- **ES modules** (`import`/`export` in `js/app.js`) are blocked by the
  browser under `file://`.
- **Web Bluetooth** (added in phase 2) only works in a "secure context"
  -- HTTPS, or `localhost`. A plain IP address like `http://192.168.1.5`
  does not count, even on your own WiFi.

**Easiest option — free static hosting with HTTPS already set up:**
1. [Netlify Drop](https://app.netlify.com/drop) — drag the `webapp/`
   folder onto the page, get an `https://*.netlify.app` URL instantly. No
   account required for a quick test; free account if you want it to
   stick around.
2. **GitHub Pages** — push `webapp/` to a GitHub repo, enable Pages in
   the repo settings, get an `https://<you>.github.io/<repo>/` URL.

Open that URL in Chrome on your phone. To make it feel like an app: tap
the browser menu → **Add to Home Screen**.

**For local development** (editing on your laptop, testing on your
phone before deploying): `python -m http.server 8000` from inside
`webapp/`, then visit `http://<laptop-ip>:8000` from your phone. This
works fine for the map/routing UI, but Web Bluetooth will refuse to run
over plain HTTP — you'll need real hosting (above) once phase 2 lands.

## Code layout

```
webapp/
├── index.html         # page structure, loads Leaflet + fonts + app.js
├── manifest.json       # PWA metadata (Add to Home Screen)
├── css/style.css        # dark instrument-panel theme, matches firmware's own look
└── js/
    ├── app.js            # entry point: wires DOM <-> map <-> routing <-> BLE <-> live GPS
    ├── config.js          # shared constants -- BLE UUIDs, COORD_SCALE (mirrors config.py/config.h)
    ├── map.js              # Leaflet setup, tap-to-place pins, route drawing
    ├── routing.js           # OSRM API call, no DOM/map knowledge
    ├── geo.js                # lat/lon -> local (x,y) meters conversion
    ├── protocol.js            # binary packet encoding, ports protocol.py byte-for-byte
    └── ble.js                  # Web Bluetooth connect + chunked send + telemetry, ports ble_transport.py
```

Note: live-telemetry logic (GPS watch, bearing/smoothing, wake lock) lives
directly in `app.js` rather than a separate module -- a deliberate
departure from the one-module-per-concern split elsewhere in this
project. Worth splitting into its own `telemetry.js` if it grows much
further (e.g. once ride stats or off-route detection get added on top).

Same philosophy as the Python side: each file does one job, so a bug in
routing (wrong route shape) and a bug in the map (pins in the wrong
place) are easy to tell apart.

## Roadmap

- **Phase 4 — ride stats & navigation**: live speed/distance/ETA,
  off-route detection, upcoming-turn cues. The telemetry strip and
  `buildTelemetryPacket()` are both already in place to build on.
- **Phase 5 — history**: save completed rides, GPX export, saved/favorite
  routes so you're not re-planning the same commute every time.
