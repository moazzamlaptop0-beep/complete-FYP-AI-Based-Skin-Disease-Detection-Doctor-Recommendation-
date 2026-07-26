/**
 * useAuthMachine — the whole sign-in / sign-up / recovery flow as ONE machine.
 *
 * WHAT IT REPLACES
 * ----------------
 * A 637-line LoginPage with a three-tab ROLE SELECTOR whose selected label was
 * sent as a credential (pick the wrong tab, get "Invalid credentials" for a
 * perfectly good password), and an 832-line RegisterPage with two more tabs.
 * Five doors for one question. The backend now ignores the client-supplied role
 * entirely, so there is exactly one door: an email field.
 *
 * THE STATES
 * ----------
 *   EMAIL ──POST /auth/check-email──┬─ new ────────→ SIGNUP ──register──→ OTP_SIGNUP
 *                                   ├─ unverified ─→ OTP_SIGNUP
 *                                   └─ existing ───→ PASSWORD
 *   PASSWORD ─ ok ─→ DONE
 *            ├ 403 unverified ─→ OTP_SIGNUP
 *            └ "Forgot" ───────→ RESET_REQUEST → OTP_RESET → RESET_PASSWORD → DONE
 *   OTP_SIGNUP ─ verified ─→ DONE, or DOCTOR_PENDING when the licence is still
 *                            awaiting an admin.
 *
 * WHY A REDUCER AND NOT useState SOUP
 * -----------------------------------
 * Every step shares the same four cross-cutting concerns — busy, a server-error
 * banner, per-field errors and a back affordance. Held as separate useStates
 * they drift: the old pages could show a stale error under a fresh spinner, and
 * `loading` was never cleared on two of the error paths. One reducer makes
 * "moving" and "clearing the last failure" the same, single, atomic act.
 *
 * PERSISTENCE — THE REFRESH-ON-OTP BUG
 * ------------------------------------
 * Today, refreshing the browser on the OTP screen loses the email the code was
 * sent to. The user cannot re-register ("Email already exists"), cannot log in
 * ("verify your email first"), and cannot resend (the form no longer knows the
 * address). The account is bricked. So the flow snapshot — step, email, purpose,
 * and the absolute epoch the resend cooldown ends — is written to
 * sessionStorage (tab-scoped, 30-minute TTL) and restored on mount.
 *
 * A PASSWORD IS NEVER PERSISTED. Password fields are local state inside their
 * step component, so a refresh clears them by construction.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';

import { ApiError } from '../../lib/api';
import * as storage from '../../lib/storage';

import * as authApi from './authApi';
import { checkPasswordPolicy } from './passwordStrength';

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

/** @enum {string} */
export const STATES = Object.freeze({
  EMAIL: 'EMAIL',
  PASSWORD: 'PASSWORD',
  SIGNUP: 'SIGNUP',
  OTP_SIGNUP: 'OTP_SIGNUP',
  RESET_REQUEST: 'RESET_REQUEST',
  OTP_RESET: 'OTP_RESET',
  RESET_PASSWORD: 'RESET_PASSWORD',
  DOCTOR_PENDING: 'DOCTOR_PENDING',
  DONE: 'DONE',
});

const VALID_STATES = new Set(Object.values(STATES));

/** `next` from /auth/check-email -> the state that answers it. */
export const STATE_BY_NEXT = Object.freeze({
  signup: STATES.SIGNUP,
  otp: STATES.OTP_SIGNUP,
  password: STATES.PASSWORD,
});

/**
 * Which state a check-email answer opens.
 * @param {{status?:string, next?:string}|null} answer
 * @returns {string} a STATES value; unknown answers fall back to SIGNUP, which
 *   is the only branch that cannot lock anyone out (the server re-checks).
 */
