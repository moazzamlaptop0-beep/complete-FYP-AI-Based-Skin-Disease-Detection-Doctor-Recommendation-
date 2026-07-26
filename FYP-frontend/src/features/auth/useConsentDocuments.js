/**
 * useConsentDocuments — the signup form's consent catalogue, from the server.
 *
 * WHY TWO REQUESTS
 * ----------------
 * `/auth/consent-documents` is ROLE-AWARE: `?role=Doctor` returns a superset
 * that includes the licence attestation, and a document's `mandatory` flag can
 * differ between the two. The doctor switch flips mid-form, so the form needs
 * both answers at once. Fetching both on mount (in parallel, unauthenticated,
 * a few hundred bytes each) means the switch is instant and — crucially — the
 * "which documents are doctors-only" split is DERIVED from the server rather
 * than hardcoded here. Add a document to CONSENT_SPECS on the backend and this
 * form renders it with no frontend change.
 *
 * DEGRADED MODE
 * -------------
 * If the endpoint is unreachable the form must not become un-submittable, but
 * it also must not silently drop consent capture — that is the one thing this
 * product cannot fake. So a failure surfaces as a retryable error and the
 * submit button stays disabled until the catalogue loads.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ROLE_DOCTOR, ROLE_PATIENT, consentDocuments } from './authApi';
import { DEFAULT_MIN_LENGTH } from './passwordStrength';

const EMPTY = [];

/**
 * @returns {{
 *   patientDocuments: Array<object>,
 *   doctorDocuments: Array<object>,
 *   doctorOnlyDocuments: Array<object>,
 *   passwordPolicy: {min_length:number, rules:string[]},
 *   loading: boolean,
 *   error: string|null,
 *   reload: () => void,
 * }}
 */
export function useConsentDocuments() {
  const [patient, setPatient] = useState(EMPTY);
  const [doctor, setDoctor] = useState(EMPTY);
  const [passwordPolicy, setPasswordPolicy] = useState({
    min_length: DEFAULT_MIN_LENGTH,
    rules: [],
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  const alive = useRef(true);
  // Must re-arm on mount: StrictMode's simulated unmount fires the cleanup, and
  // without this the flag stays false after the remount, so the fetched
  // documents are discarded and the consent checkboxes never appear.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // The effect never sets state synchronously in its body — `loading` starts
  // true and `reload` re-arms it from the click handler, so the only setState
  // calls here are in the async callbacks, where they belong.
  useEffect(() => {
    let cancelled = false;

    Promise.all([consentDocuments(ROLE_PATIENT), consentDocuments(ROLE_DOCTOR)])
      .then(([patientPayload, doctorPayload]) => {
        if (cancelled || !alive.current) return;
        setPatient(Array.isArray(patientPayload?.documents) ? patientPayload.documents : EMPTY);
        setDoctor(Array.isArray(doctorPayload?.documents) ? doctorPayload.documents : EMPTY);
        const policy = doctorPayload?.password_policy || patientPayload?.password_policy;
        if (policy && Number.isFinite(policy.min_length)) setPasswordPolicy(policy);
      })
      .catch((err) => {
        if (cancelled || !alive.current) return;
        setError(err?.message || 'Could not load the agreements. Please try again.');
      })
      .finally(() => {
        if (cancelled || !alive.current) return;
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [attempt]);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

  // Doctors-only = in the Doctor catalogue and not in the patient one. Derived,
  // never hardcoded, so the backend stays the single source of truth.
  const doctorOnlyDocuments = useMemo(() => {
    const patientTypes = new Set(patient.map((doc) => doc.type));
    return doctor.filter((doc) => !patientTypes.has(doc.type));
  }, [doctor, patient]);

  return {
    patientDocuments: patient,
    doctorDocuments: doctor,
    doctorOnlyDocuments,
    passwordPolicy,
    loading,
    error,
    reload,
  };
}

export default useConsentDocuments;
