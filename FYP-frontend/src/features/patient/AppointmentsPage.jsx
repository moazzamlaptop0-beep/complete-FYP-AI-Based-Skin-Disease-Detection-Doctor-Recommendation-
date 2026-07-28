/**
 * PatientAppointmentsPage — upcoming and past visits, and everything you can do
 * to them.
 *
 * WHAT THIS REPLACES
 * ------------------
 * A read-only list. Today a patient can BOOK an appointment and then do nothing
 * else with it: the two mutation routes both check `doctor_id`, so cancelling,
 * moving or re-booking were all doctor-only powers. Three of the four actions on
 * this page did not exist on the patient side at all.
 *
 * THE ONE RULE THAT SHAPES THIS FILE
 * ----------------------------------
 * Rebook and reschedule are NON-DESTRUCTIVE and return a NEW appointment id.
 *   /reschedule  cancels the old row ("Rescheduled by the patient.") + inserts
 *   /rebook      leaves the source row untouched + inserts
 * In both cases the id in the response is NOT the id that was clicked. Patching
 * the clicked row with the response would render one visit twice — as the stale
 * source and as the new booking. So every mutation here ends in `refetch()` and
 * nothing is ever mutated in place. That is also why the dialogs take a plain
 * `onDone` callback instead of returning a row to splice in.
 *
 * SPLIT, NOT FILTERED
 * -------------------
 * `/api/patient-appointments/<id>` returns everything, `id DESC`, with no
 * pagination and no date filter. Upcoming/past is therefore computed here, and
 * `isUpcoming()` deliberately treats an UNPARSEABLE date as upcoming:
 * `appointment_date` is free text, and hiding a visit that has not happened is
 * worse than showing one that has.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarDays, CalendarPlus, RefreshCw } from 'lucide-react';

import {
  Alert,
  Button,
  DateRangeFilter,
  EmptyState,
  SkeletonCard,
  Tabs,
  TabList,
  TabTrigger,
  TabPanel,
  dateInRange,
  hasDateRange,
} from '../../components/ui';
import { get } from '../../lib/api';
import { appointments as appointmentEndpoints, scans as scanEndpoints } from '../../lib/endpoints';
import { parseDateTimeParts } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { PATHS } from '../../routes';

import PageHeader from './components/PageHeader';
import AppointmentCard from './components/AppointmentCard';
import CancelAppointmentDialog from './components/CancelAppointmentDialog';
import RateDoctorDialog from './components/RateDoctorDialog';
import ScanDetailDrawer from './components/ScanDetailDrawer';
import SlotBookingDialog from './components/SlotBookingDialog';
import { useResource } from './hooks/usePatientData';
import { isUpcoming } from './lib/format';

/** Which dialog, if any, is open. One piece of state so two can never race. */
const NO_DIALOG = { kind: null, appointment: null };

