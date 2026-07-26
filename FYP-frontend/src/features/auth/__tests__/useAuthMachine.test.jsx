/**
 * The transitions that used to be bugs.
 *
 * Fast by design: the reducer and the routing helpers are pure, so most of this
 * file needs no DOM at all. The three hook tests that DO render use a bare
 * `renderHook` with a mocked `authApi`, so nothing here touches the network.
 */

import { StrictMode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '../../../lib/api';
import * as storage from '../../../lib/storage';

vi.mock('../authApi', async () => {
  const actual = await vi.importActual('../authApi');
  return {
    ...actual,
    checkEmail: vi.fn(),
    login: vi.fn(),
    register: vi.fn(),
    verifyOtp: vi.fn(),
    resendOtp: vi.fn(),
    forgotPassword: vi.fn(),
    resetPassword: vi.fn(),
    establishSession: vi.fn(),
  };
});

import * as authApi from '../authApi';
import { checkPasswordPolicy, scorePassword } from '../passwordStrength';
import useAuthMachine, {
  FLOW_KEY,
  STATES,
  clearFlowSnapshot,
  describeError,
  initialMachineState,
  isEmailShaped,
  reducer,
  stateForCheckEmail,
} from '../useAuthMachine';

const EMAIL = 'demo.patient@aiderma.local';

beforeEach(() => {
  vi.clearAllMocks();
  clearFlowSnapshot();
});

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

describe('stateForCheckEmail', () => {
  it('opens the three doors /auth/check-email describes', () => {
    expect(stateForCheckEmail({ status: 'new', next: 'signup' })).toBe(STATES.SIGNUP);
    expect(stateForCheckEmail({ status: 'unverified', next: 'otp' })).toBe(STATES.OTP_SIGNUP);
    expect(stateForCheckEmail({ status: 'existing', next: 'password' })).toBe(STATES.PASSWORD);
  });

  it('falls back to status when `next` is missing, and to SIGNUP when both are', () => {
    expect(stateForCheckEmail({ status: 'existing' })).toBe(STATES.PASSWORD);
    expect(stateForCheckEmail({})).toBe(STATES.SIGNUP);
    expect(stateForCheckEmail(null)).toBe(STATES.SIGNUP);
  });
});

describe('isEmailShaped', () => {
  it.each([
    ['a@b.co', true],
    ['demo.doctor@aiderma.local', true],
    ['no-at-sign', false],
    ['spaces @b.co', false],
    ['trailing@dot.', false],
    ['', false],
  ])('%s -> %s', (value, expected) => {
    expect(isEmailShaped(value)).toBe(expected);
  });
});

describe('checkPasswordPolicy mirrors the server', () => {
  it.each([
    ['', false],
    ['short1', false],
    ['12345678', false],   // all numeric
    ['password', false],   // common
    ['PASSWORD', false],   // common, case-insensitively
    ['DemoPass123!', true],
  ])('%s -> ok=%s', (value, ok) => {
    expect(checkPasswordPolicy(value).ok).toBe(ok);
  });

  it('scores advisory strength but never blocks a policy-compliant password', () => {
    expect(scorePassword('').percent).toBe(0);
    expect(scorePassword('aaaaaaaa').policy.ok).toBe(true);
    expect(scorePassword('Str0ng&Longer1').score).toBeGreaterThan(scorePassword('aaaaaaaa').score);
  });
});

describe('reducer', () => {
  it('BUSY clears both error channels so a stale failure cannot sit under a spinner', () => {
    const start = { ...initialMachineState(), error: 'old', fieldErrors: { email: 'old' } };
    const next = reducer(start, { type: 'BUSY' });
    expect(next).toMatchObject({ busy: true, error: null, fieldErrors: {} });
  });

  it('GO pushes the previous state onto history and clears field errors', () => {
    const start = { ...initialMachineState(), fieldErrors: { email: 'nope' } };
    const next = reducer(start, { type: 'GO', step: STATES.PASSWORD, patch: { email: EMAIL } });
    expect(next.step).toBe(STATES.PASSWORD);
    expect(next.history).toEqual([STATES.EMAIL]);
    expect(next.fieldErrors).toEqual({});
    expect(next.email).toBe(EMAIL);
  });

  it('GO with `replace` does NOT become a Back destination', () => {
    const start = { ...initialMachineState(), step: STATES.RESET_PASSWORD, history: [STATES.EMAIL] };
    const next = reducer(start, { type: 'GO', step: STATES.OTP_RESET, replace: true });
    expect(next.history).toEqual([STATES.EMAIL]);
  });

  it('BACK pops history, and lands on EMAIL when there is none', () => {
    const withHistory = { ...initialMachineState(), step: STATES.PASSWORD, history: [STATES.EMAIL] };
    expect(reducer(withHistory, { type: 'BACK' })).toMatchObject({ step: STATES.EMAIL, history: [] });
    expect(reducer({ ...initialMachineState(), step: STATES.OTP_RESET }, { type: 'BACK' }).step)
      .toBe(STATES.EMAIL);
  });

  it('rejects an unknown state rather than rendering nothing', () => {
    const start = initialMachineState();
    expect(reducer(start, { type: 'GO', step: 'NOT_A_STATE' })).toBe(start);
  });

  it('RESTART can keep the email (change-of-mind) or drop it (start over)', () => {
    const start = { ...initialMachineState(), step: STATES.OTP_SIGNUP, email: EMAIL, name: 'Ayesha' };
    expect(reducer(start, { type: 'RESTART', keepEmail: true })).toMatchObject({
      step: STATES.EMAIL, email: EMAIL, name: '',
    });
    expect(reducer(start, { type: 'RESTART' }).email).toBe('');
  });
});

describe('describeError', () => {
  it('hangs "Email already exists" on the email field, not in a banner', () => {
    const result = describeError(new ApiError(400, 'Email already exists'));
    expect(result.error).toBeNull();
    expect(result.fieldErrors.email).toMatch(/already has an account/i);
  });

  it('turns a 401 into a password-field error with a route out', () => {
    const result = describeError(new ApiError(401, 'Invalid credentials'), { scope: 'password' });
    expect(result.fieldErrors.password).toMatch(/reset it/i);
  });

  it('names the missing consents the server rejected', () => {
    const err = new ApiError(400, 'You must accept the required agreements to create an account.', {
      success: false,
      data: { missing_consents: ['terms_of_use', 'license_attestation'] },
    });
    expect(describeError(err).fieldErrors.consents).toMatch(/required agreements/i);
  });

  it('reports a transport failure as a banner, not as a bad password', () => {
    const result = describeError(new ApiError(0, 'boom'), { scope: 'password' });
    expect(result.fieldErrors).toEqual({});
    expect(result.error).toMatch(/cannot reach the server/i);
  });
});

// ---------------------------------------------------------------------------
// The hook
// ---------------------------------------------------------------------------

describe('useAuthMachine transitions', () => {
  it('EMAIL -> PASSWORD for an existing address', async () => {
    authApi.checkEmail.mockResolvedValue({ status: 'existing', next: 'password' });
    const { result } = renderHook(() => useAuthMachine());

    await act(async () => { await result.current.actions.submitEmail(EMAIL); });

    expect(result.current.state.step).toBe(STATES.PASSWORD);
    expect(result.current.state.email).toBe(EMAIL);
    expect(result.current.state.busy).toBe(false);
  });

  it('still transitions under StrictMode (regression: dropped dispatches)', async () => {
    // THE BUG THIS PINS DOWN, reported from a real browser: "I enter email, I
    // get 200, but the screen won't go to the next step."
    //
    // The hook gates every dispatch on an `alive` ref so it cannot setState
    // after unmount. The ref was armed by useRef(true) and disarmed in an
    // effect cleanup -- but never RE-armed in the effect body. StrictMode
    // mounts, unmounts and remounts in development, so the cleanup fired once
    // and left the ref false for the rest of the session: the request ran, the
    // response arrived, and the reducer was never told. useRef's initial value
    // only applies to the first mount, which is why this read as correct.
    //
    // Every other test here uses a bare renderHook, which never simulates the
    // double-mount, so 153 green tests said nothing about it. Wrapping in
    // StrictMode is the whole point of this case -- do not remove it.
    authApi.checkEmail.mockResolvedValue({ status: 'existing', next: 'password' });
    const { result } = renderHook(() => useAuthMachine(), { wrapper: StrictMode });

    await act(async () => { await result.current.actions.submitEmail(EMAIL); });

    expect(result.current.state.step).toBe(STATES.PASSWORD);
    expect(result.current.state.busy).toBe(false);
  });

  it('EMAIL -> SIGNUP for a new address', async () => {
    authApi.checkEmail.mockResolvedValue({ status: 'new', next: 'signup' });
    const { result } = renderHook(() => useAuthMachine());

    await act(async () => { await result.current.actions.submitEmail('brand.new@aiderma.local'); });

    expect(result.current.state.step).toBe(STATES.SIGNUP);
  });

  it('never calls the API for a malformed address', async () => {
    const { result } = renderHook(() => useAuthMachine());

    await act(async () => { await result.current.actions.submitEmail('not-an-email'); });

    expect(authApi.checkEmail).not.toHaveBeenCalled();
    expect(result.current.state.step).toBe(STATES.EMAIL);
    expect(result.current.state.fieldErrors.email).toBeTruthy();
  });

  it('PASSWORD -> OTP_SIGNUP on the 403 that means "verify your email first"', async () => {
    authApi.checkEmail.mockResolvedValue({ status: 'existing', next: 'password' });
    authApi.login.mockRejectedValue(new ApiError(403, 'Please verify your email first', {
      success: false,
      data: { next: 'otp', otp_purpose: 'signup', email: EMAIL },
    }));

    const { result } = renderHook(() => useAuthMachine());
    await act(async () => { await result.current.actions.submitEmail(EMAIL); });
    await act(async () => { await result.current.actions.submitPassword('DemoPass123!'); });

    expect(result.current.state.step).toBe(STATES.OTP_SIGNUP);
    expect(result.current.state.notice).toMatch(/not verified/i);
    // The resend button must be usable immediately — the old code is likely dead.
    expect(result.current.state.resendAvailableAt).toBe(0);
  });

  it('PASSWORD stays put on a wrong password and surfaces it on the field', async () => {
    authApi.checkEmail.mockResolvedValue({ status: 'existing', next: 'password' });
    authApi.login.mockRejectedValue(new ApiError(401, 'Invalid credentials'));

    const { result } = renderHook(() => useAuthMachine());
    await act(async () => { await result.current.actions.submitEmail(EMAIL); });
    await act(async () => { await result.current.actions.submitPassword('wrong'); });

    expect(result.current.state.step).toBe(STATES.PASSWORD);
    expect(result.current.state.fieldErrors.password).toBeTruthy();
    expect(result.current.state.busy).toBe(false);
  });

  it('PASSWORD -> DONE seats the session and reports the backend home_route', async () => {
    const bundle = {
      token: 't',
      user: { id: 7, name: 'Ayesha', role: 'AI User' },
      session: { home_route: '/my-reports' },
    };
    authApi.checkEmail.mockResolvedValue({ status: 'existing', next: 'password' });
    authApi.login.mockResolvedValue(bundle);
    authApi.establishSession.mockResolvedValue({
      user: bundle.user, homeRoute: '/my-reports', session: bundle.session,
    });

    const onAuthenticated = vi.fn();
    const rehydrate = vi.fn().mockResolvedValue(true);
    const { result } = renderHook(() => useAuthMachine({ onAuthenticated, rehydrate }));

    await act(async () => { await result.current.actions.submitEmail(EMAIL); });
    await act(async () => { await result.current.actions.submitPassword('DemoPass123!'); });

    expect(result.current.state.step).toBe(STATES.DONE);
    expect(authApi.establishSession).toHaveBeenCalledWith(bundle, { rehydrate });
    expect(onAuthenticated).toHaveBeenCalledWith(
      expect.objectContaining({ homeRoute: '/my-reports' }),
    );
  });

  it('SIGNUP -> OTP_SIGNUP and starts the resend cooldown', async () => {
    authApi.checkEmail.mockResolvedValue({ status: 'new', next: 'signup' });
    authApi.register.mockResolvedValue({ email: EMAIL, role: 'AI User', next: 'otp' });

    const { result } = renderHook(() => useAuthMachine());
    await act(async () => { await result.current.actions.submitEmail(EMAIL); });
    await act(async () => {
      await result.current.actions.submitSignup({
        name: 'Ayesha Khan',
        password: 'DemoPass123!',
        isDoctor: false,
        consents: [{ type: 'terms_of_use', version: '1', granted: true }],
      });
    });

    expect(result.current.state.step).toBe(STATES.OTP_SIGNUP);
    expect(result.current.state.resendAvailableAt).toBeGreaterThan(Date.now());
    expect(authApi.register).toHaveBeenCalledWith(expect.objectContaining({
      email: EMAIL, role: 'AI User',
    }));
  });

  it('SIGNUP refuses a policy-violating password without a round-trip', async () => {
    authApi.checkEmail.mockResolvedValue({ status: 'new', next: 'signup' });
    const { result } = renderHook(() => useAuthMachine());
    await act(async () => { await result.current.actions.submitEmail(EMAIL); });

    await act(async () => {
      await result.current.actions.submitSignup({ name: 'A', password: '1234', isDoctor: false });
    });

    expect(authApi.register).not.toHaveBeenCalled();
    expect(result.current.state.step).toBe(STATES.SIGNUP);
    expect(result.current.state.fieldErrors.password).toMatch(/8 characters/i);
  });

  it('signs a doctor in but parks them on DOCTOR_PENDING', async () => {
    const bundle = {
      token: 't',
      user: { id: 9, name: 'Dr Khan', role: 'Doctor', verification_status: 'pending' },
      session: { home_route: '/doctor-dashboard' },
    };
    authApi.checkEmail.mockResolvedValue({ status: 'unverified', next: 'otp' });
    authApi.verifyOtp.mockResolvedValue(bundle);
    authApi.establishSession.mockResolvedValue({
      user: bundle.user, homeRoute: '/doctor-dashboard', session: bundle.session,
    });

    const onAuthenticated = vi.fn();
    const { result } = renderHook(() => useAuthMachine({ onAuthenticated }));
    await act(async () => { await result.current.actions.submitEmail(EMAIL); });
    await act(async () => { await result.current.actions.submitOtp('123456'); });

    expect(result.current.state.step).toBe(STATES.DOCTOR_PENDING);
    // Parked, not navigated: the container must not bounce them to a dashboard.
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it('counts OTP attempts down and pins them at zero on the server lockout', async () => {
    authApi.checkEmail.mockResolvedValue({ status: 'unverified', next: 'otp' });
    authApi.verifyOtp.mockRejectedValueOnce(new ApiError(400, 'Invalid OTP'));

    const { result } = renderHook(() => useAuthMachine());
    await act(async () => { await result.current.actions.submitEmail(EMAIL); });
    await act(async () => { await result.current.actions.submitOtp('000000'); });

    expect(result.current.attemptsRemaining).toBe(4);
    expect(result.current.state.fieldErrors.otp).toBe('Invalid OTP');

    authApi.verifyOtp.mockRejectedValueOnce(
      new ApiError(400, 'Too many incorrect attempts. Please request a new OTP.'),
    );
    await act(async () => { await result.current.actions.submitOtp('111111'); });
    expect(result.current.attemptsRemaining).toBe(0);
  });

  it('rejects a code that is not six digits without calling the API', async () => {
    authApi.checkEmail.mockResolvedValue({ status: 'unverified', next: 'otp' });
    const { result } = renderHook(() => useAuthMachine());
    await act(async () => { await result.current.actions.submitEmail(EMAIL); });

    await act(async () => { await result.current.actions.submitOtp('123'); });

    expect(authApi.verifyOtp).not.toHaveBeenCalled();
    expect(result.current.state.fieldErrors.otp).toBeTruthy();
  });

  it('RESET_REQUEST -> OTP_RESET -> RESET_PASSWORD -> DONE', async () => {
    authApi.forgotPassword.mockResolvedValue({ next: 'otp', otp_purpose: 'reset' });
    authApi.verifyOtp.mockResolvedValue({ verified: true, next: 'new_password' });
    authApi.resetPassword.mockResolvedValue({ next: 'password' });
    const bundle = { token: 't', user: { id: 3, role: 'AI User' }, session: { home_route: '/my-reports' } };
    authApi.login.mockResolvedValue(bundle);
    authApi.establishSession.mockResolvedValue({
      user: bundle.user, homeRoute: '/my-reports', session: bundle.session,
    });

    const { result } = renderHook(() => useAuthMachine());

    await act(async () => { await result.current.actions.requestReset(EMAIL); });
    expect(result.current.state.step).toBe(STATES.OTP_RESET);
    expect(result.current.state.otpPurpose).toBe('reset');

    await act(async () => { await result.current.actions.submitOtp('654321'); });
    expect(result.current.state.step).toBe(STATES.RESET_PASSWORD);
    // Validated, NOT consumed: the code has to survive to /auth/reset-password.
    expect(result.current.state.otpCode).toBe('654321');

    await act(async () => { await result.current.actions.submitNewPassword('BrandNewPass9!'); });
    expect(authApi.resetPassword).toHaveBeenCalledWith({
      email: EMAIL, otp: '654321', password: 'BrandNewPass9!',
    });
    expect(result.current.state.step).toBe(STATES.DONE);
  });

  it('falls back to the password screen when the post-reset auto sign-in fails', async () => {
    authApi.forgotPassword.mockResolvedValue({});
    authApi.verifyOtp.mockResolvedValue({ verified: true });
    authApi.resetPassword.mockResolvedValue({});
    authApi.login.mockRejectedValue(new ApiError(500, 'nope'));

    const { result } = renderHook(() => useAuthMachine());
    await act(async () => { await result.current.actions.requestReset(EMAIL); });
    await act(async () => { await result.current.actions.submitOtp('654321'); });
    await act(async () => { await result.current.actions.submitNewPassword('BrandNewPass9!'); });

    expect(result.current.state.step).toBe(STATES.PASSWORD);
    expect(result.current.state.notice).toMatch(/updated/i);
  });

  it('advances to OTP_RESET on a 429 and takes the countdown from the server message', async () => {
    authApi.forgotPassword.mockRejectedValue(
      new ApiError(429, 'Please wait 31s before requesting another OTP.'),
    );

    const { result } = renderHook(() => useAuthMachine());
    await act(async () => { await result.current.actions.requestReset(EMAIL); });

    expect(result.current.state.step).toBe(STATES.OTP_RESET);
    const secondsLeft = Math.round((result.current.state.resendAvailableAt - Date.now()) / 1000);
    expect(secondsLeft).toBeGreaterThan(25);
    expect(secondsLeft).toBeLessThanOrEqual(31);
  });
});

// ---------------------------------------------------------------------------
// Persistence — the refresh-on-OTP bug
// ---------------------------------------------------------------------------

describe('flow persistence', () => {
  it('restores the OTP screen after a refresh instead of bricking the account', async () => {
    authApi.checkEmail.mockResolvedValue({ status: 'unverified', next: 'otp' });

    const first = renderHook(() => useAuthMachine());
    await act(async () => { await first.result.current.actions.submitEmail(EMAIL); });
    expect(first.result.current.state.step).toBe(STATES.OTP_SIGNUP);
    first.unmount();

    // A brand-new hook is exactly what a browser refresh produces.
    const second = renderHook(() => useAuthMachine());
    await waitFor(() => {
      expect(second.result.current.state.step).toBe(STATES.OTP_SIGNUP);
    });
    expect(second.result.current.state.email).toBe(EMAIL);
  });

  it('never writes a password into the snapshot', async () => {
    authApi.checkEmail.mockResolvedValue({ status: 'new', next: 'signup' });
    authApi.register.mockResolvedValue({});

    const { result } = renderHook(() => useAuthMachine());
    await act(async () => { await result.current.actions.submitEmail(EMAIL); });
    await act(async () => {
      await result.current.actions.submitSignup({
        name: 'Ayesha', password: 'SuperSecret123!', isDoctor: false, consents: [],
      });
    });

    const raw = JSON.stringify(storage.sessionStore.get(FLOW_KEY, {}));
    expect(raw).not.toContain('SuperSecret123!');
    expect(raw).toContain(EMAIL);
  });

  it('drops the snapshot once the flow reaches DONE', async () => {
    const bundle = { token: 't', user: { id: 1, role: 'AI User' }, session: {} };
    authApi.checkEmail.mockResolvedValue({ status: 'existing', next: 'password' });
    authApi.login.mockResolvedValue(bundle);
    authApi.establishSession.mockResolvedValue({ user: bundle.user, homeRoute: '/', session: null });

    const { result } = renderHook(() => useAuthMachine());
    await act(async () => { await result.current.actions.submitEmail(EMAIL); });
    await act(async () => { await result.current.actions.submitPassword('DemoPass123!'); });

    expect(storage.sessionStore.get(FLOW_KEY, null)).toBeNull();
  });
});
