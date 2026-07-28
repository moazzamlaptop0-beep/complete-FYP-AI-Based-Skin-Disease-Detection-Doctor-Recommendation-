/**
 * imageFile.js — framework-free checks for a file the user just picked.
 *
 * WHY IT LIVES IN `lib/` NOW
 * --------------------------
 * These three helpers were written for the consult capture step
 * (`features/consult/lib/imageFile.js`) and are pure: no React, no fetch, no
 * feature state. The account page needs the identical courtesy check for a
 * profile photo, and a second surface importing across feature boundaries into
 * `features/consult` would make the consult flow a dependency of every page that
 * uploads anything. So the implementation moved here and the old path re-exports
 * it, which is why nothing in `features/consult` had to change.
 *
 * THE LIMITS ARE MIRRORED, NOT INVENTED
 * -------------------------------------
 * Each caller passes the limits its endpoint actually enforces:
 *   - the consult capture step passes `LIMITS` from consultReducer, which
 *     mirrors `POST /predict` (10 MB);
 *   - the account page passes `AVATAR_LIMITS`, which mirrors
 *     `POST /api/profile/avatar` (5 MB).
 * Checking here turns a slow upload followed by a 413 whose body is raw Flask
 * HTML into an instant readable sentence. It is never a substitute for the
 * server's own check.
 */

/**
 * The default set: what `POST /predict` accepts. Kept byte-identical to
 * `features/consult/consultReducer.LIMITS` for the fields it shares, so a caller
 * that forgets to pass its own limits still gets the historical behaviour.
 */
export const IMAGE_LIMITS = Object.freeze({
  MAX_IMAGE_BYTES: 10 * 1024 * 1024,
  ACCEPTED_TYPES: Object.freeze(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']),
  ACCEPTED_EXTENSIONS: Object.freeze(['png', 'jpg', 'jpeg', 'webp']),
});

/**
 * `POST /api/profile/avatar` rejects anything over 5 MB. Same formats: the
 * backend validates the extension against {png, jpg, jpeg, webp} and then
 * downscales to a 512px square, so a 4 MB portrait is fine and a 20 MB one is a
 * waste of the user's data allowance.
 */
export const AVATAR_LIMITS = Object.freeze({
  ...IMAGE_LIMITS,
  MAX_IMAGE_BYTES: 5 * 1024 * 1024,
});

/** The `accept` attribute for a file input, straight from the mirrored list. */
export const ACCEPT_ATTRIBUTE = IMAGE_LIMITS.ACCEPTED_TYPES.join(',');

/**
 * Human file size. Deliberately tiny: pulling in a formatter for a handful of
 * call sites would cost more than it saves.
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
 * Validate a pick against the SAME rules the target endpoint enforces.
 *
 * The extension is accepted on its own because several Android pickers hand over
 * a File with an EMPTY `type`. Rejecting those would make the flow unusable on
 * exactly the devices most likely to be taking the photo — so only a file that
 * fails BOTH checks is refused.
 *
 * @param {File|null} file
 * @param {{MAX_IMAGE_BYTES:number, ACCEPTED_TYPES:string[], ACCEPTED_EXTENSIONS:string[]}} [limits]
 * @returns {string|null} the message to show, or null when the file is fine
 */
export function validateImageFile(file, limits = IMAGE_LIMITS) {
  if (!file) return 'No file selected.';

  const rules = limits || IMAGE_LIMITS;
  const type = String(file.type || '').toLowerCase();
  const extension = String(file.name || '').split('.').pop()?.toLowerCase() || '';
  const typeOk = rules.ACCEPTED_TYPES.includes(type);
  const extensionOk = rules.ACCEPTED_EXTENSIONS.includes(extension);

  if (!typeOk && !extensionOk) {
    return `That is a ${type || extension || 'unknown'} file. Use a PNG, JPG or WebP image.`;
  }
  if (file.size > rules.MAX_IMAGE_BYTES) {
    return `That photo is ${prettyBytes(file.size)}. The limit is ${prettyBytes(rules.MAX_IMAGE_BYTES)}.`;
  }
  if (file.size === 0) return 'That file is empty.';
  return null;
}

export default validateImageFile;
