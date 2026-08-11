/**
 * Shared constants -- mirrors companion_app/config.py and firmware/config.h.
 * If you ever change UUIDs or COORD_SCALE, all three need the same edit.
 */

// Web Bluetooth wants lowercase, hyphenated UUIDs -- same identifiers as
// the Python/C++ side, just cased per the Web Bluetooth spec's convention.
export const SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
export const CHARACTERISTIC_UUID = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
export const DEVICE_NAME = 'M5Stack_Nav';

// Fixed-point scale for encoding coordinates -- must match COORD_SCALE in
// config.py / firmware/config.h, or positions will decode to the wrong meters.
export const COORD_SCALE = 2.0;

// The one fixed reference point the whole-region SD grid is built around --
// must be byte-for-byte identical to map_tools/generate_region_grid.py's
// REGION_ORIGIN_LAT/LON. Every route's origin gets expressed as an offset
// from this point (see app.js's ORIGIN packet), so the firmware can work
// out which SD grid cell(s) it's currently near without ever parsing
// lat/lon itself.
export const REGION_ORIGIN_LAT = 60.1699;  // matches map.js's DEFAULT_CENTER
export const REGION_ORIGIN_LON = 24.9384;

// BLE chunked-transfer tuning -- mirrors BLE_CHUNK_SIZE / BLE_CHUNK_DELAY_S
// in companion_app/config.py.
export const BLE_CHUNK_SIZE = 100;
export const BLE_CHUNK_DELAY_MS = 30;
export const BLE_TRANSFER_COMPLETE_DELAY_MS = 500;

// Auto-reroute tuning. OFF_ROUTE_THRESHOLD_M matches firmware/config.h's
// value exactly, so the phone's reroute trigger and the M5Stack's own
// visual off-route border agree on what "off route" means -- keep them
// in sync if either ever changes.
export const OFF_ROUTE_THRESHOLD_M = 30.0;
// Distance alone isn't enough to trigger a reroute -- GPS/heading noise
// briefly reads as "off route" near turns even when genuinely on the
// planned path (confirmed directly during this project's own walking
// test: a real turn read as ~10m off for several seconds purely from
// heading-smoothing lag, not real deviation). Require the threshold to
// be exceeded continuously for this long before treating it as real.
export const OFF_ROUTE_CONFIRM_SECONDS = 8;
// After a reroute completes (success or failure), wait this long before
// allowing another one -- avoids firing a second OSRM round-trip while
// still settling onto the just-sent replacement route.
export const REROUTE_COOLDOWN_SECONDS = 15;
