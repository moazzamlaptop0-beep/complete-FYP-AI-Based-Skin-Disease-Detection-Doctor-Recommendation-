/**
 * PatientProfilePage — your details, your consents, your privacy choices.
 *
 * THE AVATAR DECISION, WRITTEN DOWN
 * ---------------------------------
 * The current profile screen stores a base64 blob in `localStorage` under a
 * per-user key and calls it a profile picture. It never reaches the server, so
 * it does not exist on another device, does not survive clearing site data, and
 * is invisible to the doctor treating you. That is not a feature with a storage
 * bug; it is a UI for a capability the backend does not have.
 *
 * So:
 *   - A DOCTOR gets a real photo upload, because `POST /api/doctor/profile`
 *     genuinely accepts `profile_image` as multipart and serves it back at
 *     `/api/doctors/<id>/photo`.
 *   - A PATIENT gets initials. There is no patient-avatar endpoint on this
 *     backend, and re-implementing the localStorage illusion would just move the
 *     lie into new code. The gap is reported rather than papered over.
 *
 * WHAT IS EDITABLE AND WHAT IS NOT
 * --------------------------------
 * There is no patient-facing "update my account" route either — the only
 * profile-writing endpoint in the API is the doctor one. Rather than render
 * inputs that silently discard what is typed into them, patient details are
 * shown as a read-only record with an honest explanation.
 */

import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeCheck,
  Clock3,
  FileText,
  LogOut,
  Mail,
  ShieldCheck,
  UserCircle2,
} from 'lucide-react';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  RoleBadge,
  SkeletonText,
  StatusBadge,
} from '../../components/ui';
import { get } from '../../lib/api';
import { doctors as doctorEndpoints } from '../../lib/endpoints';
import { PERMISSIONS } from '../../lib/permissions';
import { useAuth } from '../../context/AuthContext';
import { PATHS } from '../../routes';

import PageHeader from './components/PageHeader';
import DoctorProfileForm from './components/DoctorProfileForm';
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

export default function PatientProfilePage() {
  const { user, can, logout, pendingConsents, rehydrate, degraded } = useAuth();
  const isDoctor = can(PERMISSIONS.DOCTOR_PROFILE_MANAGE);

  const { data: profile, loading, error, refetch } = useResource(
    (signal) => get(doctorEndpoints.profile(), { signal }),
    { enabled: isDoctor, initialData: null },
  );

  const consents = useMemo(
    () => (Array.isArray(pendingConsents) ? pendingConsents : []),
    [pendingConsents],
  );

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
        description="Your details, what you have agreed to, and how your photographs are handled."
        actions={
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<LogOut className="h-4 w-4" />}
            onClick={() => logout()}
          >
            Sign out
          </Button>
        }
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

      <div className="grid gap-4 lg:grid-cols-3">
        {/* ------------------------------------------------------- identity -- */}
        <Card padding="none" className="lg:col-span-1">
          <CardBody>
            <div className="flex flex-col items-center gap-3 text-center">
              <Avatar name={user.name} size="2xl" />
              <div>
                <h2 className="font-heading text-heading-sm text-default">{user.name}</h2>
                <p className="font-body text-body-sm text-muted">{user.email}</p>
              </div>
              <div className="flex flex-wrap justify-center gap-1.5">
                <RoleBadge role={user.role} />
                {user.is_verified && (
                  <Badge tone="success" icon={<BadgeCheck className="h-3 w-3" aria-hidden="true" />}>
                    Email verified
                  </Badge>
                )}
              </div>
            </div>

            <dl className="mt-5">
              <DetailRow label="Account">#{user.id}</DetailRow>
              {user.joined_at && <DetailRow label="Member since">{formatDate(user.joined_at)}</DetailRow>}
              {user.is_active === false && (
                <DetailRow label="Status"><StatusBadge status="inactive" size="sm" /></DetailRow>
              )}
            </dl>

            {!isDoctor && (
              <p className="mt-4 flex items-start gap-2 font-body text-caption leading-relaxed text-muted">
                <UserCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                Patient accounts show initials rather than a photo. There is no endpoint on this
                platform that stores a patient profile picture, so nothing here is kept only on this
                device pretending otherwise.
              </p>
            )}
          </CardBody>
        </Card>

        {/* -------------------------------------------------------- privacy -- */}
        <div className="flex flex-col gap-4 lg:col-span-2">
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
                    blurred image — not a CSS filter over the real one. Viewing the full image is
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

          {/* ------------------------------------------------ account detail -- */}
          {!isDoctor && (
            <Card padding="none">
              <CardHeader title="Account details" divider />
              <CardBody>
                <dl>
                  <DetailRow label="Name">{user.name}</DetailRow>
                  <DetailRow label="Email">
                    <span className="flex items-center gap-1.5">
                      <Mail className="h-3.5 w-3.5 text-muted" aria-hidden="true" />
                      {user.email}
                    </span>
                  </DetailRow>
                  <DetailRow label="Role">{user.role}</DetailRow>
                </dl>
                <p className="mt-3 font-body text-caption leading-relaxed text-muted">
                  These come from your account and cannot be edited here — this backend exposes no
                  patient profile update route, only a doctor one. Ask support to change your name or
                  email.
                </p>
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------ doctor form -- */}
      {isDoctor && (
        <div className="mt-4">
          {loading && (
            <Card><SkeletonText lines={6} /></Card>
          )}

          {!loading && error && (
            <Alert
              tone="danger"
              title="We could not load your clinic profile"
              actions={<Button size="sm" variant="outline" onClick={refetch}>Try again</Button>}
            >
              {error}
            </Alert>
          )}

          {!loading && !error && (
            <>
              {profile?.verification_status && profile.verification_status !== 'approved' && (
                <Alert
                  tone={profile.verification_status === 'rejected' ? 'danger' : 'warning'}
                  className="mb-4"
                  title={
                    profile.verification_status === 'rejected'
                      ? 'Your licence was not accepted'
                      : 'Your licence is being checked'
                  }
                >
                  {profile.verification_note
                    || 'You will appear in the public directory once an admin has approved it.'}
                </Alert>
              )}
              <DoctorProfileForm profile={profile} onSaved={() => { refetch(); rehydrate(); }} />
            </>
          )}
        </div>
      )}
    </>
  );
}
