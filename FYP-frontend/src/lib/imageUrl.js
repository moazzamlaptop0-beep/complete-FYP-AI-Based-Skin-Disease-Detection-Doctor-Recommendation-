/**
 * imageUrl.js — resolve the THREE inconsistent image shapes the backend emits.
 *
 * The contract (docs/api-contract.md) freezes all three, so the client absorbs
 * the difference:
 *
 *   1. NO leading slash — `"static/uploads/scan_ab12_x.jpg"`
 *      Emitted by POST /predict and by `scan_info.image_url` inside
 *      /api/patient-appointments/<id>.
 *   2. WITH a leading slash — `"/static/uploads/scan_ab12_x.jpg"`
 *      Emitted by /patient/scans/<id>, /doctor/scans/<id>, both SSE streams and
 *      /api/doctors/public (`profile_image`).
 *   3. A privacy-gated endpoint — `image_endpoint`
 *      The ai_scans image-privacy columns exist in the schema now
 *      (image_deleted_at, image_purged_at, image_access_log). When the backend
 *      starts returning an `image_endpoint`, it must win over `image_url`,
 *      because that route is the one that logs the access and serves a thumbnail
 *      until the patient consents to the full image.
 *
 * Concatenating the base URL by hand (DoctorDashboard.jsx:1413 does
 * `` `${API_BASE_URL}${scan.image_url}` ``) works for shape 2 and produces
 * `http://localhost:5000static/uploads/...` for shape 1. Use this module.
 */

import { API_BASE_URL } from './api';

const ABSOLUTE_OR_DATA = /^(?:https?:)?\/\/|^data:|^blob:/i;

/** Field names that can carry an image, in priority order. */
const IMAGE_FIELDS = [
  'image_endpoint',   // shape 3 — privacy-gated, always wins
  'thumbnail_endpoint',
  'image_url',        // shapes 1 and 2
  'profile_image',    // doctor profiles
  'image_path',       // the SQLAlchemy synonym, in case it leaks into a payload
  'url',
  // GET /api/profile's account avatar. `avatar_url` is deliberately checked
  // BEFORE `avatar_endpoint`: the static path is world-readable, so it works in a
  // plain <img src>, whereas the endpoint twin may require an Authorization
  // header that an <img> tag cannot send. Last in the list because a scan row
  // carrying both its own image and an avatar must still resolve to the scan.
  'avatar_url',
  'avatar_endpoint',
];

/**
 * Join a relative API path onto the base URL, tolerating a missing or doubled
 * slash on either side.
 */
function join(base, path) {
  const left = String(base || '').replace(/\/+$/, '');
  const right = String(path || '').replace(/^\/+/, '');
  if (!right) return null;
  return `${left}/${right}`;
}

/**
 * Resolve any of the three shapes to a fully-qualified, loadable URL.
 *
 * @param {string|object|null|undefined} source A raw string, or an object
 *   (scan / doctor / appointment) from which the image field is picked.
 * @param {object} [options]
 * @param {string} [options.base] Override the API base URL (tests, CDN).
 * @param {'thumb'|'full'} [options.variant] Only applied to shape 3 — the
 *   static route ignores query params, and appending one there would defeat the
 *   browser cache for no benefit.
 * @param {string|null} [options.fallback=null] Returned when there is no image.
 * @returns {string|null}
 */
export function resolveImageUrl(source, options = {}) {
  const { base = API_BASE_URL, variant, fallback = null } = options;

  let value = null;
  let isEndpoint = false;

  if (typeof source === 'string') {
    value = source.trim();
  } else if (source && typeof source === 'object') {
    for (const field of IMAGE_FIELDS) {
      const candidate = source[field];
      if (typeof candidate === 'string' && candidate.trim()) {
        value = candidate.trim();
        isEndpoint = field === 'image_endpoint' || field === 'thumbnail_endpoint';
        break;
      }
    }
  }

  if (!value) return fallback;

  // Shape 3 can also be recognised from a bare string path.
  if (!isEndpoint && /^\/?api\//i.test(value)) isEndpoint = true;

  // Already absolute (a CDN, a data: preview, an object URL from a file picker).
  if (ABSOLUTE_OR_DATA.test(value)) return value;

  const url = join(base, value);
  if (!url) return fallback;

  if (isEndpoint && variant) {
    return `${url}${url.includes('?') ? '&' : '?'}variant=${encodeURIComponent(variant)}`;
  }
  return url;
}

/**
 * The image for a scan row from ANY of the listing endpoints, the SSE streams,
 * `/predict`, or the nested `scan_info` of a patient appointment.
 * Returns null when the image was deleted or purged under the privacy rules,
 * so callers can render a "removed at the patient's request" placeholder rather
 * than a broken <img>.
 */
export function scanImageUrl(scan, options = {}) {
  if (!scan || typeof scan !== 'object') return options.fallback ?? null;
  if (scan.image_deleted_at || scan.image_purged_at) return options.fallback ?? null;
  return resolveImageUrl(scan, options);
}

/** The doctor's avatar from `/api/doctors/public` or `/api/doctor/profile`. */
export function doctorImageUrl(doctor, options = {}) {
  if (!doctor || typeof doctor !== 'object') return options.fallback ?? null;
  return resolveImageUrl(doctor.profile_image ?? doctor, options);
}

/** True when there is something renderable, without building the URL. */
export function hasImage(source) {
  return resolveImageUrl(source) !== null;
}

/**
 * True when the resolved image goes through the privacy-gated endpoint (and is
 * therefore access-logged and may need an Authorization header via fetch+blob
 * rather than a plain <img src>).
 */
export function isGatedImage(source) {
  if (typeof source === 'string') return /^\/?api\//i.test(source.trim());
  if (!source || typeof source !== 'object') return false;
  return Boolean(source.image_endpoint || source.thumbnail_endpoint);
}

export default {
  doctorImageUrl,
  hasImage,
  isGatedImage,
  resolveImageUrl,
  scanImageUrl,
};
