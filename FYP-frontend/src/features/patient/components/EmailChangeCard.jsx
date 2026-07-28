/**
 * EmailChangeCard — moving the account to a different inbox, safely.
 *
 * WHY THE ADDRESS IS NOT JUST ANOTHER TEXT BOX
 * -------------------------------------------
 * The email address IS the account: it is the login, the password-reset channel
 * and the audit identity. Editing it in place, the way the old doctor form did
 * through `POST /api/doctor/profile`, means a typo permanently locks the owner out
 * and a stolen session can move the account to an attacker's inbox in one
 * request. So the flow proves the new inbox is reachable BEFORE the swap:
 *
 *   request (new address + current password) -> 6-digit code mailed TO THE NEW
 *   ADDRESS -> verify -> swapped.
 *
 * The current password is part of the request for the same reason a bank asks:
 * possession of an unlocked tab must not be enough.
 *
 * NOTHING HERE IS A SECOND OTP IMPLEMENTATION
 * ------------------------------------------
 * `features/auth/steps/OtpStep.jsx` already solves six paste-aware boxes, the
 * server-driven resend countdown and the local attempt counter, and
 * `features/auth/authApi.js` already owns the purpose constant, the attempt
 * ceiling and the 429-message parser. Both are reused verbatim. What is NOT
 * reused is authApi's request helpers: every call in that module sends
 * `{auth:false}` because it is written for the sign-in screen, and an
 * unauthenticated `/auth/email-change/request` cannot know whose address to
 * change. These calls go through the authenticated client instead.
 */

import React, { useEffect, useState } from 'react';
import { AtSign, MailWarning, ShieldCheck, X } from 'lucide-react';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  notify,
} from '../../../components/ui';
import { ApiError, profile as profileApi } from '../../../lib/api';
import {
  OTP_MAX_ATTEMPTS,
  OTP_PURPOSE,
  OTP_RESEND_COOLDOWN_SECONDS,
  secondsFromCooldownMessage,
} from '../../auth/authApi';
import PasswordInput from '../../auth/components/PasswordInput';
import OtpStep from '../../auth/steps/OtpStep';

/** The three things this card can be showing. */
const VIEW = Object.freeze({ SUMMARY: 'summary', REQUEST: 'request', OTP: 'otp' });

/** Absolute epoch deadline OtpStep counts down from. */
const deadlineIn = (seconds) => Date.now() + Math.max(0, Number(seconds) || 0) * 1000;

/** Deliberately loose: the server is the authority on deliverability. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * @param {object} props
 * @param {object} props.profile GET /api/profile payload.
 * @param {(next: object) => void} props.onChanged Called after a successful
 *   request / verify / cancel with the fields to merge into the held profile.
 */
