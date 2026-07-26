/**
 * DoctorAppointmentsPage — GET /api/doctor-appointments/<doctor_id>.
 *
 * THE ORDER COMES FROM THE SERVER AND IS NOT RE-SORTED HERE
 * --------------------------------------------------------
 * The backend applies a two-stage sort: `appointment_date DESC` in SQL, then a
 * Python priority pass (`Pending-Conflict` 0 < `Scheduled`/`Confirmed` 1 <
 * `Completed`/`Reassigned` 2 < `Cancelled` 3), ties broken by descending
 * severity. That ordering is a user-visible contract (api-contract.md §31), so
 * this page FILTERS the array but never reorders it.
 *
 * THE PENDING-CONFLICT FLOW IS PRESERVED, NOT REINVENTED
 * -----------------------------------------------------
 * When an urgent patient books a slot somebody else already holds, the backend
 * does NOT evict anyone. It cross-links the two rows, sets both to
 * `Pending-Conflict`, and waits for the doctor. `PUT /api/resolve-conflict/<id>`
 * takes the WINNER's id in the URL — the loser becomes `Reassigned` and gets
 * three suggested alternative slots computed live.
 *
 * Two things follow, and both are load-bearing:
 *   1. An unresolved conflict has an SLA. `resolve_expired_conflicts()` runs
 *      every 15 minutes and, after CONFLICT_SLA_HOURS, decides by severity with
 *      `auto_resolved=True`. The banner says so, because a doctor who does not
 *      know that will assume the choice waits for them indefinitely.
 *   2. `PUT /api/update-appointment/<id>` REFUSES a `Pending-Conflict` row with
 *      a 400. So the ordinary status controls are hidden — not merely disabled —
 *      on a conflicted appointment, and the resolve action is offered instead.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  Clock,
  Mail,
  RefreshCw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  Field,
  Modal,
  SearchInput,
  Select,
  SeverityBadge,
  Skeleton,
  SkeletonGroup,
  StatusBadge,
  Textarea,
  notify,
} from '../../components/ui';
import { put } from '../../lib/api';
import { appointments as appointmentEndpoints } from '../../lib/endpoints';
import { formatDate, formatDateTime, formatDiseaseName } from '../../lib/format';
import { cn } from '../../lib/cn';
import PageHeader from './components/PageHeader';
import { scanSeverity, severityRank, useDoctorAppointments } from './hooks/useDoctorData';

const PENDING_CONFLICT = 'Pending-Conflict';

/** The only four values `/api/update-appointment` accepts (400 on anything else). */
const STATUS_ACTIONS = [
  { status: 'Confirmed', label: 'Confirm', variant: 'primary', icon: CheckCircle2 },
  { status: 'Completed', label: 'Mark completed', variant: 'outline', icon: CheckCircle2 },
  { status: 'Cancelled', label: 'Cancel', variant: 'ghost', icon: XCircle, needsReason: true },
];

