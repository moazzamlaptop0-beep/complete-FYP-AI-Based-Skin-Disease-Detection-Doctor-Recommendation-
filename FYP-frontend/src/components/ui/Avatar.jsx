import React, { forwardRef, useState } from 'react';
import { cn } from '../../lib/cn';

const SIZES = {
  xs: 'h-6 w-6 text-[0.625rem]',
  sm: 'h-8 w-8 text-[0.75rem]',
  md: 'h-10 w-10 text-body-sm',
  lg: 'h-12 w-12 text-body-md',
  xl: 'h-16 w-16 text-heading-md',
  '2xl': 'h-24 w-24 text-display-sm',
};

const STATUS_TONE = {
  online: 'bg-success-500',
  offline: 'bg-neutral-400',
  busy: 'bg-danger-500',
  away: 'bg-warning-500',
};

const STATUS_SIZE = {
  xs: 'h-1.5 w-1.5',
  sm: 'h-2 w-2',
  md: 'h-2.5 w-2.5',
  lg: 'h-3 w-3',
  xl: 'h-3.5 w-3.5',
  '2xl': 'h-4 w-4',
};

/**
 * Deterministic fallback tint so the same person keeps the same colour on every
 * screen. A plain char-code sum is enough here and stays stable across
 * renders/sessions without storing anything.
 */
const FALLBACK_TONES = [
  'bg-primary-100 text-primary-800',
  'bg-accent-100 text-accent-800',
  'bg-success-100 text-success-800',
  'bg-warning-100 text-warning-800',
  'bg-danger-100 text-danger-800',
  'bg-neutral-200 text-neutral-700',
];

function toneFor(seed) {
  const str = String(seed ?? '');
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) hash = (hash + str.charCodeAt(i) * (i + 1)) % 997;
  return FALLBACK_TONES[hash % FALLBACK_TONES.length];
}

/**
 * Derive up to two initials from a display name.
 * Handles "Dr. Ayesha Khan" -> "AK" and single-word names -> first two chars.
 * @param {string} [name]
 * @returns {string}
 */
export function initialsFrom(name) {
  const cleaned = String(name ?? '')
    .replace(/\b(dr|mr|mrs|ms|prof)\.?\s+/gi, '')
    .trim();
  if (!cleaned) return '?';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * User avatar with an initials fallback.
 *
 * The image is swapped in only after it loads successfully, so a broken or
 * 403'd URL (common once image-privacy rules kick in on scan attachments)
 * degrades to initials instead of a browser "broken image" glyph.
 *
 * The avatar is decorative when it sits next to the person's name — that is the
 * default, hence `aria-hidden` unless you pass an explicit `alt`.
 *
 * @param {object} props
 * @param {string} [props.src] Image URL.
 * @param {string} [props.name] Display name; drives initials and the fallback tint.
 * @param {string} [props.alt] Accessible name. Omit when the name is adjacent in the DOM.
 * @param {'xs'|'sm'|'md'|'lg'|'xl'|'2xl'} [props.size='md']
 * @param {'circle'|'rounded'} [props.shape='circle']
 * @param {'online'|'offline'|'busy'|'away'} [props.status] Presence dot.
 * @param {boolean} [props.ring=false] Contrast ring against busy backgrounds.
 * @param {string} [props.className]
 */
const Avatar = forwardRef(function Avatar(
  {
    src,
    name,
    alt,
    size = 'md',
    shape = 'circle',
    status,
    ring = false,
    className,
    ...rest
  },
  ref,
) {
  // Load state is keyed by `src`, so a new URL resets it. This uses React's
  // "adjust state during render" pattern rather than a reset effect: an effect
  // would paint one frame of the OLD avatar (or the stale broken-image
  // fallback) after the user uploads a new photo.
  const [imgState, setImgState] = useState({ src, loaded: false, failed: false });
  if (imgState.src !== src) {
    setImgState({ src, loaded: false, failed: false });
  }
  const { loaded, failed } = imgState;
  const setLoaded = () => setImgState((s) => ({ ...s, loaded: true }));
  const setFailed = () => setImgState((s) => ({ ...s, failed: true }));

  const showImage = Boolean(src) && !failed;
  const decorative = !alt;

  return (
    <span
      ref={ref}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : alt}
      aria-hidden={decorative ? 'true' : undefined}
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center overflow-hidden',
        'font-body font-semibold uppercase',
        shape === 'circle' ? 'rounded-pill' : 'rounded-field',
        ring && 'ring-2 ring-white ring-offset-0 dark:ring-surface-raised',
        toneFor(name ?? src),
        SIZES[size] ?? SIZES.md,
        className,
      )}
      {...rest}
    >
      {showImage && (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={setLoaded}
          onError={setFailed}
          className={cn(
            'absolute inset-0 h-full w-full object-cover',
            loaded ? 'opacity-100' : 'opacity-0',
            'transition-opacity duration-200',
          )}
        />
      )}
      {(!showImage || !loaded) && <span aria-hidden="true">{initialsFrom(name)}</span>}

      {status && (
        <span
          aria-hidden="true"
          className={cn(
            'absolute bottom-0 right-0 rounded-pill ring-2 ring-surface',
            STATUS_TONE[status] ?? STATUS_TONE.offline,
            STATUS_SIZE[size] ?? STATUS_SIZE.md,
          )}
        />
      )}
    </span>
  );
});

/**
 * Overlapping row of avatars with a `+N` overflow chip.
 *
 * @param {object} props
 * @param {Array<{src?: string, name?: string}>} props.items
 * @param {number} [props.max=4] How many to show before collapsing.
 * @param {'xs'|'sm'|'md'|'lg'} [props.size='sm']
 * @param {string} [props.className]
 */
export function AvatarGroup({ items = [], max = 4, size = 'sm', className, ...rest }) {
  const visible = items.slice(0, max);
  const overflow = items.length - visible.length;

  return (
    <div className={cn('flex items-center -space-x-2', className)} {...rest}>
      {visible.map((item, index) => (
        <Avatar
          key={item.id ?? item.src ?? item.name ?? index}
          src={item.src}
          name={item.name}
          size={size}
          ring
        />
      ))}
      {overflow > 0 && (
        <span
          className={cn(
            'inline-flex items-center justify-center rounded-pill bg-neutral-200 font-body',
            'font-semibold text-neutral-700 ring-2 ring-white dark:ring-surface-raised',
            SIZES[size] ?? SIZES.sm,
          )}
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}

export { Avatar };
export default Avatar;
