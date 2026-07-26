/**
 * SlotBookingDialog — the ONE dialog behind both "reschedule" and "re-book".
 *
 * The two flows differ in exactly one way that matters to the user, and the
 * copy carries it:
 *
 *   RESCHEDULE  POST /api/patient-appointments/<id>/reschedule
 *               The old row becomes 'Cancelled — Rescheduled by the patient.'
 *               and a NEW row is inserted. You are MOVING one visit.
 *
 *   REBOOK      POST /api/appointments/<id>/rebook
 *               The source row is READ ONLY. A NEW appointment is created with
 *               the SAME doctor and the SAME scan, `rebooked_from_id` pointing
 *               back. You are booking a FOLLOW-UP off an old record — the
 *               "re-appointment old records" requirement — and the history keeps
 *               showing what actually happened.
 *
 * BOTH RETURN A NEW `id`. Neither response may be patched into the row that was
 * clicked: doing that renders one visit twice (once as the stale source, once as
 * the new booking). `onDone` therefore triggers a full refetch, and this dialog
 * never touches the caller's list.
 *
 * 409 is the interesting failure on both: somebody took the slot between the
 * picker rendering and Confirm being pressed. It is surfaced in place, with the
 * picker still open, because the fix is "choose another time" and not "start
 * again".
 */

import React, { useEffect, useState } from 'react';
import { CalendarCheck, Repeat } from 'lucide-react';

import {
  Alert,
  Button,
  Field,
  Modal,
  ModalFooter,
  Textarea,
  notify,
} from '../../../components/ui';
import { ApiError, post } from '../../../lib/api';
import { appointments as appointmentEndpoints } from '../../../lib/endpoints';

import SlotPicker from './SlotPicker';
import { formatDateTime, todayIso } from '../lib/format';

const MODES = {
  reschedule: {
    title: 'Move this appointment',
    description:
      'Your current time is released and a new appointment is created with the same doctor.',
    confirmLabel: 'Move appointment',
    icon: Repeat,
    endpoint: appointmentEndpoints.patientReschedule,
    success: 'Your appointment has been moved.',
    notePlaceholder: 'Anything your doctor should know about the change?',
    noteLabel: 'Note for your doctor (optional)',
  },
  rebook: {
    title: 'Book again with this doctor',
    description:
      'A new appointment is created with the same doctor and the same scan. The visit you are booking from stays in your history exactly as it is.',
    confirmLabel: 'Book appointment',
    icon: CalendarCheck,
    endpoint: appointmentEndpoints.rebook,
    success: 'Your new appointment has been booked.',
    notePlaceholder: 'e.g. follow-up on the same patch, it has not cleared up',
    noteLabel: 'Why are you booking again? (optional)',
  },
};

/**
 * @param {object} props
 * @param {'reschedule'|'rebook'} props.mode
 * @param {object|null} props.appointment A `/api/patient-appointments/<id>` row.
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {() => void} props.onDone Refetch the list — the response is a NEW id.
 */
export function SlotBookingDialog({ mode = 'rebook', appointment, open, onClose, onDone }) {
  const config = MODES[mode] || MODES.rebook;

  const [date, setDate] = useState(todayIso(1));
  const [time, setTime] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setDate(todayIso(1));
    setTime('');
    // Pre-fill the note with the context the requirement asked for, so a
    // re-appointment off an old record arrives at the doctor already explained.
    setNote(
      mode === 'rebook' && appointment?.disease
        ? `Follow-up on my previous visit for ${appointment.disease}.`
        : '',
    );
    setError(null);
    setBusy(false);
  }, [open, mode, appointment?.id, appointment?.disease]);

  if (!appointment) return null;

  const submit = async () => {
    if (!time || !date) return;
    setBusy(true);
    setError(null);
    try {
      const result = await post(config.endpoint(appointment.id), {
        slot_date: date,
        slot_time: time,
        note: note.trim() || undefined,
      });
      notify.success(config.success);
      onClose?.();
      // The list must be refetched, never patched: `result.id` is a NEW row and
      // the source row has changed state underneath us.
      onDone?.(result);
    } catch (err) {
      const conflict = err instanceof ApiError && err.status === 409;
      setError(
        conflict
          ? 'Someone booked that time while you were choosing. Pick another one — nothing has changed yet.'
          : (err?.message || 'That booking could not be made.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const Icon = config.icon;

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      size="lg"
      title={config.title}
      description={config.description}
      footer={
        <ModalFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            leftIcon={<Icon className="h-4 w-4" />}
            onClick={submit}
            loading={busy}
            loadingText="Booking"
            disabled={!time}
          >
            {config.confirmLabel}
          </Button>
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-5">
        {error && <Alert tone="danger" title="That did not go through">{error}</Alert>}

        <dl className="rounded-card border border-subtle bg-surface-sunken p-3">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="font-body text-body-sm text-muted">Doctor</dt>
            <dd className="font-body text-body-sm text-default">{appointment.doctor_name || 'Your doctor'}</dd>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between gap-3">
            <dt className="font-body text-body-sm text-muted">
              {mode === 'rebook' ? 'Previous visit' : 'Current time'}
            </dt>
            <dd className="font-numeric text-body-sm tabular-nums text-default">
              {formatDateTime(`${appointment.slot_date || appointment.date} ${appointment.slot_time || appointment.time || ''}`.trim())}
            </dd>
          </div>
          {appointment.scan_id && (
            <div className="mt-1.5 flex items-baseline justify-between gap-3">
              <dt className="font-body text-body-sm text-muted">Scan</dt>
              <dd className="font-body text-body-sm text-default">
                {appointment.disease || `#${appointment.scan_id}`}
                {mode === 'rebook' && <span className="text-muted"> (carried over)</span>}
              </dd>
            </div>
          )}
        </dl>

        <SlotPicker
          doctorId={appointment.doctor_id}
          date={date}
          onDateChange={setDate}
          time={time}
          onTimeChange={setTime}
          dateLabel="New date"
        />

        <Field label={config.noteLabel}>
          <Textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={config.notePlaceholder}
            maxLength={400}
          />
        </Field>
      </div>
    </Modal>
  );
}

export default SlotBookingDialog;
