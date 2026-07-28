/**
 * StepResult — the verdict, how much to trust it, and what to do about it.
 *
 * WHAT CHANGED (round 1)
 * ----------------------
 * The old result screen was terminal: a disease name, a percentage, and a
 * "Continue" button that marched you to /nearby-doctors. There was no way back
 * to the photo, no way to re-run the model, and, critically, an emergency
 * verdict was a DEAD END. You found out it was critical only after the report
 * had been dispatched to a single doctor, and the page's only advice was to go
 * to a hospital. Booking was not offered.
 *
 * Now the severity comes from POST /api/triage-preview, which SCORES WITHOUT
 * WRITING ANYTHING, so it can be shown here before the patient has committed to
 * sending anything to anybody. An emergency is a loud banner, not a wall: the
 * Next button still works, and the review step will pre-tick "express".
 *
 * WHAT CHANGED (this round)
 * -------------------------
 * This screen is the emotional centre of the product and it read like a form. It
 * is now a clinical result:
 *
 *   1. A VERDICT HERO. The condition is the headline, tinted by severity, with
 *      the analysed photo presented as a clinical image beside it.
 *   2. A CONFIDENCE GAUGE instead of a progress bar. Same bands, same wording,
 *      same threshold copy, but an arc a person reads in one glance. The svg is
 *      decorative; the whole gauge is one `role="img"` with a written label, so
 *      a screen reader hears one sentence rather than a bar and two spans.
 *   3. TRIAGE AS FACTS PLUS REASONS, scannable rather than a paragraph.
 *   4. RECOMMENDATIONS, from `lib/recommendations.js`, keyed on SEVERITY and not
 *      on the predicted disease. Read that module's header before touching the
 *      content: the backend returns no treatment data, so per-disease advice
 *      here would be invention. Every panel is labelled as general information
 *      and sits beside the "only a dermatologist can diagnose" line.
 *   5. THE THREE FIELDS THE API ALREADY RETURNED AND THIS SCREEN IGNORED:
 *      `disease_tier` / `disease_tier_known`, `express_recommended` and
 *      `expires_in_hours`. See TRIAGE DETAILS below for why they need a local
 *      capture rather than a reducer field.
 *
 * TRIAGE DETAILS: WHY THE LOCAL CAPTURE
 * -------------------------------------
 * `normalizeTriage()` keeps four fields (severity, score, reasons, emergency)
 * and its shape is pinned by consultFlow.test.js, so the other three arrive in
 * the response and are dropped on the floor. `previewTriage()` RETURNS the raw
 * payload, so we keep what we need here, in the step that renders it, plus a
 * module-level memo keyed on disease + answers so walking to the Symptoms step
 * and back does not re-score just to recover a deadline. When the memo misses we
 * re-read the score ONCE (the endpoint is read-only and writes nothing); when it
 * cannot be read at all the fields simply do not render. Nothing here is ever
 * derived or guessed: an absent value is an absent row.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  ClipboardCheck,
  Clock,
  EyeOff,
  HandHeart,
  Info,
  Microscope,
  ShieldAlert,
  Siren,
  Sparkles,
  Stethoscope,
  Zap,
} from 'lucide-react';

import {
  Alert,
  Badge,
  Button,
  SEVERITY_PRESETS,
  SeverityBadge,
  Skeleton,
  cn,
} from '../../../components/ui';
import { formatDiseaseName } from '../../../lib/format';
import { useConsult } from '../ConsultContext';
import { STEP_IDS, symptomAnswersPayload } from '../consultReducer';
import {
  GENERAL_INFO_LABEL,
  GENERAL_INFO_NOTE,
  PANEL_TITLES,
  diseaseTierNote,
  normalizeSeverity,
  recommendationsFor,
  replyWindowText,
} from '../lib/recommendations';

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

/**
 * Presentation only: the verdict panel is tinted by the triage severity, so an
 * urgent result reads as urgent before a single word is read. Token scales flip
 * in dark mode, so each pair holds up in both themes, and the tint is a soft
 * two-stop wash rather than a flat block. Nothing white sits on these, so the
 * white-on-gradient contrast rule does not apply.
 */
