/**
 * DeleteImageDialog — erase the photograph, keep the medical record.
 *
 * THE POINT
 * ---------
 * "Delete my photo" and "delete my history" are two different requests, and
 * conflating them is harmful in both directions: a patient who wants the picture
 * of their groin off a server should not have to destroy the diagnosis that
 * picture produced, and a doctor's clinical note must not silently vanish
 * because a patient exercised erasure on an image.
 *
 * `DELETE /api/scans/<id>/image` purges main + thumb + blur (and every
 * attachment) from disk and leaves the `ai_scans` row, `prediction_result`,
 * `confidence`, `severity_level`, `triage_score`, `triage_reasons`,
 * `doctor_comment`, `patient_questionnaire` and every linked appointment and
 * rating exactly where they were. This dialog's entire job is to make that
 * asymmetry legible BEFORE the button is pressed — hence two explicit columns,
 * a consent checkbox, a reason, and a typed confirmation.
 *
 * The three-part gate is not friction theatre. The backend requires all three
 * (`consent_ack: true`, a `reason`, `confirm_text: "DELETE"`) and writes a
 * `user_consents(consent_type='image_deletion')` row from them: the checkbox IS
 * the consent record. A UI that pre-ticked it would be forging that record.
 */

import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Trash2, X } from 'lucide-react';

import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  Modal,
  ModalFooter,
  Textarea,
  notify,
} from '../../../components/ui';
import { ApiError, del } from '../../../lib/api';
import { scans as scanEndpoints } from '../../../lib/endpoints';

/** The literal the backend compares against. Case-sensitive on purpose. */
const CONFIRM_WORD = 'DELETE';

const DESTROYED = [
  'The photograph itself',
  'Its thumbnail and blurred preview',
  'Any extra photos attached to this scan',
];

const RETAINED = [
  'The AI diagnosis and confidence score',
  'The severity level and triage reasons',
  "Your doctor's written comment",
  'The questionnaire answers you gave',
  'Appointments booked from this scan',
  'Ratings and reviews you left',
];

export function DeleteImageDialog({ scan, open, onClose, onDeleted }) {
  const [consent, setConsent] = useState(false);
  const [reason, setReason] = useState('');
  const [confirmText, setConfirmText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Reset on every open: a half-typed DELETE surviving from the previous scan is
  // exactly how the wrong photo gets destroyed.
  useEffect(() => {
    if (open) {
      setConsent(false);
      setReason('');
      setConfirmText('');
      setError(null);
      setBusy(false);
    }
  }, [open, scan?.id]);

  const ready = consent && reason.trim().length >= 3 && confirmText === CONFIRM_WORD;

  const submit = async () => {
    if (!ready || !scan) return;
    setBusy(true);
    setError(null);
    try {
      await del(scanEndpoints.deleteImage(scan.id), {
        body: { reason: reason.trim(), consent_ack: true, confirm_text: CONFIRM_WORD },
      });
      notify.success('The photograph has been deleted. Your record is intact.');
      onDeleted?.();
      onClose?.();
    } catch (err) {
      // 409 is the interesting one: a live appointment still references this
      // scan, so the doctor would arrive at a consultation with nothing to look
      // at. Say so instead of "request failed".
      const conflict = err instanceof ApiError && err.status === 409;
      setError(
        conflict
          ? `${err.message} Cancel or complete that appointment first, then delete the photo.`
          : (err?.message || 'The photo could not be deleted.'),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      size="lg"
      title="Delete this photograph"
      description="Your diagnosis, your doctor's comments and your appointment history all stay exactly as they are."
      footer={
        <ModalFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="danger"
            leftIcon={<Trash2 className="h-4 w-4" />}
            disabled={!ready}
            loading={busy}
            loadingText="Deleting"
            onClick={submit}
          >
            Delete the photo
          </Button>
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-5">
        {error && <Alert tone="danger" title="We could not delete it">{error}</Alert>}

        <Alert tone="warning" icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}>
          This cannot be undone. The image files are removed from the server, not hidden.
        </Alert>

        <div className="grid gap-3 sm:grid-cols-2">
          <section className="rounded-card border border-subtle bg-surface-sunken p-3">
            <h3 className="mb-2 flex items-center gap-1.5 font-body text-label-md text-default">
              <X className="h-4 w-4 text-danger-600" aria-hidden="true" />
              Permanently destroyed
            </h3>
            <ul className="flex flex-col gap-1.5">
              {DESTROYED.map((item) => (
                <li key={item} className="font-body text-body-sm text-muted">{item}</li>
              ))}
            </ul>
          </section>

          <section className="rounded-card border border-subtle bg-surface-sunken p-3">
            <h3 className="mb-2 flex items-center gap-1.5 font-body text-label-md text-default">
              <Check className="h-4 w-4 text-success-600" aria-hidden="true" />
              Kept, exactly as it is
            </h3>
            <ul className="flex flex-col gap-1.5">
              {RETAINED.map((item) => (
                <li key={item} className="font-body text-body-sm text-muted">{item}</li>
              ))}
            </ul>
          </section>
        </div>

        <Checkbox
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
          label="I understand that the photograph will be permanently destroyed"
          description="My diagnosis, severity, triage reasons, doctor's comments, appointments and ratings are retained."
        />

        <Field
          label="Why are you deleting it?"
          hint="Recorded with your consent, so the deletion can be explained later."
          required
        >
          <Textarea
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. I no longer want this photo stored"
            maxLength={300}
          />
        </Field>

        <Field
          label={`Type ${CONFIRM_WORD} to confirm`}
          required
          error={confirmText && confirmText !== CONFIRM_WORD ? `Type ${CONFIRM_WORD} exactly.` : undefined}
        >
          <Input
            value={confirmText}
            onChange={(event) => setConfirmText(event.target.value)}
            placeholder={CONFIRM_WORD}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={undefined}
          />
        </Field>
      </div>
    </Modal>
  );
}

export default DeleteImageDialog;
