/**
 * ScheduleWeek — the TWO renderings of one week of availability.
 *
 * THE RESPONSIVE BUG THIS FIXES
 * -----------------------------
 * The pre-refactor schedule manager drew a single week grid with a hard
 * `min-width: 880px`. On a 375px phone that is a 2.3x horizontal scroll, which
 * in practice means a doctor cannot set their hours on the device they actually
 * carry. A calendar is the right shape for a week when there is room for seven
 * columns and the wrong shape when there is not — so this module ships both, and
 * the page picks by breakpoint with plain Tailwind (`hidden md:block` /
 * `md:hidden`). No JS media query, no layout thrash, nothing to get out of sync:
 * BOTH read the same `week` array and open the same editor.
 *
 * HOW A "BREAK" IS MODELLED (and why it looks odd)
 * -----------------------------------------------
 * The backend does not store breaks as rows. Each EXTRA shift in a day stores
 * the PREVIOUS shift's end as `break_start_time`, its own start as
 * `break_end_time`, and a `break_name` (default 'Break'). A break is therefore
 * literally the gap between two shifts, and the slot generator skips it. So the
 * editor's unit is a SHIFT, and the second shift onward carries the name of the
 * gap in front of it. Anything else would let a doctor create a break that no
 * shift bounds — which the backend has nowhere to put.
 */

import React from 'react';
import { Coffee, Moon, Pencil } from 'lucide-react';

import { Badge, Button } from '../../../components/ui';
import { cn } from '../../../lib/cn';

/** Monday-first, because a working week is read Monday-first. */
export const DAYS = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

const SHORT = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
};

/** The visible window of the calendar. Clinics outside it still render, clamped. */
const TRACK_START = 6 * 60; // 06:00
const TRACK_END = 22 * 60; // 22:00
const TRACK_SPAN = TRACK_END - TRACK_START;

