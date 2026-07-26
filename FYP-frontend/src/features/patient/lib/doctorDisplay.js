/**
 * doctorDisplay.js — the two rules for reading a `/api/doctors/public` row.
 *
 * They live away from the components that use them because THREE files need the
 * same two decisions and disagreeing about either produces a visible bug: a
 * doctor whose avatar 404s, or a city filter with an "N/A" option in it.
 */

import { resolveImageUrl } from '../../../lib/imageUrl';

/**
 * The doctor's headshot, fully qualified.
 *
 * `photo_endpoint` (`/api/doctors/<id>/photo`) is preferred over the legacy
 * `profile_image` (`/static/uploads/…`): the static folder also holds every
 * patient's scan photograph and is being closed, while the endpoint is a stable
 * address that survives that. Both are relative to the API origin, never the
 * app's — rendering either raw asks the dev server for it and gets HTML back.
 *
 * @param {object} doctor
 * @returns {string|undefined} undefined (not null) so it can go straight into
 *   `<Avatar src>`, which falls back to initials only for undefined/empty.
 */
export function doctorPhotoUrl(doctor) {
  return resolveImageUrl(doctor?.photo_endpoint || doctor?.profile_image) || undefined;
}

/**
 * `''` and the literal `'N/A'` both mean "we do not know".
 *
 * The backend deliberately returns honest nulls for `hospital` and `phone` — the
 * old code invented "General Hospital" and an "N/A" phone number a patient could
 * try to ring — but `city` still falls back to the string "N/A", so it has to be
 * filtered out here rather than printed as if it were a place.
 *
 * @param {any} value
 * @returns {any|null}
 */
export function realValue(value) {
  const text = typeof value === 'string' ? value.trim() : value;
  if (!text || text === 'N/A') return null;
  return text;
}

export default { doctorPhotoUrl, realValue };