export default function EmailChangeCard({ profile, onChanged }) {
  const pendingEmail = profile?.pending_email || null;

  const [view, setView] = useState(VIEW.SUMMARY);
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);

  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [wrongAttempts, setWrongAttempts] = useState(0);

  // A pending change that was started on another device (or before a reload) must
  // not silently drop back to the summary while the code sits in an inbox.
  useEffect(() => {
    if (!pendingEmail) setView((current) => (current === VIEW.OTP ? VIEW.SUMMARY : current));
  }, [pendingEmail]);

  const resetForm = () => {
    setNewEmail('');
    setPassword('');
    setFieldErrors({});
    setFormError(null);
  };

  const messageOf = (err, fallback) => (err instanceof ApiError ? err.message : fallback);

  // -- step 1: ask for the change --------------------------------------------
  const requestChange = async (event) => {
    event.preventDefault();
    setFormError(null);
    setNotice(null);

    const address = newEmail.trim();
    const found = {};
    if (!address) found.new_email = 'Enter the address you want to use.';
    else if (!LOOKS_LIKE_EMAIL.test(address)) found.new_email = 'That does not look like an email address.';
    else if (address.toLowerCase() === String(profile?.email || '').toLowerCase()) {
      found.new_email = 'That is already your address.';
    }
    if (!password) found.current_password = 'Confirm your current password to continue.';
    setFieldErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      const data = await profileApi.emailChange.request({
        new_email: address,
        current_password: password,
      });
      setPassword('');
      setWrongAttempts(0);
      setResendAvailableAt(deadlineIn(data?.resend_in_seconds ?? OTP_RESEND_COOLDOWN_SECONDS));
      onChanged?.({ pending_email: data?.pending_email || address });
      setView(VIEW.OTP);
    } catch (err) {
      const seconds = secondsFromCooldownMessage(err?.message);
      if (seconds) setResendAvailableAt(deadlineIn(seconds));
      setFormError(messageOf(err, 'We could not start that change.'));
    } finally {
      setBusy(false);
    }
  };

  // -- step 2: prove the new inbox ------------------------------------------
  const verify = async (code) => {
    setFieldErrors({});
    setFormError(null);
    setBusy(true);
    try {
      const data = await profileApi.emailChange.verify(code);
      const email = data?.email || pendingEmail;
      setWrongAttempts(0);
      setView(VIEW.SUMMARY);
      resetForm();
      setNotice(`Your address is now ${email}. Use it the next time you sign in.`);
      notify.success('Your email address has been changed.');
      onChanged?.({ email, pending_email: null });
    } catch (err) {
      setWrongAttempts((count) => count + 1);
      setFieldErrors({ otp: messageOf(err, 'That code was not accepted.') });
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    if (!pendingEmail) return;
    setFieldErrors({});
    setFormError(null);
    setBusy(true);
    try {
      await profileApi.emailChange.resend({
        email: pendingEmail,
        purpose: OTP_PURPOSE.EMAIL_CHANGE,
      });
      // A fresh code is a fresh row with attempts = 0 server-side.
      setWrongAttempts(0);
      setResendAvailableAt(deadlineIn(OTP_RESEND_COOLDOWN_SECONDS));
      setNotice(`A new code is on its way to ${pendingEmail}.`);
    } catch (err) {
      const seconds = secondsFromCooldownMessage(err?.message);
      setResendAvailableAt(deadlineIn(seconds ?? OTP_RESEND_COOLDOWN_SECONDS));
      setFormError(messageOf(err, 'We could not send another code.'));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setFieldErrors({});
    setFormError(null);
    setBusy(true);
    try {
      await profileApi.emailChange.cancel();
      setWrongAttempts(0);
      setResendAvailableAt(0);
      setView(VIEW.SUMMARY);
      resetForm();
      setNotice('That change has been cancelled. Your address is unchanged.');
      onChanged?.({ pending_email: null });
    } catch (err) {
      setFormError(messageOf(err, 'We could not cancel that change.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card padding="none">
      <CardHeader
        title="Email address"
        description="Your sign-in address. Changing it needs your password and a code sent to the new inbox."
        divider
      />
      <CardBody>
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <AtSign className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            <span className="min-w-0 break-all font-body text-body-md text-default">
              {profile?.email}
            </span>
            {profile?.is_verified && (
              <Badge tone="success" icon={<ShieldCheck className="h-3 w-3" aria-hidden="true" />}>
                Verified
              </Badge>
            )}
          </div>

          {notice && <Alert tone="success" onDismiss={() => setNotice(null)}>{notice}</Alert>}
          {formError && <Alert tone="danger" title="That did not work">{formError}</Alert>}

          {pendingEmail && view !== VIEW.OTP && (
            <Alert
              tone="warning"
              icon={<MailWarning className="h-5 w-5" aria-hidden="true" />}
              title="A change is waiting for a code"
              actions={(
                <>
                  <Button size="sm" onClick={() => setView(VIEW.OTP)}>Enter the code</Button>
                  <Button size="sm" variant="ghost" loading={busy} onClick={cancel}>
                    Cancel the change
                  </Button>
                </>
              )}
            >
              We emailed a 6-digit code to <span className="break-all font-semibold">{pendingEmail}</span>.
              Your address stays as it is until that code is entered.
            </Alert>
          )}

          {view === VIEW.SUMMARY && !pendingEmail && (
            <div>
              <Button variant="outline" size="sm" onClick={() => { resetForm(); setView(VIEW.REQUEST); }}>
                Change my email address
              </Button>
            </div>
          )}

          {view === VIEW.REQUEST && (
            <form noValidate onSubmit={requestChange} className="flex flex-col gap-4">
              <Field
                label="New email address"
                error={fieldErrors.new_email}
                hint="We will send a 6-digit code there. Nothing changes until you enter it."
              >
                <Input
                  type="email"
                  value={newEmail}
                  onChange={(event) => setNewEmail(event.target.value)}
                  autoComplete="email"
                  autoCapitalize="off"
                  spellCheck="false"
                />
              </Field>

              <Field label="Current password" error={fieldErrors.current_password}>
                <PasswordInput
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </Field>

              <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={busy} loadingText="Sending the code">
                  Send the code
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  leftIcon={<X className="h-4 w-4" />}
                  onClick={() => { resetForm(); setView(VIEW.SUMMARY); }}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}

          {view === VIEW.OTP && pendingEmail && (
            <div>
              <OtpStep
                email={pendingEmail}
                purpose={OTP_PURPOSE.EMAIL_CHANGE}
                busy={busy}
                fieldErrors={fieldErrors}
                attemptsRemaining={Math.max(0, OTP_MAX_ATTEMPTS - wrongAttempts)}
                wrongAttempts={wrongAttempts}
                resendAvailableAt={resendAvailableAt}
                onSubmit={verify}
                onResend={resend}
                // The chip's "Not you?" goes back to the form so a typo in the new
                // address is a correction, not a dead end.
                onChangeEmail={() => { resetForm(); setView(VIEW.REQUEST); }}
              />
              <div className="mt-2 text-center">
                <Button variant="link" size="sm" loading={busy} onClick={cancel}>
                  Keep my current address
                </Button>
              </div>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

export { EmailChangeCard };