/** 'HH:MM' -> minutes past midnight. Returns null for '' / null / nonsense. */
export function toMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** 12-hour label for a 'HH:MM' string; the raw value is kept if unparseable. */
export function formatClock(value) {
  const total = toMinutes(value);
  if (total === null) return value || '—';
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const suffix = hours >= 12 ? 'pm' : 'am';
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${String(minutes).padStart(2, '0')}${suffix}`;
}

/** Total bookable minutes in a day, breaks excluded (they are the gaps). */
export function dayMinutes(day) {
  if (!day || day.off) return 0;
  return (day.shifts || []).reduce((total, shift) => {
    const start = toMinutes(shift.start);
    const end = toMinutes(shift.end);
    if (start === null || end === null || end <= start) return total;
    return total + (end - start);
  }, 0);
}

function humanDuration(minutes) {
  if (!minutes) return '0h';
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

/* ========================================================================== */
/* WeekCalendar — md and up                                                   */
/* ========================================================================== */

function ShiftBlock({ shift, index }) {
  const start = toMinutes(shift.start);
  const end = toMinutes(shift.end);
  if (start === null || end === null || end <= start) return null;

  const top = ((Math.max(start, TRACK_START) - TRACK_START) / TRACK_SPAN) * 100;
  const height = ((Math.min(end, TRACK_END) - Math.max(start, TRACK_START)) / TRACK_SPAN) * 100;
  if (height <= 0) return null;

  return (
    <div
      className={cn(
        'absolute inset-x-1 overflow-hidden rounded-field border px-1.5 py-1',
        'border-primary-300 bg-primary-100 text-primary-900',
      )}
      style={{ top: `${top}%`, height: `${Math.max(height, 4)}%` }}
    >
      <span className="block truncate font-numeric text-[0.6875rem] leading-tight">
        {formatClock(shift.start)}
      </span>
      <span className="block truncate text-[0.6875rem] leading-tight opacity-80">
        {formatClock(shift.end)}
      </span>
      <span className="ui-sr-only">
        Shift {index + 1}: {shift.start} to {shift.end}
      </span>
    </div>
  );
}

function BreakBlock({ previous, shift }) {
  const start = toMinutes(previous?.end);
  const end = toMinutes(shift?.start);
  if (start === null || end === null || end <= start) return null;

  const top = ((Math.max(start, TRACK_START) - TRACK_START) / TRACK_SPAN) * 100;
  const height = ((Math.min(end, TRACK_END) - Math.max(start, TRACK_START)) / TRACK_SPAN) * 100;
  if (height <= 0) return null;

  return (
    <div
      className="absolute inset-x-1 overflow-hidden rounded-field border border-dashed border-warning-300 bg-warning-50 px-1.5"
      style={{ top: `${top}%`, height: `${Math.max(height, 3)}%` }}
      title={`${shift.break_name || 'Break'} ${previous.end}–${shift.start}`}
    >
      <span className="block truncate text-[0.625rem] leading-tight text-warning-700">
        {shift.break_name || 'Break'}
      </span>
    </div>
  );
}

/**
 * @param {object} props
 * @param {Array<{day:string, off:boolean, shifts:Array}>} props.week
 * @param {(day: string) => void} props.onEditDay
 */
export function WeekCalendar({ week, onEditDay }) {
  const hours = [];
  for (let minute = TRACK_START; minute <= TRACK_END; minute += 120) hours.push(minute);

  return (
    <div className="rounded-card border border-subtle bg-surface p-3">
      <div className="grid grid-cols-[2.75rem_repeat(7,minmax(0,1fr))] gap-x-1">
        {/* header row */}
        <div aria-hidden="true" />
        {DAYS.map((name) => {
          const day = week.find((entry) => entry.day === name);
          return (
            <div key={name} className="pb-2 text-center">
              <p className="text-label-sm text-default">{SHORT[name]}</p>
              <p className="text-[0.625rem] text-muted">
                {day?.off ? 'Closed' : humanDuration(dayMinutes(day))}
              </p>
            </div>
          );
        })}

        {/* hour gutter */}
        <div className="relative h-72">
          {hours.map((minute) => (
            <span
              key={minute}
              className="absolute right-1 -translate-y-1/2 font-numeric text-[0.625rem] text-subtle"
              style={{ top: `${((minute - TRACK_START) / TRACK_SPAN) * 100}%` }}
            >
              {formatClock(`${String(Math.floor(minute / 60)).padStart(2, '0')}:00`)}
            </span>
          ))}
        </div>

        {/* day columns */}
        {DAYS.map((name) => {
          const day = week.find((entry) => entry.day === name) || { day: name, off: true, shifts: [] };
          const shifts = day.off ? [] : (day.shifts || []);
          return (
            <button
              key={name}
              type="button"
              onClick={() => onEditDay(name)}
              aria-label={`Edit ${name}`}
              className={cn(
                'relative h-72 rounded-field border border-subtle transition-colors',
                'outline-none focus-visible:ring-2 focus-visible:ring-focus',
                day.off ? 'bg-surface-sunken hover:bg-neutral-100' : 'bg-canvas hover:border-primary-300',
              )}
            >
              {/* gridlines */}
              {hours.map((minute) => (
                <span
                  key={minute}
                  aria-hidden="true"
                  className="absolute inset-x-0 border-t border-subtle/60"
                  style={{ top: `${((minute - TRACK_START) / TRACK_SPAN) * 100}%` }}
                />
              ))}

              {day.off && (
                <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-subtle">
                  <Moon className="h-4 w-4" aria-hidden="true" />
                  <span className="text-[0.625rem]">Day off</span>
                </span>
              )}

              {shifts.map((shift, index) => (
                <React.Fragment key={`${name}-${index}`}>
                  {index > 0 && <BreakBlock previous={shifts[index - 1]} shift={shift} />}
                  <ShiftBlock shift={shift} index={index} />
                </React.Fragment>
              ))}
            </button>
          );
        })}
      </div>

      <p className="mt-3 text-caption text-muted">
        Select a day to change its hours. Dashed blocks are breaks, and the slot generator skips them.
      </p>
    </div>
  );
}

/* ========================================================================== */
/* DayAgenda — below md                                                       */
/* ========================================================================== */

/**
 * @param {object} props
 * @param {Array<{day:string, off:boolean, shifts:Array}>} props.week
 * @param {(day: string) => void} props.onEditDay
 */
export function DayAgenda({ week, onEditDay }) {
  return (
    <ul className="flex flex-col gap-2">
      {DAYS.map((name) => {
        const day = week.find((entry) => entry.day === name) || { day: name, off: true, shifts: [] };
        const shifts = day.off ? [] : (day.shifts || []);
        return (
          <li key={name}>
            <div
              className={cn(
                'flex flex-wrap items-start gap-3 rounded-card border p-3',
                day.off ? 'border-subtle bg-surface-sunken' : 'border-subtle bg-surface',
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-heading text-heading-sm text-default">{name}</p>
                  {day.off ? (
                    <Badge tone="neutral" variant="soft" size="sm">Day off</Badge>
                  ) : (
                    <Badge tone="primary" variant="soft" size="sm">
                      {humanDuration(dayMinutes(day))} bookable
                    </Badge>
                  )}
                </div>

                {day.off ? (
                  <p className="mt-1 text-caption text-muted">No appointments can be booked.</p>
                ) : shifts.length ? (
                  <ul className="mt-2 flex flex-col gap-1.5">
                    {shifts.map((shift, index) => (
                      <React.Fragment key={`${name}-${index}`}>
                        {index > 0 && (
                          <li className="flex items-center gap-2 pl-1 text-caption text-warning-700">
                            <Coffee className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            {shift.break_name || 'Break'}
                            {' · '}
                            {formatClock(shifts[index - 1].end)}–{formatClock(shift.start)}
                          </li>
                        )}
                        <li className="flex items-center gap-2 rounded-field bg-primary-50 px-2 py-1 text-body-sm text-primary-900">
                          <span className="font-numeric">
                            {formatClock(shift.start)} – {formatClock(shift.end)}
                          </span>
                        </li>
                      </React.Fragment>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-caption text-muted">No hours set, so nothing is bookable.</p>
                )}
              </div>

              <Button
                size="sm"
                variant="outline"
                leftIcon={<Pencil className="h-3.5 w-3.5" />}
                onClick={() => onEditDay(name)}
              >
                Edit
              </Button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default WeekCalendar;
