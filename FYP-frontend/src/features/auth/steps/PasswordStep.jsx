/**
 * PasswordStep — the second half of a sign-in, for an address we know exists.
 *
 * No role selector. The stored role is the only authority, so an admin, a
 * doctor and a patient all finish here and land wherever `session.home_route`
 * says. That is the whole "one account, no duplicates" requirement in one
 * screen: a doctor who wants their own mole looked at signs in HERE and gets
 * the patient workspace offered alongside their dashboard.
 */

import React, { useState } from 'react';

import { Button, Field } from '../../../components/ui';

import EmailChip from '../components/EmailChip';
import PasswordInput from '../components/PasswordInput';

/**
 * @param {object} props
 * @param {string} props.email
 * @param {boolean} props.busy
 * @param {Record<string,string>} props.fieldErrors
 * @param {(password:string) => void} props.onSubmit
 * @param {() => void} props.onChangeEmail
 * @param {() => void} props.onForgotPassword
 */
export default function PasswordStep({
  email,
  busy,
  fieldErrors,
  onSubmit,
  onChangeEmail,
  onForgotPassword,
}) {
  const [password, setPassword] = useState('');

  return (
    <>
      <EmailChip email={email} onChange={onChangeEmail} />

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(password);
        }}
        className="space-y-5"
      >
        {/* A hidden, read-only username so password managers file the saved
            credential against the right account. Without it they store the
            password with no username and cannot autofill it next time. */}
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

        <Field label="Password" error={fieldErrors.password} required>
          <PasswordInput
            name="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            placeholder="Your password"
            autoFocus
          />
        </Field>

        <Button type="submit" fullWidth size="lg" loading={busy} loadingText="Signing in…">
          Sign in
        </Button>

        <div className="text-center">
          <Button type="button" variant="link" size="sm" onClick={onForgotPassword}>
            Forgot your password?
          </Button>
        </div>
      </form>
    </>
  );
}

export { PasswordStep };
