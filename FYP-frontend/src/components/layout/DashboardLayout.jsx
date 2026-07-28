/**
 * DashboardLayout — the one responsive frame every workspace renders inside.
 *
 * A REAL app frame, not a page with a panel in it: the sidebar owns the left
 * edge of the viewport at full height with the brand at its top, a dedicated
 * top bar spans the remaining width, and the content area uses everything
 * that is left. The public AppNavbar is not rendered here; dashboards have
 * their own chrome.
 *
 * THREE LAYOUTS, ONE COMPONENT
 *  - `lg` and up : full sidebar, `w-72`, section headings, labels
 *  - `md` to `lg`: icon rail, `w-20`, labels become accessible names and
 *    native tooltips — the tablet keeps its navigation instead of losing it
 *  - below `md`  : no sidebar; the top bar's hamburger opens MobileDrawer and
 *    the MobileTabBar owns primary navigation
 *
 * The sidebar is a real `<aside>` with `aria-label`, and the desktop collapse
 * preference is persisted, because someone who works on a 13" laptop collapses
 * it once and should not have to do it again every morning.
 *
 * VISUAL LANGUAGE
 * The active item wears the brand gradient pill. The gradient stops are chosen
 * per theme so the white label always clears contrast: `primary-600/accent-700`
 * in light mode and `primary-400/accent-300` in dark resolve to the same
 * physical colors, because the dark scale is re-ramped in tokens.css.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { Menu, PanelLeftClose, PanelLeftOpen, Sparkles } from 'lucide-react';

import { cn } from '../../lib/cn';
import { useAuth } from '../../context/AuthContext';
import * as storage from '../../lib/storage';
import IconButton from '../ui/IconButton';
import LanguageToggle from './LanguageToggle';
import MobileDrawer from './MobileDrawer';
import MobileTabBar from './MobileTabBar';
import NotificationBell from './NotificationBell';
import ProfileMenu from './ProfileMenu';
import QuickScanButton from './QuickScanButton';
import ThemeToggle from './ThemeToggle';
import ViewAsBanner from './ViewAsBanner';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import { activeWorkspace } from './workspaces';
import { WORKSPACE_NAV, visibleSections } from './navigation';

const COLLAPSE_KEY = 'sidebar_collapsed';

/** The brand mark at the top of the sidebar. Icon-only when the rail is narrow. */
function SidebarBrand({ iconOnly }) {
  return (
    <Link
      to="/"
      className={cn(
        'flex items-center gap-2.5 rounded-field px-2 py-1 outline-none',
        'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
        iconOnly && 'justify-center px-0',
      )}
    >
      <span
        aria-hidden="true"
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-field bg-gradient-to-br from-navy-500 to-aqua-500 text-white shadow-soft"
      >
        <Sparkles className="h-5 w-5" />
      </span>
      {/* Both words carry an explicit colour token. A wordmark that inherits its
          colour is one careless ancestor away from vanishing in a single theme,
          which is the failure mode this mark is rendered in five places to avoid. */}
      <span className={cn('whitespace-nowrap font-heading text-heading-sm text-default', iconOnly && 'sr-only')}>
        AI <span className="text-accent-700 dark:text-accent-400">Dermatologist</span>
      </span>
    </Link>
  );
}

/**
 * @param {object} props
 * @param {React.ReactNode} props.children Page content.
 * @param {'doctor'|'patient'|'admin'} [props.workspace] Override the auto-detected workspace.
 * @param {Array<{title?:string, items:Array<object>}>} [props.sections] Override the nav entirely.
 * @param {React.ReactNode} [props.title] Page heading rendered above the content.
 * @param {React.ReactNode} [props.actions] Right-aligned page actions.
 * @param {React.ReactNode} [props.sidebarFooter]
 * @param {string} [props.className]
 */
