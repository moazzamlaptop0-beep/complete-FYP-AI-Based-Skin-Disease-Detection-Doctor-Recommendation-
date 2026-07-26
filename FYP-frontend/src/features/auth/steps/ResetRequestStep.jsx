/**
 * ResetRequestStep — "email me a reset code".
 *
 * The email is pre-filled from the machine, because this screen is only ever
 * reached from PasswordStep, where the address is already known and confirmed
 * to exist. It stays EDITABLE anyway: "I typed the wrong address" is the most
 * likely reason someone's password appears not to work.
 *
 * `/auth/forgot-password` answers 200 whether or not the account exists — the
 * copy below is worded to match that, so the screen never becomes a second,
 * chattier way to ask "is this person registered?".
 */

import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';

import { Button, Field, Input } from '../../../components/ui';

/**
 * @param {object} props
 * @param {string} props.email
 * @param {boolean} props.busy
 * @param {Record<string,string>} props.fieldErrors
 * @param {(email:string) => void} props.onSubmit
 */
export default function ResetRequestStep({ email: initialEmail = '', busy, fieldErrors, onSubmit }) {
  const [email, setEmail] = useState(initialEmail);

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(email);
      }}
      className="space-y-5"
    >
      <Field
        label="Email address"
        error={fieldErrors.email}
        hint="We will send a 6-digit code to this address."
        required
      >
        <Input
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck="false"
          inputMode="email"
          autoFocus
        />
      </Field>

      <Button
        type="submit"
        fullWidth
        size="lg"
        loading={busy}
        loadingText="Sending…"
        leftIcon={<KeyRound aria-hidden="true" className="h-4 w-4" />}
      >
        Send reset code
      </Button>
    </form>
  );
}

export { ResetRequestStep };
