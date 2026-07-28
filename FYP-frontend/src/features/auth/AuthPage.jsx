/**
 * AuthPage — the ONE auth route.
 *
 * It replaces `/login` (637 lines, three role tabs) and `/register` (832 lines,
 * two more tabs) with a single email-first machine. Mount it at `/login`; point
 * `/register` and `/auth` at the same component if you want those URLs to keep
 * resolving (nothing in the flow reads the pathname beyond the `mode` copy
 * hint).
 *
 * WHAT THIS CONTAINER OWNS, AND NOTHING ELSE
 * ------------------------------------------
 *  - the frame (AuthShell) and which step renders inside it
 *  - `returnTo` resolution, including refusing an off-site one
 *  - the "already signed in" short-circuit
 *  - navigating on success, to the home_route the BACKEND chose
 *
 * Everything stateful is in `useAuthMachine`; everything network is in
 * `authApi`. This file has no fetch, no URL string and no `localStorage`.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';

import { Spinner } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';

import { doctorVerificationStatus } from './authApi';
import { resolveReturnTo } from './returnTo';
import AuthShell from './components/AuthShell';
import DoctorPendingStep from './steps/DoctorPendingStep';
import EmailStep from './steps/EmailStep';
import OtpStep from './steps/OtpStep';
import PasswordStep from './steps/PasswordStep';
import ResetPasswordStep from './steps/ResetPasswordStep';
import ResetRequestStep from './steps/ResetRequestStep';
import SignupDetailsStep from './steps/SignupDetailsStep';
import useAuthMachine, { STATES } from './useAuthMachine';

/** Title + subtitle per state. Copy lives here so the steps stay reusable. */
function copyFor(step, { mode, email }) {
  switch (step) {
    case STATES.PASSWORD:
      return {
        title: 'Welcome back',
        subtitle: 'Enter your password to continue.',
      };
    case STATES.SIGNUP:
      return {
        title: 'Create your account',
        subtitle: 'One account covers everything, patients and doctors alike.',
      };
    case STATES.OTP_SIGNUP:
      return {
        title: 'Confirm your email',
        subtitle: `We sent a 6-digit code to ${email}.`,
      };
    case STATES.RESET_REQUEST:
      return {
        title: 'Reset your password',
        subtitle: 'We will email you a code to set a new one.',
      };
    case STATES.OTP_RESET:
      return {
        title: 'Enter your reset code',
        subtitle: `We sent a 6-digit code to ${email}.`,
      };
    case STATES.RESET_PASSWORD:
      return {
        title: 'Choose a new password',
        subtitle: 'Your code is confirmed. Pick something you have not used here before.',
      };
    case STATES.DOCTOR_PENDING:
      return {
        title: 'You are in: licence check pending',
        subtitle: 'Here is what happens next.',
      };
    case STATES.DONE:
      return { title: 'Signing you in…', subtitle: null };
    case STATES.EMAIL:
    default:
      return {
        title: mode === 'signup' ? 'Create your account' : 'Sign in or create an account',
        subtitle: 'Start with your email and we will take it from there. No need to pick a role.',
      };
  }
}

/**
 * @param {object} props
 * @param {'signin'|'signup'} [props.mode='signin'] Copy hint only; the flow is
 *   identical either way. Pass 'signup' when mounting this at `/register`.
 */
