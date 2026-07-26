/**
 * ScanDetailDrawer — one scan, in full, without leaving the history.
 *
 * WHAT THIS REPLACES
 * ------------------
 * PatientHistory has no detail view at all: the doctor's comment is truncated
 * into a table cell, the triage reasoning is never shown, and the only way to
 * see the photograph at a usable size is to open `/static/uploads/…` directly —
 * a world-readable URL. Here the photo comes through `SensitiveImage` (the
 * server decides which bytes you get) and everything the row carries is laid
 * out in one scrollable panel.
 *
 * WHY THE DRAWER TAKES A ROW, NOT AN ID IT FETCHES ITSELF
 * ------------------------------------------------------
 * There is no `GET /api/scans/<id>` on this backend — `/patient/scans/<user_id>`
 * returns the whole history in one array and that array IS the source of truth.
 * The page therefore owns the data and passes the row down; after a sensitivity
 * flip or a deletion the page refetches and the drawer re-renders from the new
 * row. A second fetch here would only give us a stale copy to disagree with.
 *
 * TWO FIELDS ARE OPTIONAL BY NECESSITY
 * ------------------------------------
 * `triage_reasons` and the questionnaire are stored on the scan but are NOT in
 * the 18-key patient listing (they are on the appointment-request payload and
 * the doctor's queue). Both blocks are therefore rendered only when the row
 * happens to carry them, rather than showing an empty "Why this severity"
 * heading to every patient forever.
 */

import React, { useState } from 'react';
import {
  CalendarDays,
  Download,
  FileText,
  Stethoscope,
  Trash2,
} from 'lucide-react';

import {
  Alert,
  Badge,
  Button,
  Drawer,
  Progress,
  SeverityBadge,
  StatusBadge,
  notify,
} from '../../../components/ui';
import SensitiveImage from '../../../components/media/SensitiveImage';
import { useAuth } from '../../../context/AuthContext';

import DeleteImageDialog from './DeleteImageDialog';
import SensitivityToggle from './SensitivityToggle';
import { exportScanPdf } from '../lib/scanPdf';
import {
  confidencePercent,
  formatAnswer,
  formatConfidence,
  formatDateTime,
  humanizeKey,
  parseMaybeJson,
} from '../lib/format';

function Section({ title, children, className }) {
  return (
    <section className={className}>
      <h3 className="mb-2 font-heading text-label-lg text-default">{title}</h3>
      {children}
    </section>
  );
}

