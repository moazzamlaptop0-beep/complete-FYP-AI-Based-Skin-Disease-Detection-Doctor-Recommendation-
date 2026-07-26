/**
 * consultReducer — the ONE state object behind the consult stepper.
 *
 * WHAT IT REPLACES
 * ----------------
 * The old flow was three pages holding three overlapping copies of the same
 * facts: /try-now kept the file + prediction in local state, /nearby-doctors
 * re-read the scan id off the URL, and the booking modal kept its own idea of
 * which doctor and which slot. Nothing could be undone: there was no way to
 * re-run the model on the same photo, no way to swap the photo without losing
 * the answers, and the questionnaire modal was forced on every single user.
 * Worst of all the ORDER was fixed — scan, then send a report to exactly ONE
 * doctor, and only then were you allowed to book. That ordering is gone.
 *
 * THE THREE RESETS ARE A PRODUCT REQUIREMENT, NOT AN IMPLEMENTATION DETAIL
 * -----------------------------------------------------------------------
 *   RESULT_RESET   "Re-analyze this photo"  keep the image, drop the verdict.
 *   IMAGE_CLEARED  "Replace photo"          drop image + verdict, keep the plan.
 *   RESET_ALL      "Start over"             everything.
 * A user who mis-shot the lighting must not lose the three doctors and five
 * time slots they already chose; a user who disagrees with the model must not
 * have to re-upload. They are genuinely different operations and each one is
 * reachable from the result screen.
 *
 * PURITY
 * ------
 * The reducer never touches the network, sessionStorage or `URL.createObjectURL`.
 * Object URLs are CREATED by the step that picks the file and REVOKED by
 * ConsultContext, which diffs `image.previewUrl` / `image.sourceUrl` across
 * renders. Keeping that out of here is what lets the reducer be unit tested and
 * replayed from a persisted draft.
 */

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export const STEP_IDS = Object.freeze({
  CAPTURE: 'capture',
  RESULT: 'result',
  SYMPTOMS: 'symptoms',
  DOCTORS: 'doctors',
  SLOTS: 'slots',
  DETAILS: 'details',
  REVIEW: 'review',
  CONFIRMATION: 'confirmation',
});

