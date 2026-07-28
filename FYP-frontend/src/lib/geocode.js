/**
 * ============================================================================
 *  geocode.js — the ONE module that talks to a place-name service.
 * ============================================================================
 *
 *  Wraps Nominatim (OpenStreetMap). Two operations, both read-only:
 *
 *    forward:  /search?format=jsonv2&addressdetails=1&limit=8&q=<query>
 *    reverse:  /reverse?format=jsonv2&addressdetails=1&lat=&lon=
 *
 *  DESIGN RULES THIS MODULE KEEPS
 *  ------------------------------
 *  1. PURE. No React, no `lib/api.js`, no app state. It takes strings and
 *     numbers and returns plain objects, so it is trivially unit testable and
 *     safe to import from `components/ui`.
 *
 *  2. IT NEVER THROWS. `searchPlaces` resolves to `[]` and `reverseGeocode`
 *     resolves to `null` on any failure: offline, CORS, a 429, an HTML error
 *     page, a timeout, an aborted request. A registration form must never be
 *     blocked because a third-party lookup had a bad day, so the failure mode
 *     is "no suggestions", never an exception.
 *
 *  3. IT CACHES, AND THE CALLER MUST DEBOUNCE. Nominatim's usage policy asks
 *     for at most ~1 request/second from a single source, so the debounce is a
 *     CORRECTNESS requirement, not a nicety. `SEARCH_DEBOUNCE_MS` and
 *     `MIN_QUERY_LENGTH` are exported so every caller waits the same amount of
 *     time and never fires on a one-letter query, and the per-query cache means
 *     backspacing over a word costs zero requests.
 *
 *  4. CALLERS THAT NEED TO TELL "no matches" FROM "the lookup broke" use
 *     `lookupPlaces` / `lookupReverse`, which report a status instead of
 *     flattening both cases to an empty result. That distinction is what lets a
 *     form say "type your city by hand" rather than "no such place".
 *
 *  NORMALISED SHAPE (frozen — LocationSearch and the profile screen both read it)
 *    { id, label, city, state, country, latitude, longitude }
 *
 *  Attribution: OSM data is ODbL licensed and requires credit, which is why
 *  `ATTRIBUTION` is exported and rendered by the UI that consumes this.
 * ============================================================================
 */

/** Public Nominatim host. No key, no account, rate limited by politeness. */
const NOMINATIM_ORIGIN = 'https://nominatim.openstreetmap.org';

/** Shortest query worth a network round trip. "Is" matches half the planet. */
export const MIN_QUERY_LENGTH = 3;

/** Debounce every caller must apply before calling `searchPlaces`. */
export const SEARCH_DEBOUNCE_MS = 350;

/** Credit required by the OSM licence wherever these results are shown. */
export const ATTRIBUTION = 'Places from OpenStreetMap';

const DEFAULT_LIMIT = 8;

/** A dead network can leave `fetch` pending forever; 8s then give up. */
const REQUEST_TIMEOUT_MS = 8000;

/** Cache ceiling. A signup form types a handful of queries, not thousands. */
const CACHE_LIMIT = 60;

/** query -> normalised results. Module level so it survives remounts. */
const searchCache = new Map();

/** "lat,lon" -> normalised place|null. */
const reverseCache = new Map();

/* -------------------------------------------------------------------------- */
/* small helpers                                                              */
/* -------------------------------------------------------------------------- */

