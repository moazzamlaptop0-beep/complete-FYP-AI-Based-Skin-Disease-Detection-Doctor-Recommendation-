/**
 * DoctorPendingApprovalPage — "your licence is with an admin".
 *
 * WHAT IT IS FOR
 * --------------
 * A doctor who has registered but whose `verification_status` is still
 * 'pending' holds the whole Doctor permission set — the backend gate is a
 * SEPARATE decorator (`require_doctor_approved`) on a handful of write routes.
 * So they can sign in, they can look around, and then a button 403s with a
 * message they cannot act on. This page is the honest version of that state:
 * what already works, what does not, and what happens next.
 *
 * It also covers 'rejected', because a refusal that renders as "pending
 * forever" is worse than a refusal — `verification_note` carries the admin's
 * reason and is shown verbatim.
 *
 * `verification_status` is read from `useAuth().doctor`, which AuthContext
 * refreshes from GET /auth/me on every mount. That is the whole reason the
 * rehydrate exists: an approved doctor sees the change without logging out.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import {
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  Clock,
  FileText,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';

import { Alert, Badge, Button, Card, CardBody, CardHeader } from '../../components/ui';
import { useAuth } from '../../context/AuthContext';
import { PATHS } from '../../routes';
import PageHeader from './components/PageHeader';

/** What each state means, in the doctor's own terms. */
const STATES = {
  pending: {
    tone: 'warning',
    icon: Clock,
    badge: 'Awaiting review',
    title: 'Your licence is being checked',
    body:
      'An administrator is verifying the licence number you registered with. This is a manual check, '
      + 'so it usually takes a working day. You do not need to do anything; we will email you as soon '
      + 'as it is decided.',
  },
  rejected: {
    tone: 'danger',
    icon: XCircle,
    badge: 'Not approved',
    title: 'Your licence could not be verified',
    body:
      'An administrator reviewed your registration and could not approve it. The reason is below. '
      + 'Correcting the licence number on your profile puts you straight back in the queue.',
  },
  approved: {
    tone: 'success',
    icon: CheckCircle2,
    badge: 'Approved',
    title: 'You are verified',
    body: 'Your licence has been approved. Every part of the doctor workspace is open to you.',
  },
};

/** Concrete consequences, not a vague "limited access" line. */
const LIMITS = [
  {
    allowed: true,
    icon: FileText,
    label: 'Read the cases sent to you',
    detail: 'Referrals, questionnaire answers and scan images are all visible.',
  },
  {
    allowed: true,
    icon: BadgeCheck,
    label: 'Complete your clinic profile',
    detail: 'Specialty, hospital, city, availability and consultation fees can be saved now.',
  },
  {
    allowed: false,
    icon: CalendarClock,
    label: 'Accept an appointment request',
    detail: 'Accepting a patient’s preferred slot needs an approved licence.',
  },
  {
    allowed: false,
    icon: ShieldAlert,
    label: 'Be bookable from “Find a doctor”',
    detail: 'Patients cannot send you a request until an administrator approves the licence.',
  },
];

export default function DoctorPendingApprovalPage() {
  const { doctor, user, rehydrate, isLoading } = useAuth();

  const status = String(doctor?.verification_status || 'pending').toLowerCase();
  const state = STATES[status] || STATES.pending;
  const StateIcon = state.icon;
  const note = doctor?.verification_note || doctor?.verificationNote || '';

  const iconTone = state.tone === 'success'
    ? 'bg-success-100 text-success-700'
    : state.tone === 'danger'
      ? 'bg-danger-100 text-danger-700'
      : 'bg-warning-100 text-warning-700';

  return (
    <>
      <PageHeader
        title="Licence verification"
        description="Where your registration has got to, and what it changes."
        meta={<Badge tone={state.tone} variant="soft">{state.badge}</Badge>}
        actions={
          <Button
            variant="outline"
            leftIcon={<RefreshCw aria-hidden="true" />}
            loading={isLoading}
            onClick={() => rehydrate()}
          >
            Check again
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader
            title={(
              <span className="flex items-center gap-2.5">
                <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-field ${iconTone}`}>
                  <StateIcon className="h-4 w-4" aria-hidden="true" />
                </span>
                {state.title}
              </span>
            )}
            divider
          />
          <CardBody className="space-y-4">
            <p className="text-body-md text-muted">{state.body}</p>

            {note && (
              <Alert tone={status === 'rejected' ? 'danger' : 'info'} title="Note from the reviewer">
                {note}
              </Alert>
            )}

            {status === 'approved' && (
              <Alert tone="success" title="Nothing is blocked">
                Head to your{' '}
                <Link className="font-semibold underline" to={PATHS.DOCTOR_REFERRALS}>referrals</Link>
                {' '}or set your{' '}
                <Link className="font-semibold underline" to={PATHS.DOCTOR_SCHEDULE}>
                  availability and fees
                </Link>.
              </Alert>
            )}

            <dl className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-field border border-subtle bg-surface-sunken px-3 py-2">
                <dt className="text-overline text-muted">Registered name</dt>
                <dd className="mt-0.5 text-body-sm text-default">{doctor?.name || user?.name || '—'}</dd>
              </div>
              <div className="rounded-field border border-subtle bg-surface-sunken px-3 py-2">
                <dt className="text-overline text-muted">Licence number</dt>
                <dd className="mt-0.5 break-all font-numeric text-body-sm text-default">
                  {doctor?.license || '—'}
                </dd>
              </div>
              <div className="rounded-field border border-subtle bg-surface-sunken px-3 py-2">
                <dt className="text-overline text-muted">Specialty</dt>
                <dd className="mt-0.5 text-body-sm text-default">{doctor?.specialty || '—'}</dd>
              </div>
              <div className="rounded-field border border-subtle bg-surface-sunken px-3 py-2">
                <dt className="text-overline text-muted">Contact email</dt>
                <dd className="mt-0.5 break-all text-body-sm text-default">
                  {doctor?.email || user?.email || '—'}
                </dd>
              </div>
            </dl>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="What works right now"
            description={
              status === 'approved'
                ? 'Everything below is open.'
                : 'Until an administrator approves your licence.'
            }
            divider
          />
          <CardBody>
            <ul className="space-y-3">
              {LIMITS.map((item) => {
                const Icon = item.icon;
                const open = status === 'approved' || item.allowed;
                return (
                  <li key={item.label} className="flex gap-3">
                    <span
                      className={
                        open
                          ? 'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-field bg-success-100 text-success-700'
                          : 'mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-field bg-neutral-100 text-muted dark:bg-surface-sunken'
                      }
                    >
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-label-lg text-default">{item.label}</span>
                        <Badge tone={open ? 'success' : 'neutral'} size="sm">
                          {open ? 'Available' : 'Locked'}
                        </Badge>
                      </span>
                      <span className="mt-0.5 block text-caption text-muted">{item.detail}</span>
                    </span>
                  </li>
                );
              })}
            </ul>

            <p className="mt-5 border-t border-subtle pt-4 text-caption text-muted">
              You are also a patient here. Your own scans and appointments are never affected by
              licence verification. Open them from the workspace chip at the top of this page.
            </p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
