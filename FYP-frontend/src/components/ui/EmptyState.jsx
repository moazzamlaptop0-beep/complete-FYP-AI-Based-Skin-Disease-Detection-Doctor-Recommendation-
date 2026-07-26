import React from 'react';
import { cn } from '../../lib/cn';

const SIZES = {
  sm: { wrap: 'py-8 px-4', icon: 'h-10 w-10', title: 'text-heading-sm', body: 'text-body-sm' },
  md: { wrap: 'py-12 px-6', icon: 'h-14 w-14', title: 'text-heading-md', body: 'text-body-md' },
  lg: { wrap: 'py-20 px-6', icon: 'h-16 w-16', title: 'text-heading-lg', body: 'text-body-lg' },
};

const TONES = {
  neutral: 'bg-neutral-100 text-neutral-500',
  primary: 'bg-primary-50 text-primary-700',
  accent: 'bg-accent-50 text-accent-700',
  success: 'bg-success-50 text-success-700',
  warning: 'bg-warning-50 text-warning-700',
  danger: 'bg-danger-50 text-danger-600',
};

/**
 * Placeholder for a region with nothing to show.
 *
 * Three distinct situations get conflated in the current pages — all of them
 * render as a blank div. Use `tone` + copy to keep them apart:
 *   - nothing yet ("No scans yet") -> `tone="neutral"` + a primary action
 *   - filtered to nothing        -> `tone="primary"` + a "Clear filters" action
 *   - failed to load             -> `tone="danger"` + a "Retry" action
 *
 * Semantics: the icon is decorative; the heading is a real heading so the
 * region shows up in a screen-reader's outline instead of being an orphan
 * paragraph.
 *
 * @param {object} props
 * @param {React.ReactNode} [props.icon] Decorative glyph.
 * @param {React.ReactNode} props.title Short statement of what is missing.
 * @param {React.ReactNode} [props.description] One or two lines of guidance.
 * @param {React.ReactNode} [props.action] Primary control (usually a `<Button>`).
 * @param {React.ReactNode} [props.secondaryAction]
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {'neutral'|'primary'|'accent'|'success'|'warning'|'danger'} [props.tone='neutral']
 * @param {boolean} [props.bordered=false] Dashed container, for drop zones / slots.
 * @param {'h2'|'h3'|'h4'|'p'} [props.titleAs='h3']
 * @param {string} [props.className]
 * @param {React.ReactNode} [props.children] Extra content under the description.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  size = 'md',
  tone = 'neutral',
  bordered = false,
  titleAs: Title = 'h3',
  className,
  children,
  ...rest
}) {
  const preset = SIZES[size] ?? SIZES.md;

  return (
    <div
      className={cn(
        'flex w-full flex-col items-center justify-center text-center',
        preset.wrap,
        bordered && 'rounded-card border-2 border-dashed border-default',
        className,
      )}
      {...rest}
    >
      {icon && (
        <span
          aria-hidden="true"
          className={cn(
            'mb-4 flex items-center justify-center rounded-pill',
            preset.icon,
            TONES[tone] ?? TONES.neutral,
            '[&_svg]:h-1/2 [&_svg]:w-1/2',
          )}
        >
          {icon}
        </span>
      )}

      {title && (
        <Title className={cn('font-heading text-default', preset.title)}>{title}</Title>
      )}

      {description && (
        <p className={cn('mt-2 max-w-md text-muted', preset.body)}>{description}</p>
      )}

      {children && <div className="mt-4 w-full max-w-md">{children}</div>}

      {(action || secondaryAction) && (
        <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

export default EmptyState;
