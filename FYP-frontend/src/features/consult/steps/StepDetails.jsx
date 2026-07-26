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
 * THIS STEP IS OPTIONAL AND SAYS SO
 * ---------------------------------
 * Nothing here gates Next. Someone with nothing to add presses Continue and the
 * request goes out with an empty note, exactly as it did before this step
 * existed.
 */

import React, { useCallback, useMemo } from 'react';
import { Info, MessageSquareText, ShieldQuestion } from 'lucide-react';

import { Field, Textarea } from '../../../components/ui';
import { useConsult } from '../ConsultContext';
import { LIMITS, patientNotePayload } from '../consultReducer';

import EmergencyBanner from '../components/EmergencyBanner';

/**
 * Prompts, not placeholder text. Placeholder text disappears the moment you
 * start typing, which is exactly when a person needs the reminder, and screen
 * readers treat it inconsistently. These sit above the box and stay put.
 */
const PROMPTS = Object.freeze([
  'When did you first notice it, and has it changed since?',
  'Does anything make it better or worse — sun, heat, soap, shaving?',
  'Have you treated it already, and did that help?',
  'Any allergies, medicines you take, or family history of skin cancer?',
]);

export default function StepDetails() {
  const { state, setDetails } = useConsult();
  const { details } = state;

  const description = details.description || '';
  const used = description.length;
  const left = LIMITS.MAX_DESCRIPTION - used;

  const handleDescription = useCallback((event) => {
    // Clamped here as well as by maxLength: a paste on some Android keyboards
    // bypasses the attribute, and silently over-length text would be trimmed by
    // patientNotePayload() without the counter ever having warned anybody.
    setDetails({ description: event.target.value.slice(0, LIMITS.MAX_DESCRIPTION) });
  }, [setDetails]);

  /** What the doctor will actually receive, after trim. */
  const willSend = useMemo(() => patientNotePayload(state), [state]);

  return (
    <div className="space-y-6">
      {/* Informational only — never a gate. See EmergencyBanner's header. */}
      <EmergencyBanner />

      {/* ------------------------------------------------ special description -- */}
      <section className="space-y-3">
        <Field
          label="Anything else the doctor should know"
          hint={
            'Optional, but it is the part a photo cannot show. Whoever accepts your request '
            + 'reads this before they see you.'
          }
        >
          <Textarea
            value={description}
            onChange={handleDescription}
            maxLength={LIMITS.MAX_DESCRIPTION}
            rows={6}
            autoResize
            placeholder="It started about three weeks ago after a beach holiday. It itches at night and a steroid cream from the pharmacy did not help."
          />
        </Field>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-1.5 text-caption text-subtle">
            <MessageSquareText aria-hidden="true" className="h-3.5 w-3.5" />
            Plain language is fine. No medical terms needed.
          </p>
          <p
            className={left <= 50 ? 'text-caption text-warning-700 dark:text-warning-400' : 'text-caption text-subtle'}
          >
            {used} of {LIMITS.MAX_DESCRIPTION} characters
            {left <= 50 && left >= 0 && ` — ${left} left`}
          </p>
        </div>

        {/* Prompts for the very common "I do not know what to write" moment. */}
        <div className="rounded-card border border-subtle bg-surface-sunken p-4">
          <h3 className="flex items-center gap-2 text-label-md text-default">
            <ShieldQuestion aria-hidden="true" className="h-4 w-4 text-primary-700 dark:text-primary-400" />
            Not sure what to say?
          </h3>
          <ul className="mt-2 space-y-1.5">
            {PROMPTS.map((prompt) => (
              <li key={prompt} className="flex gap-2 text-body-sm text-muted">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-pill bg-primary-500"
                />
                <span>{prompt}</span>
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
