/**
 * recommendations.js — what the result screen is allowed to tell a patient.
 *
 * WHY THIS IS KEYED ON SEVERITY AND NOT ON THE DISEASE
 * ---------------------------------------------------
 * The product asked for "treatment recommendations" on the result screen. The
 * backend returns no treatment data of any kind: `/predict` answers with a class
 * label and a confidence, and `/api/triage-preview` answers with a severity, a
 * score, some reasons, an emergency flag and a reply window. Nothing in the
 * system knows what to do about a specific condition, and the app's own copy
 * says, in several places, that it is a triage aid and not a diagnosis.
 *
 * So the content here is deliberately NOT clinical:
 *
 *   - It is keyed on SEVERITY (how soon to act), never on the predicted disease.
 *   - It contains no drug names, no product names, no dosages and no procedure.
 *   - It never says "your condition is X, so do Y".
 *   - Every list is safe to give to a person with any skin condition, including
 *     a person whose prediction is wrong, which at a 40% confidence is a real
 *     possibility the screen itself admits to.
 *
 * The unit test enforces the last three points, so a well-meaning future edit
 * that adds "apply a mild steroid cream" fails CI instead of reaching a patient.
 *
 * PURE DATA ON PURPOSE
 * --------------------
 * No React, no imports. The step renders it; this module only knows words. That
 * is what makes the safety rules testable.
 */

/** Shown on every panel. The whole point of the module in one sentence. */
export const GENERAL_INFO_NOTE =
  'General information for any skin complaint. It is not a diagnosis, not a treatment plan and '
  + 'not a prescription.';

/** The short version, for a chip in a card header. */
export const GENERAL_INFO_LABEL = 'General information';

/** Panel headings. Constant across severities, so they live outside the map. */
export const PANEL_TITLES = Object.freeze({
  nextSteps: 'Recommended next steps',
  selfCare: 'General self-care while you wait',
  redFlags: 'When to seek help sooner',
});

/** The three literals the triage engine returns, in descending urgency. */
export const SEVERITY_ORDER = Object.freeze(['CRITICAL', 'URGENT', 'ROUTINE']);

/** The key used when no severity came back. Never presented as a severity. */
export const UNKNOWN_SEVERITY = 'UNKNOWN';

/**
 * Safe for anyone, in any band. Written to avoid the two ways this could go
 * wrong: telling somebody to put something on their skin, and telling somebody
 * to stop something they were told to use.
 */
const UNIVERSAL_SELF_CARE = Object.freeze([
  'Keep the area clean and dry, and pat it rather than rubbing it.',
  'Try not to scratch, squeeze or pick at it, however tempting that is.',
  'Do not put anything new on broken or bleeding skin before a doctor has seen it.',
  'Carry on with whatever you already use, and tell the doctor about it rather than changing it on your own.',
  'Keep the area out of direct sun, and use broad spectrum sun protection on skin that is not broken.',
  'Wear loose clothing over it so nothing rubs.',
]);

/**
 * The red-flag list. Identical in every band by design: a routine score is a
 * snapshot of today, and the reason to escalate does not change with it.
 */
const UNIVERSAL_RED_FLAGS = Object.freeze([
  'Bleeding that will not stop with gentle pressure.',
  'Redness spreading outwards, or a red line leading away from the area.',
  'A fever, chills, or feeling generally unwell.',
  'Pain that is getting worse, or that wakes you at night.',
  'The area turning hot, tightly swollen, or leaking fluid.',
  'Growing or changing shape over days rather than months.',
  'A new lump, a numb patch, or skin that breaks open on its own.',
]);

/**
 * @typedef {object} Recommendation
 * @property {string} key CRITICAL | URGENT | ROUTINE | UNKNOWN
 * @property {boolean} known False when no severity came back.
 * @property {'danger'|'warning'|'success'|'neutral'} tone Token scale for the panel.
 * @property {string} timeframe Two or three words, for a chip.
 * @property {string} headline One line, imperative.
 * @property {string} summary One sentence of context under the headline.
 * @property {ReadonlyArray<string>} nextSteps
 * @property {ReadonlyArray<string>} selfCare
 * @property {ReadonlyArray<string>} redFlags
 */

