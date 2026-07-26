/**
 * attachments.js — the extra context photos the Details step collects.
 *
 * WHY AN ATTACHMENT CARRIES A data: THUMBNAIL AND NEVER A blob: URL
 * -----------------------------------------------------------------
 * `URL.createObjectURL` pins the whole decoded bitmap in memory until somebody
 * revokes it, and "somebody" has to be a component that knows when the value
 * stopped being rendered. ConsultContext already does that bookkeeping for the
 * two URLs of the MAIN photo (see its `liveUrls` diff), and every extra
 * attachment would need the same treatment — including the case where the
 * reducer drops one from the middle of the array.
 *
 * A ~320px JPEG data URL is 10-20 KB, renders identically at the 96px the strip
 * shows it at, needs no revoke, and is the exact bytes the sessionStorage draft
 * wants anyway. So the attachment holds the File (for the upload) and a data
 * URL (for the eye), and no object URL exists to leak.
 *
 * WHAT IS AND IS NOT PERSISTED
 * ----------------------------
 * A `File` does not survive `JSON.stringify` — it serialises to `{}`, which is
 * exactly the sort of thing that later gets handed to `FormData.append` and
 * uploads the four bytes `[obj`. `toPersisted()` therefore drops it explicitly
 * and `fromPersisted()` marks the result `restored`, so the strip can say "this
 * one needs picking again" instead of silently offering a photo it cannot send.
 */

import imageCompression from 'browser-image-compression';

import { LIMITS } from '../consultReducer';
import { makeThumbnailDataUrl } from './cropImage';
import { prettyBytes, validateImageFile } from './imageFile';

/**
 * Extra photos are context, not the thing being classified — nothing runs a CNN
 * over them — so they can be compressed harder than the main capture.
 */
const COMPRESSION_OPTIONS = Object.freeze({
  maxSizeMB: 0.8,
  maxWidthOrHeight: 1400,
  useWebWorker: true,
  initialQuality: 0.82,
  fileType: 'image/jpeg',
});

/** Short, collision-free enough for a list that is capped at three. */
function localId() {
  return `att_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Validate, compress and thumbnail one pick.
 *
 * Compression is best-effort in exactly the way StepCapture treats it: a worker
 * that fails, or a "compressed" result that came back BIGGER than the original
 * (which the library does on small images), leaves the original in place. The
 * photo is already under the same 10MB ceiling the backend enforces, so a failed
 * optimisation must never cost the user the file.
 *
 * @param {File} file
 * @returns {Promise<{ok:true, attachment:object}|{ok:false, error:string}>}
 */
export async function makeAttachment(file) {
  const invalid = validateImageFile(file);
  if (invalid) return { ok: false, error: invalid };

  let finalFile = file;
  try {
    const compressed = await imageCompression(file, COMPRESSION_OPTIONS);
    if (compressed && compressed.size > 0 && compressed.size < file.size) {
      finalFile = new File([compressed], file.name || 'photo.jpg', {
        type: compressed.type || 'image/jpeg',
        lastModified: Date.now(),
      });
    }
  } catch {
    /* keep the original */
  }

  // null on any failure — a missing thumbnail costs a grey tile, not the photo.
  const thumbUrl = await makeThumbnailDataUrl(finalFile, 320);

  return {
    ok: true,
    attachment: {
      id: localId(),
      file: finalFile,
      name: finalFile.name || 'photo.jpg',
      size: finalFile.size || 0,
      type: finalFile.type || 'image/jpeg',
      thumbUrl,
      restored: false,
    },
  };
}

/** The serialisable projection. The File is dropped, deliberately and loudly. */
export function toPersisted(attachment) {
  if (!attachment || typeof attachment !== 'object') return null;
  return {
    id: String(attachment.id || localId()),
    name: String(attachment.name || ''),
    size: Number(attachment.size) || 0,
    type: String(attachment.type || ''),
    thumbUrl: typeof attachment.thumbUrl === 'string' ? attachment.thumbUrl : null,
  };
}

/** Rebuild a draft attachment. `file` is null and `restored` says why. */
export function fromPersisted(entry) {
  if (!entry || typeof entry !== 'object') return null;
  return {
    id: String(entry.id || localId()),
    file: null,
    name: String(entry.name || ''),
    size: Number(entry.size) || 0,
    type: String(entry.type || ''),
    thumbUrl: typeof entry.thumbUrl === 'string' ? entry.thumbUrl : null,
    restored: true,
  };
}

/** How many more the user may add. */
export function remainingSlots(attachments) {
  const used = Array.isArray(attachments) ? attachments.length : 0;
  return Math.max(0, LIMITS.MAX_ATTACHMENTS - used);
}

/** The ones that can actually be uploaded (a restored draft entry cannot). */
export function uploadableAttachments(attachments) {
  return (Array.isArray(attachments) ? attachments : []).filter((entry) => entry?.file);
}

/** "photo.jpg · 240 KB", or just the name when the size is unknown. */
export function attachmentLabel(attachment) {
  const size = prettyBytes(attachment?.size);
  return size ? `${attachment.name} · ${size}` : String(attachment?.name || 'Photo');
}

export default makeAttachment;
