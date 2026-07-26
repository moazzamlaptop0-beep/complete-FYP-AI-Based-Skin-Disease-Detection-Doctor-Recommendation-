import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

/**
 * Tone -> class map. Every tone is defined for BOTH themes because a badge is
 * usually the only saturated thing on a card, so a tone that only works on
 * white becomes unreadable the moment dark mode ships.
 */
const SOLID = {
  neutral: 'bg-neutral-600 text-white',
  primary: 'bg-primary-900 text-white dark:bg-primary-600',
  accent: 'bg-accent-700 text-white dark:bg-accent-400 dark:text-primary-50',
  success: 'bg-success-600 text-white',
  warning: 'bg-warning-600 text-white',
  danger: 'bg-danger-600 text-white',
};

const SOFT = {
  neutral: 'bg-neutral-100 text-neutral-700 ring-1 ring-inset ring-neutral-200',
  primary: 'bg-primary-50 text-primary-700 ring-1 ring-inset ring-primary-100',
  accent: 'bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-100',
  success: 'bg-success-50 text-success-700 ring-1 ring-inset ring-success-100',
  warning: 'bg-warning-50 text-warning-800 ring-1 ring-inset ring-warning-100',
  danger: 'bg-danger-50 text-danger-700 ring-1 ring-inset ring-danger-100',
};

const OUTLINE = {
  neutral: 'text-neutral-700 ring-1 ring-inset ring-neutral-300',
  primary: 'text-primary-700 ring-1 ring-inset ring-primary-300',
  accent: 'text-accent-700 ring-1 ring-inset ring-accent-300',
  success: 'text-success-700 ring-1 ring-inset ring-success-300',
  warning: 'text-warning-800 ring-1 ring-inset ring-warning-300',
  danger: 'text-danger-700 ring-1 ring-inset ring-danger-300',
};

const VARIANTS = { solid: SOLID, soft: SOFT, outline: OUTLINE };

const SIZES = {
  sm: 'h-5 px-2 text-[0.6875rem] gap-1',
  md: 'h-6 px-2.5 text-label-sm gap-1.5',
  lg: 'h-7 px-3 text-label-md gap-1.5',
};

const DOT_TONE = {
  neutral: 'bg-neutral-500',
  primary: 'bg-primary-600',
  accent: 'bg-accent-600',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
};

/**
 * Small status pill.
 *
 * Colour alone must never be the only signal (WCAG 1.4.1), so every preset
 * below also carries a distinct *word*, and `dot`/`icon` add a second visual
 * channel. `soft` is the default because a page full of solid badges reads as
 * an emergency.
 *
 * @param {object} props
 * @param {'neutral'|'primary'|'accent'|'success'|'warning'|'danger'} [props.tone='neutral']
 * @param {'solid'|'soft'|'outline'} [props.variant='soft']
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {boolean} [props.dot=false] Leading status dot.
 * @param {boolean} [props.pulse=false] Animate the dot (live/urgent states).
 * @param {React.ReactNode} [props.icon] Leading icon, overrides `dot`.
 * @param {boolean} [props.uppercase=false]
 * @param {React.ElementType} [props.as='span']
 * @param {string} [props.className]
 * @param {React.ReactNode} props.children
 */
const Badge = forwardRef(function Badge(
  {
    tone = 'neutral',
    variant = 'soft',
    size = 'md',
    dot = false,
    pulse = false,
    icon,
    uppercase = false,
    as: Component = 'span',
    className,
    children,
    ...rest
  },
  ref,
) {
  const palette = VARIANTS[variant] ?? SOFT;
  return (
    <Component
      ref={ref}
      className={cn(
        'inline-flex max-w-full items-center justify-center rounded-pill font-body font-semibold',
        'whitespace-nowrap align-middle',
        SIZES[size] ?? SIZES.md,
        palette[tone] ?? palette.neutral,
        uppercase && 'uppercase tracking-[0.06em]',
        className,
      )}
      {...rest}
    >
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0 items-center [&_svg]:h-3.5 [&_svg]:w-3.5">
          {icon}
        </span>
      ) : (
        dot && (
          <span aria-hidden="true" className="relative flex h-1.5 w-1.5 shrink-0">
            {pulse && (
              <span
                className={cn(
                  'absolute inline-flex h-full w-full animate-ping rounded-pill opacity-75',
                  DOT_TONE[tone] ?? DOT_TONE.neutral,
                )}
              />
            )}
            <span
              className={cn(
                'relative inline-flex h-1.5 w-1.5 rounded-pill',
                variant === 'solid' ? 'bg-current' : DOT_TONE[tone] ?? DOT_TONE.neutral,
              )}
            />
          </span>
        )
      )}
      <span className="truncate">{children}</span>
    </Component>
  );
});

/* ==========================================================================
   PRESETS
   ========================================================================== */

/**
 * Triage severity. Keys match the backend literals exactly (ROUTINE / URGENT /
 * CRITICAL) and lookup is case-insensitive so `"urgent"` from an API also works.
 */
