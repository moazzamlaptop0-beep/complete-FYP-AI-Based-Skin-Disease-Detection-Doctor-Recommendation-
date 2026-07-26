/**
 * DoctorSchedulePage — availability + fees.
 *
 *   GET  /api/doctor-availability/<id>   -> [{day, off, slots:[{start,end,break_name?,break_start?,break_end?}]}]
 *   POST /api/update-availability        {doctor_id, schedule, confirm_override?}
 *   GET  /api/doctor-fees/<id>           -> {pkr, usd, duration, buffer_time}
 *   POST /api/update-fees                {doctor_id, pkr, usd, duration, buffer_time}
 *
 * THREE BACKEND FACTS THIS PAGE IS BUILT AROUND
 * ---------------------------------------------
 * 1. `/api/update-availability` is the ONLY `success:false` response in the whole
 *    API that carries a `data` object. A 409 means "this change would orphan
 *    appointments that are already booked" and hands back the list of them plus
 *    `requires_confirmation: true`. Re-posting with `confirm_override: true` goes
 *    through. That is not an error to swallow — it is a decision, so it gets a
 *    dialog naming every affected patient.
 * 2. `/api/update-fees` compares the id with `int != int` against the raw JSON
 *    value, so a STRING id 403s. `Number(...)` here is load-bearing.
 * 3. The availability GET returns days in dict-insertion order, NOT Mon→Sun, and
 *    an off day comes back as `slots:[{start:'',end:''}]`. Both are handled in
 *    `weekFromAvailability` by looking days up by name rather than by index.
 *
 * RESPONSIVE
 * ----------
 * The old week grid was 880px wide with a hard min-width — unusable on a phone.
 * Here a `WeekCalendar` renders at md and up and a `DayAgenda` list below it;
 * both read the same state and open the same editor drawer. See ScheduleWeek.jsx.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Coffee,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  Wallet,
} from 'lucide-react';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Drawer,
  Field,
  IconButton,
  Input,
  Modal,
  Select,
  Skeleton,
  SkeletonGroup,
  Switch,
  notify,
} from '../../components/ui';
import { ApiError, get, post } from '../../lib/api';
import { schedule as scheduleEndpoints } from '../../lib/endpoints';
import { formatDate } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import PageHeader from './components/PageHeader';
import {
  DAYS,
  DayAgenda,
  WeekCalendar,
  dayMinutes,
  formatClock,
  toMinutes,
} from './components/ScheduleWeek';
import useDoctorQuery from './hooks/useDoctorQuery';

/* -------------------------------------------------------------------------- */
/* Shape conversion                                                           */
/* -------------------------------------------------------------------------- */

const DEFAULT_SHIFT = { start: '09:00', end: '17:00', break_name: '' };

/**
 * Availability payload -> the editor's week array.
 * Looks each day up BY NAME because the response order is not Mon→Sun and is
 * explicitly documented as unstable.
 */
export function weekFromAvailability(payload) {
  const rows = Array.isArray(payload) ? payload : [];
  return DAYS.map((name) => {
    const row = rows.find((entry) => String(entry?.day) === name) || null;
    const rawSlots = Array.isArray(row?.slots) ? row.slots : [];
    // An off day (and a day whose slots are all empty) comes back as a single
    // {start:'', end:''} placeholder — that is not a shift.
    const shifts = rawSlots
      .filter((slot) => slot && slot.start && slot.end)
      .map((slot) => ({
        start: String(slot.start).slice(0, 5),
        end: String(slot.end).slice(0, 5),
        break_name: slot.break_name || '',
      }));
    return {
      day: name,
      off: Boolean(row?.off) || (Boolean(row) && shifts.length === 0),
      shifts,
    };
  });
}

