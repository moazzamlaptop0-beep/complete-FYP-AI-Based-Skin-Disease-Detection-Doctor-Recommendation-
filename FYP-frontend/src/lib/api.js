/**
 * api.js — the ONE HTTP client.
 *
 * WHAT IT REPLACES
 * ----------------
 * 47 raw `fetch()` call sites and FIVE different ways of deriving the API base
 * URL (including a hardcoded `http://localhost:5000` fallback buried in
 * DoctorScheduleManager). One derivation lives here, one token injection lives
 * here, one 401 policy lives here.
 *
 * WHAT IT GUARANTEES
 * ------------------
 * - Bearer token injected from storage (the legacy `token` key, unchanged).
 * - `X-Act-As-User-Id` injected when an admin is impersonating.
 * - The `{success, message, error, data}` envelope unwrapped to just the payload.
 * - The TWO envelope-breakers normalised explicitly (see NORMALISERS below).
 * - A typed `ApiError(status, message, payload)` thrown for every failure,
 *   including network failures (status 0) and non-JSON error pages (Flask
 *   returns raw HTML for 404/405/413/500 — there are no @errorhandler
 *   registrations, per api-contract.md).
 * - Single-flight 401 refresh: N concurrent 401s share ONE POST /auth/refresh
 *   and then retry. If the refresh fails, the session is logged out once.
 *
 * WHAT IT DOES NOT DO
 * -------------------
 * It does not import AuthContext. The context injects its callbacks through
 * `configureApi()`; otherwise every module that imports the client would drag
 * React in and we would have an import cycle.
 */

import { auth as authEndpoints } from './endpoints';
import * as storage from './storage';

// ---------------------------------------------------------------------------
// Base URL — the SINGLE derivation for the whole app
// ---------------------------------------------------------------------------

/**
 * The documented fallback. `.env` sets VITE_API_URL=http://localhost:5000, so
 * this only applies when the env var is missing entirely (a stray `vite build`
 * without an env file, or a unit test). It is intentionally the dev backend
 * origin and NOT a relative '' — a silent relative base would make every call
 * hit the Vite dev server and 404 with an HTML page, which is much harder to
 * debug than a connection refused.
 */
export const DEFAULT_API_BASE_URL = 'http://localhost:5000';

function readEnvBaseUrl() {
  try {
    const env = import.meta.env;
    const value = env && env.VITE_API_URL;
    return typeof value === 'string' ? value.trim() : '';
  } catch {
    return '';
  }
}

function normalizeBaseUrl(value) {
  if (!value) return '';
  return value.replace(/\/+$/, '');
}

export const API_BASE_URL = normalizeBaseUrl(readEnvBaseUrl()) || DEFAULT_API_BASE_URL;

const ABSOLUTE_URL = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/** Turn an endpoints.js path into a full URL. Absolute URLs pass through. */
export function buildUrl(path) {
  const text = String(path ?? '');
  if (ABSOLUTE_URL.test(text) || text.startsWith('data:') || text.startsWith('blob:')) return text;
  return `${API_BASE_URL}${text.startsWith('/') ? '' : '/'}${text}`;
}

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------

const STATUS_MESSAGES = {
  0: 'Cannot reach the server. Check your connection and try again.',
  400: 'That request was rejected.',
  401: 'Your session has expired. Please log in again.',
  403: 'You do not have permission to do that.',
  404: 'We could not find what you were looking for.',
  405: 'That action is not supported here.',
  409: 'That conflicts with something that already exists.',
  413: 'That file is too large. The maximum upload size is 10 MB.',
  429: 'Too many attempts. Please wait a moment and try again.',
  500: 'The server hit an unexpected error. Please try again.',
  502: 'The server is unavailable right now. Please try again shortly.',
  503: 'The server is unavailable right now. Please try again shortly.',
  504: 'The server took too long to respond. Please try again.',
};

/**
 * Every failure from this client is an ApiError. Nothing else escapes, except a
 * caller-triggered AbortError which is rethrown untouched so `useEffect`
 * cleanups can ignore it the idiomatic way.
 */
