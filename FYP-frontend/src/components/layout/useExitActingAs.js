/**
 * useExitActingAs — leaving impersonation has to MOVE you, not just flip a flag.
 *
 * THE BUG THIS FIXES
 * ------------------
 * `AuthContext.exitActingAs()` clears the delegation and nothing else. So an
 * admin who was acting as a doctor on `/doctor/referrals` and pressed Exit stayed
 * on `/doctor/referrals` — as themselves. That page is still *reachable* (an admin
 * holds every doctor permission, and the route guard is by permission), but it is
 * now their OWN doctor surface, which is empty by construction: there is no
 * `doctor_profiles` row behind an admin account, so no referrals, no schedule, no
 * ratings. The screen kept showing the doctor's data until something refetched,
 * and then showed nothing.
 *
 * It got worse once the doctor and patient nav rows became `excludeRoles:
 * [ROLES.ADMIN]` (routes.js): the sidebar filters on the EFFECTIVE role, so the
 * moment the delegation cleared, every doctor link disappeared too. Exit left the
 * admin on a stale page with no navigation at all.
 *
 * THE RULE
 * --------
 * Go to your own workspace home, unless you are already inside it.
 *
 * One rule, no special cases, and the second half matters: an admin who wandered
 * back to `/admin/doctors` mid-impersonation (where `ImpersonationNotice` explains
 * the blank table) presses Exit to get THAT page back — jumping them to Overview
 * would be a second surprise. Everywhere else, moving is the safe answer:
 * `/consult` while acting as a patient is a scan being uploaded to THEIR account,
 * and carrying on as the admin would silently attach it to the wrong one.
 *
 * `replace: true` — the impersonated URL must not stay in history. Pressing Back
 * would put the admin straight back on the stale page they just escaped.
 *
 * Every Exit control routes through here (ViewAsBanner, ImpersonationNotice,
 * ViewAsPicker) so the three cannot drift apart.
 */

import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useOptionalAuth } from '../../context/AuthContext';
import { activeWorkspace } from './workspaces';

/**
 * @returns {() => void} Clears the delegation and navigates home when needed.
 */
export function useExitActingAs() {
  const auth = useOptionalAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return useCallback(() => {
    // Read the destination BEFORE clearing: `workspaces` is derived from the
    // admin's own row and is not affected by the delegation, but computing it
    // first keeps this correct even if that ever changes.
    const workspaces = Array.isArray(auth?.workspaces) ? auth.workspaces : [];
    const own = workspaces[0] || null;
    const home = own?.home || own?.route || auth?.homeRoute || '/';

    // Already inside our own section? Stay put — `activeWorkspace` matches by
    // route prefix, so `/admin/doctors` resolves to the admin workspace.
    const alreadyHome = Boolean(own) && activeWorkspace(workspaces, location.pathname)?.id === own.id;

    auth?.exitActingAs?.();

    if (!alreadyHome) navigate(home, { replace: true });
  }, [auth, navigate, location.pathname]);
}

export default useExitActingAs;
