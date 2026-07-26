/**
 * EmailChip — "you are signing in as x@y.z", with a way out.
 *
 * Every state after EMAIL is scoped to one address, and the single most common
 * failure on an email-first flow is realising you typed the wrong one. The chip
 * keeps the answer visible and the correction one click away, instead of making
 * the browser Back button the only fix (which, on the old pages, lost the form).
 */

import React from 'react';
import { Mail } from 'lucide-react';

import { cn } from '../../../components/ui';

/**
 * @param {object} props
 * @param {string} props.email
 * @param {() => void} [props.onChange] Renders the "Change" affordance.
 * @param {string} [props.changeLabel='Change'] Visible text.
 * @param {string} [props.changeAriaLabel='Change email address'] The accessible
 *   name. Given explicitly rather than as a visible label plus an `sr-only`
 *   suffix, because the accessible-name algorithm concatenates the two text
 *   nodes with no separator ("Changeemail address").
 * @param {string} [props.className]
 */
export default function EmailChip({
  email,
  onChange,
  changeLabel = 'Change',
  changeAriaLabel = 'Change email address',
  className,
}) {
  if (!email) return null;

  return (
    <div
      className={cn(
        'mb-6 flex items-center gap-2 rounded-field border border-subtle bg-surface-sunken px-3 py-2',
        className,
      )}
    >
      <Mail aria-hidden="true" className="h-4 w-4 shrink-0 text-subtle" />
      <span className="min-w-0 flex-1 truncate font-body text-body-sm text-default" title={email}>
        {email}
      </span>
      {onChange && (
        <button
          type="button"
          onClick={onChange}
          aria-label={changeAriaLabel}
          className={cn(
            'shrink-0 rounded-field px-2 py-1 text-label-md text-primary-700 dark:text-accent-400',
            'hover:underline outline-none focus-visible:ring-2 focus-visible:ring-focus',
            'focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          )}
        >
          {changeLabel}
        </button>
      )}
    </div>
  );
}

export { EmailChip };
