/**
 * RequestDetailDrawer — everything the server holds about one request.
 *
 * WHY IT REFETCHES RATHER THAN RENDERING THE ROW IT WAS GIVEN
 * ----------------------------------------------------------
 * The card is built from a PAGE of `/api/appointment-requests`, which can be
 * minutes old — and a request's whole point is that three doctors are answering
 * it while the patient watches. `GET /api/appointment-requests/<id>` returns the
 * same shape for one request, so opening the drawer is the natural moment to ask
 * "what does it say NOW". The list row is shown immediately underneath as the
 * initial value, so the drawer is never blank while that lands.
 *
 * WHAT THE CARD DELIBERATELY LEAVES OUT AND THIS SHOWS
 * ---------------------------------------------------
 * The card answers "who replied?" at a glance. This answers the questions that
 * come after it: when each doctor responded, the exact expiry instant rather than
 * "in 3 hours", the triage score behind the severity badge, the request and scan
 * ids (the things support asks for), the photograph itself, and which appointment
 * a matched request became.
 *
 * THE PHOTO COMES FROM THE IMAGE ROUTE, NOT FROM `scan.image_url`
 * -------------------------------------------------------------
 * `serialize_request` nulls `image_url` unless `consent_share_scan` was ticked —
 * and that gate exists so an INVITED DOCTOR cannot open a photograph the patient
 * chose not to share. Rendering that field here would apply the doctors' gate to
 * the patient's own scan and show them an empty frame where their own skin is.
 * `GET /api/scans/<id>/image` is authenticated and owner-readable, so
 * SensitiveImage always has the bytes and the SERVER decides which variant.
 */

import React from 'react';
import {
  Ban,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  XCircle,
  Zap,
} from 'lucide-react';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Drawer,
  SeverityBadge,
  SkeletonText,
  StatusBadge,
  cn,
} from '../../../components/ui';
import SensitiveImage from '../../../components/media/SensitiveImage';
import { get } from '../../../lib/api';
import { requests as requestEndpoints } from '../../../lib/endpoints';

import { formatConfidence, formatDate, formatDateTime, formatRelative } from '../lib/format';
import { useResource } from '../hooks/usePatientData';

const RESPONSE_META = {
  Pending: { icon: Clock, tone: 'text-muted', label: 'Waiting for a reply' },
  Accepted: { icon: CheckCircle2, tone: 'text-success-600', label: 'Accepted' },
  Declined: { icon: XCircle, tone: 'text-danger-600', label: 'Declined' },
  Withdrawn: { icon: Ban, tone: 'text-subtle', label: 'Invitation withdrawn' },
};

/** What each closed status actually means for the patient, in one line. */
const STATUS_EXPLAINER = {
  Open: 'Live. The first doctor to accept one of your times takes the appointment.',
  Matched: 'A doctor accepted. The appointment is on your Appointments page.',
  Declined: 'Every doctor you invited declined. Send it again to different dermatologists — your scan and answers are reused.',
  Expired: 'Nobody replied before it ran out. Send it again — your scan and answers are reused.',
  Withdrawn: 'You withdrew it. Send it again whenever you like — your scan and answers are reused.',
};

function Section({ title, children }) {
  return (
    <section>
      <h3 className="mb-2 font-heading text-label-lg text-default">{title}</h3>
      {children}
    </section>
  );
}

