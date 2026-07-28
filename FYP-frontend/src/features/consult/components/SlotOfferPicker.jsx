/**
 * SlotOfferPicker — the date strip plus one chip grid per doctor, controlled.
 *
 * WHY IT IS ITS OWN COMPONENT
 * --------------------------
 * "Offer up to five times across up to three doctors" happens in TWO places that
 * share nothing else: StepSlots inside the consult stepper, and the patient's
 * requests page, where an Open request is edited or a withdrawn one is re-sent.
 * The rules it encodes are not cosmetic — a bare "09:30" chip is ambiguous once
 * more than one doctor is involved, anything the server did not explicitly call
 * `available` is treated as taken, and the `max` ceiling has to disable the
 * chips rather than silently drop the sixth pick. Two copies of that would drift.
 *
 * CONTROLLED, AND IT OWNS EXACTLY ONE THING
 * -----------------------------------------
 * `picks` comes from the parent (the stepper keeps them in its reducer, the edit
 * dialog in local state) and the only state here is which DATE is on screen,
 * which nothing outside needs to know. `useMultiSlots` memoises per date, so
 * walking the strip does not re-hit the API.
 *
 * THE LEGEND IS NOT DECORATION
 * ----------------------------
 * A chip grid has three states and two of them are conveyed partly by colour
 * (chosen, free, taken). Colour alone fails WCAG 1.4.1, so a taken chip is also
 * struck through, a chosen chip also carries its rank as a digit, and the legend
 * names all three in words above the grids. That is what lets someone who cannot
 * tell the blue chip from the grey one still read the grid.
 *
 * COLOUR CONTRACT
 * ---------------
 * The selected date is the one place on this screen that earns the brand
 * gradient, and it uses the measured both-theme recipe (`primary-600 -> accent-700`
 * light, `primary-400 -> accent-300` dark, which resolve to the SAME two physical
 * colours) so white stays AA on it in either theme. The chosen chips are a solid
 * `primary-600` fill and therefore carry the sanctioned `dark:text-primary-50`
 * twin instead of plain white, which would drop to 3.0:1 on dark. Focus rings are
 * the standard OUTSIDE ring: an inset `ring-focus` on a gradient is the same
 * colour as the gradient's first stop and would be invisible.
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  CalendarX,
  RefreshCw,
} from 'lucide-react';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  EmptyState,
  Skeleton,
  SkeletonGroup,
  cn,
} from '../../../components/ui';
import { formatTime } from '../../../lib/format';
import { resolveImageUrl } from '../../../lib/imageUrl';
import { slotKey } from '../consultReducer';
import { useMultiSlots } from '../hooks/useMultiSlots';
import { buildDateStrip, friendlyDate, todayISO } from '../lib/slotDates';

/** The one measured white-on-gradient recipe in this app. */
const BRAND_FILL =
  'bg-gradient-to-br from-primary-600 to-accent-700 dark:from-primary-400 dark:to-accent-300';

/**
 * The 14-day strip, as a real radio group: one tab stop, arrow keys to move,
 * Home/End to jump. Fourteen individually tabbable buttons would put fourteen
 * stops between the explainer and the times themselves.
 */
