/**
 * ScanReportTemplate — the printable form of one scan.
 *
 * This is NEVER mounted by a page. `lib/scanPdf.js` renders it into a detached
 * 800px-wide node, rasterises that node, and throws it away — which is the whole
 * fix. Today PatientHistory mounts one hidden 800px template for EVERY scan in
 * the list on every render, so a patient with forty scans pays for forty
 * off-screen report layouts and forty `<img>` requests to produce zero PDFs.
 *
 * LAYOUT CONSTRAINTS (html2canvas, not taste)
 * -------------------------------------------
 * - Margins, not flex `gap`. Gap support in html2canvas 1.4.1 is patchy and a
 *   collapsed gap silently overlaps text in the export.
 * - No box-shadow, no transforms: neither is rasterised.
 * - The image is a data URI supplied by the caller. html2canvas issues its own
 *   fetches for `<img src>` and those carry no Authorization header, so an
 *   authenticated image renders as an empty box.
 * - Semantic tokens are still used here; `scanPdf.js` strips the `dark` class
 *   from the CLONED document before rasterising, so the export is always the
 *   light palette even when the app is in dark mode.
 */

import React from 'react';

import { formatConfidence, formatDate, formatAnswer, humanizeKey, confidencePercent } from '../lib/format';

function Row({ label, value }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <tr>
      <td className="w-40 border-b border-subtle py-2 pr-3 align-top font-body text-body-sm text-muted">
        {label}
      </td>
      <td className="border-b border-subtle py-2 align-top font-body text-body-sm text-default">{value}</td>
    </tr>
  );
}

function Section({ title, children }) {
  return (
    <section className="mt-6">
      <h2 className="mb-2 font-heading text-label-lg uppercase tracking-[0.06em] text-muted">{title}</h2>
      {children}
    </section>
  );
}

/**
 * @param {object} props
 * @param {object} props.scan A `/patient/scans/<id>` row.
 * @param {string} [props.patientName]
 * @param {string|null} [props.imageDataUrl] Inlined bytes, or null.
 * @param {string[]} [props.triageReasons]
 * @param {object|null} [props.answers] Parsed questionnaire.
 */
export function ScanReportTemplate({ scan, patientName, imageDataUrl, triageReasons = [], answers = null }) {
  const percent = confidencePercent(scan?.confidence);
  const answerEntries = answers && typeof answers === 'object' ? Object.entries(answers) : [];

  return (
    <div className="w-[800px] bg-surface p-10 font-body text-default">
      {/* ------------------------------------------------------------ head -- */}
      <div className="border-b-2 border-default pb-4">
        <h1 className="font-heading text-heading-md text-default">AI Dermatologist — Scan report</h1>
        <p className="mt-1 font-body text-body-sm text-muted">
          Generated {formatDate(new Date().toISOString())}
          {patientName ? ` · ${patientName}` : ''}
          {scan?.id ? ` · Reference #${scan.id}` : ''}
        </p>
      </div>

      {/* ----------------------------------------------------------- photo -- */}
      {imageDataUrl ? (
        <div className="mt-6">
          <img
            src={imageDataUrl}
            alt=""
            className="max-h-80 w-auto rounded-card border border-subtle"
          />
        </div>
      ) : (
        <p className="mt-6 rounded-card border border-dashed border-subtle p-3 font-body text-body-sm text-muted">
          {scan?.image_deleted_at
            ? 'The photograph was deleted by the patient. The findings below are retained in full.'
            : 'No photograph is included in this export.'}
        </p>
      )}

      {/* --------------------------------------------------------- finding -- */}
      <Section title="AI finding">
        <p className="font-heading text-heading-sm text-default">{scan?.disease || 'Unclassified'}</p>
        <p className="mt-1 font-numeric text-body-sm tabular-nums text-muted">
          Model confidence {formatConfidence(scan?.confidence)}
        </p>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-pill bg-neutral-200">
          <div className="h-full rounded-pill bg-primary-600" style={{ width: `${percent}%` }} />
        </div>
      </Section>

      {/* ---------------------------------------------------------- detail -- */}
      <Section title="Record">
        <table className="w-full border-collapse text-left">
          <tbody>
            <Row label="Scan date" value={formatDate(scan?.created_at)} />
            <Row label="Severity" value={scan?.severity || 'ROUTINE'} />
            <Row label="Status" value={scan?.status || 'Pending'} />
            <Row label="Review status" value={scan?.review_status} />
            <Row
              label="Doctor"
              value={scan?.doctor_name && scan.doctor_name !== 'N/A' ? scan.doctor_name : 'Not yet assigned'}
            />
          </tbody>
        </table>
      </Section>

      {triageReasons.length > 0 && (
        <Section title="Why this severity">
          <ul className="ml-4 list-disc">
            {triageReasons.map((reason, index) => (
              <li key={index} className="mb-1 font-body text-body-sm text-default">{String(reason)}</li>
            ))}
          </ul>
        </Section>
      )}

      {scan?.doctor_comment && (
        <Section title="Doctor's comment">
          <p className="whitespace-pre-wrap rounded-card border border-subtle bg-surface-sunken p-3 font-body text-body-sm text-default">
            {scan.doctor_comment}
          </p>
        </Section>
      )}

      {answerEntries.length > 0 && (
        <Section title="Your answers">
          <table className="w-full border-collapse text-left">
            <tbody>
              {answerEntries.map(([key, value]) => (
                <Row key={key} label={humanizeKey(key)} value={formatAnswer(value)} />
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* ---------------------------------------------------------- footer -- */}
      <p className="mt-8 border-t border-subtle pt-4 font-body text-caption leading-relaxed text-muted">
        This report summarises an automated image analysis and any comment a clinician added to it. It is a
        screening aid, not a diagnosis, and it does not replace an in-person examination. If your symptoms
        change or worsen, seek medical care.
      </p>
    </div>
  );
}

export default ScanReportTemplate;
