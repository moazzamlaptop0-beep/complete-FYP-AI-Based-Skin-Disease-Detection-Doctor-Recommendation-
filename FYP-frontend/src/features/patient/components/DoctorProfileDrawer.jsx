/**
 * DoctorProfileDrawer — the full picture of one doctor before you commit.
 *
 * The directory payload already carries the schedule and the fees, so the only
 * thing worth a round trip is the review list (`GET /doctor/ratings/<id>` —
 * PUBLIC, and note its wrapper keys are `average_rating`/`rating_count`, unlike
 * the doctor's own `/api/doctor/ratings` which uses `average`/`total`).
 *
 * THE WEEK IS RENDERED IN WEEK ORDER
 * ----------------------------------
 * `schedule` comes back in whatever order the availability rows were inserted —
 * the contract is explicit that it is NOT Monday→Sunday and that callers must
 * `.find()` by day name. Printing it raw gives patients a week that starts on
 * Thursday.
 */

import React from 'react';
import { CalendarPlus, Mail, Phone, Star } from 'lucide-react';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Drawer,
  SkeletonText,
} from '../../../components/ui';
import { get } from '../../../lib/api';
import { ratings as ratingEndpoints } from '../../../lib/endpoints';

import { useResource } from '../hooks/usePatientData';
import { doctorPhotoUrl, realValue } from '../lib/doctorDisplay';
import { formatFee } from '../lib/format';
import { RatingSummary } from './DoctorCard';

const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

function ScheduleTable({ schedule }) {
  const rows = Array.isArray(schedule) ? schedule : [];
  if (rows.length === 0) {
    return (
      <p className="font-body text-body-sm text-muted">
        This doctor has not published their hours yet. You can still offer times when you send a
        request. They simply confirm or decline.
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {WEEK.map((day) => {
        // .find() by NAME: the array is not in week order.
        const entry = rows.find((row) => String(row.day).toLowerCase() === day.toLowerCase());
        const open = entry && entry.available !== false;
        return (
          <li
            key={day}
            className="flex items-baseline justify-between gap-3 border-b border-subtle py-1.5 last:border-b-0"
          >
            <span className="font-body text-body-sm text-default">{day}</span>
            <span className="font-numeric text-body-sm tabular-nums text-muted">
              {open ? `${entry.start} – ${entry.end}` : 'Closed'}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * @param {object} props
 * @param {object|null} props.doctor A `/api/doctors/public` row.
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {(doctor: object) => void} props.onBook
 * @param {string} [props.bookLabel] The footer button's text. The panel is also
 *   opened from the request-reassign picker, where the action adds this doctor to
 *   a request rather than booking a slot — and a button that says "Book" there
 *   would promise an appointment the patient is not making.
 */
export function DoctorProfileDrawer({
  doctor,
  open,
  onClose,
  onBook,
  bookLabel = 'Book with this doctor',
}) {
  const doctorId = doctor?.id ?? null;

  const { data, loading, error } = useResource(
    (signal) => get(ratingEndpoints.publicForDoctor(doctorId), { signal }),
    { deps: [doctorId], enabled: Boolean(doctorId && open), initialData: null },
  );

  if (!doctor) return null;

  const reviews = Array.isArray(data?.reviews) ? data.reviews : [];
  const city = realValue(doctor.city);
  const hospital = realValue(doctor.hospital);
  const phone = realValue(doctor.phone);
  const feePkr = formatFee(doctor.fees?.pkr);
  const feeUsd = formatFee(doctor.fees?.usd, 'USD');

  return (
    <Drawer
      open={open}
      onClose={onClose}
      side="right"
      size="md"
      title={doctor.name}
      description={doctor.specialty || doctor.specialization || 'Skin Specialist'}
      footer={
        <Button
          fullWidth
          leftIcon={<CalendarPlus className="h-4 w-4" />}
          onClick={() => onBook?.(doctor)}
        >
          {bookLabel}
        </Button>
      }
    >
      <div className="flex flex-col gap-6">
        {/* ------------------------------------------------------------ head -- */}
        <div className="flex items-center gap-4">
          <Avatar src={doctorPhotoUrl(doctor)} name={doctor.name} size="xl" />
          <div className="min-w-0">
            <RatingSummary doctor={doctor} />
            <p className="mt-1 font-body text-body-sm text-muted">
              {doctor.experience > 0
                ? `${doctor.experience} ${doctor.experience === 1 ? 'year' : 'years'} of experience`
                : 'Experience not published'}
            </p>
          </div>
        </div>

        {/* --------------------------------------------------------- contact -- */}
        <section>
          <h3 className="mb-2 font-heading text-label-lg text-default">Clinic</h3>
          <dl className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="font-body text-body-sm text-muted">Practice</dt>
              <dd className="text-right font-body text-body-sm text-default">
                {hospital || 'Not published'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="font-body text-body-sm text-muted">City</dt>
              <dd className="text-right font-body text-body-sm text-default">
                {city || 'Not published'}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="font-body text-body-sm text-muted">Consultation fee</dt>
              <dd className="text-right font-body text-body-sm text-default">
                {feePkr || feeUsd
                  ? [feePkr, feeUsd].filter(Boolean).join(' · ')
                  : 'Not published'}
                {doctor.fees?.duration ? (
                  <span className="text-muted"> / {doctor.fees.duration}</span>
                ) : null}
              </dd>
            </div>
          </dl>

          <div className="mt-3 flex flex-wrap gap-2">
            {phone && (
              <Button
                as="a"
                href={`tel:${phone}`}
                size="sm"
                variant="outline"
                leftIcon={<Phone className="h-4 w-4" />}
              >
                {phone}
              </Button>
            )}
            {doctor.email && (
              <Button
                as="a"
                href={`mailto:${doctor.email}`}
                size="sm"
                variant="ghost"
                leftIcon={<Mail className="h-4 w-4" />}
              >
                Email
              </Button>
            )}
          </div>
          {!phone && (
            <p className="mt-2 font-body text-caption text-muted">
              No phone number is published for this doctor. Booking through the app is the reliable
              way to reach them.
            </p>
          )}
        </section>

        {/* -------------------------------------------------------- schedule -- */}
        <section>
          <h3 className="mb-2 font-heading text-label-lg text-default">Weekly hours</h3>
          <ScheduleTable schedule={doctor.schedule} />
        </section>

        {/* --------------------------------------------------------- reviews -- */}
        <section>
          <h3 className="mb-2 font-heading text-label-lg text-default">
            Reviews {reviews.length > 0 ? `(${reviews.length})` : ''}
          </h3>

          {loading && <SkeletonText lines={4} />}

          {!loading && error && (
            <Alert tone="warning">Reviews could not be loaded right now.</Alert>
          )}

          {!loading && !error && reviews.length === 0 && (
            <p className="font-body text-body-sm text-muted">
              No written reviews yet.
            </p>
          )}

          {!loading && !error && reviews.length > 0 && (
            <ul className="flex flex-col gap-3">
              {reviews.map((review) => (
                <li key={review.id} className="rounded-card border border-subtle bg-surface-sunken p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-body text-label-md text-default">
                      {review.patient_name || 'A patient'}
                    </span>
                    <Badge tone="neutral" size="sm" icon={<Star className="h-3 w-3" aria-hidden="true" />}>
                      {review.rating}
                    </Badge>
                  </div>
                  {review.review && (
                    <p className="mt-1.5 font-body text-body-sm text-default">{review.review}</p>
                  )}
                  {review.date && (
                    <p className="mt-1 font-body text-caption text-muted">{review.date}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Drawer>
  );
}

export default DoctorProfileDrawer;
