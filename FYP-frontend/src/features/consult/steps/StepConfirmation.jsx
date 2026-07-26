/**
 * StepConfirmation — the request is out. What now?
 *
 * IT READS THE SERVER'S ANSWER, NOT THE FORM
 * ------------------------------------------
 * Everything on this screen comes from `submit.result`, the serialised request
 * the backend returned, and NOT from the state the user filled in. That is not
 * pedantry: `TriageService.is_express` forces the express lane on for any
 * CRITICAL or URGENT severity whether or not the patient asked for it, the
 * server assigns `expires_at` from the resulting TTL, and it may have dropped a
 * duplicate slot. Echoing the form back would tell the patient a deadline that
 * is not the one their doctors are working to.
 *
 * WHY THE DRAFT IS CLEARED HERE
 * -----------------------------
 * The sessionStorage draft exists so a refresh mid-scan does not lose a photo of
 * someone's skin plus six health answers. Once the request is sent, the server
 * holds all of it and the local copy is pure liability — anyone reopening the
 * tab would resume a wizard for a consultation that already exists, and the
 * photo would sit in storage for the rest of the session. So the draft dies at
 * exactly the moment it stops being useful, in an effect with an empty
 * dependency list so it runs once even if this component re-renders.
 */

import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Inbox,
  Mail,
  ScanLine,
  Users,
  Zap,
} from 'lucide-react';

import {
  Alert,
  Badge,
  Button,
  SeverityBadge,
  cn,
} from '../../../components/ui';
import { formatTime } from '../../../lib/format';
import { PATHS } from '../../../routes';

import { useConsult } from '../ConsultContext';
import { clearDraft } from '../consultPersistence';
import { friendlyDate } from '../lib/slotDates';

