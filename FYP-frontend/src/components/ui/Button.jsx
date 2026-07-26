import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';
import Spinner from './Spinner';

/**
 * Shared focus treatment. Uses `focus-visible` so mouse users never see a ring
 * but keyboard users always do.
 */
export const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-canvas';

const BASE =
  'relative inline-flex items-center justify-center gap-2 whitespace-nowrap font-body font-semibold ' +
  'select-none transition-[background-color,border-color,color,box-shadow,transform] duration-150 ' +
  'ease-emphasized active:translate-y-px ' +
  'disabled:pointer-events-none disabled:opacity-55 aria-disabled:pointer-events-none aria-disabled:opacity-55 ' +
  focusRing;

const VARIANTS = {
  primary:
    'bg-primary-900 text-white shadow-soft hover:bg-primary-950 ' +
    'dark:bg-primary-600 dark:text-primary-50 dark:hover:bg-primary-500',
  secondary:
    'bg-accent-400 text-primary-950 shadow-soft hover:bg-accent-500 ' +
    'dark:bg-accent-400 dark:text-primary-50 dark:hover:bg-accent-500',
  outline:
    'bg-transparent text-primary-900 border border-strong hover:bg-primary-50 hover:border-primary-300 ' +
    'dark:text-primary-800 dark:hover:bg-surface-raised',
  ghost:
    'bg-transparent text-muted hover:bg-surface-sunken hover:text-default',
  danger:
    'bg-danger-600 text-white shadow-soft hover:bg-danger-700 ' +
    'focus-visible:ring-danger-500 dark:text-danger-50',
  success:
    'bg-success-600 text-white shadow-soft hover:bg-success-700 ' +
    'focus-visible:ring-success-500 dark:text-success-50',
  link:
    'bg-transparent text-primary-700 underline-offset-4 hover:underline hover:text-primary-900 ' +
    'p-0 h-auto shadow-none active:translate-y-0 dark:text-primary-600',
};

const SIZES = {
  sm: 'h-9 px-3.5 text-label-md rounded-control',
  md: 'h-11 px-5 text-label-lg rounded-field',
  lg: 'h-12 px-7 text-body-md font-bold rounded-field',
  icon: 'h-11 w-11 p-0 rounded-field',
};

const SPINNER_SIZE = { sm: 'xs', md: 'sm', lg: 'sm', icon: 'sm' };

/**
 * The one button in the system. Replaces the 146 hand-rolled `<button>`s.
 *
 * Keyboard/AT behaviour:
 *  - `loading` sets `aria-busy` and blocks clicks without setting `disabled`,
 *    so the button keeps focus (a `disabled` element loses it, which strands
 *    keyboard users mid-form).
 *  - When rendered as a non-button element via `as`, `role="button"`,
 *    `tabIndex` and Space/Enter activation are wired automatically.
 *  - Icons are `aria-hidden`; give icon-only buttons an `aria-label`
 *    (or just use `<IconButton>`, which requires one).
 *
 * @param {object} props
 * @param {'primary'|'secondary'|'outline'|'ghost'|'danger'|'success'|'link'} [props.variant='primary']
 * @param {'sm'|'md'|'lg'|'icon'} [props.size='md']
 * @param {boolean} [props.loading=false] Shows a spinner and blocks activation.
 * @param {string} [props.loadingText] Replaces children while loading.
 * @param {React.ReactNode} [props.leftIcon] Icon before the label.
 * @param {React.ReactNode} [props.rightIcon] Icon after the label.
 * @param {boolean} [props.fullWidth=false] Stretch to the container width.
 * @param {React.ElementType} [props.as='button'] Polymorphic element (e.g. `Link`, `'a'`).
 * @param {'button'|'submit'|'reset'} [props.type='button'] Only applied when `as` is a button.
 * @param {boolean} [props.disabled]
 * @param {string} [props.className]
 * @param {React.ReactNode} [props.children]
 */
const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingText,
    leftIcon,
    rightIcon,
    fullWidth = false,
    as: Component = 'button',
    type = 'button',
    disabled = false,
    className,
    children,
    onClick,
    onKeyDown,
    ...rest
  },
  ref,
) {
  const isNativeButton = Component === 'button';
  const inert = disabled || loading;

  const handleClick = (event) => {
    if (inert) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };

  // Non-button elements do not activate on Space/Enter for free.
  const handleKeyDown = (event) => {
    onKeyDown?.(event);
    if (isNativeButton || event.defaultPrevented) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      handleClick(event);
    }
  };

  const iconOnly = size === 'icon';

  return (
    <Component
      ref={ref}
      type={isNativeButton ? type : undefined}
      disabled={isNativeButton ? inert : undefined}
      role={isNativeButton ? undefined : 'button'}
      tabIndex={isNativeButton ? undefined : inert ? -1 : 0}
      aria-disabled={inert || undefined}
      aria-busy={loading || undefined}
      data-loading={loading ? '' : undefined}
      data-variant={variant}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        BASE,
        VARIANTS[variant] ?? VARIANTS.primary,
        variant !== 'link' && (SIZES[size] ?? SIZES.md),
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading && (
        <Spinner
          size={SPINNER_SIZE[size] ?? 'sm'}
          label={null}
          className={cn(iconOnly && 'absolute inset-0 m-auto')}
        />
      )}
      {!iconOnly && leftIcon && !loading && (
        <span aria-hidden="true" className="inline-flex shrink-0 items-center">
          {leftIcon}
        </span>
      )}
      <span className={cn('inline-flex items-center', loading && iconOnly && 'invisible')}>
        {loading && loadingText ? loadingText : children}
      </span>
      {!iconOnly && rightIcon && (
        <span aria-hidden="true" className="inline-flex shrink-0 items-center">
          {rightIcon}
        </span>
      )}
    </Component>
  );
});

export { Button };
export default Button;