const STATUS_FILTERS = [
  { value: 'upcoming', label: 'Active (scheduled & confirmed)' },
  { value: 'conflict', label: 'Needs a decision' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled & reassigned' },
  { value: 'all', label: 'Everything' },
];

function matchesFilter(appointment, filter) {
  const status = String(appointment.status || '');
  switch (filter) {
    case 'upcoming': return status === 'Scheduled' || status === 'Confirmed';
    case 'conflict': return status === PENDING_CONFLICT;
    case 'completed': return status === 'Completed';
    case 'cancelled': return status === 'Cancelled' || status === 'Reassigned';
    default: return true;
  }
}

/* -------------------------------------------------------------------------- */
/* Conflict banner                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Pair up the `Pending-Conflict` rows. The backend cross-links them with
 * `conflict_with_id`, so a pair is emitted ONCE — keyed on the lower id — rather
 * than twice from each side's point of view.
 * @returns {Array<{key:string, a:object, b:object|null}>}
 */
export function conflictPairs(appointments) {
  const byId = new Map((appointments || []).map((row) => [row.id, row]));
  const seen = new Set();
  const pairs = [];

  (appointments || []).forEach((row) => {
    if (String(row.status) !== PENDING_CONFLICT) return;
    if (seen.has(row.id)) return;
    const partner = row.conflict_with_id ? byId.get(row.conflict_with_id) || null : null;
    seen.add(row.id);
    if (partner) seen.add(partner.id);
    pairs.push({ key: `conflict-${Math.min(row.id, partner?.id ?? row.id)}`, a: row, b: partner });
  });

  return pairs;
}

function ConflictSide({ appointment, onChoose, busy, disabled }) {
  if (!appointment) {
    return (
      <div className="flex flex-1 items-center rounded-card border border-dashed border-subtle bg-surface-sunken p-3">
        <p className="text-caption text-muted">
          The other half of this conflict is not in your list — it may have been resolved already.
          Refresh to check.
        </p>
      </div>
    );
  }

  const severity = scanSeverity(appointment);

  return (
    <div className="flex flex-1 flex-col gap-2 rounded-card border border-subtle bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <SeverityBadge severity={severity} size="sm" />
        <span className="text-caption text-muted">#{appointment.id}</span>
      </div>
      <p className="truncate font-heading text-heading-sm text-default">
        {appointment.patient_name || 'Unknown patient'}
      </p>
      <p className="truncate text-caption text-muted">
        {formatDiseaseName(appointment.disease)}
      </p>
      {Array.isArray(appointment.triage_reasons) && appointment.triage_reasons.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {appointment.triage_reasons.slice(0, 3).map((reason) => (
            <li key={reason} className="rounded-pill bg-surface-sunken px-2 py-0.5 text-caption text-muted">
              {reason}
            </li>
          ))}
        </ul>
      )}
      <Button
        size="sm"
        variant="primary"
        className="mt-auto"
        loading={busy}
        loadingText="Confirming"
        disabled={disabled}
        onClick={() => onChoose(appointment)}
      >
        Give the slot to {appointment.patient_name?.split(' ')[0] || `#${appointment.id}`}
      </Button>
    </div>
  );
}

