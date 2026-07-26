/**
 * DoctorCard — one dermatologist in the directory.
 *
 * THE FALLBACKS ARE THE INTERESTING PART
 * --------------------------------------
 * `/api/doctors/public` returns honest nulls where the old code returned
 * plausible-looking fiction: `hospital` and `phone` are null rather than
 * "General Hospital" and "N/A" (a fake number a CRITICAL patient could try to
 * ring), and `rating` is null rather than 0 for a doctor nobody has rated yet.
 * A null rating is shown as "New", NOT as zero stars — those are opposite claims
 * about the same doctor.
 *
 * `city` is the one field that still carries the literal string "N/A" from the
 * backend, so it is filtered out here rather than printed.
 */

import React from 'react';
import { BadgeCheck, Building2, CalendarPlus, MapPin, Star } from 'lucide-react';

import {
  Avatar,
  Badge,
  Button,
  Card,
} from '../../../components/ui';
import { doctorPhotoUrl, realValue } from '../lib/doctorDisplay';
import { formatFee } from '../lib/format';

export function RatingSummary({ doctor, className }) {
  const rating = doctor?.rating ?? doctor?.average_rating;
  const count = doctor?.total_reviews ?? doctor?.rating_count ?? 0;

  if (rating === null || rating === undefined) {
    return (
      <Badge tone="accent" size="sm" className={className}>New to the platform</Badge>
    );
  }

  return (
    <span className={`flex items-center gap-1 font-body text-body-sm text-default ${className || ''}`}>
      <Star className="h-4 w-4 fill-warning-400 text-warning-500" aria-hidden="true" />
      <span className="font-numeric tabular-nums">{Number(rating).toFixed(1)}</span>
      <span className="text-muted">
        ({count} {count === 1 ? 'review' : 'reviews'})
      </span>
    </span>
  );
}

/**
 * @param {object} props
 * @param {object} props.doctor A `/api/doctors/public` element.
 * @param {(doctor: object) => void} props.onOpen View the full profile.
 * @param {(doctor: object) => void} props.onBook Enter the consult flow.
 */
export function DoctorCard({ doctor, onOpen, onBook }) {
  const city = realValue(doctor.city);
  const hospital = realValue(doctor.hospital);
  const fee = formatFee(doctor.fees?.pkr);
  const approved = doctor.verification_status === 'approved';

  return (
    <Card padding="none" className="flex h-full flex-col overflow-hidden">
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <Avatar src={doctorPhotoUrl(doctor)} name={doctor.name} size="lg" className="shrink-0" />
          <div className="min-w-0 flex-1">
            <h3 className="flex items-center gap-1.5 font-heading text-label-lg text-default">
              <span className="truncate">{doctor.name}</span>
              {approved && (
                <BadgeCheck
                  className="h-4 w-4 shrink-0 text-success-600"
                  aria-label="Licence verified"
                />
              )}
            </h3>
            <p className="truncate font-body text-body-sm text-muted">
              {doctor.specialty || doctor.specialization || 'Skin Specialist'}
            </p>
            <RatingSummary doctor={doctor} className="mt-1" />
          </div>
        </div>

        <dl className="flex flex-col gap-1.5">
          {hospital && (
            <div className="flex items-center gap-1.5">
              <dt className="ui-sr-only">Clinic</dt>
              <Building2 className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
              <dd className="truncate font-body text-body-sm text-muted">{hospital}</dd>
            </div>
          )}
          {city && (
            <div className="flex items-center gap-1.5">
              <dt className="ui-sr-only">City</dt>
              <MapPin className="h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
              <dd className="truncate font-body text-body-sm text-muted">{city}</dd>
            </div>
          )}
        </dl>

        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          {fee && <Badge tone="neutral" size="sm">{fee} per visit</Badge>}
          {doctor.experience > 0 && (
            <Badge tone="neutral" variant="outline" size="sm">
              {doctor.experience} {doctor.experience === 1 ? 'year' : 'years'} experience
            </Badge>
          )}
          {!approved && (
            <Badge tone="warning" size="sm">Licence check pending</Badge>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-subtle bg-surface-sunken px-4 py-3">
        <Button
          size="sm"
          leftIcon={<CalendarPlus className="h-4 w-4" />}
          onClick={() => onBook?.(doctor)}
        >
          Book with this doctor
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onOpen?.(doctor)}>
          View profile
        </Button>
      </div>
    </Card>
  );
}

export default DoctorCard;