export class ApiError extends Error {
  /**
   * @param {number} status HTTP status, or 0 for a network/transport failure.
   * @param {string} message Human-readable, safe to show in a toast.
   * @param {any} [payload] The parsed body (the whole envelope when there was one).
   * @param {{url?:string, method?:string, bodyText?:string}} [meta]
   */
  constructor(status, message, payload = null, meta = {}) {
    super(message || STATUS_MESSAGES[status] || `Request failed (${status})`);
    this.name = 'ApiError';
    this.status = status;
    this.payload = payload;
    /** The envelope's `data` when present — e.g. the 409 conflict list from
     *  /api/update-availability, the only success:false response carrying data. */
    this.data = payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload.data ?? null)
      : null;
    this.url = meta.url ?? null;
    this.method = meta.method ?? null;
    this.bodyText = meta.bodyText ?? null;
  }

  get isNetworkError() { return this.status === 0; }
  get isUnauthorized() { return this.status === 401; }
  get isForbidden() { return this.status === 403; }
  get isNotFound() { return this.status === 404; }
  get isValidationError() { return this.status === 400 || this.status === 422; }
  get isConflict() { return this.status === 409; }
  get isTooLarge() { return this.status === 413; }
  get isRateLimited() { return this.status === 429; }
  get isServerError() { return this.status >= 500; }
}

// ---------------------------------------------------------------------------
// Injected handlers — how the client talks to the session without importing it
// ---------------------------------------------------------------------------

const defaultHandlers = {
  getToken: () => storage.getToken(),
  setToken: (token) => storage.setToken(token),
  getRefreshToken: () => storage.getRefreshToken(),
  setRefreshToken: (token) => storage.setRefreshToken(token),
  /** `{userId}` when an admin is impersonating, else null. */
  getActingAs: () => storage.getActingAs(),
  /**
   * A counter AuthContext bumps on every login/logout. `performRefresh` captures
   * it before the round-trip and refuses to write a token back if it changed —
   * otherwise a refresh that was already in flight when the user pressed Logout
   * resurrects a live access token AND a rotated refresh token into localStorage
   * milliseconds after `clearSession()` wiped them.
   */
  getSessionEpoch: () => 0,
  /** Called ONCE when a 401 survives a refresh attempt. AuthContext wires logout here. */
  onUnauthorized: null,
  /** Called after a successful refresh with the new `{token, user?}` payload. */
  onRefreshed: null,
  /** Overridable for tests. */
  fetchImpl: null,
};

let handlers = { ...defaultHandlers };

/**
 * Inject session callbacks. AuthContext calls this once on mount:
 *   configureApi({ onUnauthorized: logout, getActingAs: () => actingAs })
 * @param {Partial<typeof defaultHandlers>} overrides
 */
export function configureApi(overrides = {}) {
  handlers = { ...handlers, ...overrides };
  return handlers;
}

/** Restore defaults and drop any in-flight refresh. Tests call this in beforeEach. */
export function resetApiState() {
  handlers = { ...defaultHandlers };
  refreshPromise = null;
  // Also clear the logout-coalescing window, or a test that ran less than a
  // second ago would swallow the next onUnauthorized call.
  unauthorizedNotifiedAt = 0;
}

function doFetch(url, init) {
  const impl = handlers.fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!impl) return Promise.reject(new ApiError(0, 'fetch is not available in this environment'));
  return impl(url, init);
}

// ---------------------------------------------------------------------------
// The two envelope-breakers — normalised EXPLICITLY, by path
// ---------------------------------------------------------------------------

/**
 * `/api/slots/<id>` returns a BARE ARRAY on success and an envelope on error
 * (api-contract.md G2). `/doctor/update_scan/<id>` returns a FLAT DICT on
 * success — scan fields at the top level next to a decorative `success` and an
 * EMPTY `data:{}` — and an envelope on error (G1). Unwrapping `.data` there
 * would hand callers `{}` and silently lose the scan, which is exactly the bug
 * DoctorDashboard papers over with an optimistic local update today.
 *
 * These are matched on the path, not sniffed from the body, so a future change
 * in either route surfaces as a loud test failure instead of a silent shape drift.
 */
/**
 * NOTE ON `\d+` IN THE BARE_ARRAY PATTERN
 * ---------------------------------------
 * The legacy route is `/api/slots/<int:doctor_id>` — Werkzeug's int converter,
 * so the last segment is ALWAYS digits. It matters here because a sibling now
 * shares the prefix: `/api/slots/multi` is additive, is NOT an envelope-breaker,
 * and returns the standard `{success, data:{by_doctor}}`. A looser
 * `[^/?#]+` matched 'multi' too, and this function's defensive branch would then
 * see an object where it wanted an array and hand the caller `[]` — every
 * doctor's day silently rendering as "no free times", with a 200 in the network
 * tab and nothing in the console. Digits keep the two apart the same way
 * Werkzeug does.
 */
