/**
 * AdminScansPage — oversight over every scan, and the one deletion that is
 * genuinely irreversible.
 *
 * TWO DELETIONS THAT MUST NEVER BE CONFUSED
 * -----------------------------------------
 * A patient exercising erasure calls `DELETE /api/scans/<id>/image`: the pixels
 * are purged from disk and the `ai_scans` row — prediction, confidence,
 * severity, triage reasons, the doctor's comment, the linked appointments —
 * SURVIVES. That is the point: a patient withdrawing a photo must not silently
 * rewrite a clinician's notes or erase an audit trail.
 *
 * `DELETE /api/admin/scans/<id>`, on this page, is the opposite. It destroys the
 * clinical record itself. There is no undo and nothing is retained. So the
 * confirmation states that in those words, requires the reason to be typed
 * before the button arms, and points at the softer option first.
 *
 * PHOTOS ARE NOT DECORATION
 * -------------------------
 * Every preview goes through <SensitiveImage>, which honours `is_sensitive` and
 * `image_deleted_at` and makes the full-resolution reveal an explicit, audited
 * act. The ImageAccessLogPanel in the inspector then shows exactly who has
 * taken that act, which is what turns "admins can see everything" into
 * something a patient could be told about honestly.
 */

import React, { useMemo, useState } from 'react';
import { AlertTriangle, Filter, ScanLine, Trash2 } from 'lucide-react';

import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Drawer,
  EmptyState,
  Field,
  Input,
  Modal,
  ModalFooter,
  SearchInput,
  Select,
  SeverityBadge,
  StatusBadge,
  Textarea,
  cn,
  notify,
} from '../../components/ui';
import SensitiveImage from '../../components/media/SensitiveImage';
import { del } from '../../lib/api';
import { admin as adminEndpoints } from '../../lib/endpoints';
import { formatConfidence, formatDateTime, formatDiseaseName } from '../../lib/format';
import { useAuth } from '../../context/AuthContext';
import { AdminPage, AdminTable, FilterBar, SegmentedFilter, StackCell } from './components/AdminPage';
import { ImageAccessLogPanel } from './components/ImageAccessLogPanel';
import { ImpersonationNotice } from './components/ImpersonationNotice';
import { ViewAsPicker } from './components/ViewAsPicker';
import { usePaginatedQuery } from './hooks/usePaginatedQuery';

/** `ai_scans.severity_level` — these exact strings, never re-cased. */
const SEVERITY_OPTIONS = [
  { value: '', label: 'Any severity' },
  { value: 'CRITICAL', label: 'Critical' },
  { value: 'URGENT', label: 'Urgent' },
  { value: 'ROUTINE', label: 'Routine' },
];

/** `ai_scans.status`. */
const STATUS_OPTIONS = [
  { value: '', label: 'Any status' },
  { value: 'Local', label: 'Local' },
  { value: 'Pending', label: 'Pending' },
  { value: 'Reviewed', label: 'Reviewed' },
];

/** True when the pixels are gone but the record is not. */
const isImageDeleted = (scan) => Boolean(scan?.image_deleted_at);

function ScanThumb({ scan, size = 'h-14 w-14' }) {
  return (
    <SensitiveImage
      scanId={scan.id}
      variant="thumb"
      sensitive={Boolean(scan.is_sensitive)}
      deletedAt={scan.image_deleted_at}
      hasImage={Boolean(scan.image_endpoint) && !isImageDeleted(scan)}
      alt={`Scan #${scan.id}`}
      compact
      className={cn('shrink-0 overflow-hidden rounded-md border border-subtle', size)}
    />
  );
}

/**
 * The inspector. Full record, a revealable photo, and who has revealed it.
 */
