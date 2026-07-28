/**
 * ViewAsBanner — the impersonation seatbelt.
 *
 * When an admin is acting as another user, EVERY request carries
 * `X-Act-As-User-Id` and the backend writes an `audit_logs` row for each one.
 * The person doing it must never be able to forget that:
 *
 *   - the banner is `sticky` at the very top and cannot be dismissed, only exited
 *   - it says explicitly that actions are recorded, because they are
 *   - it is `role="status"` + `aria-live="polite"`, so it is announced when the
 *     session starts rather than sitting silently above the fold
 *   - it uses the danger tone, the only place in the chrome that does
 *
 * It also stamps `data-acting-as="true"` on <body> as a styling hook, so a
 * whole-viewport danger frame can be added in one CSS rule — peripheral vision
 * catches that even on a short viewport where the banner has scrolled away.
 * The rule itself belongs in `src/styles/ui.css`, which this agent does not
 * own; until it lands, the attribute is simply inert.
 */

import React, { useEffect } from 'react';
import { LogOut, ShieldAlert } from 'lucide-react';

import { cn } from '../../lib/cn';
import { useOptionalAuth } from '../../context/AuthContext';
import Button from '../ui/Button';
import useExitActingAs from './useExitActingAs';

/**
 * @param {object} props
 * @param {{userId:number,name?:string,role?:string}} [props.actingAs] Override (Storybook/tests).
 * @param {() => void} [props.onExit] Override the exit handler.
 * @param {string} [props.className]
 */
export default function ViewAsBanner({ actingAs: actingAsProp, onExit, className }) {
  const auth = useOptionalAuth();
  const actingAs = actingAsProp ?? auth?.actingAs ?? null;
  // NOT auth.exitActingAs directly: clearing the delegation without navigating
  // leaves the admin on the impersonated page as themselves, which after the
  // excludeRoles change means a stale page with no sidebar. See the hook.
  const exitAndGoHome = useExitActingAs();

  // A body-level marker so the whole viewport can be framed while impersonating.
  useEffect(() => {
    if (typeof document === 'undefined' || !document.body) return undefined;
    if (actingAs) document.body.setAttribute('data-acting-as', 'true');
    else document.body.removeAttribute('data-acting-as');
    return () => document.body.removeAttribute('data-acting-as');
  }, [actingAs]);

  if (!actingAs) return null;

  const exit = onExit || exitAndGoHome;
  const name = actingAs.name || `User #${actingAs.userId}`;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'sticky top-0 z-sticky w-full border-b border-danger-700 bg-danger-600 text-white',
        className,
      )}
    >
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
        <ShieldAlert className="h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-body-sm">
          <span className="font-semibold">Acting as {name}</span>
          {actingAs.role ? <span className="opacity-90"> ({actingAs.role})</span> : null}
          <span className="opacity-90">: every action is recorded.</span>
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={exit}
          leftIcon={<LogOut className="h-4 w-4" />}
          className="border-white/70 bg-white/10 text-white hover:bg-white/20 hover:border-white"
        >
          Exit
        </Button>
      </div>
    </div>
  );
}

export { ViewAsBanner };
