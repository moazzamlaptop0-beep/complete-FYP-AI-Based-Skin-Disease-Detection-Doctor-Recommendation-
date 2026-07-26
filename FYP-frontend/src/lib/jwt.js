/**
 * jwt.js — read-only JWT inspection. No verification, ever.
 *
 * The signature CANNOT be checked in the browser (the HS256 secret lives on the
 * server, and shipping it would be the vulnerability). Everything here is a
 * UX optimisation: skip a doomed round-trip when the token is already expired,
 * schedule a proactive refresh, show the right nav before /auth/me answers.
 * The server remains the only authority — a tampered token still 401s there.
 *
 * Token shape issued by this backend (app/core/rbac.py):
 *   {"user_id": <int>, "role": "Admin"|"Doctor"|"AI User", "exp": <unix seconds>}
 * Newer tokens may also carry "token_version", "is_root", "jti", "typ".
 */

/**
 * base64url -> string, unicode-safe. `atob` only handles latin1, so a name with
 * a non-ASCII character (very likely here — Urdu/Arabic script users) would come
 * back mojibake without the percent-decode dance.
 */
function base64UrlDecode(segment) {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const withPadding = padded + '='.repeat((4 - (padded.length % 4)) % 4);

  let binary;
  if (typeof atob === 'function') {
    binary = atob(withPadding);
  } else if (typeof globalThis.Buffer !== 'undefined') {
    // Node (SSR, or a test runner without a DOM). Read off globalThis so the
    // browser bundle never references a bare `Buffer` identifier.
    return globalThis.Buffer.from(withPadding, 'base64').toString('utf8');
  } else {
    throw new Error('No base64 decoder available');
  }

  try {
    // Re-interpret the latin1 bytes as UTF-8.
    return decodeURIComponent(
      Array.prototype.map
        .call(binary, (c) => `%${`00${c.charCodeAt(0).toString(16)}`.slice(-2)}`)
        .join(''),
    );
  } catch {
    return binary;
  }
}

/**
 * Decode the payload of a JWT.
 * @param {string|null|undefined} token
 * @returns {Record<string, any>|null} null for anything that isn't a decodable JWT.
 */
export function decodeToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

/** Decode the header (alg/typ/kid). Rarely needed; exported for debugging. */
export function decodeHeader(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[0]));
  } catch {
    return null;
  }
}

/**
 * Expiry as milliseconds since epoch (JS convention), or null when the token
 * carries no `exp`. Note the claim itself is in SECONDS.
 */
export function getExpiry(token) {
  const payload = decodeToken(token);
  const exp = payload?.exp;
  if (typeof exp !== 'number' || !Number.isFinite(exp)) return null;
  return exp * 1000;
}

/**
 * Milliseconds until expiry. Negative when already expired, `Infinity` when the
 * token has no `exp` claim (treated as non-expiring — the server still decides).
 */
export function millisUntilExpiry(token, now = Date.now()) {
  const expiry = getExpiry(token);
  if (expiry === null) return Number.POSITIVE_INFINITY;
  return expiry - now;
}

/**
 * @param {string} token
 * @param {number} [leewaySeconds=0] Treat a token expiring within this window as
 *   already expired. Use ~30s so a request never leaves with a token that dies
 *   in flight.
 * @returns {boolean} true for a malformed/absent token too — "cannot prove it is
 *   valid" and "is invalid" are the same thing for a client-side gate.
 */
export function isExpired(token, leewaySeconds = 0) {
  if (!token) return true;
  const payload = decodeToken(token);
  if (!payload) return true;
  if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return false;
  return payload.exp * 1000 <= Date.now() + leewaySeconds * 1000;
}

/** True when the token decodes AND is not expired. */
export function isValid(token, leewaySeconds = 0) {
  return Boolean(decodeToken(token)) && !isExpired(token, leewaySeconds);
}

/** Read one claim safely. */
export function getClaim(token, claim, fallback = null) {
  const payload = decodeToken(token);
  if (!payload || !(claim in payload)) return fallback;
  return payload[claim];
}

/** The numeric user id from the `user_id` claim (this backend's spelling), or null. */
export function getUserId(token) {
  const raw = getClaim(token, 'user_id', getClaim(token, 'sub', null));
  const id = Number(raw);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** The raw role literal — 'Admin' | 'Doctor' | 'AI User'. Never normalised here. */
export function getRole(token) {
  const role = getClaim(token, 'role', null);
  return typeof role === 'string' && role ? role : null;
}

/** Issued-at as ms, or null. */
export function getIssuedAt(token) {
  const iat = getClaim(token, 'iat', null);
  return typeof iat === 'number' && Number.isFinite(iat) ? iat * 1000 : null;
}

export default {
  decodeHeader,
  decodeToken,
  getClaim,
  getExpiry,
  getIssuedAt,
  getRole,
  getUserId,
  isExpired,
  isValid,
  millisUntilExpiry,
};