function DateStrip({ dates, value, onChange, markedDates }) {
  const listRef = useRef(null);

  const focusIndex = useCallback((index) => {
    const clamped = Math.max(0, Math.min(dates.length - 1, index));
    onChange(dates[clamped].iso);
    const node = listRef.current?.querySelectorAll('[role="radio"]')[clamped];
    node?.focus();
    node?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [dates, onChange]);

  const handleKeyDown = useCallback((event, index) => {
    const deltas = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (event.key in deltas) {
      event.preventDefault();
      focusIndex(index + deltas[event.key]);
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      focusIndex(0);
    }
    if (event.key === 'End') {
      event.preventDefault();
      focusIndex(dates.length - 1);
    }
  }, [dates.length, focusIndex]);

  return (
    <div
      ref={listRef}
      role="radiogroup"
      aria-label="Choose a date"
      className="ui-scrollbar -mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2 pt-1"
    >
      {dates.map((date, index) => {
        const selected = date.iso === value;
        const marked = markedDates.has(date.iso);
        return (
          <button
            key={date.iso}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={date.label}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(date.iso)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'relative flex w-[4.5rem] shrink-0 snap-start flex-col items-center gap-0.5',
              'rounded-field border px-2 pb-3 pt-2 outline-none',
              'transition-[background-color,border-color,box-shadow,transform] duration-150 ease-emphasized',
              'motion-reduce:transition-none motion-reduce:transform-none',
              'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
              'focus-visible:ring-offset-canvas',
              selected
                ? cn('border-transparent text-white shadow-card', BRAND_FILL)
                : cn(
                  'border-default bg-surface text-default shadow-soft',
                  'hover:-translate-y-0.5 hover:border-primary-400 hover:shadow-card',
                  date.isWeekend && 'bg-surface-sunken',
                ),
            )}
          >
            <span
              className={cn(
                'text-overline uppercase',
                selected ? 'text-white/85' : 'text-subtle',
              )}
            >
              {date.isToday ? 'Today' : date.weekday}
            </span>
            <span className="font-numeric text-heading-md tabular-nums">{date.dayNumber}</span>
            <span className={cn('text-caption', selected ? 'text-white/85' : 'text-subtle')}>
              {date.month}
            </span>
            {marked && (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute bottom-1.5 h-1.5 w-1.5 rounded-pill',
                  selected ? 'bg-white' : 'bg-accent-600',
                )}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

/** One doctor's chips for the selected date. */
function DoctorSlotGroup({ doctor, slots, picksByKey, onToggle, full, max }) {
  const available = slots.filter((slot) => slot.available);
  const chosenHere = slots.reduce(
    (total, slot) => total + (picksByKey.has(slotKey(slot)) ? 1 : 0),
    0,
  );

  return (
    <section className="overflow-hidden rounded-card border border-subtle bg-surface shadow-soft">
      <header className="flex items-center gap-2.5 border-b border-subtle bg-surface p-3.5">
        <Avatar
          src={resolveImageUrl(doctor?.photo, { fallback: null }) || undefined}
          name={doctor?.name}
          size="sm"
          shape="rounded"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-label-md text-default">{doctor?.name || 'Doctor'}</p>
          <p className="truncate text-caption text-subtle">
            {available.length > 0
              ? `${available.length} free ${available.length === 1 ? 'time' : 'times'} on this date`
              : 'No free times on this date'}
          </p>
        </div>
        {chosenHere > 0 && (
          <Badge tone="primary" size="sm">
            {chosenHere} offered
          </Badge>
        )}
      </header>

      <div className="p-3.5">
        {slots.length === 0 ? (
          <p className="text-caption text-muted">
            {doctor?.name || 'This doctor'} is not taking appointments on this date. Try another day;
            your other doctors may still be free.
          </p>
        ) : (
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            {slots.map((slot) => {
              const key = slotKey(slot);
              const rank = picksByKey.get(key);
              const chosen = rank !== undefined;
              const disabled = !slot.available || (full && !chosen);

              return (
                <li key={key}>
                  <button
                    type="button"
                    aria-pressed={chosen}
                    disabled={disabled}
                    onClick={() => onToggle(slot, doctor)}
                    title={!slot.available
                      ? 'Already booked'
                      : full && !chosen
                        ? `You have already offered ${max} times`
                        : undefined}
                    className={cn(
                      'relative w-full rounded-field border px-2 py-2.5 outline-none',
                      'font-numeric text-label-md tabular-nums',
                      'transition-[background-color,border-color,box-shadow,transform] duration-150',
                      'motion-reduce:transition-none motion-reduce:transform-none',
                      'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
                      'focus-visible:ring-offset-canvas',
                      chosen
                        ? 'border-primary-600 bg-primary-600 text-white shadow-card dark:text-primary-50'
                        : cn(
                          'border-default bg-surface text-default',
                          'hover:-translate-y-0.5 hover:border-primary-400 hover:bg-primary-50',
                          'hover:text-primary-900 hover:shadow-soft',
                        ),
                      disabled && !chosen && cn(
                        'cursor-not-allowed border-default bg-surface-sunken text-subtle line-through',
                        'hover:translate-y-0 hover:border-default hover:bg-surface-sunken',
                        'hover:text-subtle hover:shadow-none',
                      ),
                    )}
                  >
                    {formatTime(slot.slot_time)}
                    {chosen && (
                      <span
                        aria-hidden="true"
                        className={cn(
                          'absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center',
                          'rounded-pill bg-primary-900 text-[0.6875rem] font-bold text-white',
                          'ring-2 ring-surface dark:text-primary-50',
                        )}
                      >
                        {rank}
                      </span>
                    )}
                    <span className="ui-sr-only">
                      {!slot.available
                        ? ', already booked'
                        : chosen
                          ? `, your choice number ${rank}`
                          : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}

/** The three chip states, named. Colour is never the only signal. */
function ChipLegend() {
  const items = [
    { id: 'free', label: 'Free', className: 'border-default bg-surface' },
    { id: 'yours', label: 'Your pick', className: 'border-primary-600 bg-primary-600' },
    { id: 'taken', label: 'Taken', className: 'border-default bg-surface-sunken' },
  ];
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-1.5 text-caption text-subtle">
          <span
            aria-hidden="true"
            className={cn('h-3.5 w-6 rounded-control border', item.className)}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * @param {object} props
 * @param {Array<number>} props.doctorIds Whose days to load, in preference order.
 * @param {Record<number, {name?:string, photo?:string}>} props.doctorsById Names for the headings.
 * @param {Array<{key:string, slot_date:string, slot_time:string, doctor_id:number|null}>} props.picks
 * @param {number} [props.max=5]
 * @param {(slot:object, doctor:object) => void} props.onAdd
 * @param {(key:string) => void} props.onRemove
 */
export default function SlotOfferPicker({
  doctorIds = [],
  doctorsById = {},
  picks = [],
  max = 5,
  onAdd,
  onRemove,
  className,
}) {
  const [date, setDate] = useState(() => todayISO());
  const dates = useMemo(() => buildDateStrip(14), []);
  const slots = useMultiSlots(doctorIds, date);

  const full = picks.length >= max;

  /** key -> 1-based rank, so a chip can show its own position. */
  const picksByKey = useMemo(() => {
    const map = new Map();
    picks.forEach((pick, index) => map.set(pick.key, index + 1));
    return map;
  }, [picks]);

  /** Dates that already carry a pick, for the dot on the strip. */
  const markedDates = useMemo(() => new Set(picks.map((pick) => pick.slot_date)), [picks]);

  const handleToggleSlot = useCallback((slot, doctor) => {
    const key = slotKey(slot);
    if (picksByKey.has(key)) {
      onRemove?.(key);
      return;
    }
    onAdd?.({ ...slot, doctorName: doctor?.name || '' });
  }, [picksByKey, onAdd, onRemove]);

  const totalAvailable = useMemo(
    () => Object.values(slots.byDoctor)
      .reduce((total, list) => total + list.filter((slot) => slot.available).length, 0),
    [slots.byDoctor],
  );

  return (
    <div className={cn('space-y-4', className)}>
      {/* ------------------------------------------------------- the dates -- */}
      <div className="rounded-card border border-subtle bg-surface p-4 shadow-soft">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2.5 text-label-lg text-default">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-accent-100 text-accent-700"
            >
              <CalendarDays className="h-4 w-4" />
            </span>
            Pick a date
          </h3>
          <p className="text-caption text-subtle">
            Showing {friendlyDate(date)} · next 14 days
          </p>
        </div>

        <DateStrip
          dates={dates}
          value={date}
          onChange={setDate}
          markedDates={markedDates}
        />

        <p className="mt-1 flex items-center gap-1.5 text-caption text-subtle">
          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-pill bg-accent-600" />
          A dot marks a day you have already offered a time on.
        </p>
      </div>

      {full && (
        <Alert tone="info">
          You have offered the maximum of {max} times. Remove one above to swap it for another.
        </Alert>
      )}

      {slots.status === 'loading' && (
        <SkeletonGroup label="Loading available times" className="space-y-3">
          {doctorIds.map((id) => (
            <div key={id} className="rounded-card border border-subtle bg-surface p-4">
              <div className="mb-3 flex items-center gap-2.5">
                <Skeleton shape="circle" className="h-8 w-8" />
                <Skeleton width="40%" height={12} />
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                {[0, 1, 2, 3, 4, 5].map((slot) => (
                  <Skeleton key={slot} shape="rect" className="h-10" />
                ))}
              </div>
            </div>
          ))}
        </SkeletonGroup>
      )}

      {slots.status === 'error' && (
        <Alert
          tone="danger"
          title="We could not load times for that day"
          icon={<AlertTriangle aria-hidden="true" className="h-5 w-5" />}
          actions={
            <Button
              size="sm"
              variant="outline"
              onClick={slots.reload}
              leftIcon={<RefreshCw aria-hidden="true" className="h-4 w-4" />}
            >
              Try again
            </Button>
          }
        >
          {slots.error} The times you have already offered are safe.
        </Alert>
      )}

      {slots.status === 'success' && totalAvailable === 0 && (
        <EmptyState
          icon={<CalendarX aria-hidden="true" className="h-6 w-6" />}
          tone="primary"
          title={`No free times on ${friendlyDate(date)}`}
          description={
            'None of your doctors have an opening on this date. Try another day in the strip '
            + 'above; weekday mornings are usually the emptiest.'
          }
          size="sm"
          bordered
        />
      )}

      {slots.status === 'success' && totalAvailable > 0 && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-label-md text-default">
              Free times on {friendlyDate(date)}
            </p>
            <ChipLegend />
          </div>

          {doctorIds.map((id) => (
            <DoctorSlotGroup
              key={id}
              doctor={doctorsById[id]}
              slots={slots.byDoctor[String(id)] || []}
              picksByKey={picksByKey}
              onToggle={handleToggleSlot}
              full={full}
              max={max}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export { SlotOfferPicker };
