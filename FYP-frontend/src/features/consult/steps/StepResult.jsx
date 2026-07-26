/**
 * StepResult — what the model saw, and the three ways to disagree with it.
 *
 * WHAT CHANGED
 * ------------
 * The old result screen was terminal: a disease name, a percentage, and a
 * "Continue" button that marched you to /nearby-doctors. There was no way back
 * to the photo, no way to re-run the model, and — critically — an emergency
 * verdict was a DEAD END. You found out it was critical only after the report
 * had been dispatched to a single doctor, and the page's only advice was to go
 * to a hospital. Booking was not offered.
 *
 * Now the severity comes from POST /api/triage-preview, which SCORES WITHOUT
 * WRITING ANYTHING, so it can be shown here before the patient has committed to
 * sending anything to anybody. An emergency is a loud banner, not a wall: the
 * Next button still works, and the review step will pre-tick "express".
 */

import React, { useEffect, useMemo } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  EyeOff,
  Info,
  ShieldAlert,
  Sparkles,
} from 'lucide-react';

import {
  Alert,
  Badge,
  Button,
  Progress,
  SeverityBadge,
  Skeleton,
  cn,
} from '../../../components/ui';
import { useConsult } from '../ConsultContext';
import { STEP_IDS, symptomAnswersPayload } from '../consultReducer';

import ResetMenu from './ResetMenu';

/** Confidence bands. The wording matters more than the number to a patient. */
function confidenceBand(confidence) {
  if (confidence === null || confidence === undefined) {
    return { tone: 'neutral', label: 'Unknown', copy: 'The model did not report a confidence.' };
  }
  if (confidence >= 0.85) {
    return {
      tone: 'success',
      label: 'High',
      copy: 'The model is confident, but it is still a screening tool, not a diagnosis.',
    };
  }
  if (confidence >= 0.6) {
    return {
      tone: 'primary',
      label: 'Moderate',
      copy: 'Reasonably confident. A dermatologist should confirm it.',
    };
  }
  if (confidence >= 0.4) {
    return {
      tone: 'warning',
      label: 'Low',
      copy: 'Not confident. A clearer, closer, better-lit photo often helps a lot.',
    };
  }
  return {
    tone: 'danger',
    label: 'Very low',
    copy: 'The model is guessing. Re-take the photo before you rely on this.',
  };
}

