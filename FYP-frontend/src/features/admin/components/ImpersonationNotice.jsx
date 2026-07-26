/**
 * ImpersonationNotice — why the admin console is empty right now.
 *
 * Effective permissions while delegating are an INTERSECTION of the admin's and
 * the target's, so every `/admin/*` route answers 403 the moment
 * `X-Act-As-User-Id` is on the wire. Without this, an admin who wandered back to
 * the console mid-impersonation would see six pages of "Could not load this
 * list" and reasonably conclude the backend was broken.
 *
 * The pages pass `enabled={!actingAs}` to `usePaginatedQuery`, so no doomed
 * request is even sent; this component explains the resulting blank and offers
 * the two ways out.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';

import { Alert, Button } from '../../../components/ui';
import { useAuth } from '../../../context/AuthContext';
import useExitActingAs from '../../../components/layout/useExitActingAs';
import { ROLES } from '../../../lib/permissions';
import { PATHS } from '../../../routes';

const HOME_FOR_ROLE = {
  [ROLES.DOCTOR]: PATHS.DOCTOR_REFERRALS,
  [ROLES.PATIENT]: PATHS.PATIENT_SCANS,
};

/** @returns {React.ReactElement|null} null when not impersonating. */
export function ImpersonationNotice() {
  const { actingAs } = useAuth();
  const navigate = useNavigate();
  // This notice only ever renders ON an admin page, so the hook's "already home"
  // branch applies and Exit restores THIS page rather than jumping to Overview.
  const exitActingAs = useExitActingAs();

  if (!actingAs) return null;

  return (
    <Alert
      tone="danger"
      title={`The admin console is paused while you act as ${actingAs.name}`}
      icon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}
      actions={
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="danger"
            onClick={() => navigate(HOME_FOR_ROLE[actingAs.role] || PATHS.PATIENT_SCANS)}
          >
            Go to their workspace
          </Button>
          <Button size="sm" variant="outline" onClick={exitActingAs}>
            Exit and return to admin
          </Button>
        </div>
      }
    >
      While you are acting as someone else the server treats you as them, so admin-only
      data is deliberately unreachable. Exit to get the console back — nothing is lost.
    </Alert>
  );
}

export default ImpersonationNotice;
