/**
 * AppShell — the outer frame for public and single-column pages.
 *
 * Order matters and is deliberate:
 *   1. ViewAsBanner  — above everything, so impersonation is never off-screen
 *   2. AppNavbar     — sticky, sits under the banner
 *   3. <main>        — the skip-link target, and the only scroll container the
 *                      page needs
 *   4. footer slot
 *   5. MobileTabBar  — sticky bottom, phones only
 *
 * `<main id="main-content" tabIndex={-1}>` is what makes the header's skip link
 * actually work: without the tabIndex, focus lands nowhere and the "skip" is a
 * no-op for keyboard users.
 *
 * NOT WIRED INTO ROUTING THIS PHASE. App.jsx still renders the legacy Navbar
 * and Footer; this is mounted when the pages are migrated.
 */

import React from 'react';

import { cn } from '../../lib/cn';
import AppNavbar from './AppNavbar';
import MobileTabBar from './MobileTabBar';
import ViewAsBanner from './ViewAsBanner';

/**
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {React.ReactNode} [props.footer]
 * @param {boolean} [props.showNavbar=true]
 * @param {boolean} [props.showTabBar=true]
 * @param {boolean} [props.showQuickScan=true]
 * @param {'default'|'wide'|'full'} [props.width='default'] Content max width.
 * @param {boolean} [props.padded=true] Apply the standard page gutters.
 * @param {string} [props.className]
 * @param {string} [props.mainClassName]
 */
export default function AppShell({
  children,
  footer,
  showNavbar = true,
  showTabBar = true,
  showQuickScan = true,
  width = 'default',
  padded = true,
  className,
  mainClassName,
}) {
  const WIDTHS = {
    default: 'max-w-7xl',
    wide: 'max-w-[96rem]',
    full: 'max-w-none',
  };

  return (
    <div className={cn('flex min-h-screen flex-col bg-canvas text-default', className)}>
      <ViewAsBanner />
      {showNavbar && <AppNavbar showQuickScan={showQuickScan} />}

      <main
        id="main-content"
        tabIndex={-1}
        className={cn('flex-1 outline-none', mainClassName)}
      >
        <div className={cn('mx-auto w-full', WIDTHS[width] ?? WIDTHS.default, padded && 'px-4 py-6 sm:px-6 sm:py-8')}>
          {children}
        </div>
      </main>

      {footer}
      {showTabBar && <MobileTabBar />}
    </div>
  );
}

export { AppShell };
