/**
 * useOverlayPresence — "does a modal or drawer currently own the screen?"
 * ============================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * FloatingChatbot is a `position: fixed` launcher that lives outside the router
 * outlet, so it has no idea a dialog just opened. That mattered, because
 * `ui/Overlay.jsx` does three things while a Modal/Drawer/ConfirmDialog is open:
 *
 *   1. it renders the dialog at `z-modal` behind a full-viewport scrim,
 *   2. it runs a focus trap that pulls focus back on every Tab and on mount,
 *   3. it reference-counts a body scroll lock.
 *
 * A launcher painted ABOVE that layer is a button floating over a scrim that is
 * supposed to be blocking the page: clicking it either does nothing usable or it
 * loses focus to the trap a frame later. That is the "sometimes does not open"
 * report. The fix is to keep the launcher below the overlay layer AND to take it
 * out of the page entirely while an overlay is up.
 *
 * HOW IT DETECTS THE OVERLAY
 * --------------------------
 * `useScrollLock` in `ui/Overlay.jsx` writes `data-ui-scroll-locked="true"` onto
 * `document.body` for exactly as long as at least one overlay is open, and
 * removes it when the last one closes (it is reference counted, so nested
 * dialogs cannot double-unlock). That attribute is therefore already the app's
 * one authoritative "an overlay owns the screen" signal, and observing it needs
 * no change to Overlay.jsx and no new shared state.
 *
 * `ui.css` styles both `html[...]` and `body[...]`, so both are observed in case
 * the attribute ever moves to the documentElement.
 */

import { useEffect, useState } from 'react';

/** The attribute `ui/Overlay.jsx`'s reference-counted scroll lock writes. */
const SCROLL_LOCK_ATTR = 'data-ui-scroll-locked';

/** SSR / very early JSDOM guard. */
const canUseDOM = typeof document !== 'undefined';

function readOverlayOpen() {
  if (!canUseDOM) return false;
  return (
    document.body?.getAttribute(SCROLL_LOCK_ATTR) === 'true' ||
    document.documentElement?.getAttribute(SCROLL_LOCK_ATTR) === 'true'
  );
}

/**
 * @returns {boolean} true while a design-system Modal, Drawer or ConfirmDialog
 *   is open anywhere in the app.
 */
export function useOverlayPresence() {
  // Read synchronously so the very first paint is already correct; every later
  // change arrives through the observer below (never a set-state during an
  // effect body, which the react-hooks rules forbid).
  const [overlayOpen, setOverlayOpen] = useState(readOverlayOpen);

  useEffect(() => {
    if (!canUseDOM || typeof MutationObserver !== 'function') return undefined;

    const observer = new MutationObserver(() => setOverlayOpen(readOverlayOpen()));
    const options = { attributes: true, attributeFilter: [SCROLL_LOCK_ATTR] };
    observer.observe(document.documentElement, options);
    observer.observe(document.body, options);

    return () => observer.disconnect();
  }, []);

  return overlayOpen;
}

export default useOverlayPresence;
