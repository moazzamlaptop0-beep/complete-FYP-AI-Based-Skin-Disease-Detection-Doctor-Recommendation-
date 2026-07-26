/**
 * RequestCard — one multi-doctor consultation request.
 *
 * WHAT A REQUEST IS
 * -----------------
 * The replacement for `/send_report`, which pinned a scan to exactly ONE doctor
 * and had to happen BEFORE a slot could be booked — so if that doctor never
 * replied, the patient's only move was to start again. A request instead invites
 * up to THREE doctors and offers up to FIVE ranked times; the first doctor to
 * accept one closes it for the rest.
 *
 * The whole point of this card is therefore to answer "who has replied, and what
 * did I offer them?" without another round trip. Both are already in the list
 * payload (`doctors[]` and `slots[]`), so the detail is inline rather than behind
 * a "view" click that fetches the same object again.
 *
 * WHAT THE PHOTO SHOWS
 * --------------------
 * `scan.image_url` is NULL unless `consent_share_scan` was ticked on THIS
 * request — the doctors genuinely cannot see the photograph otherwise. That is
 * stated on the card, because "I sent my scan" and "I let them see the picture"
 * are two different things and the patient chose between them in the stepper.
 */

import React from 'react';
import {
  Ban,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  Info,
  Pencil,
  RotateCcw,
  XCircle,
  Zap,
} from 'lucide-react';

import {
  Avatar,
  Badge,
  Button,
  Card,
  SeverityBadge,
  StatusBadge,
  cn,
} from '../../../components/ui';

import { formatConfidence, formatDate, formatDateTime, formatRelative } from '../lib/format';

/** The per-doctor reply state — the column a patient actually opens this page for. */
const RESPONSE_META = {
  Pending: { icon: Clock, tone: 'text-muted', label: 'Waiting for a reply' },
  Accepted: { icon: CheckCircle2, tone: 'text-success-600', label: 'Accepted' },
  Declined: { icon: XCircle, tone: 'text-danger-600', label: 'Declined' },
  Withdrawn: { icon: Ban, tone: 'text-subtle', label: 'Withdrawn' },
};

function DoctorRow({ invite, matched }) {
  const meta = RESPONSE_META[invite.response] || RESPONSE_META.Pending;
  const Icon = meta.icon;

  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-card border p-2.5',
        matched ? 'border-success-600 bg-success-50' : 'border-subtle bg-surface',
      )}
    >
      <Avatar src={invite.profile_image || undefined} name={invite.doctor_name} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-body text-label-md text-default">
          {invite.doctor_name || `Doctor #${invite.doctor_id}`}
        </p>
        <p className="truncate font-body text-caption text-muted">
          {invite.specialty || 'Dermatology'}
          {invite.preference_rank === undefined || invite.preference_rank === null
            ? ''
            : ` · your ${ordinal(rankOrdinal(invite.preference_rank))} choice`}
        </p>
        {invite.response === 'Declined' && invite.decline_reason && (
          <p className="mt-0.5 font-body text-caption text-muted">“{invite.decline_reason}”</p>
        )}
      </div>
      <span className={cn('flex shrink-0 items-center gap-1.5 font-body text-caption', meta.tone)}>
        <Icon className="h-4 w-4" aria-hidden="true" />
        {meta.label}
      </span>
    </li>
  );
}

function ordinal(n) {
  const number = Number(n);
  if (!Number.isFinite(number)) return '';
  const suffix = ['th', 'st', 'nd', 'rd'][(number % 100 - 20) % 10] || ['th', 'st', 'nd', 'rd'][number % 100] || 'th';
  return `${number}${suffix}`;
}

/**
 * `rank` and `preference_rank` are 0-BASED on the wire: the stepper sends the
 * array index, `normalize_slots` stores it verbatim, `preference_rank` comes from
 * `enumerate(approved)`, and both columns default to 0. A truthiness test
 * therefore drops the label from the patient's FIRST choice and mislabels their
 * second as "1st choice". Convert to a 1-based ordinal instead.
 */
function rankOrdinal(value) {
  return (Number(value) || 0) + 1;
}

/**
 * Statuses a request can be re-sent from. All three mean "this consultation never
 * happened and no doctor is holding it" — which is exactly when reusing the scan
 * and the answers is the honest shortcut. 'Matched' is absent on purpose: that one
 * became a real appointment, and the Appointments page owns rebooking it.
 *
 * 'Declined' is here BECAUSE re-sending can reassign the doctors. Offering to
 * re-send a declined request to the doctors who declined it would be a button
 * that leads nowhere; offering to send the same scan to somebody else is the
 * whole point.
 */
const REAPPLIABLE = Object.freeze(['Withdrawn', 'Expired', 'Declined']);

/**
 * @param {object} props
 * @param {object} props.request A `/api/appointment-requests` item.
 * @param {(request: object) => void} [props.onDetails] Omitted ⇒ no details button.
 * @param {(request: object) => void} [props.onCancel] Omitted ⇒ no cancel button.
 * @param {(request: object) => void} [props.onEdit] Open requests only.
 * @param {(request: object) => void} [props.onReapply] Withdrawn/Expired/Declined only.
 */
