/**
 * The whole consult flow, walked through the reducer.
 *
 * This is not a component test — it does not render anything. It asserts the
 * thing that is actually hard to get right and impossible to eyeball: that the
 * eight steps are reachable in order, that each gate opens exactly when its
 * precondition is met and not before, and that the body posted to
 * `/api/appointment-requests` matches what the review screen was summarising.
 *
 * The reducer is pure (no network, no sessionStorage, no createObjectURL), which
 * is precisely what makes this possible.
 */

import { describe, expect, it } from 'vitest';

import {
  ACTIONS,
  LIMITS,
  STEPS,
  STEP_IDS,
  consultReducer,
  initialConsultState,
  patientNotePayload,
  requestPayload,
  stepIndexById,
  submitBlockers,
  symptomAnswersPayload,
} from '../consultReducer';
import { clearDraft, hydrateDraft, loadDraft, saveDraft } from '../consultPersistence';
import { uploadableAttachments } from '../lib/attachments';

/** Apply a list of actions in order. */
function run(state, actions) {
  return actions.reduce((current, action) => consultReducer(current, action), state);
}

const doctorA = { id: 11, name: 'Dr Ayesha Khan', specialty: 'Dermatology', isVerified: true };
const doctorB = { id: 12, name: 'Dr Bilal Ahmed', specialty: 'Dermatology', isVerified: true };
const doctorC = { id: 13, name: 'Dr Sara Malik', specialty: 'Dermatology', isVerified: true };

const PREDICTION = { scan_id: 501, disease: 'melanoma', confidence: 0.91, severity: 'High' };

/** A state that has cleared the capture + result gates. */
function analysed() {
  return run(initialConsultState(), [
    {
      type: ACTIONS.IMAGE_SELECTED,
      payload: { file: { name: 'spot.jpg', size: 400_000, type: 'image/jpeg' }, width: 1600, height: 1600 },
    },
    { type: ACTIONS.ANALYZE_SUCCESS, payload: PREDICTION },
  ]);
}

describe('the eight steps', () => {
  it('is capture -> result -> symptoms -> doctors -> slots -> details -> review -> confirmation', () => {
    expect(STEPS.map((step) => step.id)).toEqual([
      STEP_IDS.CAPTURE,
      STEP_IDS.RESULT,
      STEP_IDS.SYMPTOMS,
      STEP_IDS.DOCTORS,
      STEP_IDS.SLOTS,
      STEP_IDS.DETAILS,
      STEP_IDS.REVIEW,
      STEP_IDS.CONFIRMATION,
    ]);
  });

  it('flags exactly the three optional steps and the one terminal step', () => {
    expect(STEPS.filter((step) => step.optional).map((s) => s.id))
      .toEqual([STEP_IDS.SYMPTOMS, STEP_IDS.DETAILS]);
    expect(STEPS.filter((step) => step.terminal).map((s) => s.id))
      .toEqual([STEP_IDS.CONFIRMATION]);
    expect(STEPS.filter((step) => step.hideNext).map((s) => s.id))
      .toEqual([STEP_IDS.REVIEW]);
  });
});

