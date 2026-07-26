/**
 * consultPersistence — the consult draft, in sessionStorage.
 *
 * WHY sessionStorage AND NOT localStorage
 * ---------------------------------------
 * A half-finished scan contains a photograph of someone's skin and six health
 * answers. It belongs to the tab it was created in and it dies with that tab.
 * localStorage would leave it on a shared or family machine indefinitely, which
 * is exactly what the sensitivity toggle exists to prevent.
 *
 * WHY IT NEVER THROWS
 * -------------------
 * Safari in private mode throws on `setItem`. Every browser throws
 * QuotaExceededError once a base64 photo pushes the ~5 MB origin quota. A
 * failed autosave must never take the wizard down mid-scan, so every entry
 * point here is wrapped and the shed order is explicit and progressive:
 *
 *      1. drop `details.attachments`   (largest, easiest to re-add)
 *      2. drop `image.dataUrl`         (the base64 photo preview)
 *      3. give up, clear the key       (a corrupt half-write is worse than none)
 *
 * WHAT IS NOT PERSISTED
 * ---------------------
 * `File`, `Blob` and `blob:` object URLs. They are not serialisable and an
 * object URL from a previous page load is already dead. The draft therefore
 * restores the ANALYSIS (which lives on the server behind `scanId`) and the
 * plan, and asks for the photo again only when it genuinely still needs one.
 *
 * `details.attachments` needs the SAME care and does not get it for free: a File
 * inside an array does not throw on `JSON.stringify`, it silently becomes `{}`.
 * Restoring that would put an empty object where a File is expected, and it
 * would reach `FormData.append` before anyone noticed. So attachments are
 * projected through `lib/attachments.js` in both directions.
 *
 * THE DRAFT IS SCOPED TO A USER, NOT JUST TO A TAB
 * ------------------------------------------------
 * A tab outlives a session: signing out does not close it, and `clearSession()`
 * cannot reach this key (it lives in sessionStorage under a dot-separated name,
 * not the `aiderma:` localStorage namespace). Without an owner stamp the next
 * person to sign in on a shared or clinic machine would be handed the previous
 * patient's photograph, prediction and six health answers. So every draft
 * records who wrote it and is discarded on a mismatch. `owner: null` means
 * "written by an anonymous visitor" and stays claimable, because signing in
 * mid-wizard is a supported flow and must not destroy the draft.
 */

import { fromPersisted, toPersisted } from './lib/attachments';

export const DRAFT_KEY = 'aiderma.consult.draft.v1';
/** Bump when the persisted shape changes incompatibly; old drafts are dropped. */
export const DRAFT_VERSION = 1;
/** Older than this and the draft is stale enough that resuming would confuse. */
export const DRAFT_TTL_MS = 12 * 60 * 60 * 1000;
/** Refuse to even try storing a data URL above this; it will not fit anyway. */
export const MAX_DATA_URL_BYTES = 1_500_000;

function storage() {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null;
    return window.sessionStorage;
  } catch {
    // Cookies disabled entirely: accessing the property itself throws.
    return null;
  }
}

/** True for the several names browsers give the "you are out of room" error. */
function isQuotaError(error) {
  if (!error) return false;
  return (
    error.name === 'QuotaExceededError'
    || error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || error.code === 22
    || error.code === 1014
  );
}

// ---------------------------------------------------------------------------
// Serialise
// ---------------------------------------------------------------------------

