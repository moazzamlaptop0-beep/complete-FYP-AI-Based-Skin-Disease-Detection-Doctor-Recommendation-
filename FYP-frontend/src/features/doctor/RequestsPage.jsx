/**
 * DoctorRequestsPage — the multi-doctor inbox. GET /api/doctor/appointment-requests.
 *
 * WHAT A "REQUEST" IS
 * -------------------
 * The old flow forced a patient to pin exactly ONE doctor onto a scan
 * (`/send_report`) before they were allowed anywhere near a slot. A request
 * inverts that: the patient picks up to THREE doctors and up to FIVE times up
 * front, and the first doctor to accept one of those times wins. This page is
 * the doctor's half of that — an invitation, not an assignment.
 *
 * ONE ACCEPT BUTTON PER PREFERRED SLOT
 * ------------------------------------
 * `POST /api/appointment-requests/<id>/accept` takes `{slot_id}`. The patient
 * ranked those times deliberately, so the page renders them in rank order as
 * individual buttons rather than a dropdown plus a submit: choosing "Tuesday
 * 10:00" should be one action, and the doctor should never have to discover the
 * available times by opening a menu.
 *
 * THE RACE IS THE INTERESTING PART
 * --------------------------------
 * Three doctors can be looking at the same request. The backend serialises them
 * with `SELECT … FOR UPDATE` on the parent row, so exactly one accept succeeds
 * and the losers get a 409. There are TWO distinct 409s and they mean different
 * things:
 *
 *   "already_closed"  — another doctor took the whole request. Nothing you can
 *                       do; the card must say so and leave the queue.
 *   "slot_taken"      — the request is still yours to win, but THAT time is now
 *                       booked. The other preferred times are still live.
 *
 * A generic red toast would be wrong for both: the first reads as a failure the
 * doctor should retry (they must not), the second as a dead request (it is not).
 * Each is therefore rendered as a distinct, in-place state on the card, and the
 * list is refreshed QUIETLY underneath rather than yanked away mid-read.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Clock,
  Inbox,
  RefreshCw,
  UserCheck,
  Zap,
} from 'lucide-react';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  DateRangeFilter,
  EmptyState,
  Field,
  Modal,
  SeverityBadge,
  Skeleton,
  SkeletonGroup,
  Tabs,
  TabList,
  TabPanel,
  TabTrigger,
  Textarea,
  dateInRange,
  hasDateRange,
  notify,
} from '../../components/ui';
import { ApiError, get, post } from '../../lib/api';
import { requests as requestEndpoints } from '../../lib/endpoints';
import {
  formatConfidence,
  formatDate,
  formatDateTime,
  formatDiseaseName,
  formatRelativeTime,
  parseDate,
} from '../../lib/format';
import { cn } from '../../lib/cn';
import { useAuth } from '../../context/AuthContext';
import { useRealtimeSubscription } from '../../context/RealtimeContext';
import PageHeader from './components/PageHeader';
import QuestionnaireAnswers from './components/QuestionnaireAnswers';
import ScanThumb from './components/ScanThumb';
import useDoctorQuery from './hooks/useDoctorQuery';
import { parseAnswers } from './hooks/useDoctorData';

/* -------------------------------------------------------------------------- */
/* Race classification                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Turn an accept/decline failure into one of the states a card can render.
 * Matched on the backend's own wording (app/services/request_matching.py:70-78)
 * because the envelope carries the message, not the machine code.
 *
 * @returns {'taken_by_other'|'slot_taken'|'already_responded'|'not_invited'|'error'}
 */
export function classifyRequestError(error) {
  const status = error instanceof ApiError ? error.status : 0;
  const message = String(error?.message || '').toLowerCase();

  if (status === 409) {
    if (message.includes('already responded')) return 'already_responded';
    if (message.includes('another doctor') || message.includes('already been answered')) {
      return 'taken_by_other';
    }
    if (message.includes('already booked') || message.includes('slot')) return 'slot_taken';
    // An unrecognised 409 on this route can only mean the request moved on
    // without us; treating it as "somebody won" is the safe reading.
    return 'taken_by_other';
  }
  if (status === 403 && message.includes('not invited')) return 'not_invited';
  return 'error';
}

