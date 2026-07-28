import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';
import Button from './Button';

/**
 * Box + glyph metrics only. Everything else — fill, hover, press, focus ring,
 * disabled and loading — comes from `Button`, on purpose: an icon button that
 * grew its own palette is how a codebase ends up with two design systems.
 */
const SIZES = {
  sm: 'h-8 w-8 rounded-control [&_svg]:h-4 [&_svg]:w-4',
  md: 'h-10 w-10 rounded-field [&_svg]:h-[18px] [&_svg]:w-[18px]',
  lg: 'h-12 w-12 rounded-field [&_svg]:h-5 [&_svg]:w-5',
};

/**
 * Square, label-less button for a single icon.
 *
 * It is `Button` with `size="icon"` and a tighter box, so it inherits the whole
 * interaction model unchanged: the same three tonal steps per variant, the same
 * 1px press sink, the same `motion-reduce` behaviour, the same offset
 * focus-visible ring, and the same loading treatment (the glyph fades to
 * `opacity-0` and keeps its box, so the button never resizes mid-request).
 *
 * `aria-label` is REQUIRED — an icon-only control with no accessible name is
 * invisible to screen readers, and this is the single most common a11y defect
 * in the current codebase. In development a missing label logs an error.
 *
 * @param {object} props
 * @param {string} props.aria-label REQUIRED accessible name, e.g. "Close dialog".
 * @param {React.ReactNode} props.children The icon element.
 * @param {'primary'|'gradient'|'soft'|'secondary'|'outline'|'ghost'|'danger'|'success'} [props.variant='ghost']
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
