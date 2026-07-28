/**
 * BookAppointmentDrawer — an admin books a slot on a patient's behalf.
 *
 * NO NEW ENDPOINT WAS NEEDED, AND THAT IS THE INTERESTING PART
 * -----------------------------------------------------------
 * `POST /api/book-slot` has always taken `patient_id` in the body and authorised
 * it with `resolve_actor(patient_id, own_perm=APPOINTMENT_BOOK,
 * any_perm=APPOINTMENT_MANAGE_ANY)`. An admin holds `appointment.manage.any`, so
 * the capability was already there — it simply had no door in the console. This
 * is the door, and it uses the same route, the same slot canonicalisation and the
 * same double-booking index as a patient booking their own appointment.
 *
 * The one thing that changed server-side is accountability: a booking whose actor
 * is not the patient now writes an `appointment.book.on_behalf` audit row, so the
 * appointment that appears in someone's history has an author.
 *
 * WHY NOT "ACT AS THE PATIENT AND BOOK"?
 * -------------------------------------
 * That works and is still available — but it is the wrong tool for a phone
 * booking. Impersonation makes the whole session the patient's (the admin console
 * goes dark, every request is logged as a delegation) to do one insert. This form
 * stays in the console, keeps the admin's own identity, and produces exactly one
 * audit row.
 *
 * THREE FACTS, ONE SCREEN, IN DEPENDENCY ORDER
 * -------------------------------------------
 * Patient, then doctor, then time — because the slot grid cannot be drawn until a
 * doctor is chosen. It is not a wizard: an admin taking a booking over the phone
 * already knows all three and stepping them would just add clicks. The later
 * sections simply stay inert, with a line saying what they are waiting for.
 *
 * ONLY APPROVED DOCTORS ARE OFFERED. A doctor whose licence is pending or
 * rejected cannot take a patient, and `/api/slots/<id>` would answer with an
 * empty grid rather than an explanation.
 */

import React, { useMemo, useState } from 'react';
import { CalendarPlus, Check, Search, Stethoscope, UserSearch } from 'lucide-react';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Drawer,
  EmptyState,
  SearchInput,
  Skeleton,
  cn,
  notify,
} from '../../../components/ui';
import { post } from '../../../lib/api';
import { admin as adminEndpoints, appointments as appointmentEndpoints } from '../../../lib/endpoints';
import SlotPicker from '../../patient/components/SlotPicker';
import { usePaginatedQuery } from '../hooks/usePaginatedQuery';

/** A numbered section with a "waiting for X" state instead of a hidden one. */
function Step({ index, title, hint, locked, lockedHint, children }) {
  return (
    <section className={cn('flex flex-col gap-3', locked && 'opacity-60')}>
      <header className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="grid h-6 w-6 shrink-0 place-items-center rounded-full border border-subtle bg-surface text-caption tabular-nums text-muted"
        >
          {index}
        </span>
        <div className="min-w-0">
          <h3 className="text-label-lg text-default">{title}</h3>
          {hint ? <p className="text-caption text-muted">{hint}</p> : null}
        </div>
      </header>
      <div className="pl-[2.125rem]">
        {locked
          ? <p className="text-body-sm text-muted">{lockedHint}</p>
          : children}
      </div>
    </section>
  );
}

/** The chosen person, with a way back. */
function Chosen({ row, sub, badge, onClear }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-primary-300 bg-primary-50/60 p-3">
      <Avatar name={row.name || row.email} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-medium text-default">
            {row.name || 'Unnamed'}
          </span>
          {badge}
        </p>
        <p className="truncate text-caption text-muted">{sub || row.email}</p>
      </div>
      <Button size="sm" variant="ghost" onClick={onClear}>Change</Button>
    </div>
  );
}

/** One selectable row in a picker list. */
function PickRow({ row, primary, secondary, trailing, onPick }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onPick(row)}
        className={cn(
          'flex w-full items-center gap-3 rounded-lg border border-subtle bg-surface p-2.5 text-left transition',
          'hover:border-primary-400 hover:bg-primary-50/50',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
        )}
      >
        <Avatar name={primary || row.email} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-default">
            {primary || 'Unnamed'}
          </span>
          <span className="block truncate text-caption text-muted">{secondary}</span>
        </span>
        {trailing}
      </button>
    </li>
  );
}

