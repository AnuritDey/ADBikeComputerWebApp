# Bike Nav — Phone Web App

Runs entirely on your Android phone in Chrome. No app store, no build
step — this is the primary path for real rides going forward; the laptop
+ Python `companion_app/` is now mainly useful as an offline dev/testing
tool (see its README).

## Current status: Phase 1 — route planning

What works right now: tap the map to set a start and end point, get a
real cycling route back (via OSRM), see it drawn on the map with
distance/time/point-count stats.

Not built yet (see the roadmap at the bottom): connecting to the
M5Stack, sending the route over BLE, live GPS streaming while riding.

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
    ├── app.js            # entry point: wires DOM <-> map <-> routing
    ├── map.js             # Leaflet setup, tap-to-place pins, route drawing
    └── routing.js          # OSRM API call, no DOM/map knowledge
```

Same philosophy as the Python side: each file does one job, so a bug in
routing (wrong route shape) and a bug in the map (pins in the wrong
place) are easy to tell apart.

## Roadmap

- **Phase 2 — BLE connect + send route**: `js/ble.js` using
  `navigator.bluetooth`, reusing the exact binary protocol from
  `companion_app/protocol.py` (reimplemented in JS) so the firmware
  doesn't need to change at all.
- **Phase 3 — live telemetry**: `navigator.geolocation.watchPosition` to
  replace the phone-relay hack entirely; heading from GPS-derived bearing,
  same approach as `companion_app/telemetry_live.py`.
- **Phase 4 — ride stats & navigation**: live speed/distance/ETA,
  off-route detection, upcoming-turn cues.
- **Phase 5 — history**: save completed rides, GPX export, saved/favorite
  routes so you're not re-planning the same commute every time.
