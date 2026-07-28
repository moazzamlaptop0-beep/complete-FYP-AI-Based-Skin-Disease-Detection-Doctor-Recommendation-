/**
 * InlineAuthDialog — sign in or create an account WITHOUT leaving the wizard.
 *
 * WHY THIS EXISTS
 * ---------------
 * A guest can scan: capture a photo, get the AI result, answer the symptom
 * questions. Choosing doctors needs an account, and the gate there used to be a
 * <Link to="/auth?returnTo=/consult">. That navigation unmounts the wizard, and
 * the photograph is a `File` — an in-memory handle that cannot be written to
 * sessionStorage and does not survive a route change. So the visitor came back
 * signed in, to an empty first step, and had to photograph their skin again.
 * Several would not bother.
 *
 * Rendering the same auth machine in a dialog keeps ConsultPage mounted, so the
 * File, the crop, the prediction and the answers are all still in memory when
 * the dialog closes. Nothing needs persisting because nothing was ever torn
 * down.
 *
 * It drives `useAuthMachine` — the same reducer, the same API calls and the
 * same step components as /auth. There is no second implementation of the flow
 * here, only a different frame around it.
 */

import React, { useCallback } from 'react';
import { ImageIcon, ShieldCheck, Sparkles } from 'lucide-react';

import Alert from '../../../components/ui/Alert';
import Modal from '../../../components/ui/Modal';
import { cn } from '../../../lib/cn';
import { useAuth } from '../../../context/AuthContext';

import DoctorPendingStep from '../../auth/steps/DoctorPendingStep';
import EmailStep from '../../auth/steps/EmailStep';
import OtpStep from '../../auth/steps/OtpStep';
import PasswordStep from '../../auth/steps/PasswordStep';
import ResetPasswordStep from '../../auth/steps/ResetPasswordStep';
import ResetRequestStep from '../../auth/steps/ResetRequestStep';
import SignupDetailsStep from '../../auth/steps/SignupDetailsStep';
import useAuthMachine, { STATES } from '../../auth/useAuthMachine';

/** Dialog heading per machine state. Shorter than the /auth copy: the user is
 *  mid-task and already knows why they are being asked. */
const COPY = {
  [STATES.EMAIL]: {
    title: 'Save your scan',
    subtitle: 'Enter your email to continue. Your photo and result stay exactly where they are.',
  },
  [STATES.PASSWORD]: {
    title: 'Welcome back',
    subtitle: 'Enter your password to carry on booking.',
  },
  [STATES.SIGNUP]: {
    title: 'Create your account',
    subtitle: 'One account covers patients, doctors and admins.',
  },
  [STATES.OTP_SIGNUP]: {
    title: 'Check your email',
    subtitle: 'Enter the code we just sent.',
  },
  [STATES.OTP_RESET]: {
    title: 'Check your email',
    subtitle: 'Enter the code we just sent.',
  },
  [STATES.RESET_REQUEST]: {
    title: 'Reset your password',
    subtitle: 'We will email you a code.',
  },
  [STATES.RESET_PASSWORD]: {
    title: 'Choose a new password',
    subtitle: 'Then you will come straight back here.',
  },
  [STATES.DOCTOR_PENDING]: {
    title: 'Account created',
    subtitle: 'A licence still needs an admin to approve it.',
  },
};

/**
 * The three things a patient is actually worried about at this exact moment,
 * answered before the form. They are facts about THIS dialog, not marketing:
 * the page is still mounted behind it, so the File, the crop, the prediction and
 * the six answers are all still in memory and nothing is being re-uploaded.
 */
const KEPT = Object.freeze([
  { id: 'photo', icon: ImageIcon, label: 'Your photo stays', tile: 'bg-primary-100 text-primary-700' },
  { id: 'result', icon: Sparkles, label: 'Your result stays', tile: 'bg-accent-100 text-accent-700' },
  { id: 'private', icon: ShieldCheck, label: 'Nothing is shared yet', tile: 'bg-success-100 text-success-700' },
]);

