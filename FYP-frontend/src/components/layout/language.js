/**
 * Language helpers — a PURE module, deliberately not in the .jsx.
 *
 * Vite's Fast Refresh only hot-swaps modules whose exports are ALL React
 * components; helpers exported beside a component force a full page reload on
 * every edit. See ./notifications.js for the same reasoning.
 *
 * These also have to be callable BEFORE React mounts (a pre-hydration inline
 * script sets <html lang/dir> to avoid a flash of the wrong direction), which
 * is a second reason they do not belong inside a component module.
 */

import i18n from '../../i18n';
import * as storage from '../../lib/storage';

/** The languages the UI ships. `dir` drives <html dir> for RTL. */
export const LANGUAGES = Object.freeze([
  { code: 'en', label: 'English', native: 'English', dir: 'ltr' },
  { code: 'ur', label: 'Urdu', native: 'اردو', dir: 'rtl' },
]);

export function languageFor(code) {
  return LANGUAGES.find((entry) => entry.code === code) || LANGUAGES[0];
}

/** Apply to <html>. Safe to call before React mounts. */
export function applyLanguage(code) {
  const language = languageFor(code);
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.lang = language.code;
    document.documentElement.dir = language.dir;
  }
  return language;
}

/** The persisted language, or i18n's current one. */
export function storedLanguage() {
  const stored = storage.get(storage.KEYS.LANGUAGE, null);
  if (LANGUAGES.some((entry) => entry.code === stored)) return stored;
  return i18n?.language || 'en';
}
