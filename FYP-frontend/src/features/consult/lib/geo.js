/**
 * geo.js — distance maths for the doctor directory. Pure, no React, no network.
 *
 * WHY THIS IS ITS OWN MODULE
 * --------------------------
 * The old /nearby-doctors page called itself "nearby" and then sorted the list
 * by whatever order the API returned it in — there was no distance anywhere. The
 * directory now really does rank by distance when the browser gives us a
 * position, so the maths has to live somewhere testable and somewhere that the
 * map component and the list component can share, or the two would disagree
 * about which doctor is closest.
 *
 * `/api/doctors/public` sends `latitude` / `longitude` as NULL for any doctor
 * who never pinned their clinic, so every function here is written to return
 * `null` rather than `NaN` or `0` for a missing coordinate. `0` would sort an
 * unlocated doctor to the TOP of a distance sort, which is exactly the kind of
 * confidently-wrong ranking a patient would act on.
 */

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees) => (degrees * Math.PI) / 180;

/**
 * A `[lat, lng]` pair from anything coordinate-shaped, or null.
 * @param {{latitude?:any, longitude?:any, lat?:any, lng?:any}|null} source
 * @returns {[number, number]|null}
 */
export function coordsOf(source) {
  if (!source || typeof source !== 'object') return null;
  const lat = Number(source.latitude ?? source.lat);
  const lng = Number(source.longitude ?? source.lng ?? source.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  // (0, 0) is in the Atlantic. It is never a clinic; it is a default that leaked
  // out of a form, and treating it as real would put "Null Island" at the top of
  // every distance sort.
  if (lat === 0 && lng === 0) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return [lat, lng];
}

/**
 * Great-circle distance in kilometres, or null when either point is unknown.
 * @param {[number, number]|null} from
 * @param {[number, number]|null} to
 * @returns {number|null}
 */
export function distanceKm(from, to) {
  if (!from || !to) return null;
  const [lat1, lon1] = from;
  const [lat2, lon2] = to;

  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * "1.2 km" / "8 km" / "" — deliberately coarse. Straight-line distance is not
 * road distance, so pretending to three decimal places would be a lie.
 * @param {number|null|undefined} km
 * @returns {string}
 */
export function formatDistance(km) {
  if (km === null || km === undefined || !Number.isFinite(km)) return '';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/** The mid-point of a set of coordinates, for centring a map. */
export function centroid(points) {
  const valid = (points || []).filter(Boolean);
  if (!valid.length) return null;
  const total = valid.reduce(
    (accumulator, [lat, lng]) => [accumulator[0] + lat, accumulator[1] + lng],
    [0, 0],
  );
  return [total[0] / valid.length, total[1] / valid.length];
}

/** Islamabad — the sane default centre for a Pakistan-first product. */
export const FALLBACK_CENTER = Object.freeze([33.6844, 73.0479]);

export default { coordsOf, distanceKm, formatDistance, centroid, FALLBACK_CENTER };
