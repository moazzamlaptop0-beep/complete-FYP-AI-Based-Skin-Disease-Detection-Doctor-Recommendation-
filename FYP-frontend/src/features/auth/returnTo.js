/**
 * returnTo.js — where to go after a successful sign-in.
 *
 * `RequireAuth` writes the destination two ways when it bounces an anonymous
 * visitor: `?returnTo=<encoded path>` on the URL and `state.returnTo` on the
 * router location. Both are read here, plus `?next=` and `state.from.pathname`,
 * which are the other two conventions already present in this codebase.
 *
 * SECURITY: ONLY same-origin, absolute paths are honoured.
 * An auth screen that redirects wherever the query string points is an
 * open-redirect phishing primitive — `?returnTo=https://evil.example/login`
 * shows the real login, then a convincing fake one on the attacker's domain.
 * `//host` is rejected too: browsers read it as protocol-relative and leave the
 * site. And a returnTo pointing back at the auth route itself would loop.
 */

/** Routes this screen is mounted at; bouncing to one of them would loop. */
const AUTH_ROUTES = new Set(['/login', '/register', '/auth']);

/**
 * @param {{search?:string, state?:any}|null} location
 * @returns {string|null} a safe absolute path, or null.
 */
export function resolveReturnTo(location) {
  const params = new URLSearchParams(location?.search || '');
  const candidate = params.get('returnTo')
    || params.get('next')
    || location?.state?.returnTo
    || location?.state?.from?.pathname
    || '';

  if (typeof candidate !== 'string' || !candidate) return null;
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return null;
  if (AUTH_ROUTES.has(candidate.split(/[?#]/)[0])) return null;
  return candidate;
}

export default resolveReturnTo;