const SEVERITY_PANEL_CLASSES = {
  critical: 'border-danger-200 bg-gradient-to-br from-danger-50 via-surface to-danger-50',
  urgent: 'border-warning-200 bg-gradient-to-br from-warning-50 via-surface to-warning-50',
  routine: 'border-success-200 bg-gradient-to-br from-success-50 via-surface to-success-50',
};
/** `border-subtle` is invisible on a sunken surface in light mode, so: default. */
const DEFAULT_PANEL_CLASSES =
  'border-default bg-gradient-to-br from-surface-sunken via-surface to-surface-sunken';

/** Tonal icon chips. Single classes: the scales already flip in dark mode. */
const TONE_CHIP = {
  neutral: 'bg-neutral-100 text-neutral-700',
  primary: 'bg-primary-100 text-primary-700',
  accent: 'bg-accent-100 text-accent-700',
  info: 'bg-info-100 text-info-700',
  success: 'bg-success-100 text-success-700',
  warning: 'bg-warning-100 text-warning-700',
  danger: 'bg-danger-100 text-danger-700',
};

/** List bullets, one per tone. */
const TONE_DOT = {
  neutral: 'bg-neutral-400',
  primary: 'bg-primary-500',
  accent: 'bg-accent-500',
  info: 'bg-info-500',
  success: 'bg-success-500',
  warning: 'bg-warning-500',
  danger: 'bg-danger-500',
};

/** Gauge arc colours, and the matching band-label text colour. */
const GAUGE_STROKE = {
  neutral: 'stroke-neutral-400',
  primary: 'stroke-primary-600',
  success: 'stroke-success-600',
  warning: 'stroke-warning-500',
  danger: 'stroke-danger-600',
};
const GAUGE_LABEL = {
  neutral: 'text-muted',
  primary: 'text-primary-700',
  success: 'text-success-700',
  warning: 'text-warning-800',
  danger: 'text-danger-700',
};

const GAUGE_SIZE = 128;
const GAUGE_THICKNESS = 11;
/** Three quarters of the ring, with the gap at the bottom. */
const GAUGE_SWEEP = 0.75;

/**
 * The confidence, as an arc.
 *
 * ACCESSIBILITY: the wrapper is a single `role="img"` with an `aria-label`
 * sentence, which makes the whole thing one leaf node for assistive tech. That
 * is deliberate: the numbers and the band word are the visual channel, the label
 * is the text alternative, and doing it this way means neither is announced
 * twice. `tabular-nums` keeps the percentage from dancing as it changes.
 *
 * @param {object} props
 * @param {number|null} props.percent 0..100, or null when the model reported none.
 * @param {{tone:string, label:string}} props.band
 */