/** @type {Readonly<Record<string, Recommendation>>} */
export const RECOMMENDATIONS = Object.freeze({
  CRITICAL: Object.freeze({
    key: 'CRITICAL',
    known: true,
    tone: 'danger',
    timeframe: 'Today',
    headline: 'See a dermatologist or an emergency service today',
    summary:
      'The score puts this in the highest band, so the useful next step is a person in the room '
      + 'with you, not an app.',
    nextSteps: Object.freeze([
      'Arrange to be seen in person today: your own doctor, a walk in clinic, or a hospital if it is bleeding heavily or spreading fast.',
      'Send this scan to the doctors you pick as well, so whoever sees you already has the photo and your answers.',
      'Write down when you first noticed it and what has changed since. That timeline is the most useful thing you can bring.',
      'Do not wait for a reply here before getting seen. Booking and going are both worth doing.',
    ]),
    selfCare: Object.freeze([
      ...UNIVERSAL_SELF_CARE,
      'Photograph it in the same light each day until you are seen, so any change is easy to show.',
    ]),
    redFlags: UNIVERSAL_RED_FLAGS,
  }),

  URGENT: Object.freeze({
    key: 'URGENT',
    known: true,
    tone: 'warning',
    timeframe: 'Within 48 hours',
    headline: 'Book within 48 hours, and send this scan now',
    summary:
      'This scored above routine, so it wants a human opinion soon rather than at some point.',
    nextSteps: Object.freeze([
      'Book an appointment within the next 48 hours.',
      'Send this scan now, so a doctor can look at it before you are in the room.',
      'Pick more than one doctor. Whoever is free first takes it, so you are not waiting on one inbox.',
      'Offer the earliest times you can genuinely make, including one this week.',
    ]),
    selfCare: Object.freeze([
      ...UNIVERSAL_SELF_CARE,
      'Photograph it every couple of days, from the same distance and in the same light.',
    ]),
    redFlags: UNIVERSAL_RED_FLAGS,
  }),

  ROUTINE: Object.freeze({
    key: 'ROUTINE',
    known: true,
    tone: 'success',
    timeframe: 'Routine review',
    headline: 'Book a routine review, and keep an eye on changes',
    summary:
      'Nothing in the score is shouting. A person should still confirm what this is, in their own time.',
    nextSteps: Object.freeze([
      'Book a routine review with a dermatologist. There is no rush, and it is still worth doing.',
      'Send this scan with the request, so the doctor can compare the photo with what they see.',
      'Answer the six optional questions if you skipped them. They sharpen the score more than a second photo does.',
      'Come back and scan it again if it changes. A routine result today is not a permanent one.',
    ]),
    selfCare: Object.freeze([
      ...UNIVERSAL_SELF_CARE,
      'Photograph it once a week from the same distance, so slow change does not go unnoticed.',
    ]),
    redFlags: UNIVERSAL_RED_FLAGS,
  }),

  /**
   * No severity came back (the scoring call failed, or the response was a shape
   * we do not recognise). It must not read as "nothing to worry about", so it
   * points at a review and leans on the red-flag list instead of guessing a band.
   */
  UNKNOWN: Object.freeze({
    key: UNKNOWN_SEVERITY,
    known: false,
    tone: 'neutral',
    timeframe: 'Get it reviewed',
    headline: 'Have this reviewed by a dermatologist',
    summary:
      'No severity came back for this scan, so treat everything below as the general version rather '
      + 'than advice about your result.',
    nextSteps: Object.freeze([
      'Book a review with a dermatologist rather than waiting to see what happens.',
      'Send this scan with the request, so a doctor sees the photo and your answers.',
      'Answer the six optional questions. Without a severity they are the strongest signal you can add.',
      'If anything in the red-flag list applies to you, treat it as urgent and be seen today.',
    ]),
    selfCare: Object.freeze([
      ...UNIVERSAL_SELF_CARE,
      'Photograph it every couple of days, from the same distance and in the same light.',
    ]),
    redFlags: UNIVERSAL_RED_FLAGS,
  }),
});

/**
 * 'critical' / ' Urgent ' / 'ROUTINE' -> the canonical literal, or null.
 * @param {unknown} value
 * @returns {'CRITICAL'|'URGENT'|'ROUTINE'|null}
 */
export function normalizeSeverity(value) {
  const key = String(value ?? '').trim().toUpperCase();
  return SEVERITY_ORDER.includes(key) ? key : null;
}

/**
 * The curated content for a severity. NEVER returns null: an unrecognised or
 * missing severity falls back to the UNKNOWN entry, which is a complete entry
 * with all three lists populated, so no caller has to render an empty panel or
 * guess at a band.
 *
 * @param {unknown} severity 'CRITICAL' | 'URGENT' | 'ROUTINE' in any case, or anything else.
 * @returns {Recommendation}
 */
export function recommendationsFor(severity) {
  const key = normalizeSeverity(severity);
  return key ? RECOMMENDATIONS[key] : RECOMMENDATIONS[UNKNOWN_SEVERITY];
}

/** '4 hours' / '1 hour' / '3 days'. Internal, so the sentences stay consistent. */
function durationPhrase(hours) {
  if (hours < 24) return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  const days = Math.round(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'}`;
}

/**
 * `expires_in_hours` as a deadline a person can act on.
 *
 * The API already returns this on every triage preview (4 on the express lane,
 * 72 otherwise) and the UI used to throw it away, which is how the express panel
 * ended up quoting "the usual 48" at people.
 *
 * @param {unknown} hours The raw `expires_in_hours`.
 * @param {{express?: boolean}} [options] `express_recommended` from the same response.
 * @returns {string|null} null when there is no usable number, so the caller
 *   renders nothing rather than inventing a deadline.
 */
export function replyWindowText(hours, { express = false } = {}) {
  const number = Number(hours);
  if (!Number.isFinite(number) || number <= 0) return null;
  const phrase = durationPhrase(Math.round(number));
  return express
    ? `A doctor has about ${phrase} to respond on the fast lane.`
    : `A doctor has about ${phrase} to respond. After that the request closes on its own.`;
}

/**
 * `disease_tier` + `disease_tier_known` in one sentence.
 *
 * The tier is the band the PREDICTED CONDITION carries on its own, before the
 * six questions could escalate it, and `disease_tier_known` says whether the
 * condition was in the triage table at all. When it was not, the backend falls
 * back to ROUTINE, and showing that as a finding would be a lie by omission.
 *
 * @param {unknown} tier
 * @param {boolean} [known=true]
 * @returns {string|null}
 */
export function diseaseTierNote(tier, known = true) {
  const key = normalizeSeverity(tier);
  if (!key) return null;
  if (!known) {
    return 'This condition is not in the triage table, so it starts at routine and only your answers '
      + 'can raise it.';
  }
  const word = key.toLowerCase();
  return `On its own, before your answers were counted, this condition is rated ${word}.`;
}

export default recommendationsFor;
