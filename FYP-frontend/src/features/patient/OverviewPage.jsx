/**
 * PatientOverviewPage — the patient workspace home.
 *
 * Derived entirely from the three lists the task pages already call (there is
 * no patient stats endpoint): the scan history, the appointment list and the
 * open-request total from the server's page envelope. The hero card leads
 * with the one action this product exists for: starting a scan.
 */

import React, { useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Clock3,
  FileText,
  ScanLine,
  Sparkles,
} from 'lucide-react';

import {
  ActivityBars,
  ChartCard,
  StatCard,
  StatusList,
  bucketByWeek,
} from '../../components/dashboard';
import { Alert, Button, Skeleton } from '../../components/ui';
import { get } from '../../lib/api';
import {
  appointments as appointmentEndpoints,
  requests as requestEndpoints,
  scans as scanEndpoints,
} from '../../lib/endpoints';
import { PATHS } from '../../routes';
import { useAuth } from '../../context/AuthContext';
import PageHeader from './components/PageHeader';
import { isUpcoming } from './lib/format';
import { useResource } from './hooks/usePatientData';

const SEVERITY_ROWS = [
  { key: 'CRITICAL', label: 'Critical', tone: 'danger', icon: AlertTriangle },
  { key: 'URGENT', label: 'Urgent', tone: 'warning', icon: Clock3 },
  { key: 'ROUTINE', label: 'Routine', tone: 'success', icon: CheckCircle2 },
];

function severityOf(scan) {
  return String(scan?.severity || scan?.severity_level || 'ROUTINE').toUpperCase();
}

export default function PatientOverviewPage() {
  const { user } = useAuth();
  const userId = user?.id;

  const scansQuery = useResource(
    useCallback((signal) => get(scanEndpoints.forPatient(userId), { signal }), [userId]),
    { enabled: Boolean(userId) },
  );
  const appointmentsQuery = useResource(
    useCallback(
      (signal) => get(appointmentEndpoints.patientAppointments(userId), { signal }),
      [userId],
    ),
    { enabled: Boolean(userId) },
  );
  const openRequestsQuery = useResource(
    useCallback(
      (signal) => get(requestEndpoints.list({ page: 1, limit: 1, status: 'Open' }), { signal }),
      [],
    ),
    { enabled: Boolean(userId) },
  );

  const scans = useMemo(
    () => (Array.isArray(scansQuery.data) ? scansQuery.data : []),
    [scansQuery.data],
  );
  const appointments = useMemo(
    () => (Array.isArray(appointmentsQuery.data) ? appointmentsQuery.data : []),
    [appointmentsQuery.data],
  );

  const upcoming = useMemo(() => appointments.filter(isUpcoming), [appointments]);
  const awaitingReview = useMemo(
    () => scans.filter((scan) => {
      const review = String(scan.review_status || scan.status || 'Pending').toLowerCase();
      return review !== 'reviewed' && review !== 'completed';
    }).length,
    [scans],
  );

  const severityItems = useMemo(() => SEVERITY_ROWS.map((row) => ({
    ...row,
    count: scans.filter((scan) => severityOf(scan) === row.key).length,
  })), [scans]);

  const weekly = useMemo(
    () => bucketByWeek(scans, (scan) => scan.created_at),
    [scans],
  );

  const openRequests = Number.isFinite(openRequestsQuery.data?.total)
    ? openRequestsQuery.data.total
    : 0;

  const firstName = String(user?.name || 'there').split(' ')[0];

  return (
    <>
      <PageHeader
        title={`Hi, ${firstName}`}
        description="Your skin health at a glance: scans, reviews and visits in one place."
      />

      {scansQuery.error && (
        <Alert
          tone="danger"
          title="Could not load your scans"
          className="mb-6"
          actions={<Button size="sm" variant="outline" onClick={scansQuery.refetch}>Try again</Button>}
        >
          {scansQuery.error}
        </Alert>
      )}

      <div className="flex flex-col gap-5 sm:gap-6">
        {/* ------------------------------------------------------- hero CTA -- */}
        <div className="relative overflow-hidden rounded-card bg-navy-950 p-6 text-white shadow-elevated sm:p-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-pill bg-aqua-400/20 blur-3xl"
          />
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -bottom-24 left-1/3 h-64 w-64 rounded-pill bg-navy-500/40 blur-3xl"
          />
          <div className="relative flex flex-wrap items-center justify-between gap-4">
            <div className="min-w-0 max-w-lg">
              <p className="flex items-center gap-1.5 text-overline uppercase text-aqua-300">
                <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                AI skin check
              </p>
              <h2 className="mt-1.5 font-heading text-display-sm">
                Noticed something new on your skin?
              </h2>
              <p className="mt-1.5 text-body-sm text-navy-200">
                Upload a photo and get an instant assessment, then send it to a real
                dermatologist if it needs eyes on it.
              </p>
            </div>
            <Button
              as={Link}
              to={PATHS.CONSULT}
              variant="secondary"
              leftIcon={<ScanLine className="h-4 w-4" aria-hidden="true" />}
            >
              Start a scan
            </Button>
          </div>
        </div>

        {/* ------------------------------------------------------ stat tiles -- */}
        <div className="grid grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-4">
          <StatCard
            label="Your scans"
            value={scans.length}
            hint="Full history with reports"
            icon={FileText}
            tone="primary"
            to={PATHS.PATIENT_SCANS}
            loading={scansQuery.loading}
          />
          <StatCard
            label="Awaiting doctor review"
            value={awaitingReview}
            hint="Scans a doctor has not commented on yet"
            icon={Clock3}
            tone="info"
            to={PATHS.PATIENT_SCANS}
            loading={scansQuery.loading}
          />
          <StatCard
            label="Upcoming visits"
            value={upcoming.length}
            hint="Booked appointments"
            icon={CalendarDays}
            tone="accent"
            to={PATHS.PATIENT_APPOINTMENTS}
            loading={appointmentsQuery.loading}
          />
          <StatCard
            label="Open requests"
            value={openRequests}
            hint="Waiting for a doctor to reply"
            icon={ClipboardList}
            tone="warning"
            to={PATHS.PATIENT_REQUESTS}
            loading={openRequestsQuery.loading}
          />
        </div>

        {/* ---------------------------------------------------------- charts -- */}
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
          <ChartCard
            title="Your scan activity"
            description="Per week, last 8 weeks"
            icon={ScanLine}
            tone="primary"
          >
            {scansQuery.loading ? (
              <Skeleton shape="rect" height={140} />
            ) : (
              <ActivityBars
                data={weekly}
                ariaLabel="Your scans per week over the last 8 weeks"
                unit="scans"
                empty={(
                  <div className="flex h-36 flex-col items-center justify-center gap-2 rounded-field bg-surface-sunken text-center">
                    <p className="text-body-sm text-muted">No scans in the last 8 weeks.</p>
                    <Button as={Link} to={PATHS.CONSULT} variant="soft" size="sm">
                      Run your first scan
                    </Button>
                  </div>
                )}
              />
            )}
          </ChartCard>

          <ChartCard
            title="Scan results by urgency"
            description="How your history breaks down"
            icon={Activity}
            tone="accent"
          >
            {scansQuery.loading ? (
              <Skeleton shape="rect" height={140} />
            ) : scans.length === 0 ? (
              <div className="flex h-36 items-center justify-center rounded-field bg-surface-sunken">
                <p className="text-body-sm text-muted">Your results will appear here after a scan.</p>
              </div>
            ) : (
              <StatusList items={severityItems} ariaLabel="Your scans by urgency" />
            )}
          </ChartCard>
        </div>
      </div>
    </>
  );
}
