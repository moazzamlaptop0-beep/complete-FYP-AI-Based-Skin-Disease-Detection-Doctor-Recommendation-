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
 * VISUAL LANGUAGE (round 5)
 *  - LAYERED GLASS: a translucent surface over a heavy backdrop blur, with the
 *    hairline border and the card shadow arriving together on scroll. Nothing
 *    is drawn twice, so the bar never reads as a stacked pair of rules.
 *  - SEGMENTED TRACK for the nav: one sunken pill holding the links, and the
 *    active link raised inside it. The old loose pills gave every link its own
 *    silhouette, which is what made a five-link header look unfinished.
 *  - ONE DOMINANT CTA: the scan button is the only gradient-filled control in
 *    the bar. "Sign up" steps down to solid `primary`, "Log in" to `ghost`,
 *    everything else is an icon button.
 *  - HAIRLINE DIVIDERS group the right cluster into product / utilities /
 *    account, which is what stops eight controls in a row reading as clutter.
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

/**
 * Hairline rule between two groups of controls. Purely decorative, so it is
 * hidden from assistive tech: a screen reader gets the controls, not the
 * furniture between them.
 *
 * `border-default`, not `border-subtle`: in light mode `--color-line-subtle` is
 * rgb(241 245 249), i.e. 1.03:1 against the header's near-white glass, so the
 * grouping this divider exists to draw was not being drawn at all.
 */
function ClusterDivider({ className }) {
  return <span aria-hidden="true" className={cn('h-6 border-l border-default', className)} />;
}

export function Brand({ className }) {
  return (
    <Link
      to="/"
      className={cn(
        'group inline-flex items-center gap-2.5 rounded-field font-heading text-heading-md text-default',
        'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
        'focus-visible:ring-offset-canvas',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex h-8 w-8 items-center justify-center rounded-field text-white',
          'bg-gradient-to-br from-navy-500 to-aqua-500 shadow-soft ring-1 ring-inset ring-white/20',
          'transition-transform duration-200 ease-overshoot',
          'group-hover:scale-105 motion-reduce:transform-none',
        )}
      >
        <Sparkles className="h-4 w-4" />
      </span>
      {/* `text-default` is repeated HERE and not left to the Link: a wordmark that
          takes its colour by inheritance is one careless ancestor away from being
          invisible, and that is exactly how a brand mark disappears in one theme
          only. Both words carry an explicit token. The teal half is the sanctioned
          `accent-700 / dark:accent-400` recipe, the only AA teal text pair. */}
      <span className="whitespace-nowrap tracking-tight text-default">
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
          'z-sticky w-full border-b bg-surface/70 backdrop-blur-xl',
          'transition-[box-shadow,border-color] duration-200',
          sticky && 'sticky top-0',
          // `border-default`: the whole point of this rule is that it appears on
          // scroll, and `border-subtle` is 1.03:1 against the light canvas.
          elevated ? 'border-default shadow-card' : 'border-transparent',
          className,
        )}
      >
        {/* The bar is full-bleed; its CONTENTS are not. The measure has to match
            the page below it: AppShell wraps content in `mx-auto max-w-7xl` and
            every landing section and the footer repeat that exact frame, so
            without it the brand sat 32px from the viewport edge while the hero
            heading started 148px in on a 1512px screen. */}
        <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-3 px-4 sm:px-6 lg:px-8">
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

          {/* Segmented track. Rendered only when the session actually has links,
              so a workspace with none does not leave an empty pill behind. */}
          {items.length > 0 && (
            <nav aria-label="Main" className="ml-1 hidden min-w-0 items-center md:flex">
              {/* `border-default` on a SUNKEN fill: `border-subtle` and
                  `--color-surface-sunken` are the same rgb in light mode, so the
                  track had no edge at all there. */}
              <div className="flex min-w-0 items-center gap-1 rounded-pill border border-default bg-surface-sunken/60 p-1 backdrop-blur">
                {items.map((item) => (
                  <NavLink
                    key={item.id}
                    to={item.to}
                    end={item.end}
                    className={({ isActive }) => cn(
                      'truncate rounded-pill px-3.5 py-1.5 text-label-lg',
                      'transition-[background-color,box-shadow,color] duration-150 ease-emphasized',
                      'motion-reduce:transition-none',
                      'outline-none focus-visible:ring-2 focus-visible:ring-focus',
                      isActive
                        ? 'bg-surface text-default shadow-soft'
                        : 'text-muted hover:bg-surface/70 hover:text-default',
                    )}
                  >
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </nav>
          )}

          <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
            <WorkspaceSwitcher className="hidden lg:block" />
            {showQuickScan && (
              <>
                <QuickScanButton variant="compact" className="hidden sm:inline-flex" />
                <ClusterDivider className="hidden sm:block" />
              </>
            )}

            <ThemeToggle className="hidden sm:inline-flex" />
            <LanguageToggle className="hidden lg:inline-flex" />

            <ClusterDivider className="hidden sm:block" />

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
                {/* `primary`, not `gradient`: the scan CTA owns the only gradient
                    fill in the bar, and two competing loud buttons read cheap. */}
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
