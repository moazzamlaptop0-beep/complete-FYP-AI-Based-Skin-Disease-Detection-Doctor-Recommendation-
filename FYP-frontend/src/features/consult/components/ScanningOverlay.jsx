/**
 * ScanningOverlay — the "your photo is being looked at" experience.
 *
 * WHAT THIS REPLACES
 * ------------------
 * Pressing "Analyse this photo" used to change exactly two things on screen: a
 * spinner appeared inside the button, and the next step drew a skeleton. For a
 * request that routinely takes several seconds against a CNN that is not enough
 * feedback to feel like anything is happening at all, and the most common
 * reaction to silence is a second press.
 *
 * So the photo itself becomes the progress indicator: a reticle frames it, a
 * sweep line travels down it, and a four-stage rail underneath says what is
 * actually going on.
 *
 * HONESTY RULES THIS COMPONENT OBEYS
 * ----------------------------------
 * 1. IT NEVER CLAIMS TO BE FINISHED. The determinate bar counts stages that
 *    have genuinely COMPLETED, so the stage in flight contributes nothing. The
 *    bar therefore cannot reach its maximum while anyone is still waiting —
 *    there is no "99% then hang", and no reassuring fill that outruns the
 *    server.
 * 2. THE STAGE IS PASSED IN, NOT INVENTED HERE. The caller drives it from real
 *    state (`busy` while the crop/compression pipeline runs on this device,
 *    `analysis.status === 'loading'` while POST /predict is in flight,
 *    `triage.status === 'loading'` while the score is being fetched). Give it
 *    `stage={null}` and it renders an indeterminate bar instead of guessing.
 * 3. EARLIER STAGES ARE ONLY MARKED DONE WHEN THEY REALLY ARE. Reaching
 *    'upload' means the file HAS been cropped and compressed; reaching 'score'
 *    means the model HAS answered. That is why the rail can tick them off.
 *
 * The one inference: a plain `fetch` cannot tell the client when the last byte
 * of the upload landed and the model started, so a caller that wants the
 * 'upload' -> 'model' handover uses a short timer. That is an estimate about
 * WHICH truthful thing is happening inside one request that is genuinely still
 * in flight, never a claim that something finished.
 *
 * MOTION
 * ------
 * Every animated layer is decorative and `aria-hidden`. Under
 * `prefers-reduced-motion: reduce` the sweep is removed outright and the grid
 * and reticle stop moving; the staged copy, the progress bar and the aria-live
 * announcement carry the whole message on their own.
 *
 * REUSE
 * -----
 * Lives in components/, not in the step, because the result step shows the same
 * thing while it fetches the triage score. Pass `stage="score"` there.
 */

import React from 'react';
import { Activity, Check, Cpu, Lock, ScanSearch, ShieldCheck } from 'lucide-react';

import { Progress, cn } from '../../../components/ui';

/**
 * The pipeline, in order. `label` is what the patient reads, `hint` is the one
 * extra sentence that makes it trustworthy rather than mysterious.
 *
 * Kept module-private on purpose: exporting a non-component from a component
 * file breaks Fast Refresh for the whole file, and callers only ever need the
 * `stage` id, which is a plain string.
 */
const STAGES = [
  {
    id: 'prepare',
    icon: ScanSearch,
    label: 'Preparing the photo',
    hint: 'Cropping and compressing on this device.',
  },
  {
    id: 'upload',
    icon: Lock,
    label: 'Uploading securely',
    hint: 'Only the crop leaves your phone.',
  },
  {
    id: 'model',
    icon: Cpu,
    label: 'Running the model',
    hint: 'The classifier is reading the skin in the frame.',
  },
  {
    id: 'score',
    icon: Activity,
    label: 'Scoring the result',
    hint: 'Working out how urgently this needs a doctor.',
  },
];

/**
 * Keyframes for the three decorative layers. Injected as a scoped <style> tag
 * rather than added to tailwind.config.js so this component stays a single,
 * self-contained file, and namespaced `consult-scan-*` so it cannot collide
 * with the app's hand-rolled animation classes.
 *
 * The reduced-motion block is here rather than only on the elements because it
 * must hold even if a caller forgets the `motion-reduce:` utilities.
 */
