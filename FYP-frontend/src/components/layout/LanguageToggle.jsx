/**
 * LanguageToggle — English ⇄ اردو.
 *
 * `src/i18n.js` already ships both bundles; nothing in the app persists the
 * choice or sets document direction today, so a user who picks Urdu loses it on
 * reload and reads a right-to-left script inside a left-to-right layout.
 * This component fixes both:
 *   - the choice is stored under the namespaced `aiderma:language` key
 *   - `<html lang>` and `<html dir>` are updated, which is what actually makes
 *     browser text selection, punctuation mirroring and screen readers behave
 *
 * The language name is always rendered in ITS OWN script ("اردو", not "Urdu"),
 * because someone who cannot read the current language still has to find their
 * own in the list.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Languages } from 'lucide-react';

import i18n from '../../i18n';
import { cn } from '../../lib/cn';
import * as storage from '../../lib/storage';
import Button from '../ui/Button';
import { LANGUAGES, applyLanguage, languageFor, storedLanguage } from './language';


/**
 * @param {object} props
 * @param {'button'|'segment'} [props.variant='button'] `button` cycles to the other language.
 * @param {'sm'|'md'} [props.size='sm']
 * @param {string} [props.className]
 */
export default function LanguageToggle({ variant = 'button', size = 'sm', className, ...rest }) {
  // The persisted choice is read in the initialiser, so the first render is
  // already correct and the effect below only has to sync the outside world —
  // i18n.js hard-codes `lng: 'en'` and never restores anything.
  const [code, setCode] = useState(storedLanguage);

  useEffect(() => {
    if (code !== i18n.language) i18n.changeLanguage(code);
    applyLanguage(code);
  }, [code]);

  const choose = useCallback((next) => {
    storage.set(storage.KEYS.LANGUAGE, next);
    i18n.changeLanguage(next);
    applyLanguage(next);
    setCode(next);
  }, []);

  if (variant === 'segment') {
    return (
      <div
        role="radiogroup"
        aria-label="Language"
        className={cn(
          'inline-flex items-center gap-1 rounded-pill border border-subtle bg-surface-sunken p-1',
          className,
        )}
        {...rest}
      >
        {LANGUAGES.map((language) => (
          <button
            key={language.code}
            type="button"
            role="radio"
            aria-checked={code === language.code}
            lang={language.code}
            onClick={() => choose(language.code)}
            className={cn(
              'rounded-pill px-3 py-1.5 text-label-md transition-colors',
              'outline-none focus-visible:ring-2 focus-visible:ring-focus',
              code === language.code
                ? 'bg-surface text-default shadow-soft'
                : 'text-muted hover:text-default',
            )}
          >
            {language.native}
          </button>
        ))}
      </div>
    );
  }

  const other = LANGUAGES.find((entry) => entry.code !== code) || LANGUAGES[0];
  return (
    <Button
      variant="ghost"
      size={size}
      onClick={() => choose(other.code)}
      leftIcon={<Languages className="h-4 w-4" />}
      aria-label={`Switch language to ${other.label}`}
      className={className}
      {...rest}
    >
      <span lang={other.code}>{other.native}</span>
    </Button>
  );
}

export { LanguageToggle };
