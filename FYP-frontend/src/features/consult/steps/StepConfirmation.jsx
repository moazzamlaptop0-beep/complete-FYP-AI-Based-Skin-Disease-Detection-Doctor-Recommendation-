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
 *
 * THE MEDALLION GRADIENT IS MEASURED, NOT PICKED
 * ----------------------------------------------
 * `success-700 -> accent-700` in light and `success-300 -> accent-300` in dark
 * resolve to the SAME two physical colours, rgb(4 120 87) and rgb(15 110 86),
 * because both scales are re-ramped in dark mode (tokens.css). White is 5.5:1 and
 * 6.2:1 on them, in either theme. The naive `success-500 -> accent-500` reads
 * 2.3:1 under white on light and worse on dark, which is why it is not used.
 */

import React, { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Hash,
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

/** The measured both-theme success fill. See the header note. */
const SUCCESS_FILL =
  'bg-gradient-to-br from-success-700 to-accent-700 dark:from-success-300 dark:to-accent-300';

/** Solid mid-scale fill, so the label needs its dark twin. */
const RANK_PILL = 'bg-primary-600 text-white dark:text-primary-50';

/** Tonal icon tiles, shared by the panels and the timeline. Token scales only,
 *  so both themes work with no `dark:` override. */
const TONE_TILES = {
  info: 'bg-info-100 text-info-700',
  accent: 'bg-accent-100 text-accent-700',
  warning: 'bg-warning-100 text-warning-700',
};

/** One figure in the receipt strip. */
function Figure({ icon, label, value }) {
  return (
    <div className="min-w-0 flex-1 px-3 py-2.5 first:pl-0 last:pr-0">
      <p className="flex items-center gap-1 text-overline uppercase text-subtle">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 truncate font-numeric text-label-md tabular-nums text-default">
        {value}
      </p>
    </div>
  );
}

/** A titled panel with a tonal icon chip. Used three times below. */
function Panel({ icon, tone, title, children, className }) {
  return (
    <section
      className={cn('rounded-card border border-subtle bg-surface p-4 shadow-soft sm:p-5', className)}
    >
      <h4 className="flex items-center gap-2.5 text-label-lg text-default">
        <span
          aria-hidden="true"
          className={cn(
            'grid h-8 w-8 shrink-0 place-items-center rounded-field',
            TONE_TILES[tone] ?? TONE_TILES.info,
          )}
        >
          {icon}
        </span>
        {title}
      </h4>
      {children}
    </section>
  );
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

  const timeline = [
    {
      tone: 'info',
      icon: <Mail className="h-4 w-4" />,
      title: 'They are notified now',
      body: express
        ? 'Each invited doctor gets a priority email and sees your request at the top of their inbox.'
        : 'Each invited doctor gets an email and your request appears in their inbox.',
    },
    {
      tone: 'accent',
      icon: <Inbox className="h-4 w-4" />,
      title: 'One of them accepts a time',
      body: 'They pick whichever of your times works. That creates the appointment and closes the request for everyone else.',
    },
    {
      tone: 'warning',
      icon: <Clock className="h-4 w-4" />,
      title: deadline ? `If nobody replies ${deadline}` : 'If nobody replies',
      body: 'The request expires on its own and nothing is booked. You can send a new one to different doctors, and none of your answers are lost.',
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* ---------------------------------------------------------- headline -- */}
      <div
        className={cn(
          'overflow-hidden rounded-card border border-success-200 shadow-card',
          'bg-gradient-to-b from-success-50 to-surface',
        )}
      >
        <div className="px-4 pb-5 pt-6 text-center sm:px-6 sm:pt-8">
          <div className="relative mx-auto h-16 w-16">
            <span
              aria-hidden="true"
              className={cn(
                'absolute -inset-3 rounded-pill opacity-30 blur-xl',
                SUCCESS_FILL,
              )}
            />
            <span
              aria-hidden="true"
              className={cn(
                'relative flex h-16 w-16 items-center justify-center rounded-pill text-white',
                'shadow-elevated ring-4 ring-surface',
                SUCCESS_FILL,
              )}
            >
              <CheckCircle2 className="h-8 w-8" />
            </span>
          </div>

          <h3 className="mt-4 font-heading text-display-sm text-default">
            Your request is on its way
          </h3>
          <p className="mx-auto mt-1.5 max-w-md text-body-md text-muted">
            {invited.length === 1
              ? 'One dermatologist has been invited to take it.'
              : `${invited.length} dermatologists have been invited at the same time.`}
          </p>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            {severity && <SeverityBadge severity={severity} />}
            {express && (
              <Badge tone="warning" size="sm">
                <Zap aria-hidden="true" className="mr-1 inline h-3 w-3" />
                Express
              </Badge>
            )}
          </div>
        </div>

        {/* The receipt strip: the four facts somebody screenshots. Read from the
            server echo, like everything else on this screen. */}
        <div className="flex items-stretch divide-x divide-default border-t border-default bg-surface px-4 sm:px-6">
          <Figure
            icon={<Hash aria-hidden="true" className="h-3 w-3" />}
            label="Request"
            value={requestId === null ? 'Pending' : `#${requestId}`}
          />
          <Figure
            icon={<Users aria-hidden="true" className="h-3 w-3" />}
            label="Invited"
            value={String(invited.length)}
          />
          <Figure
            icon={<CalendarClock aria-hidden="true" className="h-3 w-3" />}
            label="Times"
            value={String(slots.length)}
          />
          <Figure
            icon={<Clock aria-hidden="true" className="h-3 w-3" />}
            label={express ? 'Express closes' : 'Closes'}
            value={deadline ? deadline.replace('in about ', '') : 'Not set'}
          />
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
          {deadline ? `; it closes ${deadline}.` : '.'} If it changes, starts bleeding, or you
          begin to feel unwell before anyone answers, do not wait for this: see someone in person.
        </Alert>
      )}

      {/* ------------------------------------------------------------ invited -- */}
      <Panel
        icon={<Users className="h-4 w-4" />}
        tone="info"
        title="Who was invited"
      >
        {invited.length === 0 ? (
          <p className="mt-3 text-body-sm text-muted">
            The doctor list is not in the response. Open the request to see it.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {invited.map((invite) => (
              <li
                key={invite.doctor_id}
                className="flex items-center gap-3 rounded-field border border-default bg-surface-sunken p-2.5"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-pill',
                    'font-numeric text-caption tabular-nums',
                    RANK_PILL,
                  )}
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
      </Panel>

      {/* -------------------------------------------------------------- times -- */}
      {slots.length > 0 && (
        <Panel
          icon={<CalendarClock className="h-4 w-4" />}
          tone="accent"
          title="The times you offered"
        >
          <ol className="mt-3 space-y-2">
            {slots.map((slot, index) => (
              <li
                key={slot.slot_id ?? `${slot.slot_date}|${slot.slot_time}|${slot.doctor_id ?? 'any'}`}
                className={cn(
                  'flex items-center gap-3 rounded-field border p-2.5',
                  index === 0
                    ? 'border-primary-300 bg-primary-50'
                    : 'border-default bg-surface-sunken',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-pill',
                    'font-numeric text-caption tabular-nums',
                    index === 0 ? RANK_PILL : 'bg-neutral-200 text-neutral-700',
                  )}
                >
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label-md text-default">
                    {friendlyDate(slot.slot_date)} at {formatTime(slot.slot_time)}
                    {index === 0 && (
                      <span className="ml-2 text-caption font-normal text-primary-700">
                        first choice
                      </span>
                    )}
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
        </Panel>
      )}

      {/* ------------------------------------------------------- what happens --
          A real timeline: tonal tile, connector, then the copy. The connector is
          the only vertical rule on the screen, so the three entries read as a
          sequence rather than as three unrelated notes. */}
      <section className="rounded-card border border-default bg-surface-sunken p-4 sm:p-5">
        <h4 className="text-label-lg text-default">What happens next</h4>
        <ol className="mt-4">
          {timeline.map((entry, index) => {
            const last = index === timeline.length - 1;
            return (
              <li key={entry.title} className="flex gap-3.5">
                <div className="flex flex-col items-center">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid h-9 w-9 shrink-0 place-items-center rounded-field ring-2 ring-surface',
                      TONE_TILES[entry.tone],
                    )}
                  >
                    {entry.icon}
                  </span>
                  {!last && (
                    <span aria-hidden="true" className="my-1 w-px flex-1 bg-neutral-300" />
                  )}
                </div>
                <div className={cn('min-w-0 flex-1', !last && 'pb-5')}>
                  <p className="text-label-md text-default">{entry.title}</p>
                  <p className="mt-0.5 text-body-sm text-muted">{entry.body}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ---------------------------------------------------------- onwards -- */}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button
          as={Link}
          to={PATHS.PATIENT_REQUESTS}
          variant="gradient"
          size="lg"
          fullWidth
          leftIcon={<Inbox aria-hidden="true" className="h-4 w-4" />}
        >
          Track this request
        </Button>
        <Button
          as={Link}
          to={PATHS.PATIENT_SCANS}
          variant="soft"
          size="lg"
          fullWidth
          leftIcon={<ScanLine aria-hidden="true" className="h-4 w-4" />}
        >
          My scans
        </Button>
      </div>

      <div className="flex flex-col items-center gap-2 border-t border-subtle pt-4">
        <Button variant="ghost" size="sm" onClick={resetAll}>
          Check another spot
        </Button>
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
    </div>
  );
}