const SCAN_CSS = `
@keyframes consult-scan-sweep {
  0%   { transform: translateY(-100%); opacity: 0; }
  12%  { opacity: 1; }
  88%  { opacity: 1; }
  100% { transform: translateY(400%); opacity: 0; }
}
@keyframes consult-scan-drift {
  from { background-position: 0 0; }
  to   { background-position: 0 32px; }
}
@keyframes consult-scan-breathe {
  0%, 100% { opacity: 0.45; }
  50%      { opacity: 0.9; }
}
.consult-scan-sweep { animation: consult-scan-sweep 2.6s cubic-bezier(0.4, 0, 0.2, 1) infinite; }
.consult-scan-grid  { animation: consult-scan-drift 3.2s linear infinite; }
.consult-scan-frame { animation: consult-scan-breathe 2.6s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  .consult-scan-sweep { display: none; }
  .consult-scan-grid,
  .consult-scan-frame { animation: none; }
}
`;

/** The measuring grid. A background image, so it costs no extra elements. */
const GRID_STYLE = {
  backgroundImage:
    'repeating-linear-gradient(to bottom, rgb(255 255 255 / 0.16) 0 1px, transparent 1px 32px),'
    + 'repeating-linear-gradient(to right, rgb(255 255 255 / 0.16) 0 1px, transparent 1px 32px)',
  backgroundSize: '32px 32px',
};

/** One corner bracket of the reticle. */
function Corner({ className }) {
  return (
    <span
      aria-hidden="true"
      className={cn('absolute h-7 w-7 border-aqua-400 consult-scan-frame', className)}
    />
  );
}

/**
 * @param {object} props
 * @param {string} [props.src] The photo being examined. Omit to render the rail
 *   on its own (useful when the caller has no preview to show).
 * @param {string} [props.alt] Alt text for that photo.
 * @param {'prepare'|'upload'|'model'|'score'|null} [props.stage] The stage that
 *   is happening RIGHT NOW. `null` / unknown renders an indeterminate bar.
 * @param {string} [props.title] Heading above the rail.
 * @param {string} [props.note] One extra reassurance under the rail.
 * @param {string} [props.className]
 */