/** 'basal_cell_carcinoma' / 'Basal-Cell Carcinoma' -> 'Basal cell carcinoma'. */
function prettyDisease(value) {
  const text = String(value || '').replace(/[_-]+/g, ' ').trim();
  if (!text) return 'No clear match';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export default function StepResult() {
  const {
    state,
    analyze,
    previewTriage,
    resetResult,
    clearImage,
    resetAll,
    goToStepId,
  } = useConsult();

  const { analysis, triage, image } = state;
  const answers = symptomAnswersPayload(state);

  /**
   * Score the scan as soon as we have a disease. Guarded on `status === 'idle'`
   * — TRIAGE_START flips that to 'loading' synchronously, so this cannot loop
   * even though `previewTriage` is a fresh closure every render.
   */
  useEffect(() => {
    if (analysis.status !== 'success' || !analysis.disease) return;
    if (triage.status !== 'idle') return;
    previewTriage();
  }, [analysis.status, analysis.disease, triage.status, previewTriage]);

  const band = useMemo(() => confidenceBand(analysis.confidence), [analysis.confidence]);
  const percent = analysis.confidence === null ? null : Math.round(analysis.confidence * 100);
  const severity = triage.severity || analysis.severity || null;

  // ------------------------------------------------------------ loading ----
  if (analysis.status === 'loading') {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="flex items-center gap-3">
          <Skeleton className="h-24 w-24 rounded-card" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
        <Skeleton className="h-3 w-full rounded-pill" />
        <Skeleton className="h-20 w-full rounded-card" />
        <p className="text-center text-caption text-subtle">Analysing the photo…</p>
      </div>
    );
  }

  // -------------------------------------------------------------- error ----
  if (analysis.status === 'error') {
    return (
      <div className="space-y-4">
        <Alert
          tone="danger"
          title="The analysis failed"
          actions={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => analyze()}>Try again</Button>
              <Button size="sm" variant="ghost" onClick={clearImage}>Use a different photo</Button>
            </div>
          }
        >
          {analysis.error || 'Something went wrong on the way to the model.'}
        </Alert>
      </div>
    );
  }

  // --------------------------------------------------------------- idle ----
  if (analysis.status !== 'success') {
    return (
      <Alert
        tone="info"
        title="Nothing analysed yet"
        actions={
          <Button size="sm" onClick={() => goToStepId(STEP_IDS.CAPTURE)}>
            Back to the photo
          </Button>
        }
      >
        Add a photo on the previous step and run the analysis.
      </Alert>
    );
  }

  // ------------------------------------------------------------ success ----
  return (
    <div className="space-y-6">
      {/* -------------------------------------------------------- emergency -- */}
      {triage.status === 'success' && triage.isEmergency && (
        <Alert
          tone="danger"
          title="This looks like it needs urgent attention"
          icon={<ShieldAlert aria-hidden="true" className="h-5 w-5" />}
        >
          If it is bleeding heavily, spreading quickly or you feel unwell, contact emergency care
          now — do not wait for a reply here.{' '}
          <strong className="font-semibold">
            You can still book: carry on and mark the request as express.
          </strong>{' '}
          That is deliberate. An urgent result used to stop you from booking at all.
        </Alert>
      )}

      {/* ----------------------------------------------------------- verdict -- */}
      <div className="flex flex-col gap-5 sm:flex-row">
        {/* thumbnail */}
        <figure className="shrink-0">
          <div className="relative h-32 w-32 overflow-hidden rounded-card border border-subtle bg-surface-sunken sm:h-40 sm:w-40">
            {image.previewUrl || image.dataUrl ? (
              <img
                src={image.previewUrl || image.dataUrl}
                alt="The area you photographed"
                className={cn(
                  'h-full w-full object-cover',
                  // Own-eyes-only preview: the owner always sees it sharp. The
                  // blur that other people get is applied server-side by
                  // /api/scans/<id>/image, never here.
                  image.isSensitive && 'ring-2 ring-inset ring-accent-500',
                )}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-caption text-subtle">
                No preview
              </div>
            )}
          </div>
          {image.isSensitive && (
            <figcaption className="mt-2 flex items-center gap-1 text-caption text-accent-700 dark:text-accent-400">
              <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />
              Marked sensitive
            </figcaption>
          )}
        </figure>

        {/* headline */}
        <div className="min-w-0 flex-1 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-overline uppercase text-subtle">Most likely match</p>
              <h3 className="mt-1 font-heading text-display-sm text-default">
                {prettyDisease(analysis.disease)}
              </h3>
            </div>
            {/* ONLY offered while the File is still in memory. On a RESTORED
                draft the verdict and `scanId` come back but the File does not,
                and the old handler ran `resetResult()` (which wipes `scanId`)
                before `analyze()` discovered it had nothing to send — leaving a
                sendable request unsendable, with the server-side scan reference
                unrecoverable and the resulting error never rendered. ResetMenu
                hides the entry when no handler is given; "Replace photo" is the
                honest option in that state. */}
            <ResetMenu
              onReanalyze={image.file ? () => {
                resetResult();
                // The file is untouched, so we can go straight back to the model
                // without asking for the photo again.
                analyze(image.file);
              } : undefined}
              onReplacePhoto={clearImage}
              onStartOver={resetAll}
            />
          </div>

          {/* confidence */}
          <div>
            <div className="mb-1.5 flex items-baseline justify-between gap-3">
              <span className="text-label-md text-default">Model confidence</span>
              <span className="flex items-center gap-2">
                <Badge tone={band.tone} size="sm">{band.label}</Badge>
                <span className="font-heading text-heading-sm tabular-nums text-default">
                  {percent === null ? '—' : `${percent}%`}
                </span>
              </span>
            </div>
            <Progress
              value={percent ?? 0}
              tone={band.tone === 'neutral' ? 'primary' : band.tone}
              size="md"
              valueText={percent === null ? 'Confidence unknown' : `${percent}% confident`}
            />
            <p className="mt-1.5 text-caption text-muted">{band.copy}</p>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------ triage -- */}
      <section
        aria-live="polite"
        className="rounded-card border border-subtle bg-surface-sunken p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-label-lg text-default">
            <Sparkles aria-hidden="true" className="h-4 w-4 text-primary-600" />
            Triage severity
          </h3>
          {triage.status === 'success' && severity && <SeverityBadge severity={severity} />}
        </div>

        {triage.status === 'loading' && (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}

        {triage.status === 'error' && (
          <Alert
            tone="warning"
            className="mt-3"
            actions={
              <Button variant="ghost" size="sm" onClick={previewTriage}>Retry scoring</Button>
            }
          >
            {triage.error || 'Could not score this scan right now.'} The result above still stands.
          </Alert>
        )}

        {triage.status === 'success' && (
          <>
            {triage.reasons.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {triage.reasons.map((reason) => (
                  <li key={reason} className="flex gap-2 text-body-sm text-muted">
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-pill bg-primary-500"
                    />
                    <span>{reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-body-sm text-muted">
                Nothing pushed the score above routine.
              </p>
            )}

            {answers === null && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-field bg-surface p-3">
                <Info aria-hidden="true" className="h-4 w-4 shrink-0 text-primary-600" />
                <span className="min-w-0 flex-1 text-caption text-muted">
                  Scored from the photo alone. Six optional questions can sharpen this.
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => goToStepId(STEP_IDS.SYMPTOMS)}
                  rightIcon={<ArrowRight aria-hidden="true" className="h-4 w-4" />}
                >
                  Answer them
                </Button>
              </div>
            )}
          </>
        )}

        <p className="mt-3 text-caption text-subtle">
          Nothing has been sent to a doctor yet. This score is calculated without saving anything.
        </p>
      </section>

      {/* --------------------------------------------------------- low match -- */}
      {percent !== null && percent < 40 && (
        <Alert
          tone="warning"
          title="A better photo would help"
          icon={<AlertTriangle aria-hidden="true" className="h-5 w-5" />}
          actions={
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={clearImage}>Take another photo</Button>
              {/* Same guard as the reset menu: without the File this would only
                  destroy the saved scan reference. */}
              {image.file && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    resetResult();
                    analyze(image.file);
                  }}
                >
                  Re-analyse this one
                </Button>
              )}
            </div>
          }
        >
          At {percent}% the model is close to guessing. Fill the frame with the spot, use daylight,
          and hold the camera 10-15cm away.
        </Alert>
      )}

      <p className="text-caption text-subtle">
        This is a screening aid. Only a qualified dermatologist can diagnose a skin condition —
        which is what the next steps are for.
      </p>
    </div>
  );
}