/** "in about 4 hours" / "in 2 days" — a deadline a person can act on. */
function untilText(iso) {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const hours = Math.round((target.getTime() - Date.now()) / 3_600_000);
  if (hours <= 0) return 'very soon';
  if (hours < 24) return `in about ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  return `in about ${days} day${days === 1 ? '' : 's'}`;
}

export default function StepConfirmation() {
  const { state, resetAll } = useConsult();
  const result = state.submit.result || {};

  /**
   * Empty deps ON PURPOSE. This must fire once, on arrival, and never again —
   * `clearDraft()` is idempotent but re-running it on every render would fight
   * ConsultContext's debounced autosave, which is still watching `state`.
   */
  useEffect(() => {
    clearDraft();
  }, []);

  const requestId = state.submit.requestId ?? result.request_id ?? null;
  const invited = Array.isArray(result.doctors) ? result.doctors : [];
  // Sorted on a COPY every render rather than memoised: `rank` is the contract's
  // ordering (the server returns rows in insertion order), the list is capped at
  // five, and a useMemo over a nested response field is exactly the manual
  // memoisation the React Compiler refuses to preserve.
  const slots = (Array.isArray(result.slots) ? [...result.slots] : [])
    .sort((a, b) => (Number(a.rank) || 0) - (Number(b.rank) || 0));

  const express = Boolean(result.express);
  const severity = result.severity_level || result.priority || null;
  const deadline = untilText(result.expires_at);

  /** Names by id, for the slot rows. */
  const nameById = {};
  invited.forEach((invite) => {
    if (invite?.doctor_id !== undefined) {
      nameById[Number(invite.doctor_id)] = invite.doctor_name || `Doctor #${invite.doctor_id}`;
    }
  });

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------- headline -- */}
      <div className="text-center">
        <span
          aria-hidden="true"
          className="mx-auto flex h-14 w-14 items-center justify-center rounded-pill bg-success-100 text-success-700 dark:bg-success-950 dark:text-success-400"
        >
          <CheckCircle2 className="h-7 w-7" />
        </span>
        <h3 className="mt-3 font-heading text-display-sm text-default">
          Your request is on its way
        </h3>
        <p className="mt-1 text-body-md text-muted">
          {invited.length === 1
            ? 'One dermatologist has been invited to take it.'
            : `${invited.length} dermatologists have been invited at the same time.`}
        </p>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          {requestId !== null && (
            <Badge tone="neutral" size="sm">
              Request #{requestId}
            </Badge>
          )}
          {severity && <SeverityBadge severity={severity} />}
          {express && (
            <Badge tone="warning" size="sm">
              <Zap aria-hidden="true" className="mr-1 inline h-3 w-3" />
              Express
            </Badge>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------------ express -- */}
      {express && (
        <Alert
          tone="warning"
          title="This one is on the fast lane"
          icon={<Zap aria-hidden="true" className="h-5 w-5" />}
        >
          The invitations went out flagged priority and the doctors have a short window to reply
          {deadline ? ` — it closes ${deadline}.` : '.'} If it changes, starts bleeding, or you
          begin to feel unwell before anyone answers, do not wait for this: see someone in person.
        </Alert>
      )}

      {/* ------------------------------------------------------------ invited -- */}
      <section className="rounded-card border border-subtle bg-surface p-4">
        <h4 className="flex items-center gap-2 text-label-lg text-default">
          <Users aria-hidden="true" className="h-4 w-4 text-primary-700 dark:text-primary-400" />
          Who was invited
        </h4>
        {invited.length === 0 ? (
          <p className="mt-2 text-body-sm text-muted">
            The doctor list is not in the response. Open the request to see it.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {invited.map((invite) => (
              <li
                key={invite.doctor_id}
                className="flex items-center gap-3 rounded-field border border-subtle bg-surface-sunken p-2.5"
              >
                <span
                  aria-hidden="true"
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-pill bg-primary-600 text-caption text-white"
                >
                  {(Number(invite.preference_rank) || 0) + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label-md text-default">
                    {invite.doctor_name || `Doctor #${invite.doctor_id}`}
                  </p>
                  {invite.specialty && (
                    <p className="truncate text-caption text-subtle">{invite.specialty}</p>
                  )}
                </div>
                <Badge tone="neutral" size="sm">
                  {invite.response && invite.response !== 'Pending' ? invite.response : 'Waiting'}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-caption text-subtle">
          Whoever accepts first takes the appointment. The rest are told it is closed, so you cannot
          end up with {invited.length > 1 ? `${invited.length} bookings` : 'a duplicate booking'}.
        </p>
      </section>

      {/* -------------------------------------------------------------- times -- */}
      {slots.length > 0 && (
        <section className="rounded-card border border-subtle bg-surface p-4">
          <h4 className="flex items-center gap-2 text-label-lg text-default">
            <CalendarClock aria-hidden="true" className="h-4 w-4 text-primary-700 dark:text-primary-400" />
            The times you offered
          </h4>
          <ol className="mt-3 space-y-2">
            {slots.map((slot, index) => (
              <li
                key={slot.slot_id ?? `${slot.slot_date}|${slot.slot_time}|${slot.doctor_id ?? 'any'}`}
                className={cn(
                  'flex items-center gap-3 rounded-field border border-subtle bg-surface-sunken p-2.5',
                  index === 0 && 'border-primary-300 bg-primary-50 dark:bg-primary-950/40',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-pill text-caption',
                    index === 0 ? 'bg-primary-600 text-white' : 'bg-neutral-200 text-neutral-700',
                  )}
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label-md text-default">
                    {friendlyDate(slot.slot_date)} at {formatTime(slot.slot_time)}
                  </p>
                  <p className="truncate text-caption text-subtle">
                    with{' '}
                    {slot.doctor_id === null || slot.doctor_id === undefined
                      ? 'any of the doctors above'
                      : nameById[Number(slot.doctor_id)] || `Doctor #${slot.doctor_id}`}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ------------------------------------------------------- what happens -- */}
      <section className="rounded-card border border-subtle bg-surface-sunken p-4">
        <h4 className="text-label-lg text-default">What happens next</h4>
        <ol className="mt-3 space-y-3">
          {[
            {
              icon: <Mail className="h-4 w-4" />,
              title: 'They are notified now',
              body: express
                ? 'Each invited doctor gets a priority email and sees your request at the top of their inbox.'
                : 'Each invited doctor gets an email and your request appears in their inbox.',
            },
            {
              icon: <Inbox className="h-4 w-4" />,
              title: 'One of them accepts a time',
              body: 'They pick whichever of your times works. That creates the appointment and closes the request for everyone else.',
            },
            {
              icon: <Clock className="h-4 w-4" />,
              title: deadline ? `If nobody replies ${deadline}` : 'If nobody replies',
              body: 'The request expires on its own and nothing is booked. You can send a new one to different doctors, and none of your answers are lost.',
            },
          ].map((entry) => (
            <li key={entry.title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-surface text-primary-700 dark:text-primary-400"
              >
                {entry.icon}
              </span>
              <div className="min-w-0">
                <p className="text-label-md text-default">{entry.title}</p>
                <p className="mt-0.5 text-body-sm text-muted">{entry.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------------------------------------------------- onwards -- */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          as={Link}
          to={PATHS.PATIENT_REQUESTS}
          size="lg"
          fullWidth
          leftIcon={<Inbox aria-hidden="true" className="h-4 w-4" />}
        >
          Track this request
        </Button>
        <Button
          as={Link}
          to={PATHS.PATIENT_SCANS}
          variant="outline"
          size="lg"
          fullWidth
          leftIcon={<ScanLine aria-hidden="true" className="h-4 w-4" />}
        >
          My scans
        </Button>
      </div>

      <div className="text-center">
        <Button variant="ghost" size="sm" onClick={resetAll}>
          Check another spot
        </Button>
      </div>

      <p className="text-center text-caption text-subtle">
        You can cancel this request from{' '}
        <Link
          to={PATHS.PATIENT_REQUESTS}
          className="underline underline-offset-2 hover:text-default"
        >
          your requests
        </Link>{' '}
        any time before a doctor accepts.
      </p>
    </div>
  );
}
