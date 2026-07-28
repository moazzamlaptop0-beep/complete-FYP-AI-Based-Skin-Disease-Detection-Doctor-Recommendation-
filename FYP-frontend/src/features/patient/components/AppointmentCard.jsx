/**
 * AppointmentCard — one visit, with everything you can do to it.
 *
 * WHY A CARD AND NOT A TABLE ROW
 * ------------------------------
 * An appointment is not tabular: it carries a doctor identity, a conflict state,
 * a cancellation reason, a fee, a linked scan and up to four actions. The old
 * dashboard forces all of that into a fixed-width table that scrolls sideways on
 * a phone, so the actions — the only reason to open the page — are the first
 * thing to fall off the screen. Here the actions are always the last row and
 * always visible.
 *
 * THE THREE STATES THAT NEED WORDS, NOT JUST A BADGE
 * -------------------------------------------------
 *  Pending-Conflict  two bookings hold the same slot; a doctor resolves it.
 *                    'is_conflict' is derived server-side from exactly this.
 *  Reassigned        the doctor moved you off; `suggested_slots` is recomputed
 *                    live by the backend and is the fastest route back in.
 *  Cancelled         `cancellation_reason` is the whole story and is otherwise
 *                    invisible in the current UI.
 */

import React from 'react';
import { AlertTriangle, CalendarClock, CalendarX2, Repeat, Star, Stethoscope } from 'lucide-react';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  Card,
  SeverityBadge,
  StatusBadge,
} from '../../../components/ui';

import { resolveImageUrl } from '../../../lib/imageUrl';

import { formatDate, formatFee, formatRelative, isClosed } from '../lib/format';

/**
 * `doctor_profile.profile_image` is a '/'-prefixed path on the API ORIGIN, not
 * on the app's. Rendering it raw asks the Vite dev server for it and gets an
 * HTML 404 back — the bug `resolveImageUrl` exists to stop.
 */
function doctorImage(appointment) {
  return resolveImageUrl(appointment?.doctor_profile?.profile_image) || undefined;
}

export function AppointmentCard({
  appointment,
  onCancel,
  onReschedule,
  onRebook,
  onRate,
  onOpenScan,
}) {
  const status = appointment.status || 'Scheduled';
  const closed = isClosed(status);
  const conflict = Boolean(appointment.is_conflict) || status === 'Pending-Conflict';
  const completed = status === 'Completed';
  const cancelled = status === 'Cancelled';
  const rated = Boolean(appointment.patient_rating ?? appointment.rating);

  const date = appointment.slot_date || appointment.date;
  const time = appointment.slot_time || appointment.time;
  const fee = formatFee(appointment.fees?.pkr);
  const suggested = Array.isArray(appointment.suggested_slots) ? appointment.suggested_slots : [];

  return (
    <Card padding="none" className="overflow-hidden">
      <div className="flex flex-col gap-4 p-4">
        {/* ------------------------------------------------------------ head -- */}
        <div className="flex items-start gap-3">
          <Avatar
            src={doctorImage(appointment)}
            name={appointment.doctor_name || 'Expert'}
            size="md"
            className="shrink-0"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-label-lg text-default">
              {appointment.doctor_name || 'Expert'}
            </p>
            <p className="truncate font-body text-body-sm text-muted">
              {appointment.doctor_profile?.specialty || 'Dermatology'}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <StatusBadge status={status} size="sm" />
            {appointment.severity && <SeverityBadge severity={appointment.severity} size="sm" />}
          </div>
        </div>

        {/* ------------------------------------------------------------ when -- */}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="flex items-center gap-1.5 font-numeric text-label-lg tabular-nums text-default">
            <CalendarClock className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            {formatDate(date)}
            {time ? ` · ${time}` : ''}
          </p>
          {!closed && date && (
            <span className="font-body text-body-sm text-muted">
              {formatRelative(`${date}${time ? ` ${time}` : ''}`)}
            </span>
          )}
          {appointment.duration && (
            <Badge tone="neutral" variant="outline" size="sm">{appointment.duration}</Badge>
          )}
          {fee && <Badge tone="neutral" size="sm">{fee}</Badge>}
        </div>

        {/* ------------------------------------------------------------ scan -- */}
        {appointment.scan_id && (
          <button
            type="button"
            onClick={() => onOpenScan?.(appointment)}
            className={[
              'flex w-full items-center gap-2 rounded-card border border-subtle bg-surface-sunken p-2.5 text-left',
              'outline-none transition-colors hover:border-default',
              'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
            ].join(' ')}
          >
            <Stethoscope className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
            <span className="min-w-0 flex-1 truncate font-body text-body-sm text-default">
              {appointment.disease || appointment.scan_info?.disease || `Scan #${appointment.scan_id}`}
            </span>
            <span className="shrink-0 font-body text-caption text-muted">View scan</span>
          </button>
        )}

        {/* --------------------------------------------------------- notices -- */}
        {conflict && (
          <Alert
            tone="warning"
            title="Two bookings, one slot"
            icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
          >
            Another patient booked this time as well. Your doctor decides who keeps it, and you will
            be emailed either way. You can cancel now and free it up, or wait.
          </Alert>
        )}

        {status === 'Reassigned' && (
          <Alert tone="info" title="Your doctor moved this appointment">
            {suggested.length > 0 ? (
              <>
                The next free times with them are{' '}
                {suggested.map((slot, index) => (
                  <span key={`${slot.date}-${slot.time}`} className="font-numeric tabular-nums">
                    {index > 0 ? ', ' : ''}
                    {formatDate(slot.date)} at {slot.time}
                  </span>
                ))}
                . Use “Book again” to take one.
              </>
            ) : (
              'Use “Book again” to choose a new time with the same doctor.'
            )}
          </Alert>
        )}

        {cancelled && appointment.cancellation_reason && (
          <p className="rounded-card border border-subtle bg-surface-sunken p-2.5 font-body text-body-sm text-muted">
            <span className="text-default">Reason: </span>
            {appointment.cancellation_reason}
          </p>
        )}

        {rated && (
          <p className="flex items-center gap-1.5 font-body text-body-sm text-muted">
            <Star className="h-4 w-4 fill-warning-400 text-warning-500" aria-hidden="true" />
            You rated this visit {appointment.patient_rating ?? appointment.rating} out of 5.
          </p>
        )}
      </div>

      {/* -------------------------------------------------------- actions -- */}
      <div className="flex flex-wrap items-center gap-2 border-t border-subtle bg-surface-sunken px-4 py-3">
        {!closed && (
          <>
            <Button
              size="sm"
              variant="outline"
              leftIcon={<Repeat className="h-4 w-4" />}
              onClick={() => onReschedule?.(appointment)}
            >
              Reschedule
            </Button>
            <Button
              size="sm"
              variant="ghost"
              leftIcon={<CalendarX2 className="h-4 w-4" />}
              onClick={() => onCancel?.(appointment)}
            >
              Cancel
            </Button>
          </>
        )}

        {closed && (
          <Button
            size="sm"
            variant="outline"
            leftIcon={<Repeat className="h-4 w-4" />}
            onClick={() => onRebook?.(appointment)}
          >
            Book again
          </Button>
        )}

        {completed && (
          <Button
            size="sm"
            variant={rated ? 'ghost' : 'primary'}
            leftIcon={<Star className="h-4 w-4" />}
            onClick={() => onRate?.(appointment)}
          >
            {rated ? 'Change rating' : 'Rate your doctor'}
          </Button>
        )}
      </div>
    </Card>
  );
}

export default AppointmentCard;
