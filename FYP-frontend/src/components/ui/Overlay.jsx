import React, {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/cn';

/* ==========================================================================
   SHARED OVERLAY INFRASTRUCTURE
   --------------------------------------------------------------------------
   Modal, Drawer and ConfirmDialog all render through the ONE portal host
   created here, share ONE focus trap, ONE Esc handler and ONE reference-counted
   body scroll lock. This is what replaces the 19 independently reimplemented
   `fixed inset-0` overlays.

   Why a single host node: nesting overlays (e.g. a ConfirmDialog opened from
   inside a Modal) must stack in DOM order so the later one paints on top
   without any z-index arithmetic, and so `inert`-style focus containment
   always applies to the *topmost* layer only.
   ========================================================================== */

const HOST_ID = 'ui-overlay-root';
const SCROLL_LOCK_ATTR = 'data-ui-scroll-locked';

/** Stack of currently-open overlay ids, deepest last. Module-level on purpose. */
const overlayStack = [];
let scrollLockCount = 0;
let restoreScrollY = 0;

/** SSR/JSDOM guard — `document` is absent during server render and in some tests. */
const canUseDOM = typeof document !== 'undefined';

function getHost() {
  if (!canUseDOM) return null;
  let host = document.getElementById(HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = HOST_ID;
    // The host itself must not create a stacking/layout context that could
    // clip children, so it stays a zero-size static element.
    document.body.appendChild(host);
  }
  return host;
}

/**
 * Render children into the single shared overlay host at the end of <body>.
 *
 * Escaping the React tree matters because several frozen pages wrap content in
 * `transform`/`filter` containers, and a `position: fixed` child of a
 * transformed ancestor is positioned against that ancestor, not the viewport —
 * the classic "my modal is stuck inside a card" bug.
 *
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {boolean} [props.disabled=false] Render inline instead of portalling.
 */
export function Portal({ children, disabled = false }) {
  // Resolved in a lazy initialiser rather than an effect: `getHost()` is
  // idempotent (it reuses the existing node), so this is safe, and it saves the
  // extra render-null-then-render-content pass an effect would cost — which is
  // visible as a one-frame flash when a modal opens.
  const [host] = useState(() => (canUseDOM ? getHost() : null));

  if (disabled) return children;
  if (!host) return null;
  return createPortal(children, host);
}

/**
 * Lock body scrolling for as long as the calling overlay is open.
 *
 * Reference counted, so closing an inner overlay while an outer one is still
 * open does NOT restore scrolling. Also compensates for the scrollbar width so
 * the page behind does not visibly shift when the bar disappears.
 *
 * @param {boolean} active
 */
export function useScrollLock(active) {
  useEffect(() => {
    if (!active || !canUseDOM) return undefined;

    scrollLockCount += 1;
    if (scrollLockCount === 1) {
      const { body, documentElement } = document;
      const gutter = window.innerWidth - documentElement.clientWidth;
      restoreScrollY = window.scrollY;
      body.setAttribute(SCROLL_LOCK_ATTR, 'true');
      if (gutter > 0) body.style.paddingRight = `${gutter}px`;
    }

    return () => {
      scrollLockCount -= 1;
      if (scrollLockCount === 0) {
        document.body.removeAttribute(SCROLL_LOCK_ATTR);
        document.body.style.paddingRight = '';
        window.scrollTo(0, restoreScrollY);
      }
    };
  }, [active]);
}

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Elements that are focusable AND currently rendered (not `display:none`). */
function focusableWithin(node) {
  if (!node) return [];
  return Array.from(node.querySelectorAll(FOCUSABLE)).filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      (el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0),
  );
}

/**
 * Trap Tab/Shift+Tab inside `containerRef` while `active`, then restore focus
 * to whatever was focused before the overlay opened.
 *
 * Focus restoration is the half everyone forgets: without it, closing a dialog
 * dumps keyboard focus back on `<body>` and the user has to Tab from the top of
 * the page again.
 *
 * Only the TOPMOST overlay traps, so a ConfirmDialog stacked over a Modal
 * behaves correctly.
 *
 * @param {React.RefObject<HTMLElement>} containerRef
 * @param {object} options
 * @param {boolean} options.active
 * @param {() => void} [options.onEscape] Called on Esc (topmost overlay only).
 * @param {React.RefObject<HTMLElement>} [options.initialFocusRef] Element to focus on open.
 * @param {boolean} [options.restoreFocus=true]
 * @returns {{isTopmost: boolean}}
 */
