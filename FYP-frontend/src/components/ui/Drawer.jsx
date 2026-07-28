import React, { forwardRef, useId, useRef } from 'react';
import { cn } from '../../lib/cn';
import { Portal, Scrim, useFocusTrap, useScrollLock, usePresence } from './Overlay';
import IconButton from './IconButton';
import { CloseIcon } from './Modal';

/**
 * Per-side geometry. Each side needs its own size axis, rounded corners and
 * enter/exit transform, so they are grouped rather than composed.
 */
const SIDES = {
  right: {
    position: 'inset-y-0 right-0 h-full',
    size: (s) => WIDTHS[s] ?? WIDTHS.md,
    radius: 'rounded-l-modal',
    border: 'border-l border-subtle',
    closed: 'translate-x-full',
    edge: 'inset-y-0 left-0 w-1 bg-gradient-to-b',
  },
  left: {
    position: 'inset-y-0 left-0 h-full',
    size: (s) => WIDTHS[s] ?? WIDTHS.md,
    radius: 'rounded-r-modal',
    border: 'border-r border-subtle',
    closed: '-translate-x-full',
    edge: 'inset-y-0 right-0 w-1 bg-gradient-to-b',
  },
  bottom: {
    position: 'inset-x-0 bottom-0 w-full',
    size: (s) => HEIGHTS[s] ?? HEIGHTS.md,
    radius: 'rounded-t-modal',
    border: 'border-t border-subtle',
    closed: 'translate-y-full',
    edge: 'inset-x-0 top-0 h-1 bg-gradient-to-r',
  },
  top: {
    position: 'inset-x-0 top-0 w-full',
    size: (s) => HEIGHTS[s] ?? HEIGHTS.md,
    radius: 'rounded-b-modal',
    border: 'border-b border-subtle',
    closed: '-translate-y-full',
    edge: 'inset-x-0 bottom-0 h-1 bg-gradient-to-r',
  },
};

const WIDTHS = {
  sm: 'w-full max-w-xs',
  md: 'w-full max-w-md',
  lg: 'w-full max-w-lg',
  xl: 'w-full max-w-2xl',
  full: 'w-full',
};

const HEIGHTS = {
  sm: 'max-h-[40vh]',
  md: 'max-h-[60vh]',
  lg: 'max-h-[80vh]',
  xl: 'max-h-[90vh]',
  full: 'h-full',
};

/**
 * Edge-anchored panel sharing all of Modal's a11y machinery (same portal, same
 * focus trap, same reference-counted scroll lock).
 *
 * Use a Drawer over a Modal when the content is a *filter/detail side panel*
 * or a mobile navigation sheet — i.e. secondary to the page rather than a task
 * that blocks it. `side="bottom"` is the mobile-friendly default for pickers.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {'right'|'left'|'top'|'bottom'} [props.side='right']
 * @param {'sm'|'md'|'lg'|'xl'|'full'} [props.size='md'] Width (left/right) or height (top/bottom).
 * @param {React.ReactNode} [props.title] Panel heading; also the accessible name.
 * @param {React.ReactNode} [props.description]
 * @param {React.ReactNode} [props.footer]
 * @param {boolean} [props.closeOnEsc=true]
 * @param {boolean} [props.closeOnScrimClick=true]
 * @param {boolean} [props.showCloseButton=true]
 * @param {boolean} [props.showHandle=false] Grab-handle affordance (bottom sheets).
 * @param {React.RefObject<HTMLElement>} [props.initialFocusRef]
 * @param {string} [props.className]
 * @param {React.ReactNode} props.children
 */
const Drawer = forwardRef(function Drawer(
  {
    open,
    onClose,
    side = 'right',
    size = 'md',
    title,
    description,
    footer,
    closeOnEsc = true,
    closeOnScrimClick = true,
    showCloseButton = true,
    showHandle = false,
    initialFocusRef,
    className,
    bodyClassName,
    children,
    ...rest
  },
  ref,
) {
  const panelRef = useRef(null);
  const uid = useId();
  const titleId = `ui-drawer-title-${uid}`;
  const descId = `ui-drawer-desc-${uid}`;
  const { mounted, state } = usePresence(open, 260);
  const preset = SIDES[side] ?? SIDES.right;

  useScrollLock(open);
  useFocusTrap(panelRef, {
    active: open,
    initialFocusRef,
    onEscape: closeOnEsc ? onClose : undefined,
  });

  if (!mounted) return null;

  const setRefs = (node) => {
    panelRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-modal">
        <Scrim
          onClick={closeOnScrimClick ? onClose : undefined}
          className={cn(state === 'closed' && 'opacity-0 transition-opacity duration-200')}
        />
        <div
          ref={setRefs}
          role="dialog"
          aria-modal="true"
          aria-labelledby={title ? titleId : undefined}
          aria-describedby={description ? descId : undefined}
          tabIndex={-1}
          data-state={state}
          className={cn(
            'absolute flex flex-col overflow-hidden bg-surface-raised shadow-overlay outline-none',
            // Written as an arbitrary PROPERTY on purpose. With
            // tailwindcss-animate installed the arbitrary-value duration
            // utility is ambiguous: it sets both transition-duration and
            // animation-duration, and Tailwind warns about it.
            'transition-transform [transition-duration:260ms] ease-emphasized motion-reduce:transition-none',
            preset.position,
            preset.size(size),
            preset.radius,
            preset.border,
            state === 'open' ? 'translate-x-0 translate-y-0' : preset.closed,
            className,
          )}
          {...rest}
        >
          {/* Brand accent along the panel's leading edge. Absolutely
              positioned and pointer-transparent, so it never shifts the
              header/body/footer flex layout or any consumer padding. */}
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none absolute from-navy-500 via-aqua-400 to-aqua-500',
              preset.edge,
            )}
          />
          {showHandle && (side === 'bottom' || side === 'top') && (
            <div aria-hidden="true" className="flex justify-center pt-3">
              <span className="h-1.5 w-10 rounded-pill bg-neutral-300" />
            </div>
          )}

          {(title || showCloseButton) && (
            <div className="flex items-start justify-between gap-4 border-b border-subtle px-5 py-4">
              <div className="min-w-0 flex-1">
                {title && (
                  <h2 id={titleId} className="font-heading text-heading-md text-default">
                    {title}
                  </h2>
                )}
                {description && (
                  <p id={descId} className="mt-0.5 text-body-sm text-muted">
                    {description}
                  </p>
                )}
              </div>
              {showCloseButton && (
                <IconButton
                  aria-label="Close panel"
                  size="sm"
                  variant="ghost"
                  onClick={onClose}
                  className="-mr-1"
                >
                  <CloseIcon />
                </IconButton>
              )}
            </div>
          )}

          <div className={cn('ui-scrollbar min-h-0 flex-1 overflow-y-auto p-5', bodyClassName)}>
            {children}
          </div>

          {footer && (
            <div className="flex flex-wrap items-center justify-end gap-3 border-t border-subtle bg-surface-sunken px-5 py-4">
              {footer}
            </div>
          )}
        </div>
      </div>
    </Portal>
  );
});

export { Drawer };
export default Drawer;
