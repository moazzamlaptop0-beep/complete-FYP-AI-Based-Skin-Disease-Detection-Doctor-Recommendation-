/**
 * ProfileMenu — avatar + name + role badge, with the account dropdown.
 *
 * Replaces HeaderProfileDropdown.jsx (doctor-only, no keyboard support, its own
 * logout) and the two other places that render a name and a "Logout" link. The
 * logout here is AuthContext's — the ONE implementation.
 *
 * Accessibility (the whole point of `useMenu`):
 *   aria-haspopup="menu" + aria-expanded on the trigger, ArrowUp/ArrowDown
 *   roving focus, Home/End, Esc closes and returns focus to the trigger, Tab
 *   closes, click-outside closes.
 *
 * Menu items are filtered by PERMISSION: "My Scans" appears for a doctor too,
 * because a doctor holds `scan.read.own`. That is the single-account outcome —
 * a dermatologist scanning their own mole never needs a second login.
 */

import React, { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronDown, LogOut } from 'lucide-react';

import { cn } from '../../lib/cn';
import { useAuth } from '../../context/AuthContext';
import { doctorImageUrl } from '../../lib/imageUrl';
import Avatar from '../ui/Avatar';
import { RoleBadge } from '../ui/Badge';
import { PROFILE_MENU_ITEMS, visibleNav } from './navigation';
import useMenu from './useMenu';

/**
 * @param {object} props
 * @param {boolean} [props.showName=true] Hide the name on very tight headers.
 * @param {'sm'|'md'} [props.size='md']
 * @param {string} [props.className]
 */
export default function ProfileMenu({ showName = true, size = 'md', className }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [loggingOut, setLoggingOut] = useState(false);

  const items = useMemo(
    () => visibleNav(PROFILE_MENU_ITEMS, {
      permissions: auth.permissions,
      isAuthenticated: auth.isAuthenticated,
      role: auth.effectiveRole,
    }),
    [auth.permissions, auth.isAuthenticated, auth.effectiveRole],
  );

  // +1 for Logout, which is always last and always present.
  const menu = useMenu({ itemCount: items.length + 1 });

  if (!auth.isAuthenticated || !auth.user) return null;

  const user = auth.user;
  const avatarSrc = doctorImageUrl(auth.doctor) || undefined;

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await auth.logout();
    } finally {
      setLoggingOut(false);
      navigate('/', { replace: true });
    }
  };

  const itemClass = (index) => cn(
    'flex w-full items-center gap-3 px-3 py-2 text-left text-body-sm text-default',
    'outline-none transition-colors hover:bg-surface-sunken focus-visible:bg-surface-sunken',
    menu.activeIndex === index && 'bg-surface-sunken',
  );

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        {...menu.getTriggerProps()}
        className={cn(
          'flex items-center gap-2 rounded-pill border border-transparent p-1 pr-2 text-left',
          'transition-colors hover:bg-surface-sunken',
          'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
          'focus-visible:ring-offset-canvas',
          menu.open && 'bg-surface-sunken',
        )}
      >
        <Avatar src={avatarSrc} name={user.name} size={size === 'sm' ? 'sm' : 'md'} />
        {showName && (
          <span className="hidden min-w-0 flex-col leading-tight sm:flex">
            <span className="truncate text-label-md text-default">{user.name}</span>
            <span className="truncate text-caption text-muted">{user.email}</span>
          </span>
        )}
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted transition-transform', menu.open && 'rotate-180')}
          aria-hidden="true"
        />
      </button>

      {menu.open && (
        <div
          {...menu.getMenuProps({ 'aria-label': 'Account menu' })}
          className={cn(
            'absolute right-0 z-dropdown mt-2 w-64 origin-top-right overflow-hidden rounded-card',
            'border border-subtle bg-surface shadow-popover',
            'animate-ui-fade-in',
          )}
        >
          <div className="flex items-center gap-3 border-b border-subtle px-3 py-3">
            <Avatar src={avatarSrc} name={user.name} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-label-lg text-default">{user.name}</p>
              <p className="truncate text-caption text-muted">{user.email}</p>
            </div>
          </div>

          <div className="flex items-center gap-2 px-3 py-2">
            <RoleBadge role={user.role} />
            {auth.doctor?.verification_status && (
              <span className="truncate text-caption text-muted">
                {auth.doctor.verification_status === 'approved' ? 'Verified doctor' : 'Verification pending'}
              </span>
            )}
          </div>

          <div className="border-t border-subtle py-1">
            {items.map((item, index) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.id}
                  to={item.to}
                  {...menu.getItemProps(index)}
                  className={itemClass(index)}
                >
                  {Icon && <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </div>

          <div className="border-t border-subtle py-1">
            <button
              type="button"
              {...menu.getItemProps(items.length, { onClick: handleLogout })}
              disabled={loggingOut}
              className={cn(itemClass(items.length), 'text-danger-700 hover:bg-danger-50 disabled:opacity-60')}
            >
              <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{loggingOut ? 'Logging out…' : 'Logout'}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export { ProfileMenu };
