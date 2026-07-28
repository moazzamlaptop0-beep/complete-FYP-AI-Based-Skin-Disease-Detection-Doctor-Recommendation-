/* eslint-disable react-refresh/only-export-components --
   dateInRange/hasDateRange/presetRange ship WITH the component so the filter
   and the filtering can never disagree; the same pattern (and trade-off) as
   Pagination's buildPageRange and Badge's preset exports. */
import React, { useId } from 'react';
import { cn } from '../../lib/cn';
import { controlBase } from './Input';

/**
 * DateRangeFilter — a controlled day-range picker for filtering lists.
 *
 * The value is `{from, to}` where each side is a 'YYYY-MM-DD' string or null.
 * Quick presets (Today / This week / This month / All time) sit next to native
 * date inputs so the common cases are one click and the odd ones stay possible.
 * The component owns no state: every interaction calls `onChange` with the next
 * `{from, to}` and the parent decides what to do with it.
 *
 * Pair it with `dateInRange(date, range)` to apply the filter: an EMPTY range
 * matches everything, and so does an UNPARSEABLE date, because hiding a row we
 * cannot date is worse than showing it (the same rule isUpcoming() follows).
 *
 * @param {object} props
 * @param {{from: string|null, to: string|null}} props.value Controlled range.
 * @param {(next: {from: string|null, to: string|null}) => void} props.onChange
 * @param {string} [props.label='Filter by date'] Group label, visible.
 * @param {string} [props.className]
 */

const EMPTY_RANGE = Object.freeze({ from: null, to: null });

function pad2(number) {
  return String(number).padStart(2, '0');
}

/** 'YYYY-MM-DD' in the LOCAL timezone (toISOString would drift near midnight). */
function isoDay(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** A 'YYYY-MM-DD' bound as a local Date at the start or end of that day. */
function dayBoundary(text, endOfDay) {
  if (!text || typeof text !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Is any bound set at all? An empty range means "no filter". */
export function hasDateRange(range) {
  return Boolean(range && (range.from || range.to));
}

/**
 * Does `date` fall inside `range` (inclusive of both whole days)?
 * Total on purpose: an empty range matches everything, and a null/invalid date
 * is treated as IN range, so callers never silently hide rows they cannot date.
 * @param {Date|null} date
 * @param {{from?: string|null, to?: string|null}|null|undefined} range
 * @returns {boolean}
 */
export function dateInRange(date, range) {
  if (!hasDateRange(range)) return true;
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return true;
  const from = dayBoundary(range.from, false);
  const to = dayBoundary(range.to, true);
  if (from && date.getTime() < from.getTime()) return false;
  if (to && date.getTime() > to.getTime()) return false;
  return true;
}

/** The `{from, to}` a preset pill applies. Exported for tests. */
export function presetRange(key, now = new Date()) {
  switch (key) {
    case 'today': {
      const day = isoDay(now);
      return { from: day, to: day };
    }
    case 'week': {
      // Monday to Sunday of the current calendar week.
      const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { from: isoDay(monday), to: isoDay(sunday) };
    }
    case 'month': {
      return {
        from: isoDay(new Date(now.getFullYear(), now.getMonth(), 1)),
        to: isoDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
      };
    }
    default:
      return { from: null, to: null };
  }
}

const PRESETS = [
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'all', label: 'All time' },
];

const dateInputClass = cn(
  controlBase,
  'h-9 px-3 font-body text-body-sm',
  'w-full min-w-0 sm:w-40',
);

export function DateRangeFilter({ value, onChange, label = 'Filter by date', className }) {
  const range = value && typeof value === 'object' ? value : EMPTY_RANGE;
  const uid = useId();
  const fromId = `${uid}-from`;
  const toId = `${uid}-to`;
  const active = hasDateRange(range);

  const emit = (next) => onChange?.({ from: next.from || null, to: next.to || null });

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex flex-col gap-3 rounded-field border border-subtle bg-surface p-3',
        'lg:flex-row lg:flex-wrap lg:items-center',
        className,
      )}
    >
      <span aria-hidden="true" className="shrink-0 font-body text-label-sm text-muted">
        {label}
      </span>

      {/* Preset pills. `aria-pressed` carries the active state for AT; the
          gradient carries it visually and reads on both themes (the dark stops
          resolve to the same physical colors, so white text stays safe). */}
      <div className="flex flex-wrap items-center gap-1.5">
        {PRESETS.map((preset) => {
          const presetValue = presetRange(preset.key);
          const selected = preset.key === 'all'
            ? !active
            : active && range.from === presetValue.from && range.to === presetValue.to;
          return (
            <button
              key={preset.key}
              type="button"
              aria-pressed={selected}
              onClick={() => emit(presetValue)}
              className={cn(
                'rounded-pill px-3 py-1 font-body text-caption font-medium',
                'outline-none transition-colors focus-visible:ring-2 focus-visible:ring-focus',
                'focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
                selected
                  ? 'bg-gradient-to-r from-primary-600 to-accent-700 text-white shadow-soft dark:from-primary-400 dark:to-accent-300'
                  : 'bg-surface-sunken text-muted hover:text-default',
              )}
            >
              {preset.label}
            </button>
          );
        })}
      </div>

      {/* Explicit bounds. min/max keep from <= to at the control level, so the
          pair can never describe a range that matches nothing by accident. */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="flex items-center gap-2">
          <label htmlFor={fromId} className="w-10 shrink-0 font-body text-caption text-muted sm:w-auto">
            From
          </label>
          <input
            id={fromId}
            type="date"
            value={range.from || ''}
            max={range.to || undefined}
            onChange={(event) => emit({ ...range, from: event.target.value || null })}
            className={dateInputClass}
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={toId} className="w-10 shrink-0 font-body text-caption text-muted sm:w-auto">
            To
          </label>
          <input
            id={toId}
            type="date"
            value={range.to || ''}
            min={range.from || undefined}
            onChange={(event) => emit({ ...range, to: event.target.value || null })}
            className={dateInputClass}
          />
        </div>
      </div>

      {active && (
        <button
          type="button"
          onClick={() => emit(EMPTY_RANGE)}
          className={cn(
            'inline-flex w-fit items-center gap-1.5 rounded-pill px-2.5 py-1 font-body text-caption text-muted',
            'outline-none transition-colors hover:bg-surface-sunken hover:text-default',
            'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
          )}
        >
          <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3 w-3">
            <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          Clear dates
        </button>
      )}
    </div>
  );
}

export default DateRangeFilter;
