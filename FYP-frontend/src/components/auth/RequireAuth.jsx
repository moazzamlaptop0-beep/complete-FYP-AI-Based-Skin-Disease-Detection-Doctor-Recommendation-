/**
 * RequireAuth — the route guard for everything built from here on.
 *
 * ProtectedRoute.jsx (still in use by the three existing protected routes) is
 * deliberately left ALONE this phase. This is its replacement, added alongside:
 *
 *   ProtectedRoute                          RequireAuth
 *   ------------------------------------    ------------------------------------
 *   bare JSON.parse(localStorage) —         reads AuthContext, which reads
 *   a corrupt value white-screens           storage.js (never throws)
 *   `user.role !== allowedRole`             permission / rank evaluation, so
 *   — an Admin is BLOCKED from a            ADMIN > DOCTOR > PATIENT works
 *   Doctor route                            automatically
 *   never looks at `exp`                    expired token ⇒ treated as anonymous
 *   drops the destination on redirect       carries `returnTo` both ways
 *   no loading state                        waits for status !== 'loading'
 *
 * PROPS
 *   roles      string | string[]  — minimum role(s). 'Doctor' admits an Admin.
 *   permission string | string[]  — every listed permission is required.
 *   anyPermission string[]        — at least one is required.
 *   minLevel   string | number    — a role literal or a raw ROLE_RANK number.
 *   children                      — the guarded tree; omit to guard an <Outlet/>.
 */

import React, { useEffect, useState } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '../../context/AuthContext';
import { isExpired } from '../../lib/jwt';
import {
  ROLE_RANK,
  hasAllPermissions,
  hasAnyPermission,
  normalizeRole,
} from '../../lib/permissions';
import * as storage from '../../lib/storage';
import Spinner from '../ui/Spinner';

/** Where anonymous users are sent. The existing login page lives here. */
export const AUTH_ROUTE = '/login';

/** Build `/login?returnTo=%2Fdoctor-dashboard%2Fratings`. */
export function withReturnTo(route, location) {
  const target = `${location?.pathname || ''}${location?.search || ''}${location?.hash || ''}`;
  if (!target || target === '/') return route;
  return `${route}${route.includes('?') ? '&' : '?'}returnTo=${encodeURIComponent(target)}`;
}

/** The rank a `roles`/`minLevel` prop demands. Lowest listed role wins — a
 *  route open to Doctors is, by construction, open to Admins. */
function requiredRank(roles, minLevel) {
  const ranks = [];

  if (roles) {
    const list = Array.isArray(roles) ? roles : [roles];
    list.forEach((role) => {
      const rank = ROLE_RANK[normalizeRole(role)];
      if (rank) ranks.push(rank);
    });
  }

  if (minLevel !== undefined && minLevel !== null) {
    if (typeof minLevel === 'number' && Number.isFinite(minLevel)) ranks.push(minLevel);
    else {
      const rank = ROLE_RANK[normalizeRole(minLevel)];
      if (rank) ranks.push(rank);
    }
  }

  return ranks.length ? Math.min(...ranks) : 0;
}

/** The default "waiting for /auth/me" state. Deliberately quiet — this shows
 *  for a few hundred ms on a warm session and must not flash a layout. */
function AuthPending() {
  return (
    <div className="flex min-h-[50vh] w-full items-center justify-center bg-canvas">
      {/* Spinner owns role="status" when it has a label — do not nest another. */}
      <Spinner size="lg" label="Checking your session…" className="text-primary-700" />
    </div>
  );
}

/**
 * @param {object} props
 * @param {string|string[]} [props.roles]
 * @param {string|string[]} [props.permission] ALL required.
 * @param {string[]} [props.anyPermission] AT LEAST ONE required.
 * @param {string|number} [props.minLevel]
 * @param {React.ReactNode} [props.children] Omit to guard a nested <Outlet/>.
 * @param {React.ReactNode} [props.fallback] Rendered while status === 'loading'.
 * @param {string} [props.redirectTo=AUTH_ROUTE] Where anonymous users go.
 * @param {React.ReactNode} [props.deniedElement] Rendered instead of redirecting
 *   an authenticated-but-unauthorised user (useful for an inline 403 panel).
 */
export default function RequireAuth({
  roles,
  permission,
  anyPermission,
  minLevel,
  children,
  fallback,
  redirectTo = AUTH_ROUTE,
  deniedElement,
}) {
  const auth = useAuth();
  const location = useLocation();

  const tokenIsDead = isExpired(storage.getToken(), 5);

  /**
   * AN EXPIRED ACCESS TOKEN IS NOT AN EXPIRED SESSION.
   *
   * The access token lives 24h; the refresh token beside it lives 30 days. A tab
   * open since yesterday hits this guard with a dead access token and a perfectly
   * good refresh token, and redirecting is not merely rude — the auth screen
   * sends an already-`authed` visitor straight back to `returnTo`, so the two
   * routes ping-pong until React gives up with "Maximum update depth exceeded".
   * Spend one refresh before deciding. On failure `auth.refresh()` logs out,
   * `status` becomes 'anon', and the redirect below happens for the right reason.
   *
   * 'idle' -> 'pending' -> 'done'. One attempt per mount, so a token that is
   * still dead afterwards (a badly skewed clock) falls through instead of looping.
   */
  const [recovery, setRecovery] = useState('idle');
  const recovering = auth.status === 'authed' && tokenIsDead && recovery !== 'done';

  useEffect(() => {
    if (!recovering || recovery !== 'idle') return undefined;
    let alive = true;
    setRecovery('pending');
    Promise.resolve(auth.refresh())
      .catch(() => false)
      .then(() => { if (alive) setRecovery('done'); });
    return () => { alive = false; };
  }, [recovering, recovery, auth]);

  // 1. Still deciding — waiting on /auth/me, or on the recovery refresh above.
  //    AuthContext guarantees 'loading' is transient: it exits on success, on
  //    failure, and on a dead backend.
  if (auth.status === 'loading' || recovering) {
    return fallback !== undefined ? fallback : <AuthPending />;
  }

  // 2. Anonymous — or holding a token that is dead and could not be renewed.
  //    Checking `exp` locally saves a guaranteed 401 round-trip and, more
  //    importantly, stops the guarded page from mounting and firing its own
  //    doomed requests.
  if (auth.status !== 'authed' || tokenIsDead) {
    return <Navigate to={withReturnTo(redirectTo, location)} replace state={{ returnTo: location.pathname }} />;
  }

  // 3. Authorisation, evaluated from permissions[] and rank — never from
  //    `user.role === '...'`.
  const needed = requiredRank(roles, minLevel);
  const rankOk = needed === 0 || auth.roleRank >= needed;
  const permsOk = !permission || hasAllPermissions(auth.permissions, permission);
  const anyOk = !anyPermission || !anyPermission.length || hasAnyPermission(auth.permissions, anyPermission);

  if (!rankOk || !permsOk || !anyOk) {
    if (deniedElement !== undefined) return deniedElement;
    // Send them somewhere they CAN be, not to a dead end.
    const home = auth.homeRoute && auth.homeRoute !== location.pathname ? auth.homeRoute : '/';
    return <Navigate to={home} replace />;
  }

  return children !== undefined && children !== null ? children : <Outlet />;
}

export { RequireAuth, AuthPending };
