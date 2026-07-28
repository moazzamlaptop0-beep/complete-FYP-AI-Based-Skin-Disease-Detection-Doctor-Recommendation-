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
 *    through. That is not an error to swallow: it is a decision, so it gets a
 *    dialog naming every affected patient.
 * 2. `/api/update-fees` compares the id with `int != int` against the raw JSON
 *    value, so a STRING id 403s. `Number(...)` here is load-bearing.
 * 3. The availability GET returns days in dict-insertion order, NOT Mon→Sun, and
 *    an off day comes back as `slots:[{start:'',end:''}]`. Both are handled in
 *    `weekFromAvailability` by looking days up by name rather than by index.
 *
 * HOW THE EDITOR THINKS vs HOW THE BACKEND STORES
 * -----------------------------------------------
 * The backend stores SHIFTS, and a break is literally the gap between two
 * shifts (see ScheduleWeek.jsx). Doctors do not think in shifts: they think
 * "I work 9 to 5 with lunch at 1". So the day editor speaks that language,
 * working hours plus a list of named breaks, and `dayFromEditor` /
 * `editorFromDay` translate losslessly to and from the shifts model.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Clock,
  Coffee,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
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
  cn,
  notify,
} from '../../components/ui';
import { ApiError, get, post } from '../../lib/api';
import { describeRate, getPkrPerUsd, pkrToUsd } from '../../lib/currency';
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

const DEFAULT_HOURS = { start: '09:00', end: '17:00' };

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
        problems.push(`${day.day}: a time could not be read.`);
      } else if (start >= end) {
        problems.push(`${day.day}: start (${shift.start}) must be before end (${shift.end}).`);
      }
    });
    const sorted = [...shifts].sort((a, b) => (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0));
    for (let i = 1; i < sorted.length; i += 1) {
      const previousEnd = toMinutes(sorted[i - 1].end);
      const start = toMinutes(sorted[i].start);
      if (previousEnd !== null && start !== null && start < previousEnd) {
        problems.push(
          `${day.day}: working blocks overlap (${sorted[i - 1].start} to ${sorted[i - 1].end} and ${sorted[i].start} to ${sorted[i].end}).`,
        );
      }
    }
  });
  return problems;
}

/* -------------------------------------------------------------------------- */
/* Shifts <-> hours + breaks                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A day's shifts -> {off, start, end, breaks:[{name,start,end}]}.
 * The gaps between consecutive shifts ARE the breaks; each gap's name is
 * stored on the shift after it.
 */
export function editorFromDay(day) {
  const shifts = (day?.shifts || []).filter((shift) => shift.start && shift.end);
  if (day?.off || shifts.length === 0) {
    return { off: Boolean(day?.off) || shifts.length === 0, ...DEFAULT_HOURS, breaks: [] };
  }
  const sorted = [...shifts].sort((a, b) => (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0));
  const breaks = [];
  for (let i = 1; i < sorted.length; i += 1) {
    breaks.push({
      name: sorted[i].break_name || 'Break',
      start: sorted[i - 1].end,
      end: sorted[i].start,
    });
  }
  return { off: false, start: sorted[0].start, end: sorted[sorted.length - 1].end, breaks };
}

/**
 * {off, start, end, breaks} -> the day's shifts. Breaks are sorted, then the
 * working range is split at each one; the shift AFTER a break carries its name.
 * Call `editorProblems` first — this assumes a valid editor state.
 */
export function dayFromEditor(dayName, editor) {
  if (editor.off) return { day: dayName, off: true, shifts: [] };
  const sortedBreaks = [...(editor.breaks || [])]
    .filter((entry) => entry.start && entry.end)
    .sort((a, b) => (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0));

  const shifts = [];
  let cursor = editor.start;
  let pendingName = '';
  sortedBreaks.forEach((entry) => {
    shifts.push({ start: cursor, end: entry.start, break_name: pendingName });
    cursor = entry.end;
    pendingName = entry.name || 'Break';
  });
  shifts.push({ start: cursor, end: editor.end, break_name: pendingName });
  return { day: dayName, off: false, shifts };
}

