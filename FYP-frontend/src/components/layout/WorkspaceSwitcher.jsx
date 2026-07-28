/**
 * WorkspaceSwitcher — one account, several surfaces.
 *
 * THE PROBLEM IT SOLVES
 * A dermatologist on this platform is also a person with skin. Today the only
 * way for them to scan their own mole is to register a SECOND account with a
 * different email, because every gate is `user.role === 'Doctor'`. After the
 * RBAC refactor a Doctor genuinely holds every Patient permission (the sets are
 * built by union), so the patient surface is theirs by right — it just needs a
 * door. This is the door.
 *
 * It renders nothing when there is only one workspace, so a patient never sees
 * a control that does nothing.
 *
 * Switching is pure navigation: it does NOT change identity, does NOT mint a
 * token and is NOT impersonation (that is ViewAsBanner, and it is audited).
 */

import React, { useMemo } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, ChevronsUpDown, LayoutGrid } from 'lucide-react';

import { cn } from '../../lib/cn';
import { useAuth } from '../../context/AuthContext';
import * as storage from '../../lib/storage';
import useMenu from './useMenu';
import { activeWorkspace } from './workspaces';


/**
 * @param {object} props
 * @param {'button'|'inline'} [props.variant='button'] `inline` renders a flat list (drawers).
 * @param {() => void} [props.onNavigate] Called after switching (close a drawer).
 * @param {string} [props.className]
 */
export default function WorkspaceSwitcher({ variant = 'button', onNavigate, className }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Memoised so the `[]` fallback is not a new array on every render, which
  // would invalidate the `current` memo below every single time.
  const workspaces = useMemo(
    () => (Array.isArray(auth.workspaces) ? auth.workspaces : []),
    [auth.workspaces],
  );
  const current = useMemo(
    () => activeWorkspace(workspaces, location.pathname) || workspaces[0] || null,
    [workspaces, location.pathname],
  );

  const menu = useMenu({ itemCount: workspaces.length });

  // One surface (or none) means there is nothing to switch between.
  if (workspaces.length < 2) return null;

  const go = (workspace) => {
    storage.set(storage.KEYS.WORKSPACE, workspace.id);
    // `route` is the SECTION prefix (`/patient`), which only exists as an alias;
    // `home` is the landing page inside it. Navigating to `home` skips a redirect
    // hop and is what `activeWorkspace` will match on the way back.
    navigate(workspace.home || workspace.route);
    onNavigate?.();
  };

  if (variant === 'inline') {
    return (
      <div className={cn('flex flex-col gap-1', className)} role="group" aria-label="Workspaces">
        {workspaces.map((workspace) => {
          const active = current?.id === workspace.id;
          return (
            <button
              key={workspace.id}
              type="button"
              onClick={() => go(workspace)}
              aria-current={active ? 'true' : undefined}
              className={cn(
                'flex items-start gap-3 rounded-field px-3 py-2.5 text-left transition-colors',
                'outline-none focus-visible:ring-2 focus-visible:ring-focus',
                active ? 'bg-primary-50 text-primary-900' : 'text-default hover:bg-surface-sunken',
              )}
            >
              <LayoutGrid className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-label-lg">{workspace.label}</span>
                <span className="block truncate text-caption text-muted">{workspace.description}</span>
              </span>
              {active && <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary-700" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        {...menu.getTriggerProps({ 'aria-label': `Workspace: ${current?.label || 'none'}. Switch workspace` })}
        className={cn(
          'inline-flex items-center gap-2 rounded-field border border-subtle bg-surface px-3 py-2',
          'text-label-md text-default transition-colors hover:bg-surface-sunken',
          'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
          'focus-visible:ring-offset-canvas',
        )}
      >
        <LayoutGrid className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        <span className="max-w-[9rem] truncate">{current?.label}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
      </button>

      {menu.open && (
        <div
          {...menu.getMenuProps({ 'aria-label': 'Switch workspace' })}
          className={cn(
            'absolute left-0 z-dropdown mt-2 w-72 overflow-hidden rounded-card border border-subtle',
            'bg-surface shadow-popover animate-ui-fade-in',
          )}
        >
          <p
            className={cn(
              'border-b border-subtle px-3 py-2.5 text-overline text-muted',
              'bg-gradient-to-br from-primary-50 via-surface to-accent-50',
              'dark:from-surface-sunken dark:via-surface dark:to-surface-sunken',
            )}
          >
            Workspaces
          </p>
          <div className="p-1">
            {workspaces.map((workspace, index) => {
              const active = current?.id === workspace.id;
              return (
                <button
                  key={workspace.id}
                  type="button"
                  {...menu.getItemProps(index, { onClick: () => go(workspace) })}
                  className={cn(
                    'flex w-full items-start gap-3 rounded-field px-2.5 py-2.5 text-left transition-colors',
                    'outline-none hover:bg-surface-sunken focus-visible:bg-surface-sunken',
                    menu.activeIndex === index && 'bg-surface-sunken',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-label-lg text-default">{workspace.label}</span>
                    <span className="block truncate text-caption text-muted">{workspace.description}</span>
                  </span>
                  {active && <Check className="mt-1 h-4 w-4 shrink-0 text-primary-700" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export { WorkspaceSwitcher };
