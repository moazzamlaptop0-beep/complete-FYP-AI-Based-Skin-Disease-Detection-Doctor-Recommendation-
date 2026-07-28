/**
 * ExtraPhotoStrip — up to three extra photos, on top of the one that was analysed.
 *
 * WHY EXTRA PHOTOS AT ALL
 * -----------------------
 * The model gets exactly one close-up, because that is what a classifier wants.
 * A human dermatologist wants three other things the close-up cannot show: how
 * big the area is next to something for scale, whether there is more of it
 * elsewhere on the body, and what it looked like last month. None of those
 * belong in the frame we send the CNN — cropping for the model and cropping for
 * a person are different jobs — so they live here instead.
 *
 * These are CONTEXT, never re-analysed. The strip says so, because a second
 * photo appearing under a screen full of AI verdicts otherwise reads as "this
 * one will be scored too".
 *
 * NO OBJECT URLS
 * --------------
 * Previews are the data: thumbnails built in lib/attachments.js. See that file
 * for why: an object URL per tile would need per-tile revocation on removal, on
 * reorder and on unmount, and getting one of those wrong leaks a whole bitmap.
 *
 * NOT MOUNTED ANYWHERE, ON PURPOSE
 * --------------------------------
 * `POST /api/scans/<id>/attachments` is not routed yet (the live url_map has only
 * the two GETs and the DELETE), so every upload this strip could make would 405.
 * StepDetails therefore does not render it and the styling below is kept in step
 * with the rest of the flow so the phase that lands the route only has to mount
 * it. Do NOT wire it up before the backend can serve it: a picker whose every
 * upload fails is worse than no picker.
 */

import React, { useCallback, useId, useRef, useState } from 'react';
import { ImagePlus, Loader2, RotateCcw, X } from 'lucide-react';

import { Alert, Button, IconButton, cn } from '../../../components/ui';
import { LIMITS } from '../consultReducer';
import { attachmentLabel, makeAttachment, remainingSlots } from '../lib/attachments';
import { ACCEPT_ATTRIBUTE } from '../lib/imageFile';

/**
 * @param {object} props
 * @param {Array<object>} props.attachments
 * @param {(next:Array<object>)=>void} props.onChange receives the WHOLE next array
 * @param {string} [props.className]
 */
export default function ExtraPhotoStrip({ attachments = [], onChange, className }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const headingId = useId();

  const remaining = remainingSlots(attachments);
  const full = remaining === 0;

  /**
   * Accepts a whole FileList, because a phone picker returns several at once and
   * refusing the extras silently is the kind of thing users read as "it lost my
   * photo". Anything past the cap is reported by name rather than dropped.
   */
  const addFiles = useCallback(async (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    setError(null);
    setBusy(true);

    const accepted = [];
    const problems = [];
    let room = remainingSlots(attachments);

    for (const file of files) {
      if (room === 0) {
        problems.push(`${file.name}: you can add ${LIMITS.MAX_ATTACHMENTS} extra photos in total.`);
        continue;
      }
      // Sequential on purpose: three concurrent compression workers on a mid
      // range phone is how you get a jank spike and an out-of-memory kill.
      const result = await makeAttachment(file);
      if (result.ok) {
        accepted.push(result.attachment);
        room -= 1;
      } else {
        problems.push(`${file.name}: ${result.error}`);
      }
    }

    setBusy(false);
    if (problems.length) setError(problems.join(' '));

    if (accepted.length) {
      onChange?.([...attachments, ...accepted]);
      setAnnouncement(
        `${accepted.length} photo${accepted.length === 1 ? '' : 's'} added. `
        + `${attachments.length + accepted.length} of ${LIMITS.MAX_ATTACHMENTS}.`,
      );
    }
  }, [attachments, onChange]);

  const handleInput = useCallback((event) => {
    const { files } = event.target;
    addFiles(files);
    // Reset so picking the SAME file twice in a row still fires `change`.
    event.target.value = '';
  }, [addFiles]);

  const remove = useCallback((attachment) => {
    onChange?.(attachments.filter((entry) => entry.id !== attachment.id));
    setAnnouncement(
      `${attachment.name} removed. ${attachments.length - 1} of ${LIMITS.MAX_ATTACHMENTS}.`,
    );
  }, [attachments, onChange]);

  return (
    <section aria-labelledby={headingId} className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={headingId} className="text-label-lg text-default">
          More photos
          <span className="ml-2 text-label-sm font-normal text-subtle">optional</span>
        </h3>
        <p className="text-caption text-subtle">
          {attachments.length} of {LIMITS.MAX_ATTACHMENTS}
        </p>
      </div>

      <p className="text-body-sm text-muted">
        A wider shot for scale, the same spot in different light, or another area that looks
        similar. These go to the doctors as context; they are not re-analysed by the model.
      </p>

      {/* --------------------------------------------------------- the tiles -- */}
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {attachments.map((attachment) => (
          <li
            key={attachment.id}
            className="group relative overflow-hidden rounded-card border border-default bg-surface-sunken shadow-soft"
          >
            <div className="aspect-square w-full">
              {attachment.thumbUrl ? (
                <img
                  src={attachment.thumbUrl}
                  alt={`Extra photo: ${attachment.name}`}
                  className={cn(
                    'h-full w-full object-cover',
                    attachment.restored && 'opacity-50 grayscale',
                  )}
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center p-2 text-center text-caption text-subtle">
                  No preview
                </div>
              )}
            </div>

            <div className="absolute right-1 top-1">
              <IconButton
                aria-label={`Remove ${attachment.name}`}
                size="sm"
                variant="danger"
                onClick={() => remove(attachment)}
              >
                <X />
              </IconButton>
            </div>

            <p className="truncate px-2 py-1.5 text-caption text-subtle" title={attachmentLabel(attachment)}>
              {attachment.restored ? 'Needs picking again' : attachmentLabel(attachment)}
            </p>
          </li>
        ))}

        {/* the add tile — a real button, not a label-shaped div */}
        {!full && (
          <li>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
              className={cn(
                'flex aspect-square w-full flex-col items-center justify-center gap-1.5',
                'rounded-card border-2 border-dashed border-strong bg-surface p-2 text-center',
                'text-caption text-muted outline-none transition-colors duration-150',
                'hover:border-primary-400 hover:bg-primary-50 hover:text-primary-800',
                'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
                'focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-60',
              )}
            >
              {busy ? (
                <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
              ) : (
                <ImagePlus aria-hidden="true" className="h-5 w-5" />
              )}
              <span>{busy ? 'Preparing…' : 'Add a photo'}</span>
              <span className="text-caption text-subtle">
                {remaining} left
              </span>
            </button>
          </li>
        )}
      </ul>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        multiple
        className="ui-sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleInput}
      />

      {attachments.some((entry) => entry.restored) && (
        <Alert
          tone="info"
          icon={<RotateCcw aria-hidden="true" className="h-5 w-5" />}
          actions={
            <Button
              size="sm"
              variant="outline"
              onClick={() => onChange?.(attachments.filter((entry) => !entry.restored))}
            >
              Clear the greyed-out ones
            </Button>
          }
        >
          The greyed-out photos came back with your draft, but the browser cannot keep the files
          themselves across a reload. Add them again, or clear them; they will not be sent as they
          are.
        </Alert>
      )}

      {error && (
        <Alert tone="warning" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <p aria-live="polite" className="ui-sr-only">{announcement}</p>
    </section>
  );
}

export { ExtraPhotoStrip };
