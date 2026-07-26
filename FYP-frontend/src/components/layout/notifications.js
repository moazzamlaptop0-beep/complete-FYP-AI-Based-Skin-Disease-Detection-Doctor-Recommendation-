/**
 * Notification derivation — a PURE module, deliberately not in the .jsx.
 *
 * WHY IT LIVES HERE
 * -----------------
 * Vite's Fast Refresh can only hot-swap a module whose exports are ALL React
 * components. `NotificationBell.jsx` exported this helper alongside the
 * component, so every edit to that file logged
 *
 *   hmr invalidate ... Could not Fast Refresh ("deriveNotifications" export is
 *   incompatible)
 *
 * and fell back to a full page reload, throwing away whatever state you were
 * mid-way through — a half-filled form, an open dialog, a cropped photo.
 * Splitting the pure function out lets the component stay hot-swappable.
 */

import { PATHS } from '../../routes';

const MAX_ITEMS = 8;

/**
 * Turn a stream payload into a notification list. Total: an unexpected shape
 * yields an empty list, never a crash inside the header.
 *
 * @param {object|null} data  the SSE payload (doctor or patient shape)
 * @param {'doctor'|'patient'} [kind]
 * @returns {Array<{id:string,title:string,detail:string,severity?:string,at:?string,to:string}>}
 */
export function deriveNotifications(data, kind) {
  if (!data || typeof data !== 'object') return [];
  const scans = Array.isArray(data.scans) ? data.scans : [];
  const items = [];

  if (kind === 'doctor') {
    scans
      .filter((scan) => {
        const status = String(scan?.review_status ?? scan?.status ?? '').toLowerCase();
        return status === 'pending' || status === 'sent' || status === '';
      })
      .slice(0, MAX_ITEMS)
      .forEach((scan) => {
        items.push({
          id: `scan-${scan.id}`,
          title: `${scan.patient_name || 'A patient'} sent a scan`,
          detail: scan.disease ? `AI suggests ${scan.disease}` : 'Awaiting your review',
          severity: scan.severity,
          at: scan.created_at || scan.date || null,
          // Canonical paths. The old '/doctor-dashboard/referrals' still
          // resolves through the permanent alias, but sending users through a
          // redirect from our own header is needless.
          to: PATHS.DOCTOR_REFERRALS,
        });
      });
  } else {
    scans
      .filter((scan) => scan?.doctor_comment || scan?.invite_to_clinic)
      .slice(0, MAX_ITEMS)
      .forEach((scan) => {
        items.push({
          id: `scan-${scan.id}`,
          title: scan.invite_to_clinic
            ? `${scan.doctor_name || 'Your doctor'} invited you to the clinic`
            : `${scan.doctor_name || 'Your doctor'} reviewed your scan`,
          detail: scan.doctor_comment || scan.disease || '',
          severity: scan.severity,
          at: scan.reviewed_at || scan.created_at || scan.date || null,
          to: PATHS.PATIENT_SCANS,
        });
      });
  }

  return items;
}

export default deriveNotifications;