function ScanInspector({ scan, open, onClose, onDelete }) {
  if (!scan) return null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      size="lg"
      title={`Scan #${scan.id}`}
      description={`${scan.patient_name || 'Unknown patient'} · ${formatDateTime(scan.created_at)}`}
      footer={(
        <div className="flex flex-wrap justify-between gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button
            variant="danger"
            onClick={() => onDelete(scan)}
            leftIcon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          >
            Delete record
          </Button>
        </div>
      )}
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 sm:flex-row">
          <SensitiveImage
            scanId={scan.id}
            variant="blur"
            sensitive={Boolean(scan.is_sensitive)}
            deletedAt={scan.image_deleted_at}
            hasImage={Boolean(scan.image_endpoint) && !isImageDeleted(scan)}
            canReveal={!isImageDeleted(scan)}
            alt={`Scan #${scan.id} photograph`}
            className="h-48 w-full shrink-0 overflow-hidden rounded-lg border border-subtle sm:w-48"
          />
          <dl className="grid min-w-0 flex-1 grid-cols-2 gap-3 text-body-sm">
            <div>
              <dt className="text-caption text-muted">Prediction</dt>
              <dd className="font-medium">{formatDiseaseName(scan.prediction)}</dd>
            </div>
            <div>
              <dt className="text-caption text-muted">Confidence</dt>
              <dd className="tabular-nums">{formatConfidence(scan.confidence)}</dd>
            </div>
            <div>
              <dt className="text-caption text-muted">Severity</dt>
              <dd><SeverityBadge severity={scan.severity_level} /></dd>
            </div>
            <div>
              <dt className="text-caption text-muted">Triage score</dt>
              <dd className="tabular-nums">{scan.triage_score ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-caption text-muted">Status</dt>
              <dd><StatusBadge status={scan.status || 'Local'} /></dd>
            </div>
            <div>
              <dt className="text-caption text-muted">Review</dt>
              <dd>{scan.review_status || '—'}</dd>
            </div>
          </dl>
        </div>

        {scan.is_sensitive ? (
          <Alert tone="warning" title="The patient marked this photo sensitive">
            Previews are blurred for everyone but them. Asking for the full resolution is an explicit
            act and is recorded in the access log below, with your name on it.
          </Alert>
        ) : null}

        {isImageDeleted(scan) ? (
          <Alert tone="neutral" title="The patient deleted this photo">
            The pixels were purged on {formatDateTime(scan.image_deleted_at)}. Everything clinical —
            the prediction, the severity, the doctor’s comment — was deliberately kept.
          </Alert>
        ) : null}

        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-caption text-muted">Patient</dt>
            <dd className="text-body-sm">
              {scan.patient_name || '—'}
              <span className="block text-caption text-muted">{scan.patient_email}</span>
            </dd>
          </div>
          <div>
            <dt className="text-caption text-muted">Assigned doctor</dt>
            <dd className="text-body-sm">
              {scan.doctor_name || <span className="italic text-muted">Not assigned</span>}
            </dd>
          </div>
        </dl>

        {scan.doctor_comment ? (
          <div className="rounded-lg border border-subtle bg-surface-sunken p-3">
            <p className="text-caption text-muted">Doctor’s comment</p>
            <p className="mt-1 whitespace-pre-wrap text-body-sm">{scan.doctor_comment}</p>
          </div>
        ) : null}

        <ImageAccessLogPanel scanId={scan.id} enabled={open} />
      </div>
    </Drawer>
  );
}

/**
 * The irreversible one. Typed reason + explicit acknowledgement, and it names
 * the softer alternative before the button arms.
 */
