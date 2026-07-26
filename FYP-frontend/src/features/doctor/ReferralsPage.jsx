/**
 * DoctorReferralsPage — the review queue. GET /doctor/scans/<doctor_id>.
 *
 * SORTED BY SEVERITY, NOT BY UPLOAD TIME
 * --------------------------------------
 * The backend orders this list by `id DESC` (newest first) unless you ask for
 * `sort=asc`. Neither ordering is clinically safe: a CRITICAL case submitted this
 * morning must not sit below three ROUTINE ones submitted at lunchtime. So the
 * queue is re-sorted client-side — CRITICAL, then URGENT, then ROUTINE, and
 * oldest-waiting first WITHIN each band, because inside one severity the person
 * who has waited longest goes next.
 *
 * SEVERITY IS THE FIRST THING ON EVERY ROW
 * ----------------------------------------
 * Row order alone is not an accessible signal — a screen-reader user hears the
 * list in order but nothing tells them why. Every row therefore leads with a
 * <SeverityBadge>, and the section headings ("Critical · 2") give the same
 * grouping in text.
 *
 * IMAGES GO THROUGH <SensitiveImage> (via ScanThumb)
 * -------------------------------------------------
 * Never a raw `/static/uploads/...` <img>. A scan the patient flagged sensitive
 * serves the server-blurred variant, and revealing it is an explicit, audited
 * act — see src/components/media/SensitiveImage.jsx.
 */

import React, { useMemo, useState } from 'react';
import { ClipboardList, Filter, RefreshCw, Search } from 'lucide-react';

import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  EmptyState,
  SearchInput,
  Select,
  SeverityBadge,
  Skeleton,
  SkeletonGroup,
} from '../../components/ui';
import { formatConfidence, formatDate, formatDiseaseName, formatRelativeTime } from '../../lib/format';
import { cn } from '../../lib/cn';
import PageHeader from './components/PageHeader';
import QuestionnaireAnswers from './components/QuestionnaireAnswers';
import ReviewScanDialog from './components/ReviewScanDialog';
import ScanThumb from './components/ScanThumb';
import {
  isPending,
  parseAnswers,
  scanSeverity,
  severityRank,
  sortByClinicalPriority,
  useDoctorScans,
} from './hooks/useDoctorData';

/* -------------------------------------------------------------------------- */
/* Sorting + filtering                                                        */
/* -------------------------------------------------------------------------- */

const STATUS_FILTERS = [
  { value: 'pending', label: 'Awaiting my review' },
  { value: 'reviewed', label: 'Already reviewed' },
  { value: 'all', label: 'Every case' },
];

const SEVERITY_FILTERS = [
  { value: 'all', label: 'Any severity' },
  { value: 'CRITICAL', label: 'Critical only' },
  { value: 'URGENT', label: 'Urgent and above' },
];

const BANDS = [
  { key: 'CRITICAL', label: 'Critical', tone: 'danger' },
  { key: 'URGENT', label: 'Urgent', tone: 'warning' },
  { key: 'ROUTINE', label: 'Routine', tone: 'neutral' },
];

/* -------------------------------------------------------------------------- */
/* Row                                                                        */
/* -------------------------------------------------------------------------- */

