/**
 * ThemeContext — light / dark / system, persisted, applied to <html>.
 *
 * Tailwind runs in `darkMode: 'class'` and `styles/tokens.css` flips its CSS
 * variables on BOTH `html.dark` and `html[data-theme="dark"]`. We set both, in
 * lockstep, so a `dark:` utility and a token-driven color can never disagree —
 * the tokens file explicitly asks the provider to do this.
 *
 * `mode` is what the user chose ('system' included). `resolvedTheme` is what is
 * actually on screen ('light' | 'dark'). UI that shows a sun/moon should read
 * `resolvedTheme`; UI that shows a three-way control should read `mode`.
 *
 * The application also runs BEFORE React hydrates via `applyTheme()`, which
 * `main.jsx` can call inline later to kill the white flash. It is exported
 * separately for exactly that reason and touches nothing but the root element.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import * as storage from '../lib/storage';

export const THEME_MODES = Object.freeze(['light', 'dark', 'system']);
const DARK_QUERY = '(prefers-color-scheme: dark)';

export const ThemeContext = createContext(null);

function systemPrefersDark() {
  try {
    return typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia(DARK_QUERY).matches;
  } catch {
    return false;
  }
}

/** 'system' -> the OS answer; anything else passes through. */
export function resolveTheme(mode) {
  if (mode === 'dark') return 'dark';
  if (mode === 'light') return 'light';
  return systemPrefersDark() ? 'dark' : 'light';
}

/**
 * Write the theme onto <html>. Safe to call before React mounts and safe to
 * call in a non-DOM environment.
 * @param {'light'|'dark'} resolved
 */
export function applyTheme(resolved) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;
  root.classList.toggle('dark', resolved === 'dark');
  root.setAttribute('data-theme', resolved);
  // Native form controls, scrollbars and the address bar follow this.
  root.style.colorScheme = resolved;
}

function readStoredMode() {
  const stored = storage.get(storage.KEYS.THEME, null);
  return THEME_MODES.includes(stored) ? stored : 'system';
}

export function ThemeProvider({ children, defaultMode = 'system' }) {
  const [mode, setModeState] = useState(() => {
    const stored = readStoredMode();
    return stored === 'system' && THEME_MODES.includes(defaultMode) ? defaultMode : stored;
  });
  /** The OS preference, kept as state so 'system' re-renders when it flips. */
  const [systemDark, setSystemDark] = useState(systemPrefersDark);

  // DERIVED, not stored: computing this during render (instead of setting state
  // inside an effect) removes a whole class of cascading-render bugs — the
  // theme can never lag one paint behind the mode that produced it.
  const resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

  // Sync the external system (the <html> element). This is what an effect is for.
  useEffect(() => {
    applyTheme(resolved);
  }, [resolved]);

  // Subscribe to the OS preference. setState here happens in a callback from an
  // external source, which is the supported pattern.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;

    const media = window.matchMedia(DARK_QUERY);
    const onChange = (event) => setSystemDark(Boolean(event.matches));

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }
    // Safari < 14 only has the deprecated addListener.
    if (typeof media.addListener === 'function') {
      media.addListener(onChange);
      return () => media.removeListener(onChange);
    }
    return undefined;
  }, []);

  const setMode = useCallback((next) => {
    const value = THEME_MODES.includes(next) ? next : 'system';
    storage.set(storage.KEYS.THEME, value);
    setModeState(value);
  }, []);

  /** Flip to the opposite of what is CURRENTLY ON SCREEN, leaving 'system'. */
  const toggle = useCallback(() => {
    setMode(resolveTheme(mode) === 'dark' ? 'light' : 'dark');
  }, [mode, setMode]);

  /** light -> dark -> system -> light. For a single cycling control. */
  const cycle = useCallback(() => {
    const order = ['light', 'dark', 'system'];
    setMode(order[(order.indexOf(mode) + 1) % order.length]);
  }, [mode, setMode]);

  const value = useMemo(() => ({
    mode,
    resolvedTheme: resolved,
    isDark: resolved === 'dark',
    modes: THEME_MODES,
    setMode,
    toggle,
    cycle,
  }), [mode, resolved, setMode, toggle, cycle]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * @returns {{mode:'light'|'dark'|'system', resolvedTheme:'light'|'dark', isDark:boolean,
 *   modes:string[], setMode:(m:string)=>void, toggle:()=>void, cycle:()=>void}}
 */
export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used inside <ThemeProvider>.');
  }
  return context;
}

/** Non-throwing variant, for components that may render outside the provider. */
export function useOptionalTheme() {
  return useContext(ThemeContext);
}

export default ThemeContext;
