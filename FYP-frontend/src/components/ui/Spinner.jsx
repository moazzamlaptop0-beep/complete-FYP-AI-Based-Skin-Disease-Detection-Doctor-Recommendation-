import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

const SIZES = {
  xs: 'h-3 w-3 border-[1.5px]',
  sm: 'h-4 w-4 border-2',
  md: 'h-5 w-5 border-2',
  lg: 'h-7 w-7 border-[2.5px]',
  xl: 'h-10 w-10 border-[3px]',
};

/**
 * Indeterminate loading indicator.
 *
 * Rendered as a bordered ring rather than an SVG so it inherits `currentColor`
 * and can be dropped inside a Button without any color plumbing.
 *
 * Accessibility: when `label` is provided the spinner announces itself via
 * `role="status"`. Inside a Button the parent already owns `aria-busy`, so
 * pass `label={null}` there to avoid double announcements.
 *
 * @param {object} props
 * @param {'xs'|'sm'|'md'|'lg'|'xl'} [props.size='md'] Diameter preset.
 * @param {string|null} [props.label='Loading'] Screen-reader text; `null` hides it from AT.
 * @param {string} [props.className]
 */
const Spinner = forwardRef(function Spinner(
  { size = 'md', label = 'Loading', className, ...rest },
  ref,
) {
  const decorative = label === null || label === false;
  return (
    <span
      ref={ref}
      role={decorative ? undefined : 'status'}
      aria-hidden={decorative ? 'true' : undefined}
      className={cn('inline-flex shrink-0 items-center justify-center', className)}
      {...rest}
    >
      <span
        className={cn(
          'inline-block animate-spin rounded-full border-current border-r-transparent',
          'motion-reduce:animate-[spin_1.5s_linear_infinite]',
          SIZES[size] ?? SIZES.md,
        )}
      />
      {!decorative && <span className="ui-sr-only">{label}</span>}
    </span>
  );
});

export { Spinner };
export default Spinner;
