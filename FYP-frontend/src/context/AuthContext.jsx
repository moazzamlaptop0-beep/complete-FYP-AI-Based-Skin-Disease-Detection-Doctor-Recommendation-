/**
 * AuthContext — the ONE session owner.
 *
 * WHAT IT REPLACES
 * ----------------
 * 45 direct `localStorage.getItem` calls across 14 files and FIVE divergent
 * logout implementations (Navbar clears three sessionStorage keys, the doctor
 * header clears two localStorage keys, PatientHistory clears one and reloads,
 * AdminDashboard navigates without clearing at all). One state, one logout.
 *
 * COMPATIBILITY (this phase, deliberately)
 * ----------------------------------------
 * The legacy `token` and `user` localStorage keys are still written, in exactly
 * the old format, because the eight pre-refactor pages read them directly and
 * must keep working untouched. `lib/storage.js` owns those keys; nothing here
 * touches `localStorage` by hand.
 *
 * THE REHYDRATE, AND WHY IT MATTERS
 * ---------------------------------
 * `/login` bakes `verification_status` into the stored user, so today a doctor
 * whom an admin just approved keeps seeing "Pending Verification" until they log
 * out and back in. On mount we call GET /auth/me and refresh the whole picture:
 * user, doctor profile, permissions, workspaces, pending consents.
 *
 * DEGRADED MODE IS A FEATURE
 * --------------------------
 * `/auth/me` is being built in parallel and may 404 today; the backend may also
 * be down entirely while someone reads the public landing page. Neither may
 * produce an infinite spinner. `status` therefore leaves 'loading' on EVERY
 * path — success, failure, timeout — and falls back to the cached session
 * (flagged `degraded: true`) when the token is still structurally valid.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  ApiError,
  cancelRefresh,
  configureApi,
  post,
  refreshSession,
  request,
} from '../lib/api';
import { auth as authEndpoints } from '../lib/endpoints';
import { WORKSPACES, allowedForRole } from '../routes';
import { isExpired, millisUntilExpiry } from '../lib/jwt';
import {
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  homeRouteForRole,
  normalizeRole,
  permissionsForRole,
  roleRank,
} from '../lib/permissions';
import * as storage from '../lib/storage';

/** Refresh this long before the token dies, so a slow request never rides an expired token. */
const REFRESH_LEAD_MS = 60_000;
/** Never schedule tighter than this; a pathological clock skew would otherwise spin. */
const MIN_REFRESH_DELAY_MS = 5_000;
/** `/auth/me` gets this long before we give up and render from cache. */
const ME_TIMEOUT_MS = 8_000;

export const AuthContext = createContext(null);

// ---------------------------------------------------------------------------
// Derivations
// ---------------------------------------------------------------------------

/**
 * The surfaces this session can open. THIS is what lets a doctor use their own
 * patient surface without a second account: 'Doctor' genuinely holds every
 * patient permission (ROLE_PERMISSIONS is built by union), so the patient
 * workspace is offered to them by permission — never by `role === 'AI User'`
 * string equality.
 *
 * The `allowedForRole` pass is what stops that union going one step too far. An
 * ADMIN also holds every doctor and patient permission, but they have no
 * DoctorProfile and no scans of their own, so those two workspaces were a door
 * into three permanently empty pages each. `excludeRoles` in routes.js drops
 * them; an admin reaches a REAL doctor or patient surface by ACTING AS one,
 * which is audited.
 *
 * @param {object|null} user
 * @param {string[]} permissions
 * @returns {Array<{id:string,label:string,description:string,route:string,role:string}>}
 */
export function deriveWorkspaces(user, permissions) {
  if (!user) return [];
  return WORKSPACES
    .filter((workspace) => allowedForRole(workspace, user.role))
    .filter((workspace) => hasAnyPermission(permissions, workspace.anyPermission))
    .map(toWorkspace);
}

/** The client's shape, from routes.js — the CLIENT owns routing, so its paths win. */
function toWorkspace(known) {
  return {
    id: known.id,
    label: known.label,
    description: known.description,
    route: known.route,
    home: known.home,
    role: known.role,
  };
}

/**
 * `/auth/me` answers `{key, label, route}` with the PRE-REFACTOR routes and no
 * `id` and no `description` (app/services/auth_service.py:workspaces_for). Taken
 * verbatim that gives WorkspaceSwitcher `workspace.id === undefined` on every
 * row — so `current.id === workspace.id` is true for ALL of them and every
 * workspace renders as the active one — and routes like `/admin-dashboard` that
 * no settled URL ever equals, so the trigger is always labelled with the first
 * workspace. Map the server's `key` onto the client entry instead; an unknown
 * key is kept rather than dropped.
 *
 * `excludeRoles` is enforced HERE TOO, not only in deriveWorkspaces. The server
 * still answers an admin with three workspaces on any deployment where the
 * backend is older than this client (and `workspaces_for` is a plain role→tuple
 * map, so it will drift again), and taking that list verbatim would put the two
 * dead surfaces straight back into the switcher. The client owns which surfaces
 * it renders; the server's list only ever narrows it.
 */
