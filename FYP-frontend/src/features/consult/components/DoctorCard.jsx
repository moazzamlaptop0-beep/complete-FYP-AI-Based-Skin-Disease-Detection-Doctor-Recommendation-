/**
 * DoctorCard — one selectable doctor in the directory.
 *
 * SELECTION IS THE WHOLE CARD, AND IT IS A CHECKBOX
 * -------------------------------------------------
 * The old flow let a scan reach exactly ONE doctor, so the picker was a radio in
 * spirit: choosing a second doctor un-chose the first. A request now carries up
 * to three, so this is a real multi-select and it says so with a checkbox rather
 * than by turning a card blue and hoping the pattern is obvious.
 *
 * The `<input type="checkbox">` is real and it is the accessible name holder;
 * the surrounding card is a `<label>`, so pointer users can hit anywhere on the
 * card and keyboard users get native checkbox semantics (Space to toggle, the
 * count announced by the tray's live region). No `role="button"` div, no
 * onKeyDown re-implementation of the spacebar.
 *
 * WHEN THE CAP IS REACHED, UNSELECTED CARDS DISABLE — THEY DO NOT DISAPPEAR
 * ------------------------------------------------------------------------
 * Hiding them would make the list silently change under the user's cursor. They
 * stay, dimmed, with the reason in the tray ("3 of 3 chosen. Remove one to swap").
 *
 * THE HIERARCHY, TOP TO BOTTOM
 * ----------------------------
 * A marketplace card is only useful if the eye lands on the deciding facts in
 * the order a patient decides in. That order was tested against the actual
 * question people ask ("can I trust them, can I reach them, can I afford
 * them"), so the card is laid out in three bands rather than as one soup of
 * captions:
 *
 *   1. IDENTITY   avatar, name, verification, specialty, place.
 *   2. TRUST      rating and review count, promoted to a chip so an unrated
 *                 doctor reads as "New" instead of as a missing star row.
 *   3. LOGISTICS  a sunken footer strip carrying fee, distance and experience as
 *                 labelled figures, because "Rs 2,000" without the word "fee"
 *                 beside it is the number people misread as a rating.
 *
 * Availability sits between 2 and 3 as a tinted line: it is a HINT derived from
 * the published weekly schedule, never a promise that a slot is free, and the
 * Times step is where real openings are fetched.
 *
 * COLOUR CONTRACT
 * ---------------
 * Every fill here is a var-backed scale that re-ramps in dark mode, so the two
 * solid-fill pills (`bg-primary-600`, `bg-primary-900`) carry the sanctioned
 * `dark:text-primary-50` twin: `primary-600` becomes rgb(94 149 237) on dark and
 * white on that is 3.0:1, which fails, while `primary-50` becomes rgb(8 29 66)
 * and reads 5.9:1. No `dark:` override appears on anything that already flips.
 */

import React from 'react';
import { BadgeCheck, Clock, MapPin, Star, Stethoscope, Wallet } from 'lucide-react';

import { Avatar, Badge, cn } from '../../../components/ui';
import { formatCurrency } from '../../../lib/format';
import { resolveImageUrl } from '../../../lib/imageUrl';
import { formatDistance } from '../lib/geo';
import { nextAvailability } from '../lib/doctorModel';

/**
 * The rank pill on a chosen doctor's avatar. Solid mid-scale fill, so the label
 * needs the dark twin (see the colour contract note above).
 */
const RANK_PILL =
  'bg-primary-600 text-white dark:text-primary-50';

/** One labelled figure in the footer strip. */
function Fact({ icon, label, value, hint }) {
  return (
    <div className="min-w-0 flex-1 px-3 py-2 first:pl-0 last:pr-0">
      <p className="flex items-center gap-1 text-overline uppercase text-subtle">
        {icon}
        {label}
      </p>
      <p className="mt-0.5 truncate text-label-md text-default">{value}</p>
      {hint && <p className="truncate text-caption text-subtle">{hint}</p>}
    </div>
  );
}