/** The terminal, nothing-to-do-here states. `slot_taken` is deliberately absent. */
const LOST_STATES = {
  taken_by_other: {
    tone: 'warning',
    title: 'This request was just taken by another doctor',
    body:
      'One of the other doctors the patient invited accepted first, so the request is closed. '
      + 'Nothing was booked in your calendar and there is nothing to undo.',
  },
  already_responded: {
    tone: 'neutral',
    title: 'You have already answered this request',
    body: 'Your response was recorded, most likely in another tab or on another device.',
  },
  not_invited: {
    tone: 'danger',
    title: 'You are not on this request',
    body: 'The patient did not invite you, or the invitation was withdrawn.',
  },
};

/* -------------------------------------------------------------------------- */
/* Slot button                                                                */
/* -------------------------------------------------------------------------- */

function SlotButton({ slot, rank, busy, disabled, takenLocally, onAccept }) {
  return (
    <li>
      <Button
        variant={rank === 1 ? 'primary' : 'outline'}
        size="sm"
        fullWidth
        loading={busy}
        loadingText="Accepting"
        disabled={disabled || takenLocally}
        onClick={() => onAccept(slot)}
        className="justify-start"
      >
        <span className="flex min-w-0 flex-1 flex-col items-start text-left">
          <span className="truncate">
            {formatDate(slot.slot_date)} · {slot.slot_time}
          </span>
          <span className="text-caption font-normal opacity-80">
            {takenLocally
              ? 'That time was just booked'
              : rank === 1
                ? 'Patient’s first choice'
                : `Choice ${rank}`}
          </span>
        </span>
      </Button>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/* Request card                                                               */
/* -------------------------------------------------------------------------- */

function RequestCard({ request, doctorId, onAccepted, onDeclined, onRefresh }) {
  const [busySlotId, setBusySlotId] = useState(null);
  const [lost, setLost] = useState(null);
  const [takenSlotIds, setTakenSlotIds] = useState(() => new Set());
  const [error, setError] = useState(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState('');
  const [declining, setDeclining] = useState(false);

  const scan = request.scan || null;
  const answers = parseAnswers(
    request.answers ?? scan?.questionnaire_answers ?? scan?.patient_questionnaire,
  );
  const severity = String(request.severity_level || scan?.severity || 'ROUTINE').toUpperCase();

  // The patient may have offered times to specific doctors; a slot addressed to
  // somebody else is not mine to accept.
  const mySlots = useMemo(
    () => (request.slots || [])
      .filter((slot) => !slot.doctor_id || String(slot.doctor_id) === String(doctorId))
      .slice()
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)),
    [request.slots, doctorId],
  );

  const closed = request.status !== 'Open';
  const alreadyResponded = Boolean(request.my_response) && request.my_response !== 'Pending';

  const accept = async (slot) => {
    setBusySlotId(slot.slot_id);
    setError(null);
    try {
      const result = await post(requestEndpoints.accept(request.request_id), {
        slot_id: slot.slot_id,
      });
      notify.success(
        result?.appointment_status === 'Pending-Conflict'
          ? 'Accepted. That slot was held by another patient, so it is now a conflict for you to resolve.'
          : 'Accepted. The patient has been emailed.',
      );
      onAccepted?.(request.request_id, result);
      return;
    } catch (caught) {
      const kind = classifyRequestError(caught);
      if (kind === 'slot_taken') {
        // The REQUEST is still winnable — only this one time is gone. Grey out
        // the dead button and leave the rest live.
        setTakenSlotIds((previous) => new Set(previous).add(slot.slot_id));
        setError(caught);
      } else if (LOST_STATES[kind]) {
        setLost(kind);
      } else {
        setError(caught);
      }
      // Whatever happened, our copy of the world is stale.
      onRefresh?.();
    } finally {
      setBusySlotId(null);
    }
  };

  const decline = async () => {
    setDeclining(true);
    setError(null);
    try {
      await post(requestEndpoints.decline(request.request_id), {
        reason: declineReason.trim() || undefined,
      });
      notify.success('Declined. The other invited doctors can still accept.');
      setDeclineOpen(false);
      onDeclined?.(request.request_id);
    } catch (caught) {
      const kind = classifyRequestError(caught);
      if (LOST_STATES[kind]) {
        setLost(kind);
        setDeclineOpen(false);
      } else {
        setError(caught);
      }
      onRefresh?.();
    } finally {
      setDeclining(false);
    }
  };

  const actionable = !lost && !closed && !alreadyResponded;

  return (
    <Card
      as="li"
      variant="outline"
      padding="none"
      className={cn(
        'overflow-hidden',
        request.express && 'border-l-4 border-l-danger-600',
        (lost || closed) && 'opacity-90',
      )}
    >
      <CardBody className="flex flex-col gap-4">
        {/* ------------------------------------------------------- header -- */}
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={severity} size="sm" />
          {request.express && (
            <Badge tone="danger" variant="solid" size="sm" icon={<Zap className="h-3 w-3" />}>
              Express
            </Badge>
          )}
          <Badge tone="neutral" variant="outline" size="sm">
            {request.pending_doctor_count} of {(request.doctors || []).length} doctors still deciding
          </Badge>
          <span
            className="ml-auto whitespace-nowrap text-caption text-muted"
            title={formatDateTime(request.created_at)}
          >
            Sent {formatRelativeTime(request.created_at)}
          </span>
        </div>

        {/* --------------------------------------------------------- body -- */}
        <div className="flex flex-col gap-4 sm:flex-row">
          {/* CONSENT GATES THE PHOTOGRAPH, NOT JUST `image_url`.
              `_scan_payload` nulls `image_url` when consent_share_scan is false
              but still emits `id`, and ScanThumb derives its scanId from that id
              — so an ungated tile fetches /api/scans/<id>/image (which authorises
              on "invited doctor", never on consent) and paints the unconsented
              photo directly above the notice below saying it was not shared.
              `image_shared` is the flag the payload already carries. */}
          {scan && scan.image_shared && (
            <ScanThumb
              scan={scan}
              size="lg"
              canReveal
              // A 112px tile is enough to recognise the case, never enough to
              // judge one. Accepting a request is a clinical decision taken on
              // this photograph, so it has to be openable, magnifiable and
              // rotatable — the patient shot it handheld, at whatever angle.
              zoomable
              zoomTitle={formatDiseaseName(scan?.disease)}
              zoomSubtitle={`${request.patient_name || 'Unknown patient'} · request #${request.request_id}`}
              alt={`Scan from ${request.patient_name || 'a patient'}`}
            />
          )}

          <div className="min-w-0 flex-1">
            <h3 className="font-heading text-heading-sm text-default">
              {formatDiseaseName(scan?.disease)}
              {scan?.confidence !== undefined && scan?.confidence !== null && (
                <span className="ml-2 font-body text-caption font-normal text-muted">
                  {formatConfidence(scan.confidence)} confidence
                </span>
              )}
            </h3>
            <p className="mt-0.5 truncate text-body-sm text-muted">
              {request.patient_name || 'Unknown patient'}
              {request.patient_email && <span className="text-subtle"> · {request.patient_email}</span>}
              <span className="text-subtle"> · request #{request.request_id}</span>
            </p>

            {scan && !scan.image_shared && (
              <p className="mt-2 text-caption text-subtle">
                The patient did not consent to sharing the photograph with this request. The
                clinical fields below are still complete.
              </p>
            )}

            <div className="mt-3">
              <QuestionnaireAnswers answers={answers} />
            </div>

            {Array.isArray(request.triage_reasons) && request.triage_reasons.length > 0 && (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {request.triage_reasons.map((reason) => (
                  <li
                    key={reason}
                    className="rounded-pill border border-warning-200 bg-warning-50 px-2 py-0.5 text-caption text-warning-700"
                  >
                    {reason}
                  </li>
                ))}
              </ul>
            )}

            {request.patient_note && (
              <blockquote className="mt-3 rounded-field border-l-2 border-primary-300 bg-surface-sunken px-3 py-2 text-body-sm text-muted">
                <span className="ui-sr-only">Note from the patient: </span>
                “{request.patient_note}”
              </blockquote>
            )}
          </div>
        </div>

        {/* -------------------------------------------------------- state -- */}
        {lost && (
          <Alert tone={LOST_STATES[lost].tone} title={LOST_STATES[lost].title}>
            {LOST_STATES[lost].body}
          </Alert>
        )}

        {!lost && error && (
          <Alert tone="warning" title="That did not go through" onDismiss={() => setError(null)}>
            {error.message || 'The request could not be answered.'}
            {mySlots.length > 1 && ' The patient’s other preferred times are still open to you.'}
          </Alert>
        )}

        {/* ------------------------------------------------------ actions -- */}
        {actionable && (
          <div className="flex flex-col gap-3 border-t border-subtle pt-4">
            <p className="flex items-center gap-1.5 text-label-md text-default">
              <CalendarClock className="h-4 w-4 text-primary-700" aria-hidden="true" />
              Accept one of the times the patient offered
            </p>

            {mySlots.length ? (
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {mySlots.map((slot) => (
                  <SlotButton
                    key={slot.slot_id}
                    slot={slot}
                    // `rank` is 0-BASED on the wire (consultReducer sends the
                    // array index; normalize_slots stores it verbatim and the
                    // column defaults to 0), so the top choice arrives as 0 and
                    // `?? index + 1` never fires. Convert to a 1-based ordinal
                    // here or the patient's first choice renders as "Choice 0"
                    // while their SECOND is labelled "Patient's first choice".
                    rank={(Number(slot.rank) || 0) + 1}
                    busy={busySlotId === slot.slot_id}
                    disabled={busySlotId !== null && busySlotId !== slot.slot_id}
                    takenLocally={takenSlotIds.has(slot.slot_id)}
                    onAccept={accept}
                  />
                ))}
              </ul>
            ) : (
              <Alert tone="neutral">
                None of the offered times were addressed to you. Decline so the patient hears back
                quickly.
              </Alert>
            )}

            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeclineOpen(true)}
                disabled={busySlotId !== null}
              >
                Decline this request
              </Button>
            </div>
          </div>
        )}

        {!lost && alreadyResponded && (
          <p className="flex items-center gap-2 border-t border-subtle pt-4 text-body-sm text-muted">
            <UserCheck className="h-4 w-4 shrink-0 text-success-700" aria-hidden="true" />
            You answered this request:&nbsp;
            <strong className="text-default">{request.my_response}</strong>
          </p>
        )}

        {!lost && closed && !alreadyResponded && (
          <p className="flex items-center gap-2 border-t border-subtle pt-4 text-body-sm text-muted">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
            This request is {String(request.status).toLowerCase()} and no longer needs an answer.
          </p>
        )}
      </CardBody>

      <Modal
        open={declineOpen}
        onClose={() => { if (!declining) setDeclineOpen(false); }}
        title="Decline this request"
        description="The other invited doctors can still accept, so the patient is not left with nothing."
        size="sm"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setDeclineOpen(false)} disabled={declining}>
              Keep it
            </Button>
            <Button variant="danger" onClick={decline} loading={declining} loadingText="Declining">
              Decline
            </Button>
          </>
        )}
      >
        <Field
          label="Reason"
          hint="Optional, but it is shown to the patient: “fully booked that week” saves them guessing."
        >
          <Textarea
            rows={3}
            maxLength={300}
            value={declineReason}
            onChange={(event) => setDeclineReason(event.target.value)}
            placeholder="e.g. I am away that week, please try one of the other doctors."
          />
        </Field>
      </Modal>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function DoctorRequestsPage() {
  const { user } = useAuth();
  const doctorId = user?.id;
  const [tab, setTab] = useState('open');
  const [dateRange, setDateRange] = useState({ from: null, to: null });

  const fetcher = useCallback(
    (signal) => get(
      requestEndpoints.forDoctor(tab === 'all' ? { include: 'all', limit: 50 } : { limit: 50 }),
      { signal },
    ),
    [tab],
  );
  const { data, loading, error, refreshing, refresh, setData } = useDoctorQuery(fetcher, {
    enabled: Boolean(doctorId),
  });

  // Live updates ride the ONE shared doctor stream; there is deliberately no
  // per-page EventSource here (see RealtimeContext).
  // The payload carries no `type`/`event` key, so the old `kind` regex matched
  // nothing and the inbox never live-updated. React to the payload itself.
  useRealtimeSubscription(useCallback((payload) => {
    if (Array.isArray(payload?.scans) || Array.isArray(payload?.appointments)) refresh();
  }, [refresh]));

  const items = useMemo(() => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.items)) return data.items;
    return [];
  }, [data]);

  const total = data?.total ?? items.length;

  const dateFiltering = hasDateRange(dateRange);

  /**
   * The date filter runs on `created_at`, which older payloads may not carry
   * yet. A row WITHOUT a creation time is deliberately kept when the filter is
   * on (dateInRange treats an unparseable date as in range); the caption below
   * the filter says so instead of silently pretending the row matched.
   */
  const visible = useMemo(() => {
    if (!dateFiltering) return items;
    return items.filter((request) => dateInRange(parseDate(request.created_at), dateRange));
  }, [items, dateRange, dateFiltering]);

  const undatedCount = useMemo(() => {
    if (!dateFiltering) return 0;
    return visible.filter((request) => !parseDate(request.created_at)).length;
  }, [visible, dateFiltering]);

  /** Drop a request from the list the instant it is answered. */
  const removeRequest = (requestId) => {
    setData((previous) => {
      if (Array.isArray(previous)) {
        return previous.filter((row) => row.request_id !== requestId);
      }
      if (previous && Array.isArray(previous.items)) {
        return {
          ...previous,
          items: previous.items.filter((row) => row.request_id !== requestId),
          total: Math.max(0, (previous.total ?? previous.items.length) - 1),
        };
      }
      return previous;
    });
  };

  const body = () => {
    if (loading) {
      return (
        <SkeletonGroup label="Loading your requests">
          <div className="flex flex-col gap-3">
            {[0, 1].map((n) => <Skeleton key={n} shape="rect" height={260} />)}
          </div>
        </SkeletonGroup>
      );
    }
    if (!items.length) {
      return (
        <EmptyState
          bordered
          icon={<Inbox aria-hidden="true" />}
          title={tab === 'all' ? 'No requests have ever reached you' : 'Nothing waiting on you'}
          description={
            tab === 'all'
              ? 'Patients choose up to three doctors per request. You appear as a choice once your licence is approved and your availability is set.'
              : 'Every request addressed to you has been answered, by you or by one of the other invited doctors.'
          }
        />
      );
    }
    if (!visible.length) {
      return (
        <EmptyState
          bordered
          icon={<Inbox aria-hidden="true" />}
          title="No requests were sent on those dates"
          description="The filter matches when the patient sent the request. Widen the range, or clear it."
          action={(
            <Button variant="outline" onClick={() => setDateRange({ from: null, to: null })}>
              Show all dates
            </Button>
          )}
        />
      );
    }
    return (
      <ul className="flex flex-col gap-4">
        {visible.map((request) => (
          <RequestCard
            key={request.request_id}
            request={request}
            doctorId={doctorId}
            onAccepted={removeRequest}
            onDeclined={removeRequest}
            onRefresh={refresh}
          />
        ))}
      </ul>
    );
  };

  return (
    <>
      <PageHeader
        title="Consultation requests"
        description="Patients invite up to three doctors at once. The first to accept a time gets the appointment."
        meta={!loading && total > 0 ? (
          <Badge tone="primary" variant="soft" icon={<Clock className="h-3 w-3" />}>
            {total} {tab === 'all' ? 'in total' : 'waiting'}
          </Badge>
        ) : null}
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
          title="Could not load your requests"
          className="mb-6"
          actions={<Button size="sm" variant="outline" onClick={() => refresh()}>Try again</Button>}
        >
          {error.message || 'The inbox did not load.'}
        </Alert>
      )}

      <div className="mb-4 flex flex-col gap-2">
        <DateRangeFilter
          label="Sent between"
          value={dateRange}
          onChange={setDateRange}
        />
        {dateFiltering && !loading && items.length > 0 && (
          <p className="text-caption text-muted" role="status">
            Showing {visible.length} of {items.length} loaded requests.
            {undatedCount > 0 && (
              ` ${undatedCount} of them ${undatedCount === 1 ? 'has' : 'have'} no recorded creation time, so ${undatedCount === 1 ? 'it is' : 'they are'} always shown.`
            )}
          </p>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab} variant="pill">
        <TabList aria-label="Request inbox filter">
          <TabTrigger value="open">Waiting on me</TabTrigger>
          <TabTrigger value="all">Everything</TabTrigger>
        </TabList>
        <TabPanel value="open" className="pt-5">{tab === 'open' && body()}</TabPanel>
        <TabPanel value="all" className="pt-5">{tab === 'all' && body()}</TabPanel>
      </Tabs>
    </>
  );
}
