/**
 * Account-action lock reasons — a PURE module, deliberately not in the .jsx.
 *
 * Vite's Fast Refresh only hot-swaps modules whose exports are ALL React
 * components; a helper exported beside a component forces a full page reload on
 * every edit, discarding whatever you were part-way through. Same reasoning as
 * components/layout/workspaces.js.
 */

import { ROLES, roleRank } from '../../../lib/permissions';

/**
 * Why this account cannot be reset/deleted, or null when it can.
 *
 * Mirrors `_manage_guard` in app/services/admin_service.py, IN THE SAME ORDER, so
 * a control the server would refuse arrives disabled with the real reason rather
 * than failing after the click.
 *
 * @param {{id?: number, role?: string, is_root?: boolean}} row The target.
 * @param {{id?: number, role?: string}} actor The signed-in admin.
 * @param {'reset'|'delete'} action
 * @returns {string|null}
 */
export function accountActionLock(row, actor, action) {
  if (!row) return 'Unknown account.';
  if (row.is_root) return 'Root accounts are protected. The server refuses to change them at all.';
  if (row.id === actor?.id) {
    return action === 'reset'
      // The server refuses this with a 400 for a concrete reason: the reset bumps
      // token_version, which would revoke the session making the request.
      ? 'Use your own profile to change your password. This would sign you out mid-action.'
      : 'You cannot delete your own account.';
  }
  // `/admin/patients` has no `role` key at all; every row there is a patient.
  const targetRole = row.role || ROLES.PATIENT;
  if (roleRank(actor?.role) <= roleRank(targetRole)) {
    // The rank rule from rbac._apply_delegation, reused: one admin may not reset
    // or delete another admin.
    return 'You can only manage an account with a lower role than your own.';
  }
  return null;
}

export default accountActionLock;
