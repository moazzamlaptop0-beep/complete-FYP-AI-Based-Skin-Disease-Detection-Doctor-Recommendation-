/**
 * ResetPasswordStep — choose the new password, with the reset code already
 * proven good.
 *
 * The code was VALIDATED (not consumed) by /auth/verify-otp on the previous
 * step, which is why this screen can promise it will work: the only remaining
 * failure modes are the password policy and the 10-minute expiry. If the code
 * does die in between, the machine sends the user back one step rather than
 * leaving them retyping a password into a form that can no longer succeed.
 *
 * On success the machine signs the user straight in — the password is known and
 * the server just revoked every older session, so making them type it a third
 * time buys nothing.
 */

import React, { useState } from 'react';

import { Button, Field } from '../../../components/ui';

import EmailChip from '../components/EmailChip';
import PasswordInput from '../components/PasswordInput';
import PasswordStrengthMeter from '../components/PasswordStrengthMeter';
import { checkPasswordPolicy } from '../passwordStrength';

/**
 * @param {object} props
 * @param {string} props.email
 * @param {boolean} props.busy
 * @param {Record<string,string>} props.fieldErrors
 * @param {(password:string) => void} props.onSubmit
 */
export default function ResetPasswordStep({ email, busy, fieldErrors, onSubmit }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [localErrors, setLocalErrors] = useState({});

  const handleSubmit = (event) => {
    event.preventDefault();

    const next = {};
    const policy = checkPasswordPolicy(password);
    if (!policy.ok) next.password = policy.error;
    else if (confirm !== password) next.confirm = 'The two passwords do not match.';

    setLocalErrors(next);
    if (Object.keys(next).length) return;
    onSubmit(password);
  };

  return (
    <>
      <EmailChip email={email} />

      <form noValidate onSubmit={handleSubmit} className="space-y-5">
        <input
          type="email"
          name="email"
          value={email}
          readOnly
          autoComplete="username"
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
        />

        <div>
          <Field
            label="New password"
            error={localErrors.password || fieldErrors.password}
            required
          >
            <PasswordInput
              name="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              placeholder="Choose a new password"
              autoFocus
            />
          </Field>
          <PasswordStrengthMeter value={password} />
        </div>

        <Field
          label="Confirm new password"
          error={localErrors.confirm}
          required
        >
          <PasswordInput
            name="confirm-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            placeholder="Type it again"
          />
        </Field>

        <Button type="submit" fullWidth size="lg" loading={busy} loadingText="Updating…">
          Update password and sign in
        </Button>

        <p className="text-center text-caption text-subtle">
          Changing your password signs out every other device.
        </p>
      </form>
    </>
  );
}

export { ResetPasswordStep };
