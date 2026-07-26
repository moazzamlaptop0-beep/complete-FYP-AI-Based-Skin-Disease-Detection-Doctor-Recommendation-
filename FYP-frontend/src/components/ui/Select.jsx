import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';
import { useControlA11y } from './Field';
import { controlBase, controlInvalid, controlSizes } from './Input';

/**
 * @typedef {object} SelectOption
 * @property {string|number} value
 * @property {string} label
 * @property {boolean} [disabled]
 */

/**
 * Native `<select>` with the shared control chrome.
 *
 * Deliberately native: a custom listbox would need its own roving-tabindex
 * implementation and would lose the OS picker on mobile, which matters for the
 * patient-facing flows. Pass `options` or plain `<option>` children.
 *
 * @param {object} props
 * @param {SelectOption[]} [props.options] Convenience alternative to children.
 * @param {string} [props.placeholder] Renders a disabled, selected-by-default first option.
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {string} [props.error] Standalone error text (prefer `<Field error>`).
 * @param {string} [props.hint] Standalone hint text (prefer `<Field hint>`).
 * @param {string} [props.className]
 * @param {React.ReactNode} [props.children]
 */
const Select = forwardRef(function Select(
  {
    options,
    placeholder,
    size = 'md',
    error,
    hint,
    className,
    children,
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

  return (
    <div className="relative flex w-full items-center">
      <select
        ref={ref}
        id={a11y.id}
        required={a11y.required || undefined}
        disabled={a11y.disabled || undefined}
        aria-invalid={a11y.invalid || undefined}
        aria-describedby={a11y.describedBy}
        aria-required={a11y.required || undefined}
        className={cn(
          controlBase,
          controlSizes[size] ?? controlSizes.md,
          'cursor-pointer appearance-none pr-10',
          a11y.invalid && controlInvalid,
          className,
        )}
        {...rest}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options
          ? options.map((opt) => (
              <option key={opt.value} value={opt.value} disabled={opt.disabled}>
                {opt.label}
              </option>
            ))
          : children}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 20 20"
        fill="none"
        className="pointer-events-none absolute right-3.5 h-4 w-4 text-subtle"
      >
        <path
          d="m6 8 4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
});

export { Select };
export default Select;
