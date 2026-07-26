/**
 * ConsultContext — the provider that owns the stepper's state, its side effects
 * and the two network calls the early steps make.
 *
 * WHAT LIVES HERE AND WHY
 * -----------------------
 * The reducer is pure, so the three things that CANNOT be pure live here:
 *
 *   1. Object URL lifetime. `URL.createObjectURL` leaks the whole decoded image
 *      until it is revoked. We diff `image.previewUrl` and `image.sourceUrl`
 *      across renders and revoke the outgoing one — including on unmount. This
 *      is why "replace photo" can be pressed twenty times without the tab
 *      growing by twenty photographs.
 *   2. The sessionStorage draft, debounced.
 *   3. `POST /predict` and `POST /api/triage-preview`, each guarded by an
 *      AbortController so a user who presses "Re-analyze" twice does not race
 *      two verdicts into the same slot.
 *
 * ANONYMOUS USERS ARE FIRST-CLASS THROUGH STEP 3
 * ----------------------------------------------
 * `/predict` accepts a request with no `user_id`, so someone who has not signed
 * up can upload, see the verdict and answer the questions. Only the steps that
 * actually need an account (choosing doctors onward) are gated, and that gate is
 * in STEPS, not here.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from 'react';

import { ApiError, post, request } from '../../lib/api';
import * as storage from '../../lib/storage';
import { scans as scanEndpoints, triage as triageEndpoints } from '../../lib/endpoints';
import { useOptionalAuth } from '../../context/AuthContext';
import {
  ACTIONS,
  LIMITS,
  STEPS,
  canGoNext,
  consultReducer,
  currentStep,
  initialConsultState,
  nextBlockedReason,
  stepIndexById,
  symptomAnswersPayload,
} from './consultReducer';
import { clearDraft, hydrateDraft, loadDraft, saveDraft } from './consultPersistence';

const ConsultContext = createContext(null);

/** How long the state must sit still before we write the draft. */
const AUTOSAVE_DEBOUNCE_MS = 500;

/**
 * Rebuild the state from the sessionStorage draft, or start clean.
 * `ownerId` is passed through to `loadDraft`, which destroys a draft belonging to
 * a DIFFERENT signed-in user rather than hydrating it — a tab outlives a session,
 * so without this the next person to sign in on a shared machine is shown the
 * previous patient's photo, prediction and answers.
 */
function init(ownerId) {
  const base = initialConsultState();
  try {
    const draft = loadDraft(ownerId);
    return draft ? hydrateDraft(draft, base, STEPS) : base;
  } catch {
    // A corrupt draft must never stop the page from rendering.
    return base;
  }
}

/** Revoke a blob: URL, tolerating a null or a plain http URL. */
function revoke(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('blob:')) return;
  try {
    URL.revokeObjectURL(url);
  } catch {
    /* already gone */
  }
}