export function ScanningOverlay({
  src,
  alt = 'The photo being analysed',
  stage = null,
  title = 'Analysing your photo',
  note,
  className,
}) {
  const index = STAGES.findIndex((entry) => entry.id === stage);
  const known = index >= 0;
  const active = known ? STAGES[index] : null;

  // COMPLETED stages only. The one in flight deliberately adds nothing, which
  // is what stops the bar from ever filling while the user is still waiting.
  const done = known ? index : 0;

  return (
    <section
      aria-busy="true"
      aria-label={title}
      className={cn(
        'overflow-hidden rounded-card border border-subtle bg-surface shadow-card',
        className,
      )}
    >
      <style>{SCAN_CSS}</style>

      {src && (
        /* Fixed navy, not a flipping scale: the examination surface has to stay
           dark in BOTH themes, because the caption sitting on it is white. */
        <div className="relative isolate bg-navy-950">
          <img
            src={src}
            alt={alt}
            className="mx-auto block max-h-72 w-full object-contain opacity-95 sm:max-h-80"
          />

          {/* ------------------------------------------- decorative layers -- */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0">
            {/* Measuring grid. */}
            <span
              className="absolute inset-0 opacity-40 consult-scan-grid"
              style={GRID_STYLE}
            />

            {/* The sweep: a wide glow with a bright core line at its bottom
                edge, travelling from above the frame to below it. */}
            <span className="absolute left-0 right-0 top-0 h-1/4 consult-scan-sweep motion-reduce:hidden">
              <span className="absolute inset-0 bg-gradient-to-b from-transparent via-aqua-400/20 to-aqua-400/45" />
              {/* The glow, then the crisp leading edge on top of it. */}
              <span className="absolute inset-x-0 bottom-0 h-1 bg-aqua-400/70 blur-sm" />
              <span className="absolute inset-x-0 bottom-0 h-px bg-aqua-200" />
            </span>

            {/* Reticle. Four brackets read as "framed for examination" without
                boxing the lesion in and implying the model found something. */}
            <span className="absolute inset-6 sm:inset-8">
              <Corner className="left-0 top-0 border-l-2 border-t-2 rounded-tl-sm" />
              <Corner className="right-0 top-0 border-r-2 border-t-2 rounded-tr-sm" />
              <Corner className="bottom-0 left-0 border-b-2 border-l-2 rounded-bl-sm" />
              <Corner className="bottom-0 right-0 border-b-2 border-r-2 rounded-br-sm" />
            </span>

            {/* Readability veil for the caption. */}
            <span className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-navy-950 via-navy-950/70 to-transparent" />
          </div>

          {/* ------------------------------------------------- the caption -- */}
          <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
            <p className="flex items-center gap-2 text-overline uppercase text-aqua-300">
              <span
                aria-hidden="true"
                className="inline-block h-1.5 w-1.5 shrink-0 rounded-pill bg-aqua-300 animate-pulse motion-reduce:animate-none"
              />
              Scanning
            </p>
            <p className="mt-1 font-heading text-heading-sm text-white">
              {active ? active.label : 'Working on your photo'}
            </p>
            <p className="mt-0.5 text-caption text-white/75">
              {active ? active.hint : 'This usually takes a few seconds.'}
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------- the rail -- */}
      <div className="p-4 sm:p-5">
        <Progress
          value={done}
          min={0}
          max={STAGES.length}
          indeterminate={!known}
          tone="accent"
          size="sm"
          striped
          label={title}
          showValue
          valueText={known ? `Stage ${index + 1} of ${STAGES.length}` : undefined}
        />

        <ol className="mt-4 grid gap-2.5 sm:grid-cols-2">
          {STAGES.map((entry, position) => {
            const state = !known
              ? 'pending'
              : position < index
                ? 'done'
                : position === index
                  ? 'active'
                  : 'pending';
            const StageIcon = entry.icon;

            return (
              <li
                key={entry.id}
                className={cn(
                  'flex items-start gap-2.5 rounded-field border p-2.5 transition-colors',
                  state === 'active' && 'border-accent-300 bg-accent-50',
                  state === 'done' && 'border-default bg-surface-sunken',
                  state === 'pending' && 'border-transparent',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid h-7 w-7 shrink-0 place-items-center rounded-pill',
                    state === 'done' && 'bg-success-100 text-success-700',
                    state === 'active' && 'bg-accent-100 text-accent-700',
                    state === 'pending' && 'bg-surface-sunken text-subtle',
                  )}
                >
                  {state === 'done' ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <StageIcon
                      className={cn(
                        'h-3.5 w-3.5',
                        state === 'active' && 'animate-pulse motion-reduce:animate-none',
                      )}
                    />
                  )}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block text-label-md',
                      state === 'pending' ? 'text-subtle' : 'text-default',
                    )}
                  >
                    {entry.label}
                  </span>
                  {state !== 'pending' && (
                    <span className="mt-0.5 block text-caption text-muted">{entry.hint}</span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>

        <p className="mt-3 flex items-start gap-2 text-caption text-subtle">
          <ShieldCheck
            aria-hidden="true"
            className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-700 dark:text-accent-400"
          />
          {note || 'Nothing is shared with a doctor while this runs.'}
        </p>
      </div>

      {/* THE one announcement. Polite, so it waits for a gap rather than
          interrupting, and it names the stage plus its position so a screen
          reader user gets the same information the rail shows visually. */}
      <p aria-live="polite" className="ui-sr-only">
        {active
          ? `Stage ${index + 1} of ${STAGES.length}. ${active.label}. ${active.hint}`
          : 'Working on your photo.'}
      </p>
    </section>
  );
}

export default ScanningOverlay;
