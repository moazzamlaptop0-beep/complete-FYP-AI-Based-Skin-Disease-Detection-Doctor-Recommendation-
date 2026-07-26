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
 */

import React from 'react';
import { EyeOff } from 'lucide-react';

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
        'rounded-card border p-4 transition-colors',
        value
          ? 'border-accent-300 bg-accent-50 dark:border-accent-800 dark:bg-accent-950/40'
          : 'border-subtle bg-surface-sunken',
        className,
      )}
    >
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
              className={cn('h-4 w-4 shrink-0', value ? 'text-accent-600' : 'text-subtle')}
            />
            This photo is sensitive
          </span>
        }
        description="Doctors and admins see a blurred placeholder unless they deliberately open the full image, and every one of those views is logged. You always see it sharp."
      />
    </div>
  );
}
