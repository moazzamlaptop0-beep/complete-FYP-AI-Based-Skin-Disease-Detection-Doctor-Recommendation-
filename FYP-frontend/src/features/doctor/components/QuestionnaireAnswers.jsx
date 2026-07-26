/**
 * QuestionnaireAnswers — the six pre-report symptom booleans, rendered so a
 * doctor can read them in under a second.
 *
 * THE KEYS ARE A CONTRACT
 * -----------------------
 * `is_bleeding`, `growing_fast`, `has_severe_pain`, `irregular_border`,
 * `color_change`, `diameter_over_6mm` are exactly TriageService.SYMPTOM_WEIGHTS
 * (app/services/triage_service.py:112-119). Anything else the payload happens to
 * carry is still shown, humanised, at the end — a future seventh question must
 * not vanish from a doctor's screen just because this file has not been updated.
 *
 * NULL IS NOT "ALL NO"
 * --------------------
 * `answers` is deliberately nullable end to end: the questionnaire is optional
 * and "skipped" is clinically different from "answered no to all six". A skipped
 * questionnaire therefore renders as an explicit "not answered" line, never as
 * six greyed-out negatives.
 */

import React from 'react';
import { Check, HelpCircle, Minus } from 'lucide-react';

import { cn } from '../../../lib/cn';

/** Ordered by triage weight — the two 3-pointers first. */
export const QUESTION_LABELS = [
  ['is_bleeding', 'Bleeding'],
  ['growing_fast', 'Growing quickly'],
  ['has_severe_pain', 'Severe pain'],
  ['irregular_border', 'Irregular border'],
  ['color_change', 'Colour change'],
  ['diameter_over_6mm', 'Wider than 6 mm'],
];

const KNOWN = new Set(QUESTION_LABELS.map(([key]) => key));

function humanise(key) {
  return String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

function truthy(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') return ['true', 'yes', '1', 'y'].includes(value.trim().toLowerCase());
  return false;
}

/**
 * @param {object} props
 * @param {object|null} props.answers Parsed questionnaire object, or null.
 * @param {'chips'|'list'} [props.variant='chips']
 * @param {string} [props.className]
 */
export default function QuestionnaireAnswers({ answers, variant = 'chips', className }) {
  if (!answers || typeof answers !== 'object') {
    return (
      <p className={cn('flex items-center gap-1.5 text-caption text-subtle', className)}>
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
        Symptom questions were skipped — this is not the same as answering “no”.
      </p>
    );
  }

  const extras = Object.keys(answers).filter((key) => !KNOWN.has(key));
  const rows = [
    ...QUESTION_LABELS.map(([key, label]) => [key, label, truthy(answers[key])]),
    ...extras.map((key) => [key, humanise(key), truthy(answers[key])]),
  ];
  const positives = rows.filter(([, , yes]) => yes).length;

  if (variant === 'list') {
    return (
      <dl className={cn('grid gap-x-4 gap-y-1.5 sm:grid-cols-2', className)}>
        {rows.map(([key, label, yes]) => (
          <div key={key} className="flex items-center justify-between gap-2 border-b border-subtle py-1">
            <dt className="text-body-sm text-muted">{label}</dt>
            <dd className={cn('text-label-md', yes ? 'text-danger-700' : 'text-subtle')}>
              {yes ? 'Yes' : 'No'}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      <span className="ui-sr-only">
        {positives} of {rows.length} symptom questions answered yes.
      </span>
      {rows.map(([key, label, yes]) => (
        <span
          key={key}
          className={cn(
            'inline-flex items-center gap-1 rounded-pill border px-2 py-0.5 text-caption',
            yes
              ? 'border-danger-200 bg-danger-50 font-semibold text-danger-700'
              : 'border-subtle bg-surface-sunken text-subtle',
          )}
        >
          {yes
            ? <Check className="h-3 w-3" aria-hidden="true" />
            : <Minus className="h-3 w-3" aria-hidden="true" />}
          {label}
        </span>
      ))}
    </div>
  );
}

export { QuestionnaireAnswers };
