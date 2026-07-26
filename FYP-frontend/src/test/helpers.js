/**
 * Test helpers. Kept OUT of setup.js so importing them from a test file cannot
 * re-register setup.js's global hooks.
 */

/**
 * Mint a decodable (unsigned — nothing in the client verifies signatures) JWT
 * in this backend's shape: `{user_id, role, exp}`.
 * @param {object} [claims]
 * @param {number} [secondsFromNow=3600] `exp` offset; pass a negative number
 *   for an already-expired token.
 */
export function makeToken(claims = {}, secondsFromNow = 3600) {
  const encode = (object) => btoa(JSON.stringify(object))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  const payload = {
    user_id: 1,
    role: 'AI User',
    exp: Math.floor(Date.now() / 1000) + secondsFromNow,
    ...claims,
  };
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

/** A `fetch` stand-in returning a JSON body. */
export function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

/** A `fetch` stand-in returning a NON-JSON body — Flask's raw HTML error pages. */
export function textResponse(text, status = 500) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  };
}

/** The standard success envelope. */
export const envelope = (data, message = '') => ({
  success: true,
  ...(message ? { message } : {}),
  ...(data !== undefined ? { data } : {}),
});

/** The standard failure envelope. */
export const errorEnvelope = (error) => ({ success: false, error });
