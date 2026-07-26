/**
 * ThemeToggle — light / dark / system.
 *
 * Two shapes:
 *   `variant="icon"`    a single button that flips to the opposite of what is
 *                       on screen (the header default).
 *   `variant="segment"` a three-way radio group including System, for a
 *                       settings panel. System matters: a user who set their OS
 *                       to switch at sunset expects the app to follow.
 *
 * The button reports the ACTION ("Switch to dark theme"), not the state, and
 * carries `aria-pressed` so screen-reader users know which one is live.
 */

import React from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

import { cn } from '../../lib/cn';
import { useOptionalTheme } from '../../context/ThemeContext';
import IconButton from '../ui/IconButton';

const OPTIONS = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

/**
 * @param {object} props
 * @param {'icon'|'segment'} [props.variant='icon']
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {string} [props.className]
 */
export default function ThemeToggle({ variant = 'icon', size = 'md', className, ...rest }) {
  const theme = useOptionalTheme();

  // Rendering outside ThemeProvider (e.g. a legacy page that is not wrapped yet)
  // must not crash the header.
  if (!theme) return null;

  if (variant === 'segment') {
    return (
      <div
        role="radiogroup"
        aria-label="Colour theme"
        className={cn(
          'inline-flex items-center gap-1 rounded-pill border border-subtle bg-surface-sunken p-1',
          className,
        )}
        {...rest}
      >
        {OPTIONS.map((option) => {
          // Destructured in the body, not the parameter list: eslint's
          // `varsIgnorePattern: '^[A-Z_]'` covers variables, not arguments, and
          // core no-unused-vars does not count JSX usage of `Icon`.
          const { value, label } = option;
          const Icon = option.Icon;
          const active = theme.mode === value;
          return (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => theme.setMode(value)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-pill px-3 py-1.5 text-label-md transition-colors',
                'outline-none focus-visible:ring-2 focus-visible:ring-focus',
                active
                  ? 'bg-surface text-default shadow-soft'
                  : 'text-muted hover:text-default',
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>
    );
  }

  const goingDark = !theme.isDark;
  return (
    <IconButton
      aria-label={goingDark ? 'Switch to dark theme' : 'Switch to light theme'}
      aria-pressed={theme.isDark}
      title={goingDark ? 'Dark theme' : 'Light theme'}
      size={size}
      variant="ghost"
      onClick={theme.toggle}
      className={className}
      {...rest}
    >
      {theme.isDark ? <Sun /> : <Moon />}
    </IconButton>
  );
}

export { ThemeToggle };
