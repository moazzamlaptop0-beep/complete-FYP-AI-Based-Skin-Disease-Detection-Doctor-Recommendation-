/**
 * DoctorPatientDetailPage — route id `doctor.patientDetail`, /doctor/patients/:patientId.
 *
 * WHY THIS IS A ROUTE AND NOT A PANEL
 * -----------------------------------
 * The pre-refactor doctor dashboard opened a patient by swapping which component
 * it rendered while the address bar stayed on the list. Three things broke as a
 * result: the browser Back button left the whole dashboard instead of the
 * patient, a refresh dumped you back at the roster, and there was no link a
 * doctor could send a colleague. `:patientId` in the URL fixes all three at once
 * — and it costs nothing, because the roster and the detail view read the SAME
 * list (`/doctor/scans/<doctor_id>`), so opening a patient makes no extra call.
 *
 * A patient id this doctor has no cases for is a "not found" state, not an
 * error: it means either a mistyped URL or a case that has since been reassigned.
 */

import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  CalendarDays,
  FileText,
  Mail,
  RefreshCw,
  UserX,
} from 'lucide-react';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  SeverityBadge,
  Skeleton,
  SkeletonGroup,
  StatusBadge,
} from '../../components/ui';
import {
  formatConfidence,
  formatDate,
  formatDateTime,
  formatDiseaseName,
  formatRelativeTime,
} from '../../lib/format';
import { cn } from '../../lib/cn';
import { PATHS } from '../../routes';
import PageHeader from './components/PageHeader';
import QuestionnaireAnswers from './components/QuestionnaireAnswers';
import ReviewScanDialog from './components/ReviewScanDialog';
import ScanThumb from './components/ScanThumb';
import {
  groupScansByPatient,
  isPending,
  parseAnswers,
  scanSeverity,
  useDoctorAppointments,
  useDoctorScans,
} from './hooks/useDoctorData';

/* -------------------------------------------------------------------------- */
/* Case card                                                                  */
/* -------------------------------------------------------------------------- */