export default function PatientAppointmentsPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'past' ? 'past' : 'upcoming';
  const [dialog, setDialog] = useState(NO_DIALOG);
  const [openScanId, setOpenScanId] = useState(null);
  const [dateRange, setDateRange] = useState({ from: null, to: null });

  const setTab = useCallback((next) => {
    setParams((previous) => {
      const search = new URLSearchParams(previous);
      if (next === 'past') search.set('tab', 'past'); else search.delete('tab');
      return search;
    }, { replace: true });
  }, [setParams]);

  const { data, loading, error, refetch } = useResource(
    (signal) => get(appointmentEndpoints.patientAppointments(userId), { signal }),
    { deps: [userId], enabled: Boolean(userId), initialData: [] },
  );

  /**
   * The scan history, loaded alongside, purely so "View scan" can open the same
   * drawer the scans page uses. There is no `GET /api/scans/<id>`, so the row
   * has to come from the listing either way.
   */
  const { data: scanData, refetch: refetchScans } = useResource(
    (signal) => get(scanEndpoints.forPatient(userId), { signal }),
    { deps: [userId], enabled: Boolean(userId), initialData: [] },
  );

  const all = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const scans = useMemo(() => (Array.isArray(scanData) ? scanData : []), [scanData]);

  const { upcoming, past } = useMemo(() => {
    const up = [];
    const done = [];
    all.forEach((appointment) => {
      const closed = ['Cancelled', 'Completed'].includes(appointment.status);
      if (!closed && isUpcoming(appointment)) up.push(appointment);
      else done.push(appointment);
    });
    // Soonest first for what is ahead; the API's id DESC already puts the most
    // recent history first, so `past` is left alone.
    up.sort((a, b) => String(a.slot_date || a.date || '').localeCompare(String(b.slot_date || b.date || '')));
    return { upcoming: up, past: done };
  }, [all]);

  const openScan = useMemo(
    () => (openScanId === null ? null : scans.find((scan) => scan.id === openScanId) || null),
    [openScanId, scans],
  );

  const closeDialog = useCallback(() => setDialog(NO_DIALOG), []);
  const open = useCallback((kind) => (appointment) => setDialog({ kind, appointment }), []);

  const baseList = tab === 'past' ? past : upcoming;
  const dateFiltering = hasDateRange(dateRange);

  // The day filter runs on the same slot fields the card renders. A visit whose
  // date does not parse stays visible (dateInRange treats it as in range), the
  // same rule isUpcoming() already follows for the tab split.
  const list = useMemo(() => {
    if (!dateFiltering) return baseList;
    return baseList.filter((appointment) => dateInRange(
      parseDateTimeParts(
        appointment.slot_date || appointment.date,
        appointment.slot_time || appointment.time,
      ),
      dateRange,
    ));
  }, [baseList, dateRange, dateFiltering]);

  const cards = (
    <>
      {loading && all.length === 0 && (
        <div className="flex flex-col gap-3" aria-busy="true">
          {Array.from({ length: 3 }).map((_, index) => <SkeletonCard key={index} lines={3} />)}
        </div>
      )}

      {!loading && list.length === 0 && (
        dateFiltering && baseList.length > 0 ? (
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" aria-hidden="true" />}
            title="No visits on those dates"
            description="Nothing in this tab falls inside the selected range. Widen it, or clear it."
            action={(
              <Button variant="outline" onClick={() => setDateRange({ from: null, to: null })}>
                Show all dates
              </Button>
            )}
          />
        ) : tab === 'past' ? (
          <EmptyState
            icon={<CalendarDays className="h-6 w-6" aria-hidden="true" />}
            title="No past visits yet"
            description="Once a visit is completed or cancelled it moves here, and you can re-book from it."
          />
        ) : (
          <EmptyState
            icon={<CalendarPlus className="h-6 w-6" aria-hidden="true" />}
            title="Nothing booked"
            description="Run a scan and send it to up to three dermatologists with the times that suit you. The first to accept takes the slot."
            action={<Button as={Link} to={PATHS.CONSULT}>Start a scan</Button>}
            secondaryAction={
              <Button as={Link} to={PATHS.PATIENT_FIND_DOCTOR} variant="outline">
                Browse doctors
              </Button>
            }
          />
        )
      )}

      {list.length > 0 && (
        <ul className="flex flex-col gap-3">
          {list.map((appointment) => (
            <li key={appointment.id}>
              <AppointmentCard
                appointment={appointment}
                onCancel={open('cancel')}
                onReschedule={open('reschedule')}
                onRebook={open('rebook')}
                onRate={open('rate')}
                onOpenScan={(row) => setOpenScanId(row.scan_id)}
              />
            </li>
          ))}
        </ul>
      )}
    </>
  );

  if (!userId) {
    return (
      <>
        <PageHeader title="Appointments" />
        <Alert tone="warning" title="Not signed in">
          We could not work out which account this is. Please sign in again.
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Appointments"
        description="Your upcoming visits, your history, and re-booking from an old record."
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={refetch}
              loading={loading && all.length > 0}
            >
              Refresh
            </Button>
            <Button as={Link} to={PATHS.CONSULT} size="sm" leftIcon={<CalendarPlus className="h-4 w-4" />}>
              Book a visit
            </Button>
          </>
        }
      />

      {error && (
        <Alert
          tone="danger"
          title="We could not load your appointments"
          className="mb-4"
          actions={<Button size="sm" variant="outline" onClick={refetch}>Try again</Button>}
        >
          {error}
        </Alert>
      )}

      <div className="mb-4 flex flex-col gap-2">
        <DateRangeFilter
          label="Visit date"
          value={dateRange}
          onChange={setDateRange}
        />
        {dateFiltering && !loading && baseList.length > 0 && (
          <p className="font-body text-caption text-muted" role="status">
            Showing {list.length} of {baseList.length} {tab === 'past' ? 'past' : 'upcoming'} visits.
          </p>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabList aria-label="Appointments">
          <TabTrigger value="upcoming" badge={upcoming.length || undefined}>Upcoming</TabTrigger>
          <TabTrigger value="past" badge={past.length || undefined}>Past</TabTrigger>
        </TabList>
        <TabPanel value="upcoming">{tab === 'upcoming' && cards}</TabPanel>
        <TabPanel value="past">{tab === 'past' && cards}</TabPanel>
      </Tabs>

      {/* Every dialog refetches instead of patching: rebook and reschedule both
          return a NEW appointment id and leave a changed source row behind. */}
      <CancelAppointmentDialog
        appointment={dialog.kind === 'cancel' ? dialog.appointment : null}
        open={dialog.kind === 'cancel'}
        onClose={closeDialog}
        onDone={refetch}
      />
      <SlotBookingDialog
        mode="reschedule"
        appointment={dialog.kind === 'reschedule' ? dialog.appointment : null}
        open={dialog.kind === 'reschedule'}
        onClose={closeDialog}
        onDone={refetch}
      />
      <SlotBookingDialog
        mode="rebook"
        appointment={dialog.kind === 'rebook' ? dialog.appointment : null}
        open={dialog.kind === 'rebook'}
        onClose={closeDialog}
        onDone={refetch}
      />
      <RateDoctorDialog
        appointment={dialog.kind === 'rate' ? dialog.appointment : null}
        open={dialog.kind === 'rate'}
        onClose={closeDialog}
        onDone={refetch}
      />

      <ScanDetailDrawer
        scan={openScan}
        open={Boolean(openScan)}
        onClose={() => setOpenScanId(null)}
        onChanged={refetchScans}
        onDeleted={() => {
          setOpenScanId(null);
          refetchScans();
        }}
      />
    </>
  );
}
