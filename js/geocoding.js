/**
 * Place search via OpenStreetMap's Nominatim geocoder.
 *
 * IMPORTANT -- usage policy (https://operations.osmfoundation.org/policies/nominatim/):
 * "Auto-complete search... is not yet supported by Nominatim and you must
 * not implement such a service on the client side using the API." Only
 * call searchPlace() in response to one explicit, deliberate user action
 * (pressing Enter or a Search button) -- never on keystroke/input events.
 * app.js's search wiring only calls this on 'Enter' or a button click, by
 * design, to stay compliant. Also respect the 1 request/second limit;
 * a single explicit search per field is well within that on its own.
 *
 * No API key needed. A real browser's fetch() automatically sends a
 * proper User-Agent and Referer identifying this page, which is what the
 * policy asks for in place of a custom header (client-side JS can't set
 * a custom User-Agent anyway -- it's a browser-blocked header).
 */
const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org/search';

/**
 * @param {string} query
 * @returns {Promise<{label: string, lat: number, lon: number}[]>}
 */
export async function searchPlace(query) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const url = `${NOMINATIM_BASE}?format=json&limit=5&q=${encodeURIComponent(trimmed)}`;

  let response;
  try {
    response = await fetch(url);
  } catch (err) {
    throw new Error('Could not reach the search service -- check your connection.');
  }

  if (!response.ok) {
    throw new Error(`Search failed (HTTP ${response.status})`);
  }

  const data = await response.json();
  return data.map((item) => ({
    label: item.display_name,
    lat: parseFloat(item.lat),
    lon: parseFloat(item.lon),
  }));
}
