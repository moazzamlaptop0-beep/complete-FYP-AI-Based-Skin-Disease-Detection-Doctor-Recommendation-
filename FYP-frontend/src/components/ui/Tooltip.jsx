import React, {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { cn } from '../../lib/cn';
import { Portal } from './Overlay';

const ARROW = 6;
const GAP = 8;

/**
 * Write a node into a ref that may be a callback ref or an object ref.
 * Kept as a standalone function so the Tooltip can compose its own ref with the
 * one the caller put on the trigger element without either clobbering the other.
 *
 * @param {((node: any) => void)|{current: any}|null|undefined} ref
 * @param {any} node
 */
function assignRef(ref, node) {
  if (typeof ref === 'function') ref(node);
  else if (ref && typeof ref === 'object') ref.current = node;
}

/**
 * Compute a viewport-clamped position, flipping to the opposite side when the
 * preferred one would overflow. Runs against `getBoundingClientRect`, so the
 * tooltip is rendered `position: fixed` in the shared portal — that keeps it
 * correct inside scrolled/overflow-hidden containers, which is where the
 * `absolute`-positioned title bubbles in the current pages get clipped.
 */
function computePosition(triggerRect, tipRect, placement) {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const offset = GAP + ARROW;

  const space = {
    top: triggerRect.top,
    bottom: vh - triggerRect.bottom,
    left: triggerRect.left,
    right: vw - triggerRect.right,
  };
  const need = {
    top: tipRect.height + offset,
    bottom: tipRect.height + offset,
    left: tipRect.width + offset,
    right: tipRect.width + offset,
  };

  let side = placement;
  if (space[side] < need[side]) {
    const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' }[side];
    if (space[opposite] >= need[opposite]) side = opposite;
  }

  let top;
  let left;
  if (side === 'top') {
    top = triggerRect.top - tipRect.height - offset;
    left = triggerRect.left + triggerRect.width / 2 - tipRect.width / 2;
  } else if (side === 'bottom') {
    top = triggerRect.bottom + offset;
    left = triggerRect.left + triggerRect.width / 2 - tipRect.width / 2;
  } else if (side === 'left') {
    top = triggerRect.top + triggerRect.height / 2 - tipRect.height / 2;
    left = triggerRect.left - tipRect.width - offset;
  } else {
    top = triggerRect.top + triggerRect.height / 2 - tipRect.height / 2;
    left = triggerRect.right + offset;
  }

  // Clamp inside the viewport with an 8px margin.
  left = Math.min(Math.max(left, 8), vw - tipRect.width - 8);
  top = Math.min(Math.max(top, 8), vh - tipRect.height - 8);

  return { top, left, side };
}

/**
 * Text hint shown on hover and on keyboard focus.
 *
 * Rules this enforces so tooltips stay accessible:
 *  - Opens on `focus-visible` as well as hover, so keyboard users get it too.
 *  - Esc dismisses while the trigger keeps focus (WCAG 1.4.13).
 *  - The tooltip is referenced with `aria-describedby`, so it SUPPLEMENTS the
 *    trigger's name — never use it as the only label for an icon button; give
 *    the button an `aria-label` (or use `<IconButton>`).
 *  - Content is never interactive. If you need a link or button inside, that is
 *    a Popover, not a tooltip — a hover-only surface cannot be reached.
 *
 * The trigger must be a single element that forwards refs and DOM props.
 *
 * @param {object} props
 * @param {React.ReactNode} props.content Tooltip text. Falsy content disables the tooltip.
 * @param {'top'|'bottom'|'left'|'right'} [props.placement='top'] Preferred side; flips when it does not fit.
 * @param {number} [props.delay=200] ms before opening on hover.
 * @param {number} [props.closeDelay=80] ms before closing, so travel between trigger and tip does not flicker.
 * @param {boolean} [props.disabled=false]
 * @param {string} [props.className] Applied to the bubble.
 * @param {React.ReactElement} props.children The trigger element.
 */
export function Tooltip({
  content,
  placement = 'top',
  delay = 200,
  closeDelay = 80,
  disabled = false,
  className,
  children,
  ...rest
}) {
  const id = useId();
  const tooltipId = `ui-tooltip-${id}`;
  const triggerRef = useRef(null);
  const tipRef = useRef(null);
  const openTimer = useRef(null);
  const closeTimer = useRef(null);

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0, side: placement });

  const clearTimers = () => {
    clearTimeout(openTimer.current);
    clearTimeout(closeTimer.current);
  };

  const show = useCallback(() => {
    if (disabled || !content) return;
    clearTimers();
    openTimer.current = setTimeout(() => setOpen(true), delay);
  }, [disabled, content, delay]);

  const hide = useCallback(() => {
    clearTimers();
    closeTimer.current = setTimeout(() => setOpen(false), closeDelay);
  }, [closeDelay]);

  useEffect(() => clearTimers, []);

  // Position after paint, when the bubble has real dimensions.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const place = () => {
      const trigger = triggerRef.current;
      const tip = tipRef.current;
      if (!trigger || !tip) return;
      setPos(computePosition(trigger.getBoundingClientRect(), tip.getBoundingClientRect(), placement));
    };
    place();

    // Reposition on scroll/resize; `true` catches scrolls in ancestor
    // containers, not just the window.
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open, placement]);

  // Esc dismisses without moving focus.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape') {
        clearTimers();
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  // NOTE: declared BEFORE the `isValidElement` bail-out below — every hook must
  // run on every render, so no hook may sit after an early return.
  //
  // Memoised because an inline callback ref would be a new function each
  // render, and React detaches (calls with null) then re-attaches a changed
  // callback ref every render, thrashing `triggerRef` mid-measurement.
  const childRef = isValidElement(children) ? children.props?.ref : undefined;
  const setTriggerRef = useCallback(
    (node) => {
      triggerRef.current = node;
      // React 19 passes `ref` as a normal prop; reading `element.ref` warns.
      // Forwarded so the caller's own ref on the trigger keeps working.
      assignRef(childRef, node);
    },
    [childRef],
  );

  if (!isValidElement(children)) return children ?? null;

  /* eslint-disable react-hooks/refs --
     Attaching a ref to the caller's element via cloneElement is the only way to
     measure the trigger for positioning without forcing every call site to
     forward a ref by hand. `setTriggerRef` is a memoised callback and the ref's
     value is never READ during render — only inside layout effects. */
  const trigger = cloneElement(children, {
    ref: setTriggerRef,
    'aria-describedby': open ? tooltipId : children.props['aria-describedby'],
    onMouseEnter: (e) => {
      children.props.onMouseEnter?.(e);
      show();
    },
    onMouseLeave: (e) => {
      children.props.onMouseLeave?.(e);
      hide();
    },
    onFocus: (e) => {
      children.props.onFocus?.(e);
      // Only for keyboard focus — a mouse click should not also pop the tip.
      if (e.target.matches?.(':focus-visible')) {
        clearTimers();
        setOpen(true);
      }
    },
    onBlur: (e) => {
      children.props.onBlur?.(e);
      clearTimers();
      setOpen(false);
    },
  });
  /* eslint-enable react-hooks/refs */

  const arrowClass = {
    top: 'left-1/2 -translate-x-1/2 -bottom-1',
    bottom: 'left-1/2 -translate-x-1/2 -top-1',
    left: 'top-1/2 -translate-y-1/2 -right-1',
    right: 'top-1/2 -translate-y-1/2 -left-1',
  }[pos.side];

  return (
    <>
      {trigger}
      {open && content && (
        <Portal>
          <div
            ref={tipRef}
            id={tooltipId}
            role="tooltip"
            style={{ top: pos.top, left: pos.left }}
            onMouseEnter={clearTimers}
            onMouseLeave={hide}
            className={cn(
              'fixed z-tooltip max-w-xs rounded-control px-2.5 py-1.5',
              // surface-inverted/text-inverted flip together, so the bubble is
              // navy-on-white in light mode and light-on-dark in dark mode
              // without a single `dark:` override.
              'bg-surface-inverted text-caption font-medium text-inverted shadow-popover',
              'animate-ui-fade-in pointer-events-auto',
              className,
            )}
            {...rest}
          >
            {content}
            <span
              aria-hidden="true"
              className={cn('absolute h-2 w-2 rotate-45 bg-surface-inverted', arrowClass)}
            />
          </div>
        </Portal>
      )}
    </>
  );
}

export default Tooltip;
