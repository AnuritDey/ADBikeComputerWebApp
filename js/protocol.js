/**
 * Wire protocol -- a JS port of companion_app/protocol.py, encoding to the
 * exact same bytes firmware/map_data.cpp expects. Keep both in sync by
 * hand if the packet format ever changes.
 *
 * Packet layout on the BLE characteristic: [1-byte packet type][payload...]
 * Map payload layout (no packet header, built by buildMapPayload):
 *   uint16  numRoutePts
 *   numRoutePts * (int16 x, int16 y)      -- half-meter fixed point
 *
 * No stub/side-road section here -- removed entirely (was always sent
 * empty; see git history / project discussion for why: OSRM-based
 * routing has no way to answer "what other roads are near this point",
 * and the SD-loaded AreaContext grid now covers that need directly, more
 * completely, regardless of proximity to the planned route).
 *
 * BREAKING WIRE FORMAT CHANGE: firmware/map_data.cpp must be updated and
 * reflashed together with this file -- there's no version byte on this
 * payload (unlike the SD cell format's FORMAT_VERSION) to detect a
 * mismatch, so an old firmware paired with this webapp (or vice versa)
 * will misparse the buffer, not fail cleanly.
 */
import { COORD_SCALE } from './config.js';

export const PacketType = Object.freeze({
  MAP_START: 0x01,
  TELEMETRY: 0x02,
  MAP_CHUNK: 0x03,
  MAP_END: 0x04,
  ORIGIN: 0x05,
});

// 1 header byte + 3x float32 (x, y, heading_deg) -- used once phase 3 (live
// telemetry) lands; included now so protocol.js fully mirrors protocol.py.
export const TELEMETRY_PACKET_SIZE = 13;

// 1 header byte + 2x float32 (absX, absY) -- the uploaded route's own
// origin, expressed as an offset from the fixed REGION_ORIGIN_LAT/LON
// (see geo.js). Sent once per route upload so the firmware can work out
// which SD grid cell(s) it's near from telemetry alone, without ever
// parsing lat/lon itself.
export const ORIGIN_PACKET_SIZE = 9;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** One coordinate (meters) -> little-endian int16, half-meter resolution. */
export function encodeCoord(valueM) {
  const fixed = clamp(Math.round(valueM * COORD_SCALE), -32768, 32767);
  const buf = new ArrayBuffer(2);
  new DataView(buf).setInt16(0, fixed, true);
  return new Uint8Array(buf);
}

function concatBytes(chunks) {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * @param {{x:number, y:number}[]} routePoints  local (x, y) meters
 * @returns {Uint8Array} raw map payload, no packet header
 */
export function buildMapPayload(routePoints) {
  const parts = [];

  const routeCountBuf = new ArrayBuffer(2);
  new DataView(routeCountBuf).setUint16(0, routePoints.length, true);
  parts.push(new Uint8Array(routeCountBuf));

  for (const { x, y } of routePoints) {
    parts.push(encodeCoord(x));
    parts.push(encodeCoord(y));
  }

  return concatBytes(parts);
}

/** [0x02][x:f32][y:f32][heading:f32] = 13 bytes, little-endian. */
export function buildTelemetryPacket(x, y, headingDeg) {
  const buf = new ArrayBuffer(TELEMETRY_PACKET_SIZE);
  const view = new DataView(buf);
  view.setUint8(0, PacketType.TELEMETRY);
  view.setFloat32(1, x, true);
  view.setFloat32(5, y, true);
  view.setFloat32(9, headingDeg, true);
  return new Uint8Array(buf);
}

/** [0x05][absX:f32][absY:f32] = 9 bytes, little-endian. */
export function buildOriginPacket(absX, absY) {
  const buf = new ArrayBuffer(ORIGIN_PACKET_SIZE);
  const view = new DataView(buf);
  view.setUint8(0, PacketType.ORIGIN);
  view.setFloat32(1, absX, true);
  view.setFloat32(5, absY, true);
  return new Uint8Array(buf);
}
