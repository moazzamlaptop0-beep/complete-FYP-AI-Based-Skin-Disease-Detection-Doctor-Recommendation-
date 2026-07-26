/**
 * authApi.js — every network call the unified auth screen makes, in one place.
 *
 * Nothing here templates a URL: paths come from `lib/endpoints.js` and the
 * transport is `lib/api.js`, so the envelope unwrap, the ApiError typing and
 * the base-URL derivation are the app-wide ones.
 *
 * EVERY call passes `{auth:false, skipAuthRefresh:true}`:
 *   - `auth:false`         — a stale Bearer from a dead session must not ride
 *                            along on a login attempt.
 *   - `skipAuthRefresh`    — a 401 here means "wrong password", not "expired
 *                            session". Letting api.js run its refresh dance
 *                            would fire a pointless POST /auth/refresh and, on
 *                            failure, log the OTHER tab out.
 *
 * WHY THIS SCREEN USES THE `/auth/*` TWINS AND NOT THE LEGACY SIX
 * --------------------------------------------------------------
 * The legacy routes still work and are still frozen; they simply cannot express
 * this flow. `/auth/login` returns a refresh token and the canonical `session`
 * payload (so we navigate to the home_route the BACKEND chose, not one the
 * client guessed). `/auth/verify-otp` with purpose='signup' returns a full
 * session, which is the only way the "unverified account, no password typed"
 * branch can finish without asking for a password it never collected.
 * `/auth/register` takes the doctor profile and the consent array in one atomic
 * call. The legacy shapes are still exercised by the eight untouched pages.
 */

import { ApiError, get, post } from '../../lib/api';
import { auth as authEndpoints } from '../../lib/endpoints';
import { homeRouteForRole } from '../../lib/permissions';
import * as storage from '../../lib/storage';

/** Public, unauthenticated, and never allowed to reuse a stale token. */
const PUBLIC = { auth: false, skipAuthRefresh: true };

/** OTP purposes the backend accepts (mirrors otp_service.VALID_PURPOSES). */
export const OTP_PURPOSE = Object.freeze({
  SIGNUP: 'signup',
  RESET: 'reset',
  EMAIL_CHANGE: 'email_change',
});

/** Role literals. Frozen by the RBAC contract — never invent a fourth. */
export const ROLE_PATIENT = 'AI User';
export const ROLE_DOCTOR = 'Doctor';

/** app/services/otp_service.py OTP_MAX_ATTEMPTS. The API does not report how
 *  many guesses are left, so the screen counts locally and defers to the
 *  server's lockout message the moment it arrives. */
export const OTP_MAX_ATTEMPTS = 5;

/** app/services/otp_service.py OTP_RESEND_COOLDOWN_SECONDS. Only the fallback:
 *  a 429 carries the authoritative number and `secondsFromCooldownMessage`
 *  reads it back out. */
export const OTP_RESEND_COOLDOWN_SECONDS = 45;

/**
 * The backend's 429 is literally `Please wait 31s before requesting another OTP.`
 * That number is the only server-driven countdown available, so parse it.
 * @param {string|null|undefined} message
 * @returns {number|null} seconds, or null when the message is not a cooldown.
 */