function CaseCard({ scan, onReview }) {
  const severity = scanSeverity(scan);
  const answers = parseAnswers(scan.questionnaire_answers ?? scan.patient_questionnaire);
  const pending = isPending(scan);

  return (
    <Card
      as="li"
      variant="outline"
      padding="none"
      className={cn(
        'overflow-hidden',
        severity === 'CRITICAL' && 'border-l-4 border-l-danger-600',
        severity === 'URGENT' && 'border-l-4 border-l-warning-500',
      )}
    >
      <CardBody className="flex flex-col gap-4 sm:flex-row">
        <ScanThumb scan={scan} size="lg" canReveal alt={`Case #${scan.id ?? scan.scan_id}`} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={severity} size="sm" />
            <Badge tone={pending ? 'warning' : 'success'} variant="soft" size="sm">
              {pending ? 'Awaiting review' : 'Reviewed'}
            </Badge>
            <span
              className="ml-auto whitespace-nowrap text-caption text-muted"
              title={formatDateTime(scan.created_at)}
            >
              {formatRelativeTime(scan.created_at)}
            </span>
          </div>

          <h3 className="mt-2 font-heading text-heading-sm text-default">
            {formatDiseaseName(scan.disease || scan.prediction_result)}
            <span className="ml-2 font-body text-caption font-normal text-muted">
              {formatConfidence(scan.confidence)} confidence
            </span>
          </h3>

          <div className="mt-3">
            <QuestionnaireAnswers answers={answers} />
          </div>

          {scan.doctor_comment && (
            <p className="mt-3 rounded-field border border-subtle bg-surface-sunken px-3 py-2 text-body-sm text-muted">
              <span className="font-semibold text-default">Your note: </span>
              {scan.doctor_comment}
            </p>
          )}

          <div className="mt-4">
            <Button size="sm" variant={pending ? 'primary' : 'outline'} onClick={() => onReview(scan)}>
              {pending ? 'Review this case' : 'Edit review'}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function DoctorPatientDetailPage() {
  const { patientId } = useParams();
  const { scans, loading, error, refreshing, refresh, setData } = useDoctorScans();
  const appointmentsQuery = useDoctorAppointments();

  const [reviewing, setReviewing] = useState(null);

  const patient = useMemo(() => {
    const roster = groupScansByPatient(scans);
    return roster.find((entry) => String(entry.patientId) === String(patientId)) || null;
  }, [scans, patientId]);

  /** Every appointment this doctor has with this patient, newest first. */
  const visits = useMemo(() => {
    if (!patient) return [];
    const scanIds = new Set(patient.scans.map((scan) => scan.id ?? scan.scan_id));
    return (appointmentsQuery.appointments || [])
      .filter((appointment) => {
        // The doctor appointment payload carries `scan_id` but NOT `patient_id`,
        // so the link back to a patient is made through the scans we already
        // know are theirs, with the email as the fallback for a booking that
        // never had a scan attached.
        if (appointment.scan_id && scanIds.has(appointment.scan_id)) return true;
        return Boolean(patient.email) && appointment.patient_email === patient.email;
      })
      .sort((a, b) => String(b.slot_date || '').localeCompare(String(a.slot_date || '')));
  }, [appointmentsQuery.appointments, patient]);

  const applyUpdate = (updated) => {
    const id = updated.id ?? updated.scan_id;
    setData((previous) => (Array.isArray(previous)
      ? previous.map((scan) => ((scan.id ?? scan.scan_id) === id ? { ...scan, ...updated } : scan))
      : previous));
  };

  const backLink = (
    <Button
      as={Link}
      to={PATHS.DOCTOR_PATIENTS}
      variant="ghost"
      size="sm"
      leftIcon={<ArrowLeft className="h-4 w-4" />}
    >
      All patients
    </Button>
  );

  if (loading) {
    return (
      <>
        <PageHeader title="Patient" actions={backLink} />
        <SkeletonGroup label="Loading this patient">
          <div className="flex flex-col gap-3">
            <Skeleton shape="rect" height={112} />
            <Skeleton shape="rect" height={180} />
            <Skeleton shape="rect" height={180} />
          </div>
        </SkeletonGroup>
      </>
    );
  }

  if (error) {
    return (
      <>
        <PageHeader title="Patient" actions={backLink} />
        <Alert
          tone="danger"
          title="Could not load this patient"
          actions={<Button size="sm" variant="outline" onClick={() => refresh()}>Try again</Button>}
        >
          {error.message || 'The case list did not load, so this patient could not be assembled.'}
        </Alert>
      </>
    );
  }

  if (!patient) {
    return (
      <>
        <PageHeader title="Patient not found" actions={backLink} />
        <EmptyState
          bordered
          tone="warning"
          icon={<UserX aria-hidden="true" />}
          title={`No cases for patient #${patientId}`}
          description="Either the link is wrong, or every case this person referred to you has since been reassigned. Your patient list only ever shows people who have sent you a scan."
          action={<Button as={Link} to={PATHS.DOCTOR_PATIENTS} variant="primary">Back to patients</Button>}
          secondaryAction={(
            <Button variant="ghost" onClick={() => refresh()} leftIcon={<RefreshCw className="h-4 w-4" />}>
              Refresh
            </Button>
          )}
        />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title={patient.name}
        description={`Patient #${patient.patientId}`}
        meta={(
          <>
            <SeverityBadge severity={patient.worstSeverity} size="sm" />
            <Badge tone="neutral" variant="outline">
              {patient.scanCount} case{patient.scanCount === 1 ? '' : 's'}
            </Badge>
            {patient.pendingCount > 0 && (
              <Badge tone="warning" variant="soft">{patient.pendingCount} awaiting review</Badge>
            )}
          </>
        )}
        actions={(
          <>
            {backLink}
            <Button
              variant="outline"
              leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
              loading={refreshing}
              onClick={() => refresh()}
            >
              Refresh
            </Button>
          </>
        )}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* ------------------------------------------------------- cases -- */}
        <section aria-labelledby="cases-heading" className="min-w-0 lg:order-1">
          <h2 id="cases-heading" className="mb-3 font-heading text-heading-md text-default">
            Case history
          </h2>
          <ul className="flex flex-col gap-3">
            {patient.scans.map((scan) => (
              <CaseCard key={scan.id ?? scan.scan_id} scan={scan} onReview={setReviewing} />
            ))}
          </ul>
        </section>

        {/* ------------------------------------------------------- aside -- */}
        <aside className="flex flex-col gap-4 lg:order-2">
          <Card>
            <CardBody className="flex flex-col items-center gap-3 text-center">
              <Avatar size="xl" name={patient.name} />
              <div className="min-w-0">
                <p className="font-heading text-heading-sm text-default">{patient.name}</p>
                {patient.email && (
                  <a
                    href={`mailto:${patient.email}`}
                    className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-field px-1 text-caption text-muted underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-focus"
                  >
                    <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate">{patient.email}</span>
                  </a>
                )}
              </div>
              <dl className="grid w-full grid-cols-2 gap-2 border-t border-subtle pt-3 text-left">
                <div>
                  <dt className="text-overline text-muted">Cases</dt>
                  <dd className="font-numeric text-body-md text-default">{patient.scanCount}</dd>
                </div>
                <div>
                  <dt className="text-overline text-muted">Last case</dt>
                  <dd className="text-body-sm text-default" title={formatDateTime(patient.lastScanAt)}>
                    {formatDate(patient.lastScanAt)}
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Appointments with you" titleAs="h2" divider />
            <CardBody className="pt-3">
              {appointmentsQuery.loading ? (
                <SkeletonGroup label="Loading appointments">
                  <Skeleton shape="text" />
                  <Skeleton shape="text" width="70%" />
                </SkeletonGroup>
              ) : appointmentsQuery.error ? (
                <Alert tone="warning" title="Calendar unavailable">
                  The case history above is unaffected.
                </Alert>
              ) : !visits.length ? (
                <EmptyState
                  size="sm"
                  icon={<CalendarDays aria-hidden="true" />}
                  title="No appointments yet"
                  description="Nothing booked between you and this patient."
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {visits.map((visit) => (
                    <li
                      key={visit.id}
                      className="flex flex-wrap items-center gap-2 rounded-field border border-subtle bg-surface-sunken px-3 py-2"
                    >
                      <CalendarDays className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-label-md text-default">
                          {formatDate(visit.slot_date)}
                          {visit.slot_time && (
                            <span className="ml-1 font-normal text-muted">{visit.slot_time}</span>
                          )}
                        </span>
                        {visit.disease && (
                          <span className="block truncate text-caption text-muted">
                            {formatDiseaseName(visit.disease)}
                          </span>
                        )}
                      </span>
                      <StatusBadge status={visit.status} size="sm" />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card variant="flat">
            <CardBody className="text-caption text-muted">
              <FileText className="mb-1.5 h-4 w-4 text-subtle" aria-hidden="true" />
              This roster is built from the scans referred to you. A patient you have never received a
              case from will not appear here, even if you have met them.
            </CardBody>
          </Card>
        </aside>
      </div>

      <ReviewScanDialog
        scan={reviewing}
        open={Boolean(reviewing)}
        onClose={() => setReviewing(null)}
        onSaved={applyUpdate}
      />
    </>
  );
}