export function useFocusTrap(
  containerRef,
  { active, onEscape, initialFocusRef, restoreFocus = true } = {},
) {
  const idRef = useRef(Symbol('ui-overlay'));
  const previouslyFocused = useRef(null);
  const [isTopmost, setIsTopmost] = useState(true);

  // Register in the stack so only the deepest overlay reacts to Esc/Tab.
  useEffect(() => {
    if (!active) return undefined;
    const id = idRef.current;
    overlayStack.push(id);
    setIsTopmost(overlayStack[overlayStack.length - 1] === id);

    return () => {
      const index = overlayStack.indexOf(id);
      if (index !== -1) overlayStack.splice(index, 1);
    };
  }, [active]);

  // Capture + restore focus.
  useEffect(() => {
    if (!active || !canUseDOM) return undefined;
    previouslyFocused.current = document.activeElement;

    // rAF: the container's children may not be laid out on the same tick the
    // overlay mounts (animation classes, lazy content), and focusing a
    // zero-size element silently no-ops.
    const frame = requestAnimationFrame(() => {
      const container = containerRef.current;
      if (!container) return;
      const target =
        initialFocusRef?.current ??
        focusableWithin(container)[0] ??
        container;
      target?.focus?.({ preventScroll: true });
    });

    return () => {
      cancelAnimationFrame(frame);
      if (!restoreFocus) return;
      const previous = previouslyFocused.current;
      if (previous && typeof previous.focus === 'function' && document.contains(previous)) {
        previous.focus({ preventScroll: true });
      }
    };
  }, [active, containerRef, initialFocusRef, restoreFocus]);

  // Tab containment + Esc.
  useEffect(() => {
    if (!active || !canUseDOM) return undefined;

    const handleKeyDown = (event) => {
      const id = idRef.current;
      if (overlayStack[overlayStack.length - 1] !== id) return;

      if (event.key === 'Escape') {
        event.stopPropagation();
        onEscape?.(event);
        return;
      }
      if (event.key !== 'Tab') return;

      const container = containerRef.current;
      if (!container) return;
      const items = focusableWithin(container);
      if (items.length === 0) {
        event.preventDefault();
        container.focus?.({ preventScroll: true });
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;

      // Focus escaped the container entirely (browser chrome, iframe, etc.).
      if (!container.contains(activeEl)) {
        event.preventDefault();
        first.focus({ preventScroll: true });
        return;
      }
      if (!event.shiftKey && activeEl === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      } else if (event.shiftKey && activeEl === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [active, containerRef, onEscape]);

  return { isTopmost };
}

/**
 * The dimmed backdrop behind an overlay.
 *
 * `aria-hidden` because the scrim is pure decoration; the click-to-dismiss
 * affordance is duplicated by Esc and by the dialog's own close button, so no
 * keyboard user depends on it.
 *
 * @param {object} props
 * @param {() => void} [props.onClick]
 * @param {boolean} [props.blur=true]
 * @param {string} [props.className]
 */
export const Scrim = forwardRef(function Scrim(
  { onClick, blur = true, className, ...rest },
  ref,
) {
  return (
    <div
      ref={ref}
      aria-hidden="true"
      onClick={onClick}
      className={cn(
        'ui-scrim fixed inset-0 animate-ui-fade-in',
        blur && 'backdrop-blur-sm',
        className,
      )}
      {...rest}
    />
  );
});

/**
 * Delay unmounting so a closing animation can play.
 *
 * @param {boolean} open
 * @param {number} [duration=180] ms to keep the node mounted after `open` flips false.
 * @returns {{mounted: boolean, state: 'open'|'closed'}}
 */
export function usePresence(open, duration = 180) {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState(open ? 'open' : 'closed');

  /* eslint-disable react-hooks/set-state-in-effect --
     An enter animation fundamentally requires two commits: mount in the
     "closed" style, then flip to "open" on the next frame so the browser has a
     start value to animate FROM. Deriving this during render would skip the
     transition entirely (the element would mount already-open), and the exit
     path must outlive `open` going false so the closing animation can play. */
  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setState('open'));
      return () => cancelAnimationFrame(frame);
    }
    setState('closed');
    const timer = setTimeout(() => setMounted(false), duration);
    return () => clearTimeout(timer);
  }, [open, duration]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { mounted, state };
}

/**
 * Stable `useCallback` for a handler that should not re-subscribe listeners.
 * @param {Function} [fn]
 */
export function useEvent(fn) {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args) => ref.current?.(...args), []);
}

export default Portal;
