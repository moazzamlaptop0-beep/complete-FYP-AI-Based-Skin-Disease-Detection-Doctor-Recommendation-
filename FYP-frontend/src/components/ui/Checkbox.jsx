import React, { forwardRef, useCallback, useEffect, useRef } from 'react';
import { cn } from '../../lib/cn';
import { useControlA11y } from './Field';

const SIZES = {
  sm: 'h-4 w-4 rounded-[5px]',
  md: 'h-5 w-5 rounded-md',
  lg: 'h-6 w-6 rounded-md',
};

/**
 * Checkbox with a real `<input type="checkbox">` underneath a styled box.
 *
 * The input is `sr-only`-positioned rather than `display:none`, so it keeps
 * native focus, native form participation and native `indeterminate` support.
 * Focus styling is driven off `peer-focus-visible`.
 *
 * @param {object} props
 * @param {React.ReactNode} [props.label] Inline label text.
 * @param {React.ReactNode} [props.description] Secondary line under the label.
 * @param {boolean} [props.indeterminate=false] Renders the mixed state and sets `aria-checked="mixed"`.
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {string} [props.error] Standalone error text (prefer `<Field error>`).
 * @param {boolean} [props.checked]
 * @param {(event: React.ChangeEvent<HTMLInputElement>) => void} [props.onChange]
 * @param {string} [props.className] Applied to the wrapping <label>.
 */
const Checkbox = forwardRef(function Checkbox(
  {
    label,
    description,
    indeterminate = false,
    size = 'md',
    error,
    hint,
    className,
    id,
    required,
    disabled,
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
  const innerRef = useRef(null);

  const setRefs = useCallback(
    (node) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  useEffect(() => {
    if (innerRef.current) innerRef.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label
      htmlFor={a11y.id}
      className={cn(
        'group inline-flex items-start gap-2.5',
        a11y.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      <span className="relative inline-flex shrink-0 items-center justify-center pt-0.5">
        <input
          ref={setRefs}
          id={a11y.id}
          type="checkbox"
          required={a11y.required || undefined}
          disabled={a11y.disabled || undefined}
          aria-invalid={a11y.invalid || undefined}
          aria-describedby={a11y.describedBy}
          aria-checked={indeterminate ? 'mixed' : undefined}
          className="peer absolute h-0 w-0 opacity-0"
          {...rest}
        />
        <span
          aria-hidden="true"
          className={cn(
            'flex items-center justify-center border border-strong bg-surface text-white',
            'transition-[background-color,border-color,box-shadow] duration-150 ease-emphasized',
            'peer-checked:border-primary-900 peer-checked:bg-primary-900',
            'peer-indeterminate:border-primary-900 peer-indeterminate:bg-primary-900',
            'dark:peer-checked:border-primary-600 dark:peer-checked:bg-primary-600',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-focus peer-focus-visible:ring-offset-2',
            'peer-focus-visible:ring-offset-canvas',
            // the tick is a *descendant*, so the peer variant needs an explicit
            // child selector — `peer-checked:` alone only reaches siblings
            'peer-checked:[&_svg]:scale-100',
            a11y.invalid && 'border-danger-500',
            SIZES[size] ?? SIZES.md,
          )}
        >
          {indeterminate ? (
            <svg viewBox="0 0 16 16" className="h-full w-full p-[3px]" fill="none">
              <path d="M3.5 8h9" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" />
            </svg>
          ) : (
            <svg
              viewBox="0 0 16 16"
              className="h-full w-full scale-0 p-[2px] transition-transform duration-150"
              fill="none"
            >
              <path
                d="m3.5 8.5 3 3 6-6.5"
                stroke="currentColor"
                strokeWidth="2.25"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
      </span>

      {(label || description) && (
        <span className="flex flex-col gap-0.5">
          {label && (
            <span className="font-body text-body-sm font-medium text-default">
              {label}
              {a11y.required && (
                <span className="ml-0.5 text-danger-600" aria-hidden="true">
                  *
                </span>
              )}
            </span>
          )}
          {description && <span className="text-caption text-subtle">{description}</span>}
        </span>
      )}
    </label>
  );
});

export { Checkbox };
export default Checkbox;
