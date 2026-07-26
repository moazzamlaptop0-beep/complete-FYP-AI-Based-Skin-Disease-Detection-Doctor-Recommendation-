import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

const SIZES = {
  xs: 'h-1',
  sm: 'h-1.5',
  md: 'h-2.5',
  lg: 'h-4',
};

const TONES = {
  primary: 'bg-primary-900 dark:bg-primary-600',
  accent: 'bg-accent-500',
  success: 'bg-success-600',
  warning: 'bg-warning-500',
  danger: 'bg-danger-600',
};

/**
 * Determinate or indeterminate progress bar.
 *
 * Accessibility: uses `role="progressbar"` with `aria-valuenow/min/max`. When
 * `indeterminate` is set, `aria-valuenow` is deliberately OMITTED — that is how
 * assistive tech distinguishes "50% done" from "working, duration unknown".
 *
 * The value is clamped to [min, max] because upload handlers routinely emit
 * 101% or negative deltas, and an unclamped bar overflows its track.
 *
 * @param {object} props
 * @param {number} [props.value=0]
 * @param {number} [props.min=0]
 * @param {number} [props.max=100]
 * @param {boolean} [props.indeterminate=false] Unknown duration.
 * @param {'xs'|'sm'|'md'|'lg'} [props.size='md']
 * @param {'primary'|'accent'|'success'|'warning'|'danger'} [props.tone='primary']
 * @param {React.ReactNode} [props.label] Visible label above the bar.
 * @param {boolean} [props.showValue=false] Render "42%" beside the label.
 * @param {string} [props.valueText] Override the announced text, e.g. "3 of 7 uploaded".
 * @param {boolean} [props.striped=false] Diagonal texture for "in transit" states.
 * @param {string} [props.className] Applied to the track.
 */
const Progress = forwardRef(function Progress(
  {
    value = 0,
    min = 0,
    max = 100,
    indeterminate = false,
    size = 'md',
    tone = 'primary',
    label,
    showValue = false,
    valueText,
    striped = false,
    className,
    ...rest
  },
  ref,
) {
  const span = max - min || 1;
  const clamped = Math.min(Math.max(Number(value) || 0, min), max);
  const percent = ((clamped - min) / span) * 100;
  const rounded = Math.round(percent);

  return (
    <div className="w-full">
      {(label || showValue) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-3">
          {label && <span className="font-body text-label-md text-default">{label}</span>}
          {showValue && !indeterminate && (
            <span className="font-numeric text-caption tabular-nums text-muted">
              {valueText ?? `${rounded}%`}
            </span>
          )}
        </div>
      )}

      <div
        ref={ref}
        role="progressbar"
        aria-valuemin={min}
        aria-valuemax={max}
        // Omitted when indeterminate — this is what signals "unknown duration".
        aria-valuenow={indeterminate ? undefined : clamped}
        aria-valuetext={indeterminate ? undefined : valueText ?? `${rounded}%`}
        aria-label={typeof label === 'string' ? label : rest['aria-label'] ?? 'Progress'}
        className={cn(
          'relative w-full overflow-hidden rounded-pill bg-neutral-200',
          SIZES[size] ?? SIZES.md,
          className,
        )}
        {...rest}
      >
        {indeterminate ? (
          <div
            className={cn(
              'absolute inset-y-0 left-0 w-full origin-left rounded-pill animate-ui-indeterminate',
              TONES[tone] ?? TONES.primary,
            )}
          />
        ) : (
          <div
            className={cn(
              'h-full rounded-pill transition-[width] duration-300 ease-emphasized',
              'motion-reduce:transition-none',
              TONES[tone] ?? TONES.primary,
              striped && 'ui-progress-striped',
            )}
            style={{ width: `${percent}%` }}
          />
        )}
      </div>
    </div>
  );
});

/**
 * Circular variant, for compact spots like a card corner or an avatar ring.
 *
 * @param {object} props
 * @param {number} [props.value=0] 0..100.
 * @param {number} [props.size=48] Diameter in px.
 * @param {number} [props.thickness=4] Stroke width in px.
 * @param {'primary'|'accent'|'success'|'warning'|'danger'} [props.tone='primary']
 * @param {boolean} [props.showValue=false] Render the percentage in the centre.
 * @param {string} [props.label] Accessible name.
 * @param {string} [props.className]
 */
export function CircularProgress({
  value = 0,
  size = 48,
  thickness = 4,
  tone = 'primary',
  showValue = false,
  label = 'Progress',
  className,
  ...rest
}) {
  const clamped = Math.min(Math.max(Number(value) || 0, 0), 100);
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);

  const STROKE = {
    primary: 'stroke-primary-900 dark:stroke-primary-600',
    accent: 'stroke-accent-500',
    success: 'stroke-success-600',
    warning: 'stroke-warning-500',
    danger: 'stroke-danger-600',
  };

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
      {...rest}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={thickness}
          className="stroke-neutral-200"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className={cn('transition-[stroke-dashoffset] duration-500 ease-emphasized', STROKE[tone] ?? STROKE.primary)}
        />
      </svg>
      {showValue && (
        <span className="absolute font-numeric text-caption font-semibold tabular-nums text-default">
          {Math.round(clamped)}
        </span>
      )}
    </div>
  );
}

export { Progress };
export default Progress;
