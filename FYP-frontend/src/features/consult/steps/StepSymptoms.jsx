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
 */

import React, { useCallback, useEffect, useMemo } from 'react';
import { AlertTriangle, Check, SkipForward } from 'lucide-react';

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
  SYMPTOM_KEYS,
  SYMPTOM_QUESTIONS,
  symptomAnswersPayload,
  symptomFlagCount,
} from '../consultReducer';

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
    if (symptoms.skipped) return 'Skipped — the doctor will ask you directly.';
    if (!symptoms.answered) return 'Not answered yet. You can skip all of these.';
    if (flagged === 0) return 'You answered no to all six.';
    return `${flagged} of ${SYMPTOM_QUESTIONS.length} flagged.`;
  }, [symptoms.skipped, symptoms.answered, flagged]);

  return (
    <div className="space-y-6">
      {/* ------------------------------------------------- the skip, up front -- */}
      <div
        className={cn(
          'flex flex-col gap-3 rounded-card border border-subtle bg-surface-sunken p-4',
          'sm:flex-row sm:items-center sm:justify-between',
        )}
      >
        <div className="min-w-0">
          <p className="text-label-lg text-default">These six questions are optional</p>
          <p className="mt-0.5 text-caption text-muted">
            They sharpen the severity score. Skipping them does not block anything — you can still
            pick doctors and offer times.
          </p>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <Button
            variant="outline"
            size="sm"
            onClick={answerNone}
            leftIcon={<Check aria-hidden="true" className="h-4 w-4" />}
          >
            None apply
          </Button>
          <Button
            variant="ghost"
            size="sm"
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

      {/* -------------------------------------------------------- the six ----- */}
      <fieldset className="space-y-1">
        <legend className="mb-3 flex flex-wrap items-center gap-2 text-label-lg text-default">
          <span>About the spot</span>
          <Badge tone={symptoms.answered ? 'primary' : 'neutral'} size="sm">
            {statusLine}
          </Badge>
        </legend>

        <ul className="divide-y divide-subtle overflow-hidden rounded-card border border-subtle">
          {SYMPTOM_QUESTIONS.map((question) => {
            const checked = Boolean(symptoms.values[question.key]);
            return (
              <li
                key={question.key}
                className={cn(
                  'p-4 transition-colors',
                  checked && 'bg-warning-50 dark:bg-warning-950/30',
                )}
              >
                <Switch
                  checked={checked}
                  onChange={(event) => toggleSymptom(question.key, event.target.checked)}
                  label={question.label}
                  description={question.hint}
                  labelPosition="left"
                  className="w-full items-start justify-between gap-4"
                />
              </li>
            );
          })}
        </ul>
      </fieldset>

      {/* ---------------------------------------------------- live severity ---- */}
      <section
        aria-live="polite"
        className="rounded-card border border-subtle bg-surface p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-label-lg text-default">Severity with these answers</h3>
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
                send this request — mark it as express on the review step — but do not wait on a
                reply if you feel unwell.
              </Alert>
            )}

            {triage.reasons.length > 0 ? (
              <ul className="mt-3 space-y-1.5">
                {triage.reasons.map((reason) => (
                  <li key={reason} className="flex gap-2 text-body-sm text-muted">
                    <span aria-hidden="true" className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-pill bg-primary-500" />
                    <span>{reason}</span>
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
          onClick={() => goToStepId('result')}
          className="rounded-field font-semibold text-primary-700 underline underline-offset-2 outline-none hover:text-primary-800 focus-visible:ring-2 focus-visible:ring-focus dark:text-primary-400"
        >
          Go back to the result
        </button>
        .
      </p>
    </div>
  );
}
