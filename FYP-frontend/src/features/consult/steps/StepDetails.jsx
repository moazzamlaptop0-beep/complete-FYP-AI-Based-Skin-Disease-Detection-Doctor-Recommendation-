/**
 * StepDetails — the one place the patient gets to say something in their own words.
 *
 * THIS FIELD DID NOT EXIST BEFORE
 * -------------------------------
 * The old flow collected a photo, six yes/no booleans and nothing else. A
 * patient could not tell the doctor "it started after I changed washing powder",
 * "my mother had melanoma", or "I have already tried a steroid cream for two
 * weeks and it got worse" — the three facts a dermatologist asks for first and
 * the three the classifier cannot possibly know. `ai_scans.patient_notes` was in
 * the schema the whole time with nothing writing to it from the patient side.
 *
 * WHY 500 CHARACTERS AND A VISIBLE COUNTER
 * ----------------------------------------
 * The cap is editorial, not technical (the column is TEXT). A doctor triaging an
 * inbox reads three lines; an unbounded box invites a life story that buries the
 * one sentence that mattered, and then the doctor skims and misses it. The
 * counter is on from the first keystroke — Textarea's own counter goes
 * `aria-live` only past 80%, so it stays quiet while it is irrelevant and speaks
 * up when the limit is close. `maxLength` on the control means the 501st
 * character never arrives, so there is no state where the box holds text that
 * the request would silently truncate.
 *
 * The meter under the box is `aria-hidden` on purpose: it is the same number the
 * counter beside it already states in words, and a progress bar that announces
 * "38 percent" while somebody is mid-sentence is noise, not help.
 *
 * THIS STEP IS OPTIONAL AND SAYS SO
 * ---------------------------------
 * Nothing here gates Next. Someone with nothing to add presses Continue and the
 * request goes out with an empty note, exactly as it did before this step
 * existed.
 *
 * THE PROMPTS ARE PROMPTS, NOT BUTTONS
 * -----------------------------------
 * They are deliberately NOT click-to-insert chips. A tapped prompt would drop a
 * question mark into the patient's own words and leave them editing our sentence
 * instead of writing theirs, and half of them would send the request with the
 * literal question still in the box. They sit below the field, static, and stay
 * readable while the person types.
 */

import React, { useCallback, useMemo } from 'react';
import { Info, Lightbulb, MessageSquareText, PenLine, ShieldQuestion } from 'lucide-react';

import { Field, Textarea, cn } from '../../../components/ui';
import { useConsult } from '../ConsultContext';
import { LIMITS, patientNotePayload } from '../consultReducer';

import EmergencyBanner from '../components/EmergencyBanner';

/**
 * Prompts, not placeholder text. Placeholder text disappears the moment you
 * start typing, which is exactly when a person needs the reminder, and screen
 * readers treat it inconsistently. These sit below the box and stay put.
 */
const PROMPTS = Object.freeze([
  'When did you first notice it, and has it changed since?',
  'Does anything make it better or worse: sun, heat, soap, shaving?',
  'Have you treated it already, and did that help?',
  'Any allergies, medicines you take, or family history of skin cancer?',
]);

/**
 * Tonal icon-chip classes for the prompt hints, rotating through flipping token
 * scales so every pairing stays legible in light and dark mode.
 */
const PROMPT_TONES = Object.freeze([
  'bg-primary-100 text-primary-700',
  'bg-accent-100 text-accent-700',
  'bg-info-100 text-info-700',
  'bg-success-100 text-success-700',
]);

