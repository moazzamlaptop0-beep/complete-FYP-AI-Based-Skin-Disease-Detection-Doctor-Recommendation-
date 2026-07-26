/**
 * ScanThumb — the doctor-side wrapper around the shared <SensitiveImage>.
 *
 * SensitiveImage (src/components/media/SensitiveImage.jsx) owns the privacy
 * rules: it reads `image_endpoint` through the authenticated route, serves the
 * blurred variant for `is_sensitive` scans and makes "reveal the full image" an
 * explicit, audit-logged act. NOTHING here re-implements any of that — this file
 * only fixes the size/shape a doctor's list row wants and handles the one case
 * SensitiveImage cannot: a scan whose photo the patient has erased
 * (`has_image === false`, `image_endpoint === null`), where there is no image to
 * ask for and an <img> would be a guaranteed 404.
 *
 * The erased case is deliberately NOT rendered as an error. Deleting the photo
 * is a right the patient exercised; the clinical record (prediction, severity,
 * the doctor's own comment) survives it, so the tile says so plainly.
 *
 * `zoomable` adds the examination view (<ScanLightbox>) on top: a 112px tile is
 * enough to recognise a case, never enough to READ one, and a doctor asked to
 * accept or decline on the strength of a photograph must be able to magnify and
 * orient it. The lightbox mounts only once opened, so the inbox pays nothing
 * for rows nobody opens.
 */

import React, { useState } from 'react';
import { ImageOff, Maximize2 } from 'lucide-react';

import { cn } from '../../../lib/cn';
import SensitiveImage from '../../../components/media/SensitiveImage';
import ScanLightbox from '../../../components/media/ScanLightbox';

const SIZES = {
  sm: 'h-14 w-14',
  md: 'h-20 w-20',
  lg: 'h-28 w-28',
  xl: 'h-40 w-full sm:w-40',
};

/**
 * @param {object} props
 * @param {object} props.scan A scan-shaped payload carrying `id`/`scan_id`,
 *   `is_sensitive`, `has_image`, `image_endpoint` and/or `image_url`.
 * @param {'sm'|'md'|'lg'|'xl'} [props.size='md']
 * @param {'thumb'|'blur'|'full'} [props.variant='thumb']
 * @param {string} [props.alt]
 * @param {boolean} [props.zoomable=false] Open a full-screen zoom/rotate viewer.
 * @param {React.ReactNode} [props.zoomTitle] Heading inside that viewer.
 * @param {React.ReactNode} [props.zoomSubtitle] Sub-heading inside that viewer.
 * @param {string} [props.className]
 */
export default function ScanThumb({
  scan,
  size = 'md',
  variant = 'thumb',
  alt,
  canReveal = false,
  zoomable = false,
  zoomTitle,
  zoomSubtitle,
  className,
}) {
  const [zoomOpen, setZoomOpen] = useState(false);
  const box = SIZES[size] || SIZES.md;
  const scanId = scan?.id ?? scan?.scan_id ?? null;

  // `has_image` is only absent on payloads written before the privacy phase;
  // treat "unknown" as "there is probably an image" and let SensitiveImage's own
  // error state deal with it, rather than hiding a photo that does exist.
  const erased = scan?.has_image === false
    || (scan?.image_deleted_at && !scan?.image_endpoint && !scan?.image_url);

  if (!scanId || erased) {
    return (
      <div
        className={cn(
          'flex shrink-0 flex-col items-center justify-center gap-1 rounded-card border border-dashed',
          'border-subtle bg-surface-sunken px-2 text-center',
          box,
          className,
        )}
        role="img"
        aria-label={erased ? 'Photo deleted by the patient' : 'No photo on this scan'}
      >
        <ImageOff className="h-4 w-4 text-subtle" aria-hidden="true" />
        <span className="text-[0.625rem] leading-tight text-subtle">
          {erased ? 'Photo erased' : 'No photo'}
        </span>
      </div>
    );
  }

  const label = alt || `Scan #${scanId}`;

  const tile = (
    <SensitiveImage
      scanId={scanId}
      variant={variant}
      // SensitiveImage's prop is `sensitive`, not `isSensitive` — passing the
      // wrong name here would silently serve the SHARP thumbnail of a scan the
      // patient marked private, which is the one failure this whole component
      // exists to prevent.
      sensitive={Boolean(scan?.is_sensitive)}
      deletedAt={scan?.image_deleted_at || null}
      hasImage={scan?.has_image !== false}
      canReveal={canReveal}
      compact={size === 'sm'}
      alt={label}
      onClick={zoomable ? () => setZoomOpen(true) : undefined}
      className={cn('shrink-0', zoomable ? 'h-full w-full' : box, className)}
    />
  );

  if (!zoomable) return tile;

  return (
    <div className={cn('group relative shrink-0', box, className)}>
      {tile}

      {/* The photo itself is clickable, but a click target with no role is
          invisible to a keyboard: this is the focusable, named way in, and it
          sits ABOVE the sensitive-image scrim so a protected scan can still be
          opened (it opens protected — revealing is a separate, logged act). */}
      <button
        type="button"
        onClick={() => setZoomOpen(true)}
        aria-label={`Open ${label} in the full-screen viewer`}
        className={cn(
          'absolute right-1 top-1 z-raised inline-flex h-6 w-6 items-center justify-center',
          'rounded-control bg-neutral-950/60 text-white outline-none transition-opacity',
          // Always offered on touch, where there is no hover to reveal it with.
          'opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100',
          'hover:bg-neutral-950/80 focus-visible:ring-2 focus-visible:ring-white/80',
        )}
      >
        <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      <ScanLightbox
        open={zoomOpen}
        onClose={() => setZoomOpen(false)}
        scanId={scanId}
        sensitive={Boolean(scan?.is_sensitive)}
        canReveal={canReveal}
        deletedAt={scan?.image_deleted_at || null}
        hasImage={scan?.has_image !== false}
        alt={label}
        title={zoomTitle}
        subtitle={zoomSubtitle}
      />
    </div>
  );
}

export { ScanThumb };