describe('walking the flow end to end', () => {
  it('reaches the confirmation step, skipping the optional symptom questions', () => {
    let state = analysed();
    expect(state.step).toBe(stepIndexById(STEP_IDS.RESULT));

    // Skip the six questions rather than answering them.
    state = consultReducer(state, { type: ACTIONS.SYMPTOMS_SKIP });
    expect(symptomAnswersPayload(state)).toBeNull();

    // Straight past Symptoms to Doctors — the gate only wants a successful analysis.
    state = consultReducer(state, {
      type: ACTIONS.STEP_GOTO,
      payload: stepIndexById(STEP_IDS.DOCTORS),
    });
    expect(state.step).toBe(stepIndexById(STEP_IDS.DOCTORS));

    // Slots refuses to open until a doctor is chosen.
    state = consultReducer(state, {
      type: ACTIONS.STEP_GOTO,
      payload: stepIndexById(STEP_IDS.SLOTS),
    });
    expect(state.step).toBe(stepIndexById(STEP_IDS.DOCTORS));

    state = run(state, [
      { type: ACTIONS.DOCTOR_TOGGLE, payload: doctorA },
      { type: ACTIONS.DOCTOR_TOGGLE, payload: doctorB },
      { type: ACTIONS.STEP_GOTO, payload: stepIndexById(STEP_IDS.SLOTS) },
    ]);
    expect(state.step).toBe(stepIndexById(STEP_IDS.SLOTS));

    // Details refuses until a time is offered.
    state = consultReducer(state, {
      type: ACTIONS.STEP_GOTO,
      payload: stepIndexById(STEP_IDS.DETAILS),
    });
    expect(state.step).toBe(stepIndexById(STEP_IDS.SLOTS));

    state = run(state, [
      { type: ACTIONS.SLOT_ADD, payload: { slot_date: '2099-01-04', slot_time: '09:30', doctor_id: 11 } },
      { type: ACTIONS.SLOT_ADD, payload: { slot_date: '2099-01-05', slot_time: '14:00', doctor_id: 12 } },
      { type: ACTIONS.STEP_GOTO, payload: stepIndexById(STEP_IDS.DETAILS) },
    ]);
    expect(state.step).toBe(stepIndexById(STEP_IDS.DETAILS));

    // Details is optional: Review opens with the description still blank.
    state = consultReducer(state, {
      type: ACTIONS.STEP_GOTO,
      payload: stepIndexById(STEP_IDS.REVIEW),
    });
    expect(state.step).toBe(stepIndexById(STEP_IDS.REVIEW));

    // Confirmation is unreachable until the request has actually been sent...
    state = consultReducer(state, {
      type: ACTIONS.STEP_GOTO,
      payload: stepIndexById(STEP_IDS.CONFIRMATION),
    });
    expect(state.step).toBe(stepIndexById(STEP_IDS.REVIEW));

    // ...and SUBMIT_SUCCESS lands on it in the same dispatch.
    state = consultReducer(state, {
      type: ACTIONS.SUBMIT_SUCCESS,
      payload: { request_id: 77, express: true, doctors: [], slots: [] },
    });
    expect(state.step).toBe(stepIndexById(STEP_IDS.CONFIRMATION));
    expect(state.submit.requestId).toBe(77);
  });

  it('lets Back through unguarded from the review step', () => {
    let state = analysed();
    state = run(state, [
      { type: ACTIONS.DOCTOR_TOGGLE, payload: doctorA },
      { type: ACTIONS.SLOT_ADD, payload: { slot_date: '2099-01-04', slot_time: '09:30', doctor_id: 11 } },
      { type: ACTIONS.STEP_GOTO, payload: stepIndexById(STEP_IDS.REVIEW) },
      { type: ACTIONS.STEP_GOTO, payload: stepIndexById(STEP_IDS.CAPTURE) },
    ]);
    expect(state.step).toBe(stepIndexById(STEP_IDS.CAPTURE));
    // ...and going back has not thrown away the plan.
    expect(state.doctors.selected).toHaveLength(1);
    expect(state.slots.picks).toHaveLength(1);
  });
});

