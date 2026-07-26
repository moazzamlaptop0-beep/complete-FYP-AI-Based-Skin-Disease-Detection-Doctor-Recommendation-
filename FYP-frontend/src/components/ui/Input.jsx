import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';
import { useControlA11y } from './Field';

/** Shared chrome for Input / Textarea / Select so the three never drift. */
export const controlBase =
  'w-full bg-surface font-body text-default placeholder:text-subtle ' +
  'border border-default rounded-field shadow-inner-soft ' +
  'transition-[border-color,box-shadow,background-color] duration-150 ease-emphasized ' +
  'outline-none focus-visible:border-primary-500 focus-visible:ring-2 focus-visible:ring-focus/35 ' +
  'disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-subtle disabled:shadow-none ' +
  'read-only:bg-surface-sunken';

export const controlInvalid =
  'border-danger-500 focus-visible:border-danger-500 focus-visible:ring-danger-500/35';

export const controlSizes = {
  sm: 'h-9 px-3 text-body-sm',
  md: 'h-11 px-3.5 text-body-md',
  lg: 'h-12 px-4 text-body-lg',
};

/**
 * Single-line text control.
 *
 * When wrapped in a `<Field>` the id, `aria-describedby`, `aria-invalid`,
 * `required` and `disabled` state are inherited automatically — do not repeat
 * them. Used standalone, pass `hint`/`error` and it wires its own ids.
 *
 * @param {object} props
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {React.ReactNode} [props.leftIcon] Decorative icon inside the left edge.
 * @param {React.ReactNode} [props.rightIcon] Decorative icon inside the right edge.
 * @param {React.ReactNode} [props.suffix] Interactive trailing slot (e.g. a reveal-password button).
 * @param {string} [props.error] Standalone error text (prefer `<Field error>`).
 * @param {string} [props.hint] Standalone hint text (prefer `<Field hint>`).
 * @param {string} [props.type='text']
 * @param {boolean} [props.disabled]
 * @param {string} [props.className] Applied to the <input>.
 * @param {string} [props.wrapperClassName] Applied to the positioning wrapper.
 */
const Input = forwardRef(function Input(
  {
    size = 'md',
    leftIcon,
    rightIcon,
    suffix,
    error,
    hint,
    type = 'text',
    className,
    wrapperClassName,
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
  const hasLeft = Boolean(leftIcon);
  const hasRight = Boolean(rightIcon || suffix);

  return (
    <div className={cn('relative flex w-full items-center', wrapperClassName)}>
      {hasLeft && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute left-3 flex items-center text-subtle"
        >
          {leftIcon}
        </span>
      )}
      <input
        ref={ref}
        id={a11y.id}
        type={type}
        required={a11y.required || undefined}
        disabled={a11y.disabled || undefined}
        aria-invalid={a11y.invalid || undefined}
        aria-describedby={a11y.describedBy}
        aria-required={a11y.required || undefined}
        className={cn(
          controlBase,
          controlSizes[size] ?? controlSizes.md,
          type === 'number' && 'ui-no-spinner',
          hasLeft && 'pl-10',
          hasRight && 'pr-10',
          a11y.invalid && controlInvalid,
          className,
        )}
        {...rest}
      />
      {hasRight && (
        <span
          aria-hidden={rightIcon && !suffix ? 'true' : undefined}
          className={cn(
            'absolute right-3 flex items-center text-subtle',
            rightIcon && !suffix && 'pointer-events-none',
          )}
        >
          {suffix ?? rightIcon}
        </span>
      )}
    </div>
  );
});

export { Input };
export default Input;