/** Everything wrong with an editor state, in the doctor's own terms. */
export function editorProblems(editor) {
  if (editor.off) return [];
  const problems = [];
  const dayStart = toMinutes(editor.start);
  const dayEnd = toMinutes(editor.end);

  if (dayStart === null || dayEnd === null) {
    problems.push('Set both a start and an end time for the day.');
    return problems;
  }
  if (dayStart >= dayEnd) {
    problems.push('The day must start before it ends.');
    return problems;
  }

  const sorted = [...(editor.breaks || [])]
    .sort((a, b) => (toMinutes(a.start) ?? 0) - (toMinutes(b.start) ?? 0));

  sorted.forEach((entry, index) => {
    const label = entry.name || `Break ${index + 1}`;
    const start = toMinutes(entry.start);
    const end = toMinutes(entry.end);
    if (start === null || end === null) {
      problems.push(`${label}: set both times.`);
      return;
    }
    if (start >= end) {
      problems.push(`${label}: it must start before it ends.`);
      return;
    }
    if (start <= dayStart || end >= dayEnd) {
      problems.push(`${label}: keep it inside your working hours (after ${formatClock(editor.start)}, before ${formatClock(editor.end)}).`);
    }
    if (index > 0) {
      const previous = sorted[index - 1];
      const previousEnd = toMinutes(previous.end);
      if (previousEnd !== null && start < previousEnd) {
        problems.push(`${label}: it overlaps ${previous.name || 'the break before it'}.`);
      }
    }
  });

  return problems;
}

/** A sensible default for a new break: after the last one, else lunchtime. */
function nextBreakDefault(editor) {
  const dayStart = toMinutes(editor.start) ?? 540;
  const dayEnd = toMinutes(editor.end) ?? 1020;
  const lastEnd = (editor.breaks || []).reduce(
    (max, entry) => Math.max(max, toMinutes(entry.end) ?? 0),
    0,
  );
  const asClock = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

  let start = Math.max(lastEnd + 60, 13 * 60);
  if (start <= dayStart) start = dayStart + 60;
  let end = start + 60;
  if (end >= dayEnd) {
    // Not enough room after the previous break: fall back to the middle.
    const mid = Math.round((dayStart + dayEnd) / 2 / 15) * 15;
    start = mid - 30;
    end = mid + 30;
  }
  return { name: editor.breaks?.length ? 'Break' : 'Lunch', start: asClock(start), end: asClock(end) };
}

/* -------------------------------------------------------------------------- */
/* Day editor                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Local editor state, committed to the page's week on every VALID change. An
 * invalid intermediate state (a half-typed time, a break outside the hours)
 * stays local with an inline explanation, so the week never holds garbage.
 * Remounted per day via `key` in DayEditor below.
 */
