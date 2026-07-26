import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';
import Button from './Button';

const SIZES = {
  sm: 'h-8 w-8 rounded-control [&_svg]:h-4 [&_svg]:w-4',
  md: 'h-10 w-10 rounded-field [&_svg]:h-[18px] [&_svg]:w-[18px]',
  lg: 'h-12 w-12 rounded-field [&_svg]:h-5 [&_svg]:w-5',
};

/**
 * Square, label-less button for a single icon.
 *
 * `aria-label` is REQUIRED — an icon-only control with no accessible name is
 * invisible to screen readers, and this is the single most common a11y defect
 * in the current codebase. In development a missing label logs an error.
 *
 * @param {object} props
 * @param {string} props.aria-label REQUIRED accessible name, e.g. "Close dialog".
 * @param {React.ReactNode} props.children The icon element.
 * @param {'primary'|'secondary'|'outline'|'ghost'|'danger'|'success'} [props.variant='ghost']
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {boolean} [props.loading=false]
 * @param {boolean} [props.disabled]
 * @param {React.ElementType} [props.as='button']
 * @param {string} [props.className]
 */
const IconButton = forwardRef(function IconButton(
  { variant = 'ghost', size = 'md', className, children, ...rest },
  ref,
) {
  const label = rest['aria-label'] ?? rest.ariaLabel;

  if (import.meta.env?.DEV && !label && !rest['aria-labelledby']) {
    console.error(
      '[ui/IconButton] Missing `aria-label`. Every icon-only button needs an ' +
        'accessible name. Example: <IconButton aria-label="Close dialog"><X /></IconButton>',
    );
  }

  return (
    <Button
      ref={ref}
      variant={variant}
      size="icon"
      className={cn('px-0', SIZES[size] ?? SIZES.md, className)}
      {...rest}
    >
      <span aria-hidden="true" className="inline-flex items-center justify-center">
        {children}
      </span>
    </Button>
  );
});

export { IconButton };
export default IconButton;
