import React, { forwardRef, useId, useRef } from 'react';
import { cn } from '../../lib/cn';
import { Portal, Scrim, useFocusTrap, useScrollLock, usePresence } from './Overlay';
import IconButton from './IconButton';

const SIZES = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-2xl',
  '2xl': 'max-w-4xl',
  full: 'max-w-[min(64rem,calc(100vw-2rem))]',
};

/** Simple X glyph so the primitives never depend on an icon library. */
export function CloseIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path
        d="m5 5 10 10M15 5 5 15"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Accessible centred dialog. Replaces the 19 hand-rolled `fixed inset-0`
 * overlays, each of which was missing some combination of Esc handling, focus
 * trapping, focus restore, scroll lock and `aria-modal`.
 *
 * Behaviour:
 *  - Renders through the ONE shared portal (see `Overlay.jsx`), so it is never
 *    clipped by a transformed ancestor and stacks correctly when nested.
 *  - Esc closes (topmost dialog only). Set `closeOnEsc={false}` for flows the
 *    user must not abandon mid-way.
 *  - Focus moves in on open and is restored to the trigger on close.
 *  - `aria-modal="true"` + `aria-labelledby` pointing at the rendered title.
 *    If you pass no `title`, pass `aria-label` yourself.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose Invoked by Esc, the scrim and the close button.
 * @param {React.ReactNode} [props.title] Dialog heading; also the accessible name.
 * @param {React.ReactNode} [props.description] Sub-heading, wired to `aria-describedby`.
 * @param {'sm'|'md'|'lg'|'xl'|'2xl'|'full'} [props.size='md']
 * @param {React.ReactNode} [props.footer] Action row pinned to the bottom.
 * @param {boolean} [props.closeOnEsc=true]
 * @param {boolean} [props.closeOnScrimClick=true]
 * @param {boolean} [props.showCloseButton=true]
 * @param {React.RefObject<HTMLElement>} [props.initialFocusRef] Element focused on open.
 * @param {string} [props.className] Applied to the dialog panel.
 * @param {string} [props.bodyClassName] Applied to the scrollable body.
 * @param {React.ReactNode} props.children
 */
const Modal = forwardRef(function Modal(
  {
    open,
    onClose,
    title,
    description,
    size = 'md',
    footer,
    closeOnEsc = true,
    closeOnScrimClick = true,
    showCloseButton = true,
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
  const titleId = `ui-modal-title-${uid}`;
  const descId = `ui-modal-desc-${uid}`;
  const { mounted, state } = usePresence(open);

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
      <div className="ui-scrollbar fixed inset-0 z-modal overflow-y-auto">
        <Scrim
          onClick={closeOnScrimClick ? onClose : undefined}
          className={cn(state === 'closed' && 'opacity-0 transition-opacity duration-150')}
        />
        {/* Wrapper is the scroll container so tall dialogs scroll the page
            region, not the panel, on small screens. */}
        <div className="relative flex min-h-full items-center justify-center p-4 sm:p-6">
          <div
            ref={setRefs}
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? titleId : undefined}
            aria-describedby={description ? descId : undefined}
            tabIndex={-1}
            data-state={state}
            className={cn(
              'relative flex w-full flex-col overflow-hidden outline-none',
              'max-h-[calc(100vh-2rem)] rounded-modal bg-surface-raised shadow-overlay',
              'border border-subtle',
              state === 'open' ? 'animate-ui-scale-in' : 'scale-95 opacity-0 transition-all duration-150',
              SIZES[size] ?? SIZES.md,
              className,
            )}
            {...rest}
          >
            {(title || showCloseButton) && (
              <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
                <div className="min-w-0 flex-1">
                  {title && (
                    <h2 id={titleId} className="font-heading text-heading-lg text-default">
                      {title}
                    </h2>
                  )}
                  {description && (
                    <p id={descId} className="mt-1 text-body-sm text-muted">
                      {description}
                    </p>
                  )}
                </div>
                {showCloseButton && (
                  <IconButton
                    aria-label="Close dialog"
                    size="sm"
                    variant="ghost"
                    onClick={onClose}
                    className="-mr-1.5 -mt-1"
                  >
                    <CloseIcon />
                  </IconButton>
                )}
              </div>
            )}

            <div
              className={cn(
                'ui-scrollbar min-h-0 flex-1 overflow-y-auto px-6',
                !title && !showCloseButton && 'pt-6',
                !footer && 'pb-6',
                bodyClassName,
              )}
            >
              {children}
            </div>

            {footer && (
              <div className="flex flex-wrap items-center justify-end gap-3 border-t border-subtle bg-surface-sunken px-6 py-4">
                {footer}
              </div>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
});

/**
 * Optional structural helpers for callers that want full control of the body
 * instead of the default header/body/footer layout.
 */
export function ModalHeader({ className, children, ...rest }) {
  return (
    <div className={cn('px-6 pt-6 pb-4', className)} {...rest}>
      {children}
    </div>
  );
}

export function ModalBody({ className, children, ...rest }) {
  return (
    <div className={cn('ui-scrollbar overflow-y-auto px-6 py-2', className)} {...rest}>
      {children}
    </div>
  );
}

export function ModalFooter({ className, children, ...rest }) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-end gap-3 border-t border-subtle px-6 py-4',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export { Modal };
export default Modal;
