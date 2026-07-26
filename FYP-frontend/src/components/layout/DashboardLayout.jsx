/**
 * DashboardLayout — the responsive frame the dashboards do not have today.
 *
 * WHAT IS BROKEN RIGHT NOW
 *  - DoctorDashboard's sidebar is `hidden md:flex`: on a phone the doctor has
 *    NO navigation at all, only the browser back button.
 *  - AdminDashboard's sidebar is a fixed `w-64`: on a 375px screen that leaves
 *    about 39px for the actual content.
 *
 * THREE LAYOUTS, ONE COMPONENT
 *  - `lg` and up : full sidebar, `w-72`, section headings, labels
 *  - `md` to `lg`: icon rail, `w-[4.5rem]`, labels become accessible names and
 *    native tooltips — the tablet keeps its navigation instead of losing it
 *  - below `md`  : no sidebar; the MobileTabBar owns primary navigation and the
 *    header hamburger opens MobileDrawer for everything else
 *
 * The sidebar is a real `<aside>` with `aria-label`, and the desktop collapse
 * preference is persisted, because someone who works on a 13" laptop collapses
 * it once and should not have to do it again every morning.
 *
 * NOT WIRED INTO ROUTING THIS PHASE.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';

import { cn } from '../../lib/cn';
import { useAuth } from '../../context/AuthContext';
import * as storage from '../../lib/storage';
import IconButton from '../ui/IconButton';
import AppNavbar from './AppNavbar';
import MobileTabBar from './MobileTabBar';
import ViewAsBanner from './ViewAsBanner';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import { activeWorkspace } from './workspaces';
import { WORKSPACE_NAV, visibleSections } from './navigation';

const COLLAPSE_KEY = 'sidebar_collapsed';

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
    'group relative flex items-center gap-3 rounded-field px-3 py-2.5 text-body-md transition-colors',
    'outline-none focus-visible:ring-2 focus-visible:ring-focus',
    // Tablet rail: centre the icon, drop the label.
    'lg:justify-start',
    collapsed ? 'lg:justify-center' : '',
    'max-lg:justify-center',
    isActive
      ? 'bg-primary-50 font-semibold text-primary-900 dark:bg-surface-sunken dark:text-primary-700'
      : 'text-muted hover:bg-surface-sunken hover:text-default',
  );

  const showLabels = !collapsed;

  return (
    <div className={cn('flex min-h-screen flex-col bg-canvas text-default', className)}>
      <ViewAsBanner />
      <AppNavbar />

      <div className="mx-auto flex w-full max-w-[96rem] flex-1 gap-0">
        {/* Sidebar: full at lg+, icon rail at md, gone below md (MobileTabBar
            and MobileDrawer take over). */}
        <aside
          aria-label="Dashboard navigation"
          className={cn(
            'sticky top-16 hidden h-[calc(100vh-4rem)] shrink-0 flex-col border-r border-subtle',
            'bg-surface md:flex',
            collapsed ? 'lg:w-[4.5rem]' : 'lg:w-72',
            'w-[4.5rem]',
          )}
        >
          <div className={cn('flex items-center gap-2 px-3 py-4', collapsed && 'justify-center')}>
            {showLabels && (
              <div className="hidden min-w-0 flex-1 lg:block">
                <WorkspaceSwitcher />
              </div>
            )}
            <IconButton
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-pressed={collapsed}
              size="sm"
              onClick={toggleCollapsed}
              className="hidden lg:inline-flex"
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </IconButton>
          </div>

          <nav className="ui-scrollbar flex-1 overflow-y-auto px-2 pb-4">
            {sections.map((section) => (
              <div key={section.title || 'section'} className="mb-4">
                {section.title && showLabels && (
                  <p className="hidden px-3 pb-1 pt-2 text-overline text-muted lg:block">
                    {section.title}
                  </p>
                )}
                <ul className="flex flex-col gap-0.5">
                  {section.items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.id}>
                        <NavLink to={item.to} end={item.end} className={linkClass} title={item.label}>
                          {Icon && <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />}
                          {/* Tailwind's own sr-only/not-sr-only pair (NOT the
                              custom .ui-sr-only) so the rail keeps an accessible
                              name at md and shows the real label at lg. */}
                          <span className={cn('truncate', collapsed ? 'sr-only' : 'sr-only lg:not-sr-only')}>
                            {item.label}
                          </span>
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          {sidebarFooter && (
            <div className="border-t border-subtle p-3">{sidebarFooter}</div>
          )}
        </aside>

        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 outline-none"
        >
          <div className="mx-auto w-full px-4 py-6 sm:px-6 sm:py-8">
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

      <MobileTabBar />
    </div>
  );
}

export { DashboardLayout };
