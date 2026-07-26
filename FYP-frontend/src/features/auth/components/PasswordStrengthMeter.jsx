/**
 * PasswordStrengthMeter — advisory, never a gate.
 *
 * The bar scores; the CHECKLIST is what actually matters, because those three
 * lines are the server's real policy (min length, not all numbers, not a common
 * password) and the rules text comes from `/auth/consent-documents`'s
 * `password_policy` block when it is available. A user is allowed to submit a
 * "Weak" password that satisfies the policy — inventing a stricter client rule
 * than the API enforces is how people end up locked out of their own signup.
 *
 * Announced politely, not assertively: this updates on every keystroke, and an
 * assertive live region would make a screen reader read the bar instead of the
 * characters being typed.
 */

import React from 'react';
import { Check, Minus } from 'lucide-react';

import { Progress, cn } from '../../../components/ui';

import { DEFAULT_MIN_LENGTH, scorePassword } from '../passwordStrength';

const TONE_BY_LEVEL = {
  weak: 'danger',
  fair: 'warning',
  good: 'primary',
  strong: 'success',
};

/**
 * @param {object} props
 * @param {string} props.value The password being typed.
 * @param {number} [props.minLength] From the backend's password_policy.
 * @param {string[]} [props.rules] Backend-supplied rule copy, when loaded.
 * @param {string} [props.className]
 */
export default function PasswordStrengthMeter({
  value,
  minLength = DEFAULT_MIN_LENGTH,
  rules,
  className,
}) {
  const result = scorePassword(value, minLength);
  const checks = [
    { id: 'length', ok: result.meets.length, label: `At least ${minLength} characters` },
    { id: 'notNumeric', ok: result.meets.notNumeric, label: 'Not all numbers' },
    { id: 'notCommon', ok: result.meets.notCommon, label: 'Not a commonly used password' },
  ];

  return (
    <div className={cn('mt-2 space-y-2', className)}>
      <Progress
        value={result.percent}
        size="xs"
        tone={TONE_BY_LEVEL[result.level.id] || 'primary'}
        label={<span className="text-caption text-subtle">Password strength</span>}
        valueText={value ? `${result.level.label} password` : 'No password entered'}
        className="mt-1"
      />

      <p className="text-caption font-medium text-muted" aria-live="polite">
        {value ? result.level.label : 'Enter a password'}
      </p>

      <ul className="space-y-1">
        {(Array.isArray(rules) && rules.length === checks.length
          ? checks.map((check, index) => ({ ...check, label: rules[index] }))
          : checks
        ).map((check) => (
          <li key={check.id} className="flex items-center gap-1.5 text-caption">
            {check.ok
              ? <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-success-600" />
              : <Minus aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-subtle" />}
            <span className={check.ok ? 'text-muted' : 'text-subtle'}>{check.label}</span>
            <span className="ui-sr-only">{check.ok ? ' — met' : ' — not met'}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export { PasswordStrengthMeter };