function normalizeWorkspaces(list, user, permissions) {
  if (!Array.isArray(list) || !list.length) return deriveWorkspaces(user, permissions);

  const seen = new Set();
  const normalized = [];
  list.forEach((entry) => {
    if (!entry || typeof entry !== 'object') return;
    const id = typeof entry.id === 'string' && entry.id
      ? entry.id
      : (typeof entry.key === 'string' && entry.key ? entry.key : null);
    if (!id || seen.has(id)) return;
    seen.add(id);

    const known = WORKSPACES.find((workspace) => workspace.id === id);
    if (known) {
      if (allowedForRole(known, user?.role)) normalized.push(toWorkspace(known));
      return;
    }
    if (typeof entry.route === 'string' && entry.route) {
      normalized.push({
        id,
        label: entry.label || id,
        description: entry.description || '',
        route: entry.route,
        home: entry.home || entry.route,
        role: entry.role || null,
      });
    }
  });

  return normalized.length ? normalized : deriveWorkspaces(user, permissions);
}

/** Normalise whatever `/auth/me` returns into our state slice. Every key optional. */
export function normalizeMePayload(payload, fallbackUser = null) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const user = (source.user && typeof source.user === 'object' ? source.user : null)
    // Some shapes return the user at the top level.
    || (source.id !== undefined && source.email !== undefined ? source : null)
    || fallbackUser;

  const role = normalizeRole(user?.role);

  const permissions = Array.isArray(source.permissions) && source.permissions.length
    ? source.permissions.filter((p) => typeof p === 'string')
    : [...permissionsForRole(role)];

  const doctor = source.doctor
    || source.doctor_profile
    || source.doctorProfile
    || null;

  const pendingConsents = Array.isArray(source.pending_consents)
    ? source.pending_consents
    : Array.isArray(source.pendingConsents)
      ? source.pendingConsents
      : [];

  const workspaces = normalizeWorkspaces(source.workspaces, user, permissions);

  const homeRoute = typeof source.home_route === 'string' && source.home_route
    ? source.home_route
    : typeof source.homeRoute === 'string' && source.homeRoute
      ? source.homeRoute
      : homeRouteForRole(role);

  return { user, doctor, permissions, workspaces, pendingConsents, homeRoute };
}

/**
 * Merge the fresh `/auth/me` user onto the stored one. `/login` supplies
 * `joined_at` and `verification_status`; a leaner `/auth/me` must not delete
 * them from the object the eight legacy pages still read.
 */
function mergeUser(previous, next) {
  if (!next) return previous || null;
  if (!previous) return next;
  return { ...previous, ...next };
}

const ANON_STATE = Object.freeze({
  status: 'anon',
  user: null,
  doctor: null,
  permissions: [],
  workspaces: [],
  homeRoute: '/',
  pendingConsents: [],
  actingAs: null,
  degraded: false,
  error: null,
});

