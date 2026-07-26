/**
 * The step id -> step body registry.
 *
 * ConsultPage renders `stepElementFor(step.id)`. This indirection exists so that
 * adding a step means adding ONE line to STEP_COMPONENTS and one file next to
 * it — never touching ConsultPage's layout, its guards or its Back/Next wiring.
 *
 * WHY THIS EXPORTS ELEMENTS AND NOT JUST COMPONENTS
 * ------------------------------------------------
 * `const C = lookup(id); return <C />` creates a component VALUE during render.
 * React cannot prove across renders that the value is the same component, so the
 * subtree is liable to be torn down and remounted — which in this flow would
 * throw away StepCapture's local `mode`/`crop`/camera state on an unrelated
 * parent re-render. `react-hooks/static-components` flags it for exactly that
 * reason.
 *
 * App.jsx already solved this for routes: its `PAGES` map holds
 * `<PatientScans />` elements built once at module scope. Same trick here. The
 * elements are created ONCE, at import time, from the component map — so a new
 * step is still a one-line change to STEP_COMPONENTS and the element map follows
 * automatically.
 *
 * A step id with no entry returns null and ConsultPage renders its placeholder
 * rather than crashing, so the flow stays walkable while later steps are still
 * being built.
 */

import { createElement } from 'react';

import { STEP_IDS } from '../consultReducer';

import StepCapture from './StepCapture';
import StepResult from './StepResult';
import StepSymptoms from './StepSymptoms';
import StepDoctors from './StepDoctors';
import StepSlots from './StepSlots';
import StepDetails from './StepDetails';
import StepReview from './StepReview';
import StepConfirmation from './StepConfirmation';

/**
 * The one line a new step adds.
 * @type {Record<string, React.ComponentType>}
 */
export const STEP_COMPONENTS = {
  [STEP_IDS.CAPTURE]: StepCapture,
  [STEP_IDS.RESULT]: StepResult,
  [STEP_IDS.SYMPTOMS]: StepSymptoms,
  [STEP_IDS.DOCTORS]: StepDoctors,
  [STEP_IDS.SLOTS]: StepSlots,
  [STEP_IDS.DETAILS]: StepDetails,
  [STEP_IDS.REVIEW]: StepReview,
  [STEP_IDS.CONFIRMATION]: StepConfirmation,
};

/**
 * The same map, as elements built once at module scope. Steps take no props —
 * everything they need comes from `useConsult()` — so a single shared element
 * per step is safe and stable.
 * @type {Record<string, React.ReactElement>}
 */
export const STEP_ELEMENTS = Object.freeze(
  Object.fromEntries(
    Object.entries(STEP_COMPONENTS).map(([id, Component]) => [id, createElement(Component)]),
  ),
);

/**
 * The element for a step id, or null when that step is not built yet.
 * @param {string} id one of STEP_IDS
 * @returns {React.ReactElement|null}
 */
export function stepElementFor(id) {
  return STEP_ELEMENTS[id] || null;
}

/** The component type, for tests and for anything that needs to wrap a step. */
export function stepComponentFor(id) {
  return STEP_COMPONENTS[id] || null;
}

export {
  StepCapture,
  StepResult,
  StepSymptoms,
  StepDoctors,
  StepSlots,
  StepDetails,
  StepReview,
  StepConfirmation,
};
