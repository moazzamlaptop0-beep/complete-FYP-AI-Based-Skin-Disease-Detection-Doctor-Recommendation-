/**
 * MobileTabBar — the persistent bottom navigation for phones.
 *
 * Four destinations plus the raised Scan CTA in the middle, because the thumb
 * reaches the bottom of a phone and does not reach a header. It is `sticky`
 * rather than `fixed` inside AppShell's flex column, so it never covers the
 * last row of a list — and it reserves `env(safe-area-inset-bottom)` so the
 * iPhone home indicator does not sit on top of the tab labels.
 *
 * Hidden from `md:` up, where AppNavbar and DashboardLayout's sidebar take over.
 */

import React from 'react';
import { NavLink } from 'react-router-dom';

import { cn } from '../../lib/cn';
import { useOptionalAuth } from '../../context/AuthContext';
import QuickScanButton from './QuickScanButton';
import { visibleTabBar } from './navigation';

/**
 * @param {object} props
 * @param {boolean} [props.showScanButton=true]
 * @param {string} [props.className]
 */
export default function MobileTabBar({ showScanButton = true, className }) {
  const auth = useOptionalAuth();

  // visibleTabBar filters for this session and THEN takes the first four — the
  // other order would slice off the admin tabs before the patient tabs an admin
  // cannot see had been removed. See TAB_BAR_NAV in navigation.js.
  const items = visibleTabBar({
    permissions: auth?.permissions || [],
    isAuthenticated: Boolean(auth?.isAuthenticated),
    role: auth?.effectiveRole || null,
  });

  if (!items.length) return null;

  // Split around the centre CTA.
  const half = Math.ceil(items.length / 2);
  const left = items.slice(0, half);
  const right = items.slice(half);

  const link = ({ isActive }) => cn(
    'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-2',
    'text-[0.6875rem] font-semibold transition-colors',
    'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-inset',
    isActive ? 'text-primary-700' : 'text-muted hover:text-default',
  );

  const renderItem = (item) => {
    const Icon = item.icon;
    return (
      <NavLink key={item.id} to={item.to} end={item.end} className={link}>
        {({ isActive }) => (
          <>
            {Icon && (
              <Icon
                className={cn('h-5 w-5', isActive && 'text-primary-700')}
                aria-hidden="true"
              />
            )}
            <span className="max-w-full truncate">{item.label}</span>
          </>
        )}
      </NavLink>
    );
  };

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'sticky bottom-0 z-sticky border-t border-subtle bg-surface/95 backdrop-blur',
        'pb-[env(safe-area-inset-bottom)] md:hidden',
        className,
      )}
    >
      <div className="relative flex items-stretch">
        {left.map(renderItem)}

        {showScanButton && (
          // The CTA overhangs the bar; the spacer keeps the flex row honest so
          // the tabs either side stay evenly divided.
          <div className="relative flex w-16 shrink-0 items-start justify-center">
            <div className="absolute -top-5">
              <QuickScanButton variant="fab" label="Scan my skin" />
            </div>
          </div>
        )}

        {right.map(renderItem)}
      </div>
    </nav>
  );
}

export { MobileTabBar };
