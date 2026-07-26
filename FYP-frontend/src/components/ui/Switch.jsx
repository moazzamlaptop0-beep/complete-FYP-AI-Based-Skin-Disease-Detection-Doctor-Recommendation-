import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';
import { useControlA11y } from './Field';

/**
 * `travel` uses an explicit child selector because the thumb is a DESCENDANT
 * of the track, and `peer-checked:` on its own can only reach siblings of the
 * hidden input.
 */
const SIZES = {
  sm: { track: 'h-5 w-9', thumb: 'h-3.5 w-3.5', travel: 'peer-checked:[&>span]:translate-x-4' },
  md: { track: 'h-6 w-11', thumb: 'h-[18px] w-[18px]', travel: 'peer-checked:[&>span]:translate-x-5' },
  lg: { track: 'h-7 w-[3.25rem]', thumb: 'h-5 w-5', travel: 'peer-checked:[&>span]:translate-x-6' },
};

/**
 * On/off toggle for settings that apply immediately (no Save button).
 *
 * Built on a native checkbox with `role="switch"`, which gives free keyboard
 * support (Space toggles), free form participation and correct
 * "on"/"off" announcements. Use `<Checkbox>` instead for anything that is
 * submitted with a form or represents consent.
 *
 * @param {object} props
 * @param {React.ReactNode} [props.label] Text shown beside the track.
 * @param {React.ReactNode} [props.description] Secondary line under the label.
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {'right'|'left'} [props.labelPosition='right'] Which side the label sits on.
 * @param {boolean} [props.checked]
 * @param {(event: React.ChangeEvent<HTMLInputElement>) => void} [props.onChange]
 * @param {boolean} [props.disabled]
 * @param {string} [props.className] Applied to the wrapping <label>.
 */
const Switch = forwardRef(function Switch(
  {
    label,
    description,
    size = 'md',
    labelPosition = 'right',
    className,
    id,
    required,
    disabled,
    error,
    hint,
    'aria-describedby': ariaDescribedBy,
    ...rest
  },
  ref,
) {
  const a11y = useControlA11y({
    id,
    required,
    disabled,
    error,
    hint,
    'aria-describedby': ariaDescribedBy,
  });
  const preset = SIZES[size] ?? SIZES.md;

  const text = (label || description) && (
    <span className="flex flex-col gap-0.5">
      {label && <span className="font-body text-body-sm font-medium text-default">{label}</span>}
      {description && <span className="text-caption text-subtle">{description}</span>}
    </span>
  );

  return (
    <label
      htmlFor={a11y.id}
      className={cn(
        'inline-flex items-center gap-3',
        labelPosition === 'left' && 'flex-row-reverse justify-between',
        a11y.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      <span className="relative inline-flex shrink-0 items-center">
        <input
          ref={ref}
          id={a11y.id}
          type="checkbox"
          role="switch"
          disabled={a11y.disabled || undefined}
          aria-describedby={a11y.describedBy}
          className="peer absolute h-0 w-0 opacity-0"
          {...rest}
        />
        <span
          aria-hidden="true"
          className={cn(
            'flex items-center rounded-pill bg-neutral-300 p-0.5',
            'transition-colors duration-200 ease-emphasized',
            'peer-checked:bg-primary-900 dark:peer-checked:bg-primary-600',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-focus peer-focus-visible:ring-offset-2',
            'peer-focus-visible:ring-offset-canvas',
            '[&>span]:transition-transform [&>span]:duration-200 [&>span]:ease-emphasized',
            preset.travel,
            preset.track,
          )}
        >
          <span
            className={cn(
              'block rounded-pill bg-white shadow-soft ease-emphasized',
              preset.thumb,
            )}
          />
        </span>
      </span>
      {text}
    </label>
  );
});

export { Switch };
export default Switch;