export function stateForCheckEmail(answer) {
  const next = answer?.next || null;
  if (next && STATE_BY_NEXT[next]) return STATE_BY_NEXT[next];
  const status = answer?.status || null;
  if (status === 'existing') return STATES.PASSWORD;
  if (status === 'unverified') return STATES.OTP_SIGNUP;
  return STATES.SIGNUP;
}

/** States it is safe to restore a browser refresh into. DONE is not one of them
 *  (the session already exists; AuthContext owns that), and neither is EMAIL
 *  (nothing to restore). */
const RESUMABLE = new Set([
  STATES.PASSWORD,
  STATES.SIGNUP,
  STATES.OTP_SIGNUP,
  STATES.RESET_REQUEST,
  STATES.OTP_RESET,
  STATES.RESET_PASSWORD,
  STATES.DOCTOR_PENDING,
]);

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** sessionStorage key (namespaced by lib/storage to `aiderma:auth_flow`). */
export const FLOW_KEY = 'auth_flow';
/** Older than this and the OTP is dead anyway (codes live 10 minutes). */
export const FLOW_TTL_MS = 30 * 60 * 1000;

/** The subset of the machine that is worth surviving a refresh. Never a password. */
function snapshotOf(state) {
  return {
    v: 1,
    at: Date.now(),
    step: state.step,
    email: state.email,
    name: state.name,
    isDoctor: state.isDoctor,
    emailStatus: state.emailStatus,
    otpPurpose: state.otpPurpose,
    otpCode: state.otpCode,
    otpWrongAttempts: state.otpWrongAttempts,
    resendAvailableAt: state.resendAvailableAt,
    history: state.history,
  };
}

export function readFlowSnapshot(now = Date.now()) {
  const saved = storage.sessionStore.get(FLOW_KEY, null);
  if (!saved || typeof saved !== 'object') return null;
  if (saved.v !== 1) return null;
  if (!RESUMABLE.has(saved.step)) return null;
  if (!Number.isFinite(saved.at) || now - saved.at > FLOW_TTL_MS) {
    storage.sessionStore.remove(FLOW_KEY);
    return null;
  }
  // A restored step without the email it hangs off is worse than starting over.
  if (!saved.email) return null;
  return saved;
}

export function clearFlowSnapshot() {
  storage.sessionStore.remove(FLOW_KEY);
}

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

/**
 * @typedef {object} AuthMachineState
 * @property {string}   step               one of STATES
 * @property {string[]} history            steps to pop through on Back
 * @property {string}   email
 * @property {string}   name               collected on SIGNUP, shown on OTP
 * @property {boolean}  isDoctor           the healthcare-professional switch
 * @property {?string}  emailStatus        'new' | 'unverified' | 'existing'
 * @property {string}   otpPurpose         'signup' | 'reset'
 * @property {string}   otpCode            the VALIDATED reset code, carried to RESET_PASSWORD
 * @property {number}   otpWrongAttempts   counted client-side (see below)
 * @property {number}   resendAvailableAt  absolute epoch ms; 0 = available now
 * @property {boolean}  busy
 * @property {?string}  error              server-error banner copy
 * @property {Record<string,string>} fieldErrors
 * @property {?string}  notice             non-error banner (e.g. "code resent")
 * @property {?object}  result             `{user, homeRoute, session}` once authed
 */

/** @returns {AuthMachineState} */
export function initialMachineState(overrides = {}) {
  return {
    step: STATES.EMAIL,
    history: [],
    email: '',
    name: '',
    isDoctor: false,
    emailStatus: null,
    otpPurpose: authApi.OTP_PURPOSE.SIGNUP,
    otpCode: '',
    otpWrongAttempts: 0,
    resendAvailableAt: 0,
    busy: false,
    error: null,
    fieldErrors: {},
    notice: null,
    result: null,
    ...overrides,
  };
}