export const ENVELOPE_BREAKERS = Object.freeze({
  BARE_ARRAY: [/^\/api\/slots\/\d+$/],
  FLAT_DICT: [/^\/doctor\/update_scan\/[^/?#]+$/],
});

function pathnameOf(path) {
  const text = String(path ?? '');
  const withoutOrigin = ABSOLUTE_URL.test(text)
    ? text.replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]*/i, '')
    : text;
  return withoutOrigin.split(/[?#]/)[0] || '/';
}

function isBareArrayRoute(path) {
  const pathname = pathnameOf(path);
  return ENVELOPE_BREAKERS.BARE_ARRAY.some((re) => re.test(pathname));
}

function isFlatDictRoute(path) {
  const pathname = pathnameOf(path);
  return ENVELOPE_BREAKERS.FLAT_DICT.some((re) => re.test(pathname));
}

// ---------------------------------------------------------------------------
// Body handling
// ---------------------------------------------------------------------------

function isRawBody(body) {
  if (body === null || body === undefined) return false;
  if (typeof body === 'string') return true;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
  if (typeof Blob !== 'undefined' && body instanceof Blob) return true;
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) return true;
  if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView(body)) return true;
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer) return true;
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return true;
  return false;
}

function hasHeader(headers, name) {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

/**
 * Read the body ONCE and tolerate anything. Flask hands back raw HTML for 413
 * and unhandled 500s; `res.json()` would throw a SyntaxError and mask the real
 * status, which is how "Unexpected token < in JSON" ends up in front of users.
 */
async function readBody(res) {
  if (res.status === 204 || res.status === 205) return { parsed: null, text: '', isJson: false };
  let text = '';
  try {
    text = await res.text();
  } catch {
    return { parsed: null, text: '', isJson: false };
  }
  if (!text) return { parsed: null, text: '', isJson: false };
  try {
    return { parsed: JSON.parse(text), text, isJson: true };
  } catch {
    return { parsed: null, text, isJson: false };
  }
}

/** Pull the best human message out of whatever the server sent. */
function errorMessageFrom(status, parsed, text) {
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    if (typeof parsed.error === 'string' && parsed.error) return parsed.error;
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message;
  }
  if (STATUS_MESSAGES[status]) return STATUS_MESSAGES[status];
  // An HTML error page: never render markup at the user.
  if (text && !/<[a-z!]/i.test(text) && text.length < 200) return text.trim();
  return `Request failed (${status})`;
}

// ---------------------------------------------------------------------------
// Single-flight refresh
// ---------------------------------------------------------------------------

let refreshPromise = null;

/** Refresh tokens rotate, so a refresh must never outlive a stalled connection. */
const REFRESH_TIMEOUT_MS = 20_000;

/**
 * Cross-TAB single flight.
 *
 * `refreshPromise` only coalesces callers inside ONE tab. Two tabs hold the same
 * access token, so their proactive timers (derived from the token's absolute
 * `exp`) fire at the same wall-clock instant and both read the same refresh
 * token out of shared localStorage. The first rotates RT0 -> RT1; the second
 * presents RT0, which now has `replaced_by_id` set, and `rotate_refresh_token`
 * treats that as theft and revokes the WHOLE family — signing the honest user
 * out of every device. A Web Lock serialises the two so the loser can adopt the
 * winner's token instead of replaying a rotated one.
 *
 * Falls straight through where the API is missing (older Safari, jsdom).
 */
function withRefreshLock(run) {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : null;
  if (!locks || typeof locks.request !== 'function') return run();
  try {
    return locks.request('aiderma:auth-refresh', run);
  } catch {
    return run();
  }
}

function sessionEnded(url) {
  return new ApiError(401, 'That session ended before the token could be refreshed.', null, {
    url,
    method: 'POST',
  });
}

