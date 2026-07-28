/**
 * DoctorOverviewPage — the doctor workspace home.
 *
 * Everything here is derived from endpoints the task pages already call; the
 * backend has no doctor stats route (the only stats endpoint on the platform
 * is /admin/stats). So this page reuses the same race-safe hooks the queue
 * pages use — useDoctorScans / useDoctorAppointments live-refresh over SSE —
 * plus two one-line fetches: the request-inbox `total` (which the server
 * computes as "invites awaiting my reply") and the ratings summary.
 *
 * Every tile links to the page where the number can be acted on. A stat you
 * cannot act on is decoration.
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
  Inbox,
  ScanLine,
  Star,
} from 'lucide-react';

import {
  ActivityBars,
  ChartCard,
  StatCard,
  StatusList,
  bucketByWeek,
} from '../../components/dashboard';
import { Alert, Badge, Button, Skeleton } from '../../components/ui';
import { get } from '../../lib/api';
import { ratings as ratingEndpoints, requests as requestEndpoints } from '../../lib/endpoints';
import { formatRating } from '../../lib/format';
import { PATHS } from '../../routes';
import { useAuth } from '../../context/AuthContext';
import PageHeader from './components/PageHeader';
import { isPending, scanSeverity, useDoctorAppointments, useDoctorScans } from './hooks/useDoctorData';
import useDoctorQuery from './hooks/useDoctorQuery';

const SEVERITY_ROWS = [
  { key: 'CRITICAL', label: 'Critical', tone: 'danger', icon: AlertTriangle },
  { key: 'URGENT', label: 'Urgent', tone: 'warning', icon: Clock3 },
  { key: 'ROUTINE', label: 'Routine', tone: 'success', icon: CheckCircle2 },
];

export default function DoctorOverviewPage() {
  const { user } = useAuth();

  const scansQuery = useDoctorScans();
  const appointmentsQuery = useDoctorAppointments();

  // The server computes "invites awaiting my reply" as the inbox total under
  // its default filter; one row is enough to read it.
  const inboxFetcher = useCallback(
    (signal) => get(requestEndpoints.forDoctor({ page: 1, limit: 1 }), { signal }),
    [],
  );
  const inboxQuery = useDoctorQuery(inboxFetcher, { enabled: Boolean(user?.id) });

  const ratingsFetcher = useCallback(
    (signal) => get(ratingEndpoints.mine(), { signal }),
    [],
  );
  const ratingsQuery = useDoctorQuery(ratingsFetcher, { enabled: Boolean(user?.id) });

  const pendingScans = useMemo(
    () => scansQuery.scans.filter(isPending),
    [scansQuery.scans],
  );

  const severityItems = useMemo(() => SEVERITY_ROWS.map((row) => ({
    ...row,
    count: pendingScans.filter((scan) => scanSeverity(scan) === row.key).length,
  })), [pendingScans]);

  const weekly = useMemo(
    () => bucketByWeek(scansQuery.scans, (scan) => scan.created_at),
    [scansQuery.scans],
  );

  const conflicts = useMemo(
    () => appointmentsQuery.appointments.filter(
      (row) => String(row.status || '') === 'Pending-Conflict',
    ).length,
    [appointmentsQuery.appointments],
  );

  const booked = useMemo(
    () => appointmentsQuery.appointments.filter((row) => {
      const status = String(row.status || '');
      return status === 'Scheduled' || status === 'Confirmed';
    }).length,
    [appointmentsQuery.appointments],
  );

  // The two ratings wrappers use different keys on purpose; tolerate both.
  const ratingAverage = ratingsQuery.data?.average ?? ratingsQuery.data?.average_rating ?? 0;
  const ratingTotal = ratingsQuery.data?.total ?? ratingsQuery.data?.rating_count ?? 0;
  const inboxTotal = Number.isFinite(inboxQuery.data?.total) ? inboxQuery.data.total : 0;

  const firstName = String(user?.name || 'doctor').split(' ')[0];

  return (
    <>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description="Your practice at a glance. Every number links to the page where you can act on it."
        meta={conflicts > 0 ? (
          <Badge tone="warning" variant="soft">
            {conflicts} booking {conflicts === 1 ? 'conflict needs' : 'conflicts need'} your decision
          </Badge>
        ) : null}
        actions={(
          <Button
            as={Link}
            to={PATHS.DOCTOR_SCHEDULE}
            variant="soft"
            size="sm"
            leftIcon={<Activity className="h-4 w-4" aria-hidden="true" />}
          >
            Edit schedule
          </Button>
        )}
      />

      {scansQuery.error && (
        <Alert
          tone="danger"
          title="Could not load your cases"
          className="mb-6"
          actions={<Button size="sm" variant="outline" onClick={() => scansQuery.refresh()}>Try again</Button>}
        >
          {scansQuery.error.message || 'The referral list did not load.'}
        </Alert>
      )}

      <div className="flex flex-col gap-5 sm:gap-6">
        {/* ------------------------------------------------------ stat tiles -- */}
        <div className="grid grid-cols-2 gap-4 sm:gap-5 xl:grid-cols-4">
          <StatCard
            label="Awaiting your review"
            value={pendingScans.length}
            hint="Scans referred to you"
            icon={ClipboardList}
            tone="primary"
            to={PATHS.DOCTOR_REFERRALS}
            loading={scansQuery.loading}
            urgent={severityItems[0].count > 0}
          />
          <StatCard
            label="Requests inbox"
            value={inboxTotal}
            hint="Invites awaiting your reply"
            icon={Inbox}
            tone="info"
            to={PATHS.DOCTOR_REQUESTS}
            loading={inboxQuery.loading}
          />
          <StatCard
            label="Booked appointments"
            value={booked}
            hint={conflicts > 0 ? `${conflicts} in conflict` : 'Scheduled or confirmed'}
            icon={CalendarDays}
            tone="accent"
            to={PATHS.DOCTOR_APPOINTMENTS}
            loading={appointmentsQuery.loading}
            urgent={conflicts > 0}
          />
          <StatCard
            label="Your rating"
            value={ratingTotal > 0 ? formatRating(ratingAverage) : 'New'}
            hint={ratingTotal > 0 ? `From ${ratingTotal} patient ${ratingTotal === 1 ? 'review' : 'reviews'}` : 'No reviews yet'}
            icon={Star}
            tone="warning"
            to={PATHS.DOCTOR_RATINGS}
            loading={ratingsQuery.loading}
          />
        </div>

        {/* ---------------------------------------------------------- charts -- */}
        <div className="grid gap-4 sm:gap-5 lg:grid-cols-2">
          <ChartCard
            title="Scans referred to you"
            description="Per week, last 8 weeks"
            icon={ScanLine}
            tone="primary"
          >
            {scansQuery.loading ? (
              <Skeleton shape="rect" height={140} />
            ) : (
              <ActivityBars
                data={weekly}
                ariaLabel="Scans referred to you per week over the last 8 weeks"
                unit="scans"
              />
            )}
          </ChartCard>

          <ChartCard
            title="Review queue by urgency"
            description="Cases still waiting for your comment"
            icon={ClipboardList}
            tone="danger"
          >
            {scansQuery.loading ? (
              <Skeleton shape="rect" height={140} />
            ) : pendingScans.length === 0 ? (
              <div className="flex items-center gap-2.5 rounded-field bg-surface-sunken px-3.5 py-3">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success-600" aria-hidden="true" />
                <p className="text-body-sm text-muted">
                  Queue clear. Every referred scan has your review.
                </p>
              </div>
            ) : (
              <StatusList
                items={severityItems}
                ariaLabel="Pending reviews by urgency"
              />
            )}
          </ChartCard>
        </div>
      </div>
    </>
  );
}