/** A trimmed string, or '' for anything that is not usable text. */
function text(raw) {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * A finite coordinate, or `null`.
 *
 * Deliberately NOT `Number(raw)`: `Number('')` and `Number(null)` are both `0`,
 * so a blank form field would coerce into a perfectly valid request for Null
 * Island in the Gulf of Guinea. An absent coordinate has to stay absent.
 */
function coordinate(raw) {
  if (raw === '' || raw === null || raw === undefined || typeof raw === 'boolean') return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Cache key for a query: case and whitespace insensitive. */
function queryKey(raw, limit) {
  return `${limit}:${text(raw).toLowerCase().replace(/\s+/g, ' ')}`;
}

/** FIFO insert with a hard ceiling, so a long session cannot grow unbounded. */
function cachePut(store, key, entry) {
  if (store.size >= CACHE_LIMIT) {
    const oldest = store.keys().next();
    if (!oldest.done) store.delete(oldest.value);
  }
  store.set(key, entry);
}

/** Drop every cached lookup. Exported for tests and for a "retry" affordance. */
export function clearGeocodeCache() {
  searchCache.clear();
  reverseCache.clear();
}

/**
 * "City, State, Country" from whichever parts are known, blanks dropped.
 * Used to rebuild a readable label for a stored place that never kept one
 * (the profile API persists city/state/country, not the display name).
 *
 * @param {{city?: string, state?: string, country?: string}} parts
 * @returns {string}
 */
export function formatPlaceLabel(parts) {
  if (!parts || typeof parts !== 'object') return '';
  return [text(parts.city), text(parts.state), text(parts.country)]
    .filter(Boolean)
    .join(', ');
}

/* -------------------------------------------------------------------------- */
/* URL building                                                               */
/* -------------------------------------------------------------------------- */

/**
 * `accept-language` goes in the QUERY STRING, not a header, on purpose: a
 * custom request header would turn this into a CORS preflight and Nominatim
 * answers `OPTIONS` inconsistently. Same reason there is no `User-Agent`
 * (browsers forbid setting it anyway).
 */
function buildSearchUrl(query, limit) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    addressdetails: '1',
    limit: String(limit),
    q: query,
    'accept-language': 'en',
  });
  return `${NOMINATIM_ORIGIN}/search?${params.toString()}`;
}

function buildReverseUrl(latitude, longitude) {
  const params = new URLSearchParams({
    format: 'jsonv2',
    addressdetails: '1',
    lat: String(latitude),
    lon: String(longitude),
    'accept-language': 'en',
  });
  return `${NOMINATIM_ORIGIN}/reverse?${params.toString()}`;
}

/* -------------------------------------------------------------------------- */
/* transport                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One GET, JSON parsed, with a timeout, that resolves rather than rejects.
 *
 * `credentials: 'omit'` because Nominatim is a third party and must never see
 * this app's cookies. The body is read as text and parsed by hand so a Cloudflare
 * HTML error page becomes a clean `failed` instead of a SyntaxError.
 *
 * @param {string} url
 * @param {AbortSignal} [signal] Caller's cancellation.
 * @returns {Promise<{status:'ok'|'failed'|'aborted', data:any, error:string|null}>}
 */
async function requestJson(url, signal) {
  if (signal?.aborted) return { status: 'aborted', data: null, error: null };

  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS) : null;
  const relayAbort = () => controller?.abort();

  try {
    signal?.addEventListener?.('abort', relayAbort);

    const response = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      signal: controller?.signal,
    });

    if (!response?.ok) {
      return {
        status: 'failed',
        data: null,
        error: `The location service answered ${response?.status ?? 'nothing'}.`,
      };
    }

    const body = typeof response.text === 'function'
      ? await response.text()
      : JSON.stringify(await response.json());

    return { status: 'ok', data: JSON.parse(body), error: null };
  } catch {
    // An abort is not a failure: the caller replaced this request on purpose.
    if (signal?.aborted) return { status: 'aborted', data: null, error: null };
    return {
      status: 'failed',
      data: null,
      error: 'We could not reach the location service.',
    };
  } finally {
    if (timer) clearTimeout(timer);
    signal?.removeEventListener?.('abort', relayAbort);
  }
}

/* -------------------------------------------------------------------------- */
/* normalising                                                                */
/* -------------------------------------------------------------------------- */

/**
 * One Nominatim hit -> the frozen normalised shape, or `null` when the hit
 * cannot be used (no coordinates, or nothing to show the user).
 *
 * The fallback chains are the whole reason this function exists. Nominatim files
 * a settlement under a different key depending on how big it is:
 * `city` for a metropolis, `town`, then `village`, and only `county` for a rural
 * address. Reading `address.city` alone silently loses most of Pakistan.
 *
 * @param {object} hit A `jsonv2` + `addressdetails=1` result.
 * @returns {{id:string,label:string,city:string,state:string,country:string,
 *   latitude:number,longitude:number}|null}
 */
export function normalisePlace(hit) {
  if (!hit || typeof hit !== 'object') return null;

  const latitude = coordinate(hit.lat);
  const longitude = coordinate(hit.lon);
  if (latitude === null || longitude === null) return null;

  const address = hit.address && typeof hit.address === 'object' ? hit.address : {};

  const city = text(address.city)
    || text(address.town)
    || text(address.village)
    || text(address.county);
  const state = text(address.state) || text(address.region);
  const country = text(address.country);

  const label = text(hit.display_name)
    || formatPlaceLabel({ city, state, country })
    || text(hit.name);
  // A row with no readable label is unpickable, so it is not a result.
  if (!label) return null;

  const osmKey = hit.osm_type && hit.osm_id ? `${hit.osm_type}/${hit.osm_id}` : '';
  const id = String(hit.place_id ?? (osmKey || `${latitude},${longitude}`));

  return { id, label, city, state, country, latitude, longitude };
}