/** Shared loading / error / empty / list rendering for both pickers. */
function PickList({ query, children, emptyTitle, emptyDescription }) {
  if (query.error) {
    return (
      <Alert
        tone="danger"
        title="Could not load the list"
        actions={<Button size="sm" variant="outline" onClick={query.refetch}>Try again</Button>}
      >
        {query.error.message}
      </Alert>
    );
  }
  if (query.loading) {
    return (
      <div className="flex flex-col gap-2" aria-busy="true">
        {[0, 1, 2].map((i) => <Skeleton key={i} shape="rect" height={56} />)}
      </div>
    );
  }
  if (!children.length) {
    return (
      <EmptyState
        icon={<Search className="h-6 w-6" aria-hidden="true" />}
        title={emptyTitle}
        description={emptyDescription}
        size="sm"
      />
    );
  }
  return <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">{children}</ul>;
}

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {() => void} [props.onBooked] Refetch the appointments table.
 * @param {object} [props.patient] Pre-selected patient (opened from a patient row).
 * @param {object} [props.doctor] Pre-selected doctor (opened from a doctor row).
 */
export default function BookAppointmentDrawer({
  open,
  onClose,
  onBooked,
  patient: initialPatient,
  doctor: initialDoctor,
}) {
  const [patient, setPatient] = useState(initialPatient || null);
  const [doctor, setDoctor] = useState(initialDoctor || null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [patientTerm, setPatientTerm] = useState('');
  const [doctorTerm, setDoctorTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // Re-seed on each open so a drawer reopened from a different row does not
  // inherit the previous booking half-filled.
  const initialPatientId = initialPatient?.id;
  const initialDoctorId = initialDoctor?.id;
  React.useEffect(() => {
    if (!open) return;
    setPatient(initialPatient || null);
    setDoctor(initialDoctor || null);
    setDate('');
    setTime('');
    setPatientTerm('');
    setDoctorTerm('');
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPatientId, initialDoctorId]);

  const patientQuery = usePaginatedQuery({
    path: adminEndpoints.patients,
    filters: useMemo(() => ({ q: patientTerm, is_active: 'true' }), [patientTerm]),
    perPage: 8,
    enabled: open && !patient,
  });

  // `/admin/doctors` is one of the frozen 39: it takes only `?status` and answers
  // a BARE ARRAY of every match, so the search here is client-side. Same reason
  // DoctorsPage filters locally.
  const doctorQuery = usePaginatedQuery({
    path: adminEndpoints.doctors,
    filters: useMemo(() => ({ status: 'approved' }), []),
    paginate: false,
    enabled: open && !doctor,
  });

  const doctorMatches = useMemo(() => {
    const needle = doctorTerm.trim().toLowerCase();
    const rows = doctorQuery.items;
    if (!needle) return rows.slice(0, 25);
    return rows
      .filter((row) => [row.name, row.email, row.specialty, row.hospital, row.city]
        .some((value) => String(value || '').toLowerCase().includes(needle)))
      .slice(0, 25);
  }, [doctorQuery.items, doctorTerm]);

  const ready = Boolean(patient && doctor && date && time);

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      // slot_date / slot_time — NOT date / time. The endpoint reads those exact
      // keys and answers "Missing required fields for booking." otherwise.
      const result = await post(appointmentEndpoints.bookSlot(), {
        patient_id: patient.id,
        doctor_id: doctor.id,
        slot_date: date,
        slot_time: time,
      });

      // Three success shapes; only the urgent-override one carries `data`.
      if (result?.status === 'Pending-Conflict') {
        notify.warning(
          'That slot was already taken. Because this patient is flagged urgent, both bookings are '
          + 'now Pending-Conflict and the doctor has been asked to choose.',
        );
      } else {
        notify.success(`Booked ${patient.name || 'the patient'} with ${doctor.name} on ${date} at ${time}.`);
      }
      onBooked?.();
      onClose();
    } catch (err) {
      // 400 "This slot is already booked." is the common one — the grid was drawn
      // before somebody else took it. Keep the drawer open with the choice made
      // so the admin only has to pick another time.
      setError(err?.message || 'The appointment could not be booked.');
      setTime('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      size="lg"
      title="Book an appointment"
      description="For a patient who called in. It is a real booking on their record, made under your name."
    >
      <div className="flex flex-col gap-6">
        {error ? (
          <Alert tone="danger" title="Could not book">{error}</Alert>
        ) : null}

        <Step
          index={1}
          title="Patient"
          hint="Only active accounts are listed. Reactivate a suspended one first."
        >
          {patient ? (
            // Only the patient is cleared: the slot grid depends on the DOCTOR
            // and the date, not on who is being booked into it, so wiping those
            // too would make correcting a mis-picked patient cost three clicks.
            <Chosen row={patient} sub={patient.email} onClear={() => setPatient(null)} />
          ) : (
            <div className="flex flex-col gap-3">
              <SearchInput
                placeholder="Search patients by name or email"
                onDebouncedChange={setPatientTerm}
                loading={patientQuery.loading || patientQuery.refreshing}
                aria-label="Search patients"
              />
              <PickList
                query={patientQuery}
                emptyTitle="No patient matches"
                emptyDescription="Try part of a name or email. You can also add the account first from Patients & accounts."
              >
                {patientQuery.items.map((row) => (
                  <PickRow
                    key={row.id}
                    row={row}
                    primary={row.name}
                    secondary={row.email}
                    trailing={(
                      <span className="shrink-0 text-caption tabular-nums text-muted">
                        {row.appointment_count ?? 0} prev
                      </span>
                    )}
                    onPick={setPatient}
                  />
                ))}
              </PickList>
            </div>
          )}
        </Step>

        {/* Steps 1 and 2 are INDEPENDENT — the slot grid depends on the doctor
            and the date, not on the patient — so neither locks the other. Only
            step 3 waits, and it waits on the doctor. */}
        <Step
          index={2}
          title="Doctor"
          hint="Only approved doctors. A pending licence cannot take patients."
        >
          {doctor ? (
            <Chosen
              row={doctor}
              sub={[doctor.specialty, doctor.hospital, doctor.city].filter(Boolean).join(' · ') || doctor.email}
              badge={<Badge tone="success" size="sm">Approved</Badge>}
              onClear={() => { setDoctor(null); setDate(''); setTime(''); }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <SearchInput
                placeholder="Search doctors by name, specialty or city"
                onDebouncedChange={setDoctorTerm}
                loading={doctorQuery.loading || doctorQuery.refreshing}
                aria-label="Search doctors"
              />
              <PickList
                query={doctorQuery}
                emptyTitle={doctorTerm ? 'No approved doctor matches' : 'No approved doctors yet'}
                emptyDescription={doctorTerm
                  ? 'Try a specialty or a city. Doctors awaiting verification are not listed.'
                  : 'Approve a licence on the Doctors page and they will appear here.'}
              >
                {doctorMatches.map((row) => (
                  <PickRow
                    key={row.id}
                    row={row}
                    primary={row.name}
                    secondary={[row.specialty, row.hospital, row.city].filter(Boolean).join(' · ') || row.email}
                    trailing={<Stethoscope className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />}
                    onPick={setDoctor}
                  />
                ))}
              </PickList>
            </div>
          )}
        </Step>

        <Step
          index={3}
          title="Date and time"
          hint="Times come from that doctor's published hours. Taken slots are shown struck through, not hidden."
          locked={!doctor}
          lockedHint="Pick a doctor first."
        >
          {doctor ? (
            <SlotPicker
              doctorId={doctor.id}
              date={date}
              onDateChange={setDate}
              time={time}
              onTimeChange={setTime}
              dateLabel="Appointment date"
            />
          ) : null}
        </Step>

        <div className="flex flex-col gap-3 border-t border-subtle pt-4">
          {ready ? (
            <p className="flex items-start gap-2 text-body-sm text-default">
              <Check className="mt-0.5 h-4 w-4 shrink-0 text-success-600" aria-hidden="true" />
              <span>
                <strong>{patient.name}</strong> with <strong>{doctor.name}</strong> on {date} at {time}.
                They both get an appointment they did not create themselves, so it is written to the
                audit log against you.
              </span>
            </p>
          ) : (
            <p className="flex items-start gap-2 text-body-sm text-muted">
              <UserSearch className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Choose a patient, a doctor and a free time to enable booking.
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
            <Button
              variant="primary"
              onClick={submit}
              disabled={!ready}
              loading={busy}
              leftIcon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />}
            >
              Book appointment
            </Button>
          </div>
        </div>
      </div>
    </Drawer>
  );
}

export { BookAppointmentDrawer };
