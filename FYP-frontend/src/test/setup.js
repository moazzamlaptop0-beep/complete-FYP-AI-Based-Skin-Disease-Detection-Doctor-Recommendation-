/**
 * Vitest setup — runs before every test file.
 *
 * jsdom is missing several browser APIs this platform layer legitimately uses.
 * Each stub below exists because something real would otherwise throw:
 *   matchMedia      -> ThemeContext resolves 'system'
 *   IntersectionObserver / ResizeObserver -> ui primitives and future charts
 *   EventSource     -> RealtimeContext (absent => it reports 'unsupported',
 *                      which is the behaviour we WANT untested code to hit,
 *                      so this one is only defined as a controllable class for
 *                      tests that opt in)
 *   scrollTo        -> jsdom logs "Not implemented" noise on every navigation
 */

import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

// --- matchMedia -------------------------------------------------------------
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

// --- observers --------------------------------------------------------------
class NoopObserver {
  observe() {}

  unobserve() {}

  disconnect() {}

  takeRecords() { return []; }
}

if (!globalThis.IntersectionObserver) globalThis.IntersectionObserver = NoopObserver;
if (!globalThis.ResizeObserver) globalThis.ResizeObserver = NoopObserver;

// --- misc jsdom gaps --------------------------------------------------------
// Unconditional, NOT `if (!window.scrollTo)`: jsdom already defines scrollTo as
// a stub that logs "Error: Not implemented: Window's scrollTo()" to stderr, so
// the guard never fired and App.jsx's ScrollToTop printed that on every single
// navigation in every routing test.
window.scrollTo = () => {};
if (!globalThis.requestAnimationFrame) {
  globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(Date.now()), 0);
  globalThis.cancelAnimationFrame = (handle) => clearTimeout(handle);
}

// --- per-test hygiene -------------------------------------------------------
// Every module in src/lib reads localStorage; a leaked token from one test
// silently authenticates the next one.
afterEach(() => {
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    /* storage unavailable — nothing to clear */
  }
  vi.clearAllTimers();
});

// Fixtures and fetch stand-ins live in `src/test/helpers.js` — importing them
// from here would pull the global hooks above into every test file twice.