async function performRefresh() {
  const url = buildUrl(authEndpoints.refresh());
  // Captured BEFORE the lock is taken: both are compared again afterwards.
  const epoch = handlers.getSessionEpoch?.() ?? 0;
  const tokenBeforeLock = handlers.getToken?.() || null;

  return withRefreshLock(async () => {
    if ((handlers.getSessionEpoch?.() ?? 0) !== epoch) throw sessionEnded(url);

    // Another tab rotated while we waited for the lock. Adopt its token rather
    // than presenting a refresh token it has already replaced.
    const adopted = handlers.getToken?.() || null;
    if (adopted && adopted !== tokenBeforeLock) {
      try { handlers.onRefreshed?.({ token: adopted }); } catch { /* never break the retry */ }
      return { token: adopted };
    }

    const refreshToken = handlers.getRefreshToken?.() || null;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS) : null;

    let res;
    try {
      res = await doFetch(url, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        // The refresh token may be an httpOnly cookie rather than a body field;
        // send both channels so either backend design works.
        credentials: 'include',
        body: JSON.stringify(refreshToken ? { refresh_token: refreshToken } : {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (err) {
      throw new ApiError(0, STATUS_MESSAGES[0], null, { url, method: 'POST', bodyText: String(err?.message || err) });
    } finally {
      if (timer) clearTimeout(timer);
    }

    const { parsed, text, isJson } = await readBody(res);
    if (!res.ok || !isJson) {
      throw new ApiError(res.status, errorMessageFrom(res.status, parsed, text), parsed, { url, method: 'POST' });
    }

    const envelope = parsed && typeof parsed === 'object' ? parsed : {};
    if (envelope.success === false) {
      throw new ApiError(res.status, errorMessageFrom(res.status, envelope, text), envelope, { url, method: 'POST' });
    }

    const payload = (envelope.data && typeof envelope.data === 'object') ? envelope.data : envelope;
    const token = payload.token || payload.access_token || null;
    if (!token) {
      throw new ApiError(res.status, 'The refresh response did not contain a token.', envelope, { url, method: 'POST' });
    }

    // THE SESSION MAY HAVE ENDED WHILE THIS WAS IN FLIGHT. Writing now would put
    // a fresh 24h access token and a fresh 30d refresh token back on a machine
    // whose owner has just logged out — and the mount-time rehydrate is gated on
    // the token ALONE, so the next page load would silently sign them back in.
    if ((handlers.getSessionEpoch?.() ?? 0) !== epoch) throw sessionEnded(url);

    handlers.setToken?.(token);
    if (payload.refresh_token) handlers.setRefreshToken?.(payload.refresh_token);
    try { handlers.onRefreshed?.(payload); } catch { /* a listener must never break the retry */ }
    return payload;
  });
}

/**
 * Refresh the access token. Concurrent callers share ONE in-flight request —
 * without this, a dashboard that fires six parallel requests on mount would
 * stampede the refresh endpoint six times, and five of those would race to
 * invalidate the token the sixth just stored.
 * @returns {Promise<object>} the refresh payload
 */
export function refreshSession() {
  if (!refreshPromise) {
    const pending = performRefresh();
    refreshPromise = pending;
    // Clear the slot once settled, but only if it is still OURS: `cancelRefresh`
    // may have dropped it and a newer refresh may already own the slot. The
    // derived promise is handled so a failed refresh is never an unhandled
    // rejection.
    const release = () => { if (refreshPromise === pending) refreshPromise = null; };
    pending.then(release, release);
  }
  return refreshPromise;
}

/**
 * Forget the in-flight refresh. AuthContext calls this from `logout()` so a new
 * session never joins the previous session's round-trip. The abandoned promise
 * still settles; its token write is refused by the session-epoch check above.
 */
export function cancelRefresh() {
  refreshPromise = null;
}

/** True while a refresh is in flight (used by tests and the auth UI). */
export function isRefreshing() {
  return refreshPromise !== null;
}

// ---------------------------------------------------------------------------
// The request pipeline
// ---------------------------------------------------------------------------

/**
 * @typedef {object} RequestOptions
 * @property {string} [method='GET']
 * @property {any} [body] Plain objects are JSON-encoded; FormData/Blob/string are sent as-is.
 * @property {Record<string,string>} [headers]
 * @property {AbortSignal} [signal]
 * @property {boolean} [auth=true] Attach the Bearer token.
 * @property {boolean} [actAs=true] Attach `X-Act-As-User-Id` while impersonating.
 *   Set false for routes that describe the SESSION itself (`/auth/me`,
 *   `/auth/logout`) — those must always answer for the real principal.
 * @property {boolean} [skipAuthRefresh=false] Do not attempt a refresh on 401 (login, refresh itself).
 * @property {number} [timeoutMs] Abort after N ms.
 * @property {RequestCredentials} [credentials]
 */

function buildInit(path, options) {
  const {
    method = 'GET',
    body,
    headers = {},
    auth = true,
    actAs = true,
    credentials,
  } = options;

  const finalHeaders = { Accept: 'application/json', ...headers };
  let finalBody;

  if (body !== undefined && body !== null) {
    if (isRawBody(body)) {
      finalBody = body;
      // NEVER set Content-Type for FormData — the browser must add the
      // multipart boundary itself. /predict and POST /api/doctor/profile both
      // depend on this.
    } else {
      finalBody = JSON.stringify(body);
      if (!hasHeader(finalHeaders, 'content-type')) finalHeaders['Content-Type'] = 'application/json';
    }
  }

  if (auth) {
    const token = handlers.getToken?.();
    if (token && !hasHeader(finalHeaders, 'authorization')) {
      finalHeaders.Authorization = `Bearer ${token}`;
    }
    // `actAs: false` is how the session routes opt out. Sending the header to
    // /auth/me makes the backend answer for the IMPERSONATED user, and the reply
    // is written straight over the admin's own identity and permissions.
    const actingAs = actAs === false ? null : handlers.getActingAs?.();
    if (actingAs?.userId && !hasHeader(finalHeaders, 'x-act-as-user-id')) {
      // The backend requires actor.act_as, a STRICTLY higher rank than the
      // target, a non-root target, and writes an audit_logs row for every
      // request carrying this header.
      finalHeaders['X-Act-As-User-Id'] = String(actingAs.userId);
    }
  }

  /** @type {RequestInit} */
  const init = { method: String(method).toUpperCase(), headers: finalHeaders };
  if (finalBody !== undefined) init.body = finalBody;
  if (credentials) init.credentials = credentials;
  return init;
}

/** Merge a caller signal with an optional timeout into one signal + cleanup. */
function withTimeout(options) {
  const { signal, timeoutMs } = options;
  if (!timeoutMs) return { signal, cleanup: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
}

/**
 * Normalise a response into `{data, message}` or throw an ApiError.
 * This is where the envelope contract — and both breaks in it — is enforced.
 */
function normalizeResponse(path, method, res, parsed, text) {
  const meta = { url: buildUrl(path), method };

  // --- Envelope-breaker 1: /api/slots/<id> -> bare array on success ---------
  if (isBareArrayRoute(path)) {
    if (res.ok) {
      if (Array.isArray(parsed)) return { data: parsed, message: '', envelope: null };
      // Defensive, mirroring PatientHistory.jsx:147 — if the shape ever grows an
      // envelope, callers still get an array instead of a crash.
      const fallback = parsed && typeof parsed === 'object'
        ? (parsed.slots ?? parsed.data ?? [])
        : [];
      return { data: Array.isArray(fallback) ? fallback : [], message: '', envelope: parsed };
    }
    throw new ApiError(res.status, errorMessageFrom(res.status, parsed, text), parsed, meta);
  }

  // --- Envelope-breaker 2: /doctor/update_scan/<id> -> flat dict on success --
  if (isFlatDictRoute(path)) {
    if (res.ok && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // Return the WHOLE object. `parsed.data` is the decorative empty `{}`.
      return { data: parsed, message: parsed.message || '', envelope: null };
    }
    if (res.ok) return { data: parsed, message: '', envelope: null };
    throw new ApiError(res.status, errorMessageFrom(res.status, parsed, text), parsed, meta);
  }

  // --- Non-JSON (Flask's raw HTML error pages, or an empty 204) --------------
  if (parsed === null) {
    if (res.ok) return { data: text || null, message: '', envelope: null };
    throw new ApiError(res.status, errorMessageFrom(res.status, null, text), null, { ...meta, bodyText: text });
  }

  // --- The standard envelope -----------------------------------------------
  const isEnvelope = parsed && typeof parsed === 'object' && !Array.isArray(parsed) && 'success' in parsed;

  if (isEnvelope) {
    if (!res.ok || parsed.success === false) {
      throw new ApiError(res.status, errorMessageFrom(res.status, parsed, text), parsed, meta);
    }
    // `data` is emitted whenever it is not None, so `[]` and `{}` are real
    // payloads and must survive. Routes that only return a message have no
    // `data` key at all — those callers get the envelope so they can read it.
    const data = 'data' in parsed ? parsed.data : parsed;
    return { data, message: typeof parsed.message === 'string' ? parsed.message : '', envelope: parsed };
  }

  // --- Plain JSON without an envelope (shouldn't happen; handled anyway) -----
  if (!res.ok) {
    throw new ApiError(res.status, errorMessageFrom(res.status, parsed, text), parsed, meta);
  }
  return { data: parsed, message: '', envelope: null };
}

async function execute(path, options, isRetry) {
  const method = String(options.method || 'GET').toUpperCase();
  const url = buildUrl(path);
  const init = buildInit(path, options);
  const { signal, cleanup } = withTimeout(options);
  if (signal) init.signal = signal;

  let res;
  try {
    res = await doFetch(url, init);
  } catch (err) {
    cleanup();
    // A caller-triggered abort is not an error condition — rethrow untouched so
    // `if (err.name === 'AbortError') return;` keeps working in effects.
    if (err?.name === 'AbortError') throw err;
    throw new ApiError(0, STATUS_MESSAGES[0], null, { url, method, bodyText: String(err?.message || err) });
  } finally {
    cleanup();
  }

  const { parsed, text } = await readBody(res);

  // --- Single-flight 401 handling ------------------------------------------
  if (res.status === 401 && options.auth !== false && !options.skipAuthRefresh) {
    if (isRetry) {
      // The refresh succeeded but the retried request is still unauthorised:
      // the session is genuinely dead (token_version bumped, account disabled).
      notifyUnauthorized();
      throw new ApiError(401, errorMessageFrom(401, parsed, text), parsed, { url, method });
    }
    try {
      await refreshSession();
    } catch (refreshError) {
      notifyUnauthorized(refreshError);
      throw new ApiError(401, errorMessageFrom(401, parsed, text), parsed, { url, method });
    }
    return execute(path, options, true);
  }

  return normalizeResponse(path, method, res, parsed, text);
}

let unauthorizedNotifiedAt = 0;
function notifyUnauthorized(cause) {
  // Coalesce: a page that fires ten requests at once must not run logout ten
  // times and stack ten toasts.
  const now = Date.now();
  if (now - unauthorizedNotifiedAt < 1000) return;
  unauthorizedNotifiedAt = now;
  try { handlers.onUnauthorized?.(cause ?? null); } catch { /* never mask the original error */ }
}

/**
 * Full response detail: `{data, message, envelope}`.
 * Use this when you need the envelope's `message` (register/login flows) or the
 * raw envelope. Everything else should use `request`.
 * @param {string} path from endpoints.js
 * @param {RequestOptions} [options]
 */
export function requestDetailed(path, options = {}) {
  return execute(path, options, false);
}

/**
 * The workhorse. Resolves to the unwrapped payload:
 *   - envelope with a `data` key      -> `data` (including `[]` and `{}`)
 *   - envelope with only a message    -> the envelope `{success, message}`
 *   - `/api/slots/<id>`               -> the bare array
 *   - `/doctor/update_scan/<id>`      -> the flat scan dict
 * Rejects with `ApiError` on any failure.
 * @param {string} path
 * @param {RequestOptions} [options]
 * @returns {Promise<any>}
 */
export async function request(path, options = {}) {
  const result = await execute(path, options, false);
  return result.data;
}

// ---------------------------------------------------------------------------
// Verb sugar
// ---------------------------------------------------------------------------

export const get = (path, options) => request(path, { ...options, method: 'GET' });
export const post = (path, body, options) => request(path, { ...options, method: 'POST', body });
export const put = (path, body, options) => request(path, { ...options, method: 'PUT', body });
export const patch = (path, body, options) => request(path, { ...options, method: 'PATCH', body });
/** `delete` is a reserved word; the export is `del`. */
export const del = (path, options) => request(path, { ...options, method: 'DELETE' });

/**
 * Multipart upload. Pass a FormData or a plain object of fields/Files.
 * Never sets Content-Type — the browser owns the multipart boundary.
 */
export const upload = (path, formData, options) => {
  let body = formData;
  if (!(typeof FormData !== 'undefined' && formData instanceof FormData)) {
    const fd = new FormData();
    Object.entries(formData || {}).forEach(([key, value]) => {
      if (value !== null && value !== undefined) fd.append(key, value);
    });
    body = fd;
  }
  return request(path, { ...options, method: options?.method || 'POST', body });
};

const api = {
  API_BASE_URL,
  ApiError,
  buildUrl,
  cancelRefresh,
  configureApi,
  del,
  get,
  isRefreshing,
  patch,
  post,
  put,
  refreshSession,
  request,
  requestDetailed,
  resetApiState,
  upload,
};

export default api;
