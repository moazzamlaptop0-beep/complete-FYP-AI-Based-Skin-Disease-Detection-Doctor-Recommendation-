/**
 * AppNavbar — one header for every surface.
 *
 * Replaces the split between the public Navbar (which reads localStorage
 * directly and has its own logout), the doctor header and the admin header.
 *
 * BEHAVIOUR
 *  - Sticky, with elevation that appears only ONCE THE PAGE HAS SCROLLED. A
 *    permanent shadow over a hero looks like a rendering bug; no shadow at all
 *    makes content slide "through" the bar. The scroll listener is passive and
 *    only calls setState on the boundary crossing, not on every scroll event.
 *  - Role-aware links, filtered by PERMISSION (see navigation.js).
 *  - A real skip link, because a keyboard user should not tab through eight
 *    nav items on every page to reach the content.
 *  - The mobile drawer is mounted here so the hamburger and the panel share one
 *    piece of state.
 *
 * The QuickScanButton sits immediately left of the account controls on desktop
 * and is the centre CTA of the mobile tab bar — one action, two thumb zones.
 */

import React, { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { Menu, Sparkles } from 'lucide-react';

import { cn } from '../../lib/cn';
import { useAuth } from '../../context/AuthContext';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import LanguageToggle from './LanguageToggle';
import MobileDrawer from './MobileDrawer';
import NotificationBell from './NotificationBell';
import ProfileMenu from './ProfileMenu';
import QuickScanButton from './QuickScanButton';
import ThemeToggle from './ThemeToggle';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import { PRIMARY_NAV, visibleNav } from './navigation';

/** Pixels of scroll before the header lifts off the page. */
const ELEVATION_THRESHOLD = 8;

export function Brand({ className }) {
  return (
    <Link
      to="/"
      className={cn(
        'inline-flex items-center gap-2 rounded-field font-heading text-heading-md text-default',
        'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
        'focus-visible:ring-offset-canvas',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-8 w-8 items-center justify-center rounded-field bg-primary-900 text-accent-400"
      >
        <Sparkles className="h-4 w-4" />
      </span>
      <span className="whitespace-nowrap">
        AI <span className="text-accent-700 dark:text-accent-400">Dermatologist</span>
      </span>
    </Link>
  );
}

/**
 * @param {object} props
 * @param {boolean} [props.showQuickScan=true]
 * @param {boolean} [props.sticky=true]
 * @param {React.ReactNode} [props.left] Extra controls before the brand (e.g. a sidebar toggle).
 * @param {string} [props.contentId='main-content'] Skip-link target.
 * @param {string} [props.className]
 */
export default function AppNavbar({
  showQuickScan = true,
  sticky = true,
  left,
  contentId = 'main-content',
  className,
}) {
  const auth = useAuth();
  const [elevated, setElevated] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onScroll = () => {
      const next = window.scrollY > ELEVATION_THRESHOLD;
      // Only re-render on the boundary crossing.
      setElevated((prev) => (prev === next ? prev : next));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const items = visibleNav(PRIMARY_NAV, {
    permissions: auth.permissions,
    isAuthenticated: auth.isAuthenticated,
    // effectiveRole, not role: an admin acting as a doctor must get the doctor's
    // header, and an admin acting as nobody must not get one at all.
    role: auth.effectiveRole,
  });

  return (
    <>
      <a
        href={`#${contentId}`}
        className={cn(
          'ui-sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-tooltip',
          'focus:rounded-field focus:bg-surface focus:px-4 focus:py-2 focus:text-label-lg',
          'focus:text-default focus:shadow-popover focus:outline-none focus:ring-2 focus:ring-focus',
        )}
      >
        Skip to content
      </a>

      <header
        className={cn(
          'z-sticky w-full border-b bg-surface/90 backdrop-blur',
          'transition-shadow duration-200',
          sticky && 'sticky top-0',
          elevated ? 'border-subtle shadow-card' : 'border-transparent',
          className,
        )}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 sm:px-6">
          {left}

          <IconButton
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}
            className="md:hidden"
          >
            <Menu />
          </IconButton>

          <Brand className="shrink-0" />

          <nav aria-label="Main" className="ml-2 hidden min-w-0 flex-1 items-center gap-1 md:flex">
            {items.map((item) => (
              <NavLink
                key={item.id}
                to={item.to}
                end={item.end}
                className={({ isActive }) => cn(
                  'rounded-field px-3 py-2 text-label-lg transition-colors',
                  'outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  isActive
                    ? 'bg-primary-50 text-primary-900 dark:bg-surface-sunken dark:text-primary-700'
                    : 'text-muted hover:bg-surface-sunken hover:text-default',
                )}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <WorkspaceSwitcher className="hidden lg:block" />
            {showQuickScan && <QuickScanButton variant="compact" className="hidden sm:inline-flex" />}
            <ThemeToggle className="hidden sm:inline-flex" />
            <LanguageToggle className="hidden lg:inline-flex" />

            {auth.isAuthenticated ? (
              <>
                <NotificationBell />
                <ProfileMenu />
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Button as={Link} to="/login" variant="ghost" size="sm" className="hidden sm:inline-flex">
                  Log in
                </Button>
                <Button as={Link} to="/register" variant="primary" size="sm">
                  Sign up
                </Button>
              </div>
            )}
          </div>
        </div>
      </header>

      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}

export { AppNavbar };