function ReferralRow({ scan, onReview }) {
  const severity = scanSeverity(scan);
  const answers = parseAnswers(scan.questionnaire_answers ?? scan.patient_questionnaire);
  const pending = isPending(scan);
  const scanId = scan.id ?? scan.scan_id;

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
        <ScanThumb scan={scan} size="lg" canReveal alt={`Scan from ${scan.patient_name || 'a patient'}`} />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={severity} size="sm" />
            <Badge tone={pending ? 'warning' : 'success'} variant="soft" size="sm">
              {pending ? 'Awaiting review' : 'Reviewed'}
            </Badge>
            {scan.invite_to_clinic && (
              <Badge tone="primary" variant="outline" size="sm">Invited to clinic</Badge>
            )}
            <span className="ml-auto whitespace-nowrap text-caption text-muted" title={formatDate(scan.created_at)}>
              {formatRelativeTime(scan.created_at)}
            </span>
          </div>

          <h3 className="mt-2 font-heading text-heading-sm text-default">
            {formatDiseaseName(scan.disease || scan.prediction_result)}
            <span className="ml-2 font-body text-caption font-normal text-muted">
              {formatConfidence(scan.confidence)} confidence
            </span>
          </h3>

          <p className="mt-0.5 truncate text-body-sm text-muted">
            {scan.patient_name || 'Unknown patient'}
            {scan.patient_email && <span className="text-subtle"> · {scan.patient_email}</span>}
            <span className="text-subtle"> · case #{scanId}</span>
          </p>

          <div className="mt-3">
            <QuestionnaireAnswers answers={answers} />
          </div>

          {scan.doctor_comment && (
            <p className="mt-3 rounded-field border border-subtle bg-surface-sunken px-3 py-2 text-body-sm text-muted">
              <span className="font-semibold text-default">Your note: </span>
              {scan.doctor_comment}
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
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

export default function DoctorReferralsPage() {
  const { scans, loading, error, refreshing, refresh, setData } = useDoctorScans();

  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('pending');
  const [severity, setSeverity] = useState('all');
  const [reviewing, setReviewing] = useState(null);

  const pendingCount = useMemo(() => scans.filter(isPending).length, [scans]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = scans.filter((scan) => {
      if (status === 'pending' && !isPending(scan)) return false;
      if (status === 'reviewed' && isPending(scan)) return false;

      const band = scanSeverity(scan);
      if (severity === 'CRITICAL' && band !== 'CRITICAL') return false;
      if (severity === 'URGENT' && severityRank(band) > 1) return false;

      if (!needle) return true;
      return [
        scan.patient_name,
        scan.patient_email,
        scan.disease,
        scan.prediction_result,
        scan.id,
        scan.scan_id,
      ].some((value) => String(value ?? '').toLowerCase().includes(needle));
    });
    return sortByClinicalPriority(filtered);
  }, [scans, query, status, severity]);

  /** Bands, in order, with their rows — so the grouping is visible AND announced. */
  const grouped = useMemo(
    () => BANDS
      .map((band) => ({ ...band, rows: visible.filter((scan) => scanSeverity(scan) === band.key) }))
      .filter((band) => band.rows.length > 0),
    [visible],
  );
  // Anything with an unrecognised severity would silently vanish from the banded
  // view, so it is collected and shown under Routine's heading rather than lost.
  const unbanded = useMemo(
    () => visible.filter((scan) => !BANDS.some((band) => band.key === scanSeverity(scan))),
    [visible],
  );

  /** Patch one row in place — never re-fetch the whole queue under the cursor. */
  const applyUpdate = (updated) => {
    const id = updated.id ?? updated.scan_id;
    setData((previous) => (Array.isArray(previous)
      ? previous.map((scan) => ((scan.id ?? scan.scan_id) === id ? { ...scan, ...updated } : scan))
      : previous));
  };

  return (
    <>
      <PageHeader
        title="Patient cases"
        description="Scans referred to you, most serious first. Within a severity the longest wait goes next."
        meta={(
          <>
            {pendingCount > 0 && (
              <Badge tone="warning" variant="soft">
                {pendingCount} awaiting review
              </Badge>
            )}
            {!loading && (
              <Badge tone="neutral" variant="outline">{scans.length} total</Badge>
            )}
          </>
        )}
        actions={(
          <Button
            variant="outline"
            leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            loading={refreshing}
            onClick={() => refresh()}
          >
            Refresh
          </Button>
        )}
      />

      {error && (
        <Alert
          tone="danger"
          title="Could not load your cases"
          className="mb-6"
          actions={<Button size="sm" variant="outline" onClick={() => refresh()}>Try again</Button>}
        >
          {error.message || 'The referral queue did not load.'}
        </Alert>
      )}

      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-center">
        <SearchInput
          className="md:max-w-sm"
          placeholder="Search patient, condition or case id"
          aria-label="Search cases"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onClear={() => setQuery('')}
        />
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <Select
            className="sm:w-56"
            options={STATUS_FILTERS}
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            aria-label="Filter by review status"
          />
          <Select
            className="sm:w-52"
            options={SEVERITY_FILTERS}
            value={severity}
            onChange={(event) => setSeverity(event.target.value)}
            aria-label="Filter by severity"
          />
        </div>
      </div>

      {loading ? (
        <SkeletonGroup label="Loading your cases">
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((n) => (
              <Skeleton key={n} shape="rect" height={168} />
            ))}
          </div>
        </SkeletonGroup>
      ) : !scans.length ? (
        <EmptyState
          bordered
          icon={<ClipboardList aria-hidden="true" />}
          title="No cases have been referred to you yet"
          description="When a patient sends you a scan it lands here, with the most serious at the top. Setting your availability and fees makes you easier to find."
        />
      ) : !visible.length ? (
        <EmptyState
          bordered
          icon={<Search aria-hidden="true" />}
          title="Nothing matches those filters"
          description="Clear the search box, or switch the status filter to “Every case”."
          action={(
            <Button
              variant="outline"
              leftIcon={<Filter className="h-4 w-4" />}
              onClick={() => { setQuery(''); setStatus('all'); setSeverity('all'); }}
            >
              Clear filters
            </Button>
          )}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {grouped.map((band) => (
            <section key={band.key} aria-labelledby={`band-${band.key}`}>
              <h2
                id={`band-${band.key}`}
                className="mb-2 flex items-center gap-2 font-heading text-heading-sm text-default"
              >
                {band.label}
                <Badge tone={band.tone} variant="soft" size="sm">{band.rows.length}</Badge>
              </h2>
              <ul className="flex flex-col gap-3">
                {band.rows.map((scan) => (
                  <ReferralRow
                    key={scan.id ?? scan.scan_id}
                    scan={scan}
                    onReview={setReviewing}
                  />
                ))}
              </ul>
            </section>
          ))}

          {unbanded.length > 0 && (
            <section aria-labelledby="band-other">
              <h2 id="band-other" className="mb-2 font-heading text-heading-sm text-default">
                Unclassified
              </h2>
              <ul className="flex flex-col gap-3">
                {unbanded.map((scan) => (
                  <ReferralRow key={scan.id ?? scan.scan_id} scan={scan} onReview={setReviewing} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <ReviewScanDialog
        scan={reviewing}
        open={Boolean(reviewing)}
        onClose={() => setReviewing(null)}
        onSaved={applyUpdate}
      />
    </>
  );
}
