/**
 * SlotPicker — pick a date, then a free time, for ONE doctor.
 *
 * `GET /api/slots/<doctor_id>?date=YYYY-MM-DD` answers with a BARE ARRAY of
 * `{time, status, duration}` where status is 'available' | 'booked'
 * (lib/api.js normalises the bare-array break in the envelope contract, so this
 * component just sees an array).
 *
 * TWO THINGS THIS GETS RIGHT THAT THE OLD BOOKING UI DID NOT
 * ----------------------------------------------------------
 * 1. Booked times are RENDERED, disabled, rather than filtered out. "3pm is
 *    taken" and "the clinic does not open at 3pm" are different facts, and a
 *    patient who cannot tell them apart keeps trying the same day.
 * 2. `date` is required by the backend (400 without it) and is built from the
 *    LOCAL calendar day — `toISOString().slice(0,10)` is a day behind for anyone
 *    west of UTC after 00:00 local, which silently offers yesterday's slots.
 */

import React, { useMemo } from 'react';
import { CalendarX2 } from 'lucide-react';

import {
  Alert,
  Field,
  Input,
  Skeleton,
  cn,
} from '../../../components/ui';
import { get } from '../../../lib/api';
import { schedule as scheduleEndpoints } from '../../../lib/endpoints';

import { useResource } from '../hooks/usePatientData';
import { todayIso } from '../lib/format';

/**
 * @param {object} props
 * @param {number|string|null} props.doctorId
 * @param {string} props.date 'YYYY-MM-DD'
 * @param {(date: string) => void} props.onDateChange
 * @param {string} props.time Selected 'HH:MM', or ''.
 * @param {(time: string) => void} props.onTimeChange
 * @param {string} [props.dateLabel]
 * @param {number} [props.daysAhead=60] How far the date input may reach.
 */
export function SlotPicker({
  doctorId,
  date,
  onDateChange,
  time,
  onTimeChange,
  dateLabel = 'Date',
  daysAhead = 60,
}) {
  const enabled = Boolean(doctorId && date);

  const { data, loading, error } = useResource(
    (signal) => get(scheduleEndpoints.slots(doctorId, date), { signal }),
    { deps: [doctorId, date], enabled, initialData: [] },
  );

  const slots = useMemo(() => (Array.isArray(data) ? data : []), [data]);
  const available = slots.filter((slot) => slot.status !== 'booked');

  return (
    <div className="flex flex-col gap-3">
      <Field label={dateLabel} required>
        <Input
          type="date"
          value={date}
          min={todayIso()}
          max={todayIso(daysAhead)}
          onChange={(event) => {
            onDateChange(event.target.value);
            // A time from the previous day is never valid on the new one.
            onTimeChange('');
          }}
        />
      </Field>

      <fieldset className="min-w-0">
        <legend className="mb-2 font-body text-label-md text-default">
          Time
          <span aria-hidden="true" className="ml-0.5 text-danger-600">*</span>
        </legend>

        {!enabled && (
          <p className="font-body text-body-sm text-muted">Pick a date to see the free times.</p>
        )}

        {enabled && loading && (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: 8 }).map((_, index) => (
              <Skeleton key={index} shape="rect" height={38} />
            ))}
          </div>
        )}

        {enabled && !loading && error && (
          <Alert tone="danger" title="We could not load the times">{error}</Alert>
        )}

        {enabled && !loading && !error && slots.length === 0 && (
          <div className="flex items-start gap-2 rounded-card border border-dashed border-subtle p-3">
            <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0 text-subtle" aria-hidden="true" />
            <p className="font-body text-body-sm text-muted">
              This doctor has no hours on that day. Try another date.
            </p>
          </div>
        )}

        {enabled && !loading && !error && slots.length > 0 && (
          <>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" role="radiogroup" aria-label="Available times">
              {slots.map((slot) => {
                const booked = slot.status === 'booked';
                const selected = time === slot.time;
                return (
                  <button
                    key={slot.time}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={booked}
                    onClick={() => onTimeChange(slot.time)}
                    className={cn(
                      'rounded-control border px-2 py-2 font-numeric text-body-sm tabular-nums outline-none transition-colors',
                      'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
                      booked && 'cursor-not-allowed border-subtle bg-surface-sunken text-subtle line-through',
                      !booked && selected && 'border-primary-600 bg-primary-600 text-white',
                      !booked && !selected && 'border-subtle bg-surface text-default hover:border-default',
                    )}
                  >
                    {slot.time}
                    <span className="ui-sr-only">{booked ? ' (already booked)' : ''}</span>
                  </button>
                );
              })}
            </div>
            {available.length === 0 && (
              <p className="mt-2 font-body text-body-sm text-muted">
                Every time on that day is taken. Try another date.
              </p>
            )}
          </>
        )}
      </fieldset>
    </div>
  );
}

export default SlotPicker;
