import React, { useCallback, useMemo } from 'react';
import { cn } from '../../lib/cn';

/**
 * @typedef {object} Step
 * @property {string} id            Stable key, e.g. 'symptoms'
 * @property {React.ReactNode} label
 * @property {React.ReactNode} [description]
 * @property {boolean} [optional]   Renders an "Optional" hint
 * @property {(context: {index: number, current: number, furthest: number}) => boolean} [canEnter]
 *           Guard: return false to block navigation INTO this step.
 */

function CheckIcon(props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <path
        d="m3.5 8.5 3 3 6-6.5"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function LockIcon(props) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" {...props}>
      <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.75 7V5.25a2.25 2.25 0 0 1 4.5 0V7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

/**
 * Numbered progress indicator for multi-step flows (built for the consult
 * wizard landing next phase).
 *
 * `canEnter` is the important part. Each step may declare a guard, and the
 * Stepper computes reachability by walking FORWARD from step 0 and stopping at
 * the first step whose guard fails — you cannot jump to step 4 by skipping the
 * guard on step 2. Already-visited steps stay reachable via `furthest` so users
 * can always go back and edit an earlier answer.
 *
 * Guards receive `{ index, current, furthest }` and must be pure: they run on
 * every render.
 *
 * Semantics: rendered as an ordered list with `aria-current="step"` on the
 * active item. When steps are clickable each becomes a real `<button>`; when
 * they are not, no interactive element is emitted at all (a disabled button for
 * every future step is just tab-stop noise).
 *
 * @param {object} props
 * @param {Step[]} props.steps
 * @param {number} props.current Zero-based index of the active step.
 * @param {number} [props.furthest] Highest step reached so far. Defaults to `current`.
 * @param {(index: number) => void} [props.onStepChange] Enables clicking; only fires for reachable steps.
 * @param {'horizontal'|'vertical'} [props.orientation='horizontal']
 * @param {'default'|'compact'|'dots'} [props.variant='default']
 * @param {string} [props.className]
 * @param {string} [props['aria-label']='Progress']
 */
export function Stepper({
  steps = [],
  current = 0,
  furthest,
  onStepChange,
  orientation = 'horizontal',
  variant = 'default',
  className,
  'aria-label': ariaLabel = 'Progress',
  ...rest
}) {
  const maxReached = Math.max(furthest ?? current, current);

  /**
   * Reachability, computed once per render by walking forward and stopping at
   * the first blocked step. Anything at or before `maxReached` is always
   * reachable (the user has already been there).
   */
  const reachable = useMemo(() => {
    const result = [];
    let blocked = false;
    for (let i = 0; i < steps.length; i += 1) {
      if (i <= maxReached) {
        result.push(!blocked || i <= maxReached);
        continue;
      }
      if (blocked) {
        result.push(false);
        continue;
      }
      const guard = steps[i]?.canEnter;
      const ok = typeof guard === 'function' ? Boolean(guard({ index: i, current, furthest: maxReached })) : true;
      result.push(ok);
      if (!ok) blocked = true;
    }
    return result;
  }, [steps, current, maxReached]);

  const isVertical = orientation === 'vertical';
  const interactive = typeof onStepChange === 'function';

  const handleSelect = useCallback(
    (index) => {
      if (!interactive || !reachable[index] || index === current) return;
      onStepChange(index);
    },
    [interactive, reachable, current, onStepChange],
  );

  return (
    <nav aria-label={ariaLabel} className={cn('w-full', className)} {...rest}>
      <ol
        className={cn(
          'flex',
          isVertical ? 'flex-col gap-0' : 'w-full items-start',
          variant === 'dots' && !isVertical && 'items-center justify-center gap-2',
        )}
      >
        {steps.map((step, index) => {
          const state =
            index < current ? 'complete' : index === current ? 'current' : 'upcoming';
          const canGo = reachable[index];
          const isLocked = !canGo && state === 'upcoming';
          const isLast = index === steps.length - 1;

          if (variant === 'dots') {
            return (
              <li key={step.id ?? index}>
                <button
                  type="button"
                  onClick={() => handleSelect(index)}
                  disabled={!interactive || !canGo}
                  aria-current={state === 'current' ? 'step' : undefined}
                  aria-label={`Step ${index + 1}${step.label ? `: ${step.label}` : ''}`}
                  className={cn(
                    'block h-2 rounded-pill transition-all duration-200',
                    state === 'current'
                      ? 'w-6 bg-gradient-to-r from-primary-600 to-accent-700 dark:from-primary-400 dark:to-accent-300'
                      : 'w-2',
                    state === 'complete' && 'bg-primary-400',
                    state === 'upcoming' && 'bg-neutral-300',
                    interactive && canGo ? 'cursor-pointer' : 'cursor-default',
                    'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
                  )}
                />
              </li>
            );
          }

          const indicator = (
            <span
              aria-hidden="true"
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-pill border-2',
                'font-body text-label-md transition-colors duration-200',
                state === 'complete' &&
                  'border-transparent bg-gradient-to-br from-primary-600 to-accent-700 text-white ' +
                  'dark:from-primary-400 dark:to-accent-300',
                state === 'current' &&
                  'border-primary-600 bg-surface text-primary-700 shadow-focus dark:border-primary-500',
                state === 'upcoming' && 'border-default bg-surface text-subtle',
              )}
            >
              {state === 'complete' ? (
                <CheckIcon className="h-4 w-4" />
              ) : isLocked ? (
                <LockIcon className="h-4 w-4" />
              ) : (
                index + 1
              )}
            </span>
          );

          const text = variant !== 'compact' && (
            <span className={cn('flex min-w-0 flex-col', isVertical ? 'pb-6 pt-0.5' : 'mt-2')}>
              <span
                className={cn(
                  'font-body text-label-md',
                  state === 'current' ? 'text-default' : 'text-muted',
                )}
              >
                {step.label}
              </span>
              {step.description && (
                <span className="mt-0.5 text-caption text-subtle">{step.description}</span>
              )}
              {step.optional && (
                <span className="mt-0.5 text-caption italic text-subtle">Optional</span>
              )}
            </span>
          );

          const inner = (
            <span
              className={cn(
                'flex',
                isVertical ? 'flex-row items-start gap-3' : 'flex-col items-center text-center',
              )}
            >
              {indicator}
              {text}
            </span>
          );

          return (
            <li
              key={step.id ?? index}
              aria-current={state === 'current' ? 'step' : undefined}
              className={cn(
                'relative',
                isVertical ? 'flex flex-col' : 'flex flex-1 items-start',
                !isVertical && isLast && 'flex-none',
              )}
            >
              {/* Connector. Drawn behind the indicator, coloured by whether the
                  step BEFORE it is complete. */}
              {!isLast && (
                <span
                  aria-hidden="true"
                  className={cn(
                    'absolute transition-colors duration-300',
                    isVertical
                      ? 'left-4 top-9 h-[calc(100%-2.25rem)] w-0.5 -translate-x-1/2'
                      : 'left-[calc(50%+1.5rem)] right-0 top-4 h-0.5 -translate-y-1/2',
                    index < current
                      ? 'bg-gradient-to-r from-primary-600 to-accent-700 dark:from-primary-400 dark:to-accent-300'
                      : 'bg-neutral-200',
                  )}
                  style={
                    !isVertical
                      ? { right: 'calc(-50% + 1.5rem)', left: 'calc(50% + 1.5rem)' }
                      : undefined
                  }
                />
              )}

              {interactive ? (
                <button
                  type="button"
                  onClick={() => handleSelect(index)}
                  disabled={!canGo}
                  aria-disabled={!canGo || undefined}
                  className={cn(
                    'relative z-raised rounded-field p-1 outline-none',
                    'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
                    'focus-visible:ring-offset-canvas',
                    canGo && index !== current ? 'cursor-pointer' : 'cursor-default',
                    !canGo && 'opacity-60',
                    !isVertical && 'w-full',
                  )}
                  title={isLocked ? 'Complete the earlier steps first' : undefined}
                >
                  {inner}
                </button>
              ) : (
                <span className={cn('relative z-raised p-1', !isVertical && 'w-full')}>{inner}</span>
              )}

              <span className="ui-sr-only">
                {`Step ${index + 1} of ${steps.length}: ${
                  state === 'complete' ? 'completed' : state === 'current' ? 'current step' : 'not started'
                }`}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export default Stepper;
