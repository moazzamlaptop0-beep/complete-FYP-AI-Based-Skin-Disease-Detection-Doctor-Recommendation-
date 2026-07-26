import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';
import IconButton from './IconButton';
import { CloseIcon } from './Modal';

const TONES = {
  info: {
    container: 'bg-primary-50 border-primary-200 text-primary-900 dark:text-primary-900',
    icon: 'text-primary-700',
    title: 'text-primary-900',
    path: 'M12 16v-5m0-3.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  },
  success: {
    container: 'bg-success-50 border-success-200 text-success-900 dark:text-success-900',
    icon: 'text-success-600',
    title: 'text-success-900',
    path: 'm8 12.5 2.5 2.5L16 9.5M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  },
  warning: {
    container: 'bg-warning-50 border-warning-200 text-warning-900 dark:text-warning-900',
    icon: 'text-warning-600',
    title: 'text-warning-900',
    path: 'M12 9v4m0 3.5h.01M10.3 3.9 2.6 17.2A2 2 0 0 0 4.3 20.2h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  },
  danger: {
    container: 'bg-danger-50 border-danger-200 text-danger-900 dark:text-danger-900',
    icon: 'text-danger-600',
    title: 'text-danger-900',
    path: 'M12 8v5m0 3.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  },
  neutral: {
    container: 'bg-neutral-100 border-neutral-200 text-neutral-900',
    icon: 'text-neutral-600',
    title: 'text-neutral-900',
    path: 'M12 16v-5m0-3.5h.01M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  },
};

/**
 * Persistent inline message attached to a region of the page.
 *
 * Use an Alert for state that stays true (a form-level error, "your doctor
 * account is awaiting verification"); use a Toast for transient feedback.
 *
 * Live-region behaviour: `danger` renders `role="alert"` (assertive — it
 * interrupts, which is correct for a failure the user must act on) while every
 * other tone renders `role="status"` (polite). Override with `live`.
 *
 * @param {object} props
 * @param {'info'|'success'|'warning'|'danger'|'neutral'} [props.tone='info']
 * @param {React.ReactNode} [props.title] Bold first line.
 * @param {React.ReactNode} [props.icon] Custom icon; pass `null` to remove.
 * @param {React.ReactNode} [props.actions] Buttons/links under the body.
 * @param {() => void} [props.onDismiss] Renders a close button when provided.
 * @param {'polite'|'assertive'|'off'} [props.live] Override the live-region politeness.
 * @param {string} [props.className]
 * @param {React.ReactNode} props.children Body copy.
 */
const Alert = forwardRef(function Alert(
  { tone = 'info', title, icon, actions, onDismiss, live, className, children, ...rest },
  ref,
) {
  const preset = TONES[tone] ?? TONES.info;
  const politeness = live ?? (tone === 'danger' ? 'assertive' : 'polite');

  return (
    <div
      ref={ref}
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness === 'off' ? undefined : politeness}
      className={cn(
        'flex w-full items-start gap-3 rounded-card border p-4',
        preset.container,
        className,
      )}
      {...rest}
    >
      {icon !== null && (
        <span aria-hidden="true" className={cn('mt-0.5 shrink-0', preset.icon)}>
          {icon ?? (
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
              <path
                d={preset.path}
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      )}

      <div className="min-w-0 flex-1">
        {title && (
          <p className={cn('font-body text-label-lg', preset.title)}>{title}</p>
        )}
        {children && (
          <div className={cn('text-body-sm', title && 'mt-1', 'opacity-90')}>{children}</div>
        )}
        {actions && <div className="mt-3 flex flex-wrap items-center gap-2">{actions}</div>}
      </div>

      {onDismiss && (
        <IconButton
          aria-label="Dismiss message"
          size="sm"
          variant="ghost"
          onClick={onDismiss}
          className="-mr-1 -mt-1 shrink-0 text-current hover:bg-black/5 dark:hover:bg-black/10"
        >
          <CloseIcon />
        </IconButton>
      )}
    </div>
  );
});

export { Alert };
export default Alert;
