/**
 * The two lists the whole doctor surface is built on, fetched once per page.
 *
 * WHY THEY LIVE TOGETHER
 * ----------------------
 * `/doctor/scans/<id>` is the referral queue, the patient roster AND the case
 * history on a patient's detail page — the backend has no "list my patients"
 * route, so the roster is derived by grouping scans on `patient_id`. Putting
 * that derivation in one place means the three screens can never disagree about
 * who a doctor's patients are.
 *
 * Both hooks take the doctor id from the session, because both routes 403 on
 * `jwt.user_id != doctor_id` — passing an id in from a component would just be
 * a way to get that wrong.
 */

import { useCallback, useMemo } from 'react';

import { get } from '../../../lib/api';
import { appointments as appointmentEndpoints, scans as scanEndpoints } from '../../../lib/endpoints';
import { useAuth } from '../../../context/AuthContext';
import { useRealtimeSubscription } from '../../../context/RealtimeContext';
import useDoctorQuery from './useDoctorQuery';

/** CRITICAL first — a doctor's queue must not be ordered by upload time. */
export const SEVERITY_RANK = { CRITICAL: 0, URGENT: 1, ROUTINE: 2 };

export function severityRank(value) {
  const key = String(value || 'ROUTINE').toUpperCase();
  return SEVERITY_RANK[key] ?? 3;
}

/** `severity_level` on some payloads, `severity` on others. One reader. */
export function scanSeverity(scan) {
  return String(scan?.severity || scan?.severity_level || 'ROUTINE').toUpperCase();
}

/**
 * True while a scan still needs a doctor's comment.
 *
 * `/doctor/update_scan` writes BOTH `status` and `review_status` to 'Reviewed',
 * but older rows only carry one of them and a brand-new scan carries neither
 * (the model default is 'Pending'). Reading both, with 'Pending' as the floor,
 * is what stops a reviewed case reappearing in the queue after a redeploy.
 */
export function isPending(scan) {
  const review = String(scan?.review_status || scan?.status || 'Pending').toLowerCase();
  return review !== 'reviewed' && review !== 'completed';
}

/**
 * The clinical order for a queue: severity band first, then longest-waiting
 * inside the band.
 *
 * The backend orders `/doctor/scans/<id>` by `id DESC` (newest first) unless you
 * ask for `sort=asc`. Neither is safe: a CRITICAL case from this morning must not
 * sit below three ROUTINE ones from lunchtime, and a queue that puts the newest
 * arrival on top is a queue that never reaches the bottom.
 */
export function sortByClinicalPriority(scans) {
  return [...(scans || [])].sort((a, b) => {
    const bySeverity = severityRank(scanSeverity(a)) - severityRank(scanSeverity(b));
    if (bySeverity !== 0) return bySeverity;
    return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
  });
}

/**
 * `questionnaire_answers` is already a parsed object on /doctor/scans, but a
 * JSON string elsewhere (and `null` when the patient skipped the questions —
 * which is NOT the same as answering no to all six).
 * @returns {object|null}
 */
export function parseAnswers(value) {
  if (!value) return null;
  if (typeof value === 'object') return Array.isArray(value) ? null : value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Every scan referred to this doctor. */
export function useDoctorScans() {
  const { user } = useAuth();
  const doctorId = user?.id;

  const fetcher = useCallback(
    (signal) => get(scanEndpoints.forDoctor(doctorId), { signal }),
    [doctorId],
  );
  const query = useDoctorQuery(fetcher, { enabled: Boolean(doctorId) });
  const { refresh } = query;

  // The stream sends `{scans, appointments, pending_count, ...}` and NOTHING
  // else — no `type`, no `event`, no named SSE event (see RealtimeContext's wire
  // format note and app/api/streams/routes.py). Filtering on `payload.type`
  // matched the empty string against a regex, so refresh() was never called and
  // the queue silently never live-updated. Key off the array the stream really
  // ships instead; a payload only arrives when it CHANGED.
  useRealtimeSubscription(useCallback((payload) => {
    if (Array.isArray(payload?.scans)) refresh();
  }, [refresh]));

  const scans = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data]);
  return { ...query, doctorId, scans };
}

/** Every appointment on this doctor's calendar. */
export function useDoctorAppointments() {
  const { user } = useAuth();
  const doctorId = user?.id;

  const fetcher = useCallback(
    (signal) => get(appointmentEndpoints.doctorAppointments(doctorId), { signal }),
    [doctorId],
  );
  const query = useDoctorQuery(fetcher, { enabled: Boolean(doctorId) });
  const { refresh } = query;

  // See useDoctorScans: the payload carries no `type` field to filter on.
  useRealtimeSubscription(useCallback((payload) => {
    if (Array.isArray(payload?.appointments)) refresh();
  }, [refresh]));

  const items = useMemo(() => (Array.isArray(query.data) ? query.data : []), [query.data]);
  return { ...query, doctorId, appointments: items };
}

/**
 * Group a scan list into one row per patient.
 *
 * Scans with a null `patient_id` (an anonymous /predict upload that was later
 * referred) are dropped rather than collapsed into a single "Unknown" patient —
 * merging two strangers into one record would be worse than omitting them.
 *
 * @param {Array<object>} scans
 * @returns {Array<{patientId:number, name:string, email:string|null, scans:Array<object>,
 *   scanCount:number, lastScanAt:string|null, worstSeverity:string, pendingCount:number}>}
 */
export function groupScansByPatient(scans) {
  const byPatient = new Map();

  (scans || []).forEach((scan) => {
    const id = scan?.patient_id;
    if (id === null || id === undefined || id === '') return;
    const key = String(id);
    if (!byPatient.has(key)) {
      byPatient.set(key, {
        patientId: id,
        name: scan.patient_name || 'Unknown',
        email: scan.patient_email || null,
        scans: [],
      });
    }
    const entry = byPatient.get(key);
    entry.scans.push(scan);
    if (!entry.email && scan.patient_email) entry.email = scan.patient_email;
    if (entry.name === 'Unknown' && scan.patient_name) entry.name = scan.patient_name;
  });

  return [...byPatient.values()].map((entry) => {
    const sorted = [...entry.scans].sort(
      (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0),
    );
    const worst = sorted.reduce(
      (acc, scan) => (severityRank(scanSeverity(scan)) < severityRank(acc) ? scanSeverity(scan) : acc),
      'ROUTINE',
    );
    return {
      ...entry,
      scans: sorted,
      scanCount: sorted.length,
      lastScanAt: sorted[0]?.created_at || null,
      worstSeverity: worst,
      pendingCount: sorted.filter(
        (scan) => String(scan.review_status || 'Pending').toLowerCase() === 'pending',
      ).length,
    };
  });
}