describe('requestPayload', () => {
  function planned() {
    return run(analysed(), [
      { type: ACTIONS.DOCTOR_TOGGLE, payload: doctorA },
      { type: ACTIONS.DOCTOR_TOGGLE, payload: doctorB },
      { type: ACTIONS.SLOT_ADD, payload: { slot_date: '2099-01-04', slot_time: '09:30', doctor_id: 11 } },
      { type: ACTIONS.SLOT_ADD, payload: { slot_date: '2099-01-05', slot_time: '14:00', doctor_id: 12 } },
      { type: ACTIONS.SLOT_ADD, payload: { slot_date: '2099-01-06', slot_time: '11:00', doctor_id: 11 } },
      { type: ACTIONS.CONSENT_SET, payload: { shareScan: true } },
    ]);
  }

  it('builds the contract body', () => {
    const payload = requestPayload(planned());
    expect(payload.scan_id).toBe(501);
    expect(payload.doctor_ids).toEqual([11, 12]);
    expect(payload.preferred_slots).toEqual([
      { slot_date: '2099-01-04', slot_time: '09:30', doctor_id: 11, rank: 0 },
      { slot_date: '2099-01-05', slot_time: '14:00', doctor_id: 12, rank: 1 },
      { slot_date: '2099-01-06', slot_time: '11:00', doctor_id: 11, rank: 2 },
    ]);
    expect(payload.answers).toBeNull();
    expect(payload.consent_share_scan).toBe(true);
  });

  it('sends `answers: null` for skipped, but an object for "none apply"', () => {
    const skipped = consultReducer(planned(), { type: ACTIONS.SYMPTOMS_SKIP });
    expect(requestPayload(skipped).answers).toBeNull();

    // Answering one question "no" is a CLAIM, and must reach the wire as one.
    const answered = consultReducer(planned(), {
      type: ACTIONS.SYMPTOM_TOGGLE,
      payload: { key: 'is_bleeding', value: false },
    });
    expect(requestPayload(answered).answers).toEqual({
      is_bleeding: false,
      growing_fast: false,
      has_severe_pain: false,
      irregular_border: false,
      color_change: false,
      diameter_over_6mm: false,
    });
  });

  it('renumbers ranks after dropping a de-selected doctor\'s slots', () => {
    // DOCTOR_TOGGLE already drops that doctor's picks; this covers the payload
    // builder's own guard, which is what protects the 400 "a preferred slot
    // names a doctor who is not on this request".
    const state = planned();
    const orphaned = {
      ...state,
      slots: {
        picks: [
          ...state.slots.picks,
          { key: '99|2099-01-07|10:00', slot_date: '2099-01-07', slot_time: '10:00', doctor_id: 99 },
        ],
      },
    };
    const payload = requestPayload(orphaned);
    expect(payload.preferred_slots).toHaveLength(3);
    expect(payload.preferred_slots.map((slot) => slot.rank)).toEqual([0, 1, 2]);
  });

  it('never exceeds the contract maximums', () => {
    let state = planned();
    [doctorC, { id: 14, name: 'Dr Four' }].forEach((doctor) => {
      state = consultReducer(state, { type: ACTIONS.DOCTOR_TOGGLE, payload: doctor });
    });
    expect(requestPayload(state).doctor_ids.length).toBeLessThanOrEqual(LIMITS.MAX_DOCTORS);

    for (let index = 0; index < 8; index += 1) {
      state = consultReducer(state, {
        type: ACTIONS.SLOT_ADD,
        payload: { slot_date: '2099-02-01', slot_time: `1${index}:00`, doctor_id: 11 },
      });
    }
    expect(requestPayload(state).preferred_slots.length).toBeLessThanOrEqual(LIMITS.MAX_SLOTS);
  });

  it('trims and clamps the special description to 500 characters', () => {
    const state = consultReducer(planned(), {
      type: ACTIONS.DETAILS_SET,
      payload: { description: `  ${'x'.repeat(600)}  ` },
    });
    expect(patientNotePayload(state)).toHaveLength(LIMITS.MAX_DESCRIPTION);
    expect(requestPayload(state).patient_note).toHaveLength(LIMITS.MAX_DESCRIPTION);
  });

  it('falls back to the older patientNote key for a pre-Details draft', () => {
    const state = consultReducer(planned(), {
      type: ACTIONS.DETAILS_SET,
      payload: { patientNote: 'From an older draft.' },
    });
    expect(requestPayload(state).patient_note).toBe('From an older draft.');
  });
});

