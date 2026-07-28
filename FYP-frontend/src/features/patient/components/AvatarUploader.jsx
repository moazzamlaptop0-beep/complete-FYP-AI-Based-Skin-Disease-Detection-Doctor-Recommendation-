/**
 * AvatarUploader — the account photo, for every role.
 *
 * WHAT CHANGED, AND WHY THE OLD COPY HAD TO GO
 * --------------------------------------------
 * This screen used to say, in as many words, that no endpoint on the platform
 * stored a patient profile picture, and showed initials instead. That was true
 * and is now false: `POST /api/profile/avatar` stores one, `DELETE` removes it,
 * and `GET /api/profile` hands back `avatar_url` for any role. Keeping the old
 * paragraph would have been the same lie in the opposite direction.
 *
 * THREE THINGS THIS DOES THAT A BARE FILE INPUT DOES NOT
 * -----------------------------------------------------
 * 1. THE PREVIEW IS LOCAL AND INSTANT. An object URL is shown the moment the
 *    file is chosen, so the new face is on screen while the bytes are still going
 *    up rather than after the round-trip. Exactly one URL exists at a time and it
 *    is revoked on replace and on unmount; leaking them pins the whole image in
 *    memory for the life of the document.
 * 2. THE FILE IS CHECKED BEFORE THE REQUEST. The size and type rules mirror the
 *    server's, so an 8 MB photo produces a sentence naming its size and the
 *    limit, instead of a 413 whose body is raw Flask HTML.
 * 3. A FAILED UPLOAD REVERTS. The preview is dropped when the server refuses, so
 *    the avatar on screen never disagrees with the avatar that is stored.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';

import { Alert, Avatar, Button, Spinner } from '../../../components/ui';
import { ApiError, profile as profileApi } from '../../../lib/api';
import { AVATAR_LIMITS, prettyBytes, validateImageFile } from '../../../lib/imageFile';
import { resolveImageUrl } from '../../../lib/imageUrl';

/** Only the formats the server accepts, so the OS picker greys the rest out. */
const ACCEPT = AVATAR_LIMITS.ACCEPTED_TYPES.join(',');

/**
 * Neutral file-input chrome. NOT the primary fill: `primary-600` re-ramps to
 * rgb(94,149,237) in dark mode, where white text on it is 3.0:1 and fails AA, so
 * the button reads as a surface chip in both themes instead.
 */
const FILE_INPUT_CLASS = [
  'block w-full max-w-xs font-body text-body-sm text-muted',
  'file:mr-3 file:cursor-pointer file:rounded-control file:border file:border-default',
  'file:bg-surface-raised file:px-3 file:py-2 file:font-body file:text-label-md file:text-default',
  'hover:file:bg-surface-sunken',
  'rounded-field outline-none focus-visible:ring-2 focus-visible:ring-focus',
  'focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
].join(' ');

/**
 * @param {object} props
 * @param {object} props.profile GET /api/profile payload.
 * @param {(next: object) => void} props.onChange Called with `{avatar_url, avatar_endpoint}`
 *   so the page can merge it into the profile it already holds.
 * @param {string} [props.inputId]
 */
export default function AvatarUploader({ profile, onChange, inputId = 'account-avatar' }) {
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(null); // 'upload' | 'remove' | null
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const fileInput = useRef(null);
  /** The one live object URL. Revoked on replace and on unmount. */
  const previewUrl = useRef(null);

  const dropPreview = useCallback(() => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = null;
    setPreview(null);
  }, []);

  useEffect(() => () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
  }, []);

  const stored = resolveImageUrl(profile) || undefined;
  const hasStored = Boolean(profile?.avatar_url || profile?.avatar_endpoint);

  const pick = async (event) => {
    const file = event.target.files?.[0] || null;
    // The input is cleared straight away so picking the SAME file twice after a
    // failure still fires a change event.
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;

    setNotice(null);
    const invalid = validateImageFile(file, AVATAR_LIMITS);
    if (invalid) {
      dropPreview();
      setError(invalid);
      return;
    }

    setError(null);
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = URL.createObjectURL(file);
    setPreview(previewUrl.current);

    setBusy('upload');
    try {
      const data = await profileApi.uploadAvatar(file);
      onChange?.({
        avatar_url: data?.avatar_url ?? null,
        avatar_endpoint: data?.avatar_endpoint ?? null,
      });
      setNotice('Your photo has been updated.');
      // The stored URL is authoritative from here; the local copy would only
      // pin the original full-size bytes in memory.
      dropPreview();
    } catch (err) {
      dropPreview();
      setError(err instanceof ApiError ? err.message : 'That photo could not be uploaded.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setError(null);
    setNotice(null);
    setBusy('remove');
    try {
      await profileApi.removeAvatar();
      onChange?.({ avatar_url: null, avatar_endpoint: null });
      dropPreview();
      setNotice('Your photo has been removed. Your initials are shown instead.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That photo could not be removed.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <Avatar src={preview || stored} name={profile?.name} size="2xl" />

      <div className="w-full">
        <label htmlFor={inputId} className="mb-1 block font-body text-label-md text-default">
          Profile photo
        </label>
        <input
          id={inputId}
          ref={fileInput}
          type="file"
          accept={ACCEPT}
          onChange={pick}
          disabled={busy !== null}
          className={FILE_INPUT_CLASS}
        />
        <p className="mt-1.5 font-body text-caption leading-relaxed text-muted">
          PNG, JPG or WebP, up to {prettyBytes(AVATAR_LIMITS.MAX_IMAGE_BYTES)}. It is cropped to a
          square and shown wherever your name appears.
        </p>
      </div>

      {/* No second "choose a photo" button: the input above already opens the
          picker, and two controls for one action is two things to explain. */}
      <div className="flex w-full flex-wrap items-center gap-2">
        {busy === 'upload' && (
          <p className="flex items-center gap-2 font-body text-caption text-muted" aria-live="polite">
            <Spinner size="xs" />
            Uploading your photo
          </p>
        )}
        {hasStored && busy !== 'upload' && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            loading={busy === 'remove'}
            loadingText="Removing"
            leftIcon={<Trash2 className="h-4 w-4" />}
            onClick={remove}
          >
            Remove photo
          </Button>
        )}
      </div>

      {error && <Alert tone="danger" className="text-left">{error}</Alert>}
      {notice && !error && <Alert tone="success" className="text-left">{notice}</Alert>}
    </div>
  );
}

export { AvatarUploader };
