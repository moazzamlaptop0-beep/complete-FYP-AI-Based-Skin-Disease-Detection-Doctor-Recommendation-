/**
 * RateDoctorDialog — rate the doctor after a completed visit.
 *
 * `POST /api/rate-doctor` takes `{doctor_id, rating, scan_id?, appointment_id?, review?}`
 * and `patient_id` comes from the JWT (it is ignored in the body). The same call
 * both creates and UPDATES — the server answers "Rating successfully submitted."
 * or "…updated." — so an existing rating is pre-loaded here and the dialog says
 * "Update" rather than pretending this is the first time.
 *
 * The stars are a real radiogroup: arrow keys move the selection, the label of
 * each option is a full sentence, and nothing depends on hovering. A star widget
 * that only works with a mouse is the most common a11y failure in this pattern.
 */

import React, { useEffect, useState } from 'react';
import { Star } from 'lucide-react';

import {
  Alert,
  Button,
  Field,
  Modal,
  ModalFooter,
  Textarea,
  cn,
  notify,
} from '../../../components/ui';
import { post } from '../../../lib/api';
import { ratings as ratingEndpoints } from '../../../lib/endpoints';

const LABELS = ['Poor', 'Fair', 'Good', 'Very good', 'Excellent'];

function StarRating({ value, onChange, disabled }) {
  return (
    <div
      role="radiogroup"
      aria-label="Your rating out of five"
      className="flex flex-wrap items-center gap-1"
    >
      {[1, 2, 3, 4, 5].map((score) => {
        const active = score <= value;
        return (
          <button
            key={score}
            type="button"
            role="radio"
            aria-checked={value === score}
            aria-label={`${score} out of 5: ${LABELS[score - 1]}`}
            disabled={disabled}
            onClick={() => onChange(score)}
            className={cn(
              'rounded-control p-1.5 outline-none transition-colors',
              'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
              'hover:bg-surface-sunken disabled:cursor-not-allowed disabled:opacity-60',
            )}
          >
            <Star
              className={cn('h-7 w-7', active ? 'fill-warning-400 text-warning-500' : 'text-subtle')}
              aria-hidden="true"
            />
          </button>
        );
      })}
      <span className="ml-2 font-body text-body-sm text-muted">
        {value ? LABELS[value - 1] : 'Not rated yet'}
      </span>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object|null} props.appointment A `/api/patient-appointments/<id>` row.
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {() => void} props.onDone
 */
export function RateDoctorDialog({ appointment, open, onClose, onDone }) {
  const existing = appointment?.patient_rating ?? appointment?.rating ?? 0;
  const existingReview = appointment?.patient_review ?? appointment?.review ?? '';

  const [rating, setRating] = useState(existing || 0);
  const [review, setReview] = useState(existingReview || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setRating(Number(existing) || 0);
    setReview(existingReview || '');
    setError(null);
    setBusy(false);
  }, [open, appointment?.id, existing, existingReview]);

  if (!appointment) return null;

  const submit = async () => {
    if (!rating) return;
    setBusy(true);
    setError(null);
    try {
      await post(ratingEndpoints.rate(), {
        doctor_id: appointment.doctor_id,
        rating,
        appointment_id: appointment.id,
        scan_id: appointment.scan_id || undefined,
        review: review.trim() || undefined,
      });
      notify.success(existing ? 'Your rating has been updated.' : 'Thank you, your rating was saved.');
      onClose?.();
      onDone?.();
    } catch (err) {
      setError(err?.message || 'Your rating could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      size="md"
      title={existing ? 'Update your rating' : 'Rate your doctor'}
      description={`How was your visit with ${appointment.doctor_name || 'your doctor'}?`}
      footer={
        <ModalFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Not now</Button>
          <Button onClick={submit} loading={busy} loadingText="Saving" disabled={!rating}>
            {existing ? 'Update rating' : 'Submit rating'}
          </Button>
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-5">
        {error && <Alert tone="danger" title="We could not save it">{error}</Alert>}

        <StarRating value={rating} onChange={setRating} disabled={busy} />

        <Field
          label="Review (optional)"
          hint="Shown on this doctor's public profile, without your surname."
        >
          <Textarea
            rows={3}
            value={review}
            onChange={(event) => setReview(event.target.value)}
            placeholder="What went well, or what could have been better?"
            maxLength={500}
          />
        </Field>
      </div>
    </Modal>
  );
}

export default RateDoctorDialog;