/**
 * A whole `/search` payload -> normalised results, unusable hits dropped and
 * visual duplicates collapsed (Nominatim happily returns the same
 * `display_name` twice for a node and its enclosing way).
 *
 * @param {any} payload
 * @returns {Array<object>}
 */
export function normalisePlaces(payload) {
  if (!Array.isArray(payload)) return [];
  const seen = new Set();
  const places = [];
  for (const hit of payload) {
    const place = normalisePlace(hit);
    if (!place) continue;
    const key = place.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    places.push(place);
  }
  return places;
}

/* -------------------------------------------------------------------------- */
/* public API                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Forward geocode, reporting WHY there are no results.
 *
 * @param {string} query Free text. Shorter than `MIN_QUERY_LENGTH` is a no-op.
 * @param {{signal?: AbortSignal, limit?: number}} [options]
 * @returns {Promise<{status:'ok'|'failed'|'aborted', results:Array<object>, error:string|null}>}
 */
export async function lookupPlaces(query, { signal, limit = DEFAULT_LIMIT } = {}) {
  try {
    const trimmed = text(query);
    if (trimmed.length < MIN_QUERY_LENGTH) {
      return { status: 'ok', results: [], error: null };
    }

    const key = queryKey(trimmed, limit);
    const cached = searchCache.get(key);
    if (cached) return { status: 'ok', results: cached, error: null };

    const outcome = await requestJson(buildSearchUrl(trimmed, limit), signal);
    if (outcome.status !== 'ok') {
      // Failures are deliberately NOT cached: the next keystroke should retry.
      return { status: outcome.status, results: [], error: outcome.error };
    }

    const results = normalisePlaces(outcome.data);
    cachePut(searchCache, key, results);
    return { status: 'ok', results, error: null };
  } catch {
    return { status: 'failed', results: [], error: 'We could not reach the location service.' };
  }
}

/**
 * Forward geocode. Resolves to `[]` for every failure, per the frozen contract.
 *
 * @param {string} query
 * @param {{signal?: AbortSignal, limit?: number}} [options]
 * @returns {Promise<Array<{id:string,label:string,city:string,state:string,
 *   country:string,latitude:number,longitude:number}>>}
 */
export async function searchPlaces(query, options) {
  const outcome = await lookupPlaces(query, options);
  return outcome.results;
}

/**
 * Reverse geocode, reporting WHY there is no place.
 *
 * @param {number|string} latitude
 * @param {number|string} longitude
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<{status:'ok'|'failed'|'aborted', place:object|null, error:string|null}>}
 */
export async function lookupReverse(latitude, longitude, { signal } = {}) {
  try {
    const lat = coordinate(latitude);
    const lon = coordinate(longitude);
    if (lat === null || lon === null) {
      return { status: 'ok', place: null, error: null };
    }

    // 4 decimal places is roughly 11 metres: far finer than a city boundary,
    // so nudging a map pin by a pixel reuses the previous answer.
    const key = `${lat.toFixed(4)},${lon.toFixed(4)}`;
    if (reverseCache.has(key)) {
      return { status: 'ok', place: reverseCache.get(key), error: null };
    }

    const outcome = await requestJson(buildReverseUrl(lat, lon), signal);
    if (outcome.status !== 'ok') {
      return { status: outcome.status, place: null, error: outcome.error };
    }

    const place = normalisePlace(outcome.data);
    cachePut(reverseCache, key, place);
    return { status: 'ok', place, error: null };
  } catch {
    return { status: 'failed', place: null, error: 'We could not reach the location service.' };
  }
}

/**
 * Reverse geocode. Resolves to `null` for every failure.
 *
 * @param {number|string} latitude
 * @param {number|string} longitude
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<object|null>}
 */
export async function reverseGeocode(latitude, longitude, options) {
  const outcome = await lookupReverse(latitude, longitude, options);
  return outcome.place;
}

export default {
  ATTRIBUTION,
  MIN_QUERY_LENGTH,
  SEARCH_DEBOUNCE_MS,
  clearGeocodeCache,
  formatPlaceLabel,
  lookupPlaces,
  lookupReverse,
  normalisePlace,
  normalisePlaces,
  reverseGeocode,
  searchPlaces,
};
