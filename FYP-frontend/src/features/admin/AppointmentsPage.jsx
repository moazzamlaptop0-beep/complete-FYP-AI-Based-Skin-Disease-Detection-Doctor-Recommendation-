/**
 * AdminAppointmentsPage — every booking on the platform, and the conflicts.
 *
 * TWO DATES, AND ONLY ONE OF THEM IS A DATE
 * -----------------------------------------
 * `appointment_date` is free text. Legacy rows hold `"Mon, Jan 26"`; newer rows
 * hold `"2026-07-25"`. Comparing it with `>=` compares strings, so the backend
 * refuses to range-filter on it at all. `slot_start` is the typed shadow column
 * that CAN be filtered — but it is NULL on legacy rows, so filtering by it
 * silently excludes them. `created_at` is the only column that is both typed and
 * always populated, which is why `date_field` defaults to `created`.
 *
 * The date-field switch here therefore has a visible explanation attached
 * rather than being a bare dropdown: choosing "appointment slot" is choosing to
 * hide legacy bookings, and an admin who does not know that will conclude data
 * is missing.
 *
 * CONFLICTS ARE THE REASON TO LOOK
 * --------------------------------
 * `Pending-Conflict` means two patients hold the same slot and a doctor has to
 * choose. Those rows are surfaced with their own filter chip and a warning tone,
 * because they are the only rows on this page that need somebody to act.
 */

import React, { useMemo, useState } from 'react';
import { CalendarDays, CalendarPlus, Filter, Info } from 'lucide-react';

import {
  Alert,
  Badge,
  Button,
  EmptyState,
  Field,
  Input,
  SearchInput,
  Select,
  StatusBadge,
  Tooltip,
  cn,
} from '../../components/ui';
import { admin as adminEndpoints } from '../../lib/endpoints';
import { formatDate, formatDateTime, formatTime } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { AdminPage, AdminTable, FilterBar, SegmentedFilter, StackCell } from './components/AdminPage';
import BookAppointmentDrawer from './components/BookAppointmentDrawer';
import { ImpersonationNotice } from './components/ImpersonationNotice';
import { ViewAsPicker } from './components/ViewAsPicker';
import { usePaginatedQuery } from './hooks/usePaginatedQuery';

/** `appointments.status` — these exact strings. */
const STATUS_OPTIONS = [
  { value: '', label: 'Any' },
  { value: 'Scheduled', label: 'Scheduled' },
  { value: 'Confirmed', label: 'Confirmed' },
  { value: 'Pending-Conflict', label: 'Conflicts' },
  { value: 'Completed', label: 'Completed' },
  { value: 'Cancelled', label: 'Cancelled' },
  { value: 'Reassigned', label: 'Reassigned' },
];

const DATE_FIELD_OPTIONS = [
  { value: 'created', label: 'Booked on (created_at)' },
  { value: 'slot', label: 'Appointment slot (slot_start)' },
];

/**
 * The date shown in the row. `slot_start` is authoritative when present;
 * `appointment_date` + `appointment_time` is the free-text legacy pair and is
 * rendered verbatim rather than parsed, because "Mon, Jan 26" has no year.
 */
function whenLabel(row) {
  if (row.slot_start) {
    return {
      primary: formatDate(row.slot_start),
      secondary: formatTime(row.slot_start),
      typed: true,
    };
  }
  return {
    primary: row.appointment_date || '—',
    secondary: row.appointment_time || undefined,
    typed: false,
  };
}

