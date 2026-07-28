/**
 * OtpStep — the six-digit code, for both `signup` and `reset`.
 *
 * WHAT WAS BROKEN AND IS FIXED HERE
 * ---------------------------------
 * 1. NO RESEND. Codes live 10 minutes; the old screen had no way to ask for
 *    another. Leave the tab and the account was unreachable forever — you could
 *    not re-register ("Email already exists") and could not log in ("verify your
 *    email first"). The button here is gated by the SERVER's cooldown: the 429
 *    body literally says "Please wait 31s…", and that number drives the timer.
 * 2. NO ATTEMPT FEEDBACK. Five wrong guesses lock the code, silently. The
 *    remaining count is shown after the first mistake. It is counted on the
 *    CLIENT because the API does not report it — so the server's own lockout
 *    message always wins the moment it arrives, and a resend resets the count
 *    because the backend issues a fresh row with `attempts = 0`.
 * 3. PASTING THE CODE. Six separate boxes look tidy and are hostile to the way
 *    everyone actually enters an OTP: copy it out of the email. Pasting into
 *    any box fills all six, and typing the sixth digit submits.
 */

import React, { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { MailCheck } from 'lucide-react';

import { Button, Input, cn, controlInvalid } from '../../../components/ui';

import EmailChip from '../components/EmailChip';

const LENGTH = 6;
const EMPTY = Array.from({ length: LENGTH }, () => '');

/** Seconds left on an absolute epoch deadline, floored at 0. */
function secondsLeft(deadline, now = Date.now()) {
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

/**
 * @param {object} props
 * @param {string} props.email
 * @param {'signup'|'reset'|'email_change'} props.purpose Only 'reset' changes the
 *   copy; 'email_change' (reused by the account page, where the address being
 *   proved is the NEW one) reads as a verification code, which is what it is.
 * @param {boolean} props.busy
 * @param {Record<string,string>} props.fieldErrors
 * @param {number} props.attemptsRemaining
 * @param {number} props.wrongAttempts How many guesses have already failed.
 * @param {number} props.resendAvailableAt Absolute epoch ms; 0 = available now.
 * @param {(code:string) => void} props.onSubmit
 * @param {() => void} props.onResend
 * @param {() => void} props.onChangeEmail
 */
export default function OtpStep({
  email,
  purpose,
  busy,
  fieldErrors,
  attemptsRemaining,
  wrongAttempts,
  resendAvailableAt,
  onSubmit,
  onResend,
  onChangeEmail,
}) {
  const [digits, setDigits] = useState(EMPTY);
  const inputs = useRef([]);
  /** A bare tick. The countdown itself is DERIVED at render from the absolute
   *  deadline, so there is no second copy of the truth to fall out of sync. */
  const [, tick] = useReducer((n) => n + 1, 0);

  const code = digits.join('');
  const error = fieldErrors.otp;
  const errorId = 'otp-error';
  const hintId = 'otp-hint';

  // -- the resend countdown --------------------------------------------------
  // Driven off an ABSOLUTE deadline rather than a decrementing counter, so it
  // stays correct across a browser refresh (the deadline is persisted) and
  // across a backgrounded tab where timers are throttled. The effect only
  // schedules re-renders; it never copies the deadline into state.
  const cooldown = secondsLeft(resendAvailableAt);

  useEffect(() => {
    if (!resendAvailableAt || resendAvailableAt <= Date.now()) return undefined;
    const timer = setInterval(() => {
      tick();
      if (secondsLeft(resendAvailableAt) <= 0) clearInterval(timer);
    }, 1000);
    return () => clearInterval(timer);
  }, [resendAvailableAt]);

  useEffect(() => {
    inputs.current[0]?.focus();
  }, []);

  // A rejected code stays on screen (so the user can see what they typed) but
  // the caret goes back to the start, ready to be overwritten.
  useEffect(() => {
    if (error) inputs.current[0]?.focus();
  }, [error]);

  const submit = useCallback((value) => {
    if (busy) return;
    onSubmit(value);
  }, [busy, onSubmit]);

  const writeDigits = useCallback((next, focusIndex) => {
    setDigits(next);
    if (focusIndex !== undefined) {
      inputs.current[Math.max(0, Math.min(LENGTH - 1, focusIndex))]?.focus();
    }
    const joined = next.join('');
    if (joined.length === LENGTH && next.every(Boolean)) submit(joined);
  }, [submit]);

  const handleChange = (index) => (event) => {
    const typed = event.target.value.replace(/\D/g, '');
    if (!typed) {
      const next = [...digits];
      next[index] = '';
      setDigits(next);
      return;
    }
    // Some Android keyboards deliver several characters in one event; treat
    // that exactly like a paste rather than dropping the extras.
    if (typed.length > 1) {
      const next = [...digits];
      typed.split('').slice(0, LENGTH - index).forEach((char, offset) => {
        next[index + offset] = char;
      });
      writeDigits(next, index + typed.length);
      return;
    }
    const next = [...digits];
    next[index] = typed;
    writeDigits(next, index + 1);
  };

  const handleKeyDown = (index) => (event) => {
    if (event.key === 'Backspace') {
      if (digits[index]) {
        const next = [...digits];
        next[index] = '';
        setDigits(next);
        return;
      }
      if (index > 0) {
        event.preventDefault();
        const next = [...digits];
        next[index - 1] = '';
        setDigits(next);
        inputs.current[index - 1]?.focus();
      }
      return;
    }
    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      inputs.current[index - 1]?.focus();
    }
    if (event.key === 'ArrowRight' && index < LENGTH - 1) {
      event.preventDefault();
      inputs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (index) => (event) => {
    const pasted = (event.clipboardData?.getData('text') || '').replace(/\D/g, '');
    if (!pasted) return;
    event.preventDefault();
    const next = [...digits];
    pasted.split('').slice(0, LENGTH - index).forEach((char, offset) => {
      next[index + offset] = char;
    });
    writeDigits(next, index + pasted.length);
  };

  const title = purpose === 'reset' ? 'reset code' : 'verification code';
  const showAttempts = wrongAttempts > 0 && attemptsRemaining > 0;
  const resendLabel = cooldown > 0 ? `Resend in ${cooldown}s` : 'Send a new code';

  return (
    <>
      <EmailChip
        email={email}
        onChange={onChangeEmail}
        changeLabel="Not you?"
        changeAriaLabel="Use a different email address"
      />

      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          submit(code);
        }}
        className="space-y-5"
      >
        <div
          role="group"
          aria-label={`Six digit ${title}`}
          aria-describedby={cn(hintId, error && errorId)}
        >
          <div className="flex items-center justify-center gap-2 sm:gap-3">
            {digits.map((digit, index) => (
              <Input
                // Positional boxes: the index IS the identity here, and the
                // list never reorders.
                key={`otp-digit-${index}`}
                ref={(node) => { inputs.current[index] = node; }}
                value={digit}
                onChange={handleChange(index)}
                onKeyDown={handleKeyDown(index)}
                onPaste={handlePaste(index)}
                onFocus={(event) => event.target.select()}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={LENGTH}
                // Only the first box claims the OTP autofill, or the browser
                // fills the whole code into every box.
                autoComplete={index === 0 ? 'one-time-code' : 'off'}
                aria-label={`Digit ${index + 1} of ${LENGTH}`}
                // NOT `error=` — that would wire aria-describedby to a per-box
                // error element that does not exist. The one error message
                // belongs to the group, so only the invalid flag and the
                // invalid chrome are applied per box.
                aria-invalid={error ? true : undefined}
                size="lg"
                wrapperClassName="w-11 sm:w-12"
                className={cn(
                  'px-0 text-center font-numeric text-heading-lg tracking-normal',
                  error && controlInvalid,
                )}
                disabled={busy}
              />
            ))}
          </div>

          <p id={hintId} className="mt-3 text-center text-body-sm text-muted">
            Enter the 6-digit {title} we emailed you. It expires in 10 minutes.
          </p>

          {error && (
            <p id={errorId} role="alert" className="mt-2 text-center text-caption font-medium text-danger-600">
              {error}
            </p>
          )}

          {showAttempts && (
            <p className="mt-1 text-center text-caption text-warning-600" aria-live="polite">
              {attemptsRemaining === 1
                ? '1 attempt left before this code is locked.'
                : `${attemptsRemaining} attempts left before this code is locked.`}
            </p>
          )}
          {wrongAttempts > 0 && attemptsRemaining === 0 && (
            <p className="mt-1 text-center text-caption font-medium text-danger-600" aria-live="polite">
              This code is locked. Request a new one below.
            </p>
          )}
        </div>

        <Button
          type="submit"
          fullWidth
          size="lg"
          loading={busy}
          loadingText="Checking the code…"
          disabled={code.length !== LENGTH}
          leftIcon={<MailCheck aria-hidden="true" className="h-4 w-4" />}
        >
          {purpose === 'reset' ? 'Verify and continue' : 'Verify my email'}
        </Button>

        <div className="text-center">
          <Button
            type="button"
            variant="link"
            size="sm"
            onClick={onResend}
            disabled={cooldown > 0 || busy}
          >
            {resendLabel}
          </Button>
          <span className="ui-sr-only" aria-live="polite">
            {cooldown > 0 ? `You can request a new code in ${cooldown} seconds.` : 'You can request a new code now.'}
          </span>
        </div>
      </form>
    </>
  );
}

export { OtpStep };