/** Read whatever is already on disk, so the first paint is not a flash of anonymous. */
function initialState() {
  const token = storage.getToken();
  const user = storage.getUser();

  if (!token || !user) {
    // No session to restore: answer immediately. An anonymous visitor must never
    // wait on the network to see the landing page.
    return { ...ANON_STATE, actingAs: null };
  }

  const permissions = [...permissionsForRole(user.role)];
  return {
    status: 'loading',
    user,
    doctor: null,
    permissions,
    workspaces: deriveWorkspaces(user, permissions),
    homeRoute: homeRouteForRole(user.role),
    pendingConsents: [],
    actingAs: storage.getActingAs(),
    degraded: false,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }) {
  const [state, setState] = useState(initialState);
  /**
   * Bumped every time the stored access token is replaced. A refresh writes to
   * localStorage and to a ref — neither is React state, so without this counter
   * the proactive-refresh effect below never re-runs and the timer it schedules
   * fires EXACTLY ONCE per session. A tab left open across a weekend would then
   * sit on a dead token with a perfectly good refresh token beside it.
   */
  const [tokenTick, setTokenTick] = useState(0);

  const mounted = useRef(true);
  const refreshTimer = useRef(null);
  /** The token we last saw, so the cross-tab listener can tell "changed" from "echo". */
  const knownToken = useRef(storage.getToken());
  /** Guards against a logout racing an in-flight rehydrate. */
  const sessionEpoch = useRef(0);

  const safeSetState = useCallback((updater) => {
    if (mounted.current) setState(updater);
  }, []);

  // -- logout: the ONE canonical implementation ------------------------------
  /**
   * @param {{silent?: boolean, revoke?: boolean, reason?: string}} [options]
   *   silent — do not attempt the server-side revoke (used when the server has
   *   already told us the session is dead).
   */
  const logout = useCallback(async (options = {}) => {
    const { silent = false, reason = null } = options;
    // Bumped BEFORE the round-trip: a refresh already in flight must not write a
    // freshly minted token back over the session we are ending.
    sessionEpoch.current += 1;
    cancelRefresh();

    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }

    if (!silent && storage.getToken()) {
      // Read BEFORE clearSession: /auth/logout revokes the refresh token named in
      // the BODY and nothing else (there are no auth cookies anywhere in this
      // backend). Posting `{}` returns 200 with `revoked: false` and leaves a
      // 30-day credential live server-side, so "log out" would be a purely
      // client-side act.
      const refreshToken = storage.getRefreshToken();
      try {
        // Best effort. The local session dies regardless of what the server says
        // — a network failure must never trap someone in a logged-in shell.
        await post(
          authEndpoints.logout(),
          refreshToken ? { refresh_token: refreshToken } : {},
          // `actAs: false` so the audit row names the real actor, not whoever an
          // admin happened to be viewing as.
          { skipAuthRefresh: true, timeoutMs: 4000, actAs: false },
        );
      } catch {
        /* ignore */
      }
    }

    storage.clearSession();
    knownToken.current = null;
    safeSetState({ ...ANON_STATE, error: reason });
  }, [safeSetState]);

  // -- rehydrate from GET /auth/me -------------------------------------------
  /**
   * @param {{silent?: boolean}} [options]
   * @returns {Promise<boolean>} true when the server answered authoritatively.
   */
  const rehydrate = useCallback(async () => {
    const epoch = sessionEpoch.current;
    const token = storage.getToken();

    if (!token) {
      safeSetState({ ...ANON_STATE });
      return false;
    }

    // An already-dead token: spend the round-trip on a refresh instead of a
    // guaranteed 401.
    if (isExpired(token, 5)) {
      try {
        await refreshSession();
      } catch {
        await logout({ silent: true });
        return false;
      }
    }

    let payload;
    try {
      // `actAs: false`: /auth/me must describe the SESSION OWNER. With the
      // impersonation header attached the backend answers for the target, and
      // the reply is merged over the admin's own identity and permissions —
      // locking them out of their own console until they reload.
      payload = await request(authEndpoints.me(), { timeoutMs: ME_TIMEOUT_MS, actAs: false });
    } catch (error) {
      if (epoch !== sessionEpoch.current || !mounted.current) return false;

      const status = error instanceof ApiError ? error.status : 0;
      if (status === 401 || status === 403) {
        await logout({ silent: true, reason: 'Your session has expired. Please log in again.' });
        return false;
      }

      // 404 (the route is not deployed yet), 500, or a dead backend. Fall back
      // to the cached session rather than a spinner — this is the path the
      // public landing page takes when Flask is not running.
      const cachedUser = storage.getUser();
      const stillValid = Boolean(cachedUser) && !isExpired(storage.getToken(), 0);
      if (!stillValid) {
        safeSetState({ ...ANON_STATE });
        return false;
      }
      const permissions = [...permissionsForRole(cachedUser.role)];
      safeSetState((prev) => ({
        ...prev,
        status: 'authed',
        user: mergeUser(prev.user, cachedUser),
        permissions: prev.permissions.length ? prev.permissions : permissions,
        workspaces: prev.workspaces.length ? prev.workspaces : deriveWorkspaces(cachedUser, permissions),
        homeRoute: prev.homeRoute && prev.homeRoute !== '/' ? prev.homeRoute : homeRouteForRole(cachedUser.role),
        degraded: true,
        error: null,
      }));
      return false;
    }

    if (epoch !== sessionEpoch.current || !mounted.current) return false;

    const cached = storage.getUser();
    const next = normalizeMePayload(payload, cached);
    if (!next.user) {
      // A 200 with nothing usable in it. Treat the cache as the truth.
      safeSetState((prev) => ({ ...prev, status: 'authed', degraded: true }));
      return false;
    }

    const merged = mergeUser(cached, next.user);
    // Keep the legacy `user` key current so the eight untouched pages see the
    // fresh verification_status too.
    storage.setUser(merged);

    safeSetState((prev) => ({
      ...prev,
      status: 'authed',
      user: merged,
      doctor: next.doctor,
      permissions: next.permissions,
      workspaces: next.workspaces.length ? next.workspaces : deriveWorkspaces(merged, next.permissions),
      homeRoute: next.homeRoute,
      pendingConsents: next.pendingConsents,
      degraded: false,
      error: null,
    }));
    return true;
  }, [logout, safeSetState]);

  // -- login -----------------------------------------------------------------
  /**
   * @param {{email:string, password:string, role?:string}} credentials
   * @returns {Promise<object>} the user object (also written to the legacy keys)
   */
  const login = useCallback(async (credentials) => {
    // `skipAuthRefresh` — a 401 here is "wrong password", not "expired session";
    // attempting a refresh would be noise and could log the previous tab out.
    const data = await post(authEndpoints.login(), credentials, {
      auth: false,
      skipAuthRefresh: true,
    });

    const token = data?.token || data?.access_token || null;
    const user = data?.user || null;
    if (!token || !user) {
      throw new ApiError(500, 'Login succeeded but the response was missing the token or user.', data);
    }

    sessionEpoch.current += 1;
    storage.setToken(token);
    storage.setUser(user);
    if (data.refresh_token) storage.setRefreshToken(data.refresh_token);
    storage.setActingAs(null);
    knownToken.current = token;

    const permissions = [...permissionsForRole(user.role)];
    safeSetState({
      status: 'authed',
      user,
      doctor: null,
      permissions,
      workspaces: deriveWorkspaces(user, permissions),
      homeRoute: homeRouteForRole(user.role),
      pendingConsents: [],
      actingAs: null,
      degraded: false,
      error: null,
    });

    // Fill in the real permissions/workspaces/consents in the background. A
    // failure here is silent: the user is already logged in.
    rehydrate().catch(() => {});
    return user;
  }, [rehydrate, safeSetState]);

  // -- impersonation ---------------------------------------------------------
  /**
   * Start acting as another user. Every subsequent request carries
   * `X-Act-As-User-Id` and the backend writes an audit_logs row for each one.
   * The backend also requires a STRICTLY higher rank and a non-root target; we
   * check both here purely to fail fast with a readable message.
   * @param {{id:number, name?:string, role?:string, is_root?:boolean}} target
   */
  const setActingAs = useCallback(async (target) => {
    if (!target) return null;
    const userId = Number(target.id ?? target.userId ?? target.user_id);
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new Error('setActingAs needs a numeric user id.');
    }
    if (target.is_root) {
      throw new Error('Root accounts cannot be impersonated.');
    }
    if (target.role && roleRank(state.user?.role) <= roleRank(target.role)) {
      throw new Error('You can only act as a user with a lower role than your own.');
    }

    const record = {
      userId,
      name: target.name || target.email || `User #${userId}`,
      role: normalizeRole(target.role) || null,
      startedAt: Date.now(),
    };
    storage.setActingAs(record);
    safeSetState((prev) => ({ ...prev, actingAs: record }));
    return record;
  }, [safeSetState, state.user]);

  const exitActingAs = useCallback(() => {
    storage.setActingAs(null);
    safeSetState((prev) => ({ ...prev, actingAs: null }));
  }, [safeSetState]);

  // -- refresh ---------------------------------------------------------------
  const refresh = useCallback(async () => {
    try {
      await refreshSession();
      knownToken.current = storage.getToken();
      return true;
    } catch {
      await logout({ silent: true, reason: 'Your session has expired. Please log in again.' });
      return false;
    }
  }, [logout]);

  // -- wire the api client to this session -----------------------------------
  useEffect(() => {
    configureApi({
      // A 401 that survived one refresh attempt. `silent` because the server has
      // already invalidated us; POSTing /auth/logout would just 401 again.
      onUnauthorized: () => { logout({ silent: true, reason: 'Your session has expired. Please log in again.' }); },
      onRefreshed: () => {
        knownToken.current = storage.getToken();
        // The ONLY signal the refresh effect gets that a new token exists.
        if (mounted.current) setTokenTick((tick) => tick + 1);
      },
      getActingAs: () => storage.getActingAs(),
      getSessionEpoch: () => sessionEpoch.current,
    });
  }, [logout]);

  // -- mount: rehydrate ------------------------------------------------------
  useEffect(() => {
    mounted.current = true;
    if (storage.getToken()) {
      rehydrate().catch(() => {
        // Belt and braces: whatever happens, we must not stay on 'loading'.
        safeSetState((prev) => (prev.status === 'loading' ? { ...ANON_STATE } : prev));
      });
    }
    return () => { mounted.current = false; };
    // Intentionally mount-only: rehydrate is stable and re-running it on every
    // identity change would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -- proactive refresh before expiry ---------------------------------------
  useEffect(() => {
    if (refreshTimer.current) {
      clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    }
    if (state.status !== 'authed') return undefined;

    const token = storage.getToken();
    if (!token) return undefined;

    const remaining = millisUntilExpiry(token);
    if (!Number.isFinite(remaining)) return undefined; // no `exp` claim: nothing to schedule
    // Already dead by the local clock: a timer cannot rescue that, and now that
    // the effect re-arms itself it would rotate the refresh token every 5s under
    // a badly skewed clock. RequireAuth's recovery and the reactive 401 refresh
    // own this case instead.
    if (remaining <= 0) return undefined;

    const delay = Math.max(MIN_REFRESH_DELAY_MS, remaining - REFRESH_LEAD_MS);
    refreshTimer.current = setTimeout(() => { refresh(); }, delay);

    return () => {
      if (refreshTimer.current) {
        clearTimeout(refreshTimer.current);
        refreshTimer.current = null;
      }
    };
    // `tokenTick` is what re-arms this after every successful refresh; without it
    // the timeout is scheduled once and never again.
  }, [state.status, state.user, refresh, tokenTick]);

  // -- cross-tab sync --------------------------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    const onStorage = (event) => {
      // `event.key === null` is a whole-storage clear.
      if (event.key !== null && event.key !== storage.LEGACY_KEYS.TOKEN) return;

      const token = storage.getToken();
      if (token === knownToken.current) return;
      knownToken.current = token;

      if (!token) {
        // Logged out in another tab. Local teardown only — the other tab already
        // told the server.
        sessionEpoch.current += 1;
        if (refreshTimer.current) {
          clearTimeout(refreshTimer.current);
          refreshTimer.current = null;
        }
        safeSetState({ ...ANON_STATE });
        return;
      }

      // Logged in (or switched account) in another tab.
      rehydrate().catch(() => {});
    };

    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [rehydrate, safeSetState]);

  // -- derived helpers -------------------------------------------------------
  const can = useCallback(
    (permission) => {
      if (!permission) return true;
      return Array.isArray(permission)
        ? hasAllPermissions(state.permissions, permission)
        : hasPermission(state.permissions, permission);
    },
    [state.permissions],
  );

  const canAny = useCallback(
    (permissions) => hasAnyPermission(state.permissions, permissions),
    [state.permissions],
  );

  const value = useMemo(() => ({
    ...state,
    isAuthenticated: state.status === 'authed',
    isLoading: state.status === 'loading',
    isAnonymous: state.status === 'anon',
    role: normalizeRole(state.user?.role),
    /**
     * The role the CHROME should dress itself as.
     *
     * Identical to `role` in every ordinary session. It differs only while an
     * admin is acting as somebody, and then it has to: nav visibility consults
     * `excludeRoles` (routes.js), which hides every doctor and patient link from
     * an Admin — so filtering on the real role would hand an admin acting as a
     * doctor an EMPTY doctor sidebar. Authorisation never reads this; it reads
     * `permissions`, which the server intersects on its own side.
     */
    effectiveRole: normalizeRole(state.actingAs?.role) || normalizeRole(state.user?.role),
    /** Rank comparison, so `minLevel` gates work without string equality. */
    roleRank: roleRank(state.user?.role),
    can,
    canAny,
    exitActingAs,
    login,
    logout,
    refresh,
    rehydrate,
    setActingAs,
  }), [state, can, canAny, exitActingAs, login, logout, refresh, rehydrate, setActingAs]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * @returns {{
 *   status:'loading'|'authed'|'anon', user:object|null, doctor:object|null,
 *   permissions:string[], workspaces:Array<object>, homeRoute:string,
 *   pendingConsents:Array<object>, actingAs:object|null, degraded:boolean,
 *   isAuthenticated:boolean, isLoading:boolean, isAnonymous:boolean,
 *   role:string|null, effectiveRole:string|null, roleRank:number,
 *   can:(p:string|string[])=>boolean, canAny:(p:string[])=>boolean,
 *   login:Function, logout:Function, refresh:Function, rehydrate:Function,
 *   setActingAs:Function, exitActingAs:Function
 * }}
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used inside <AuthProvider>. Wrap the app (or the test) in it.');
  }
  return context;
}

/** Non-throwing variant for components that may render outside the provider. */
export function useOptionalAuth() {
  return useContext(AuthContext);
}

export default AuthContext;
