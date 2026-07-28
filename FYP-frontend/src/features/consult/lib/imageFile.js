/**
 * imageFile — pure helpers for the photo the patient picks.
 *
 * THE IMPLEMENTATION MOVED, THIS PATH DID NOT
 * -------------------------------------------
 * The three helpers are framework-free and the account page needs the identical
 * check for a profile photo, so they now live in `src/lib/imageFile.js`. This
 * module stays exactly where StepCapture, ExtraPhotoStrip and attachments.js
 * already import it from, and binds the shared validator to the CONSULT limits
 * so `LIMITS` in consultReducer remains the single source of truth for what
 * `POST /predict` accepts. Behaviour is unchanged.
 */

import { LIMITS } from '../consultReducer';
import { prettyBytes, validateImageFile as validateAgainst } from '../../../lib/imageFile';

/** The `accept` attribute for the file input, straight from the mirrored list. */
export const ACCEPT_ATTRIBUTE = LIMITS.ACCEPTED_TYPES.join(',');

/**
 * Validate a pick against the same rules `POST /predict` enforces.
 * @param {File|null} file
 * @returns {string|null} the message to show, or null when the file is fine
 */
export const validateImageFile = (file) => validateAgainst(file, LIMITS);

export { prettyBytes };

export default validateImageFile;
