/**
 * scanPdf.js — export one scan as a PDF, on demand.
 *
 * WHAT THIS REPLACES
 * ------------------
 * PatientHistory keeps a hidden `<div style="width:800px">` report template
 * mounted for EVERY scan in the list, permanently, so it can hand one to
 * html2canvas if the user ever presses Export. Forty scans means forty
 * off-screen layouts and forty image requests to produce zero PDFs.
 *
 * Here nothing exists until the button is pressed: the template is mounted into
 * a detached node, rasterised, and unmounted in a `finally`.
 *
 * THREE THINGS THAT ARE EASY TO GET WRONG
 * ---------------------------------------
 * 1. jspdf + html2canvas are ~600 kB together. They are `import()`ed inside the
 *    function so they are a separate chunk that only downloads on first export.
 * 2. html2canvas issues its OWN requests for `<img src>`, with no Authorization
 *    header — an authenticated `/api/scans/<id>/image` renders as a blank box.
 *    The bytes are therefore fetched through the session first and inlined as a
 *    data URI. For a SENSITIVE scan that fetch is `variant=full`, which the
 *    server audit-logs, so the caller must have told the user that.
 * 3. The export must be readable on paper whatever the app's theme is. Rather
 *    than hardcoding colours (and re-introducing raw hex), `onclone` strips the
 *    `dark` class from the CLONED document, so the light token values apply to
 *    the rasterised copy while the live page never flickers.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { fetchScanImageDataUrl } from '../../../components/media/SensitiveImage';
import ScanReportTemplate from '../components/ScanReportTemplate';
import { parseMaybeJson } from './format';

/** Page geometry, in points (72pt = 1in). A4 with a 24pt margin. */
const MARGIN = 24;

function safeFilename(scan) {
  const date = (scan?.created_at || '').slice(0, 10) || 'scan';
  const name = String(scan?.disease || 'scan').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
  return `ai-dermatologist-${name}-${date}.pdf`;
}

/**
 * @param {object} scan A `/patient/scans/<id>` row.
 * @param {{patientName?: string, includeImage?: boolean}} [options]
 * @returns {Promise<string>} the filename that was saved
 */
export async function exportScanPdf(scan, options = {}) {
  const { patientName = '', includeImage = true } = options;
  if (!scan) throw new Error('There is no scan to export.');

  // -- 1. the bytes, through the authenticated client ------------------------
  let imageDataUrl = null;
  const imageAvailable = includeImage && scan.has_image !== false && !scan.image_deleted_at;
  if (imageAvailable) {
    try {
      imageDataUrl = await fetchScanImageDataUrl(scan.id, 'full');
    } catch {
      // A missing photo must not cost the patient their report. The template
      // says so in words rather than leaving a hole.
      imageDataUrl = null;
    }
  }

  // -- 2. mount the template off-screen --------------------------------------
  const container = document.createElement('div');
  container.setAttribute('aria-hidden', 'true');
  Object.assign(container.style, {
    position: 'fixed',
    top: '0',
    left: '-10000px',
    width: '800px',
    // Off-screen rather than display:none — html2canvas cannot measure a node
    // that was never laid out.
    pointerEvents: 'none',
    zIndex: '-1',
  });
  document.body.appendChild(container);

  const root = createRoot(container);

  try {
    flushSync(() => {
      root.render(
        React.createElement(ScanReportTemplate, {
          scan,
          patientName,
          imageDataUrl,
          triageReasons: parseMaybeJson(scan.triage_reasons, []) || [],
          answers: parseMaybeJson(scan.questionnaire_answers ?? scan.patient_questionnaire, null),
        }),
      );
    });

    // Let the inlined image actually decode before rasterising.
    await Promise.all(
      Array.from(container.querySelectorAll('img')).map((img) =>
        (img.decode ? img.decode() : Promise.resolve()).catch(() => {}),
      ),
    );

    // -- 3. rasterise --------------------------------------------------------
    const [{ default: html2canvas }, jspdf] = await Promise.all([
      import('html2canvas'),
      import('jspdf'),
    ]);
    const JsPDF = jspdf.jsPDF || jspdf.default;

    const canvas = await html2canvas(container, {
      scale: 2, // legible text at print resolution
      logging: false,
      useCORS: true,
      imageTimeout: 15000,
      onclone: (clonedDocument) => {
        // Force the light palette on the copy only.
        clonedDocument.documentElement.classList.remove('dark');
        clonedDocument.documentElement.removeAttribute('data-theme');
      },
    });

    // -- 4. paginate ---------------------------------------------------------
    const pdf = new JsPDF({ unit: 'pt', format: 'a4', compress: true });
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const usableWidth = pageWidth - MARGIN * 2;
    const usableHeight = pageHeight - MARGIN * 2;
    const imageHeight = (canvas.height * usableWidth) / canvas.width;
    const imageData = canvas.toDataURL('image/png');

    pdf.addImage(imageData, 'PNG', MARGIN, MARGIN, usableWidth, imageHeight);

    // A long report is the SAME tall image drawn again at a negative offset —
    // the standard html2canvas/jsPDF paging trick, and the only one that keeps
    // the layout intact across the break.
    let consumed = usableHeight;
    while (consumed < imageHeight) {
      pdf.addPage();
      pdf.addImage(imageData, 'PNG', MARGIN, MARGIN - consumed, usableWidth, imageHeight);
      consumed += usableHeight;
    }

    const filename = safeFilename(scan);
    pdf.save(filename);
    return filename;
  } finally {
    // Unmount asynchronously: React refuses to unmount a root synchronously
    // from inside a lifecycle it may still consider active.
    setTimeout(() => {
      try { root.unmount(); } catch { /* already gone */ }
      container.remove();
    }, 0);
  }
}

export default exportScanPdf;
