/**
 * EmailStep — the single entry point.
 *
 * This one field replaces "Login or Register?" AND the three-tab role selector.
 * The role tabs were never a question the user could answer reliably (a doctor
 * who picked "AI User" got "Invalid credentials" for a correct password), and
 * the backend no longer looks at the client's answer at all. The server knows
 * which of the three doors this address opens; asking it is one round-trip.
 */

import React, { useState } from 'react';
import { ArrowRight, Mail } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Button, Field, Input } from '../../../components/ui';

/**
 * @param {object} props
 * @param {string} props.email Initial value (a `?email=` prefill or a restored flow).
 * @param {boolean} props.busy
 * @param {Record<string,string>} props.fieldErrors
 * @param {(email:string) => void} props.onSubmit
 */
export default function EmailStep({ email: initialEmail = '', busy, fieldErrors, onSubmit }) {
  const [email, setEmail] = useState(initialEmail);
  const error = fieldErrors.email;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(email);
      }}
      className="space-y-5"
    >
      <Field label="Email address" error={error} required>
        <Input
          name="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck="false"
          inputMode="email"
          // The first field of the first screen: focus it so a keyboard user
          // types immediately and a password manager knows where to fill.
          autoFocus
          leftIcon={<Mail className="h-4 w-4" />}
        />
      </Field>

      <Button
        type="submit"
        fullWidth
        size="lg"
        loading={busy}
        loadingText="Checking…"
        rightIcon={<ArrowRight aria-hidden="true" className="h-4 w-4" />}
      >
        Continue
      </Button>

      <p className="text-center text-body-sm text-muted">
        Just want to try it?{' '}
        <Link
          to="/try-now"
          className="rounded-field font-medium text-primary-700 underline-offset-2 hover:underline
                     outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2
                     focus-visible:ring-offset-surface dark:text-accent-400"
        >
          Continue as guest
        </Link>{' '}
        to scan a photo without an account.
      </p>
    </form>
  );
}

export { EmailStep };
