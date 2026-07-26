/**
 * storage.js — the ONLY module allowed to touch localStorage / sessionStorage.
 *
 * WHY THIS EXISTS
 * ---------------
 * There are 45 direct `localStorage.getItem` calls across 14 files today, and
 * several of them do a bare `JSON.parse(localStorage.getItem('user'))`. A single
 * corrupt value (a half-written string, a quota abort, a user poking DevTools)
 * throws a SyntaxError during render and white-screens the whole app. That is a
 * real bug in ProtectedRoute.jsx:7 right now. Every read here is wrapped and
 * every failure degrades to the caller's fallback.
 *
 * TWO KEY SPACES, ON PURPOSE
 * --------------------------
 * 1. NAMESPACED keys (`aiderma:<key>`) — everything new. Namespacing means
 *    `clearNamespace()` can log a user out without nuking unrelated keys that
 *    other tooling on localhost may own.
 * 2. LEGACY keys (`token`, `user`) — bare, unnamespaced, exactly the format the
 *    8 existing pages read directly. AuthContext keeps writing these so
 *    LoginPage/DoctorDashboard/PatientHistory/AdminDashboard/Navbar keep working
 *    untouched this phase. DO NOT rename them until every page is migrated.
 *
 * Storage may be entirely unavailable (Safari private mode, iframe with
 * third-party cookies blocked, SSR). Every entry point tolerates that and falls
 * back to an in-memory Map so the app still runs for the session.
 */

export const NAMESPACE = 'aiderma';

/** Bare, unnamespaced keys the pre-refactor pages read directly. */
export const LEGACY_KEYS = Object.freeze({
  TOKEN: 'token',
  USER: 'user',
});

/** Namespaced keys owned by the new platform layer. */
export const KEYS = Object.freeze({
  REFRESH_TOKEN: 'refresh_token',
  ACTING_AS: 'acting_as',
  THEME: 'theme',
  LANGUAGE: 'language',
  LAST_ROUTE: 'last_route',
  WORKSPACE: 'workspace',
  // Opaque per-browser token tying pre-sign-up scans to this visitor so they
  // can be claimed into a real account later. Not a credential.
  GUEST_TOKEN: 'guest_token',
});

// ---------------------------------------------------------------------------
// Backing store resolution
// ---------------------------------------------------------------------------

const memoryFallback = new Map();

/** A Storage-shaped object backed by a Map, for when the real thing throws. */
const memoryStorage = {
  getItem: (k) => (memoryFallback.has(k) ? memoryFallback.get(k) : null),
  setItem: (k, v) => { memoryFallback.set(k, String(v)); },
  removeItem: (k) => { memoryFallback.delete(k); },
  key: (i) => Array.from(memoryFallback.keys())[i] ?? null,
  get length() { return memoryFallback.size; },
};

function resolveStore(kind) {
  try {
    if (typeof window === 'undefined') return memoryStorage;
    const store = kind === 'session' ? window.sessionStorage : window.localStorage;
    if (!store) return memoryStorage;
    // Touch it — merely reading `window.localStorage` can throw in locked-down
    // browsers, and so can the first write.
    const probe = `${NAMESPACE}:__probe__`;
    store.setItem(probe, '1');
    store.removeItem(probe);
    return store;
  } catch {
    return memoryStorage;
  }
}

/** @returns {Storage} */
function local() { return resolveStore('local'); }
/** @returns {Storage} */
function session() { return resolveStore('session'); }

export function isStorageAvailable() {
  return local() !== memoryStorage;
}

// ---------------------------------------------------------------------------
// Raw (unnamespaced) string access — used for the legacy `token` / `user` keys
// ---------------------------------------------------------------------------

/**
 * Read a raw string key. Never throws.
 * @param {string} key
 * @param {*} [fallback=null]
 */
export function getRaw(key, fallback = null) {
  try {
    const value = local().getItem(key);
    return value === null || value === undefined ? fallback : value;
  } catch {
    return fallback;
  }
}

/**
 * Write a raw string key. Returns false when the write was rejected (quota,
 * private mode) instead of throwing into a render.
 */
export function setRaw(key, value) {
  try {
    if (value === null || value === undefined) {
      local().removeItem(key);
      return true;
    }
    local().setItem(key, String(value));
    return true;
  } catch {
    return false;
  }
}