/** The editor's week array -> the `schedule` POST body. */
export function availabilityFromWeek(week) {
  return week.map((day) => ({
    day: day.day,
    off: Boolean(day.off),
    slots: day.off
      ? []
      : (day.shifts || [])
        .filter((shift) => shift.start && shift.end)
        .map((shift, index) => ({
          start: shift.start,
          end: shift.end,
          // The first shift of a day has no break in front of it; the backend
          // stores all three break columns as NULL for it.
          ...(index > 0 ? { break_name: shift.break_name || 'Break' } : {}),
        })),
  }));
}

/**
 * The same all-or-nothing check `validate_schedule_slots()` runs server-side,
 * repeated here purely so the doctor sees the problem next to the field rather
 * than as a 400 after a round trip. The server remains the authority.
 * @returns {string[]} human-readable problems
 */
export function validateWeek(week) {
  const problems = [];
  week.forEach((day) => {
    if (day.off) return;
    const shifts = (day.shifts || []).filter((shift) => shift.start && shift.end);
    shifts.forEach((shift) => {
      const start = toMinutes(shift.start);
      const end = toMinutes(shift.end);
      if (start === null || end === null) {
        problems.push(`${day.day}: a shift has an unreadable time.`);
      } else if (start >= end) {
        problems.push(`${day.day}: shift start (${shift.start}) must be before its end (${shift.end}).`);
      }
    });
    const sorted = [...shifts].sort((a, b) => (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0));
    for (let i = 1; i < sorted.length; i += 1) {
      const previousEnd = toMinutes(sorted[i - 1].end);
      const start = toMinutes(sorted[i].start);
      if (previousEnd !== null && start !== null && start < previousEnd) {
        problems.push(
          `${day.day}: shifts overlap — ${sorted[i - 1].start}-${sorted[i - 1].end} and ${sorted[i].start}-${sorted[i].end} clash.`,
        );
      }
    }
  });
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Day editor                                                                 */
/* -------------------------------------------------------------------------- */

function DayEditor({ open, day, onClose, onChange, onCopyToWeekdays }) {
  if (!day) return null;

  const setShift = (index, patch) => {
    onChange({
      ...day,
      shifts: day.shifts.map((shift, i) => (i === index ? { ...shift, ...patch } : shift)),
    });
  };

  const addShift = () => {
    const last = day.shifts[day.shifts.length - 1];
    const lastEnd = toMinutes(last?.end) ?? toMinutes(DEFAULT_SHIFT.start);
    // Start the new shift an hour after the previous one ends, so the gap is a
    // real, nameable break rather than a zero-length one the backend would drop.
    const start = Math.min((lastEnd ?? 540) + 60, 22 * 60 - 60);
    const asClock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    onChange({
      ...day,
      off: false,
      shifts: [
        ...day.shifts,
        { start: asClock(start), end: asClock(Math.min(start + 180, 23 * 60)), break_name: 'Break' },
      ],
    });
  };

  const removeShift = (index) => {
    const shifts = day.shifts.filter((_, i) => i !== index);
    // The first shift never carries a break name — if it was removed, the one
    // that inherits the position must lose its name too or the backend would
    // record a break that nothing bounds.
    if (shifts[0]) shifts[0] = { ...shifts[0], break_name: '' };
    onChange({ ...day, shifts });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      size="md"
      title={day.day}
      description="Add a second shift to create a break — the slot generator skips the gap between them."
      footer={<Button variant="primary" onClick={onClose} fullWidth>Done</Button>}
    >
      <div className="flex flex-col gap-5">
        <Switch
          checked={day.off}
          onChange={(event) => onChange({ ...day, off: event.target.checked })}
          label={`${day.day} is a day off`}
          description="No slots are generated and nothing can be booked."
        />

        {!day.off && (
          <>
            <ul className="flex flex-col gap-4">
              {day.shifts.map((shift, index) => (
                <li
                  key={index}
                  className="flex flex-col gap-3 rounded-card border border-subtle bg-surface-sunken p-3"
                >
                  {index > 0 && (
                    <Field
                      label="Break before this shift"
                      hint={`${formatClock(day.shifts[index - 1].end)} to ${formatClock(shift.start)}`}
                    >
                      <Input
                        value={shift.break_name || ''}
                        maxLength={40}
                        placeholder="Lunch"
                        leftIcon={<Coffee className="h-4 w-4" aria-hidden="true" />}
                        onChange={(event) => setShift(index, { break_name: event.target.value })}
                      />
                    </Field>
                  )}

                  <div className="flex items-end gap-2">
                    <Field label="From" className="flex-1">
                      <Input
                        type="time"
                        value={shift.start}
                        onChange={(event) => setShift(index, { start: event.target.value })}
                      />
                    </Field>
                    <Field label="To" className="flex-1">
                      <Input
                        type="time"
                        value={shift.end}
                        onChange={(event) => setShift(index, { end: event.target.value })}
                      />
                    </Field>
                    <IconButton
                      aria-label={`Remove shift ${index + 1}`}
                      variant="ghost"
                      onClick={() => removeShift(index)}
                      className="mb-1"
                    >
                      <Trash2 className="h-4 w-4 text-danger-600" aria-hidden="true" />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>

            <Button variant="outline" leftIcon={<Plus className="h-4 w-4" />} onClick={addShift}>
              {day.shifts.length ? 'Add another shift (creates a break)' : 'Add working hours'}
            </Button>

            <p className="text-caption text-muted">
              {dayMinutes(day) > 0
                ? `${Math.round(dayMinutes(day) / 6) / 10} bookable hours on ${day.day}.`
                : 'No bookable hours yet.'}
            </p>
          </>
        )}

        <div className="border-t border-subtle pt-4">
          <Button variant="ghost" size="sm" onClick={() => onCopyToWeekdays(day)}>
            Copy these hours to Monday–Friday
          </Button>
        </div>
      </div>
    </Drawer>
  );
}

/* -------------------------------------------------------------------------- */
/* Fees                                                                       */
/* -------------------------------------------------------------------------- */

const DURATIONS = [
  { value: '15min', label: '15 minutes' },
  { value: '20min', label: '20 minutes' },
  { value: '30min', label: '30 minutes' },
  { value: '45min', label: '45 minutes' },
  { value: '60min', label: '60 minutes' },
];

function FeesCard({ doctorId }) {
  const fetcher = useCallback(
    (signal) => get(scheduleEndpoints.fees(doctorId), { signal }),
    [doctorId],
  );
  const { data, loading, error, refresh } = useDoctorQuery(fetcher, { enabled: Boolean(doctorId) });

  const [form, setForm] = useState({ pkr: '', usd: '', duration: '30min', buffer_time: '0' });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  useEffect(() => {
    if (!data) return;
    setForm({
      pkr: String(data.pkr ?? 0),
      usd: String(data.usd ?? 0),
      duration: data.duration || '30min',
      buffer_time: String(data.buffer_time ?? 0),
    });
  }, [data]);

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await post(scheduleEndpoints.updateFees(), {
        // `int != int` on the backend: a string id 403s. Never send `user.id` raw.
        doctor_id: Number(doctorId),
        pkr: Number(form.pkr) || 0,
        usd: Number(form.usd) || 0,
        duration: form.duration,
        buffer_time: Number(form.buffer_time) || 0,
      });
      notify.success('Fees and appointment length saved.');
      await refresh();
    } catch (caught) {
      setSaveError(caught);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader
        title={(
          <span className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary-700" aria-hidden="true" />
            Consultation fees
          </span>
        )}
        titleAs="h2"
        description="Shown to patients before they book. The length and gap decide how many slots a day holds."
        divider
      />
      <CardBody className="flex flex-col gap-4">
        {error && (
          <Alert tone="warning" title="Could not load your current fees">
            You can still enter new values and save them.
          </Alert>
        )}
        {saveError && (
          <Alert tone="danger" title="Fees not saved" onDismiss={() => setSaveError(null)}>
            {saveError.message || 'Nothing was changed.'}
          </Alert>
        )}

        {loading ? (
          <SkeletonGroup label="Loading fees">
            <Skeleton shape="rect" height={72} />
            <Skeleton shape="rect" height={72} />
          </SkeletonGroup>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Fee (PKR)">
                <Input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={form.pkr}
                  onChange={(event) => setForm((f) => ({ ...f, pkr: event.target.value }))}
                />
              </Field>
              <Field label="Fee (USD)">
                <Input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={form.usd}
                  onChange={(event) => setForm((f) => ({ ...f, usd: event.target.value }))}
                />
              </Field>
              <Field label="Appointment length" hint="Each generated slot is this long.">
                <Select
                  options={DURATIONS}
                  value={form.duration}
                  onChange={(event) => setForm((f) => ({ ...f, duration: event.target.value }))}
                />
              </Field>
              <Field label="Gap between appointments (minutes)" hint="Added after every slot.">
                <Input
                  type="number"
                  min="0"
                  max="120"
                  inputMode="numeric"
                  value={form.buffer_time}
                  onChange={(event) => setForm((f) => ({ ...f, buffer_time: event.target.value }))}
                />
              </Field>
            </div>

            <div>
              <Button
                variant="primary"
                leftIcon={<Save className="h-4 w-4" />}
                loading={saving}
                loadingText="Saving"
                onClick={save}
              >
                Save fees
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function DoctorSchedulePage() {
  const { user } = useAuth();
  const doctorId = user?.id;

  const fetcher = useCallback(
    (signal) => get(scheduleEndpoints.availability(doctorId), { signal }),
    [doctorId],
  );
  const { data, loading, error, refreshing, refresh } = useDoctorQuery(fetcher, {
    enabled: Boolean(doctorId),
  });

  const [week, setWeek] = useState(() => weekFromAvailability(null));
  const [dirty, setDirty] = useState(false);
  const [editingDay, setEditingDay] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [conflicts, setConflicts] = useState(null);

  useEffect(() => {
    if (data === null || data === undefined) return;
    setWeek(weekFromAvailability(data));
    setDirty(false);
  }, [data]);

  const problems = useMemo(() => validateWeek(week), [week]);
  const editing = editingDay ? week.find((day) => day.day === editingDay) || null : null;

  const updateDay = (next) => {
    setWeek((previous) => previous.map((day) => (day.day === next.day ? next : day)));
    setDirty(true);
  };

  const copyToWeekdays = (source) => {
    setWeek((previous) => previous.map((day) => (
      DAYS.indexOf(day.day) < 5
        ? { ...day, off: source.off, shifts: source.shifts.map((shift) => ({ ...shift })) }
        : day
    )));
    setDirty(true);
    notify.success('Copied to Monday–Friday. Nothing is saved until you press Save.');
  };

  const save = useCallback(async (confirmOverride = false) => {
    setSaving(true);
    setSaveError(null);
    try {
      await post(scheduleEndpoints.updateAvailability(), {
        doctor_id: Number(doctorId),
        schedule: availabilityFromWeek(week),
        ...(confirmOverride ? { confirm_override: true } : {}),
      });
      notify.success('Availability saved.');
      setConflicts(null);
      setDirty(false);
      await refresh();
    } catch (caught) {
      // THE ONE success:false-with-data response in the API. A 409 here is a
      // question, not a failure: "these already-booked appointments would be
      // orphaned — still want to?"
      const payloadData = caught instanceof ApiError ? caught.data : null;
      if (caught instanceof ApiError && caught.status === 409 && payloadData?.requires_confirmation) {
        setConflicts({
          message: caught.message,
          rows: Array.isArray(payloadData.conflicts) ? payloadData.conflicts : [],
        });
      } else {
        setSaveError(caught);
      }
    } finally {
      setSaving(false);
    }
  }, [doctorId, week, refresh]);

  return (
    <>
      <PageHeader
        title="Schedule & fees"
        description="The hours you work decide which slots patients can book. Nothing is saved until you press Save."
        meta={dirty ? <Badge tone="warning" variant="soft">Unsaved changes</Badge> : null}
        actions={(
          <>
            <Button
              variant="ghost"
              leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
              loading={refreshing}
              onClick={() => refresh()}
              disabled={saving}
            >
              Discard & reload
            </Button>
            <Button
              variant="primary"
              leftIcon={<Save className="h-4 w-4" />}
              loading={saving}
              loadingText="Saving"
              disabled={!dirty || problems.length > 0}
              onClick={() => save(false)}
            >
              Save availability
            </Button>
          </>
        )}
      />

      {error && (
        <Alert
          tone="danger"
          title="Could not load your availability"
          className="mb-6"
          actions={<Button size="sm" variant="outline" onClick={() => refresh()}>Try again</Button>}
        >
          {error.message || 'The week could not be loaded. Saving now would overwrite it, so fix this first.'}
        </Alert>
      )}

      {saveError && (
        <Alert
          tone="danger"
          title="Availability not saved"
          className="mb-6"
          onDismiss={() => setSaveError(null)}
        >
          {saveError.message || 'Nothing was changed.'}
        </Alert>
      )}

      {problems.length > 0 && (
        <Alert
          tone="warning"
          title="Fix these before saving"
          className="mb-6"
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
        >
          <ul className="list-disc space-y-1 pl-4">
            {problems.map((problem) => <li key={problem}>{problem}</li>)}
          </ul>
        </Alert>
      )}

      <div className="flex flex-col gap-6">
        <Card padding="none">
          <CardHeader
            title={(
              <span className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-primary-700" aria-hidden="true" />
                Your working week
              </span>
            )}
            titleAs="h2"
          />
          <CardBody>
            {loading ? (
              <SkeletonGroup label="Loading your week">
                <Skeleton shape="rect" height={288} />
              </SkeletonGroup>
            ) : (
              <>
                {/* The whole responsive fix: a calendar where seven columns fit,
                    a list where they do not. One state, two renderings. */}
                <div className="hidden md:block">
                  <WeekCalendar week={week} onEditDay={setEditingDay} />
                </div>
                <div className="md:hidden">
                  <DayAgenda week={week} onEditDay={setEditingDay} />
                </div>
              </>
            )}
          </CardBody>
        </Card>

        <FeesCard doctorId={doctorId} />
      </div>

      <DayEditor
        open={Boolean(editing)}
        day={editing}
        onClose={() => setEditingDay(null)}
        onChange={updateDay}
        onCopyToWeekdays={copyToWeekdays}
      />

      {/* ------------------------------------------------ orphan conflicts -- */}
      <Modal
        open={Boolean(conflicts)}
        onClose={() => (saving ? undefined : setConflicts(null))}
        title="This would leave booked appointments without matching hours"
        size="md"
        footer={(
          <>
            <Button variant="ghost" onClick={() => setConflicts(null)} disabled={saving}>
              Go back and adjust
            </Button>
            <Button
              variant="danger"
              loading={saving}
              loadingText="Saving"
              onClick={() => save(true)}
            >
              Save anyway
            </Button>
          </>
        )}
      >
        <div className="flex flex-col gap-3">
          <p className="text-body-sm text-muted">
            {conflicts?.message
              || 'These appointments are already booked in hours you are about to remove.'}
            {' '}
            Saving anyway does not cancel them — they simply sit outside your published availability,
            and you will need to contact the patients yourself.
          </p>

          <ul className="flex flex-col gap-2">
            {(conflicts?.rows || []).map((row) => (
              <li
                key={row.appointment_id}
                className="flex flex-wrap items-center gap-2 rounded-field border border-subtle bg-surface-sunken px-3 py-2"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-label-md text-default">
                    {row.patient_name || 'Unknown patient'}
                  </span>
                  <span className="block text-caption text-muted">
                    {formatDate(row.date)} at {row.time} · #{row.appointment_id}
                  </span>
                </span>
                <Badge tone="neutral" variant="outline" size="sm">{row.status}</Badge>
              </li>
            ))}
          </ul>
        </div>
      </Modal>
    </>
  );
}