function KeptStrip() {
  return (
    <ul className="grid gap-2 sm:grid-cols-3">
      {KEPT.map((entry) => {
        const Icon = entry.icon;
        return (
          <li
            key={entry.id}
            className={cn(
              'flex items-center gap-2 rounded-field border border-default',
              'bg-surface-sunken px-2.5 py-2',
            )}
          >
            <span
              aria-hidden="true"
              className={cn('grid h-7 w-7 shrink-0 place-items-center rounded-control', entry.tile)}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span className="min-w-0 truncate text-caption text-muted">{entry.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose Called on dismiss AND after a successful sign-in.
 * @param {(result:object) => void} props.onAuthenticated Fired once a session exists.
 * @param {string} [props.reason] One line explaining what needs the account.
 */
export default function InlineAuthDialog({ open, onClose, onAuthenticated, reason }) {
  const auth = useAuth();

  // No navigation. Hand the result up and close — ConsultPage is still mounted
  // behind this dialog with the photo in memory, so it simply carries on.
  const handleAuthenticated = useCallback((result) => {
    onAuthenticated?.(result);
    onClose?.();
  }, [onAuthenticated, onClose]);

  const { state, actions, attemptsRemaining } = useAuthMachine({
    rehydrate: auth.rehydrate,
    onAuthenticated: handleAuthenticated,
  });

  const copy = COPY[state.step] || COPY[STATES.EMAIL];

  const common = {
    email: state.email,
    busy: state.busy,
    fieldErrors: state.fieldErrors,
  };

  let body = null;
  switch (state.step) {
    case STATES.PASSWORD:
      body = (
        <PasswordStep
          {...common}
          onSubmit={actions.submitPassword}
          onChangeEmail={actions.changeEmail}
          onForgotPassword={actions.goToReset}
        />
      );
      break;
    case STATES.SIGNUP:
      body = (
        <SignupDetailsStep
          {...common}
          onSubmit={actions.submitSignup}
          onChangeEmail={actions.changeEmail}
        />
      );
      break;
    case STATES.OTP_SIGNUP:
    case STATES.OTP_RESET:
      body = (
        <OtpStep
          {...common}
          purpose={state.otpPurpose}
          attemptsRemaining={attemptsRemaining}
          wrongAttempts={state.otpWrongAttempts}
          resendAvailableAt={state.resendAvailableAt}
          onSubmit={actions.submitOtp}
          onResend={actions.resendOtp}
          onChangeEmail={actions.changeEmail}
        />
      );
      break;
    case STATES.RESET_REQUEST:
      body = <ResetRequestStep {...common} onSubmit={actions.requestReset} />;
      break;
    case STATES.RESET_PASSWORD:
      body = <ResetPasswordStep {...common} onSubmit={actions.submitNewPassword} />;
      break;
    case STATES.DOCTOR_PENDING:
      // A doctor who signs up here still holds every patient permission, so
      // they can finish this booking for themselves while the licence waits.
      body = (
        <DoctorPendingStep
          user={state.result?.user || auth.user}
          homeRoute={state.result?.homeRoute || auth.homeRoute || '/'}
          onContinue={onClose}
        />
      );
      break;
    case STATES.EMAIL:
    default:
      body = <EmailStep {...common} onSubmit={actions.submitEmail} />;
      break;
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={copy.title}
      description={copy.subtitle}
      size="md"
    >
      <div className="space-y-4">
        {reason && (
          <p className="text-body-sm text-muted">{reason}</p>
        )}

        {/* Only while the account is still being created or entered. Once the
            machine is on DOCTOR_PENDING the session exists and the reassurance
            is stale. */}
        {state.step !== STATES.DOCTOR_PENDING && <KeptStrip />}

        {state.error && (
          <Alert tone="danger" onDismiss={actions.dismissError}>
            {state.error}
          </Alert>
        )}

        {state.notice && <Alert tone="info">{state.notice}</Alert>}

        {body}
      </div>
    </Modal>
  );
}

export { InlineAuthDialog };
