/**
 * StepSymptoms — the six triage questions, and the Skip that the old flow never
 * offered.
 *
 * WHAT CHANGED
 * ------------
 * Today the questionnaire is a MODAL that opens automatically after every scan
 * and cannot be dismissed without answering. It is the single biggest source of
 * abandonment in the flow: someone who just wants to know what the mole is gets
 * six clinical questions thrown at them before they are shown anything.
 *
 * Here it is a normal step, it is marked optional in the header, and "Skip" is a
 * first-class control at the TOP of the panel rather than a greyed-out link at
 * the bottom. Skipping is not the same as answering "no" six times — the
 * reducer keeps `skipped` separate from `answered`, and
 * `symptomAnswersPayload()` sends `answers: null` for a skip, which the backend
 * scores differently from six explicit falses. That distinction is why "None of
 * these apply" is a SEPARATE button next to Skip.
 *
 * The severity preview underneath re-scores as you answer, so the effect of an
 * answer is visible immediately and nothing is written to the database to get
 * it.
 *
 * PRESENTATION (round 2)
 * ----------------------
 * Each question is a large tappable option card: the whole card is the
 * Switch's own <label>, so clicking anywhere on it toggles the native input
 * and every existing aria/keyboard behaviour is untouched. Selected cards get
 * an accent border + tint; both states use flipping token scales so light and
 * dark mode read correctly with no stock colors.
 *
 * PRESENTATION (this round)
 * -------------------------
 * The cards now have THREE states, because the reducer has three:
 *
 *   flagged        answered yes. Accent border and tint, switch on.
 *   answered no    a solid, settled card. Switch off.
 *   not answered   a dashed card. Switch off, and visibly not the same thing.
 *
 * That third state used to be invisible: an untouched question and a question
 * answered "no" looked identical, which mattered because they are NOT identical
 * on the wire. `symptoms.answered` is one flag for all six (a frozen reducer
 * contract), so touching any question sends all six, and the progress panel says
 * so in as many words rather than leaving the user to discover it.
 *
 * A focus ring is on the CARD as well as the switch track (the same recipe
 * RadioGroup's card variant uses), so tabbing through six large cards shows you
 * which one you are on instead of highlighting a 44px toggle.
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { Activity, AlertTriangle, Check, ListChecks, SkipForward } from 'lucide-react';

import {
  Alert,
  Badge,
  Button,
  SeverityBadge,
  Skeleton,
  Switch,
  cn,
} from '../../../components/ui';
import { useConsult } from '../ConsultContext';
import {
  STEP_IDS,
  SYMPTOM_KEYS,
  SYMPTOM_QUESTIONS,
  symptomAnswersPayload,
  symptomFlagCount,
} from '../consultReducer';

/**
 * Card styling per state. Flipping token scales only, so both themes read
 * correctly, and the dashed edge carries "not answered" without relying on
 * colour alone.
 */
const CARD_STATE = {
  flagged: 'border-accent-500 bg-accent-50 shadow-card',
  answered: 'border-default bg-surface hover:border-strong',
  unanswered: 'border-dashed border-strong bg-surface hover:bg-surface-sunken',
};

/** The progress track's segments, in the same three states. */
const SEGMENT_STATE = {
  flagged: 'bg-warning-500',
  answered: 'bg-success-500',
  unanswered: 'bg-neutral-300',
};

/** Ring on the card itself, not just on the switch track. */
const CARD_FOCUS =
  'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus '
  + 'has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-canvas';

