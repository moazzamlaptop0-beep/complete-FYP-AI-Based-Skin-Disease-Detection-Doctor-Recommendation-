/**
 * ProfilePage — the account page, for a patient, a doctor and an admin alike.
 *
 * WHAT THIS PAGE USED TO SAY, AND WHY IT NO LONGER SAYS IT
 * -------------------------------------------------------
 * Until this round the screen was a read-only record with two honest confessions
 * printed on it: that no endpoint stored a patient profile picture, and that the
 * API exposed no patient profile update route, so a name or email change meant
 * emailing support. Both were true when they were written and both are now false.
 * `GET|PATCH /api/profile` edits any role's own account, `POST|DELETE
 * /api/profile/avatar` stores and removes a photo for any role, and an address
 * change has a real verified flow. Leaving that copy in place would have made the
 * page lie in the opposite direction, so it is gone rather than softened.
 *
 * ONE PAGE, THREE ROLES
 * ---------------------
 * `routes.js` deliberately does NOT exclude `patient.profile` from an admin's
 * chrome: it is the account page every signed-in role needs. So the sections here
 * are keyed off the DATA, not off a role string:
 *   - details / photo / email / password are for everybody;
 *   - the clinic section renders when `GET /api/profile` returned a `doctor`
 *     block, which the backend sends only to a doctor.
 * That last point matters more than it looks. The old code gated the doctor form
 * on `can(DOCTOR_PROFILE_MANAGE)`, and an Admin holds every doctor permission by
 * union — so an admin was shown a clinic form for a DoctorProfile row they do not
 * have. The payload cannot make that mistake.
 *
 * WHY THE PAGE OWNS THE PROFILE AND THE CARDS DO NOT REFETCH
 * ---------------------------------------------------------
 * One `GET /api/profile` feeds every section, and each card reports what it
 * changed back up so the copy held here is patched in place. The alternative —
 * four cards each refetching after their own save — means four round trips and
 * four chances for two sections to disagree about the same account. `rehydrate()`
 * is called alongside a save so the shell (avatar, name, email in the account
 * menu) follows within the same interaction.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeCheck,
  Clock3,
  FileText,
  LogOut,
  ShieldCheck,
} from 'lucide-react';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  RoleBadge,
  Skeleton,
  SkeletonText,
  StatusBadge,
} from '../../components/ui';
import { profile as profileApi } from '../../lib/api';
import { ROLES } from '../../lib/permissions';
import { useAuth } from '../../context/AuthContext';
import { PATHS } from '../../routes';

import PageHeader from './components/PageHeader';
import AvatarUploader from './components/AvatarUploader';
import DoctorProfileForm from './components/DoctorProfileForm';
import EmailChangeCard from './components/EmailChangeCard';
import PasswordChangeCard from './components/PasswordChangeCard';
import ProfileDetailsForm from './components/ProfileDetailsForm';
import { useResource } from './hooks/usePatientData';
import { formatDate } from './lib/format';

function DetailRow({ label, children }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-subtle py-2.5 last:border-b-0">
      <dt className="font-body text-body-sm text-muted">{label}</dt>
      <dd className="min-w-0 font-body text-body-sm text-default">{children}</dd>
    </div>
  );
}

/** The shape of the page while the first GET is in flight. */
function ProfileSkeleton() {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-1">
        <div className="flex flex-col items-center gap-3">
          <Skeleton className="h-24 w-24 rounded-pill" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-3 w-40" />
        </div>
        <SkeletonText lines={3} className="mt-6" />
      </Card>
      <div className="flex flex-col gap-4 lg:col-span-2">
        <Card><SkeletonText lines={6} /></Card>
        <Card><SkeletonText lines={3} /></Card>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const { user, logout, pendingConsents, rehydrate, degraded } = useAuth();

  const {
    data: profile,
    loading,
    error,
    refetch,
    setData,
  } = useResource((signal) => profileApi.get({ signal }), { initialData: null });

  /** True once a save has landed, so the shell is only rehydrated when it matters. */
  const [syncing, setSyncing] = useState(false);

  /**
   * Merge what a card just changed into the copy held here. The PATCH and the
   * avatar routes both answer with the authoritative fields, so this is a merge
   * of server truth rather than an optimistic guess.
   */
  const applyChange = useCallback(async (patch) => {
    if (!patch || typeof patch !== 'object') return;
    setData((previous) => ({ ...(previous || {}), ...patch }));
    setSyncing(true);
    try {
      // The chrome shows the name, the avatar and the email; without this they
      // stay stale until the next full page load.
      await rehydrate();
    } catch {
      /* the page already shows the new values; a failed /auth/me is not an error here */
    } finally {
      setSyncing(false);
    }
  }, [rehydrate, setData]);

  const consents = useMemo(
    () => (Array.isArray(pendingConsents) ? pendingConsents : []),
    [pendingConsents],
  );

  // The payload decides, not the role string: only a doctor gets a `doctor` block.
  const doctor = profile?.doctor && typeof profile.doctor === 'object' ? profile.doctor : null;
  const isDoctor = Boolean(doctor) || profile?.role === ROLES.DOCTOR;

  if (!user) {
    return (
      <>
        <PageHeader title="Profile" />
        <Alert tone="warning" title="Not signed in">
          We could not work out which account this is. Please sign in again.
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Profile"
        description="Your details, your sign-in, and how your photographs are handled."
        actions={(
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<LogOut className="h-4 w-4" />}
            onClick={() => logout()}
          >
            Sign out
          </Button>
        )}
      />

      {degraded && (
        <Alert tone="warning" className="mb-4" title="Showing a cached copy">
          We could not reach the server, so these details may be out of date.{' '}
          <Button variant="link" size="sm" onClick={() => rehydrate()}>Try again</Button>
        </Alert>
      )}

      {consents.length > 0 && (
        <Alert tone="info" className="mb-4" title="There is something to agree to">
          {consents.length === 1
            ? 'One document has been updated since you last accepted it.'
            : `${consents.length} documents have been updated since you last accepted them.`}{' '}
          You will be asked the next time it matters.
        </Alert>
      )}

      {loading && <ProfileSkeleton />}

      {!loading && error && (
        <Alert
          tone="danger"
          title="We could not load your account"
          actions={<Button size="sm" variant="outline" onClick={refetch}>Try again</Button>}
        >
          {error}
        </Alert>
      )}

      {!loading && !error && profile && (
        <div className="grid gap-4 lg:grid-cols-3">
          {/* ----------------------------------------------------- identity -- */}
          <div className="flex flex-col gap-4 lg:col-span-1">
            <Card padding="none">
              <CardBody>
                <AvatarUploader profile={profile} onChange={applyChange} />

                <div className="mt-4 flex flex-col items-center gap-2 text-center">
                  <h2 className="font-heading text-heading-sm text-default">{profile.name}</h2>
                  <p className="min-w-0 break-all font-body text-body-sm text-muted">
                    {profile.email}
                  </p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    <RoleBadge role={profile.role} />
                    {profile.is_verified && (
                      <Badge tone="success" icon={<BadgeCheck className="h-3 w-3" aria-hidden="true" />}>
                        Email verified
                      </Badge>
                    )}
                  </div>
                </div>

                <dl className="mt-5">
                  <DetailRow label="Account">#{profile.id}</DetailRow>
                  {(profile.created_at || user.joined_at) && (
                    <DetailRow label="Member since">
                      {formatDate(profile.created_at || user.joined_at)}
                    </DetailRow>
                  )}
                  {user.is_active === false && (
                    <DetailRow label="Status"><StatusBadge status="inactive" size="sm" /></DetailRow>
                  )}
                </dl>

                {/* Kept mounted so the change is announced, and collapsed by
                    `empty:hidden` so an idle live region costs no layout. */}
                <p
                  className="mt-4 font-body text-caption text-muted empty:hidden"
                  aria-live="polite"
                >
                  {syncing ? 'Updating the rest of the app…' : ''}
                </p>
              </CardBody>
            </Card>

            {/* ---------------------------------------------------- privacy -- */}
            <Card padding="none">
              <CardHeader
                title="Your photographs"
                description="How scan images are stored, who can see them, and how to remove one."
                divider
              />
              <CardBody>
                <ul className="flex flex-col gap-3">
                  <li className="flex items-start gap-2.5">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-success-600" aria-hidden="true" />
                    <p className="font-body text-body-sm text-muted">
                      <span className="text-default">Sensitive scans are blurred by the server.</span>{' '}
                      Marking a scan sensitive means everyone but you is served a separately rendered
                      blurred image, not a CSS filter over the real one. Viewing the full image is
                      recorded against the viewer&apos;s name.
                    </p>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <FileText className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                    <p className="font-body text-body-sm text-muted">
                      <span className="text-default">Deleting a photo keeps your record.</span>{' '}
                      The image files are destroyed; the diagnosis, confidence, severity, triage
                      reasons, your doctor&apos;s comments, appointments and ratings all stay. Both
                      controls are on each scan.
                    </p>
                  </li>
                  <li className="flex items-start gap-2.5">
                    <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                    <p className="font-body text-body-sm text-muted">
                      <span className="text-default">Sharing is per request.</span>{' '}
                      Doctors you invite see your photograph only when you ticked consent on that
                      request; otherwise they get the findings without the picture.
                    </p>
                  </li>
                </ul>

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button as={Link} to={PATHS.PATIENT_SCANS} size="sm" variant="outline">
                    Manage my scans
                  </Button>
                  <Button as={Link} to={PATHS.PRIVACY} size="sm" variant="ghost">
                    Privacy policy
                  </Button>
                  <Button as={Link} to={PATHS.TERMS} size="sm" variant="ghost">
                    Terms of use
                  </Button>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* ------------------------------------------------------ editing -- */}
          <div className="flex flex-col gap-4 lg:col-span-2">
            <ProfileDetailsForm profile={profile} onSaved={applyChange} />
            <EmailChangeCard profile={profile} onChanged={applyChange} />
            <PasswordChangeCard onRehydrate={rehydrate} />

            {isDoctor && (
              <>
                {doctor?.verification_status && doctor.verification_status !== 'approved' && (
                  <Alert
                    tone={doctor.verification_status === 'rejected' ? 'danger' : 'warning'}
                    title={
                      doctor.verification_status === 'rejected'
                        ? 'Your licence was not accepted'
                        : 'Your licence is being checked'
                    }
                  >
                    {doctor.verification_note
                      || 'You will appear in the public directory once an admin has approved it.'}
                  </Alert>
                )}
                <DoctorProfileForm
                  doctor={doctor}
                  name={profile.name}
                  // `null` means "a new photo went to the other route": refetch so
                  // the directory headshot on screen is the one now stored.
                  onSaved={(next) => (next ? applyChange(next) : refetch())}
                />
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

export { ProfilePage };