/** Backend limits, mirrored so the UI can refuse a file before the round-trip. */
export const LIMITS = Object.freeze({
  MAX_IMAGE_BYTES: 10 * 1024 * 1024,
  ACCEPTED_TYPES: Object.freeze(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']),
  ACCEPTED_EXTENSIONS: Object.freeze(['png', 'jpg', 'jpeg', 'webp']),
  MIN_DOCTORS: 1,
  MAX_DOCTORS: 3,
  MIN_SLOTS: 1,
  MAX_SLOTS: 5,
  MAX_NOTE: 1000,
  /**
   * The "special description" the Details step collects. 500 is a deliberate
   * ceiling, not a technical one: a doctor triaging an inbox reads the first
   * three lines, and an unbounded box invites a life story that buries the one
   * fact that mattered. The counter is visible from the first keystroke so the
   * limit is never a surprise at 501.
   */
  MAX_DESCRIPTION: 500,
  /** Extra context photos, on top of the one that was analysed. */
  MAX_ATTACHMENTS: 3,
});

/**
 * The six symptom booleans the triage engine understands. Declared as data so
 * StepSymptoms renders from this list and the payload builder can never drift
 * from the form.
 */
export const SYMPTOM_QUESTIONS = Object.freeze([
  Object.freeze({
    key: 'is_bleeding',
    label: 'Is it bleeding, weeping or crusting?',
    hint: 'Any bleeding that is not from a knock or a scratch.',
  }),
  Object.freeze({
    key: 'growing_fast',
    label: 'Has it grown noticeably in the last few weeks?',
    hint: 'Wider, thicker or more raised than it used to be.',
  }),
  Object.freeze({
    key: 'has_severe_pain',
    label: 'Is it painful, or does it burn or itch badly?',
    hint: 'Enough to disturb your sleep or your day.',
  }),
  Object.freeze({
    key: 'irregular_border',
    label: 'Is the border ragged, blurred or uneven?',
    hint: 'A clean, round edge is usually reassuring.',
  }),
  Object.freeze({
    key: 'color_change',
    label: 'Has the colour changed, or is it more than one colour?',
    hint: 'Browns, blacks, reds or blue-grey in the same spot.',
  }),
  Object.freeze({
    key: 'diameter_over_6mm',
    label: 'Is it wider than 6 mm (about a pencil eraser)?',
    hint: 'Measure the widest part.',
  }),
]);

export const SYMPTOM_KEYS = Object.freeze(SYMPTOM_QUESTIONS.map((question) => question.key));

/** All six false — the shape `/api/triage-preview` and the request body expect. */
export function emptySymptomValues() {
  return SYMPTOM_KEYS.reduce((accumulator, key) => {
    accumulator[key] = false;
    return accumulator;
  }, {});
}

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const EMPTY_IMAGE = Object.freeze({
  /** The File actually uploaded (cropped + compressed). Never persisted. */
  file: null,
  /** Object URL for the cropped preview. Revoked by ConsultContext. */
  previewUrl: null,
  /** The untouched pick, kept so "re-crop" does not need a second upload. */
  sourceFile: null,
  sourceUrl: null,
  name: '',
  size: 0,
  type: '',
  width: 0,
  height: 0,
  /** Becomes the `is_sensitive` multipart field on POST /predict. */
  isSensitive: false,
  /** 'file' | 'camera' — shown back to the user, and useful in support tickets. */
  source: null,
  /** A data: URL snapshot for the sessionStorage draft. First thing dropped on quota. */
  dataUrl: null,
  /** True when the draft was restored but the File itself could not be. */
  restored: false,
});

const EMPTY_ANALYSIS = Object.freeze({
  status: 'idle', // idle | loading | success | error
  scanId: null,
  disease: '',
  confidence: null, // 0..1
  severity: null,
  imageEndpoint: null,
  raw: null,
  error: null,
});

const EMPTY_TRIAGE = Object.freeze({
  status: 'idle', // idle | loading | success | error
  severity: null,
  score: null,
  reasons: [],
  isEmergency: false,
  error: null,
});

const EMPTY_SUBMIT = Object.freeze({
  status: 'idle', // idle | loading | success | error
  requestId: null,
  result: null,
  error: null,
});

export function initialConsultState() {
  return {
    step: 0,
    furthest: 0,
    image: { ...EMPTY_IMAGE },
    analysis: { ...EMPTY_ANALYSIS },
    symptoms: {
      values: emptySymptomValues(),
      /** The user pressed "Skip" — meaningfully different from "all six no". */
      skipped: false,
      /** The user touched at least one control. */
      answered: false,
    },
    triage: { ...EMPTY_TRIAGE },
    doctors: {
      /** Up to MAX_DOCTORS doctor objects, in the order the patient ranked them. */
      selected: [],
    },
    slots: {
      /** Up to MAX_SLOTS `{key, slot_date, slot_time, doctor_id}` in preference order. */
      picks: [],
    },
    details: {
      patientNote: '',
      /** Free-text "anything else we should know" — the special description. */
      description: '',
      attachments: [],
    },
    consent: {
      /** `consent_share_scan` in the request body. The submit is blocked without it. */
      shareScan: false,
    },
    express: false,
    submit: { ...EMPTY_SUBMIT },
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const ACTIONS = Object.freeze({
  IMAGE_SELECTED: 'IMAGE_SELECTED',
  IMAGE_SENSITIVITY_SET: 'IMAGE_SENSITIVITY_SET',
  ANALYZE_START: 'ANALYZE_START',
  ANALYZE_SUCCESS: 'ANALYZE_SUCCESS',
  ANALYZE_ERROR: 'ANALYZE_ERROR',
  RESULT_RESET: 'RESULT_RESET',
  IMAGE_CLEARED: 'IMAGE_CLEARED',
  RESET_ALL: 'RESET_ALL',
  SYMPTOM_TOGGLE: 'SYMPTOM_TOGGLE',
  SYMPTOMS_SKIP: 'SYMPTOMS_SKIP',
  SYMPTOMS_UNSKIP: 'SYMPTOMS_UNSKIP',
  TRIAGE_START: 'TRIAGE_START',
  TRIAGE_SET: 'TRIAGE_SET',
  TRIAGE_ERROR: 'TRIAGE_ERROR',
  DOCTOR_TOGGLE: 'DOCTOR_TOGGLE',
  DOCTORS_SET: 'DOCTORS_SET',
  SLOT_ADD: 'SLOT_ADD',
  SLOT_REMOVE: 'SLOT_REMOVE',
  SLOT_REORDER: 'SLOT_REORDER',
  DETAILS_SET: 'DETAILS_SET',
  CONSENT_SET: 'CONSENT_SET',
  EXPRESS_SET: 'EXPRESS_SET',
  SUBMIT_START: 'SUBMIT_START',
  SUBMIT_SUCCESS: 'SUBMIT_SUCCESS',
  SUBMIT_ERROR: 'SUBMIT_ERROR',
  STEP_GOTO: 'STEP_GOTO',
  DRAFT_RESTORED: 'DRAFT_RESTORED',
});

// ---------------------------------------------------------------------------
// Normalisers — the backend answers /predict in more than one shape
// ---------------------------------------------------------------------------

/** Confidence arrives as 0..1 from some routes and 0..100 from others. */
export function normalizeConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  if (number > 1 && number <= 100) return number / 100;
  if (number < 0) return 0;
  if (number > 1) return 1;
  return number;
}

/**
 * Flatten whatever POST /predict returned into the four fields the UI reads.
 * `data` may be the payload itself or `{scan: {...}}`; both have been seen.
 * @param {any} payload
 */
export function normalizePrediction(payload) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const scan = source.scan && typeof source.scan === 'object' ? source.scan : source;

  const scanId = scan.scan_id ?? scan.id ?? source.scan_id ?? source.id ?? null;
  const disease = scan.disease ?? scan.prediction ?? scan.label ?? source.disease ?? '';
  const confidence = normalizeConfidence(
    scan.confidence ?? scan.confidence_score ?? source.confidence,
  );
  const severity = scan.severity ?? scan.severity_level ?? source.severity ?? null;
  const imageEndpoint = scan.image_endpoint ?? source.image_endpoint ?? null;

  return {
    scanId: scanId === null || scanId === undefined ? null : Number(scanId) || scanId,
    disease: String(disease || ''),
    confidence,
    severity: severity ? String(severity) : null,
    imageEndpoint,
    raw: payload ?? null,
  };
}

/** `{severity, triage_score, triage_reasons, is_emergency}` -> our triage slice. */
export function normalizeTriage(payload) {
  const source = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const reasons = Array.isArray(source.triage_reasons)
    ? source.triage_reasons.filter(Boolean).map(String)
    : Array.isArray(source.reasons)
      ? source.reasons.filter(Boolean).map(String)
      : [];
  const score = Number(source.triage_score ?? source.score);

  return {
    severity: source.severity ? String(source.severity) : null,
    score: Number.isFinite(score) ? score : null,
    reasons,
    isEmergency: Boolean(source.is_emergency ?? source.emergency),
  };
}

/** A stable key for a chosen slot, so add/remove never needs an index. */
export function slotKey(slot) {
  if (!slot) return '';
  const doctorId = slot.doctor_id ?? slot.doctorId ?? 'any';
  return `${doctorId}|${slot.slot_date ?? slot.date ?? ''}|${slot.slot_time ?? slot.time ?? ''}`;
}

/** Coerce anything slot-shaped into the request-body shape (minus `rank`). */
export function normalizeSlot(slot) {
  if (!slot) return null;
  const slotDate = slot.slot_date ?? slot.date ?? null;
  const slotTime = slot.slot_time ?? slot.time ?? null;
  if (!slotDate || !slotTime) return null;
  const doctorIdRaw = slot.doctor_id ?? slot.doctorId ?? null;
  const doctorId = doctorIdRaw === null || doctorIdRaw === undefined ? null : Number(doctorIdRaw);

  const normalized = {
    slot_date: String(slotDate),
    slot_time: String(slotTime),
    doctor_id: Number.isFinite(doctorId) ? doctorId : null,
    doctorName: slot.doctorName ?? slot.doctor_name ?? '',
  };
  normalized.key = slotKey(normalized);
  return normalized;
}

/** The numeric id of a doctor row, whichever key this particular route used. */
export function doctorIdOf(doctor) {
  if (!doctor) return null;
  const raw = doctor.doctor_id ?? doctor.id ?? doctor.user_id ?? doctor.userId;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

/** Clamp `step`/`furthest` after a reset so we never point past the flow. */
function withStep(state, step) {
  const clamped = Math.max(0, Math.min(STEPS.length - 1, step));
  return { ...state, step: clamped, furthest: Math.max(state.furthest, clamped) };
}

/** Rewind to `step`, forgetting that anything beyond it was ever reached. */
function rewindTo(state, step) {
  const clamped = Math.max(0, Math.min(STEPS.length - 1, step));
  return { ...state, step: clamped, furthest: clamped };
}

export function consultReducer(state, action) {
  switch (action.type) {
    // -- capture -----------------------------------------------------------
    case ACTIONS.IMAGE_SELECTED: {
      const {
        file = null,
        previewUrl = null,
        sourceFile = null,
        sourceUrl = null,
        width = 0,
        height = 0,
        source = 'file',
        dataUrl = null,
      } = action.payload || {};

      return {
        ...state,
        image: {
          ...state.image,
          file,
          previewUrl,
          // A re-crop of the SAME pick keeps the original; a brand new pick replaces it.
          sourceFile: sourceFile ?? state.image.sourceFile,
          sourceUrl: sourceUrl ?? state.image.sourceUrl,
          name: file?.name || sourceFile?.name || state.image.name || 'scan.jpg',
          size: file?.size ?? 0,
          type: file?.type || '',
          width,
          height,
          source,
          dataUrl,
          restored: false,
        },
        // A new photo invalidates the old verdict, always.
        analysis: { ...EMPTY_ANALYSIS },
        triage: { ...EMPTY_TRIAGE },
        submit: { ...EMPTY_SUBMIT },
      };
    }

    case ACTIONS.IMAGE_SENSITIVITY_SET:
      return {
        ...state,
        image: { ...state.image, isSensitive: Boolean(action.payload) },
      };

    // -- analysis ----------------------------------------------------------
    case ACTIONS.ANALYZE_START:
      return {
        ...state,
        analysis: { ...EMPTY_ANALYSIS, status: 'loading' },
        triage: { ...EMPTY_TRIAGE },
      };

    case ACTIONS.ANALYZE_SUCCESS: {
      const prediction = normalizePrediction(action.payload);
      return withStep(
        {
          ...state,
          analysis: { ...EMPTY_ANALYSIS, ...prediction, status: 'success' },
        },
        stepIndexById(STEP_IDS.RESULT),
      );
    }

    case ACTIONS.ANALYZE_ERROR:
      return {
        ...state,
        analysis: {
          ...EMPTY_ANALYSIS,
          status: 'error',
          error: action.payload?.message || String(action.payload || 'Analysis failed.'),
        },
      };

    // -- the three resets --------------------------------------------------
    /**
     * "Re-analyze this photo". The file, the crop and the sensitivity flag all
     * survive; only the model's opinion and anything derived from it goes.
     */
    case ACTIONS.RESULT_RESET:
      return rewindTo(
        {
          ...state,
          analysis: { ...EMPTY_ANALYSIS },
          triage: { ...EMPTY_TRIAGE },
          submit: { ...EMPTY_SUBMIT },
        },
        stepIndexById(STEP_IDS.CAPTURE),
      );

    /**
     * "Replace photo". Everything about the picture goes, but the doctors, the
     * times, the note and the answers stay — re-shooting a blurry photo must
     * not cost the user the plan they already built.
     */
    case ACTIONS.IMAGE_CLEARED:
      return rewindTo(
        {
          ...state,
          image: { ...EMPTY_IMAGE, isSensitive: state.image.isSensitive },
          analysis: { ...EMPTY_ANALYSIS },
          triage: { ...EMPTY_TRIAGE },
          submit: { ...EMPTY_SUBMIT },
        },
        stepIndexById(STEP_IDS.CAPTURE),
      );

    /** "Start over". */
    case ACTIONS.RESET_ALL:
      return initialConsultState();

    // -- symptoms (OPTIONAL, always) ---------------------------------------
    case ACTIONS.SYMPTOM_TOGGLE: {
      const key = action.payload?.key;
      if (!SYMPTOM_KEYS.includes(key)) return state;
      const next = Object.prototype.hasOwnProperty.call(action.payload, 'value')
        ? Boolean(action.payload.value)
        : !state.symptoms.values[key];

      return {
        ...state,
        symptoms: {
          ...state.symptoms,
          values: { ...state.symptoms.values, [key]: next },
          answered: true,
          skipped: false,
        },
        // Any answer changes the triage input, so the old preview is stale.
        triage: { ...EMPTY_TRIAGE },
      };
    }

    case ACTIONS.SYMPTOMS_SKIP:
      return {
        ...state,
        symptoms: { values: emptySymptomValues(), answered: false, skipped: true },
        triage: { ...EMPTY_TRIAGE },
      };

    /**
     * "Actually, I will answer them." Returns to UNANSWERED — deliberately NOT
     * to six explicit `false`s. Un-skipping is the user withdrawing "do not ask
     * me"; it is not them telling a clinician that none of the six apply. Those
     * two produce different `answers` payloads (null vs an object) and the
     * triage engine weights them differently, so collapsing them here would put
     * a claim in the request that the patient never made.
     */
    case ACTIONS.SYMPTOMS_UNSKIP:
      return {
        ...state,
        symptoms: { values: emptySymptomValues(), answered: false, skipped: false },
        triage: { ...EMPTY_TRIAGE },
      };

    // -- triage ------------------------------------------------------------
    case ACTIONS.TRIAGE_START:
      return { ...state, triage: { ...EMPTY_TRIAGE, status: 'loading' } };

    case ACTIONS.TRIAGE_SET:
      return {
        ...state,
        triage: { ...EMPTY_TRIAGE, ...normalizeTriage(action.payload), status: 'success' },
      };

    case ACTIONS.TRIAGE_ERROR:
      return {
        ...state,
        triage: {
          ...EMPTY_TRIAGE,
          status: 'error',
          error: action.payload?.message || String(action.payload || 'Could not score this scan.'),
        },
      };

    // -- doctors -----------------------------------------------------------
    case ACTIONS.DOCTOR_TOGGLE: {
      const doctor = action.payload;
      const id = doctorIdOf(doctor);
      if (id === null) return state;

      const already = state.doctors.selected.some((entry) => doctorIdOf(entry) === id);
      if (already) {
        const selected = state.doctors.selected.filter((entry) => doctorIdOf(entry) !== id);
        return {
          ...state,
          doctors: { ...state.doctors, selected },
          // Drop any slot that belonged to the doctor we just removed.
          slots: {
            ...state.slots,
            picks: state.slots.picks.filter((pick) => pick.doctor_id === null || pick.doctor_id !== id),
          },
        };
      }

      if (state.doctors.selected.length >= LIMITS.MAX_DOCTORS) return state;
      return {
        ...state,
        doctors: { ...state.doctors, selected: [...state.doctors.selected, doctor] },
      };
    }

    case ACTIONS.DOCTORS_SET: {
      const list = Array.isArray(action.payload) ? action.payload : [];
      return {
        ...state,
        doctors: { ...state.doctors, selected: list.slice(0, LIMITS.MAX_DOCTORS) },
      };
    }

    // -- slots -------------------------------------------------------------
    case ACTIONS.SLOT_ADD: {
      const slot = normalizeSlot(action.payload);
      if (!slot) return state;
      if (state.slots.picks.some((pick) => pick.key === slot.key)) return state;
      if (state.slots.picks.length >= LIMITS.MAX_SLOTS) return state;
      return { ...state, slots: { ...state.slots, picks: [...state.slots.picks, slot] } };
    }

    case ACTIONS.SLOT_REMOVE: {
      const key = typeof action.payload === 'string' ? action.payload : slotKey(action.payload);
      return {
        ...state,
        slots: { ...state.slots, picks: state.slots.picks.filter((pick) => pick.key !== key) },
      };
    }

    case ACTIONS.SLOT_REORDER: {
      const { from, to } = action.payload || {};
      const picks = [...state.slots.picks];
      if (
        !Number.isInteger(from) || !Number.isInteger(to)
        || from < 0 || to < 0 || from >= picks.length || to >= picks.length || from === to
      ) {
        return state;
      }
      const [moved] = picks.splice(from, 1);
      picks.splice(to, 0, moved);
      return { ...state, slots: { ...state.slots, picks } };
    }

    // -- details / consent / express ---------------------------------------
    case ACTIONS.DETAILS_SET:
      return { ...state, details: { ...state.details, ...(action.payload || {}) } };

    case ACTIONS.CONSENT_SET:
      return { ...state, consent: { ...state.consent, ...(action.payload || {}) } };

    case ACTIONS.EXPRESS_SET:
      return { ...state, express: Boolean(action.payload) };

    // -- submit ------------------------------------------------------------
    case ACTIONS.SUBMIT_START:
      return { ...state, submit: { ...EMPTY_SUBMIT, status: 'loading' } };

    /**
     * Advancing here — rather than leaving StepReview to call `next()` after the
     * await — is what makes "the request exists" and "the user is on the
     * confirmation screen" a single atomic transition. Two dispatches would
     * leave a window in which the request is live but the screen still shows a
     * Send button, and a double-click landing in that window would send it
     * twice.
     */
    case ACTIONS.SUBMIT_SUCCESS: {
      const payload = action.payload || {};
      return withStep(
        {
          ...state,
          submit: {
            status: 'success',
            requestId: payload.request_id ?? payload.id ?? null,
            result: payload,
            error: null,
          },
        },
        stepIndexById(STEP_IDS.CONFIRMATION),
      );
    }

    case ACTIONS.SUBMIT_ERROR:
      return {
        ...state,
        submit: {
          ...EMPTY_SUBMIT,
          status: 'error',
          error: action.payload?.message || String(action.payload || 'Could not send that request.'),
        },
      };

    // -- navigation --------------------------------------------------------
    case ACTIONS.STEP_GOTO: {
      const target = Number(action.payload);
      if (!Number.isInteger(target)) return state;
      const clamped = Math.max(0, Math.min(STEPS.length - 1, target));
      // BACKWARD is always allowed. FORWARD must satisfy every guard in between,
      // so a deep link or a stale click can never skip a gate.
      if (clamped > state.step) {
        for (let index = state.step + 1; index <= clamped; index += 1) {
          if (!STEPS[index].canEnter(state)) return state;
        }
      }
      return { ...state, step: clamped, furthest: Math.max(state.furthest, clamped) };
    }

    case ACTIONS.DRAFT_RESTORED:
      return action.payload && typeof action.payload === 'object' ? action.payload : state;

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// STEPS — the flow as data
// ---------------------------------------------------------------------------

/**
 * `canEnter` takes the WHOLE state (unlike ui/Stepper's guard, which only sees
 * indices — ConsultPage adapts between the two). `blockedReason` is what the
 * Next button announces when it refuses, so the user is never left guessing.
 *
 * @type {ReadonlyArray<{
 *   id:string, title:string, shortTitle:string, description:string,
 *   optional?:boolean, requiresAuth?:boolean,
 *   canEnter:(state:object)=>boolean, blockedReason:(state:object)=>string
 * }>}
 */
export const STEPS = Object.freeze([
  Object.freeze({
    id: STEP_IDS.CAPTURE,
    title: 'Photo',
    shortTitle: 'Photo',
    description: 'Upload or take a picture',
    // NO GATE HERE. An earlier revision required an account on this step because
    // POST /predict was @require_permission(SCAN_CREATE) and 400'd without a
    // user_id, so an anonymous analyse attempt 401'd and the visitor was told
    // their session had expired when they never had one.
    //
    // That is no longer true. /predict accepts anonymous callers and stores the
    // result in `guest_scans` against a per-browser token, so a visitor can
    // upload, see the verdict and answer the questions with no account at all.
    // Signing in later CLAIMS those rows into ai_scans, reusing the stored file
    // and the verdict already shown. The gate belongs at 'Doctors', which is the
    // first step that genuinely needs an identity — a reply has to reach
    // somebody.
    canEnter: () => true,
    blockedReason: () => '',
  }),
  Object.freeze({
    id: STEP_IDS.RESULT,
    title: 'Result',
    shortTitle: 'Result',
    description: 'What the model saw',
    canEnter: (state) => state.analysis.status === 'success' || Boolean(state.image.file),
    blockedReason: () => 'Add a photo first.',
  }),
  Object.freeze({
    id: STEP_IDS.SYMPTOMS,
    title: 'Symptoms',
    shortTitle: 'Symptoms',
    description: 'Six optional questions',
    optional: true,
    canEnter: (state) => state.analysis.status === 'success',
    blockedReason: () => 'Analyze the photo first.',
  }),
  Object.freeze({
    id: STEP_IDS.DOCTORS,
    title: 'Doctors',
    shortTitle: 'Doctors',
    description: 'Pick up to three',
    requiresAuth: true,
    canEnter: (state) => state.analysis.status === 'success',
    blockedReason: () => 'Analyze the photo first.',
  }),
  Object.freeze({
    id: STEP_IDS.SLOTS,
    title: 'Times',
    shortTitle: 'Times',
    description: 'Offer up to five',
    requiresAuth: true,
    canEnter: (state) => state.doctors.selected.length >= LIMITS.MIN_DOCTORS,
    blockedReason: () => 'Choose at least one doctor.',
  }),
  Object.freeze({
    id: STEP_IDS.DETAILS,
    title: 'Details',
    shortTitle: 'Details',
    description: 'Anything else we should know',
    optional: true,
    requiresAuth: true,
    canEnter: (state) => state.slots.picks.length >= LIMITS.MIN_SLOTS,
    blockedReason: () => 'Offer at least one time slot.',
  }),
  Object.freeze({
    id: STEP_IDS.REVIEW,
    title: 'Review',
    shortTitle: 'Review',
    description: 'Check and send',
    requiresAuth: true,
    /**
     * Sending is the panel's own primary action, so the footer's generic Next
     * would be a second, weaker button for the same job pointing at a step the
     * user cannot reach yet. ConsultPage reads this and hides it.
     */
    hideNext: true,
    canEnter: (state) => state.slots.picks.length >= LIMITS.MIN_SLOTS,
    blockedReason: () => 'Offer at least one time slot.',
  }),
  Object.freeze({
    id: STEP_IDS.CONFIRMATION,
    title: 'Sent',
    shortTitle: 'Sent',
    description: 'What happens next',
    requiresAuth: true,
    /**
     * Terminal. Back would land on a Review screen describing a request that has
     * already gone out, whose Send button would either resubmit it or sit there
     * inert — both are worse than no button. The confirmation offers real onward
     * links instead (the request itself, or a fresh scan).
     */
    terminal: true,
    canEnter: (state) => state.submit.status === 'success',
    blockedReason: () => 'Send the request first.',
  }),
]);

/** Index of a step id, or -1. */
export function stepIndexById(id) {
  return STEPS.findIndex((step) => step.id === id);
}

export function stepById(id) {
  return STEPS.find((step) => step.id === id) || null;
}

/** The step object the state currently points at. */
export function currentStep(state) {
  return STEPS[state.step] || STEPS[0];
}

/** True when the user may move one step forward from where they are. */
export function canGoNext(state) {
  const next = STEPS[state.step + 1];
  return Boolean(next) && next.canEnter(state);
}

/** Why Next is refusing, or '' when it is not. */
export function nextBlockedReason(state) {
  const next = STEPS[state.step + 1];
  if (!next) return '';
  return next.canEnter(state) ? '' : next.blockedReason(state);
}

/**
 * The `answers` field of POST /api/appointment-requests. Deliberately `null`
 * when the user skipped — the contract distinguishes "did not answer" from
 * "answered no to everything", and the triage engine weights them differently.
 * @returns {Record<string, boolean>|null}
 */
export function symptomAnswersPayload(state) {
  if (state.symptoms.skipped || !state.symptoms.answered) return null;
  return { ...state.symptoms.values };
}

/**
 * The "special description" as it will actually be sent.
 *
 * `details.description` is the box the Details step renders; `details.patientNote`
 * is the older key chunk 1 declared and the persistence layer already writes, so
 * a draft saved before the Details step existed still has somewhere to come from.
 * ONE wire field (`patient_note`) means exactly one source of truth here rather
 * than two boxes racing to fill it.
 *
 * @returns {string} trimmed and clamped to LIMITS.MAX_DESCRIPTION
 */
export function patientNotePayload(state) {
  const text = String(state?.details?.description || state?.details?.patientNote || '').trim();
  return text.slice(0, LIMITS.MAX_DESCRIPTION);
}

/**
 * The body of `POST /api/appointment-requests`, built in ONE place.
 *
 * It lives beside the reducer rather than inside StepReview so the request the
 * user is shown on the review screen and the request that goes on the wire are
 * derived from the same function — a review screen that summarises something
 * other than what it sends is worse than no review screen.
 *
 * SHAPES THE BACKEND ENFORCES AND WE THEREFORE MIRROR:
 *  - `doctor_ids` 1..3, and every doctor must be licence-APPROVED (a 400 lists
 *    `rejected_doctor_ids`; StepReview names them rather than echoing the id).
 *  - `preferred_slots` 1..5 with an explicit integer `rank`; a slot may only
 *    name a `doctor_id` that is also in `doctor_ids`, so an orphaned pick left
 *    behind by a de-selected doctor is dropped here instead of 400-ing.
 *  - `answers` is null when the six questions were skipped — NOT six falses.
 *
 * @param {object} state
 * @returns {{scan_id:number|null, doctor_ids:number[],
 *   preferred_slots:Array<{slot_date:string, slot_time:string, doctor_id:number|null, rank:number}>,
 *   answers:Record<string,boolean>|null, patient_note:string,
 *   express:boolean, consent_share_scan:boolean}}
 */
export function requestPayload(state) {
  const doctorIds = state.doctors.selected
    .map(doctorIdOf)
    .filter((id) => id !== null)
    .slice(0, LIMITS.MAX_DOCTORS);
  const allowed = new Set(doctorIds);

  const preferredSlots = state.slots.picks
    .filter((pick) => pick.doctor_id === null || allowed.has(pick.doctor_id))
    .slice(0, LIMITS.MAX_SLOTS)
    .map((pick, index) => ({
      slot_date: pick.slot_date,
      slot_time: pick.slot_time,
      doctor_id: pick.doctor_id ?? null,
      // Rank is the POSITION IN THIS ARRAY, recomputed after the filter above.
      // Carrying the original index would leave a gap ("1, 3, 4") that reads to
      // a doctor as a preference the patient never expressed.
      rank: index,
    }));

  return {
    scan_id: state.analysis.scanId ?? null,
    doctor_ids: doctorIds,
    preferred_slots: preferredSlots,
    answers: symptomAnswersPayload(state),
    patient_note: patientNotePayload(state),
    express: Boolean(state.express),
    consent_share_scan: Boolean(state.consent.shareScan),
  };
}

/**
 * True when a picked slot's date+time is already behind us.
 *
 * The soonest offer on the Times step is today's, and the backend only filters
 * past times WHEN IT GENERATES them: `normalize_slots` re-checks on submit and
 * returns an error on the FIRST stale slot, so one time that lapsed while the
 * patient was on Details or Review rejects the ENTIRE request — no doctors
 * invited, nothing dropped, and StepReview's "Try again" re-posts the identical
 * body for the identical 400 forever. A draft restored the next morning is
 * permanently unsendable for the same reason.
 *
 * Compared against the LOCAL clock, which is the one the patient is reading. A
 * time that has not passed on their clock is never reported as passed, so this
 * can only ever refuse a slot that is genuinely behind them.
 * @param {{slot_date?:string, slot_time?:string}} slot
 */
function slotHasPassed(slot) {
  const [year, month, day] = String(slot?.slot_date || '').split('-').map(Number);
  const [hour, minute] = String(slot?.slot_time || '').split(':').map(Number);
  if (![year, month, day, hour, minute].every((part) => Number.isFinite(part))) return false;
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime() < Date.now();
}

/**
 * Everything standing between the user and a successful send, as sentences.
 * Empty array = ready. StepReview renders these next to a disabled Send button
 * so "why can I not press this" is never a guess.
 * @returns {string[]}
 */
export function submitBlockers(state) {
  const payload = requestPayload(state);
  const blockers = [];

  if (!payload.scan_id) {
    blockers.push('This scan has not been saved yet — go back and analyse the photo.');
  }
  if (payload.doctor_ids.length < LIMITS.MIN_DOCTORS) {
    blockers.push('Choose at least one doctor.');
  }
  if (payload.preferred_slots.length < LIMITS.MIN_SLOTS) {
    blockers.push('Offer at least one time.');
  }
  const passed = payload.preferred_slots.filter(slotHasPassed);
  if (passed.length) {
    blockers.push(
      passed.length === 1
        ? `One of your preferred times (${passed[0].slot_date} at ${passed[0].slot_time}) has already `
          + 'passed — go back to Times and pick another.'
        : `${passed.length} of your preferred times have already passed — go back to Times and pick `
          + 'others.',
    );
  }
  if (!payload.consent_share_scan) {
    blockers.push('Tick the consent box so the doctors you picked can open the scan.');
  }
  return blockers;
}

/**
 * True when there is nothing worth losing. ConsultPage hides "Start over"
 * behind this, because offering to destroy an empty form is just noise.
 */
export function isPristineDraft(state) {
  if (!state) return true;
  return (
    !state.image.file
    && !state.image.dataUrl
    && !state.image.restored
    && state.analysis.status === 'idle'
    && !state.symptoms.answered
    && !state.symptoms.skipped
    && state.doctors.selected.length === 0
    && state.slots.picks.length === 0
    && !state.details.patientNote
    && !state.details.description
  );
}

/** How many of the six questions are answered "yes". */
export function symptomFlagCount(state) {
  const answers = symptomAnswersPayload(state);
  if (!answers) return 0;
  return SYMPTOM_KEYS.reduce((total, key) => total + (answers[key] ? 1 : 0), 0);
}

/** The severity to show: a triage score always beats the model's own guess. */
export function effectiveSeverity(state) {
  return state.triage.severity || state.analysis.severity || null;
}

export default consultReducer;
