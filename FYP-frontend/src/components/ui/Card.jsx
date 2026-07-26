import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

const VARIANTS = {
  /** Default panel: surface fill, hairline border, soft lift. */
  elevated: 'bg-surface border border-subtle shadow-card',
  /** Flat panel for dense grids where 20 shadows would be noise. */
  flat: 'bg-surface border border-subtle',
  /** Border-only, for nesting inside an already-elevated container. */
  outline: 'bg-transparent border border-default',
  /** Recessed well — filters, summaries, "read-only" regions. */
  sunken: 'bg-surface-sunken border border-subtle',
  /** Navy brand panel (sidebars, hero stats). Text flips to inverted. */
  inverted: 'bg-surface-inverted text-inverted border border-transparent shadow-elevated',
};

const PADDING = {
  none: 'p-0',
  sm: 'p-4',
  md: 'p-5 sm:p-6',
  lg: 'p-6 sm:p-8',
};

/**
 * Generic content container. The single source of "what a panel looks like",
 * replacing the ad-hoc `bg-white rounded-[2rem] border border-slate-100
 * shadow-sm` string repeated across the dashboards.
 *
 * Pass `as="section"`/`as="article"` for real landmarks — a wall of `<div>`s
 * gives screen-reader users no structure to navigate by.
 *
 * @param {object} props
 * @param {'elevated'|'flat'|'outline'|'sunken'|'inverted'} [props.variant='elevated']
 * @param {'none'|'sm'|'md'|'lg'} [props.padding='md'] Ignored when using Card{Header,Body,Footer}.
 * @param {boolean} [props.interactive=false] Adds hover lift + pointer cursor.
 * @param {React.ElementType} [props.as='div']
 * @param {string} [props.className]
 * @param {React.ReactNode} props.children
 */
const Card = forwardRef(function Card(
  {
    variant = 'elevated',
    padding = 'md',
    interactive = false,
    as: Component = 'div',
    className,
    children,
    ...rest
  },
  ref,
) {
  return (
    <Component
      ref={ref}
      className={cn(
        'rounded-card',
        VARIANTS[variant] ?? VARIANTS.elevated,
        PADDING[padding] ?? PADDING.md,
        interactive &&
          'cursor-pointer transition-[box-shadow,transform,border-color] duration-200 ease-emphasized ' +
            'hover:-translate-y-0.5 hover:shadow-card-hover hover:border-default ' +
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 ' +
            'focus-visible:ring-offset-canvas motion-reduce:hover:translate-y-0',
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
});

/**
 * Card title row. Give it `title`/`description`/`actions`, or arbitrary
 * children for full control.
 *
 * @param {object} props
 * @param {React.ReactNode} [props.title]
 * @param {React.ReactNode} [props.description]
 * @param {React.ReactNode} [props.actions] Right-aligned controls.
 * @param {boolean} [props.divider=false] Hairline under the header.
 * @param {'h2'|'h3'|'h4'} [props.titleAs='h3'] Keep the document outline sane.
 * @param {string} [props.className]
 */
export const CardHeader = forwardRef(function CardHeader(
  { title, description, actions, divider = false, titleAs: Title = 'h3', className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6',
        divider && 'border-b border-subtle pb-4',
        !divider && 'pb-3',
        className,
      )}
      {...rest}
    >
      {(title || description) && (
        <div className="min-w-0 flex-1">
          {title && (
            <Title className="font-heading text-heading-md text-default">{title}</Title>
          )}
          {description && <p className="mt-1 text-body-sm text-muted">{description}</p>}
        </div>
      )}
      {children}
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
});

/**
 * Card content region.
 * @param {object} props
 * @param {boolean} [props.scrollable=false] Constrain height and scroll internally.
 * @param {string} [props.className]
 */
export const CardBody = forwardRef(function CardBody(
  { scrollable = false, className, children, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      className={cn(
        'px-5 py-4 sm:px-6',
        scrollable && 'ui-scrollbar max-h-96 overflow-y-auto',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

/**
 * Card action row.
 * @param {object} props
 * @param {boolean} [props.divider=true] Hairline above the footer.
 * @param {'start'|'center'|'end'|'between'} [props.align='end']
 * @param {string} [props.className]
 */
export const CardFooter = forwardRef(function CardFooter(
  { divider = true, align = 'end', className, children, ...rest },
  ref,
) {
  const ALIGN = {
    start: 'justify-start',
    center: 'justify-center',
    end: 'justify-end',
    between: 'justify-between',
  };
  return (
    <div
      ref={ref}
      className={cn(
        'flex flex-wrap items-center gap-3 px-5 py-4 sm:px-6',
        divider && 'border-t border-subtle',
        ALIGN[align] ?? ALIGN.end,
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
});

export { Card };
export default Card;
