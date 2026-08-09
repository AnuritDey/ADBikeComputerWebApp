# Bike Nav — Phone Web App

Runs entirely on your Android phone in Chrome. No app store, no build
step — this is the primary path for real rides going forward; the laptop
+ Python `companion_app/` is now mainly useful as an offline dev/testing
tool (see its README).

## Current status: Phase 2 — BLE connect + send route

What works now: plan a route (phase 1), then tap **Send to Bike Computer**
— it opens Chrome's device picker, connects to the M5Stack over Web
Bluetooth, and sends the route using the exact same binary protocol
`companion_app/ble_transport.py` used. No firmware changes were needed —
`js/protocol.js` is a byte-for-byte port of `protocol.py`.

A few things worth knowing:
- **The M5Stack must be powered on and advertising** before you tap Send
  — if it's not visible in the device picker, check it's booted and
  showing "Waiting for BLE...".
- **Tapping Send must be a direct user action** (not, say, triggered from
  a timer) — this is a Web Bluetooth requirement, not a bug, and the code
  already respects it.
- Side-street stubs still aren't sent (always an empty list) — same
  trade-off noted in phase 1, unaffected by this phase.
- Once connected, tapping Send again reuses the existing connection
  rather than reconnecting from scratch.

Not built yet: live GPS streaming while riding (phase 3) — right now,
after the map arrives, the M5Stack will sit on "Map Loaded!" since it has
no telemetry yet to draw a live position with.

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
    ├── app.js            # entry point: wires DOM <-> map <-> routing <-> BLE
    ├── config.js          # shared constants -- BLE UUIDs, COORD_SCALE (mirrors config.py/config.h)
    ├── map.js              # Leaflet setup, tap-to-place pins, route drawing
    ├── routing.js           # OSRM API call, no DOM/map knowledge
    ├── geo.js                # lat/lon -> local (x,y) meters conversion
    ├── protocol.js            # binary packet encoding, ports protocol.py byte-for-byte
    └── ble.js                  # Web Bluetooth connect + chunked send, ports ble_transport.py
```

Same philosophy as the Python side: each file does one job, so a bug in
routing (wrong route shape) and a bug in the map (pins in the wrong
place) are easy to tell apart.

## Roadmap

- **Phase 3 — live telemetry**: `navigator.geolocation.watchPosition` to
  replace the phone-relay hack entirely; heading from GPS-derived bearing,
  same approach as `companion_app/telemetry_live.py`. `protocol.js` already
  has `buildTelemetryPacket()` ready for this.
- **Phase 4 — ride stats & navigation**: live speed/distance/ETA,
  off-route detection, upcoming-turn cues.
- **Phase 5 — history**: save completed rides, GPX export, saved/favorite
  routes so you're not re-planning the same commute every time.
