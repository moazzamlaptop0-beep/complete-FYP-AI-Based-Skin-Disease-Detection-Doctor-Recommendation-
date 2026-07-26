/**
 * MobileDrawer — the navigation the app does not have today.
 *
 * On a 375px screen right now: the doctor sidebar is `hidden md:flex`, so a
 * doctor on a phone has NO navigation at all beyond the browser back button,
 * and the admin sidebar is a fixed `w-64`, leaving ~39px of content width.
 * This drawer is the mobile answer for both.
 *
 * It is built on `ui/Drawer`, which already owns the portal, the focus trap,
 * the reference-counted scroll lock and Esc handling — so this file is purely
 * about WHAT is in the drawer, not about dialog mechanics.
 *
 * Every navigation closes the drawer. A drawer left open behind a route change
 * is the classic mobile-nav bug: the user taps a link, the page changes, and
 * the panel is still covering it.
 */

import React, { useEffect } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LogIn, LogOut, UserPlus } from 'lucide-react';

import { cn } from '../../lib/cn';
import { useAuth } from '../../context/AuthContext';
import { doctorImageUrl } from '../../lib/imageUrl';
import Avatar from '../ui/Avatar';
import { RoleBadge } from '../ui/Badge';
import Button from '../ui/Button';
import Drawer from '../ui/Drawer';
import LanguageToggle from './LanguageToggle';
import QuickScanButton from './QuickScanButton';
import ThemeToggle from './ThemeToggle';
import WorkspaceSwitcher from './WorkspaceSwitcher';
import { PRIMARY_NAV, visibleNav } from './navigation';

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export default function MobileDrawer({ open, onClose }) {
  const auth = useAuth();
  const location = useLocation();

  // Close on every route change — including a link tapped inside the drawer.
  useEffect(() => {
    if (open) onClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  const items = visibleNav(PRIMARY_NAV, {
    permissions: auth.permissions,
    isAuthenticated: auth.isAuthenticated,
    role: auth.effectiveRole,
  });

  const avatarSrc = doctorImageUrl(auth.doctor) || undefined;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="left"
      size="sm"
      title="Menu"
      bodyClassName="p-0"
      footer={(
        <div className="flex w-full items-center justify-between gap-2">
          <ThemeToggle />
          <LanguageToggle />
        </div>
      )}
    >
      <div className="flex flex-col gap-5 p-4">
        {auth.isAuthenticated && auth.user ? (
          <div className="flex items-center gap-3 rounded-card bg-surface-sunken p-3">
            <Avatar src={avatarSrc} name={auth.user.name} size="lg" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-label-lg text-default">{auth.user.name}</p>
              <p className="truncate text-caption text-muted">{auth.user.email}</p>
              <div className="mt-1">
                <RoleBadge role={auth.user.role} />
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <Button as={NavLink} to="/login" variant="outline" fullWidth leftIcon={<LogIn className="h-4 w-4" />}>
              Log in
            </Button>
            <Button as={NavLink} to="/register" variant="ghost" fullWidth leftIcon={<UserPlus className="h-4 w-4" />}>
              Create account
            </Button>
          </div>
        )}

        <QuickScanButton variant="block" onNavigate={onClose} />

        <nav aria-label="Main">
          <ul className="flex flex-col gap-1">
            {items.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.id}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onClose}
                    className={({ isActive }) => cn(
                      'flex items-center gap-3 rounded-field px-3 py-2.5 text-body-md transition-colors',
                      'outline-none focus-visible:ring-2 focus-visible:ring-focus',
                      isActive
                        ? 'bg-primary-50 font-semibold text-primary-900'
                        : 'text-default hover:bg-surface-sunken',
                    )}
                  >
                    {Icon && <Icon className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />}
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                </li>
              );
            })}
          </ul>
        </nav>

        {auth.workspaces?.length > 1 && (
          <div>
            <p className="mb-2 px-1 text-overline text-muted">Switch workspace</p>
            <WorkspaceSwitcher variant="inline" onNavigate={onClose} />
          </div>
        )}

        {auth.isAuthenticated && (
          <Button
            variant="ghost"
            fullWidth
            leftIcon={<LogOut className="h-4 w-4" />}
            onClick={() => { auth.logout(); onClose?.(); }}
            className="justify-start text-danger-700 hover:bg-danger-50"
          >
            Logout
          </Button>
        )}
      </div>
    </Drawer>
  );
}

export { MobileDrawer };
