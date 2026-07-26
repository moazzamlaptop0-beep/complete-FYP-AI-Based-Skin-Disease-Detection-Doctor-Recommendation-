/**
 * imageFile — pure helpers for the photo the patient picks.
 *
 * These live outside StepCapture.jsx deliberately. They are the only part of the
 * capture step worth unit testing on their own (the rest is a camera, a canvas
 * and a dropzone), and keeping them in a component file both breaks Fast Refresh
 * and drags react-webcam into any test that wants to check a size limit.
 *
 * THE LIMITS ARE MIRRORED, NOT INVENTED
 * -------------------------------------
 * `LIMITS.MAX_IMAGE_BYTES` and `LIMITS.ACCEPTED_TYPES` in consultReducer mirror
 * what `POST /predict` enforces server-side. Checking here is a courtesy — it
 * turns a 12MB upload followed by a 400 into an instant, readable sentence — and
 * never a substitute for the backend's own check.
 */

import { LIMITS } from '../consultReducer';

/** The `accept` attribute for the file input, straight from the mirrored list. */
export const ACCEPT_ATTRIBUTE = LIMITS.ACCEPTED_TYPES.join(',');

/**
 * Human file size. Deliberately tiny: pulling in a formatter for three call
 * sites would cost more than it saves.
 * @param {number} bytes
 * @returns {string} '' for 0/undefined, else e.g. '512 KB' or '1.8 MB'
 */
export function prettyBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Validate a pick against the SAME rules the backend enforces.
 *
 * The extension is accepted on its own because several Android pickers hand over
 * a File with an EMPTY `type`. Rejecting those would make the flow unusable on
 * exactly the devices most likely to be taking the photo — so only a file that
 * fails BOTH checks is refused.
 *
 * @param {File|null} file
 * @returns {string|null} the message to show, or null when the file is fine
 */
export function validateImageFile(file) {
  if (!file) return 'No file selected.';

  const type = String(file.type || '').toLowerCase();
  const extension = String(file.name || '').split('.').pop()?.toLowerCase() || '';
  const typeOk = LIMITS.ACCEPTED_TYPES.includes(type);
  const extensionOk = LIMITS.ACCEPTED_EXTENSIONS.includes(extension);

  if (!typeOk && !extensionOk) {
    return `That is a ${type || extension || 'unknown'} file. Use a PNG, JPG or WebP image.`;
  }
  if (file.size > LIMITS.MAX_IMAGE_BYTES) {
    return `That photo is ${prettyBytes(file.size)}. The limit is ${prettyBytes(LIMITS.MAX_IMAGE_BYTES)}.`;
  }
  if (file.size === 0) return 'That file is empty.';
  return null;
}

export default validateImageFile;