export default function AuthPage({ mode = 'signin' }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const returnTo = useMemo(() => resolveReturnTo(location), [location]);
  const initialEmail = useMemo(
    () => new URLSearchParams(location?.search || '').get('email') || '',
    [location],
  );

  /** Was there already a live session when this page first rendered? Captured
   *  once — as state, not a ref, because it is READ during render — so that
   *  finishing a sign-in here does not race the redirect below. */
  const [wasAuthedOnMount] = useState(() => auth.status === 'authed');

  const onAuthenticated = useCallback((result) => {
    navigate(returnTo || result?.homeRoute || '/', { replace: true });
  }, [navigate, returnTo]);

  const { state, actions, canGoBack, attemptsRemaining } = useAuthMachine({
    rehydrate: auth.rehydrate,
    onAuthenticated,
    initialEmail,
  });

  /** Sign out and hand the screen back to the email step. The licence-pending
   *  screen is the one signed-in state this page renders, so it is the one
   *  place someone can be looking at an account they do not want to be in. */
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const useAnotherAccount = useCallback(async () => {
    setSwitchingAccount(true);
    try {
      await auth.logout();
    } finally {
      setSwitchingAccount(false);
      actions.restart();
    }
  }, [auth, actions]);

  // Already signed in and not mid-flow: this route has nothing to ask. Sending
  // them to their own home beats rendering a sign-in form to someone who is
  // signed in (which is how people end up with a second account).
  if (wasAuthedOnMount && state.step === STATES.EMAIL && auth.status === 'authed') {
    return <Navigate to={returnTo || auth.homeRoute || '/'} replace />;
  }

  const { title, subtitle } = copyFor(state.step, { mode, email: state.email });

  const shellProps = {
    title,
    subtitle,
    width: state.step === STATES.SIGNUP ? 'lg' : 'md',
    error: state.error,
    notice: state.notice,
    onDismissError: actions.dismissError,
    // DOCTOR_PENDING and DONE are past the point of no return: the session
    // already exists, so "Back" would be a lie.
    onBack: canGoBack && state.step !== STATES.DOCTOR_PENDING && state.step !== STATES.DONE
      ? actions.back
      : undefined,
  };

  switch (state.step) {
    case STATES.PASSWORD:
      return (
        <AuthShell {...shellProps}>
          <PasswordStep
            email={state.email}
            busy={state.busy}
            fieldErrors={state.fieldErrors}
            onSubmit={actions.submitPassword}
            onChangeEmail={actions.changeEmail}
            onForgotPassword={actions.goToReset}
          />
        </AuthShell>
      );

    case STATES.SIGNUP:
      return (
        <AuthShell {...shellProps}>
          <SignupDetailsStep
            email={state.email}
            busy={state.busy}
            fieldErrors={state.fieldErrors}
            onSubmit={actions.submitSignup}
            onChangeEmail={actions.changeEmail}
          />
        </AuthShell>
      );

    case STATES.OTP_SIGNUP:
    case STATES.OTP_RESET:
      return (
        <AuthShell {...shellProps}>
          <OtpStep
            email={state.email}
            purpose={state.otpPurpose}
            busy={state.busy}
            fieldErrors={state.fieldErrors}
            attemptsRemaining={attemptsRemaining}
            wrongAttempts={state.otpWrongAttempts}
            resendAvailableAt={state.resendAvailableAt}
            onSubmit={actions.submitOtp}
            onResend={actions.resendOtp}
            onChangeEmail={actions.changeEmail}
          />
        </AuthShell>
      );

    case STATES.RESET_REQUEST:
      return (
        <AuthShell {...shellProps}>
          <ResetRequestStep
            email={state.email}
            busy={state.busy}
            fieldErrors={state.fieldErrors}
            onSubmit={actions.requestReset}
          />
        </AuthShell>
      );

    case STATES.RESET_PASSWORD:
      return (
        <AuthShell {...shellProps}>
          <ResetPasswordStep
            email={state.email}
            busy={state.busy}
            fieldErrors={state.fieldErrors}
            onSubmit={actions.submitNewPassword}
          />
        </AuthShell>
      );

    case STATES.DOCTOR_PENDING:
      return (
        <AuthShell {...shellProps}>
          <DoctorPendingStep
            user={state.result?.user || auth.user}
            status={doctorVerificationStatus({
              user: state.result?.user || auth.user,
              session: state.result?.session || { doctor: auth.doctor },
            }) || 'pending'}
            homeRoute={state.result?.homeRoute || auth.homeRoute || '/'}
            onContinue={() => navigate(
              returnTo || state.result?.homeRoute || auth.homeRoute || '/',
              { replace: true },
            )}
            onUseAnotherAccount={useAnotherAccount}
            switching={switchingAccount}
          />
        </AuthShell>
      );

    case STATES.DONE:
      return (
        <AuthShell {...shellProps}>
          <div className="flex flex-col items-center gap-3 py-6">
            <Spinner size="lg" label="Signing you in" className="text-primary-700" />
            <p className="text-body-sm text-muted">Taking you to your dashboard…</p>
          </div>
        </AuthShell>
      );

    case STATES.EMAIL:
    default:
      return (
        <AuthShell
          {...shellProps}
          footer={(
            <span>
              Trouble signing in? Your account works for patients, doctors and
              admins: there is only ever one.
            </span>
          )}
        >
          <EmailStep
            email={state.email}
            busy={state.busy}
            fieldErrors={state.fieldErrors}
            onSubmit={actions.submitEmail}
          />
        </AuthShell>
      );
  }
}

export { AuthPage };