describe('submitBlockers', () => {
  it('blocks on the consent box and clears once it is ticked', () => {
    let state = run(analysed(), [
      { type: ACTIONS.DOCTOR_TOGGLE, payload: doctorA },
      { type: ACTIONS.SLOT_ADD, payload: { slot_date: '2099-01-04', slot_time: '09:30', doctor_id: 11 } },
    ]);
    expect(submitBlockers(state)).toEqual([
      'Tick the consent box so the doctors you picked can open the scan.',
    ]);

    state = consultReducer(state, { type: ACTIONS.CONSENT_SET, payload: { shareScan: true } });
    expect(submitBlockers(state)).toEqual([]);
  });

  it('names every missing piece at once on an empty draft', () => {
    expect(submitBlockers(initialConsultState())).toHaveLength(4);
  });
});

describe('the draft survives a reload without smuggling a File through JSON', () => {
  it('strips the File and flags the restored attachment', () => {
    clearDraft();
    const state = run(analysed(), [
      { type: ACTIONS.DOCTOR_TOGGLE, payload: doctorA },
      { type: ACTIONS.SLOT_ADD, payload: { slot_date: '2099-01-04', slot_time: '09:30', doctor_id: 11 } },
      { type: ACTIONS.DETAILS_SET, payload: { description: 'Itches at night.' } },
      {
        type: ACTIONS.DETAILS_SET,
        payload: {
          attachments: [{
            id: 'att_1',
            // A real File would serialise to `{}` and then be handed to
            // FormData.append. This is the regression that must not come back.
            file: new File(['xx'], 'wider.jpg', { type: 'image/jpeg' }),
            name: 'wider.jpg',
            size: 2,
            type: 'image/jpeg',
            thumbUrl: 'data:image/jpeg;base64,AAAA',
            restored: false,
          }],
        },
      },
    ]);

    expect(saveDraft(state).ok).toBe(true);

    const raw = loadDraft();
    expect(raw.details.attachments[0]).not.toHaveProperty('file');

    const restored = hydrateDraft(raw, initialConsultState(), STEPS);
    const [attachment] = restored.details.attachments;
    expect(attachment.file).toBeNull();
    expect(attachment.restored).toBe(true);
    expect(attachment.name).toBe('wider.jpg');
    expect(attachment.thumbUrl).toBe('data:image/jpeg;base64,AAAA');

    // A restored attachment is not uploadable, so it never reaches the request.
    expect(uploadableAttachments(restored.details.attachments)).toHaveLength(0);
    expect(restored.details.description).toBe('Itches at night.');
    clearDraft();
  });
});

describe('the three resets still behave after the new steps', () => {
  it('IMAGE_CLEARED keeps the doctors, the times and the description', () => {
    const state = run(analysed(), [
      { type: ACTIONS.DOCTOR_TOGGLE, payload: doctorA },
      { type: ACTIONS.SLOT_ADD, payload: { slot_date: '2099-01-04', slot_time: '09:30', doctor_id: 11 } },
      { type: ACTIONS.DETAILS_SET, payload: { description: 'It started three weeks ago.' } },
      { type: ACTIONS.IMAGE_CLEARED },
    ]);
    expect(state.image.file).toBeNull();
    expect(state.analysis.status).toBe('idle');
    expect(state.doctors.selected).toHaveLength(1);
    expect(state.slots.picks).toHaveLength(1);
    expect(state.details.description).toBe('It started three weeks ago.');
    expect(state.step).toBe(stepIndexById(STEP_IDS.CAPTURE));
  });

  it('RESET_ALL clears the description and the consent tick', () => {
    const state = run(analysed(), [
      { type: ACTIONS.DETAILS_SET, payload: { description: 'Something.' } },
      { type: ACTIONS.CONSENT_SET, payload: { shareScan: true } },
      { type: ACTIONS.RESET_ALL },
    ]);
    expect(state.details.description).toBe('');
    expect(state.consent.shareScan).toBe(false);
    expect(state.step).toBe(0);
  });
});