function DayEditorBody({ day, onChange, onCopyToWeekdays }) {
  const [editor, setEditor] = useState(() => editorFromDay(day));
  const problems = editorProblems(editor);

  const apply = (next) => {
    setEditor(next);
    if (editorProblems(next).length === 0) {
      onChange(dayFromEditor(day.day, next));
    }
  };

  const setBreak = (index, patch) => {
    apply({
      ...editor,
      breaks: editor.breaks.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)),
    });
  };

  const preview = problems.length === 0 ? dayFromEditor(day.day, editor) : day;
  const bookable = dayMinutes(preview);

  return (
    <div className="flex flex-col gap-5">
      <Switch
        checked={editor.off}
        onChange={(event) => apply({ ...editor, off: event.target.checked })}
        label={`${day.day} is a day off`}
        description="No slots are generated and nothing can be booked."
      />

      {!editor.off && (
        <>
          {/* ------------------------------------------------ working hours -- */}
          <section className="rounded-card border border-subtle bg-surface-sunken p-4">
            <p className="mb-3 flex items-center gap-2 text-label-lg text-default">
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-control bg-primary-100 text-primary-700">
                <Clock className="h-4 w-4" aria-hidden="true" />
              </span>
              Working hours
            </p>
            <div className="flex items-end gap-3">
              <Field label="From" className="flex-1">
                <Input
                  type="time"
                  value={editor.start}
                  onChange={(event) => apply({ ...editor, start: event.target.value })}
                />
              </Field>
              <Field label="To" className="flex-1">
                <Input
                  type="time"
                  value={editor.end}
                  onChange={(event) => apply({ ...editor, end: event.target.value })}
                />
              </Field>
            </div>
          </section>

          {/* ------------------------------------------------------- breaks -- */}
          <section className="rounded-card border border-subtle bg-surface-sunken p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="flex items-center gap-2 text-label-lg text-default">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-control bg-warning-100 text-warning-700">
                  <Coffee className="h-4 w-4" aria-hidden="true" />
                </span>
                Breaks
              </p>
              <Button
                variant="soft"
                size="sm"
                leftIcon={<Plus className="h-4 w-4" aria-hidden="true" />}
                onClick={() => apply({ ...editor, breaks: [...editor.breaks, nextBreakDefault(editor)] })}
              >
                Add break
              </Button>
            </div>

            {editor.breaks.length === 0 ? (
              <p className="text-body-sm text-muted">
                No breaks yet. Patients can book any time between {formatClock(editor.start)} and{' '}
                {formatClock(editor.end)}.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {editor.breaks.map((entry, index) => (
                  <li
                    key={index}
                    className="flex flex-col gap-2.5 rounded-field border border-subtle bg-surface p-3"
                  >
                    <div className="flex items-end gap-2">
                      <Field label="Name" className="flex-1">
                        <Input
                          value={entry.name}
                          maxLength={40}
                          placeholder="Lunch"
                          onChange={(event) => setBreak(index, { name: event.target.value })}
                        />
                      </Field>
                      <IconButton
                        aria-label={`Remove ${entry.name || `break ${index + 1}`}`}
                        variant="ghost"
                        onClick={() => apply({ ...editor, breaks: editor.breaks.filter((_, i) => i !== index) })}
                        className="mb-1"
                      >
                        <Trash2 className="h-4 w-4 text-danger-600" aria-hidden="true" />
                      </IconButton>
                    </div>
                    <div className="flex items-end gap-2">
                      <Field label="From" className="flex-1">
                        <Input
                          type="time"
                          value={entry.start}
                          onChange={(event) => setBreak(index, { start: event.target.value })}
                        />
                      </Field>
                      <Field label="To" className="flex-1">
                        <Input
                          type="time"
                          value={entry.end}
                          onChange={(event) => setBreak(index, { end: event.target.value })}
                        />
                      </Field>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {problems.length > 0 && (
            <Alert tone="warning" title="Almost there">
              <ul className="list-disc space-y-1 pl-4">
                {problems.map((problem) => <li key={problem}>{problem}</li>)}
              </ul>
            </Alert>
          )}

          <p className="text-caption text-muted">
            {bookable > 0
              ? `${Math.round(bookable / 6) / 10} bookable hours on ${day.day}.`
              : 'No bookable hours yet.'}
          </p>
        </>
      )}

      <div className="border-t border-subtle pt-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onCopyToWeekdays(problems.length === 0 ? dayFromEditor(day.day, editor) : day)}
        >
          Copy these hours to Monday–Friday
        </Button>
      </div>
    </div>
  );
}

function DayEditor({ open, day, onClose, onChange, onCopyToWeekdays }) {
  if (!day) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      size="md"
      title={day.day}
      description="Set the hours you work, then add breaks. Patients can only book inside working hours and never during a break."
      footer={<Button variant="primary" onClick={onClose} fullWidth>Done</Button>}
    >
      <DayEditorBody
        key={day.day}
        day={day}
        onChange={onChange}
        onCopyToWeekdays={onCopyToWeekdays}
      />
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

  // -- live PKR -> USD -------------------------------------------------------
  // The backend stores both currencies and converts neither, so whatever sits
  // in these two fields is what patients are quoted. The rate is fetched once
  // and USD follows PKR until the doctor types a USD figure themselves, at
  // which point their number wins and we stop touching it.
  const [fx, setFx] = useState({ status: 'loading', rate: null, at: null, stale: false });
  const [autoUsd, setAutoUsd] = useState(true);

  const loadRate = useCallback(async (options) => {
    setFx((previous) => ({ ...previous, status: 'loading' }));
    const found = await getPkrPerUsd(options);
    setFx(found
      ? { status: 'ready', rate: found.rate, at: found.at, stale: found.stale }
      : { status: 'error', rate: null, at: null, stale: false });
    return found;
  }, []);

  useEffect(() => { loadRate(); }, [loadRate]);

  useEffect(() => {
    if (!data) return;
    setForm({
      pkr: String(data.pkr ?? 0),
      usd: String(data.usd ?? 0),
      duration: data.duration || '30min',
      buffer_time: String(data.buffer_time ?? 0),
    });
    // A stored USD fee that is not what the current rate would produce is a
    // deliberate price, so respect it rather than overwriting it on load.
    const stored = Number(data.usd);
    const derived = pkrToUsd(data.pkr, fx.rate);
    setAutoUsd(!Number.isFinite(stored) || stored === 0 || (derived !== null && stored === derived));
    // fx.rate is deliberately absent: this decides ONCE, from what was saved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  /** PKR is the source of truth; USD trails it while auto conversion is on. */
  const setPkr = (value) => {
    setForm((previous) => {
      const next = { ...previous, pkr: value };
      if (autoUsd) {
        const converted = pkrToUsd(value, fx.rate);
        if (converted !== null) next.usd = String(converted);
      }
      return next;
    });
  };

  const setUsd = (value) => {
    setAutoUsd(false);
    setForm((previous) => ({ ...previous, usd: value }));
  };

  /** Re-enable the automatic figure, refreshing the rate first. */
  const useLiveRate = async () => {
    const found = await loadRate({ force: true });
    if (!found) return;
    setAutoUsd(true);
    setForm((previous) => {
      const converted = pkrToUsd(previous.pkr, found.rate);
      return converted === null ? previous : { ...previous, usd: String(converted) };
    });
  };

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

  const durationLabel = DURATIONS.find((entry) => entry.value === form.duration)?.label || form.duration;

  const fxHint = (() => {
    if (!autoUsd) return 'Your own figure. It will not follow the PKR fee.';
    if (fx.status === 'loading') return 'Checking the latest exchange rate.';
    if (fx.status === 'error') return 'We could not reach the rate service, so type this one yourself.';
    return `Converted at ${describeRate(fx.rate)}${fx.stale ? ', last known rate' : ''}.`;
  })();

  return (
    <Card>
      <CardHeader
        title={(
          <span className="flex items-center gap-2.5">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-field bg-success-100 text-success-700">
              <Wallet className="h-4 w-4" aria-hidden="true" />
            </span>
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
              <Field label="Fee (PKR)" hint="Your price. The USD figure follows it.">
                <Input
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={form.pkr}
                  onChange={(event) => setPkr(event.target.value)}
                />
              </Field>
              <Field
                label="Fee (USD)"
                hint={fxHint}
              >
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={form.usd}
                  onChange={(event) => setUsd(event.target.value)}
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

            {/* Where the USD number came from, and how to take it back. */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-field border border-subtle bg-surface-sunken px-3.5 py-2.5">
              <p className="flex items-center gap-2 text-caption text-muted">
                <RefreshCw
                  className={cn('h-3.5 w-3.5 shrink-0', fx.status === 'loading' && 'animate-spin')}
                  aria-hidden="true"
                />
                {fx.status === 'ready' && fx.at
                  ? `Rate updated ${formatDate(fx.at)}`
                  : 'Live exchange rate'}
              </p>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={useLiveRate}
                loading={fx.status === 'loading'}
                loadingText="Checking"
              >
                {autoUsd ? 'Refresh rate' : 'Convert from PKR again'}
              </Button>
            </div>

            {/* What the patient will actually see, in one line. */}
            <div className="flex items-start gap-2.5 rounded-field bg-primary-50 px-3.5 py-3 text-body-sm text-primary-900 dark:bg-surface-sunken dark:text-primary-800">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary-600 dark:text-primary-700" aria-hidden="true" />
              <span>
                Patients see: a {durationLabel.toLowerCase()} consultation for{' '}
                <strong className="font-semibold">PKR {Number(form.pkr) || 0}</strong>
                {' '}(USD {Number(form.usd) || 0})
                {Number(form.buffer_time) > 0 && `, with a ${Number(form.buffer_time)} minute gap between visits`}.
              </span>
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
      // orphaned. Still want to?"
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

      <div className="grid gap-6 xl:grid-cols-3">
        <Card padding="none" className="xl:col-span-2">
          <CardHeader
            title={(
              <span className="flex items-center gap-2.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-field bg-primary-100 text-primary-700">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                </span>
                Your working week
              </span>
            )}
            titleAs="h2"
            description="Select any day to set its hours and breaks."
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

        <div className={cn('xl:col-span-1')}>
          <FeesCard doctorId={doctorId} />
        </div>
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
            Saving anyway does not cancel them. They simply sit outside your published availability,
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