export function secondsFromCooldownMessage(message) {
  const match = /wait\s+(\d+)\s*s/i.exec(String(message || ''));
  if (!match) return null;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

/**
 * Which of the three doors to open.
 * @param {string} email
 * @returns {Promise<{status:'new'|'unverified'|'existing', next:'signup'|'otp'|'password'}>}
 */
export function checkEmail(email) {
  return post(authEndpoints.checkEmail(), { email }, PUBLIC);
}

/**
 * @param {{email:string, password:string}} credentials
 * @returns {Promise<{token:string, refresh_token?:string, user:object, session?:object}>}
 * @throws {ApiError} 401 wrong credentials; 403 `data.next==='otp'` unverified;
 *   403 without `next` for a deactivated account.
 */
export function login({ email, password }) {
  return post(authEndpoints.loginUnified(), { email, password }, PUBLIC);
}

/**
 * Account + optional doctor profile + consents, atomically.
 * @param {{name:string, email:string, password:string, role:string,
 *   doctor?:object, consents?:Array<{type:string,version:string,granted:boolean}>}} payload
 * @returns {Promise<{email:string, role:string, next:'otp', otp_purpose:'signup'}>}
 */
export function register(payload) {
  return post(authEndpoints.registerUnified(), payload, PUBLIC);
}

/**
 * @param {{email:string, otp:string, purpose:string}} args
 * @returns {Promise<object>} purpose='signup' resolves to a full session bundle;
 *   purpose='reset' resolves to `{verified:true, next:'new_password'}`.
 */
export function verifyOtp({ email, otp, purpose = OTP_PURPOSE.SIGNUP }) {
  return post(authEndpoints.verifyOtp(), { email, otp, purpose }, PUBLIC);
}

/** @param {{email:string, purpose:string}} args */
export function resendOtp({ email, purpose = OTP_PURPOSE.SIGNUP }) {
  return post(authEndpoints.resendOtpUnified(), { email, purpose }, PUBLIC);
}

/** Always resolves for a well-formed email — the endpoint never confirms
 *  whether an address exists. @param {string} email */
export function forgotPassword(email) {
  return post(authEndpoints.forgotPasswordUnified(), { email }, PUBLIC);
}

/** @param {{email:string, otp:string, password:string}} args */
export function resetPassword({ email, otp, password }) {
  return post(
    authEndpoints.resetPasswordUnified(),
    { email, otp, new_password: password },
    PUBLIC,
  );
}

/**
 * The consent documents the signup form must render, role-aware.
 * @param {string} [role] 'Doctor' adds the licence attestation.
 * @returns {Promise<{documents:Array<object>, password_policy:{min_length:number, rules:string[]}}>}
 */
export function consentDocuments(role) {
  return get(authEndpoints.consentDocuments(role ? { role } : undefined), PUBLIC);
}

// ---------------------------------------------------------------------------
// Seating the session
// ---------------------------------------------------------------------------

/**
 * Hand a freshly minted token bundle to the ONE session owner.
 *
 * WHY NOT `useAuth().login()`
 * --------------------------
 * `AuthContext.login()` posts credentials to the LEGACY `/login`, which returns
 * neither a refresh token nor `session.home_route`. Worse, half the flows that
 * reach this function never collected a password at all: an unverified account
 * that finishes `/auth/verify-otp` is authenticated by proving inbox ownership,
 * and there is nothing to replay a login with.
 *
 * So instead of a second login round-trip we write the bundle to the exact keys
 * AuthContext owns (via `lib/storage`, which is still the only module allowed
 * to touch localStorage) and then call the context's own `rehydrate()`. That is
 * the same code path AuthContext.login() ends on, so the session lands in the
 * canonical place, `/auth/me` refreshes permissions/workspaces/pendingConsents,
 * and the cross-tab `storage` listener fires exactly as it would after a normal
 * login. No context or lib file is modified to make this work.
 *
 * @param {object} bundle `{token|access_token, refresh_token?, user, session?}`
 * @param {{rehydrate?: () => Promise<any>}} [context] AuthContext helpers.
 * @returns {Promise<{user:object, homeRoute:string, session:object|null}>}
 * @throws {ApiError} when the response was missing the token or the user.
 */
export async function establishSession(bundle, context = {}) {
  const token = bundle?.token || bundle?.access_token || null;
  const user = bundle?.user || bundle?.session?.user || null;

  if (!token || !user) {
    throw new ApiError(
      500,
      'Sign-in succeeded but the response was missing the token or the account.',
      bundle,
    );
  }

  storage.setToken(token);
  storage.setUser(user);
  if (bundle.refresh_token) storage.setRefreshToken(bundle.refresh_token);
  // A fresh sign-in never inherits the previous session's impersonation.
  storage.setActingAs(null);

  // Best effort: a dead /auth/me must not strand a user who is genuinely signed
  // in. AuthContext's own rehydrate already degrades to the cached session.
  try {
    await context.rehydrate?.();
  } catch {
    /* ignore — the token and user are already stored */
  }

  const session = bundle.session && typeof bundle.session === 'object' ? bundle.session : null;
  const homeRoute = (typeof session?.home_route === 'string' && session.home_route)
    || homeRouteForRole(user.role);

  return { user, homeRoute, session };
}

/**
 * The doctor's licence state, or null for a non-doctor.
 *
 * Read from the session payload first (authoritative — it comes straight from
 * `doctor_block`), then the legacy `user.verification_status` that /login and
 * /auth/verify-otp also emit. A doctor with no profile row is 'pending', which
 * is what the backend reports too.
 *
 * @param {{user?:object, session?:object}} bundle
 * @returns {'pending'|'approved'|'rejected'|string|null}
 */
export function doctorVerificationStatus(bundle) {
  const user = bundle?.user || bundle?.session?.user || null;
  if (!user || user.role !== ROLE_DOCTOR) return null;
  return bundle?.session?.doctor?.verification_status
    ?? user.verification_status
    ?? 'pending';
}

/**
 * True when the account exists and is signed in, but cannot review cases yet —
 * either awaiting an admin ('pending') or turned down ('rejected'). Both need
 * an explanation screen rather than a dashboard full of empty tables.
 * @param {{user?:object, session?:object}} bundle
 */
export function isDoctorAwaitingApproval(bundle) {
  const status = doctorVerificationStatus(bundle);
  if (status === null) return false;
  return status !== 'approved' && status !== 'verified';
}

export default {
  OTP_MAX_ATTEMPTS,
  OTP_PURPOSE,
  OTP_RESEND_COOLDOWN_SECONDS,
  ROLE_DOCTOR,
  ROLE_PATIENT,
  checkEmail,
  consentDocuments,
  doctorVerificationStatus,
  establishSession,
  forgotPassword,
  isDoctorAwaitingApproval,
  login,
  register,
  resendOtp,
  resetPassword,
  secondsFromCooldownMessage,
  verifyOtp,
};
