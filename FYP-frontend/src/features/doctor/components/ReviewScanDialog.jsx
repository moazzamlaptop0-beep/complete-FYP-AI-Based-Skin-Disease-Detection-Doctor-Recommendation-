/**
 * ReviewScanDialog — the ONE place a doctor writes back to a scan.
 *
 * TWO ENDPOINTS, ONE DIALOG, DELIBERATELY SEPARATE SUBMITS
 * -------------------------------------------------------
 *   PUT  /doctor/update_scan/<id>        {comment, invite_to_clinic}
 *   POST /api/override-severity/<id>     {severity, reason}
 *
 * They are not merged into a single "save" because they are not the same act.
 * Leaving a comment is routine clinical work. Overriding the model's severity is
 * a documented clinical disagreement that the backend records with a mandatory
 * reason — merging them would mean every ordinary comment silently re-asserted a
 * severity, and would make the reason field feel like paperwork attached to the
 * wrong action.
 *
 * ENVELOPE NOTE
 * -------------
 * `/doctor/update_scan/<id>` returns a FLAT dict — the scan's fields sit at the
 * top level next to a decorative `success` and an EMPTY `data:{}`. lib/api.js
 * normalises that by path (ENVELOPE_BREAKERS.FLAT_DICT), so what resolves here is
 * already the scan object. Never read `.data` off it.
 *
 * The dialog is used by both ReferralsPage and PatientDetailPage; whoever opens
 * it passes `onSaved`, which receives the merged scan so the caller can patch its
 * row in place instead of re-fetching the whole queue under the doctor's cursor.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, MessageSquare, Save, ShieldAlert } from 'lucide-react';

import {
  Alert,
  Badge,
  Button,
  Field,
  Modal,
  Select,
  SeverityBadge,
  Switch,
  Textarea,
  notify,
} from '../../../components/ui';
import { post, put } from '../../../lib/api';
import { scans as scanEndpoints } from '../../../lib/endpoints';
import { formatConfidence, formatDiseaseName } from '../../../lib/format';
import { cn } from '../../../lib/cn';
import QuestionnaireAnswers from './QuestionnaireAnswers';
import ScanThumb from './ScanThumb';
import { parseAnswers, scanSeverity } from '../hooks/useDoctorData';

const SEVERITIES = [
  { value: 'ROUTINE', label: 'ROUTINE: can wait for a normal appointment' },
  { value: 'URGENT', label: 'URGENT: should be seen within days' },
  { value: 'CRITICAL', label: 'CRITICAL: needs immediate attention' },
];

/**
 * @param {object} props
 * @param {object|null} props.scan
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(scan: object) => void} [props.onSaved] Receives the merged scan.
 */