function HardDeleteDialog({ scan, open, onClose, onDeleted }) {
  const [typed, setTyped] = useState('');
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  React.useEffect(() => {
    setTyped('');
    setReason('');
    setAck(false);
    setError(null);
  }, [scan?.id, open]);

  if (!scan) return null;

  const armed = typed.trim().toUpperCase() === 'DELETE' && ack && reason.trim().length > 0;

  const submit = async () => {
    if (!armed) return;
    setBusy(true);
    setError(null);
    try {
      const result = await del(adminEndpoints.deleteScan(scan.id), {
        body: { reason: reason.trim(), confirm_text: 'DELETE' },
      });
      const purged = Number(result?.purged_files ?? 0);
      notify.success(`Scan #${scan.id} destroyed${purged ? ` (${purged} file${purged === 1 ? '' : 's'} purged)` : ''}.`);
      onDeleted(scan.id);
      onClose();
    } catch (err) {
      setError(err?.message || 'The scan could not be deleted.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={`Permanently destroy scan #${scan.id}`}
      description={`${scan.patient_name || 'Unknown patient'} · ${formatDiseaseName(scan.prediction)}`}
      footer={(
        <ModalFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="danger"
            onClick={submit}
            disabled={!armed}
            loading={busy}
            leftIcon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          >
            Destroy this record
          </Button>
        </ModalFooter>
      )}
    >
      <div className="flex flex-col gap-4">
        <Alert
          tone="danger"
          title="This is irreversible and destroys the clinical record"
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
        >
          The prediction, confidence, severity, triage reasoning and the doctor’s comment are deleted
          along with the photo. Nothing is retained and there is no undo.
        </Alert>

        <Alert tone="info" title="If the patient just wants the photo gone, this is the wrong tool">
          Their own image deletion purges the pixels and <strong>keeps</strong> the record, so the
          doctor’s notes and the audit trail survive. Use this only for genuinely bad data — a test
          upload, a duplicate, or a photo that should never have been on the platform.
        </Alert>

        <Field
          label="Why is this being destroyed?"
          hint="Recorded before the row disappears. Without it there is nothing left to explain the gap."
          required
        >
          <Textarea
            rows={2}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Test upload created during a demo; not a real patient."
          />
        </Field>

        <Checkbox
          checked={ack}
          onChange={(event) => setAck(event.target.checked)}
          label="I understand the clinical record is destroyed, not just the image."
        />

        <Field label="Type DELETE to confirm" error={error || undefined}>
          <Input
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            placeholder="DELETE"
          />
        </Field>
      </div>
    </Modal>
  );
}

export default function AdminScansPage() {
  const { actingAs } = useAuth();
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [person, setPerson] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [inspecting, setInspecting] = useState(null);
  const [deleting, setDeleting] = useState(null);

  const filters = useMemo(() => ({
    severity,
    status,
    patient: person,
    date_from: dateFrom,
    date_to: dateTo,
  }), [severity, status, person, dateFrom, dateTo]);

  const query = usePaginatedQuery({
    path: adminEndpoints.scans,
    filters,
    enabled: !actingAs,
  });

  // SearchInput is uncontrolled (it owns its debounce), so "Clear filters" has
  // to remount it or the box keeps showing a term that is no longer applied.
  const [resetKey, setResetKey] = useState(0);

  const dirty = Boolean(severity || status || person || dateFrom || dateTo);
  const reset = () => {
    setSeverity('');
    setStatus('');
    setPerson('');
    setDateFrom('');
    setDateTo('');
    setResetKey((n) => n + 1);
  };

  const columns = [
    {
      key: 'image',
      header: 'Photo',
      width: '5rem',
      render: (row) => <ScanThumb scan={row} />,
    },
    {
      key: 'patient_name',
      header: 'Patient',
      render: (row) => (
        <StackCell primary={row.patient_name || `User #${row.user_id}`} secondary={row.patient_email} />
      ),
    },
    {
      key: 'prediction',
      header: 'Prediction',
      render: (row) => (
        <StackCell
          primary={formatDiseaseName(row.prediction)}
          secondary={`${formatConfidence(row.confidence)} confidence`}
        />
      ),
    },
    {
      key: 'severity_level',
      header: 'Severity',
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <SeverityBadge severity={row.severity_level} />
          {row.is_sensitive ? <Badge tone="warning" size="sm" variant="outline">Sensitive</Badge> : null}
          {isImageDeleted(row) ? <Badge tone="neutral" size="sm" variant="outline">Photo deleted</Badge> : null}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      hideOnMobile: true,
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <StatusBadge status={row.status || 'Local'} />
          {row.doctor_name ? (
            <span className="truncate text-caption text-muted">{row.doctor_name}</span>
          ) : null}
        </div>
      ),
    },
    {
      key: 'created_at',
      header: 'Uploaded',
      hideOnMobile: true,
      render: (row) => (
        <span className="whitespace-nowrap text-body-sm">{formatDateTime(row.created_at)}</span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (row) => (
        <div className="flex flex-wrap items-center justify-end gap-1">
          <Button size="sm" variant="outline" onClick={() => setInspecting(row)}>
            Inspect
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDeleting(row)}
            aria-label={`Delete scan ${row.id}`}
            className="text-danger-600 hover:bg-danger-50 dark:text-danger-400 dark:hover:bg-danger-950/40"
            leftIcon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
          >
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <AdminPage
      title="Scans"
      description="Every AI analysis on the platform. Photos stay blurred until someone deliberately asks for the full resolution — and the access log records who did."
      actions={<ViewAsPicker />}
      banner={<ImpersonationNotice />}
      paused={Boolean(actingAs)}
    >
      <FilterBar onRefresh={query.refetch} busy={query.refreshing} onReset={dirty ? reset : undefined}>
        <SegmentedFilter
          label="Severity"
          options={SEVERITY_OPTIONS}
          value={severity}
          onChange={setSeverity}
        />
        <div className="w-full sm:w-44">
          <Field label="Status">
            <Select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              options={STATUS_OPTIONS}
            />
          </Field>
        </div>
        <div className="w-full sm:w-56">
          <SearchInput
            key={`patient-${resetKey}`}
            placeholder="Patient name or email"
            onDebouncedChange={setPerson}
            aria-label="Filter by patient"
          />
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
        caption="Every scan on the platform"
        onRowClick={(row) => setInspecting(row)}
        empty={(
          <EmptyState
            icon={dirty
              ? <Filter className="h-6 w-6" aria-hidden="true" />
              : <ScanLine className="h-6 w-6" aria-hidden="true" />}
            title={dirty ? 'No scan matches these filters' : 'No scans yet'}
            description={dirty
              ? 'Widen the date range or clear the severity filter.'
              : 'Scans appear here as soon as a patient runs an analysis.'}
            action={dirty
              ? <Button variant="outline" size="sm" onClick={reset}>Clear filters</Button>
              : undefined}
          />
        )}
        mobileCard={(row) => (
          <button
            type="button"
            onClick={() => setInspecting(row)}
            className="flex w-full items-start gap-3 rounded-lg border border-subtle bg-surface p-4 text-left hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
          >
            <ScanThumb scan={row} size="h-16 w-16" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                {formatDiseaseName(row.prediction)}
              </p>
              <p className="truncate text-caption text-muted">
                {row.patient_name || `User #${row.user_id}`} · {formatDateTime(row.created_at)}
              </p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                <SeverityBadge severity={row.severity_level} size="sm" />
                <StatusBadge status={row.status || 'Local'} size="sm" />
                {row.is_sensitive ? <Badge tone="warning" size="sm" variant="outline">Sensitive</Badge> : null}
              </div>
            </div>
          </button>
        )}
      />

      <ScanInspector
        scan={inspecting}
        open={Boolean(inspecting)}
        onClose={() => setInspecting(null)}
        onDelete={(scan) => {
          setInspecting(null);
          setDeleting(scan);
        }}
      />

      <HardDeleteDialog
        scan={deleting}
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onDeleted={query.removeItem}
      />
    </AdminPage>
  );
}