export default function AdminAppointmentsPage() {
  const { actingAs } = useAuth();
  const [status, setStatus] = useState('');
  const [doctor, setDoctor] = useState('');
  const [person, setPerson] = useState('');
  const [dateField, setDateField] = useState('created');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [booking, setBooking] = useState(false);

  const filters = useMemo(() => ({
    status,
    doctor,
    patient: person,
    date_field: dateField,
    date_from: dateFrom,
    date_to: dateTo,
  }), [status, doctor, person, dateField, dateFrom, dateTo]);

  const query = usePaginatedQuery({
    path: adminEndpoints.appointments,
    filters,
    enabled: !actingAs,
  });

  // SearchInput owns its own debounce and is uncontrolled, so a reset has to
  // remount it — otherwise the box keeps showing a filter that is no longer on.
  const [resetKey, setResetKey] = useState(0);

  const dirty = Boolean(status || doctor || person || dateFrom || dateTo || dateField !== 'created');
  const reset = () => {
    setStatus('');
    setDoctor('');
    setPerson('');
    setDateField('created');
    setDateFrom('');
    setDateTo('');
    setResetKey((n) => n + 1);
  };

  const conflicts = query.items.filter((row) => row.status === 'Pending-Conflict').length;

  const columns = [
    {
      key: 'when',
      header: 'When',
      render: (row) => {
        const when = whenLabel(row);
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="whitespace-nowrap font-medium text-default">
                {when.primary}
              </span>
              {!when.typed ? (
                <Tooltip content="Legacy free-text date. This row has no typed slot, so it cannot be range-filtered.">
                  <Info className="h-3.5 w-3.5 shrink-0 text-muted" aria-label="Legacy free-text date" />
                </Tooltip>
              ) : null}
            </div>
            {when.secondary ? (
              <span className="block text-caption text-muted">{when.secondary}</span>
            ) : null}
          </div>
        );
      },
    },
    {
      key: 'patient_name',
      header: 'Patient',
      render: (row) => (
        <StackCell primary={row.patient_name || `User #${row.patient_id}`} secondary={row.patient_email} />
      ),
    },
    {
      key: 'doctor_name',
      header: 'Doctor',
      render: (row) => (
        <StackCell primary={row.doctor_name || `Doctor #${row.doctor_id}`} secondary={row.doctor_email} />
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={row.status || 'Scheduled'} />
          {row.conflict_with_id ? (
            <span className="text-caption text-warning-700">
              Clashes with #{row.conflict_with_id}
            </span>
          ) : null}
          {row.auto_resolved ? (
            <Badge tone="neutral" size="sm" variant="outline">Auto-resolved</Badge>
          ) : null}
          {row.hidden_from_doctor ? (
            <Badge tone="neutral" size="sm" variant="outline">Hidden from doctor</Badge>
          ) : null}
        </div>
      ),
    },
    {
      key: 'scan_id',
      header: 'Scan',
      hideOnMobile: true,
      render: (row) => (
        row.scan_id
          ? <span className="font-mono text-body-sm">#{row.scan_id}</span>
          : <span className="text-caption italic text-muted">None</span>
      ),
    },
    {
      key: 'created_at',
      header: 'Booked',
      hideOnMobile: true,
      render: (row) => (
        <span className="whitespace-nowrap text-body-sm">{formatDateTime(row.created_at)}</span>
      ),
    },
  ];

  return (
    <AdminPage
      title="Appointments"
      description="Every booking, including the ones a doctor hid and the ones two patients are fighting over. You can also take a booking yourself, for a patient who phoned in."
      actions={(
        <>
          <Button
            variant="primary"
            onClick={() => setBooking(true)}
            leftIcon={<CalendarPlus className="h-4 w-4" aria-hidden="true" />}
            disabled={Boolean(actingAs)}
          >
            Book appointment
          </Button>
          <ViewAsPicker />
        </>
      )}
      banner={<ImpersonationNotice />}
      paused={Boolean(actingAs)}
    >
      {conflicts > 0 && status !== 'Pending-Conflict' ? (
        <Alert
          tone="warning"
          title={`${conflicts} conflicting booking${conflicts === 1 ? '' : 's'} on this page`}
          actions={(
            <Button size="sm" variant="outline" onClick={() => setStatus('Pending-Conflict')}>
              Show only conflicts
            </Button>
          )}
        >
          Two patients hold the same slot. A doctor has to pick a winner before either of them can
          be confirmed.
        </Alert>
      ) : null}

      <FilterBar onRefresh={query.refetch} busy={query.refreshing} onReset={dirty ? reset : undefined}>
        <SegmentedFilter
          label="Status"
          options={STATUS_OPTIONS}
          value={status}
          onChange={setStatus}
        />
        <div className="w-full sm:w-52">
          <SearchInput
            key={`patient-${resetKey}`}
            placeholder="Patient name or email"
            onDebouncedChange={setPerson}
            aria-label="Filter by patient"
          />
        </div>
        <div className="w-full sm:w-52">
          <SearchInput
            key={`doctor-${resetKey}`}
            placeholder="Doctor name or email"
            onDebouncedChange={setDoctor}
            aria-label="Filter by doctor"
          />
        </div>
        <div className="w-full sm:w-56">
          <Field
            label="Date range applies to"
            hint={dateField === 'slot'
              ? 'Legacy bookings have no typed slot and are excluded.'
              : 'Always populated, the safe default.'}
          >
            <Select
              value={dateField}
              onChange={(event) => setDateField(event.target.value)}
              options={DATE_FIELD_OPTIONS}
            />
          </Field>
        </div>
        <div className="w-full sm:w-40">
          <Field label="From">
            <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
          </Field>
        </div>
        <div className="w-full sm:w-40">
          <Field label="To">
            <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
          </Field>
        </div>
      </FilterBar>

      <AdminTable
        query={query}
        columns={columns}
        caption="Every appointment on the platform"
        empty={(
          <EmptyState
            icon={dirty
              ? <Filter className="h-6 w-6" aria-hidden="true" />
              : <CalendarDays className="h-6 w-6" aria-hidden="true" />}
            title={dirty ? 'No appointment matches these filters' : 'No appointments yet'}
            description={dirty
              ? dateField === 'slot'
                ? 'Bookings made before the typed slot column existed are excluded by this date field. Try "Booked on" instead.'
                : 'Widen the date range or clear the status filter.'
              : 'Bookings appear here as soon as a patient takes a slot.'}
            action={dirty
              ? <Button variant="outline" size="sm" onClick={reset}>Clear filters</Button>
              : undefined}
          />
        )}
        mobileCard={(row) => {
          const when = whenLabel(row);
          return (
            <div className={cn(
              'flex flex-col gap-2 rounded-lg border p-4',
              row.status === 'Pending-Conflict'
                ? 'border-warning-300 bg-warning-50/60'
                : 'border-subtle bg-surface',
            )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-default">
                    {when.primary}
                    {when.secondary ? <span className="text-muted"> · {when.secondary}</span> : null}
                  </p>
                  <p className="truncate text-caption text-muted">
                    {row.patient_name || `User #${row.patient_id}`} → {row.doctor_name || `Doctor #${row.doctor_id}`}
                  </p>
                </div>
                <StatusBadge status={row.status || 'Scheduled'} size="sm" />
              </div>
              {row.cancellation_reason ? (
                <p className="text-caption text-muted">Reason: {row.cancellation_reason}</p>
              ) : null}
              <p className="text-caption text-muted">Booked {formatDateTime(row.created_at)}</p>
            </div>
          );
        }}
      />

      <BookAppointmentDrawer
        open={booking}
        onClose={() => setBooking(false)}
        onBooked={query.refetch}
      />
    </AdminPage>
  );
}
