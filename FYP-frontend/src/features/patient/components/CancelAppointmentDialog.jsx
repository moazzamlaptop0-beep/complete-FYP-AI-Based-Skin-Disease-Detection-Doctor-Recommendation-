/**
 * CancelAppointmentDialog — the patient cancels their own visit.
 *
 * THIS IS NEW BEHAVIOUR, NOT A RESKIN. Before `POST
 * /api/patient-appointments/<id>/cancel` existed, a patient was STRUCTURALLY
 * unable to cancel: both mutation routes checked `doctor_id`, so the only way
 * out of a booking you could not attend was to not turn up. That is why the
 * button exists at all, and why the reason field is offered rather than demanded
 * — a barrier here recreates the no-show.
 *
 * THE CONFLICT RELEASE
 * --------------------
 * Cancelling one half of a Pending-Conflict pair RELEASES the other: the
 * survivor goes back to 'Scheduled' and the response carries
 * `conflict_released_appointment_id`. When that comes back we say so, because
 * from the patient's side it looks like an unrelated appointment silently
 * changed state.
 */

import React, { useEffect, useState } from 'react';
import { CalendarX2 } from 'lucide-react';

import {
  Alert,
  Button,
  Field,
  Modal,
  ModalFooter,
  Textarea,
  notify,
} from '../../../components/ui';
import { post } from '../../../lib/api';
import { appointments as appointmentEndpoints } from '../../../lib/endpoints';

import { formatDateTime } from '../lib/format';

export function CancelAppointmentDialog({ appointment, open, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setReason('');
    setError(null);
    setBusy(false);
  }, [open, appointment?.id]);

  if (!appointment) return null;

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await post(appointmentEndpoints.patientCancel(appointment.id), {
        reason: reason.trim() || undefined,
      });
      const released = result?.conflict_released_appointment_id;
      notify.success(
        released
          ? 'Appointment cancelled. Your other booking for that slot is confirmed again.'
          : 'Appointment cancelled.',
      );
      onClose?.();
      onDone?.(result);
    } catch (err) {
      // 400 covers "already Cancelled" and "a completed appointment cannot be
      // cancelled" — both are readable as-is from the server.
      setError(err?.message || 'That appointment could not be cancelled.');
    } finally {
      setBusy(false);
    }
  };

  const when = formatDateTime(
    `${appointment.slot_date || appointment.date || ''} ${appointment.slot_time || appointment.time || ''}`.trim(),
  );

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      size="md"
      title="Cancel this appointment"
      description={`${appointment.doctor_name || 'Your doctor'} · ${when}`}
      footer={
        <ModalFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Keep it</Button>
          <Button
            variant="danger"
            leftIcon={<CalendarX2 className="h-4 w-4" />}
            onClick={submit}
            loading={busy}
            loadingText="Cancelling"
          >
            Cancel appointment
          </Button>
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-4">
        {error && <Alert tone="danger" title="We could not cancel it">{error}</Alert>}

        <p className="font-body text-body-sm text-muted">
          Your doctor is told straight away and the slot is freed for someone else. Your scan, its
          diagnosis and this appointment&apos;s record all stay in your history.
        </p>

        <Field
          label="Reason (optional)"
          hint="Shared with your doctor. Helpful, but never required to cancel."
        >
          <Textarea
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. I am unwell and cannot travel"
            maxLength={300}
          />
        </Field>
      </div>
    </Modal>
  );
}

export default CancelAppointmentDialog;