/**
 * @param {object} props
 * @param {import('../lib/doctorModel').ConsultDoctor & {distance?:number|null}} props.doctor
 * @param {boolean} props.selected
 * @param {boolean} [props.disabled] The 3-doctor cap is reached and this one is not chosen.
 * @param {(doctor:object)=>void} props.onToggle
 * @param {number} [props.rank] 1-based position in the patient's chosen list.
 * @param {boolean} [props.compact] Denser layout, used inside the map's side list.
 */
export default function DoctorCard({
  doctor,
  selected = false,
  disabled = false,
  onToggle,
  rank,
  compact = false,
  className,
}) {
  const photo = resolveImageUrl(doctor.photo, { fallback: null });
  const availability = nextAvailability(doctor);
  const distance = formatDistance(doctor.distance);
  const locked = disabled && !selected;

  const place = [doctor.hospital, doctor.city].filter(Boolean).join(' · ');

  return (
    <label
      className={cn(
        'group relative flex cursor-pointer flex-col overflow-hidden rounded-card border',
        'bg-surface text-left',
        'transition-[border-color,box-shadow,transform,background-color] duration-150 ease-emphasized',
        'motion-reduce:transition-none motion-reduce:transform-none',
        'focus-within:ring-2 focus-within:ring-focus focus-within:ring-offset-2',
        'focus-within:ring-offset-canvas',
        selected
          ? 'border-primary-500 bg-primary-50 shadow-card'
          : 'border-subtle shadow-soft hover:-translate-y-0.5 hover:border-primary-400 hover:shadow-card-hover',
        locked && 'cursor-not-allowed opacity-55 hover:translate-y-0 hover:border-subtle hover:shadow-soft',
        className,
      )}
    >
      {/*
        The chosen marker as a full-width bar on the card's own edge rather than a
        border colour change alone: a 1px hue shift is the first thing to vanish
        on a dim laptop panel, and selection is the one state on this screen that
        must never be ambiguous. Sits behind the content, decorative.
      */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-x-0 top-0 h-1 transition-opacity duration-150',
          'bg-gradient-to-r from-primary-600 to-accent-700 dark:from-primary-400 dark:to-accent-300',
          selected ? 'opacity-100' : 'opacity-0',
        )}
      />

      {/*
        An explicit `aria-label` rather than letting the wrapping <label> supply
        the name: the card's text content is eight facts long, and a checkbox
        whose accessible name is "Dr Ayesha Khan Dermatologist Shifa
        International Islamabad 4.8 (12 reviews) Rs 2,000 30min 3.4 km away 12
        yrs experience Usually free Tomorrow from 09:00 Verified" is unusable.
        The details are still in the DOM, read as the label's own content when
        the user browses the card.
      */}
      <input
        type="checkbox"
        className="peer sr-only"
        checked={selected}
        disabled={locked}
        onChange={() => onToggle?.(doctor)}
        aria-label={`Choose ${doctor.name}, ${doctor.specialty}${doctor.city ? `, ${doctor.city}` : ''}`}
      />

      {/* ------------------------------------------------------- 1. identity -- */}
      <div className={cn('flex items-start gap-3.5', compact ? 'p-3.5' : 'p-4 sm:p-5')}>
        <div className="relative shrink-0">
          <Avatar
            src={photo || undefined}
            name={doctor.name}
            size={compact ? 'md' : 'lg'}
            shape="rounded"
            className={cn(selected && 'ring-2 ring-primary-500')}
          />
          {selected ? (
            <span
              aria-hidden="true"
              className={cn(
                'absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center',
                'rounded-pill text-[0.6875rem] font-bold ring-2 ring-surface',
                RANK_PILL,
              )}
            >
              {rank || '✓'}
            </span>
          ) : (
            doctor.isVerified && (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute -right-1 -bottom-1 grid h-5 w-5 place-items-center rounded-pill',
                  'bg-success-600 text-white ring-2 ring-surface dark:text-success-50',
                )}
              >
                <BadgeCheck className="h-3 w-3" />
              </span>
            )
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-heading text-heading-sm text-default">{doctor.name}</p>
              <p className="mt-1 flex items-center gap-1.5 truncate text-caption text-muted">
                <Stethoscope aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-primary-600" />
                <span className="truncate">{doctor.specialty}</span>
              </p>
            </div>

            {/* The tick box, mirroring the hidden input's state. */}
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-control border-2',
                'transition-colors duration-150',
                selected
                  ? 'border-primary-600 bg-primary-600 text-white dark:text-primary-50'
                  : 'border-strong bg-surface text-transparent group-hover:border-primary-400',
                locked && 'border-dashed border-strong group-hover:border-strong',
              )}
            >
              <svg viewBox="0 0 16 16" fill="none" className="h-3.5 w-3.5">
                <path
                  d="m3.5 8.5 3 3 6-6.5"
                  stroke="currentColor"
                  strokeWidth="2.25"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
          </div>

          {place && (
            <p className="mt-2 flex items-start gap-1.5 text-caption text-subtle">
              <MapPin aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
              <span className="line-clamp-2">{place}</span>
            </p>
          )}

          {/* ------------------------------------------------------ 2. trust -- */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {doctor.rating === null ? (
              <Badge tone="neutral" size="sm">New</Badge>
            ) : (
              <span
                className={cn(
                  'inline-flex items-center gap-1 rounded-pill border border-warning-200',
                  'bg-warning-50 px-2 py-0.5 text-caption font-semibold text-warning-800',
                )}
              >
                <Star aria-hidden="true" className="h-3.5 w-3.5 fill-warning-400 text-warning-500" />
                <span className="font-numeric tabular-nums">{doctor.rating.toFixed(1)}</span>
                <span className="font-normal">
                  ({doctor.reviews} {doctor.reviews === 1 ? 'review' : 'reviews'})
                </span>
              </span>
            )}

            {doctor.isVerified ? (
              <Badge tone="success" size="sm" icon={<BadgeCheck aria-hidden="true" />}>
                Verified
              </Badge>
            ) : (
              <Badge tone="warning" size="sm" dot>
                Awaiting verification
              </Badge>
            )}
          </div>

          {/* ----------------------------------------------- availability hint -- */}
          <p
            className={cn(
              'mt-2.5 flex items-start gap-1.5 rounded-control px-2 py-1.5 text-caption',
              availability
                ? 'bg-success-50 text-success-700'
                : 'bg-surface-sunken text-subtle',
            )}
          >
            <Clock aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
            <span>
              {availability
                ? `Usually free ${availability.label}${availability.start ? ` from ${availability.start}` : ''}`
                : 'Hours not published, but you can still offer times'}
            </span>
          </p>
        </div>
      </div>

      {/* ---------------------------------------------------- 3. logistics --
          `border-default`, not `border-subtle`: in light mode the subtle line
          token and the sunken surface token are the SAME rgb, so a subtle
          hairline on a sunken band is invisible. */}
      <div
        className={cn(
          'mt-auto flex items-stretch divide-x divide-default border-t border-default',
          'bg-surface-sunken px-4 py-1 sm:px-5',
        )}
      >
        <Fact
          icon={<Wallet aria-hidden="true" className="h-3 w-3" />}
          label="Fee"
          value={doctor.feePkr === null ? 'Not listed' : formatCurrency(doctor.feePkr, 'PKR')}
          hint={doctor.feePkr === null ? 'Ask at booking' : `per ${doctor.duration} visit`}
        />
        <Fact
          icon={<MapPin aria-hidden="true" className="h-3 w-3" />}
          label="Distance"
          value={distance ? `${distance} away` : 'Unknown'}
          hint={distance ? 'Straight line' : 'Share your location'}
        />
        <Fact
          icon={<Stethoscope aria-hidden="true" className="h-3 w-3" />}
          label="Experience"
          value={doctor.experience > 0 ? `${doctor.experience} yrs` : 'Not stated'}
          hint={doctor.experience > 0 ? 'In practice' : 'On their profile'}
        />
      </div>
    </label>
  );
}

export { DoctorCard };
