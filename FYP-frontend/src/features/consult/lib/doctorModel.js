/**
 * doctorModel.js — one normalised shape for a row of `/api/doctors/public`,
 * plus the pure filter/sort the directory runs.
 *
 * WHY NORMALISE AT ALL
 * --------------------
 * The contract emits the SAME fact twice under two names: `specialty` /
 * `specialization`, and `rating` / `average_rating`. It also emits three
 * different kinds of "missing": `city` falls back to the literal string "N/A",
 * `hospital` / `phone` fall back to `null`, `schedule` is `null` (not `[]`) when
 * empty, and `fees.pkr` is `null` — which is NOT zero and must not render as
 * "Rs 0". Every component downstream would otherwise re-implement those three
 * rules slightly differently. They are implemented once, here.
 *
 * WHY `verification_status` IS SURFACED RATHER THAN FILTERED
 * ---------------------------------------------------------
 * `/api/doctors/public` hides `rejected` profiles but deliberately still lists
 * `pending` ones so the UI can badge them (routes.py:144-148). Silently dropping
 * pending doctors here would make a freshly-seeded database look empty and would
 * hide the only doctors a demo has; silently showing them as equals would imply
 * an approval nobody granted. So: they are listed, badged, ranked below approved
 * doctors, and there is a "Verified only" filter for anyone who wants the strict
 * list.
 */

import { coordsOf, distanceKm } from './geo';

/** Day names in the order `Date.getDay()` returns. */
const DAY_NAMES = Object.freeze([
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]);

/** `"N/A"` is the backend's literal fallback for an unset city — not a place. */
function cleanText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.toUpperCase() === 'N/A') return '';
  return text;
}

function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * @typedef {object} ConsultDoctor
 * @property {number} id
 * @property {string} name
 * @property {string} specialty
 * @property {string} hospital
 * @property {string} city
 * @property {number|null} rating       null = never rated (show "New", not 0)
 * @property {number} reviews
 * @property {number|null} feePkr       null = no fee row (not free)
 * @property {number|null} feeUsd
 * @property {string} duration
 * @property {number} experience
 * @property {[number, number]|null} coords
 * @property {Array<{day:string, start:string, end:string, available:boolean}>} schedule
 * @property {string} verification      'approved' | 'pending' | …
 * @property {boolean} isVerified
 * @property {string|null} photo        path or absolute URL, resolved by the card
 * @property {object} raw               the untouched row, kept for the request body
 */

/**
 * @param {any} row one element of `/api/doctors/public`
 * @returns {ConsultDoctor|null} null when the row has no usable id
 */
export function normalizeDoctor(row) {
  if (!row || typeof row !== 'object') return null;
  const id = finiteOrNull(row.id ?? row.doctor_id ?? row.user_id);
  if (id === null) return null;

  const schedule = Array.isArray(row.schedule)
    ? row.schedule
      .filter((entry) => entry && typeof entry === 'object')
      .map((entry) => ({
        day: cleanText(entry.day),
        start: cleanText(entry.start),
        end: cleanText(entry.end),
        // Only an explicit `false` means "off"; a missing key means the row
        // exists, and a row only exists for a day the doctor works.
        available: entry.available !== false,
      }))
      .filter((entry) => entry.day)
    : [];

  const fees = row.fees && typeof row.fees === 'object' ? row.fees : {};
  const verification = cleanText(row.verification_status).toLowerCase() || 'pending';

  return {
    id,
    name: cleanText(row.name) || 'Doctor',
    specialty: cleanText(row.specialty ?? row.specialization) || 'Skin Specialist',
    hospital: cleanText(row.hospital),
    city: cleanText(row.city),
    rating: finiteOrNull(row.average_rating ?? row.rating),
    reviews: finiteOrNull(row.total_reviews) ?? 0,
    feePkr: finiteOrNull(fees.pkr),
    feeUsd: finiteOrNull(fees.usd),
    duration: cleanText(fees.duration) || '30min',
    experience: finiteOrNull(row.experience) ?? 0,
    coords: coordsOf(row),
    schedule,
    verification,
    isVerified: verification === 'approved' || verification === 'verified',
    photo: row.photo_endpoint || row.profile_image || null,
    raw: row,
  };
}

/** Normalise a whole payload, dropping anything unusable. */
export function normalizeDoctors(payload) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
  return list.map(normalizeDoctor).filter(Boolean);
}

/**
 * The next day this doctor is marked available, looking a week ahead.
 * Derived from the `schedule` the directory already sends, so it costs no extra
 * request — it is a HINT ("Mon from 09:00"), not a promise that a slot is free.
 * The real slot list is fetched on the Times step.
 *
 * @param {ConsultDoctor} doctor
 * @param {Date} [now]
 * @returns {{label:string, start:string}|null}
 */
