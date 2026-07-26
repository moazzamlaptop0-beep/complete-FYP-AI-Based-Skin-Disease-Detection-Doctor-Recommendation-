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
 * stay, dimmed, with the reason in the tray ("3 of 3 chosen — remove one to swap").
 */

import React from 'react';
import { BadgeCheck, Clock, MapPin, Star, Stethoscope } from 'lucide-react';

import { Avatar, Badge, cn } from '../../../components/ui';
import { formatCurrency } from '../../../lib/format';
import { resolveImageUrl } from '../../../lib/imageUrl';
import { formatDistance } from '../lib/geo';
import { nextAvailability } from '../lib/doctorModel';

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

  const place = [doctor.hospital, doctor.city].filter(Boolean).join(' · ');

  return (
    <label
      className={cn(
        'group relative block cursor-pointer rounded-card border bg-surface p-4 text-left',
        'transition-[border-color,box-shadow,background-color] duration-150 ease-emphasized',
        'focus-within:ring-2 focus-within:ring-focus focus-within:ring-offset-2',
        'focus-within:ring-offset-canvas',
        selected
          ? 'border-primary-600 bg-primary-50 shadow-card dark:bg-primary-950/40'
          : 'border-subtle hover:border-strong hover:shadow-card',
        disabled && !selected && 'cursor-not-allowed opacity-55 hover:border-subtle hover:shadow-none',
        className,
      )}
    >
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
        disabled={disabled && !selected}
        onChange={() => onToggle?.(doctor)}
        aria-label={`Choose ${doctor.name}, ${doctor.specialty}${doctor.city ? `, ${doctor.city}` : ''}`}
      />

      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <Avatar
            src={photo || undefined}
            name={doctor.name}
            size={compact ? 'md' : 'lg'}
            shape="rounded"
          />
          {selected && (
            <span
              aria-hidden="true"
              className={cn(
                'absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center',
                'rounded-pill bg-primary-600 text-[0.6875rem] font-bold text-white',
                'ring-2 ring-surface',
              )}
            >
              {rank || '✓'}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-label-lg text-default">{doctor.name}</p>
              <p className="mt-0.5 flex items-center gap-1 truncate text-caption text-muted">
                <Stethoscope aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{doctor.specialty}</span>
              </p>
            </div>

            {/* The tick box, mirroring the hidden input's state. */}
            <span
              aria-hidden="true"
              className={cn(
                'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                'transition-colors duration-150',
                selected
                  ? 'border-primary-600 bg-primary-600 text-white'
                  : 'border-strong bg-surface text-transparent',
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
            <p className="mt-1.5 flex items-start gap-1 text-caption text-subtle">
              <MapPin aria-hidden="true" className="mt-px h-3.5 w-3.5 shrink-0" />
              <span className="line-clamp-2">{place}</span>
            </p>
          )}

          {/* --------------------------------------------------------- meta -- */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-caption">
            {doctor.rating === null ? (
              <Badge tone="neutral" size="sm">New</Badge>
            ) : (
              <span className="inline-flex items-center gap-1 font-medium text-default">
                <Star aria-hidden="true" className="h-3.5 w-3.5 fill-warning-400 text-warning-500" />
                {doctor.rating.toFixed(1)}
                <span className="font-normal text-subtle">
                  ({doctor.reviews} {doctor.reviews === 1 ? 'review' : 'reviews'})
                </span>
              </span>
            )}

            <span className="text-muted">
              {doctor.feePkr === null
                ? 'Fee not listed'
                : `${formatCurrency(doctor.feePkr, 'PKR')} · ${doctor.duration}`}
            </span>

            {distance && (
              <span className="inline-flex items-center gap-1 text-muted">
                <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
                {distance} away
              </span>
            )}

            {doctor.experience > 0 && (
              <span className="text-subtle">{doctor.experience} yrs experience</span>
            )}
          </div>

          {/* ------------------------------------------------- availability -- */}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {availability ? (
              <span className="inline-flex items-center gap-1 text-caption text-success-700 dark:text-success-400">
                <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                Usually free {availability.label}
                {availability.start ? ` from ${availability.start}` : ''}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-caption text-subtle">
                <Clock aria-hidden="true" className="h-3.5 w-3.5" />
                Hours not published — you can still offer times
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
        </div>
      </div>
    </label>
  );
}

export { DoctorCard };