export default function StepSymptoms() {
  const {
    state,
    toggleSymptom,
    skipSymptoms,
    unskipSymptoms,
    previewTriage,
    goToStepId,
  } = useConsult();
  const { symptoms, triage, analysis } = state;

  const answers = symptomAnswersPayload(state);
  const flagged = symptomFlagCount(state);
  const hasScan = analysis.status === 'success';
  const total = SYMPTOM_QUESTIONS.length;

  /**
   * Re-score whenever the answers change. `triage.status === 'idle'` is the
   * whole guard: every SYMPTOM_TOGGLE resets triage to idle, and TRIAGE_START
   * flips it to 'loading' synchronously, so this can never loop even though
   * `previewTriage` is a new function on every render.
   */
  useEffect(() => {
    if (!hasScan) return;
    if (triage.status !== 'idle') return;
    previewTriage();
  }, [hasScan, triage.status, previewTriage]);

  /**
   * "None of these apply" — an explicit NO to all six, which is a real clinical
   * signal. Implemented as six explicit `false` answers so `answered` flips true
   * and the payload becomes an object rather than `null`.
   */
  const answerNone = useCallback(() => {
    SYMPTOM_KEYS.forEach((key) => toggleSymptom(key, false));
  }, [toggleSymptom]);

  const statusLine = useMemo(() => {
    if (symptoms.skipped) return 'Skipped. The doctor will ask you directly.';
    if (!symptoms.answered) return 'Not answered yet. You can skip all of these.';
    if (flagged === 0) return 'You answered no to all six.';
    return `${flagged} of ${SYMPTOM_QUESTIONS.length} flagged.`;
  }, [symptoms.skipped, symptoms.answered, flagged]);

  /** 'flagged' | 'answered' | 'unanswered' for one question. */
  const stateOf = (key) => {
    if (symptoms.values[key]) return 'flagged';
    return symptoms.answered ? 'answered' : 'unanswered';
  };

  return (
    <div className="flex flex-col gap-6">
      {/* ------------------------------------------------- the skip, up front --
          `border-default`, not subtle: in light mode `line-subtle` is the same
          rgb as this panel's first gradient stop, so a subtle border vanishes. */}
      <div
        className={cn(
          'flex flex-col gap-3 rounded-card border border-default p-4 shadow-soft',
          // No `dark:` override: primary-50 and accent-50 both re-ramp to deep
          // brand tones in dark mode, so one recipe covers both themes.
          'bg-gradient-to-br from-primary-50 via-surface to-accent-50',
          'sm:flex-row sm:items-center sm:justify-between',
        )}
      >
        <div className="flex min-w-0 items-start gap-3">
          <span
            aria-hidden="true"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-field bg-info-100 text-info-700"
          >
            <ListChecks className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-label-lg text-default">These six questions are optional</p>
            <p className="mt-0.5 text-caption text-muted">
              They sharpen the severity score. Skipping them does not block anything; you can still
              pick doctors and offer times.
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Button
            variant="soft"
            onClick={answerNone}
            leftIcon={<Check aria-hidden="true" className="h-4 w-4" />}
          >
            None apply
          </Button>
          <Button
            variant="ghost"
            onClick={skipSymptoms}
            leftIcon={<SkipForward aria-hidden="true" className="h-4 w-4" />}
          >
            Skip these
          </Button>
        </div>
      </div>

      {symptoms.skipped && (
        <Alert
          tone="neutral"
          title="Questions skipped"
          actions={
            <Button variant="ghost" size="sm" onClick={unskipSymptoms}>
              Answer them after all
            </Button>
          }
        >
          The request will say you were not asked, rather than pretending you answered no to
          everything. Answering any question below un-skips them.
        </Alert>
      )}

      {/* -------------------------------------------------------- the six -----
          Each card IS the Switch's <label>: the whole surface toggles the same
          native input, so keyboard and screen-reader behaviour are unchanged. */}
      <fieldset>
        <legend className="mb-3 flex w-full flex-wrap items-center gap-2 text-label-lg text-default">
          <span>About the spot</span>
          <Badge tone={symptoms.answered ? 'primary' : 'neutral'} size="sm">
            {statusLine}
          </Badge>
        </legend>

        {/* ------------------------------------------------------- progress ---
            Decorative track plus a written count, so the state is never carried
            by colour alone. */}
        <div className="mb-4 rounded-card border border-default bg-surface-sunken p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-label-md text-default">
              {symptoms.answered
                ? `All ${total} answered`
                : `0 of ${total} answered`}
            </p>
            {symptoms.answered && (
              <p className="text-caption tabular-nums text-muted">
                {flagged} flagged
              </p>
            )}
          </div>

          <div aria-hidden="true" className="mt-2 flex items-center gap-1">
            {SYMPTOM_QUESTIONS.map((question) => (
              <span
                key={question.key}
                className={cn(
                  'h-1.5 flex-1 rounded-pill transition-colors duration-200',
                  SEGMENT_STATE[stateOf(question.key)],
                )}
              />
            ))}
          </div>

          <p className="mt-2.5 text-caption text-subtle">
            {symptoms.answered
              ? 'Answering one question answers all six: anything you leave switched off is sent as a no.'
              : 'Switch on anything that applies. The score below updates as you go.'}
          </p>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2">
          {SYMPTOM_QUESTIONS.map((question) => {
            const checked = Boolean(symptoms.values[question.key]);
            return (
              <li key={question.key} className="h-full">
                <Switch
                  checked={checked}
                  onChange={(event) => toggleSymptom(question.key, event.target.checked)}
                  label={question.label}
                  description={question.hint}
                  labelPosition="left"
                  className={cn(
                    'flex h-full min-h-[3.5rem] w-full items-start justify-between gap-4',
                    'rounded-card border p-4 transition-colors duration-150',
                    CARD_FOCUS,
                    CARD_STATE[stateOf(question.key)],
                  )}
                />
              </li>
            );
          })}
        </ul>

        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-subtle">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-1.5 w-4 rounded-pill bg-warning-500" />
            Flagged
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-1.5 w-4 rounded-pill bg-success-500" />
            Answered no
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true" className="h-1.5 w-4 rounded-pill bg-neutral-300" />
            Not answered
          </span>
        </p>
      </fieldset>

      {/* ---------------------------------------------------- live severity ---- */}
      <section
        aria-live="polite"
        className="rounded-card border border-subtle bg-surface p-4 shadow-soft sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="flex items-center gap-2.5 text-label-lg text-default">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-accent-100 text-accent-700"
            >
              <Activity className="h-4 w-4" />
            </span>
            Severity with these answers
          </h3>
          {triage.status === 'success' && triage.severity && (
            <SeverityBadge severity={triage.severity} />
          )}
        </div>

        {!hasScan && (
          <p className="mt-2 text-body-sm text-muted">
            Analyse a photo first and the score will appear here.
          </p>
        )}

        {hasScan && triage.status === 'loading' && (
          <div className="mt-3 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}

        {hasScan && triage.status === 'error' && (
          <Alert
            tone="warning"
            className="mt-3"
            actions={
              <Button variant="ghost" size="sm" onClick={previewTriage}>
                Try again
              </Button>
            }
          >
            {triage.error || 'Could not score this right now.'} Your answers are still saved, and
            the doctor will see them either way.
          </Alert>
        )}

        {hasScan && triage.status === 'success' && (
          <>
            {triage.isEmergency && (
              <Alert
                tone="danger"
                className="mt-3"
                title="Please seek care today"
                icon={<AlertTriangle aria-hidden="true" className="h-5 w-5" />}
              >
                These answers point to something that should be looked at urgently. You can still
                send this request (mark it as express on the review step), but do not wait on a
                reply if you feel unwell.
              </Alert>
            )}

            {triage.reasons.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {triage.reasons.map((reason) => (
                  <li
                    key={reason}
                    className="flex items-start gap-2.5 rounded-field border border-default bg-surface-sunken p-3"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-pill bg-accent-500"
                    />
                    <span className="min-w-0 text-body-sm text-muted">{reason}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-body-sm text-muted">
                Nothing in your answers raised the score.
              </p>
            )}

            {answers === null && (
              <p className="mt-3 text-caption text-subtle">
                Scored from the photo alone, because the questions were skipped.
              </p>
            )}
          </>
        )}
      </section>

      <p className="text-caption text-subtle">
        Want to change the photo or re-run the model?{' '}
        <button
          type="button"
          onClick={() => goToStepId(STEP_IDS.RESULT)}
          className="rounded-field font-semibold text-primary-700 underline underline-offset-2 outline-none hover:text-primary-800 focus-visible:ring-2 focus-visible:ring-focus"
        >
          Go back to the result
        </button>
        .
      </p>
    </div>
  );
}