export function nextAvailability(doctor, now = new Date()) {
  if (!doctor?.schedule?.length) return null;
  const open = doctor.schedule.filter((entry) => entry.available);
  if (!open.length) return null;

  for (let offset = 0; offset < 7; offset += 1) {
    const dayName = DAY_NAMES[(now.getDay() + offset) % 7];
    const match = open.find((entry) => entry.day.toLowerCase() === dayName.toLowerCase());
    if (!match) continue;
    const label = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : dayName.slice(0, 3);
    return { label, start: match.start };
  }
  return null;
}

/** The default, everything-off filter state. */
export function emptyFilters() {
  return {
    q: '',
    city: '',
    specialty: '',
    minRating: 0,
    maxFee: '',
    radiusKm: '',
    availableOnly: false,
    verifiedOnly: false,
  };
}

/** How many filters are actually narrowing the list (drives the mobile badge). */
export function activeFilterCount(filters) {
  const base = emptyFilters();
  return Object.keys(base).reduce((total, key) => {
    const value = filters?.[key];
    const isDefault = value === base[key] || value === '' || value === false || value === 0;
    return total + (isDefault ? 0 : 1);
  }, 0);
}

/** Sorted, de-duplicated values of one field, for the two dropdowns. */
export function uniqueValues(doctors, field) {
  const seen = new Set();
  (doctors || []).forEach((doctor) => {
    const value = doctor?.[field];
    if (value) seen.add(value);
  });
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/**
 * Attach `distance` (km or null) to every doctor, relative to the patient.
 * Returns a NEW array; the input is never mutated.
 */
export function withDistances(doctors, origin) {
  if (!origin) return (doctors || []).map((doctor) => ({ ...doctor, distance: null }));
  return (doctors || []).map((doctor) => ({
    ...doctor,
    distance: distanceKm(origin, doctor.coords),
  }));
}

/**
 * Apply the filter panel. Pure — the same inputs always give the same list, so
 * the map and the list can never show different sets.
 *
 * A doctor with NO coordinates survives a radius filter, because "we do not know
 * where this clinic is" is not the same as "this clinic is far away", and
 * dropping them would quietly shrink the directory to whoever happened to pin a
 * map during signup.
 *
 * @param {Array<ConsultDoctor & {distance?:number|null}>} doctors
 * @param {ReturnType<emptyFilters>} filters
 */
export function filterDoctors(doctors, filters) {
  const query = String(filters?.q || '').trim().toLowerCase();
  const maxFee = finiteOrNull(filters?.maxFee);
  const radius = finiteOrNull(filters?.radiusKm);
  const minRating = finiteOrNull(filters?.minRating) ?? 0;

  return (doctors || []).filter((doctor) => {
    if (query) {
      const haystack = `${doctor.name} ${doctor.specialty} ${doctor.hospital} ${doctor.city}`
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    if (filters?.city && doctor.city !== filters.city) return false;
    if (filters?.specialty && doctor.specialty !== filters.specialty) return false;
    // An unrated doctor is filtered OUT by a minimum rating, because "no rating"
    // cannot be claimed to be 4 stars or better.
    if (minRating > 0 && (doctor.rating === null || doctor.rating < minRating)) return false;
    // A doctor with no fee row is NOT free — but they are also not "over budget",
    // so a max-fee filter keeps them and the card says the fee is unlisted.
    if (maxFee !== null && doctor.feePkr !== null && doctor.feePkr > maxFee) return false;
    if (radius !== null && doctor.distance !== null && doctor.distance !== undefined
      && doctor.distance > radius) return false;
    if (filters?.availableOnly && !doctor.schedule.some((entry) => entry.available)) return false;
    if (filters?.verifiedOnly && !doctor.isVerified) return false;
    return true;
  });
}

/**
 * Rank the filtered list. Verified doctors always come first — that is a safety
 * ordering, not a preference — and the chosen key breaks the tie inside each
 * group.
 * @param {'distance'|'rating'|'fee'|'name'} sortBy
 */
export function sortDoctors(doctors, sortBy) {
  const list = [...(doctors || [])];
  const byKey = {
    distance: (a, b) => {
      // Unlocated clinics sink, rather than sorting as distance 0.
      const left = a.distance ?? Number.POSITIVE_INFINITY;
      const right = b.distance ?? Number.POSITIVE_INFINITY;
      return left - right;
    },
    rating: (a, b) => (b.rating ?? -1) - (a.rating ?? -1) || b.reviews - a.reviews,
    fee: (a, b) => (a.feePkr ?? Number.POSITIVE_INFINITY) - (b.feePkr ?? Number.POSITIVE_INFINITY),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  const compare = byKey[sortBy] || byKey.rating;

  return list.sort((a, b) => {
    if (a.isVerified !== b.isVerified) return a.isVerified ? -1 : 1;
    return compare(a, b) || a.name.localeCompare(b.name);
  });
}

export default {
  normalizeDoctor,
  normalizeDoctors,
  nextAvailability,
  emptyFilters,
  activeFilterCount,
  uniqueValues,
  withDistances,
  filterDoctors,
  sortDoctors,
};