/** Rebuild the machine from a persisted snapshot. */
export function stateFromSnapshot(snapshot) {
  if (!snapshot) return initialMachineState();
  return initialMachineState({
    step: snapshot.step,
    email: snapshot.email || '',
    name: snapshot.name || '',
    isDoctor: Boolean(snapshot.isDoctor),
    emailStatus: snapshot.emailStatus || null,
    otpPurpose: snapshot.otpPurpose || authApi.OTP_PURPOSE.SIGNUP,
    otpCode: snapshot.otpCode || '',
    otpWrongAttempts: Number(snapshot.otpWrongAttempts) || 0,
    resendAvailableAt: Number(snapshot.resendAvailableAt) || 0,
    history: Array.isArray(snapshot.history) ? snapshot.history.filter((s) => VALID_STATES.has(s)) : [],
  });
}

// ---------------------------------------------------------------------------
// Reducer — pure, exported, and the unit under test
// ---------------------------------------------------------------------------

/**
 * @param {AuthMachineState} state
 * @param {{type:string, [key:string]:any}} action
 * @returns {AuthMachineState}
 */
export function reducer(state, action) {
  switch (action.type) {
    // A request left the building. Clearing BOTH error channels here is what
    // stops a stale failure being readable under a live spinner.
    case 'BUSY':
      return { ...state, busy: true, error: null, fieldErrors: {}, notice: null };

    case 'IDLE':
      return { ...state, busy: false };

    /** Field-level updates that are not a transition (cooldown ticks, notices). */
    case 'PATCH':
      return { ...state, ...(action.patch || {}) };

    case 'FAIL':
      return {
        ...state,
        ...(action.patch || {}),
        busy: false,
        error: action.error ?? null,
        fieldErrors: action.fieldErrors || {},
        notice: null,
      };

    case 'GO': {
      if (!VALID_STATES.has(action.step)) return state;
      const sameStep = action.step === state.step;
      // `replace` is for corrections (a 400 that means "you are on the wrong
      // screen"), which must not become a Back destination.
      const history = sameStep || action.replace
        ? state.history
        : [...state.history, state.step].slice(-12);
      return {
        ...state,
        ...(action.patch || {}),
        step: action.step,
        history,
        busy: false,
        error: action.error ?? null,
        fieldErrors: {},
        notice: action.notice ?? null,
      };
    }

    case 'BACK': {
      const history = [...state.history];
      const previous = history.pop();
      return {
        ...state,
        step: VALID_STATES.has(previous) ? previous : STATES.EMAIL,
        history,
        busy: false,
        error: null,
        fieldErrors: {},
        notice: null,
      };
    }

    /** "Not my email" / "start over" — every carried value is dropped. */
    case 'RESTART':
      return initialMachineState({ email: action.keepEmail ? state.email : '', ...(action.patch || {}) });

    case 'DISMISS_ERROR':
      return { ...state, error: null, notice: null };

    case 'HYDRATE':
      return stateFromSnapshot(action.snapshot);

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Error translation
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** @param {string} email */
export function isEmailShaped(email) {
  return EMAIL_RE.test(String(email || '').trim());
}

/**
 * Turn an ApiError into `{error, fieldErrors}`. The server's own wording is
 * always preferred — it is written for users and is the only thing that knows
 * WHICH rule failed — this only decides which control the message hangs under,
 * so the message lands next to the input the user has to change.
 *
 * @param {unknown} err
 * @param {{scope?:'email'|'password'|'signup'|'otp'|'newPassword'}} [options]
 */
export function describeError(err, options = {}) {
  const { scope } = options;

  if (!(err instanceof ApiError)) {
    return { error: 'Something went wrong. Please try again.', fieldErrors: {} };
  }

  const message = err.message || 'Something went wrong. Please try again.';
  const lower = message.toLowerCase();

  // Missing mandatory consents — the server names them.
  const missing = Array.isArray(err.data?.missing_consents) ? err.data.missing_consents : null;
  if (missing && missing.length) {
    return {
      error: message,
      fieldErrors: { consents: 'Please accept the required agreements to continue.' },
    };
  }

  if (lower.includes('email already exists')) {
    return { error: null, fieldErrors: { email: 'That email already has an account. Go back and continue with it.' } };
  }
  if (lower.includes('license number is already registered')) {
    return { error: null, fieldErrors: { license: message } };
  }
  if (lower.includes('pmdc') || lower.includes('license')) {
    return { error: null, fieldErrors: { license: message } };
  }
  if (lower.includes('invalid credentials')) {
    return { error: null, fieldErrors: { password: 'That password is not right. Try again, or reset it below.' } };
  }
  if (lower.includes('otp') || lower.includes('code')) {
    return { error: null, fieldErrors: { otp: message } };
  }
  // Policy failures ("at least 8 characters", "not all numbers", "too common")
  // belong under the password box on whichever screen is asking for one.
  if (lower.includes('password')) {
    return { error: null, fieldErrors: { password: message } };
  }
  if (err.status === 0) {
    return { error: 'Cannot reach the server. Check your connection and try again.', fieldErrors: {} };
  }

  // A 400/422 is always about something typed on THIS screen, so hang it on
  // that screen's primary control rather than in a banner the eye skips.
  const primaryControl = { email: 'email', password: 'password', otp: 'otp', newPassword: 'password' }[scope];
  if (err.isValidationError && primaryControl) {
    return { error: null, fieldErrors: { [primaryControl]: message } };
  }

  return { error: message, fieldErrors: {} };
}

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

/**
 * @param {object} options
 * @param {() => Promise<any>} [options.rehydrate] AuthContext's rehydrate, used
 *   to seat the session once a token bundle arrives.
 * @param {(result:{user:object, homeRoute:string, session:object|null}) => void} [options.onAuthenticated]
 *   Called exactly once when the flow reaches DONE. AuthPage navigates here.
 * @param {string} [options.initialEmail] Prefill (e.g. `?email=` on the URL).
 * @param {boolean} [options.resume=true] Restore a persisted in-flight flow.
 */
export function useAuthMachine(options = {}) {
  const { rehydrate, onAuthenticated, initialEmail = '', resume = true } = options;

  const [state, dispatch] = useReducer(
    reducer,
    { initialEmail, resume },
    (init) => {
      const snapshot = init.resume ? readFlowSnapshot() : null;
      if (snapshot) return stateFromSnapshot(snapshot);
      return initialMachineState(init.initialEmail ? { email: init.initialEmail } : {});
    },
  );

  const alive = useRef(true);
  // The `alive.current = true` line is NOT redundant. StrictMode mounts,
  // unmounts and remounts every component in development: the cleanup below
  // runs on that simulated unmount and sets the flag false, and without
  // restoring it here the second mount leaves it false FOREVER -- so `send()`
  // silently drops every action and the form never leaves the email step even
  // though the request returned 200. useRef's initial value only applies to
  // the first mount, which is exactly why this looked correct.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  /** Never dispatch into an unmounted tree (every action is async). */
  const send = useCallback((action) => {
    if (alive.current) dispatch(action);
  }, []);

  // -- persistence -----------------------------------------------------------
  useEffect(() => {
    if (state.step === STATES.EMAIL || state.step === STATES.DONE) {
      clearFlowSnapshot();
      return;
    }
    if (!RESUMABLE.has(state.step) || !state.email) return;
    storage.sessionStore.set(FLOW_KEY, snapshotOf(state));
  }, [state]);

  // -- the one place a session is seated ------------------------------------
  const finish = useCallback(async (bundle) => {
    const result = await authApi.establishSession(bundle, { rehydrate });

    if (authApi.isDoctorAwaitingApproval(bundle)) {
      // The doctor IS signed in — they simply cannot review cases yet. Showing
      // the explainer beats dropping them on a dashboard full of empty states.
      send({ type: 'GO', step: STATES.DOCTOR_PENDING, patch: { result } });
      clearFlowSnapshot();
      return result;
    }

    send({ type: 'GO', step: STATES.DONE, patch: { result } });
    clearFlowSnapshot();
    onAuthenticated?.(result);
    return result;
  }, [onAuthenticated, rehydrate, send]);

  // -- EMAIL -----------------------------------------------------------------
  const submitEmail = useCallback(async (rawEmail) => {
    const email = String(rawEmail || '').trim();
    if (!email) {
      send({ type: 'FAIL', fieldErrors: { email: 'Enter your email address.' } });
      return;
    }
    if (!isEmailShaped(email)) {
      send({ type: 'FAIL', fieldErrors: { email: 'That does not look like an email address.' } });
      return;
    }

    send({ type: 'BUSY' });
    try {
      const answer = await authApi.checkEmail(email);
      const step = stateForCheckEmail(answer);
      send({
        type: 'GO',
        step,
        patch: {
          email,
          emailStatus: answer?.status || null,
          otpPurpose: authApi.OTP_PURPOSE.SIGNUP,
          otpWrongAttempts: 0,
          // An account that exists but was never verified already had a code
          // mailed to it; the resend button must be usable immediately, because
          // that code is very likely expired.
          resendAvailableAt: 0,
        },
        notice: step === STATES.OTP_SIGNUP
          ? 'This email is registered but was never verified. Enter the code we sent, or request a new one.'
          : null,
      });
    } catch (err) {
      const described = describeError(err, { scope: 'email' });
      send({ type: 'FAIL', ...described });
    }
  }, [send]);

  // -- PASSWORD --------------------------------------------------------------
  const submitPassword = useCallback(async (password) => {
    if (!password) {
      send({ type: 'FAIL', fieldErrors: { password: 'Enter your password.' } });
      return;
    }

    send({ type: 'BUSY' });
    try {
      const bundle = await authApi.login({ email: state.email, password });
      await finish(bundle);
    } catch (err) {
      // 403 + data.next==='otp': a real account whose inbox was never confirmed.
      // The old page dead-ended here with a toast; jump to the OTP screen.
      if (err instanceof ApiError && err.status === 403 && err.data?.next === 'otp') {
        send({
          type: 'GO',
          step: STATES.OTP_SIGNUP,
          patch: {
            otpPurpose: authApi.OTP_PURPOSE.SIGNUP,
            otpWrongAttempts: 0,
            resendAvailableAt: 0,
          },
          notice: 'Your email is not verified yet. Enter the code we sent you, or request a new one.',
        });
        return;
      }
      send({ type: 'FAIL', ...describeError(err, { scope: 'password' }) });
    }
  }, [finish, send, state.email]);

  // -- SIGNUP ----------------------------------------------------------------
  /**
   * @param {{name:string, password:string, isDoctor:boolean,
   *   doctor?:object, consents?:Array<object>}} values
   */
  const submitSignup = useCallback(async (values) => {
    const name = String(values?.name || '').trim();
    const password = values?.password || '';
    const isDoctor = Boolean(values?.isDoctor);

    const fieldErrors = {};
    if (!name) fieldErrors.name = 'Enter your full name.';
    const policy = checkPasswordPolicy(password);
    if (!policy.ok) fieldErrors.password = policy.error;
    if (Object.keys(fieldErrors).length) {
      send({ type: 'FAIL', fieldErrors });
      return;
    }

    send({ type: 'BUSY' });
    try {
      await authApi.register({
        name,
        email: state.email,
        password,
        role: isDoctor ? authApi.ROLE_DOCTOR : authApi.ROLE_PATIENT,
        doctor: isDoctor ? (values.doctor || {}) : undefined,
        consents: Array.isArray(values?.consents) ? values.consents : [],
      });
      send({
        type: 'GO',
        step: STATES.OTP_SIGNUP,
        patch: {
          name,
          isDoctor,
          otpPurpose: authApi.OTP_PURPOSE.SIGNUP,
          otpWrongAttempts: 0,
          resendAvailableAt: Date.now() + authApi.OTP_RESEND_COOLDOWN_SECONDS * 1000,
        },
      });
    } catch (err) {
      send({ type: 'FAIL', ...describeError(err, { scope: 'signup' }) });
    }
  }, [send, state.email]);

  // -- OTP (both purposes) ---------------------------------------------------
  const submitOtp = useCallback(async (rawCode) => {
    const otp = String(rawCode || '').replace(/\D/g, '');
    if (otp.length !== 6) {
      send({ type: 'FAIL', fieldErrors: { otp: 'Enter the 6-digit code from your email.' } });
      return;
    }

    send({ type: 'BUSY' });
    try {
      const payload = await authApi.verifyOtp({
        email: state.email,
        otp,
        purpose: state.otpPurpose,
      });

      if (state.otpPurpose === authApi.OTP_PURPOSE.RESET) {
        // Validated, NOT consumed — /auth/reset-password still needs the code.
        send({
          type: 'GO',
          step: STATES.RESET_PASSWORD,
          patch: { otpCode: otp, otpWrongAttempts: 0 },
        });
        return;
      }

      await finish(payload);
    } catch (err) {
      const described = describeError(err, { scope: 'otp' });
      const message = err instanceof ApiError ? err.message.toLowerCase() : '';
      const lockedOut = message.includes('too many');
      send({
        type: 'FAIL',
        ...described,
        patch: {
          otpWrongAttempts: lockedOut
            ? authApi.OTP_MAX_ATTEMPTS
            : Math.min(authApi.OTP_MAX_ATTEMPTS, state.otpWrongAttempts + 1),
        },
      });
    }
  }, [finish, send, state.email, state.otpPurpose, state.otpWrongAttempts]);

  const resendOtp = useCallback(async () => {
    if (Date.now() < state.resendAvailableAt) return;

    send({ type: 'BUSY' });
    try {
      await authApi.resendOtp({ email: state.email, purpose: state.otpPurpose });
      send({
        type: 'PATCH',
        patch: {
          busy: false,
          otpWrongAttempts: 0,
          resendAvailableAt: Date.now() + authApi.OTP_RESEND_COOLDOWN_SECONDS * 1000,
          error: null,
          fieldErrors: {},
          notice: `A new code is on its way to ${state.email}.`,
        },
      });
    } catch (err) {
      const seconds = err instanceof ApiError
        ? authApi.secondsFromCooldownMessage(err.message)
        : null;

      // Already verified in another tab, or by the reset flow. Not an error —
      // it just means the right screen is now the password one.
      if (err instanceof ApiError && err.message.toLowerCase().includes('already verified')) {
        send({
          type: 'GO',
          step: STATES.PASSWORD,
          replace: true,
          notice: 'This account is already verified. Enter your password to sign in.',
        });
        return;
      }

      send({
        type: 'FAIL',
        ...describeError(err, { scope: 'otp' }),
        patch: seconds ? { resendAvailableAt: Date.now() + seconds * 1000 } : {},
      });
    }
  }, [send, state.email, state.otpPurpose, state.resendAvailableAt]);

  // -- RESET -----------------------------------------------------------------
  const requestReset = useCallback(async (rawEmail) => {
    const email = String(rawEmail || state.email || '').trim();
    if (!isEmailShaped(email)) {
      send({ type: 'FAIL', fieldErrors: { email: 'Enter the email on your account.' } });
      return;
    }

    send({ type: 'BUSY' });
    try {
      await authApi.forgotPassword(email);
      send({
        type: 'GO',
        step: STATES.OTP_RESET,
        patch: {
          email,
          otpPurpose: authApi.OTP_PURPOSE.RESET,
          otpWrongAttempts: 0,
          otpCode: '',
          resendAvailableAt: Date.now() + authApi.OTP_RESEND_COOLDOWN_SECONDS * 1000,
        },
        notice: `If ${email} has an account, a 6-digit reset code is on its way.`,
      });
    } catch (err) {
      // 429 means a code went out moments ago — advancing is more useful than
      // refusing, so long as the countdown reflects the server's number.
      const seconds = err instanceof ApiError
        ? authApi.secondsFromCooldownMessage(err.message)
        : null;
      if (seconds) {
        send({
          type: 'GO',
          step: STATES.OTP_RESET,
          patch: {
            email,
            otpPurpose: authApi.OTP_PURPOSE.RESET,
            otpWrongAttempts: 0,
            otpCode: '',
            resendAvailableAt: Date.now() + seconds * 1000,
          },
          notice: 'A reset code was already sent. Enter it below, or wait for the timer to request another.',
        });
        return;
      }
      send({ type: 'FAIL', ...describeError(err, { scope: 'email' }) });
    }
  }, [send, state.email]);

  const submitNewPassword = useCallback(async (password) => {
    const policy = checkPasswordPolicy(password);
    if (!policy.ok) {
      send({ type: 'FAIL', fieldErrors: { password: policy.error } });
      return;
    }

    send({ type: 'BUSY' });
    try {
      await authApi.resetPassword({ email: state.email, otp: state.otpCode, password });
    } catch (err) {
      const described = describeError(err, { scope: 'newPassword' });
      // The code died between validating and using it (expired, or spent in
      // another tab). Send them back one step rather than into a dead form.
      if (described.fieldErrors.otp) {
        send({
          type: 'GO',
          step: STATES.OTP_RESET,
          replace: true,
          patch: { otpCode: '', otpWrongAttempts: 0 },
          error: described.fieldErrors.otp,
        });
        return;
      }
      send({ type: 'FAIL', ...described });
      return;
    }

    // The password is known and valid, so sign in rather than making the user
    // type it a third time. The reset revoked every old session server-side, so
    // this is a genuinely fresh one.
    try {
      const bundle = await authApi.login({ email: state.email, password });
      await finish(bundle);
    } catch {
      send({
        type: 'GO',
        step: STATES.PASSWORD,
        replace: true,
        patch: { otpCode: '', otpPurpose: authApi.OTP_PURPOSE.SIGNUP },
        notice: 'Your password has been updated. Sign in with it now.',
      });
    }
  }, [finish, send, state.email, state.otpCode]);

  // -- navigation ------------------------------------------------------------
  const back = useCallback(() => send({ type: 'BACK' }), [send]);

  const changeEmail = useCallback(() => {
    clearFlowSnapshot();
    send({ type: 'RESTART', keepEmail: true });
  }, [send]);

  const restart = useCallback(() => {
    clearFlowSnapshot();
    send({ type: 'RESTART' });
  }, [send]);

  const goToReset = useCallback(() => {
    send({ type: 'GO', step: STATES.RESET_REQUEST });
  }, [send]);

  const dismissError = useCallback(() => send({ type: 'DISMISS_ERROR' }), [send]);

  const actions = useMemo(() => ({
    back,
    changeEmail,
    dismissError,
    goToReset,
    requestReset,
    resendOtp,
    restart,
    submitEmail,
    submitNewPassword,
    submitOtp,
    submitPassword,
    submitSignup,
  }), [
    back, changeEmail, dismissError, goToReset, requestReset, resendOtp,
    restart, submitEmail, submitNewPassword, submitOtp, submitPassword, submitSignup,
  ]);

  const canGoBack = state.history.length > 0;
  const attemptsRemaining = Math.max(0, authApi.OTP_MAX_ATTEMPTS - state.otpWrongAttempts);

  return { state, actions, canGoBack, attemptsRemaining, dispatch: send };
}

export default useAuthMachine;
