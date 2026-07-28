/**
 * SensitivityToggle — "this photo is sensitive".
 *
 * Flipping it sends `is_sensitive=true` as a multipart field on POST /predict.
 * The backend then serves the BLURRED variant of `/api/scans/<id>/image` to
 * everyone, and only an explicit `?variant=full` — which is written to the image
 * access log — reveals it. The owner always sees their own photo sharp.
 *
 * It sits on the capture step, before the upload, because after the file has
 * been sent the damage is already done. Turning it on later (from the scans
 * page, via PATCH /api/scans/<id>/sensitivity) is a repair; turning it on here
 * is a choice.
 *
 * THEMING NOTE
 * ------------
 * The "on" panel used to carry `dark:border-accent-800 dark:bg-accent-950/40`
 * on top of `border-accent-300 bg-accent-50`. The accent scale RE-RAMPS in dark
 * mode (accent-50 resolves to rgb(5 41 29) there), so the base classes already
 * produce a dark teal wash and the overrides were fighting a flip that had
 * already happened. Both are gone.
 */

import React from 'react';
import { EyeOff, Lock } from 'lucide-react';

import { Switch, cn } from '../../../components/ui';

/**
 * @param {object} props
 * @param {boolean} props.value
 * @param {(next: boolean) => void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {string} [props.className]
 */
export default function SensitivityToggle({ value, onChange, disabled, className }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-card border p-4 transition-colors',
        value ? 'border-accent-300 bg-accent-50' : 'border-default bg-surface-sunken',
        className,
      )}
    >
      {/* A quiet edge marker, so "on" is legible at a glance and not only from
          the switch position. Purely decorative. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 left-0 w-1 transition-colors',
          value ? 'bg-accent-400' : 'bg-transparent',
        )}
      />

      <p className="mb-2.5 flex items-center gap-2 text-overline uppercase text-subtle">
        <Lock aria-hidden="true" className="h-3 w-3 shrink-0" />
        Privacy
      </p>

      <Switch
        checked={Boolean(value)}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        labelPosition="left"
        className="w-full items-start justify-between gap-4"
        label={
          <span className="flex items-center gap-2">
            <EyeOff
              aria-hidden="true"
              className={cn(
                'h-4 w-4 shrink-0',
                value ? 'text-accent-700 dark:text-accent-400' : 'text-subtle',
              )}
            />
            This photo is sensitive
          </span>
        }
        description="Doctors and admins see a blurred placeholder unless they deliberately open the full image, and every one of those views is logged. You always see it sharp."
      />
    </div>
  );
}