export function RequestCard({ request, onDetails, onCancel, onEdit, onReapply }) {
  const status = request.status || 'Open';
  const isOpen = status === 'Open';
  const scan = request.scan;
  const doctors = Array.isArray(request.doctors) ? request.doctors : [];
  const slots = Array.isArray(request.slots) ? request.slots : [];
  const reasons = Array.isArray(request.triage_reasons) ? request.triage_reasons : [];

  const canReapply = REAPPLIABLE.includes(status) && Boolean(onReapply);
  const showActions = Boolean(onDetails) || (isOpen && (onCancel || onEdit)) || canReapply;

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex flex-col gap-4 p-4">
        {/* ------------------------------------------------------------ head -- */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-heading text-label-lg text-default">
              {scan?.disease || 'Consultation request'}
            </h3>
            <p className="font-body text-body-sm text-muted">
              Sent {formatRelative(request.created_at)}
              {scan?.confidence !== undefined && scan?.confidence !== null
                ? ` · ${formatConfidence(scan.confidence)} confidence`
                : ''}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {request.express && (
              <Badge tone="danger" icon={<Zap className="h-3 w-3" aria-hidden="true" />}>Express</Badge>
            )}
            {request.severity_level && <SeverityBadge severity={request.severity_level} size="sm" />}
            <StatusBadge status={status} size="sm" />
          </div>
        </div>

        {isOpen && request.expires_at && (
          <p className="font-body text-body-sm text-muted">
            Expires {formatRelative(request.expires_at)} · {request.pending_doctor_count ?? 0} of{' '}
            {doctors.length} still to reply.
          </p>
        )}

        {status === 'Matched' && (
          <p className="font-body text-body-sm text-success-700">
            Accepted. The appointment is on your Appointments page.
          </p>
        )}

        {/* --------------------------------------------------------- reasons -- */}
        {reasons.length > 0 && (
          <div>
            <h4 className="mb-1 font-body text-label-md text-default">Why this severity</h4>
            <ul className="flex flex-col gap-1">
              {reasons.map((reason, index) => (
                <li key={index} className="flex gap-2 font-body text-body-sm text-muted">
                  <span aria-hidden="true">·</span>
                  <span>{String(reason)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* --------------------------------------------------------- doctors -- */}
        <div>
          <h4 className="mb-2 font-body text-label-md text-default">
            Doctors you invited ({doctors.length})
          </h4>
          {doctors.length === 0 ? (
            <p className="font-body text-body-sm text-muted">No doctors are attached to this request.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {doctors.map((invite) => (
                <DoctorRow
                  key={invite.doctor_id}
                  invite={invite}
                  matched={request.matched_doctor_id === invite.doctor_id}
                />
              ))}
            </ul>
          )}
        </div>

        {/* ----------------------------------------------------------- slots -- */}
        <div>
          <h4 className="mb-2 font-body text-label-md text-default">
            Times you offered ({slots.length})
          </h4>
          {slots.length === 0 ? (
            <p className="font-body text-body-sm text-muted">No preferred times were recorded.</p>
          ) : (
            <ol className="flex flex-wrap gap-2">
              {slots.map((slot) => (
                <li
                  key={slot.slot_id}
                  className="rounded-control border border-subtle bg-surface-sunken px-2.5 py-1.5"
                >
                  <span className="font-numeric text-body-sm tabular-nums text-default">
                    {formatDate(slot.slot_date)} · {slot.slot_time}
                  </span>
                  {slot.rank === undefined || slot.rank === null ? null : (
                    <span className="ml-1.5 font-body text-caption text-muted">
                      {ordinal(rankOrdinal(slot.rank))} choice
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        {/* ------------------------------------------------------ your note -- */}
        {request.patient_note && (
          <div>
            <h4 className="mb-1 font-body text-label-md text-default">Your note</h4>
            <p className="whitespace-pre-wrap rounded-card border border-subtle bg-surface-sunken p-2.5 font-body text-body-sm text-default">
              {request.patient_note}
            </p>
          </div>
        )}

        {/* -------------------------------------------------------- sharing -- */}
        {scan && (
          <p className="flex items-start gap-2 font-body text-caption text-muted">
            {request.consent_share_scan ? (
              <Eye className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            ) : (
              <EyeOff className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span>
              {request.consent_share_scan ? (
                <>
                  You allowed these doctors to see the photograph
                  {scan.is_sensitive
                    ? ', and it is marked sensitive — they get a blurred preview until they explicitly reveal it, which is logged against their name.'
                    : '.'}
                </>
              ) : (
                <>
                  The photograph was NOT shared. These doctors can see the diagnosis, the severity and
                  your note, but not the picture.
                </>
              )}
            </span>
          </p>
        )}
      </div>

      {/* -------------------------------------------------------- actions -- */}
      {showActions && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-subtle bg-surface-sunken px-4 py-3">
          <p className="font-body text-caption text-muted">
            Created {formatDateTime(request.created_at)}
          </p>
          {/* Every action is a filled button, and the colour IS the meaning:
              secondary for the read-only one, primary for the edit, success for
              the one that puts a live request back in front of a doctor, danger
              for the one that closes it. */}
          <div className="flex flex-wrap items-center gap-2">
            {onDetails && (
              <Button
                size="sm"
                variant="secondary"
                leftIcon={<Info className="h-4 w-4" />}
                onClick={() => onDetails(request)}
              >
                Details
              </Button>
            )}
            {/* Editing is only ever offered while it is Open — the moment a doctor
                accepts, the times stop being a preference and become somebody's
                calendar. */}
            {isOpen && onEdit && (
              <Button
                size="sm"
                variant="primary"
                leftIcon={<Pencil className="h-4 w-4" />}
                onClick={() => onEdit(request)}
              >
                Edit request
              </Button>
            )}
            {canReapply && (
              <Button
                size="sm"
                variant="success"
                leftIcon={<RotateCcw className="h-4 w-4" />}
                onClick={() => onReapply(request)}
              >
                {status === 'Declined' ? 'Send to another doctor' : 'Send again'}
              </Button>
            )}
            {isOpen && onCancel && (
              <Button
                size="sm"
                variant="danger"
                leftIcon={<Ban className="h-4 w-4" />}
                onClick={() => onCancel(request)}
              >
                Withdraw
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

export default RequestCard;