function ConfidenceGauge({ percent, band }) {
  const radius = (GAUGE_SIZE - GAUGE_THICKNESS) / 2;
  const circumference = 2 * Math.PI * radius;
  const arc = circumference * GAUGE_SWEEP;
  const value = percent === null ? 0 : Math.min(Math.max(percent, 0), 100);
  const filled = arc * (value / 100);

  const label = percent === null
    ? 'Model confidence: not reported by the model.'
    : `Model confidence: ${percent} percent, ${band.label.toLowerCase()}.`;

  return (
    <div
      role="img"
      aria-label={label}
      className="relative shrink-0"
      style={{ width: GAUGE_SIZE, height: GAUGE_SIZE }}
    >
      <svg
        aria-hidden="true"
        width={GAUGE_SIZE}
        height={GAUGE_SIZE}
        viewBox={`0 0 ${GAUGE_SIZE} ${GAUGE_SIZE}`}
        className="rotate-[135deg]"
      >
        <circle
          cx={GAUGE_SIZE / 2}
          cy={GAUGE_SIZE / 2}
          r={radius}
          fill="none"
          strokeWidth={GAUGE_THICKNESS}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${circumference}`}
          className="stroke-neutral-200"
        />
        {percent !== null && (
          <circle
            cx={GAUGE_SIZE / 2}
            cy={GAUGE_SIZE / 2}
            r={radius}
            fill="none"
            strokeWidth={GAUGE_THICKNESS}
            strokeLinecap="round"
            strokeDasharray={`${filled} ${circumference}`}
            className={cn(
              'transition-[stroke-dasharray] duration-700 ease-emphasized motion-reduce:transition-none',
              GAUGE_STROKE[band.tone] ?? GAUGE_STROKE.neutral,
            )}
          />
        )}
      </svg>

      <span className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
        {percent === null ? (
          <span className="px-3 text-center text-caption text-muted">Not reported</span>
        ) : (
          <span className="font-heading text-display-sm tabular-nums text-default">
            {percent}
            <span className="align-top text-label-md">%</span>
          </span>
        )}
        <span
          className={cn(
            'text-overline uppercase',
            GAUGE_LABEL[band.tone] ?? GAUGE_LABEL.neutral,
          )}
        >
          {band.label}
        </span>
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The three fields the reducer does not keep
// ---------------------------------------------------------------------------

/** Same inputs `previewTriage()` posts, so a memo hit is genuinely the same score. */
function triageDetailsKey(disease, answers) {
  return `${String(disease || '')}|${answers ? JSON.stringify(answers) : 'not-asked'}`;
}

/**
 * Pull the three extra fields out of a raw `/api/triage-preview` payload.
 * Anything missing or unusable stays null so the UI renders nothing rather than
 * a number nobody promised.
 */
function readTriageDetails(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const hours = Number(payload.expires_in_hours);
  return {
    tier: normalizeSeverity(payload.disease_tier),
    // Only an explicit `false` means "not in the table"; an absent flag is not
    // evidence either way, so the note is suppressed by `tier` being null.
    tierKnown: payload.disease_tier_known !== false,
    expressRecommended: typeof payload.express_recommended === 'boolean'
      ? payload.express_recommended
      : null,
    expiresInHours: Number.isFinite(hours) && hours > 0 ? hours : null,
  };
}

/**
 * Survives this step unmounting (only the active step is rendered), so
 * Result -> Symptoms -> Result does not re-score to recover a deadline it
 * already had. Keyed, so a changed answer can never show a stale window.
 * @type {{key:string, details:object}|null}
 */
let LAST_TRIAGE_DETAILS = null;

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

  const detailsKey = triageDetailsKey(analysis.disease, answers);
  const [detailsMemo, setDetailsMemo] = useState(LAST_TRIAGE_DETAILS);
  const details = detailsMemo && detailsMemo.key === detailsKey ? detailsMemo.details : null;

  /** StrictMode remounts, so this is re-armed on mount, not just initialised. */
  const mounted = useRef(true);
  /** The last key we asked the server about, so a failed capture cannot loop. */
  const askedFor = useRef(null);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  /**
   * Score, and KEEP the three fields the reducer drops. Used by the effect below
   * and by "Retry scoring", so a manual retry recovers the deadline too instead
   * of leaving those rows permanently blank for this scan.
   */
  const captureTriage = useCallback(() => {
    askedFor.current = detailsKey;
    previewTriage().then((payload) => {
      if (!mounted.current) return;
      const parsed = readTriageDetails(payload);
      if (!parsed) return;
      LAST_TRIAGE_DETAILS = { key: detailsKey, details: parsed };
      setDetailsMemo(LAST_TRIAGE_DETAILS);
    });
  }, [detailsKey, previewTriage]);

  /**
   * Score the scan as soon as we have a disease.
   *
   * TWO reasons to call, and both are guarded against re-entry:
   *  - `idle`: nothing has been scored yet. TRIAGE_START flips the status to
   *    'loading' synchronously, so this cannot loop even though `previewTriage`
   *    is a fresh closure on every render.
   *  - `success` with no memoised details: we arrived after the score was
   *    computed on another step. Re-reading is safe (the endpoint writes
   *    nothing) but it is done ONCE per key, tracked on a ref rather than a
   *    cancellation flag: a flag torn down by the next dependency change would
   *    discard the very response it was waiting for and then ask again forever.
   */
  useEffect(() => {
    if (analysis.status !== 'success' || !analysis.disease) return;
    const firstScore = triage.status === 'idle';
    const recoverDetails = triage.status === 'success' && !details;
    if (!firstScore && !recoverDetails) return;
    if (recoverDetails && askedFor.current === detailsKey) return;
    captureTriage();
  }, [analysis.status, analysis.disease, triage.status, details, detailsKey, captureTriage]);

  const band = confidenceBand(analysis.confidence);
  const percent = analysis.confidence === null ? null : Math.round(analysis.confidence * 100);
  const severity = triage.severity || analysis.severity || null;
  const diseaseName = prettyDisease(formatDiseaseName(analysis.disease, { placeholder: '' }));
  const panelClasses =
    SEVERITY_PANEL_CLASSES[String(severity || '').toLowerCase()] || DEFAULT_PANEL_CLASSES;

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
  /**
   * Curated, severity-keyed advice. It is only rendered once the scoring call
   * has settled: showing the "no severity came back" fallback while the score is
   * still in flight would tell the patient something untrue for a second.
   */
  const advice = recommendationsFor(severity);
  const showAdvice = triage.status === 'success' || triage.status === 'error';
  const advicePanels = [
    {
      id: 'nextSteps',
      title: PANEL_TITLES.nextSteps,
      icon: <ClipboardCheck className="h-4 w-4" />,
      tone: advice.tone,
      items: advice.nextSteps,
    },
    {
      id: 'selfCare',
      title: PANEL_TITLES.selfCare,
      icon: <HandHeart className="h-4 w-4" />,
      tone: 'accent',
      items: advice.selfCare,
    },
    {
      id: 'redFlags',
      title: PANEL_TITLES.redFlags,
      icon: <Siren className="h-4 w-4" />,
      tone: 'danger',
      items: advice.redFlags,
    },
  ];

  const tierLabel = details?.tier ? SEVERITY_PRESETS[details.tier]?.label ?? details.tier : null;
  const tierNote = details?.tier ? diseaseTierNote(details.tier, details.tierKnown) : null;
  const replyWindow = details
    ? replyWindowText(details.expiresInHours, { express: details.expressRecommended === true })
    : null;

  return (
    <div className="flex flex-col gap-6">
      {/* -------------------------------------------------------- emergency --
          Loud, and deliberately NOT a gate: the Next button still works. */}
      {triage.status === 'success' && triage.isEmergency && (
        <Alert
          tone="danger"
          title="This looks like it needs urgent attention"
          icon={<ShieldAlert aria-hidden="true" className="h-5 w-5" />}
        >
          If it is bleeding heavily, spreading quickly or you feel unwell, contact emergency care
          now. Do not wait for a reply here.{' '}
          <strong className="font-semibold">
            You can still book: carry on and mark the request as express.
          </strong>{' '}
          That is deliberate. An urgent result used to stop you from booking at all.
        </Alert>
      )}

      {/* ----------------------------------------------------------- verdict --
          The hero: severity tint, the condition as the headline, the analysed
          image as a clinical figure, and the confidence gauge. */}
      <section className={cn('rounded-card border p-4 shadow-soft sm:p-5', panelClasses)}>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
          {/* ------------------------------------------------- clinical image -- */}
          <figure className="shrink-0">
            <div className="relative h-32 w-32 overflow-hidden rounded-card border border-default bg-surface-sunken shadow-card sm:h-44 sm:w-44">
              {image.previewUrl || image.dataUrl ? (
                <>
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
                  {/* Hairline over the photo, so a pale image still has an edge. */}
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-0 rounded-card ring-1 ring-inset ring-white/15"
                  />
                </>
              ) : (
                <div className="flex h-full w-full items-center justify-center text-caption text-subtle">
                  No preview
                </div>
              )}
            </div>
            <figcaption className="mt-2 space-y-1">
              <span className="flex items-center gap-1.5 text-caption text-muted">
                <Microscope aria-hidden="true" className="h-3.5 w-3.5" />
                The image the model read
              </span>
              {image.isSensitive && (
                <span className="flex items-center gap-1 text-caption text-accent-700 dark:text-accent-400">
                  <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />
                  Marked sensitive
                </span>
              )}
            </figcaption>
          </figure>

          {/* ----------------------------------------------------- headline -- */}
          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-overline uppercase text-subtle">Most likely match</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
                  <h3 className="font-heading text-display-sm text-default">
                    {diseaseName}
                  </h3>
                  {triage.status === 'success' && severity && (
                    <SeverityBadge severity={severity} />
                  )}
                </div>
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

            {/* --------------------------------------------------- confidence -- */}
            <div className="flex flex-col items-center gap-4 rounded-card border border-default bg-surface/70 p-4 sm:flex-row sm:items-center sm:gap-5">
              <ConfidenceGauge percent={percent} band={band} />
              <div className="min-w-0 flex-1 text-center sm:text-left">
                <p className="text-label-md text-default">Model confidence</p>
                <p className="mt-1 text-body-sm text-muted">{band.copy}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------ triage -- */}
      <section
        aria-live="polite"
        className="rounded-card border border-subtle bg-surface p-4 shadow-soft sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className={cn(
                'flex h-9 w-9 shrink-0 items-center justify-center rounded-field',
                TONE_CHIP.primary,
              )}
            >
              <Sparkles className="h-4 w-4" />
            </span>
            <h3 className="text-label-lg text-default">Triage severity</h3>
          </div>
          <span className="flex flex-wrap items-center gap-2">
            {details?.expressRecommended === true && (
              <Badge tone="warning" size="sm" icon={<Zap aria-hidden="true" />}>
                Fast lane
              </Badge>
            )}
            {triage.status === 'success' && severity && <SeverityBadge severity={severity} />}
          </span>
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
              <Button variant="ghost" size="sm" onClick={captureTriage}>Retry scoring</Button>
            }
          >
            {triage.error || 'Could not score this scan right now.'} The result above still stands.
          </Alert>
        )}

        {triage.status === 'success' && (
          <>
            {/* ------------------------------------------------------- facts -- */}
            <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {severity && (
                <div className="rounded-field border border-default bg-surface-sunken p-3">
                  <dt className="text-overline uppercase text-subtle">Severity</dt>
                  <dd className="mt-1.5">
                    <SeverityBadge severity={severity} size="sm" />
                  </dd>
                </div>
              )}
              {triage.score !== null && (
                <div className="rounded-field border border-default bg-surface-sunken p-3">
                  <dt className="text-overline uppercase text-subtle">Triage score</dt>
                  <dd className="mt-1 font-heading text-heading-sm tabular-nums text-default">
                    {triage.score}
                  </dd>
                </div>
              )}
              {tierLabel && (
                <div className="rounded-field border border-default bg-surface-sunken p-3">
                  <dt className="text-overline uppercase text-subtle">Condition tier</dt>
                  <dd className="mt-1.5">
                    <Badge
                      tone={details.tierKnown ? 'primary' : 'neutral'}
                      size="sm"
                      uppercase
                    >
                      {details.tierKnown ? tierLabel : 'Not listed'}
                    </Badge>
                  </dd>
                </div>
              )}
            </dl>

            {/* ----------------------------------------------------- reasons -- */}
            <p className="mt-4 text-label-md text-default">Why it scored this way</p>
            {triage.reasons.length > 0 ? (
              <ul className="mt-2 space-y-2">
                {triage.reasons.map((reason) => (
                  <li
                    key={reason}
                    className="flex items-start gap-2.5 rounded-field border border-default bg-surface-sunken p-3"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-pill bg-primary-500"
                    />
                    <span className="min-w-0 text-body-sm text-muted">{reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-body-sm text-muted">
                Nothing pushed the score above routine.
              </p>
            )}

            {(tierNote || replyWindow) && (
              <div className="mt-3 space-y-1.5">
                {tierNote && (
                  <p className="flex items-start gap-2 text-caption text-subtle">
                    <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{tierNote}</span>
                  </p>
                )}
                {replyWindow && (
                  <p className="flex items-start gap-2 text-caption text-subtle">
                    <Clock aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>{replyWindow}</span>
                  </p>
                )}
              </div>
            )}

            {answers === null && (
              <div className="mt-3 flex flex-wrap items-center gap-3 rounded-field border border-default bg-surface-sunken p-3">
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-field',
                    TONE_CHIP.info,
                  )}
                >
                  <Info className="h-4 w-4" />
                </span>
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

      {/* --------------------------------------------------- recommendations --
          Curated, keyed on SEVERITY, and labelled as general information on
          every panel. See lib/recommendations.js before editing a word of it. */}
      {showAdvice && (
        <section
          aria-labelledby="consult-advice-title"
          className="rounded-card border border-subtle bg-surface p-4 shadow-soft sm:p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-2.5">
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-field',
                  TONE_CHIP[advice.tone] ?? TONE_CHIP.neutral,
                )}
              >
                <Stethoscope className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <h3 id="consult-advice-title" className="text-label-lg text-default">
                  {advice.headline}
                </h3>
                <p className="mt-1 text-body-sm text-muted">{advice.summary}</p>
              </div>
            </div>
            <Badge tone={advice.tone} size="sm">{advice.timeframe}</Badge>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-3">
            {advicePanels.map((panel) => (
              <article
                key={panel.id}
                className="flex flex-col rounded-card border border-default bg-surface-sunken p-4"
              >
                <div className="flex items-start gap-2.5">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-field',
                      TONE_CHIP[panel.tone] ?? TONE_CHIP.neutral,
                    )}
                  >
                    {panel.icon}
                  </span>
                  <div className="min-w-0">
                    <h4 className="text-label-md text-default">{panel.title}</h4>
                    <Badge tone="neutral" size="sm" className="mt-1.5">
                      {GENERAL_INFO_LABEL}
                    </Badge>
                  </div>
                </div>
                <ul className="mt-3 space-y-2">
                  {panel.items.map((item) => (
                    <li key={item} className="flex items-start gap-2">
                      <span
                        aria-hidden="true"
                        className={cn(
                          'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-pill',
                          TONE_DOT[panel.tone] ?? TONE_DOT.neutral,
                        )}
                      />
                      <span className="min-w-0 text-body-sm text-muted">{item}</span>
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      )}

      {/* --------------------------------------------------------- what next -- */}
      <div className="flex items-start gap-3 rounded-card border border-subtle bg-surface p-4 shadow-soft">
        <span
          aria-hidden="true"
          className={cn(
            'flex h-9 w-9 shrink-0 items-center justify-center rounded-field',
            TONE_CHIP.info,
          )}
        >
          <Stethoscope className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-label-md text-default">What happens next</p>
          <p className="mt-1 text-body-sm text-muted">
            This is a screening aid. Only a qualified dermatologist can diagnose a skin condition,
            which is what the next steps are for.
          </p>
          <p className="mt-2 text-caption text-subtle">{GENERAL_INFO_NOTE}</p>
        </div>
      </div>
    </div>
  );
}