/** Normalise a user id to the form stored in (and compared against) the draft. */
export function draftOwnerId(userId) {
  if (userId === null || userId === undefined || userId === '') return null;
  const id = Number(userId);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/**
 * The serialisable projection of the consult state. Files and object URLs are
 * dropped; `image.hadFile` remembers that there WAS one so the restored session
 * can say "re-select your photo" instead of pretending nothing happened.
 * @param {object} state
 * @param {number|null} [ownerId] the signed-in user this draft belongs to.
 */
export function serializeDraft(state, ownerId = null) {
  if (!state || typeof state !== 'object') return null;

  return {
    v: DRAFT_VERSION,
    savedAt: Date.now(),
    owner: draftOwnerId(ownerId),
    step: state.step,
    furthest: state.furthest,
    image: {
      name: state.image?.name || '',
      size: state.image?.size || 0,
      type: state.image?.type || '',
      width: state.image?.width || 0,
      height: state.image?.height || 0,
      isSensitive: Boolean(state.image?.isSensitive),
      source: state.image?.source || null,
      dataUrl: typeof state.image?.dataUrl === 'string' ? state.image.dataUrl : null,
      hadFile: Boolean(state.image?.file) || Boolean(state.image?.restored),
    },
    analysis: {
      status: state.analysis?.status === 'success' ? 'success' : 'idle',
      scanId: state.analysis?.scanId ?? null,
      disease: state.analysis?.disease || '',
      confidence: state.analysis?.confidence ?? null,
      severity: state.analysis?.severity ?? null,
      imageEndpoint: state.analysis?.imageEndpoint ?? null,
    },
    symptoms: {
      values: { ...(state.symptoms?.values || {}) },
      answered: Boolean(state.symptoms?.answered),
      skipped: Boolean(state.symptoms?.skipped),
    },
    triage: {
      status: state.triage?.status === 'success' ? 'success' : 'idle',
      severity: state.triage?.severity ?? null,
      score: state.triage?.score ?? null,
      reasons: Array.isArray(state.triage?.reasons) ? state.triage.reasons : [],
      isEmergency: Boolean(state.triage?.isEmergency),
    },
    doctors: { selected: Array.isArray(state.doctors?.selected) ? state.doctors.selected : [] },
    slots: { picks: Array.isArray(state.slots?.picks) ? state.slots.picks : [] },
    details: {
      patientNote: state.details?.patientNote || '',
      description: state.details?.description || '',
      // Files stripped here, not by JSON.stringify — see the header note.
      attachments: (Array.isArray(state.details?.attachments) ? state.details.attachments : [])
        .map(toPersisted)
        .filter(Boolean),
    },
    consent: { shareScan: Boolean(state.consent?.shareScan) },
    express: Boolean(state.express),
  };
}

/**
 * The progressive shed. Each entry returns a SMALLER draft, or null when there
 * is nothing left to give up.
 * @type {ReadonlyArray<{label:string, shrink:(draft:object)=>object|null}>}
 */
const SHED_ORDER = Object.freeze([
  {
    label: 'attachments',
    shrink: (draft) => (draft.details?.attachments?.length
      ? { ...draft, details: { ...draft.details, attachments: [] } }
      : null),
  },
  {
    label: 'image',
    shrink: (draft) => (draft.image?.dataUrl
      ? { ...draft, image: { ...draft.image, dataUrl: null } }
      : null),
  },
]);

/**
 * Write the draft. Never throws.
 * @param {object} state the live consult state
 * @param {number|null} [ownerId] the signed-in user this draft belongs to.
 * @returns {{ok:boolean, shed:string[], reason?:string}}
 */
export function saveDraft(state, ownerId = null) {
  const store = storage();
  if (!store) return { ok: false, shed: [], reason: 'unavailable' };

  let draft = serializeDraft(state, ownerId);
  if (!draft) return { ok: false, shed: [], reason: 'empty' };

  // Pre-emptive trim: a multi-megabyte base64 string is guaranteed to fail, and
  // failing fast avoids the expensive stringify-then-throw cycle.
  if (draft.image.dataUrl && draft.image.dataUrl.length > MAX_DATA_URL_BYTES) {
    draft = { ...draft, image: { ...draft.image, dataUrl: null } };
  }

  const shed = [];
  let shedIndex = 0;

  for (;;) {
    try {
      store.setItem(DRAFT_KEY, JSON.stringify(draft));
      return { ok: true, shed };
    } catch (error) {
      if (!isQuotaError(error)) {
        // Private mode, a disabled origin, a JSON cycle. Nothing to shed here.
        return { ok: false, shed, reason: error?.name || 'error' };
      }

      let shrunk = null;
      while (shedIndex < SHED_ORDER.length && !shrunk) {
        shrunk = SHED_ORDER[shedIndex].shrink(draft);
        if (shrunk) shed.push(SHED_ORDER[shedIndex].label);
        shedIndex += 1;
      }

      if (!shrunk) {
        // Even the bare draft will not fit. Remove the stale key rather than
        // leaving a half-written or outdated one behind.
        clearDraft();
        return { ok: false, shed, reason: 'quota' };
      }
      draft = shrunk;
    }
  }
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Read the raw persisted draft, or null. Never throws. Expired, wrong-version
 * and SOMEBODY ELSE'S drafts are removed as a side effect.
 * @param {number|null} [ownerId] the user asking for it. A draft written by a
 *   different signed-in user is destroyed rather than handed over; a draft with
 *   no owner (written anonymously) is claimable by whoever asks next.
 * @returns {object|null}
 */
export function loadDraft(ownerId = null) {
  const store = storage();
  if (!store) return null;

  let raw;
  try {
    raw = store.getItem(DRAFT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    clearDraft();
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || parsed.v !== DRAFT_VERSION) {
    clearDraft();
    return null;
  }
  if (!Number.isFinite(parsed.savedAt) || Date.now() - parsed.savedAt > DRAFT_TTL_MS) {
    clearDraft();
    return null;
  }
  // A photograph of someone's skin plus six health answers must never cross from
  // one signed-in account to another in the same tab.
  const owner = draftOwnerId(parsed.owner);
  if (owner !== null && owner !== draftOwnerId(ownerId)) {
    clearDraft();
    return null;
  }
  return parsed;
}

/**
 * Merge a persisted draft onto a fresh state object. Anything the draft cannot
 * carry (the File, the object URLs) stays at its initial value, and `step` is
 * pulled back to the last step the restored data can actually satisfy.
 *
 * @param {object} draft   from loadDraft()
 * @param {object} base    from initialConsultState()
 * @param {ReadonlyArray<{canEnter:(s:object)=>boolean}>} steps  STEPS
 * @returns {object} the hydrated state
 */
export function hydrateDraft(draft, base, steps = []) {
  if (!draft || !base) return base;

  const state = {
    ...base,
    image: {
      ...base.image,
      name: draft.image?.name || '',
      size: draft.image?.size || 0,
      type: draft.image?.type || '',
      width: draft.image?.width || 0,
      height: draft.image?.height || 0,
      isSensitive: Boolean(draft.image?.isSensitive),
      source: draft.image?.source || null,
      dataUrl: draft.image?.dataUrl || null,
      // The File is gone with the page. Flag it so StepCapture can explain why
      // it is asking for the photo again instead of silently looking empty.
      restored: Boolean(draft.image?.hadFile),
    },
    analysis: {
      ...base.analysis,
      status: draft.analysis?.status === 'success' ? 'success' : 'idle',
      scanId: draft.analysis?.scanId ?? null,
      disease: draft.analysis?.disease || '',
      confidence: draft.analysis?.confidence ?? null,
      severity: draft.analysis?.severity ?? null,
      imageEndpoint: draft.analysis?.imageEndpoint ?? null,
    },
    symptoms: {
      ...base.symptoms,
      values: { ...base.symptoms.values, ...(draft.symptoms?.values || {}) },
      answered: Boolean(draft.symptoms?.answered),
      skipped: Boolean(draft.symptoms?.skipped),
    },
    triage: {
      ...base.triage,
      status: draft.triage?.status === 'success' ? 'success' : 'idle',
      severity: draft.triage?.severity ?? null,
      score: draft.triage?.score ?? null,
      reasons: Array.isArray(draft.triage?.reasons) ? draft.triage.reasons : [],
      isEmergency: Boolean(draft.triage?.isEmergency),
    },
    doctors: { selected: Array.isArray(draft.doctors?.selected) ? draft.doctors.selected : [] },
    slots: { picks: Array.isArray(draft.slots?.picks) ? draft.slots.picks : [] },
    details: {
      ...base.details,
      ...(draft.details || {}),
      // Each restored entry keeps its name, size and thumbnail but has NO File,
      // so `restored: true` is what lets the strip ask for it again instead of
      // pretending it can still be uploaded.
      attachments: (Array.isArray(draft.details?.attachments) ? draft.details.attachments : [])
        .map(fromPersisted)
        .filter(Boolean),
    },
    consent: { shareScan: Boolean(draft.consent?.shareScan) },
    express: Boolean(draft.express),
    step: 0,
    furthest: 0,
  };

  // Walk forward to the furthest step the restored data still satisfies. A
  // draft that claimed step 4 but lost its doctors must land on step 3, not on
  // a screen with nothing on it.
  const wanted = Math.max(0, Math.min(steps.length - 1, Number(draft.step) || 0));
  let reached = 0;
  for (let index = 1; index <= wanted; index += 1) {
    if (!steps[index]?.canEnter(state)) break;
    reached = index;
  }
  state.step = reached;
  state.furthest = Math.max(reached, Math.min(steps.length - 1, Number(draft.furthest) || reached));
  return state;
}

/** Remove the draft. Never throws. */
export function clearDraft() {
  const store = storage();
  if (!store) return false;
  try {
    store.removeItem(DRAFT_KEY);
    return true;
  } catch {
    return false;
  }
}

/** True when a resumable draft exists for this user (cheap: no hydration). */
export function hasDraft(ownerId = null) {
  return loadDraft(ownerId) !== null;
}

export default {
  saveDraft, loadDraft, hydrateDraft, clearDraft, hasDraft, draftOwnerId, DRAFT_KEY,
};
