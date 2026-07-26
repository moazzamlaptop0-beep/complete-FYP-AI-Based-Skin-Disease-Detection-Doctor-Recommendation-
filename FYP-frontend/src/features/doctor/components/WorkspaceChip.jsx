/**
 * WorkspaceChip — the persistent "you are here" marker for the doctor surface.
 *
 * WHY IT EXISTS
 * -------------
 * A doctor on this platform is also a person with skin. The RBAC refactor gives
 * Doctor every Patient permission by union, so `/patient/*` is genuinely theirs
 * — but only if they can tell, at a glance, which of their two surfaces they are
 * looking at. Without a marker, "why can't I see my own mole scan here?" turns
 * into a second account, which is exactly what this project set out to remove.
 *
 * THIS IS NOT IMPERSONATION. Switching is pure navigation with the SAME user id
 * and the SAME token — no `X-Act-As-User-Id`, no audit row. `ViewAsBanner` is
 * the impersonation surface and it looks deliberately different.
 *
 * The switch link only renders when this account actually holds the patient
 * workspace, so a hypothetical doctor without SCAN_READ_OWN never sees a control
 * that would 403.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeftRight, Stethoscope } from 'lucide-react';

import { cn } from '../../../lib/cn';
import { useAuth } from '../../../context/AuthContext';
import { PERMISSIONS } from '../../../lib/permissions';
import { PATHS } from '../../../routes';

/**
 * @param {object} props
 * @param {boolean} [props.showSwitch=true] Hide the switch link on pages that
 *   already offer one (e.g. inside a nav bar).
 * @param {string} [props.className]
 */
export default function WorkspaceChip({ showSwitch = true, className }) {
  const { can, user } = useAuth();
  const hasPatientWorkspace = can(PERMISSIONS.SCAN_READ_OWN);

  return (
    <div
      className={cn(
        'inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-pill border border-subtle',
        'bg-surface-sunken px-3 py-1.5 text-caption text-muted',
        className,
      )}
    >
      <span className="inline-flex items-center gap-1.5 font-semibold text-default">
        <Stethoscope className="h-3.5 w-3.5 text-primary-700" aria-hidden="true" />
        Doctor workspace
      </span>

      {showSwitch && hasPatientWorkspace && (
        <>
          <span aria-hidden="true" className="text-subtle">·</span>
          <Link
            to={PATHS.PATIENT_SCANS}
            className={cn(
              'inline-flex items-center gap-1 rounded-field px-1 py-0.5 font-semibold text-primary-700',
              'underline-offset-2 hover:underline',
              'outline-none focus-visible:ring-2 focus-visible:ring-focus',
            )}
            title="Open your own patient records. Same account — this is not impersonation."
          >
            <ArrowLeftRight className="h-3.5 w-3.5" aria-hidden="true" />
            My own skin health
          </Link>
        </>
      )}

      {user?.name && (
        <span className="ui-sr-only">
          Signed in as {user.name}. Switching workspace keeps the same account.
        </span>
      )}
    </div>
  );
}

export { WorkspaceChip };