export default function StepDetails() {
  const { state, setDetails } = useConsult();
  const { details } = state;

  const description = details.description || '';
  const used = description.length;
  const left = LIMITS.MAX_DESCRIPTION - used;
  const percent = Math.min(100, Math.round((used / LIMITS.MAX_DESCRIPTION) * 100));
  const nearLimit = left <= 50;

  const handleDescription = useCallback((event) => {
    // Clamped here as well as by maxLength: a paste on some Android keyboards
    // bypasses the attribute, and silently over-length text would be trimmed by
    // patientNotePayload() without the counter ever having warned anybody.
    setDetails({ description: event.target.value.slice(0, LIMITS.MAX_DESCRIPTION) });
  }, [setDetails]);

  /** What the doctor will actually receive, after trim. */
  const willSend = useMemo(() => patientNotePayload(state), [state]);

  return (
    <div className="flex flex-col gap-5">
      {/* Informational only — never a gate. See EmergencyBanner's header. */}
      <EmergencyBanner />

      {/* ------------------------------------------------ special description -- */}
      <section className="flex flex-col gap-4">
        <div className="overflow-hidden rounded-card border border-subtle bg-surface shadow-soft">
          <header className="flex items-start gap-3 border-b border-subtle p-4 sm:p-5">
            <span
              aria-hidden="true"
              className="grid h-10 w-10 shrink-0 place-items-center rounded-field bg-primary-100 text-primary-700"
            >
              <PenLine className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-heading text-heading-sm text-default">
                In your own words
              </p>
              <p className="mt-1 text-body-sm text-muted">
                Optional, and it is the part a photo cannot show. Whoever accepts your request
                reads this before they see you.
              </p>
            </div>
          </header>

          <div className="p-4 sm:p-5">
            <Field label="Anything else the doctor should know">
              <Textarea
                value={description}
                onChange={handleDescription}
                maxLength={LIMITS.MAX_DESCRIPTION}
                rows={6}
                autoResize
                placeholder="It started about three weeks ago after a beach holiday. It itches at night and a steroid cream from the pharmacy did not help."
              />
            </Field>

            {/* Decorative twin of the counter below it. See the header note. */}
            <div
              aria-hidden="true"
              className="mt-3 h-1 w-full overflow-hidden rounded-pill bg-surface-sunken"
            >
              <div
                className={cn(
                  'h-full rounded-pill transition-[width] duration-300 ease-emphasized',
                  'motion-reduce:transition-none',
                  nearLimit
                    ? 'bg-warning-500'
                    : 'bg-gradient-to-r from-primary-600 to-accent-700 dark:from-primary-400 dark:to-accent-300',
                )}
                style={{ width: `${percent}%` }}
              />
            </div>

            <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-caption text-subtle">
                <MessageSquareText aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                Plain language is fine. No medical terms needed.
              </p>
              <p
                className={cn(
                  'inline-flex items-center rounded-pill border px-2.5 py-1 font-numeric text-caption tabular-nums',
                  nearLimit
                    ? 'border-warning-300 bg-warning-50 text-warning-800'
                    : 'border-default bg-surface-sunken text-subtle',
                )}
              >
                {used} of {LIMITS.MAX_DESCRIPTION} characters
                {nearLimit && left >= 0 && `, ${left} left`}
              </p>
            </div>
          </div>
        </div>

        {/* Prompts for the very common "I do not know what to write" moment. */}
        <div className="rounded-card border border-subtle bg-surface p-4 shadow-soft sm:p-5">
          <h3 className="flex items-center gap-2.5 text-label-lg text-default">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-accent-100 text-accent-700"
            >
              <ShieldQuestion className="h-4 w-4" />
            </span>
            Not sure what to say?
          </h3>
          <ul className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {PROMPTS.map((prompt, index) => (
              <li
                key={prompt}
                className={cn(
                  'flex items-start gap-2.5 rounded-field border border-default',
                  'bg-surface-sunken px-3 py-2.5',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'grid h-6 w-6 shrink-0 place-items-center rounded-pill',
                    PROMPT_TONES[index % PROMPT_TONES.length],
                  )}
                >
                  <Lightbulb className="h-3.5 w-3.5" />
                </span>
                <span className="text-body-sm text-muted">{prompt}</span>
              </li>
            ))}
          </ul>
        </div>

        {willSend.length > 0 && (
          <p className="flex items-start gap-2 text-caption text-subtle">
            <Info aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              This is sent with the request and saved on the scan, so it stays with your record
              rather than living in a message that scrolls away.
            </span>
          </p>
        )}
      </section>

      {/* EXTRA PHOTOS ARE NOT OFFERED YET — ON PURPOSE.
          `POST /api/scans/<id>/attachments` is not routed (the live url_map has
          only the two GETs and the DELETE that purges the rows, and nothing in
          the backend inserts a `scan_attachments` row). Every upload therefore
          405s, so the strip collected up to three photos, promised "these go to
          the doctors as context", and then showed every patient a warning saying
          they could not be attached. A picker whose every upload fails is worse
          than no picker. `ExtraPhotoStrip` and `scans.createAttachment` are left
          in place, wired to nothing, for the phase that lands the route. */}

      <p className="text-caption text-subtle">
        Nothing on this step is required. Continue with it blank if there is nothing to add.
      </p>
    </div>
  );
}
