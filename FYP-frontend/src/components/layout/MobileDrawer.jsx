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
        // One utility group, read as a group: the hairline is the same divider
        // idiom the header's right cluster uses.
        //
        // `border-default`, not `border-subtle`: ui/Drawer renders its footer on
        // `bg-surface-sunken`, and in light mode `--color-line-subtle` and
        // `--color-surface-sunken` are the SAME rgb(241 245 249), so this rule was
        // drawn in the exact colour it sat on.
        <div className="mr-auto flex items-center gap-2">
          <ThemeToggle />
          <span aria-hidden="true" className="h-6 border-l border-default" />
          <LanguageToggle />
        </div>
      )}
    >
      <div className="flex flex-col gap-5 p-4">
        {auth.isAuthenticated && auth.user ? (
          // A quiet sunken well, not a tinted gradient wash: the identity card
          // is context, not a call to action, and the old recipe needed a
          // dark: override to stop double-flipping. `border-default` because the
          // fill is sunken (see the footer note above).
          <div className="flex items-center gap-3 rounded-card border border-default bg-surface-sunken p-3">
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
            {/* Same hierarchy as the header, same order: log in is the quiet
                `ghost`, registering is the solid `primary`, and neither competes
                with the gradient scan CTA below.
                `primary`, not `outline`: the header's "Sign up" is `primary`, and
                the two are the same decision on two screens. An outline here made
                the drawer's account CTA quieter than the header's for no reason. */}
            <Button as={NavLink} to="/login" variant="ghost" fullWidth leftIcon={<LogIn className="h-4 w-4" />}>
              Log in
            </Button>
            <Button as={NavLink} to="/register" variant="primary" fullWidth leftIcon={<UserPlus className="h-4 w-4" />}>
              Create account
            </Button>
          </div>
        )}

        <QuickScanButton variant="block" onNavigate={onClose} />

        {items.length > 0 && (
          <nav aria-label="Main">
            {/* The vertical form of the header's segmented track: one sunken
                well, and the current destination raised inside it. An empty
                track would render as a stray sunken pill, so it is not built.
                `border-default` for the same reason the other sunken wells use it. */}
            <ul className="flex flex-col gap-1 rounded-card border border-default bg-surface-sunken/60 p-1.5">
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.id}>
                    <NavLink
                      to={item.to}
                      end={item.end}
                      onClick={onClose}
                      className={({ isActive }) => cn(
                        'flex items-center gap-3 rounded-field px-3 py-2.5 text-body-md',
                        'transition-[background-color,box-shadow,color] duration-150 ease-emphasized',
                        'motion-reduce:transition-none',
                        'outline-none focus-visible:ring-2 focus-visible:ring-focus',
                        isActive
                          // An elevated chip, not a second gradient: the scan CTA
                          // above it owns the only gradient fill in the drawer.
                          ? 'bg-surface-raised font-semibold text-default shadow-soft'
                          : 'text-muted hover:bg-surface-raised/70 hover:text-default',
                      )}
                    >
                      {({ isActive }) => (
                        <>
                          {Icon && (
                            <Icon
                              className={cn('h-5 w-5 shrink-0', isActive ? 'text-primary-700' : 'text-subtle')}
                              aria-hidden="true"
                            />
                          )}
                          <span className="truncate">{item.label}</span>
                        </>
                      )}
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </nav>
        )}

        {auth.workspaces?.length > 1 && (
          <div>
            <p className="mb-2 px-1 text-overline text-subtle">Switch workspace</p>
            <WorkspaceSwitcher variant="inline" onNavigate={onClose} />
          </div>
        )}

        {auth.isAuthenticated && (
          <>
            {/* Session controls are their own group, so they get the same
                hairline boundary the header cluster uses. */}
            <span aria-hidden="true" className="border-t border-default" />
            <Button
              variant="ghost"
              fullWidth
              leftIcon={<LogOut className="h-4 w-4" />}
              onClick={() => { auth.logout(); onClose?.(); }}
              // Keeps ghost's geometry and focus ring, re-points only the tones.
              // The press step has to be re-pointed too, or ghost's neutral
              // `active:` colour lands in the middle of a danger-tinted control.
              className="justify-start text-danger-700 hover:bg-danger-50 active:bg-danger-100"
            >
              Logout
            </Button>
          </>
        )}
      </div>
    </Drawer>
  );
}

export { MobileDrawer };
