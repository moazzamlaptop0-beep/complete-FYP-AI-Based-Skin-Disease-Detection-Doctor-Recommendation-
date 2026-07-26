/**
 * PasswordInput — the ui Input plus a reveal toggle.
 *
 * Not a new primitive: it is `<Input>` with its `suffix` slot filled, so the
 * chrome, the sizing, the invalid state and the Field ARIA wiring are all the
 * shared ones. The toggle flips `type` only — the value never leaves the input,
 * and `autoComplete` is required from the caller because getting it wrong
 * (`current-password` on a signup form) is what makes password managers offer
 * to overwrite the wrong entry.
 */

import React, { useId, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

import { IconButton, Input } from '../../../components/ui';

/**
 * @param {object} props
 * @param {'current-password'|'new-password'} props.autoComplete REQUIRED.
 * @param {string} [props.value]
 * @param {(event: React.ChangeEvent<HTMLInputElement>) => void} [props.onChange]
 * @param {string} [props.placeholder]
 */
export default function PasswordInput({ autoComplete, ...rest }) {
  const [revealed, setRevealed] = useState(false);
  const labelId = useId();

  return (
    <Input
      type={revealed ? 'text' : 'password'}
      autoComplete={autoComplete}
      autoCapitalize="off"
      autoCorrect="off"
      spellCheck="false"
      suffix={(
        <IconButton
          type="button"
          size="sm"
          variant="ghost"
          id={labelId}
          aria-label={revealed ? 'Hide password' : 'Show password'}
          aria-pressed={revealed}
          onClick={() => setRevealed((current) => !current)}
          className="-mr-1.5 h-8 w-8 text-subtle"
          // Toggling visibility is not a form action; keep it out of the tab
          // order's way by leaving it after the input (DOM order does that) but
          // never let it submit.
          tabIndex={0}
        >
          {revealed
            ? <EyeOff aria-hidden="true" className="h-4 w-4" />
            : <Eye aria-hidden="true" className="h-4 w-4" />}
        </IconButton>
      )}
      {...rest}
    />
  );
}

export { PasswordInput };
