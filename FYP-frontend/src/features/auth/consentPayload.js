/**
 * consentPayload.js — turning ticked boxes into the array `/auth/register`
 * records, and telling the user what is still missing BEFORE the round-trip.
 *
 * Kept out of ConsentBlock.jsx so the component file exports only a component
 * (fast refresh), and so these two rules — which are the client mirror of
 * `consent_service.missing_mandatory` — are unit-testable without a DOM.
 */

/**
 * Build the `consents` array /auth/register expects.
 *
 * Only documents that APPLY are submitted: the doctor-only ones are omitted
 * entirely from a patient signup rather than sent as `granted:false`, so the
 * append-only grant log never records a refusal of something never shown.
 *
 * @param {Array<{type:string, version:string}>} documents
 * @param {Record<string, boolean>} value
 * @returns {Array<{type:string, version:string, granted:boolean}>}
 */
export function buildConsentPayload(documents, value) {
  return (documents || []).map((doc) => ({
    type: doc.type,
    version: doc.version,
    granted: Boolean(value?.[doc.type]),
  }));
}

/**
 * The mandatory documents still unticked. `mandatory` comes from the server, so
 * this can never demand a box the API considers optional, nor let through one
 * it considers required.
 *
 * @param {Array<{type:string, mandatory:boolean}>} documents
 * @param {Record<string, boolean>} value
 * @returns {string[]} consent types
 */
export function missingMandatory(documents, value) {
  return (documents || [])
    .filter((doc) => doc.mandatory && !value?.[doc.type])
    .map((doc) => doc.type);
}

export default { buildConsentPayload, missingMandatory };
