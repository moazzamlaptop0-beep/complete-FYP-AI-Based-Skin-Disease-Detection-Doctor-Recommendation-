/**
 * NotificationBell — what changed since you last looked.
 *
 * There is no notifications table in the backend, and inventing a fake one
 * would be worse than nothing. So this derives its list from the SSE payload
 * the session ALREADY receives through RealtimeContext:
 *
 *   doctor stream  -> scans awaiting review, plus the pending appointment count
 *   patient stream -> scans a doctor has commented on, plus clinic invites
 *
 * "Seen" is tracked locally (a timestamp in the namespaced store), which is the
 * honest thing to do until the backend has real per-user notification state:
 * the badge clears for you, on this device, and never lies about being synced.
 *
 * The count is exposed to assistive tech through an `aria-live="polite"` label
 * rather than a bare red dot, since a dot is invisible to a screen reader.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, BellOff } from 'lucide-react';

import { cn } from '../../lib/cn';
import { useOptionalAuth } from '../../context/AuthContext';
import { useOptionalRealtime } from '../../context/RealtimeContext';
import { formatRelativeTime } from '../../lib/format';
import * as storage from '../../lib/storage';
import useMenu from './useMenu';
import { deriveNotifications } from './notifications';

const SEEN_KEY = 'notifications_seen_at';
const MAX_ITEMS = 8;


/**
 * @param {object} props
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {string} [props.className]
 */
export default function NotificationBell({ size = 'md', className }) {
  const auth = useOptionalAuth();
  const realtime = useOptionalRealtime();
  const [seenAt, setSeenAt] = useState(() => storage.get(SEEN_KEY, 0) || 0);

  const items = useMemo(
    () => deriveNotifications(realtime?.data, realtime?.stream?.kind),
    [realtime?.data, realtime?.stream?.kind],
  );

  const unread = useMemo(() => {
    if (!items.length) return 0;
    // Anything we cannot date is counted as unread — under-reporting a clinical
    // update is worse than over-reporting one.
    return items.filter((item) => {
      const time = item.at ? new Date(item.at).getTime() : NaN;
      return Number.isNaN(time) ? true : time > seenAt;
    }).length;
  }, [items, seenAt]);

  const menu = useMenu({ itemCount: items.length });

  const markSeen = useCallback(() => {
    const now = Date.now();
    storage.set(SEEN_KEY, now);
    setSeenAt(now);
  }, []);

  if (!auth?.isAuthenticated) return null;

  const badge = unread > 9 ? '9+' : String(unread);

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        {...menu.getTriggerProps({
          onClick: () => { if (!menu.open) markSeen(); },
        })}
        className={cn(
          'relative inline-flex items-center justify-center rounded-field text-muted',
          'transition-colors hover:bg-surface-sunken hover:text-default',
          'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
          'focus-visible:ring-offset-canvas',
          size === 'sm' ? 'h-8 w-8' : size === 'lg' ? 'h-12 w-12' : 'h-10 w-10',
        )}
      >
        <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
        <span className="ui-sr-only" aria-live="polite">
          {unread ? `Notifications, ${unread} unread` : 'Notifications, none unread'}
        </span>
        {unread > 0 && (
          <span
            aria-hidden="true"
            className={cn(
              'absolute -right-0.5 -top-0.5 inline-flex min-w-[1.15rem] items-center justify-center',
              'rounded-pill bg-danger-600 px-1 text-[0.625rem] font-bold leading-[1.15rem] text-white',
              'ring-2 ring-surface',
            )}
          >
            {badge}
          </span>
        )}
      </button>

      {menu.open && (
        <div
          {...menu.getMenuProps({ 'aria-label': 'Notifications' })}
          className={cn(
            'absolute right-0 z-dropdown mt-2 w-80 max-w-[calc(100vw-2rem)] overflow-hidden',
            'rounded-card border border-subtle bg-surface shadow-popover animate-ui-fade-in',
          )}
        >
          <div className="flex items-center justify-between border-b border-subtle px-3 py-2">
            <p className="text-overline text-muted">Notifications</p>
            {realtime && !realtime.isConnected && (
              <span className="text-caption text-muted">offline</span>
            )}
          </div>

          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
              <BellOff className="h-6 w-6 text-subtle" aria-hidden="true" />
              <p className="text-body-sm text-muted">You are all caught up.</p>
            </div>
          ) : (
            <ul className="ui-scrollbar max-h-80 overflow-y-auto py-1">
              {items.map((item, index) => (
                <li key={item.id}>
                  <Link
                    to={item.to}
                    {...menu.getItemProps(index)}
                    className={cn(
                      'flex flex-col gap-0.5 px-3 py-2.5 outline-none transition-colors',
                      'hover:bg-surface-sunken focus-visible:bg-surface-sunken',
                      menu.activeIndex === index && 'bg-surface-sunken',
                    )}
                  >
                    <span className="truncate text-label-md text-default">{item.title}</span>
                    {item.detail && (
                      <span className="line-clamp-2 text-caption text-muted">{item.detail}</span>
                    )}
                    {item.at && (
                      <span className="text-caption text-subtle">
                        {formatRelativeTime(item.at, { placeholder: '' })}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export { NotificationBell };