export function removeRaw(key) {
  try {
    local().removeItem(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse a raw key as JSON. A corrupt value returns the fallback AND self-heals
 * by deleting the poison, so the next read is clean rather than permanently
 * broken.
 */
export function getRawJSON(key, fallback = null) {
  const text = getRaw(key, null);
  if (text === null || text === '') return fallback;
  try {
    const parsed = JSON.parse(text);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch {
    // Corrupt payload. Do not throw — this runs inside render paths.
    removeRaw(key);
    return fallback;
  }
}

export function setRawJSON(key, value) {
  try {
    return setRaw(key, JSON.stringify(value));
  } catch {
    // Circular structure, BigInt, etc.
    return false;
  }
}

// ---------------------------------------------------------------------------
// Namespaced, JSON-safe access
// ---------------------------------------------------------------------------

export function namespacedKey(key) {
  return `${NAMESPACE}:${key}`;
}

/**
 * Read a namespaced value, JSON-decoded. Never throws.
 * @template T
 * @param {string} key
 * @param {T} [fallback=null]
 * @returns {T}
 */
export function get(key, fallback = null) {
  return getRawJSON(namespacedKey(key), fallback);
}

/** Write a namespaced value, JSON-encoded. @returns {boolean} success */
export function set(key, value) {
  if (value === undefined) return remove(key);
  return setRawJSON(namespacedKey(key), value);
}

export function remove(key) {
  return removeRaw(namespacedKey(key));
}

/** Remove every `aiderma:*` key. Leaves unrelated keys (and legacy keys) alone. */
export function clearNamespace() {
  try {
    const store = local();
    const prefix = `${NAMESPACE}:`;
    const doomed = [];
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i);
      if (typeof key === 'string' && key.startsWith(prefix)) doomed.push(key);
    }
    doomed.forEach((key) => store.removeItem(key));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// sessionStorage twin (tab-scoped: scan caches, wizard state)
// ---------------------------------------------------------------------------

export const sessionStore = {
  get(key, fallback = null) {
    try {
      const text = session().getItem(namespacedKey(key));
      if (text === null || text === '') return fallback;
      return JSON.parse(text);
    } catch {
      try { session().removeItem(namespacedKey(key)); } catch { /* ignore */ }
      return fallback;
    }
  },
  set(key, value) {
    try {
      session().setItem(namespacedKey(key), JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    try {
      session().removeItem(namespacedKey(key));
      return true;
    } catch {
      return false;
    }
  },
};

// ---------------------------------------------------------------------------
// Auth-specific accessors (the compatibility surface)
// ---------------------------------------------------------------------------

/** The access token, as the legacy pages expect it: a bare string under 'token'. */
export function getToken() {
  const token = getRaw(LEGACY_KEYS.TOKEN, null);
  return token && token !== 'undefined' && token !== 'null' ? token : null;
}

export function setToken(token) {
  return token ? setRaw(LEGACY_KEYS.TOKEN, token) : removeRaw(LEGACY_KEYS.TOKEN);
}

/**
 * The stored user object, as the legacy pages expect it: JSON under 'user',
 * shape `{id, name, email, role, joined_at, verification_status?}`.
 * A corrupt value returns null instead of throwing — this is the ProtectedRoute
 * white-screen bug, fixed at the source.
 */
export function getUser() {
  const user = getRawJSON(LEGACY_KEYS.USER, null);
  return user && typeof user === 'object' && !Array.isArray(user) ? user : null;
}

export function setUser(user) {
  return user ? setRawJSON(LEGACY_KEYS.USER, user) : removeRaw(LEGACY_KEYS.USER);
}

export function getRefreshToken() {
  const token = get(KEYS.REFRESH_TOKEN, null);
  return typeof token === 'string' && token ? token : null;
}

export function setRefreshToken(token) {
  return token ? set(KEYS.REFRESH_TOKEN, token) : remove(KEYS.REFRESH_TOKEN);
}

/** `{userId, name, role}` of the user an admin is currently impersonating. */
export function getActingAs() {
  const value = get(KEYS.ACTING_AS, null);
  if (!value || typeof value !== 'object') return null;
  const userId = Number(value.userId ?? value.user_id);
  if (!Number.isFinite(userId) || userId <= 0) return null;
  return { ...value, userId };
}

export function setActingAs(target) {
  if (!target) return remove(KEYS.ACTING_AS);
  const userId = Number(target.userId ?? target.user_id);
  if (!Number.isFinite(userId) || userId <= 0) return remove(KEYS.ACTING_AS);
  return set(KEYS.ACTING_AS, { ...target, userId });
}

/**
 * sessionStorage keys other features own, cleared by name on logout because
 * `clearNamespace()` only reaches `aiderma:*` in LOCAL storage. Every one of
 * these holds patient data that must not survive into the next session in the
 * same tab: the three `cached_image_*` entries and `lastScanResult` are the scan
 * cache the old Navbar cleared by hand, and the consult draft
 * (features/consult/consultPersistence.js) is a base64 photograph plus six
 * health answers and a free-text clinical note.
 */
const FOREIGN_SESSION_KEYS = Object.freeze([
  'cached_image_base64',
  'cached_image_name',
  'cached_image_type',
  'lastScanResult',
  'aiderma.consult.draft.v1',
]);

/**
 * The ONE place that erases a session. Clears the legacy keys, the namespace,
 * and the tab-scoped caches listed above.
 */
export function clearSession() {
  removeRaw(LEGACY_KEYS.TOKEN);
  removeRaw(LEGACY_KEYS.USER);
  clearNamespace();
  try {
    const store = session();
    FOREIGN_SESSION_KEYS.forEach((key) => store.removeItem(key));
  } catch {
    // ignore
  }
}

export default {
  KEYS,
  LEGACY_KEYS,
  NAMESPACE,
  clearNamespace,
  clearSession,
  get,
  getActingAs,
  getRaw,
  getRawJSON,
  getRefreshToken,
  getToken,
  getUser,
  isStorageAvailable,
  namespacedKey,
  remove,
  removeRaw,
  sessionStore,
  set,
  setActingAs,
  setRaw,
  setRawJSON,
  setRefreshToken,
  setToken,
  setUser,
};