export const SEVERITY_PRESETS = {
  ROUTINE: { tone: 'success', label: 'Routine', variant: 'soft' },
  URGENT: { tone: 'warning', label: 'Urgent', variant: 'soft', dot: true },
  CRITICAL: { tone: 'danger', label: 'Critical', variant: 'solid', dot: true, pulse: true },
};

/**
 * Severity pill for triage output.
 *
 * CRITICAL is deliberately the only `solid` + pulsing preset — it must win the
 * visual hierarchy against everything else on a doctor's queue.
 *
 * @param {object} props
 * @param {'ROUTINE'|'URGENT'|'CRITICAL'|string} props.severity
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {string} [props.className]
 */
export function SeverityBadge({ severity, size = 'md', className, ...rest }) {
  const key = String(severity ?? '').toUpperCase();
  const preset = SEVERITY_PRESETS[key];
  if (!preset) {
    return (
      <Badge tone="neutral" size={size} className={className} {...rest}>
        {severity ?? 'Unknown'}
      </Badge>
    );
  }
  return (
    <Badge
      tone={preset.tone}
      variant={preset.variant}
      dot={preset.dot}
      pulse={preset.pulse}
      size={size}
      uppercase
      className={className}
      {...rest}
    >
      <span className="ui-sr-only">Severity: </span>
      {preset.label}
    </Badge>
  );
}

/**
 * Workflow status presets. Keys are lower-cased backend values; lookup
 * normalises case and `-`/` ` to `_`.
 */
export const STATUS_PRESETS = {
  pending: { tone: 'warning', label: 'Pending', dot: true },
  approved: { tone: 'success', label: 'Approved' },
  rejected: { tone: 'danger', label: 'Rejected' },
  open: { tone: 'primary', label: 'Open', dot: true },
  closed: { tone: 'neutral', label: 'Closed' },
  confirmed: { tone: 'success', label: 'Confirmed' },
  scheduled: { tone: 'primary', label: 'Scheduled' },
  completed: { tone: 'success', label: 'Completed' },
  cancelled: { tone: 'neutral', label: 'Cancelled' },
  canceled: { tone: 'neutral', label: 'Cancelled' },
  expired: { tone: 'neutral', label: 'Expired' },
  active: { tone: 'success', label: 'Active', dot: true },
  inactive: { tone: 'neutral', label: 'Inactive' },
  in_progress: { tone: 'primary', label: 'In progress', dot: true, pulse: true },
  no_show: { tone: 'danger', label: 'No show' },
  draft: { tone: 'neutral', label: 'Draft' },
  submitted: { tone: 'primary', label: 'Submitted' },
  reviewed: { tone: 'accent', label: 'Reviewed' },
  verified: { tone: 'success', label: 'Verified' },
  unverified: { tone: 'warning', label: 'Unverified', dot: true },
};

/**
 * Badge for a backend status string. Unknown values degrade to a neutral badge
 * showing the raw value rather than rendering nothing — silently swallowing an
 * unrecognised status is how stale enums go unnoticed for months.
 *
 * @param {object} props
 * @param {string} props.status
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {'solid'|'soft'|'outline'} [props.variant='soft']
 * @param {string} [props.className]
 */
export function StatusBadge({ status, size = 'md', variant = 'soft', className, ...rest }) {
  const key = String(status ?? '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  const preset = STATUS_PRESETS[key];
  const label = preset?.label ?? (status ? String(status).replace(/_/g, ' ') : 'Unknown');

  return (
    <Badge
      tone={preset?.tone ?? 'neutral'}
      variant={variant}
      size={size}
      dot={preset?.dot}
      pulse={preset?.pulse}
      className={cn(!preset && 'capitalize', className)}
      {...rest}
    >
      {label}
    </Badge>
  );
}

/**
 * Role presets. Keys are the EXACT role literals the API uses — 'Admin',
 * 'Doctor', 'AI User' — which must not be renamed.
 */
export const ROLE_PRESETS = {
  Admin: { tone: 'danger', label: 'Admin' },
  Doctor: { tone: 'primary', label: 'Doctor' },
  'AI User': { tone: 'accent', label: 'Patient' },
};

/**
 * Badge for a user role.
 *
 * Note the label mapping: the stored literal is `'AI User'` but clinicians and
 * patients both read "Patient", so the badge shows the human word while the
 * value stays untouched.
 *
 * @param {object} props
 * @param {'Admin'|'Doctor'|'AI User'|string} props.role
 * @param {'sm'|'md'|'lg'} [props.size='sm']
 * @param {'solid'|'soft'|'outline'} [props.variant='soft']
 * @param {string} [props.className]
 */
export function RoleBadge({ role, size = 'sm', variant = 'soft', className, ...rest }) {
  const preset = ROLE_PRESETS[role];
  return (
    <Badge
      tone={preset?.tone ?? 'neutral'}
      variant={variant}
      size={size}
      className={className}
      {...rest}
    >
      {preset?.label ?? role ?? 'Unknown'}
    </Badge>
  );
}

export { Badge };
export default Badge;