export default function DashboardLayout({
  children,
  workspace,
  sections: sectionsProp,
  title,
  actions,
  sidebarFooter,
  className,
}) {
  const auth = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => Boolean(storage.get(COLLAPSE_KEY, false)));
  const [drawerOpen, setDrawerOpen] = useState(false);

  const workspaceId = workspace
    || activeWorkspace(auth.workspaces, location.pathname)?.id
    || auth.workspaces?.[0]?.id
    || 'patient';

  const sections = useMemo(() => {
    const source = sectionsProp || WORKSPACE_NAV[workspaceId] || [];
    return visibleSections(source, {
      permissions: auth.permissions,
      isAuthenticated: auth.isAuthenticated,
      // effectiveRole is load-bearing here: the doctor/patient sidebar rows are
      // excluded from an ADMIN's chrome, so an admin acting as a doctor would
      // otherwise land on /doctor/referrals with no sidebar at all.
      role: auth.effectiveRole,
    });
  }, [sectionsProp, workspaceId, auth.permissions, auth.isAuthenticated, auth.effectiveRole]);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      storage.set(COLLAPSE_KEY, next);
      return next;
    });
  }, []);

  const linkClass = ({ isActive }) => cn(
    'group relative flex items-center gap-3 rounded-field px-3 py-2.5 text-body-md',
    'transition-[background-color,box-shadow,color] duration-150 ease-emphasized',
    'motion-reduce:transition-none',
    'outline-none focus-visible:ring-2 focus-visible:ring-focus',
    'lg:justify-start',
    collapsed ? 'lg:justify-center' : '',
    'max-lg:justify-center',
    isActive
      ? cn(
        'bg-gradient-to-r from-primary-600 to-accent-700 font-semibold text-white shadow-soft',
        'dark:from-primary-400 dark:to-accent-300',
      )
      : 'text-muted hover:bg-surface-sunken hover:text-default',
  );

  // No `dark:` half on the hover colour: `primary` is a flipping scale, so
  // `primary-600` already re-ramps to the dark theme's interactive blue. Adding
  // `dark:group-hover:text-primary-700` only pushed it one stop paler than the
  // same hover in light mode.
  const iconClass = (isActive) => cn(
    'h-5 w-5 shrink-0 transition-colors',
    isActive ? 'text-white' : 'text-subtle group-hover:text-primary-600',
  );

  const showLabels = !collapsed;

  return (
    <div className={cn('flex min-h-screen flex-col bg-canvas text-default', className)}>
      <a
        href="#main-content"
        className={cn(
          'ui-sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-tooltip',
          'focus:rounded-field focus:bg-surface focus:px-4 focus:py-2 focus:text-label-lg',
          'focus:text-default focus:shadow-popover focus:outline-none focus:ring-2 focus:ring-focus',
        )}
      >
        Skip to content
      </a>

      <ViewAsBanner />

      <div className="flex flex-1">
        {/* ---------------------------------------------------------- sidebar --
            Owns the LEFT EDGE at full viewport height. Full at lg+, icon rail
            at md, gone below md (MobileTabBar and MobileDrawer take over). */}
        <aside
          aria-label="Dashboard navigation"
          className={cn(
            'sticky top-0 hidden h-screen shrink-0 flex-col border-r border-subtle bg-surface md:flex',
            collapsed ? 'lg:w-20' : 'lg:w-72',
            'w-20',
          )}
        >
          <div className={cn('flex h-16 items-center border-b border-subtle px-3', collapsed ? 'justify-center' : 'lg:px-4')}>
            <SidebarBrand iconOnly={collapsed} />
          </div>

          {showLabels && (
            <div className="hidden border-b border-subtle px-3 py-3 lg:block">
              <WorkspaceSwitcher />
            </div>
          )}

          <nav className="ui-scrollbar flex-1 overflow-y-auto px-2.5 py-4">
            {sections.map((section) => (
              <div key={section.title || 'section'} className="mb-5">
                {section.title && showLabels && (
                  <p className="hidden px-3 pb-1.5 pt-2 text-overline text-subtle lg:block">
                    {section.title}
                  </p>
                )}
                <ul className="flex flex-col gap-1">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.id}>
                        <NavLink to={item.to} end={item.end} className={linkClass} title={item.label}>
                          {({ isActive }) => (
                            <>
                              {Icon && <Icon className={iconClass(isActive)} aria-hidden="true" />}
                              {/* Tailwind's own sr-only/not-sr-only pair (NOT the
                                  custom .ui-sr-only) so the rail keeps an accessible
                                  name at md and shows the real label at lg. */}
                              <span className={cn('truncate', collapsed ? 'sr-only' : 'sr-only lg:not-sr-only')}>
                                {item.label}
                              </span>
                            </>
                          )}
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <div className="border-t border-subtle p-3">
            {sidebarFooter}
            <IconButton
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-pressed={collapsed}
              size="sm"
              onClick={toggleCollapsed}
              className={cn('hidden lg:inline-flex', !collapsed && 'w-full justify-start gap-2')}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </IconButton>
          </div>
        </aside>

        {/* ----------------------------------------------------- main column -- */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Top bar: spans everything right of the sidebar. */}
          <header
            className={cn(
              'sticky top-0 z-sticky flex h-16 items-center gap-2 border-b border-subtle',
              'bg-surface/95 px-4 backdrop-blur sm:px-6',
            )}
          >
            <IconButton
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}
              className="md:hidden"
            >
              <Menu />
            </IconButton>

            {/* Brand for phones, where the sidebar (which carries it) is hidden. */}
            <div className="md:hidden">
              <SidebarBrand iconOnly={false} />
            </div>

            {/* Product action, then utilities, then account: the same three
                groups as AppNavbar, separated by the same hairline, which is
                what keeps six controls in a row from reading as clutter. */}
            <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
              <QuickScanButton variant="compact" className="hidden sm:inline-flex" />

              {/* `border-default`, not `border-subtle`: on the light theme
                  `--color-line-subtle` is 1.03:1 against this bar, so the grouping
                  hairline the header relies on was invisible there. */}
              <span aria-hidden="true" className="hidden h-6 border-l border-default sm:block" />

              <ThemeToggle />
              <LanguageToggle className="hidden lg:inline-flex" />

              <span aria-hidden="true" className="h-6 border-l border-default" />

              <NotificationBell />
              <ProfileMenu />
            </div>
          </header>

          <main
            id="main-content"
            tabIndex={-1}
            className="min-w-0 flex-1 outline-none"
          >
            <div className="w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
              {(title || actions) && (
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                  {title && (
                    <h1 className="font-heading text-display-sm text-default">{title}</h1>
                  )}
                  {actions && <div className="flex items-center gap-2">{actions}</div>}
                </div>
              )}
              {children}
            </div>
          </main>
        </div>
      </div>

      <MobileTabBar />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}

export { DashboardLayout };