function ConflictBanner({ pairs, onResolve, resolvingId }) {
  if (!pairs.length) return null;

  return (
    <section aria-labelledby="conflicts-heading" className="mb-6">
      <Alert
        tone="warning"
        title={`${pairs.length} booking conflict${pairs.length === 1 ? '' : 's'} need${pairs.length === 1 ? 's' : ''} your decision`}
        icon={<ShieldAlert className="h-5 w-5" aria-hidden="true" />}
      >
        <p id="conflicts-heading">
          An urgent patient booked a slot that was already held. Both bookings are frozen until you
          choose — the patient you do not pick becomes <strong>Reassigned</strong> and is offered the
          next three free times automatically. If you do not decide, the system resolves it by
          severity after the SLA window.
        </p>
      </Alert>

      <ul className="mt-3 flex flex-col gap-3">
        {pairs.map((pair) => (
          <li key={pair.key}>
            <Card variant="outline" padding="none" className="border-l-4 border-l-warning-500">
              <CardBody className="flex flex-col gap-3">
                <p className="flex flex-wrap items-center gap-2 text-label-md text-default">
                  <Clock className="h-4 w-4 text-warning-700" aria-hidden="true" />
                  {formatDate(pair.a.slot_date)} at {pair.a.slot_time}
                  <Badge tone="warning" variant="soft" size="sm">Two patients, one slot</Badge>
                </p>
                <div className="flex flex-col gap-3 md:flex-row">
                  <ConflictSide
                    appointment={pair.a}
                    onChoose={onResolve}
                    busy={resolvingId === pair.a.id}
                    disabled={resolvingId !== null && resolvingId !== pair.a.id}
                  />
                  <div
                    aria-hidden="true"
                    className="flex items-center justify-center px-1 text-label-sm text-subtle"
                  >
                    vs
                  </div>
                  <ConflictSide
                    appointment={pair.b}
                    onChoose={onResolve}
                    busy={resolvingId === pair.b?.id}
                    disabled={resolvingId !== null && resolvingId !== pair.b?.id}
                  />
                </div>
              </CardBody>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

function AppointmentRow({ appointment, onStatus, busyId }) {
  const status = String(appointment.status || '');
  const conflicted = status === PENDING_CONFLICT;
  const terminal = status === 'Cancelled' || status === 'Completed' || status === 'Reassigned';
  const severity = scanSeverity(appointment);
  const busy = busyId === appointment.id;

  return (
    <Card
      as="li"
      variant="outline"
      padding="none"
      className={cn(
        'overflow-hidden',
        conflicted && 'border-l-4 border-l-warning-500',
        severityRank(severity) === 0 && !conflicted && 'border-l-4 border-l-danger-600',
      )}
    >
      <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div
          className="flex w-full shrink-0 flex-col items-center justify-center rounded-card bg-surface-sunken px-3 py-2 sm:w-28"
          aria-hidden="true"
        >
          <span className="font-numeric text-heading-md text-default">{appointment.slot_time || '—'}</span>
          <span className="text-caption text-muted">{formatDate(appointment.slot_date)}</span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={status} size="sm" />
            <SeverityBadge severity={severity} size="sm" />
            {appointment.auto_resolved && (
              <Badge tone="neutral" variant="outline" size="sm">Auto-resolved</Badge>
            )}
            <span className="ml-auto text-caption text-subtle">#{appointment.id}</span>
          </div>

          <h3 className="mt-2 truncate font-heading text-heading-sm text-default">
            {appointment.patient_name || 'Unknown patient'}
          </h3>
          <p className="truncate text-body-sm text-muted">
            {formatDiseaseName(appointment.disease)}
            {appointment.duration && <span className="text-subtle"> · {appointment.duration}</span>}
          </p>

          {appointment.patient_email && appointment.patient_email !== 'No Email' && (
            <a
              href={`mailto:${appointment.patient_email}`}
              className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-field text-caption text-muted underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
            >
              <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{appointment.patient_email}</span>
            </a>
          )}

          {appointment.resolved_at && (
            <p className="mt-1 text-caption text-subtle">
              Conflict resolved {formatDateTime(appointment.resolved_at)}
            </p>
          )}

          {/* An unresolved conflict is handled in the banner above; offering the
              ordinary controls here would just produce a guaranteed 400. */}
          {conflicted ? (
            <p className="mt-3 flex items-center gap-1.5 text-caption text-warning-700">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Waiting on your decision in the conflict panel at the top of this page.
            </p>
          ) : !terminal ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {STATUS_ACTIONS.filter((action) => action.status !== status).map((action) => {
                const Icon = action.icon;
                return (
                  <Button
                    key={action.status}
                    size="sm"
                    variant={action.variant}
                    leftIcon={<Icon className="h-3.5 w-3.5" />}
                    disabled={busy}
                    onClick={() => onStatus(appointment, action)}
                  >
                    {action.label}
                  </Button>
                );
              })}
            </div>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function DoctorAppointmentsPage() {
  const { appointments, loading, error, refreshing, refresh } = useDoctorAppointments();

  const [filter, setFilter] = useState('upcoming');
  const [query, setQuery] = useState('');
  const [actionError, setActionError] = useState(null);

  const [resolvingId, setResolvingId] = useState(null);
  const [resolveTarget, setResolveTarget] = useState(null);
  const [resolveReason, setResolveReason] = useState('');
  const [resolveOutcome, setResolveOutcome] = useState(null);

  const [statusTarget, setStatusTarget] = useState(null);
  const [statusReason, setStatusReason] = useState('');
  const [busyId, setBusyId] = useState(null);

  const pairs = useMemo(() => conflictPairs(appointments), [appointments]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    // Filter only — the server's two-stage priority ordering is preserved.
    return appointments.filter((appointment) => {
      if (!matchesFilter(appointment, filter)) return false;
      if (!needle) return true;
      return [appointment.patient_name, appointment.patient_email, appointment.disease, appointment.id]
        .some((value) => String(value ?? '').toLowerCase().includes(needle));
    });
  }, [appointments, filter, query]);

  /* ------------------------------------------------------------- resolve -- */

  const doResolve = useCallback(async (winner, reason) => {
    setResolvingId(winner.id);
    setActionError(null);
    try {
      const result = await put(appointmentEndpoints.resolveConflict(winner.id), {
        reason: reason?.trim() || undefined,
      });
      setResolveOutcome({
        winner,
        suggested: result?.suggested_slots_for_reassigned_patient || [],
        reassignedId: result?.reassigned_appointment_id ?? null,
      });
      notify.success(`Slot confirmed for ${winner.patient_name || `#${winner.id}`}.`);
      await refresh();
    } catch (caught) {
      setActionError(caught);
    } finally {
      setResolvingId(null);
      setResolveTarget(null);
      setResolveReason('');
    }
  }, [refresh]);

  /* -------------------------------------------------------------- status -- */

  const applyStatus = useCallback(async (appointment, action, reason) => {
    setBusyId(appointment.id);
    setActionError(null);
    try {
      await put(appointmentEndpoints.updateAppointment(appointment.id), {
        status: action.status,
        ...(reason?.trim() ? { reason: reason.trim() } : {}),
      });
      notify.success(`Appointment #${appointment.id} is now ${action.status}.`);
      await refresh();
    } catch (caught) {
      setActionError(caught);
    } finally {
      setBusyId(null);
      setStatusTarget(null);
      setStatusReason('');
    }
  }, [refresh]);

  const onStatus = (appointment, action) => {
    // Cancelling is the only status the backend stores a reason for, so it is
    // the only one that stops to ask for one.
    if (action.needsReason) {
      setStatusTarget({ appointment, action });
      setStatusReason('');
      return;
    }
    applyStatus(appointment, action);
  };

  return (
    <>
      <PageHeader
        title="Appointments"
        description="Your calendar, most urgent first. Conflicts are shown before everything else."
        meta={(
          <>
            {pairs.length > 0 && (
              <Badge tone="warning" variant="solid">
                {pairs.length} conflict{pairs.length === 1 ? '' : 's'}
              </Badge>
            )}
            {!loading && <Badge tone="neutral" variant="outline">{appointments.length} total</Badge>}
          </>
        )}
        actions={(
          <Button
            variant="outline"
            leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            loading={refreshing}
            onClick={() => refresh()}
          >
            Refresh
          </Button>
        )}
      />

      {error && (
        <Alert
          tone="danger"
          title="Could not load your calendar"
          className="mb-6"
          actions={<Button size="sm" variant="outline" onClick={() => refresh()}>Try again</Button>}
        >
          {error.message || 'The appointment list did not load.'}
        </Alert>
      )}

      {actionError && (
        <Alert
          tone="danger"
          title="That change did not go through"
          className="mb-6"
          onDismiss={() => setActionError(null)}
        >
          {actionError.message || 'Nothing was changed.'}
        </Alert>
      )}

      {resolveOutcome && (
        <Alert
          tone="success"
          title={`Slot confirmed for ${resolveOutcome.winner.patient_name || `#${resolveOutcome.winner.id}`}`}
          className="mb-6"
          onDismiss={() => setResolveOutcome(null)}
        >
          {resolveOutcome.reassignedId ? (
            <>
              Appointment #{resolveOutcome.reassignedId} was reassigned and the patient has been
              offered
              {resolveOutcome.suggested.length ? (
                <> these alternatives: {resolveOutcome.suggested
                  .map((slot) => `${slot.date} ${slot.time}`)
                  .join(', ')}.</>
              ) : (
                <> the next available times.</>
              )}
            </>
          ) : (
            <>The other booking has been released.</>
          )}
        </Alert>
      )}

      <ConflictBanner
        pairs={pairs}
        resolvingId={resolvingId}
        onResolve={(winner) => { setResolveTarget(winner); setResolveReason(''); }}
      />

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          className="sm:max-w-sm"
          placeholder="Search patient, condition or id"
          aria-label="Search appointments"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
        />
        <Select
          className="sm:w-72"
          options={STATUS_FILTERS}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter appointments"
        />
      </div>

      {loading ? (
        <SkeletonGroup label="Loading your calendar">
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((n) => <Skeleton key={n} shape="rect" height={132} />)}
          </div>
        </SkeletonGroup>
      ) : !appointments.length ? (
        <EmptyState
          bordered
          icon={<CalendarDays aria-hidden="true" />}
          title="Nothing booked yet"
          description="Appointments appear here once a patient books one of your slots or you accept a consultation request. Setting your availability is what creates bookable slots in the first place."
        />
      ) : !visible.length ? (
        <EmptyState
          bordered
          icon={<CalendarDays aria-hidden="true" />}
          title="Nothing matches those filters"
          description="Try “Everything”, or clear the search box."
          action={(
            <Button variant="outline" onClick={() => { setFilter('all'); setQuery(''); }}>
              Show everything
            </Button>
          )}
        />
      ) : (
        <ul className="flex flex-col gap-3">
          {visible.map((appointment) => (
            <AppointmentRow
              key={appointment.id}
              appointment={appointment}
              onStatus={onStatus}
              busyId={busyId}
            />
          ))}
        </ul>
      )}

      {/* ------------------------------------------------- resolve dialog -- */}
      <Modal
        open={Boolean(resolveTarget)}
        onClose={() => (resolvingId ? undefined : setResolveTarget(null))}
        title="Confirm this patient's slot"
        description={
          resolveTarget
            ? `${resolveTarget.patient_name || `#${resolveTarget.id}`} keeps ${formatDate(resolveTarget.slot_date)} at ${resolveTarget.slot_time}. The other patient is moved to “Reassigned” and offered the next free times.`
            : undefined
        }
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setResolveTarget(null)} disabled={Boolean(resolvingId)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={Boolean(resolvingId)}
              loadingText="Confirming"
              onClick={() => resolveTarget && doResolve(resolveTarget, resolveReason)}
            >
              Confirm slot
            </Button>
          </>
        )}
      >
        <Field
          label="Reason"
          hint="Stored on the reassigned booking. Left blank, the backend records “Urgent patient requires immediate attention”."
        >
          <Textarea
            rows={3}
            maxLength={300}
            value={resolveReason}
            onChange={(event) => setResolveReason(event.target.value)}
            placeholder="e.g. Suspected melanoma — cannot wait."
          />
        </Field>
      </Modal>

      {/* -------------------------------------------------- cancel dialog -- */}
      <Modal
        open={Boolean(statusTarget)}
        onClose={() => (busyId ? undefined : setStatusTarget(null))}
        title="Cancel this appointment"
        description={
          statusTarget
            ? `${statusTarget.appointment.patient_name || 'The patient'} will be told. This cannot be undone from here — they would have to book again.`
            : undefined
        }
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setStatusTarget(null)} disabled={Boolean(busyId)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              loading={Boolean(busyId)}
              loadingText="Cancelling"
              onClick={() => statusTarget && applyStatus(statusTarget.appointment, statusTarget.action, statusReason)}
            >
              Cancel appointment
            </Button>
          </>
        )}
      >
        <Field label="Reason" hint="Shown to the patient with the cancellation.">
          <Textarea
            rows={3}
            maxLength={300}
            value={statusReason}
            onChange={(event) => setStatusReason(event.target.value)}
            placeholder="e.g. Clinic closed that afternoon — please rebook."
          />
        </Field>
      </Modal>
    </>
  );
}