function DetailRow({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-subtle py-2 last:border-b-0">
      <dt className="shrink-0 font-body text-body-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-right font-body text-body-sm text-default">{children}</dd>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object|null} props.scan A `/patient/scans/<user_id>` row.
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {() => void} [props.onChanged] Refetch after a sensitivity change.
 * @param {() => void} [props.onDeleted] Refetch after the photo is deleted.
 */
export function ScanDetailDrawer({ scan, open, onClose, onChanged, onDeleted }) {
  const { user } = useAuth();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState(null);

  if (!scan) return null;

  const triageReasons = parseMaybeJson(scan.triage_reasons, []) || [];
  const answers = parseMaybeJson(scan.questionnaire_answers ?? scan.patient_questionnaire, null);
  const answerEntries = answers && typeof answers === 'object' && !Array.isArray(answers)
    ? Object.entries(answers)
    : [];

  const deleted = Boolean(scan.image_deleted_at);
  const hasPhoto = scan.has_image !== false && !deleted;

  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    try {
      await exportScanPdf(scan, { patientName: user?.name || '' });
      notify.success('Your report has been downloaded.');
    } catch (err) {
      setExportError(err?.message || 'The report could not be generated.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <>
      <Drawer
        open={open}
        onClose={onClose}
        side="right"
        size="lg"
        title={scan.disease || 'Unclassified scan'}
        description={`Scanned ${formatDateTime(scan.created_at)} · reference #${scan.id}`}
        footer={
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              variant="ghost"
              size="sm"
              leftIcon={<Download className="h-4 w-4" />}
              onClick={handleExport}
              loading={exporting}
              loadingText="Building PDF"
            >
              Export as PDF
            </Button>
            {hasPhoto && (
              <Button
                variant="outline"
                size="sm"
                leftIcon={<Trash2 className="h-4 w-4" />}
                onClick={() => setDeleteOpen(true)}
              >
                Delete photo
              </Button>
            )}
          </div>
        }
      >
        <div className="flex flex-col gap-6">
          {exportError && (
            <Alert tone="danger" title="The export failed" onDismiss={() => setExportError(null)}>
              {exportError}
            </Alert>
          )}

          {/* ------------------------------------------------------- photo -- */}
          <SensitiveImage
            scanId={scan.id}
            variant="full"
            sensitive={scan.is_sensitive}
            deletedAt={scan.image_deleted_at}
            hasImage={scan.has_image !== false}
            alt={`Scan of ${scan.disease || 'the affected area'}`}
            canReveal
            revealSeconds={30}
            className="aspect-[4/3] w-full"
            imgClassName="object-contain"
          />

          {scan.is_sensitive && !deleted && (
            <p className="-mt-3 font-body text-caption text-muted">
              This photo is marked sensitive. Revealing the full image is recorded against your name,
              and it re-blurs automatically after 30 seconds.
            </p>
          )}

          {/* ----------------------------------------------------- finding -- */}
          <Section title="AI finding">
            <p className="font-heading text-heading-sm text-default">{scan.disease || 'Unclassified'}</p>
            <Progress
              className="mt-3"
              value={confidencePercent(scan.confidence)}
              label="Model confidence"
              valueText={`${formatConfidence(scan.confidence)} confidence`}
              showValue
              tone="primary"
            />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <SeverityBadge severity={scan.severity || 'ROUTINE'} />
              <StatusBadge status={scan.status || 'Pending'} />
              {scan.review_status && scan.review_status !== scan.status && (
                <Badge tone="neutral" variant="outline">{scan.review_status}</Badge>
              )}
              {scan.invite_to_clinic && <Badge tone="accent">Invited to clinic</Badge>}
            </div>
            <p className="mt-3 font-body text-caption leading-relaxed text-muted">
              This is an automated screening result, not a diagnosis. A dermatologist&apos;s review is
              what makes it clinical.
            </p>
          </Section>

          {/* ------------------------------------------------------ triage -- */}
          {triageReasons.length > 0 && (
            <Section title="Why this severity">
              <ul className="flex flex-col gap-1.5">
                {triageReasons.map((reason, index) => (
                  <li
                    key={index}
                    className="flex gap-2 font-body text-body-sm text-default"
                  >
                    <span aria-hidden="true" className="text-muted">·</span>
                    <span>{String(reason)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* ------------------------------------------------------ doctor -- */}
          <Section title="Doctor">
            <dl className="rounded-card border border-subtle bg-surface-sunken px-3 py-1">
              <DetailRow label="Assigned to">
                {scan.doctor_name && scan.doctor_name !== 'N/A' ? scan.doctor_name : 'Not yet assigned'}
              </DetailRow>
              {scan.doctor_email && <DetailRow label="Email">{scan.doctor_email}</DetailRow>}
              <DetailRow label="Last updated">{formatDateTime(scan.updated_at || scan.created_at)}</DetailRow>
            </dl>

            {scan.doctor_comment ? (
              <div className="mt-3 rounded-card border border-subtle bg-surface p-3">
                <p className="mb-1 flex items-center gap-1.5 font-body text-label-md text-default">
                  <Stethoscope className="h-4 w-4 text-muted" aria-hidden="true" />
                  Comment from your doctor
                </p>
                <p className="whitespace-pre-wrap font-body text-body-sm text-default">
                  {scan.doctor_comment}
                </p>
              </div>
            ) : (
              <p className="mt-3 flex items-start gap-2 font-body text-body-sm text-muted">
                <CalendarDays className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                No comment yet. Send this scan to a dermatologist from the AI Scan flow to have it
                reviewed.
              </p>
            )}
          </Section>

          {/* ----------------------------------------------- questionnaire -- */}
          {answerEntries.length > 0 && (
            <Section title="Your answers">
              <dl className="rounded-card border border-subtle bg-surface-sunken px-3 py-1">
                {answerEntries.map(([key, value]) => (
                  <DetailRow key={key} label={humanizeKey(key)}>{formatAnswer(value)}</DetailRow>
                ))}
              </dl>
            </Section>
          )}

          {/* -------------------------------------------------- your rating -- */}
          {scan.patient_rating ? (
            <Section title="Your rating">
              <p className="font-body text-body-sm text-default">
                {scan.patient_rating} out of 5
                {scan.patient_review ? ` — “${scan.patient_review}”` : ''}
              </p>
            </Section>
          ) : null}

          {/* ------------------------------------------------------ privacy -- */}
          <Section title="Privacy">
            {deleted ? (
              <Alert tone="neutral" icon={<FileText className="h-4 w-4" aria-hidden="true" />}>
                You deleted this photograph on {formatDateTime(scan.image_deleted_at)}. Everything above —
                the diagnosis, the severity, your doctor&apos;s comment and every appointment booked from
                it — is retained.
              </Alert>
            ) : (
              <SensitivityToggle scan={scan} onChanged={onChanged} />
            )}
          </Section>
        </div>
      </Drawer>

      <DeleteImageDialog
        scan={scan}
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onDeleted={onDeleted}
      />
    </>
  );
}

export default ScanDetailDrawer;
