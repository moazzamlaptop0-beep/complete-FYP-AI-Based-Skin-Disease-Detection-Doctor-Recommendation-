/**
 * PasswordChangeCard — change the password without losing the session.
 *
 * THE ONE BEHAVIOUR THIS FILE EXISTS TO GUARANTEE
 * ----------------------------------------------
 * A successful password change must NEVER sign the user out. `/reset-password`
 * deliberately ends every session (it is used when the password may be
 * compromised), and it would have been easy to reuse that shape here — but a
 * person deliberately rotating their own password from inside their own account
 * has proved they hold the old one, and dumping them on the login screen with a
 * password they just invented is how people end up locked out mid-task.
 *
 * The contract allows the backend either to leave the token version alone or to
 * hand back a fresh bundle. Both are handled: when a `token` comes back it is
 * written to the SAME keys `AuthContext` owns, through `lib/storage` (the only
 * module allowed near localStorage), and then `rehydrate()` is called — the exact
 * sequence `features/auth/authApi.establishSession` uses after an OTP sign-in.
 * `setActingAs` is deliberately NOT touched here: an admin who is acting as
 * someone must not be thrown out of that delegation by rotating their own
 * password.
 *
 * The policy checks and the meter are the auth screen's own, so the rules a user
 * is held to are identical in both places and can only drift in one file.
 */

import React, { useState } from 'react';
import { KeyRound, Lock } from 'lucide-react';

import {
  Alert,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  notify,
} from '../../../components/ui';
import { ApiError, profile as profileApi } from '../../../lib/api';
import * as storage from '../../../lib/storage';
import PasswordInput from '../../auth/components/PasswordInput';
import PasswordStrengthMeter from '../../auth/components/PasswordStrengthMeter';
import { checkPasswordPolicy } from '../../auth/passwordStrength';

const EMPTY = { current: '', next: '', confirm: '' };

/**
 * @param {object} props
 * @param {() => Promise<any>} [props.onRehydrate] AuthContext's `rehydrate`, used
 *   only when the server returns a replacement token bundle.
 */
export default function PasswordChangeCard({ onRehydrate }) {
  const [values, setValues] = useState(EMPTY);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const setValue = (key) => (event) => {
    const next = event.target.value;
    setDone(false);
    setValues((previous) => ({ ...previous, [key]: next }));
    setErrors((previous) => (previous[key] ? { ...previous, [key]: undefined } : previous));
  };

  const submit = async (event) => {
    event.preventDefault();
    setFormError(null);
    setDone(false);

    const found = {};
    if (!values.current) found.current = 'Enter your current password.';

    const policy = checkPasswordPolicy(values.next);
    if (!policy.ok) found.next = policy.error;
    else if (values.next === values.current) {
      found.next = 'Choose a password you have not used here before.';
    }

    if (!values.confirm) found.confirm = 'Type the new password again.';
    else if (values.confirm !== values.next) found.confirm = 'These two do not match.';

    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      const data = await profileApi.changePassword({
        current_password: values.current,
        new_password: values.next,
      });

      // The backend rotated the session: seat the replacement so the very next
      // request is not a 401. When it returns only a message there is nothing to
      // do, which is the whole point of the contract allowing both.
      const token = data?.token || data?.access_token || null;
      if (token) {
        storage.setToken(token);
        if (data.refresh_token) storage.setRefreshToken(data.refresh_token);
        try {
          await onRehydrate?.();
        } catch {
          /* the token is already stored; a failed /auth/me must not undo a success */
        }
      }

      setValues(EMPTY);
      setDone(true);
      notify.success('Your password has been changed.');
    } catch (err) {
      // 401 here means "that is not your current password", not "your session
      // died" — say which field is wrong rather than showing a session warning.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setErrors({ current: 'That is not your current password.' });
      }
      setFormError(err instanceof ApiError ? err.message : 'Your password could not be changed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card as="form" padding="none" onSubmit={submit} noValidate>
      <CardHeader
        title="Password"
        description="You stay signed in on this device. Other devices are unaffected."
        divider
      />
      <CardBody>
        <div className="flex flex-col gap-4">
          {formError && <Alert tone="danger" title="We could not change it">{formError}</Alert>}
          {done && !formError && (
            <Alert tone="success" title="Your password has been changed">
              Use the new one the next time you sign in.
            </Alert>
          )}

          <Field label="Current password" error={errors.current}>
            <PasswordInput
              autoComplete="current-password"
              value={values.current}
              onChange={setValue('current')}
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="New password" error={errors.next}>
              <PasswordInput
                autoComplete="new-password"
                value={values.next}
                onChange={setValue('next')}
              />
            </Field>

            <Field label="Repeat the new password" error={errors.confirm}>
              <PasswordInput
                autoComplete="new-password"
                value={values.confirm}
                onChange={setValue('confirm')}
              />
            </Field>
          </div>

          <PasswordStrengthMeter value={values.next} />
        </div>
      </CardBody>
      <CardFooter align="between">
        <p className="flex items-center gap-1.5 font-body text-caption text-muted">
          <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          We never see your password in plain text.
        </p>
        <Button
          type="submit"
          loading={busy}
          loadingText="Changing"
          leftIcon={<KeyRound className="h-4 w-4" />}
        >
          Change password
        </Button>
      </CardFooter>
    </Card>
  );
}

export { PasswordChangeCard };