export default function ReviewScanDialog({ scan, open, onClose, onSaved }) {
  const scanId = scan?.id ?? scan?.scan_id ?? null;

  const [comment, setComment] = useState('');
  const [invite, setInvite] = useState(false);
  const [severity, setSeverity] = useState('ROUTINE');
  const [reason, setReason] = useState('');

  const [savingReview, setSavingReview] = useState(false);
  const [savingSeverity, setSavingSeverity] = useState(false);
  const [error, setError] = useState(null);
  const [reasonError, setReasonError] = useState('');

  /**
   * Seed the form ONCE per opening, keyed on `open:scanId`.
   *
   * Two failure modes are being avoided at the same time, and they pull in
   * opposite directions. Seeding too rarely puts one patient's note on another
   * patient's record (open case A, close, open case B, still see A's comment).
   * Seeding too often wipes what the doctor is typing, because `scan` is a fresh
   * object on every parent re-render and an SSE tick re-renders the parent. A ref
   * on the composite key is the only version that is right in both directions.
   */
  const seededKey = useRef(null);
  useEffect(() => {
    const key = open ? `${scanId}` : null;
    if (seededKey.current === key) return;
    seededKey.current = key;
    if (!open) return;
    setComment(scan?.doctor_comment || '');
    setInvite(Boolean(scan?.invite_to_clinic));
    setSeverity(scanSeverity(scan));
    setReason('');
    setError(null);
    setReasonError('');
  }, [open, scanId, scan]);

  if (!scan) return null;

  const answers = parseAnswers(scan.questionnaire_answers ?? scan.patient_questionnaire);
  const currentSeverity = scanSeverity(scan);
  const severityChanged = severity !== currentSeverity;

  const saveReview = async () => {
    setSavingReview(true);
    setError(null);
    try {
      const updated = await put(scanEndpoints.update(scanId), {
        comment: comment.trim(),
        invite_to_clinic: invite,
      });
      // The flat dict already carries status/review_status/doctor_comment.
      onSaved?.({ ...scan, ...(updated && typeof updated === 'object' ? updated : {}) });
      notify.success('Review saved. The patient has been emailed.');
      onClose?.();
    } catch (caught) {
      setError(caught);
    } finally {
      setSavingReview(false);
    }
  };

  const saveSeverity = async () => {
    const trimmed = reason.trim();
    if (!trimmed) {
      // The backend requires it too; failing here keeps the doctor's typing.
      setReasonError('Say why you are changing the severity. This is stored on the record.');
      return;
    }
    setSavingSeverity(true);
    setError(null);
    setReasonError('');
    try {
      const result = await post(scanEndpoints.overrideSeverity(scanId), {
        severity,
        reason: trimmed,
      });
      onSaved?.({
        ...scan,
        severity: result?.severity_level || severity,
        severity_level: result?.severity_level || severity,
        override_reason: result?.override_reason || trimmed,
      });
      notify.success(`Severity set to ${severity}.`);
      setReason('');
    } catch (caught) {
      setError(caught);
    } finally {
      setSavingSeverity(false);
    }
  };

  const busy = savingReview || savingSeverity;

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      size="lg"
      title={`Review case #${scanId}`}
      description={scan.patient_name ? `Referred by ${scan.patient_name}` : undefined}
      footer={(
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Close</Button>
          <Button
            variant="primary"
            leftIcon={<Save className="h-4 w-4" />}
            onClick={saveReview}
            loading={savingReview}
            loadingText="Saving"
            disabled={savingSeverity}
          >
            Save review
          </Button>
        </>
      )}
    >
      <div className="flex flex-col gap-5">
        {error && (
          <Alert tone="danger" title="That did not save" onDismiss={() => setError(null)}>
            {error.message || 'The request failed. Nothing was changed.'}
          </Alert>
        )}

        {/* ---------------------------------------------------------- case -- */}
        <section className="flex flex-wrap gap-4 rounded-card border border-subtle bg-surface-sunken p-3">
          <ScanThumb scan={scan} size="lg" canReveal />
          <div className="min-w-[12rem] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={currentSeverity} size="sm" />
              {scan.review_status && (
                <Badge tone="neutral" variant="outline" size="sm">{scan.review_status}</Badge>
              )}
            </div>
            <p className="mt-2 font-heading text-heading-sm text-default">
              {formatDiseaseName(scan.disease || scan.prediction_result)}
            </p>
            <p className="text-caption text-muted">
              Model confidence {formatConfidence(scan.confidence)}
            </p>
            <div className="mt-3">
              <QuestionnaireAnswers answers={answers} />
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- review -- */}
        <section aria-labelledby="review-heading" className="flex flex-col gap-3">
          <h3 id="review-heading" className="flex items-center gap-2 font-heading text-heading-sm text-default">
            <MessageSquare className="h-4 w-4 text-primary-700" aria-hidden="true" />
            Your clinical comment
          </h3>

          <Field
            label="Comment to the patient"
            hint="Emailed to the patient and shown on their report. Saving marks this case Reviewed."
          >
            <Textarea
              rows={5}
              maxLength={2000}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder="What you can see, what it most likely is, and what they should do next."
            />
          </Field>

          <Switch
            checked={invite}
            onChange={(event) => setInvite(event.target.checked)}
            label="Invite this patient to my clinic"
            description="Adds a booking prompt to the report the patient sees."
          />
        </section>

        {/* ------------------------------------------------------ severity -- */}
        <section
          aria-labelledby="severity-heading"
          className="flex flex-col gap-3 rounded-card border border-warning-200 bg-warning-50/50 p-3"
        >
          <h3
            id="severity-heading"
            className="flex items-center gap-2 font-heading text-heading-sm text-default"
          >
            <ShieldAlert className="h-4 w-4 text-warning-700" aria-hidden="true" />
            Override the triage severity
          </h3>
          <p className="text-caption text-muted">
            The severity above was computed from the model result and the patient&apos;s symptom answers.
            Your clinical judgement outranks it. The change and your reason are recorded against the scan.
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Severity">
              <Select
                options={SEVERITIES}
                value={severity}
                onChange={(event) => setSeverity(event.target.value)}
              />
            </Field>
            <div className="flex items-end pb-1">
              <p className="text-caption text-muted">
                Currently <span className="font-semibold text-default">{currentSeverity}</span>
                {severityChanged && (
                  <>
                    {' → '}
                    <span className="font-semibold text-warning-700">{severity}</span>
                  </>
                )}
              </p>
            </div>
          </div>

          <Field
            label="Reason"
            required
            error={reasonError || undefined}
            hint="Stored on the record and visible in the audit trail."
          >
            <Textarea
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                if (reasonError) setReasonError('');
              }}
              placeholder="e.g. Border irregularity and recent growth warrant an urgent in-person look."
            />
          </Field>

          <div className={cn('flex flex-wrap items-center gap-2')}>
            <Button
              variant="secondary"
              leftIcon={<AlertTriangle className="h-4 w-4" />}
              onClick={saveSeverity}
              loading={savingSeverity}
              loadingText="Applying"
              disabled={savingReview || !severityChanged}
            >
              Apply severity
            </Button>
            {!severityChanged && (
              <span className="text-caption text-subtle">
                Pick a different severity to enable this.
              </span>
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}

export { ReviewScanDialog };
