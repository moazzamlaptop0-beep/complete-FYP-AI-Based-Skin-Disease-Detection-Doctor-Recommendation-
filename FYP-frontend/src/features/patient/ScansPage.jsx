/**
 * PatientScansPage — every scan this account has ever run.
 *
 * WHAT THIS REPLACES
 * ------------------
 * `components/dashboards/patient/PatientHistory.jsx`, which renders a fixed
 * table that scrolls sideways on a phone, builds `<img src="/static/uploads/…">`
 * straight from the DB path (so "sensitive" meant nothing), keeps its filters in
 * component state (so a filtered view cannot be linked or refreshed), and mounts
 * one hidden 800px-wide PDF template PER SCAN whether or not anyone exports.
 *
 * THE THREE DECISIONS WORTH KNOWING
 * ---------------------------------
 * 1. FILTERS LIVE IN THE URL. `?q=&severity=&status=&page=` is the state. Back
 *    goes back, refresh keeps the view, and "my urgent scans" is a link.
 * 2. FILTERING IS CLIENT-SIDE ON PURPOSE. `/patient/scans/<id>` takes no query
 *    parameters at all — it returns the whole history in one array. Pretending
 *    otherwise would mean either a fake round trip per keystroke or a filter that
 *    silently only searched the page you were on.
 * 3. THE PDF IS BUILT ON DEMAND. See lib/scanPdf.js: one off-screen node, built
 *    when the button is pressed and torn down immediately after.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FileText, RefreshCw, ScanLine, ShieldOff } from 'lucide-react';

import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  Field,
  SearchInput,
  Select,
  SeverityBadge,
  StatusBadge,
} from '../../components/ui';
import SensitiveImage from '../../components/media/SensitiveImage';
import { scans as scanEndpoints } from '../../lib/endpoints';
import { get } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { PATHS } from '../../routes';

import PageHeader from './components/PageHeader';
import ScanDetailDrawer from './components/ScanDetailDrawer';
import { useResource } from './hooks/usePatientData';
import { formatConfidence, formatDate } from './lib/format';

const PAGE_SIZE = 10;

const SEVERITY_OPTIONS = [
  { value: '', label: 'Any severity' },
  { value: 'CRITICAL', label: 'Critical' },
  { value: 'URGENT', label: 'Urgent' },
  { value: 'ROUTINE', label: 'Routine' },
];

const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Reviewed', label: 'Reviewed' },
  { value: 'Completed', label: 'Completed' },
];

/** Everything a row can be searched by, flattened once per row. */
function searchHaystack(scan) {
  return [scan.disease, scan.doctor_name, scan.severity, scan.status, scan.review_status, scan.doctor_comment]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default function PatientScansPage() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const [params, setParams] = useSearchParams();
  const [openScanId, setOpenScanId] = useState(null);

  const q = params.get('q') || '';
  const severity = params.get('severity') || '';
  const status = params.get('status') || '';
  const page = Math.max(1, Number(params.get('page')) || 1);

  /**
   * Write one filter without clobbering the others, and drop back to page 1 —
   * a filter that leaves you on page 4 of a one-page result is a blank screen
   * with no explanation.
   */
  const setParam = useCallback((key, value) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value); else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    }, { replace: true });
  }, [setParams]);

  const { data, loading, error, refetch } = useResource(
    (signal) => get(scanEndpoints.forPatient(userId), { signal }),
    { deps: [userId], enabled: Boolean(userId), initialData: [] },
  );

  const allScans = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allScans.filter((scan) => {
      if (severity && String(scan.severity || 'ROUTINE').toUpperCase() !== severity) return false;
      if (status && String(scan.status || '') !== status) return false;
      if (needle && !searchHaystack(scan).includes(needle)) return false;
      return true;
    });
  }, [allScans, q, severity, status]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const rows = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  const hasFilters = Boolean(q || severity || status);
  const clearFilters = () => setParams(new URLSearchParams(), { replace: true });

  /**
   * The drawer holds an ID, not a row. Holding the row would leave the drawer
   * showing pre-refetch data after a sensitivity flip or a deletion.
   */
  const openScan = useMemo(
    () => (openScanId === null ? null : allScans.find((scan) => scan.id === openScanId) || null),
    [openScanId, allScans],
  );

  const columns = useMemo(() => [
    {
      key: 'image',
      header: 'Photo',
      width: '5.5rem',
      render: (scan) => (
        <SensitiveImage
          scanId={scan.id}
          variant="thumb"
          sensitive={scan.is_sensitive}
          deletedAt={scan.image_deleted_at}
          hasImage={scan.has_image !== false}
          alt={`Scan from ${formatDate(scan.created_at)}`}
          compact
          className="h-14 w-14"
        />
      ),
    },
    {
      key: 'disease',
      header: 'Prediction',
      sortable: true,
      render: (scan) => (
        <div className="min-w-0">
          <p className="truncate font-body text-label-md text-default">{scan.disease || 'Unclassified'}</p>
          <p className="font-numeric text-caption tabular-nums text-muted">
            {formatConfidence(scan.confidence)} confidence
          </p>
        </div>
      ),
    },
    {
      key: 'severity',
      header: 'Severity',
      sortable: true,
      render: (scan) => <SeverityBadge severity={scan.severity || 'ROUTINE'} size="sm" />,
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (scan) => <StatusBadge status={scan.status || 'Pending'} size="sm" />,
    },
    {
      key: 'doctor_name',
      header: 'Doctor',
      hideOnMobile: true,
      render: (scan) => (
        <span className="text-body-sm text-muted">
          {scan.doctor_name && scan.doctor_name !== 'N/A' ? scan.doctor_name : 'Not yet assigned'}
        </span>
      ),
    },
    {
      key: 'created_at',
      header: 'Date',
      sortable: true,
      accessor: (scan) => scan.created_at || '',
      render: (scan) => <span className="text-body-sm text-muted">{formatDate(scan.created_at)}</span>,
    },
  ], []);

  const mobileCard = useCallback((scan) => (
    <button
      type="button"
      onClick={() => setOpenScanId(scan.id)}
      className={[
        'flex w-full items-start gap-3 rounded-card border border-subtle bg-surface p-3 text-left',
        'outline-none transition-colors hover:border-default',
        'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
      ].join(' ')}
    >
      <SensitiveImage
        scanId={scan.id}
        variant="thumb"
        sensitive={scan.is_sensitive}
        deletedAt={scan.image_deleted_at}
        hasImage={scan.has_image !== false}
        alt=""
        compact
        className="h-16 w-16 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-body text-label-md text-default">{scan.disease || 'Unclassified'}</p>
        <p className="font-numeric text-caption tabular-nums text-muted">
          {formatConfidence(scan.confidence)} · {formatDate(scan.created_at)}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <SeverityBadge severity={scan.severity || 'ROUTINE'} size="sm" />
          <StatusBadge status={scan.status || 'Pending'} size="sm" />
          {scan.is_sensitive && (
            <span className="inline-flex items-center gap-1 font-body text-caption text-muted">
              <ShieldOff className="h-3 w-3" aria-hidden="true" /> Sensitive
            </span>
          )}
        </div>
      </div>
    </button>
  ), []);

  if (!userId) {
    return (
      <>
        <PageHeader title="My scans" />
        <Alert tone="warning" title="Not signed in">
          We could not work out which account this is. Please sign in again.
        </Alert>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="My scans"
        description="Every scan you have run, with its report, the doctor's comment and its history."
        actions={
          <>
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<RefreshCw className="h-4 w-4" />}
              onClick={refetch}
              loading={loading && allScans.length > 0}
            >
              Refresh
            </Button>
            <Button as={Link} to={PATHS.CONSULT} size="sm" leftIcon={<ScanLine className="h-4 w-4" />}>
              New scan
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
          <div className="sm:w-64">
            <SearchInput
              defaultValue={q}
              onDebouncedChange={(value) => setParam('q', value)}
              onClear={() => setParam('q', '')}
              placeholder="Search prediction, doctor, comment"
              aria-label="Search your scans"
            />
          </div>
          <Field label="Severity" className="sm:w-40">
            <Select
              value={severity}
              options={SEVERITY_OPTIONS}
              onChange={(event) => setParam('severity', event.target.value)}
            />
          </Field>
          <Field label="Status" className="sm:w-40">
            <Select
              value={status}
              options={STATUS_OPTIONS}
              onChange={(event) => setParam('status', event.target.value)}
            />
          </Field>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="self-start">
              Clear
            </Button>
          )}
        </div>
      </PageHeader>

      {error && (
        <Alert
          tone="danger"
          title="We could not load your scans"
          className="mb-4"
          actions={<Button size="sm" variant="outline" onClick={refetch}>Try again</Button>}
        >
          {error}
        </Alert>
      )}

      <DataTable
        columns={columns}
        data={rows}
        loading={loading && allScans.length === 0}
        loadingRows={5}
        caption="Your scan history"
        rowKey={(scan) => scan.id}
        onRowClick={(scan) => setOpenScanId(scan.id)}
        mobileCard={mobileCard}
        empty={
          hasFilters ? (
            <EmptyState
              icon={<FileText className="h-6 w-6" aria-hidden="true" />}
              title="No scans match those filters"
              description="Try a different search term, or clear the filters to see everything."
              action={<Button variant="outline" onClick={clearFilters}>Clear filters</Button>}
            />
          ) : (
            <EmptyState
              icon={<ScanLine className="h-6 w-6" aria-hidden="true" />}
              title="No scans yet"
              description="Upload a photo of the area you are worried about and the AI gives you a first read in a few seconds."
              action={<Button as={Link} to={PATHS.CONSULT}>Run your first scan</Button>}
            />
          )
        }
        pagination={
          filtered.length > PAGE_SIZE
            ? {
                page: safePage,
                pageSize: PAGE_SIZE,
                total: filtered.length,
                onPageChange: (next) => setParam('page', next > 1 ? String(next) : ''),
              }
            : undefined
        }
      />

      <ScanDetailDrawer
        scan={openScan}
        open={Boolean(openScan)}
        onClose={() => setOpenScanId(null)}
        onChanged={refetch}
        onDeleted={() => {
          setOpenScanId(null);
          refetch();
        }}
      />
    </>
  );
}