function DetailRow({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-subtle py-2 last:border-b-0">
      <dt className="shrink-0 font-body text-body-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-body text-body-sm text-default">{children}</dd>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object|null} props.request The list row that was clicked.
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 */
export function RequestDetailDrawer({ request, open, onClose }) {
  const requestId = request?.request_id ?? null;

  const { data, loading, error } = useResource(
    (signal) => get(requestEndpoints.get(requestId), { signal }),
    { deps: [requestId, open], enabled: Boolean(open && requestId), initialData: null },
  );

  // The freshest thing we have: the refetch if it landed, the clicked row until it does.
  const detail = data || request;
  if (!detail) return null;

  const status = detail.status || 'Open';
  const scan = detail.scan;
  const doctors = Array.isArray(detail.doctors) ? detail.doctors : [];
  const slots = Array.isArray(detail.slots) ? detail.slots : [];
  const reasons = Array.isArray(detail.triage_reasons) ? detail.triage_reasons : [];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="lg"
      title={scan?.disease || 'Consultation request'}
      description={`Request #${detail.request_id} · sent ${formatRelative(detail.created_at)}`}
      footer={<Button variant="primary" onClick={onClose}>Close</Button>}
    >
      <div className="flex flex-col gap-6">
        {/* --------------------------------------------------------- state -- */}
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge status={status} size="sm" />
          {detail.severity_level && <SeverityBadge severity={detail.severity_level} size="sm" />}
          {detail.express && (
            <Badge tone="danger" icon={<Zap className="h-3 w-3" aria-hidden="true" />}>Express</Badge>
          )}
          {loading && <span className="font-body text-caption text-subtle">Refreshing…</span>}
        </div>

        {STATUS_EXPLAINER[status] && (
          <Alert tone={status === 'Open' || status === 'Matched' ? 'info' : 'warning'}>
            {STATUS_EXPLAINER[status]}
          </Alert>
        )}

        {error && (
          <Alert tone="warning" title="Showing the copy from your list">
            {error} The details below may be a few minutes old.
          </Alert>
        )}

        {/* ---------------------------------------------------- the facts -- */}
        <Section title="This request">
          <dl>
            <DetailRow label="Sent">{formatDateTime(detail.created_at)}</DetailRow>
            <DetailRow label={status === 'Open' ? 'Expires' : 'Was due'}>
              {detail.expires_at ? formatDateTime(detail.expires_at) : '—'}
            </DetailRow>
            <DetailRow label="Doctors invited">
              {doctors.length} · {detail.pending_doctor_count ?? 0} still to reply
            </DetailRow>
            <DetailRow label="Times offered">{slots.length}</DetailRow>
            {detail.triage_score !== null && detail.triage_score !== undefined && (
              <DetailRow label="Triage score">{detail.triage_score}</DetailRow>
            )}
            {detail.matched_appointment_id && (
              <DetailRow label="Became appointment">#{detail.matched_appointment_id}</DetailRow>
            )}
          </dl>
        </Section>

        {/* ----------------------------------------------------- the scan -- */}
        {scan && (
          <Section title="The scan behind it">
            {/* Your own photo, at a size you can actually judge. `canReveal` is on
                because a sensitive scan serves the blurred variant to everyone
                including its owner — the reveal is audited and re-blurs itself. */}
            <SensitiveImage
              scanId={scan.id}
              variant="full"
              sensitive={scan.is_sensitive}
              alt={`Scan of ${scan.disease || 'the affected area'}`}
              canReveal
              revealSeconds={30}
              className="mb-3 aspect-[4/3] w-full"
              imgClassName="object-contain"
            />
            {scan.is_sensitive && (
              <p className="mb-3 font-body text-caption text-muted">
                Marked sensitive. Revealing the full image is recorded against your name and it
                re-blurs after 30 seconds — the same rule the doctors get.
              </p>
            )}
            <dl>
              <DetailRow label="Diagnosis">{scan.disease || '—'}</DetailRow>
              {scan.confidence !== null && scan.confidence !== undefined && (
                <DetailRow label="Model confidence">{formatConfidence(scan.confidence)}</DetailRow>
              )}
              <DetailRow label="Severity">{scan.severity || '—'}</DetailRow>
              <DetailRow label="Review status">{scan.status || '—'}</DetailRow>
              <DetailRow label="Scan id">#{scan.id}</DetailRow>
              <DetailRow label="Marked sensitive">{scan.is_sensitive ? 'Yes' : 'No'}</DetailRow>
            </dl>
          </Section>
        )}

        {/* -------------------------------------------------- why severity -- */}
        {reasons.length > 0 && (
          <Section title="Why this severity">
            <ul className="flex flex-col gap-1">
              {reasons.map((reason, index) => (
                <li key={index} className="flex gap-2 font-body text-body-sm text-muted">
                  <span aria-hidden="true">·</span>
                  <span>{String(reason)}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {/* -------------------------------------------------- the replies -- */}
        <Section title={`Doctors and their replies (${doctors.length})`}>
          {doctors.length === 0 ? (
            <p className="font-body text-body-sm text-muted">No doctors are attached to this request.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {doctors.map((invite) => {
                const meta = RESPONSE_META[invite.response] || RESPONSE_META.Pending;
                const Icon = meta.icon;
                const matched = detail.matched_doctor_id === invite.doctor_id;

                return (
                  <li
                    key={invite.doctor_id}
                    className={cn(
                      'rounded-card border p-3',
                      matched ? 'border-success-600 bg-success-50' : 'border-subtle bg-surface',
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <Avatar src={invite.profile_image || undefined} name={invite.doctor_name} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-body text-label-md text-default">
                          {invite.doctor_name || `Doctor #${invite.doctor_id}`}
                        </p>
                        <p className="truncate font-body text-caption text-muted">
                          {invite.specialty || 'Dermatology'}
                        </p>
                      </div>
                      <span className={cn('flex shrink-0 items-center gap-1.5 font-body text-caption', meta.tone)}>
                        <Icon className="h-4 w-4" aria-hidden="true" />
                        {meta.label}
                      </span>
                    </div>
                    {invite.responded_at && (
                      <p className="mt-1.5 font-body text-caption text-subtle">
                        Replied {formatDateTime(invite.responded_at)}
                      </p>
                    )}
                    {invite.decline_reason && (
                      <p className="mt-1.5 rounded-field bg-surface-sunken p-2 font-body text-body-sm text-default">
                        “{invite.decline_reason}”
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {/* ---------------------------------------------------- the times -- */}
        <Section title={`Times you offered (${slots.length})`}>
          {slots.length === 0 ? (
            <p className="font-body text-body-sm text-muted">No preferred times were recorded.</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {slots.map((slot, index) => (
                <li
                  key={slot.slot_id ?? index}
                  className="flex items-center justify-between gap-3 rounded-field border border-subtle bg-surface-sunken px-3 py-2"
                >
                  <span className="font-numeric text-body-sm tabular-nums text-default">
                    {formatDate(slot.slot_date)} · {slot.slot_time}
                  </span>
                  <span className="font-body text-caption text-subtle">
                    choice {index + 1}
                    {slot.doctor_id
                      ? ` · ${doctors.find((d) => d.doctor_id === slot.doctor_id)?.doctor_name || `Doctor #${slot.doctor_id}`}`
                      : ' · any of your doctors'}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        {/* --------------------------------------------------- your words -- */}
        <Section title="Your note">
          {detail.patient_note ? (
            <p className="whitespace-pre-wrap rounded-card border border-subtle bg-surface-sunken p-3 font-body text-body-sm text-default">
              {detail.patient_note}
            </p>
          ) : (
            <p className="font-body text-body-sm text-muted">You did not add a note.</p>
          )}
        </Section>

        {/* ------------------------------------------------------ sharing -- */}
        <Section title="The photograph">
          <p className="flex items-start gap-2 font-body text-body-sm text-muted">
            {detail.consent_share_scan ? (
              <Eye className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            ) : (
              <EyeOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            )}
            <span>
              {detail.consent_share_scan
                ? scan?.is_sensitive
                  ? 'You allowed these doctors to see it. It is marked sensitive, so they get a blurred '
                    + 'preview until they explicitly reveal it — and that is logged against their name.'
                  : 'You allowed these doctors to see it.'
                : 'NOT shared. These doctors can see the diagnosis, the severity and your note, but not '
                  + 'the picture.'}
            </span>
          </p>
        </Section>

        {loading && !data && <SkeletonText lines={2} />}
      </div>
    </Drawer>
  );
}

export default RequestDetailDrawer;