export function ConsultProvider({ children }) {
  // Read before the reducer: `init` needs the owner to decide whether the
  // persisted draft belongs to whoever is sitting in front of this tab.
  const auth = useOptionalAuth();
  const userId = auth?.user?.id ?? null;
  const [state, dispatch] = useReducer(consultReducer, userId, init);

  /** The URLs we handed to the DOM last render, so we can revoke the outgoing ones. */
  const liveUrls = useRef({ preview: null, source: null });
  const analyzeAbort = useRef(null);
  const triageAbort = useRef(null);
  const saveTimer = useRef(null);
  const mounted = useRef(true);

  // -- object URL lifetime ---------------------------------------------------
  useEffect(() => {
    const { previewUrl, sourceUrl } = state.image;
    if (liveUrls.current.preview && liveUrls.current.preview !== previewUrl) {
      revoke(liveUrls.current.preview);
    }
    if (liveUrls.current.source && liveUrls.current.source !== sourceUrl) {
      revoke(liveUrls.current.source);
    }
    liveUrls.current = { preview: previewUrl, source: sourceUrl };
  }, [state.image]);

  // Re-arm on mount: StrictMode's simulated unmount fires this cleanup, and a
  // flag left false makes every guarded setState a no-op, so /predict and the
  // triage preview would resolve into a void and the wizard would never leave
  // "Analysing…".
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      revoke(liveUrls.current.preview);
      revoke(liveUrls.current.source);
      liveUrls.current = { preview: null, source: null };
      analyzeAbort.current?.abort();
      triageAbort.current?.abort();
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  // -- debounced autosave ----------------------------------------------------
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);

    /**
     * ONCE THE REQUEST IS SENT, STOP SAVING AND DELETE WHAT IS THERE.
     *
     * The server now holds the scan, the answers and the plan, so the local copy
     * is no longer a safety net — it is a photograph of someone's skin plus six
     * health answers sitting in storage for the rest of the session, resumable
     * by anyone who reopens the tab into a wizard for a consultation that
     * already exists.
     *
     * This guard is also what makes StepConfirmation's own `clearDraft()`
     * actually stick: that runs on mount, this timer would otherwise fire
     * ~500ms LATER (SUBMIT_SUCCESS changed `state`, which re-ran this effect)
     * and write the whole draft straight back in behind it.
     */
    if (state.submit.status === 'success') {
      clearDraft();
      return undefined;
    }

    saveTimer.current = setTimeout(() => {
      // Stamped with the owner so the next account in this tab cannot read it.
      saveDraft(state, userId);
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [state, userId]);

  // -- capture ---------------------------------------------------------------
  /**
   * @param {{file:File, previewUrl:string, sourceFile?:File, sourceUrl?:string,
   *          width?:number, height?:number, source?:'file'|'camera', dataUrl?:string}} payload
   */
  const selectImage = useCallback((payload) => {
    dispatch({ type: ACTIONS.IMAGE_SELECTED, payload });
  }, []);

  const setSensitive = useCallback((value) => {
    dispatch({ type: ACTIONS.IMAGE_SENSITIVITY_SET, payload: value });
  }, []);

  // -- analyze ---------------------------------------------------------------
  /**
   * POST /predict with the cropped, compressed file.
   * @param {File} [fileOverride] used by StepCapture when it wants to analyze
   *   the file it just produced, before the reducer state has settled.
   * @returns {Promise<object|null>} the normalised prediction, or null on failure
   */
  const analyze = useCallback(async (fileOverride) => {
    const file = fileOverride || state.image.file;
    if (!file) {
      dispatch({ type: ACTIONS.ANALYZE_ERROR, payload: { message: 'Choose a photo first.' } });
      return null;
    }

    analyzeAbort.current?.abort();
    const controller = new AbortController();
    analyzeAbort.current = controller;

    dispatch({ type: ACTIONS.ANALYZE_START });

    const form = new FormData();
    form.append('image', file, file.name || 'scan.jpg');
    if (userId) form.append('user_id', String(userId));
    // Multipart fields are strings on the wire; the backend parses the literal.
    form.append('is_sensitive', state.image.isSensitive ? 'true' : 'false');
    // Signed OUT: carry the browser's guest token so every pre-sign-up scan
    // lands under the SAME token and one claim adopts all of them.
    if (!userId) {
      const existing = storage.get(storage.KEYS.GUEST_TOKEN, null);
      if (existing) form.append('guest_token', existing);
    }

    try {
      const data = await request(scanEndpoints.predict(), {
        method: 'POST',
        body: form,
        signal: controller.signal,
        timeoutMs: 60_000,
      });
      if (!mounted.current) return null;
      // The server mints the token on the first guest scan. Persist it so the
      // scan survives sign-up: without it the row is orphaned and the user is
      // told to photograph themselves again.
      if (data?.guest_token) {
        storage.set(storage.KEYS.GUEST_TOKEN, data.guest_token);
      }
      dispatch({ type: ACTIONS.ANALYZE_SUCCESS, payload: data });
      return data;
    } catch (error) {
      if (error?.name === 'AbortError' || !mounted.current) return null;
      const message = error instanceof ApiError
        ? error.message
        : 'Could not analyze that photo. Please try again.';
      dispatch({ type: ACTIONS.ANALYZE_ERROR, payload: { message } });
      return null;
    } finally {
      if (analyzeAbort.current === controller) analyzeAbort.current = null;
    }
  }, [state.image.file, state.image.isSensitive, userId]);

  // -- triage preview --------------------------------------------------------
  /**
   * Score the current disease + answers WITHOUT writing anything. Safe to call
   * on every symptom change; the previous call is aborted.
   */
  /**
   * Adopt the scans this browser took before signing in.
   *
   * A guest scan is a real row in `guest_scans` keyed by an opaque browser
   * token; claiming copies it into `ai_scans` owned by the new user, REUSING the
   * stored file and the verdict already shown. That matters: re-uploading would
   * run the model a second time, and a classifier is not guaranteed to return
   * the same answer twice, so the diagnosis someone saw as a guest could quietly
   * differ from the one saved to their record.
   *
   * Idempotent server-side, so a retry or two tabs racing is harmless.
   *
   * @returns {Promise<number|null>} the new ai_scans id, or null if nothing was claimable
   */
  const claimGuestScans = useCallback(async () => {
    const token = storage.get(storage.KEYS.GUEST_TOKEN, null);
    if (!token) return null;

    try {
      const data = await post(scanEndpoints.claimGuest(), { guest_token: token });
      const scanId = data?.scan_id ?? null;
      if (scanId && mounted.current) {
        // Point the wizard at the real row; everything else on screen stays.
        dispatch({ type: ACTIONS.ANALYZE_SUCCESS, payload: { ...state.analysis, scan_id: scanId } });
      }
      // Claimed rows cannot be claimed again, so the token is spent.
      storage.remove(storage.KEYS.GUEST_TOKEN);
      return scanId;
    } catch (error) {
      // 404/410 mean expired or already gone. The caller falls back to a fresh
      // upload rather than stranding the user on a dead id.
      storage.remove(storage.KEYS.GUEST_TOKEN);
      return null;
    }
  }, [state.analysis]);

  const previewTriage = useCallback(async () => {
    const { disease, confidence } = state.analysis;
    if (!disease) return null;

    triageAbort.current?.abort();
    const controller = new AbortController();
    triageAbort.current = controller;

    dispatch({ type: ACTIONS.TRIAGE_START });

    try {
      const data = await post(
        triageEndpoints.preview(),
        {
          disease,
          confidence: confidence ?? null,
          answers: symptomAnswersPayload(state),
        },
        { signal: controller.signal, timeoutMs: 20_000 },
      );
      if (!mounted.current) return null;
      dispatch({ type: ACTIONS.TRIAGE_SET, payload: data });
      return data;
    } catch (error) {
      if (error?.name === 'AbortError' || !mounted.current) return null;
      const message = error instanceof ApiError
        ? error.message
        : 'Could not score this scan right now.';
      dispatch({ type: ACTIONS.TRIAGE_ERROR, payload: { message } });
      return null;
    } finally {
      if (triageAbort.current === controller) triageAbort.current = null;
    }
  }, [state]);

  // -- the three resets ------------------------------------------------------
  /** "Re-analyze this photo" — keeps the image, drops the verdict. */
  const resetResult = useCallback(() => {
    analyzeAbort.current?.abort();
    triageAbort.current?.abort();
    dispatch({ type: ACTIONS.RESULT_RESET });
  }, []);

  /** "Replace photo" — drops the image and the verdict, keeps doctors/times/notes. */
  const clearImage = useCallback(() => {
    analyzeAbort.current?.abort();
    triageAbort.current?.abort();
    dispatch({ type: ACTIONS.IMAGE_CLEARED });
  }, []);

  /** "Start over" — everything, including the persisted draft. */
  const resetAll = useCallback(() => {
    analyzeAbort.current?.abort();
    triageAbort.current?.abort();
    clearDraft();
    dispatch({ type: ACTIONS.RESET_ALL });
  }, []);

  // -- symptoms --------------------------------------------------------------
  const toggleSymptom = useCallback((key, value) => {
    dispatch({ type: ACTIONS.SYMPTOM_TOGGLE, payload: { key, ...(value === undefined ? {} : { value }) } });
  }, []);

  const skipSymptoms = useCallback(() => {
    dispatch({ type: ACTIONS.SYMPTOMS_SKIP });
  }, []);

  /** Withdraw a skip WITHOUT answering — back to genuinely unanswered. */
  const unskipSymptoms = useCallback(() => {
    dispatch({ type: ACTIONS.SYMPTOMS_UNSKIP });
  }, []);

  // -- doctors / slots / details (owned by the later steps) ------------------
  const toggleDoctor = useCallback((doctor) => {
    dispatch({ type: ACTIONS.DOCTOR_TOGGLE, payload: doctor });
  }, []);

  const setDoctors = useCallback((list) => {
    dispatch({ type: ACTIONS.DOCTORS_SET, payload: list });
  }, []);

  const addSlot = useCallback((slot) => {
    dispatch({ type: ACTIONS.SLOT_ADD, payload: slot });
  }, []);

  const removeSlot = useCallback((slotOrKey) => {
    dispatch({ type: ACTIONS.SLOT_REMOVE, payload: slotOrKey });
  }, []);

  const reorderSlots = useCallback((from, to) => {
    dispatch({ type: ACTIONS.SLOT_REORDER, payload: { from, to } });
  }, []);

  const setDetails = useCallback((patch) => {
    dispatch({ type: ACTIONS.DETAILS_SET, payload: patch });
  }, []);

  const setConsent = useCallback((patch) => {
    dispatch({ type: ACTIONS.CONSENT_SET, payload: patch });
  }, []);

  const setExpress = useCallback((value) => {
    dispatch({ type: ACTIONS.EXPRESS_SET, payload: value });
  }, []);

  // -- navigation ------------------------------------------------------------
  const goToStep = useCallback((index) => {
    dispatch({ type: ACTIONS.STEP_GOTO, payload: index });
  }, []);

  const goToStepId = useCallback((id) => {
    const index = stepIndexById(id);
    if (index >= 0) dispatch({ type: ACTIONS.STEP_GOTO, payload: index });
  }, []);

  const next = useCallback(() => {
    dispatch({ type: ACTIONS.STEP_GOTO, payload: state.step + 1 });
  }, [state.step]);

  /** Back is ALWAYS allowed — no guard, no confirmation, no data loss. */
  const back = useCallback(() => {
    dispatch({ type: ACTIONS.STEP_GOTO, payload: Math.max(0, state.step - 1) });
  }, [state.step]);

  const value = useMemo(() => ({
    state,
    dispatch,
    steps: STEPS,
    step: currentStep(state),
    stepIndex: state.step,
    furthest: state.furthest,
    limits: LIMITS,
    canNext: canGoNext(state),
    blockedReason: nextBlockedReason(state),
    isAuthenticated: Boolean(auth?.isAuthenticated),
    userId,

    selectImage,
    setSensitive,
    analyze,
    claimGuestScans,
    previewTriage,

    resetResult,
    clearImage,
    resetAll,

    toggleSymptom,
    skipSymptoms,
    unskipSymptoms,

    toggleDoctor,
    setDoctors,
    addSlot,
    removeSlot,
    reorderSlots,
    setDetails,
    setConsent,
    setExpress,

    goToStep,
    goToStepId,
    next,
    back,
  }), [
    state, auth?.isAuthenticated, userId,
    selectImage, setSensitive, analyze, claimGuestScans, previewTriage,
    resetResult, clearImage, resetAll,
    toggleSymptom, skipSymptoms, unskipSymptoms,
    toggleDoctor, setDoctors, addSlot, removeSlot, reorderSlots,
    setDetails, setConsent, setExpress,
    goToStep, goToStepId, next, back,
  ]);

  return <ConsultContext.Provider value={value}>{children}</ConsultContext.Provider>;
}

/**
 * @returns {{
 *   state:object, dispatch:Function, steps:ReadonlyArray<object>, step:object,
 *   stepIndex:number, furthest:number, limits:object, canNext:boolean,
 *   blockedReason:string, isAuthenticated:boolean, userId:number|null,
 *   selectImage:Function, setSensitive:Function, analyze:Function,
 *   previewTriage:Function, resetResult:Function, clearImage:Function,
 *   resetAll:Function, toggleSymptom:Function, skipSymptoms:Function,
 *   unskipSymptoms:Function,
 *   toggleDoctor:Function, setDoctors:Function, addSlot:Function,
 *   removeSlot:Function, reorderSlots:Function, setDetails:Function,
 *   setConsent:Function, setExpress:Function, goToStep:Function,
 *   goToStepId:Function, next:Function, back:Function
 * }}
 */
export function useConsult() {
  const context = useContext(ConsultContext);
  if (!context) {
    throw new Error('useConsult must be used inside <ConsultProvider>.');
  }
  return context;
}

export { ConsultContext };
export default ConsultProvider;
