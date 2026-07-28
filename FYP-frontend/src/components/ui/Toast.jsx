import React from 'react';
import toast, { Toaster, ToastBar, resolveValue } from 'react-hot-toast';
import { cn } from '../../lib/cn';
import IconButton from './IconButton';
import { CloseIcon } from './Modal';
import Spinner from './Spinner';

/* ==========================================================================
   TOAST
   --------------------------------------------------------------------------
   A thin wrapper over react-hot-toast (already a dependency, already mounted
   by the app) so callers get design-system styling and consistent durations
   without every page inventing its own `toast.success(...)` string.

   The underlying `toast` object is re-exported, so nothing that already calls
   `toast.success()` directly breaks.
   ========================================================================== */

const TONES = {
  // Tonal icon-chip pattern (bg-{scale}-100 text-{scale}-700). The scales are
  // CSS-variable backed and flip on their own in dark mode.
  success: {
    ring: 'ring-success-200',
    icon: 'bg-success-100 text-success-700',
    path: 'm5 10.5 3 3 7-7',
  },
  error: {
    ring: 'ring-danger-200',
    icon: 'bg-danger-100 text-danger-700',
    path: 'M10 6v5m0 3h.01',
  },
  warning: {
    ring: 'ring-warning-200',
    icon: 'bg-warning-100 text-warning-700',
    path: 'M10 6v5m0 3h.01',
  },
  info: {
    ring: 'ring-info-200',
    icon: 'bg-info-100 text-info-700',
    path: 'M10 14V9m0-3h.01',
  },
  loading: {
    ring: 'ring-neutral-200',
    icon: 'bg-neutral-100 text-neutral-600',
    path: null,
  },
};

/** Durations tuned by severity: errors need longer to read than confirmations. */
const DURATIONS = {
  success: 3500,
  info: 4000,
  warning: 5000,
  error: 6000,
  loading: Infinity,
};

function ToastIcon({ tone }) {
  const preset = TONES[tone] ?? TONES.info;
  if (tone === 'loading') {
    return (
      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-pill', preset.icon)}>
        <Spinner size="sm" label={null} />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-pill', preset.icon)}
    >
      <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4">
        <path
          d={preset.path}
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

/**
 * Mount ONCE near the app root. Replaces a bare `<Toaster />` and styles every
 * toast — including ones fired by existing pages through the raw `toast` API.
 *
 * Accessibility: react-hot-toast renders an `aria-live` region for us; we keep
 * its default politeness (`polite` for most, `assertive` for errors) and only
 * take over the visual shell.
 *
 * @param {object} props
 * @param {'top-right'|'top-center'|'top-left'|'bottom-right'|'bottom-center'|'bottom-left'} [props.position='top-right']
 * @param {number} [props.gutter=10]
 * @param {object} [props.toastOptions] Passed through to react-hot-toast.
 */
export function ToastProvider({ position = 'top-right', gutter = 10, toastOptions, ...rest }) {
  return (
    <Toaster
      position={position}
      gutter={gutter}
      containerClassName="z-toast"
      toastOptions={{
        duration: DURATIONS.info,
        // Strip react-hot-toast's inline styling so ours is not fighting it.
        className: '',
        style: { background: 'transparent', boxShadow: 'none', padding: 0, margin: 0, maxWidth: 'none' },
        success: { duration: DURATIONS.success },
        error: { duration: DURATIONS.error },
        loading: { duration: DURATIONS.loading },
        ...toastOptions,
      }}
      {...rest}
    >
      {(t) => (
        <ToastBar toast={t} style={{ background: 'transparent', boxShadow: 'none', padding: 0 }}>
          {() => {
            const tone = t.type === 'blank' ? (t.tone ?? 'info') : t.type;
            const preset = TONES[tone] ?? TONES.info;
            return (
              <div
                className={cn(
                  'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-card',
                  'bg-surface-raised p-3.5 shadow-popover ring-1',
                  preset.ring,
                  t.visible ? 'animate-ui-slide-down' : 'opacity-0 transition-opacity duration-150',
                )}
              >
                <ToastIcon tone={tone} />
                <div className="min-w-0 flex-1 pt-0.5">
                  {t.title && (
                    <p className="font-body text-label-lg text-default">{t.title}</p>
                  )}
                  <div className={cn('text-body-sm text-muted', t.title && 'mt-0.5')}>
                    {resolveValue(t.message, t)}
                  </div>
                </div>
                {tone !== 'loading' && (
                  <IconButton
                    aria-label="Dismiss notification"
                    size="sm"
                    variant="ghost"
                    onClick={() => toast.dismiss(t.id)}
                    className="-mr-1 -mt-1 shrink-0"
                  >
                    <CloseIcon />
                  </IconButton>
                )}
              </div>
            );
          }}
        </ToastBar>
      )}
    </Toaster>
  );
}

/**
 * Typed helpers over `toast`. Prefer these to raw `toast.success(...)` so
 * durations and tones stay consistent.
 *
 * @example
 * notify.success('Scan uploaded');
 * notify.error('Upload failed', { title: 'Could not save' });
 * const id = notify.loading('Analysing…');
 * notify.dismiss(id);
 *
 * @example Promise flow
 * notify.promise(api.uploadScan(file), {
 *   loading: 'Uploading scan…',
 *   success: 'Scan uploaded',
 *   error: (e) => e.message ?? 'Upload failed',
 * });
 */
export const notify = {
  /** @param {React.ReactNode} message @param {object} [options] */
  success: (message, options) => toast.success(message, { duration: DURATIONS.success, ...options }),
  /** @param {React.ReactNode} message @param {object} [options] */
  error: (message, options) => toast.error(message, { duration: DURATIONS.error, ...options }),
  /** @param {React.ReactNode} message @param {object} [options] */
  warning: (message, options) =>
    toast(message, { duration: DURATIONS.warning, tone: 'warning', ...options }),
  /** @param {React.ReactNode} message @param {object} [options] */
  info: (message, options) => toast(message, { duration: DURATIONS.info, tone: 'info', ...options }),
  /** Returns the toast id so you can `dismiss` it once the work finishes. */
  loading: (message, options) => toast.loading(message, options),
  /**
   * @param {Promise<any>} promise
   * @param {{loading: React.ReactNode, success: React.ReactNode|((v: any) => React.ReactNode), error: React.ReactNode|((e: any) => React.ReactNode)}} messages
   */
  promise: (promise, messages, options) => toast.promise(promise, messages, options),
  dismiss: (id) => toast.dismiss(id),
  remove: (id) => toast.remove(id),
};

export { toast };
export default notify;
