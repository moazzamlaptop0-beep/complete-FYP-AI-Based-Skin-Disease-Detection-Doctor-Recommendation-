/**
 * SlotPreferenceList — the ranked list of times the patient is offering.
 *
 * RANK IS DATA, NOT DECORATION
 * ----------------------------
 * `preferred_slots[]` carries an explicit `rank` per entry, and a doctor's inbox
 * shows them in that order, so the position of a row here is a real instruction
 * to a human being. That is why the list is numbered, why the numbers are
 * rendered as text rather than implied by position, and why "1" is labelled
 * "first choice" the first time it appears.
 *
 * REORDERING IS BUTTONS, NOT DRAG AND DROP
 * ----------------------------------------
 * Drag and drop cannot be operated by a keyboard, is hostile on a touch screen
 * inside a scrolling page (the drag and the scroll fight each other), and is
 * invisible to a screen reader unless a whole parallel keyboard mode is built.
 * Up/Down buttons are none of those things: they are focusable, they announce
 * themselves, and they work identically with a mouse, a thumb or a Tab key. Each
 * move is announced through a polite live region, because the visual reorder is
 * silent to anyone not looking at it.
 *
 * Because each row is keyed by the slot's stable `key`, React MOVES the existing
 * DOM node instead of re-creating it — so focus stays on the button the user
 * just pressed and they can press it again to keep climbing.
 *
 * WHY THE MOVE CONTROLS ARE ALWAYS VISIBLE
 * ---------------------------------------
 * Revealing them on hover would hide the whole reordering feature from every
 * touch device, and reveal-on-focus alone leaves a mouse user with no way to
 * discover that order can be changed at all. They are quiet (ghost icon
 * buttons) but they are always there.
 *
 * COLOUR CONTRACT
 * ---------------
 * `bg-primary-600` re-ramps to rgb(94 149 237) in dark mode, where white text is
 * 3.0:1 and fails, so the rank pill carries the sanctioned `dark:text-primary-50`
 * twin (rgb(8 29 66) on that fill, 5.9:1). Row wells use `border-default`: in
 * light mode `border-subtle` and `bg-surface-sunken` are the same rgb, so a
 * subtle border on a sunken row draws nothing at all.
 */

import React, { useCallback, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarClock, X } from 'lucide-react';

import { IconButton, cn } from '../../../components/ui';
import { formatTime } from '../../../lib/format';
import { friendlyDate } from '../lib/slotDates';

/**
 * @param {object} props
 * @param {Array<{key:string, slot_date:string, slot_time:string, doctor_id:number|null, doctorName?:string}>} props.picks
 * @param {number} props.max
 * @param {(key:string)=>void} props.onRemove
 * @param {(from:number, to:number)=>void} props.onReorder
 * @param {Record<number, {name:string}>} [props.doctorsById] Fallback for names.
 */
export default function SlotPreferenceList({
  picks = [],
  max = 5,
  onRemove,
  onReorder,
  doctorsById = {},
  className,
}) {
  const [announcement, setAnnouncement] = useState('');

  const nameFor = useCallback((pick) => (
    pick.doctorName
    || doctorsById[pick.doctor_id]?.name
    || (pick.doctor_id ? `Doctor #${pick.doctor_id}` : 'Any of my doctors')
  ), [doctorsById]);

  const move = useCallback((from, to) => {
    if (to < 0 || to >= picks.length) return;
    const pick = picks[from];
    onReorder?.(from, to);
    setAnnouncement(
      `${friendlyDate(pick.slot_date)} at ${formatTime(pick.slot_time)} with ${nameFor(pick)} `
      + `moved to position ${to + 1} of ${picks.length}.`,
    );
  }, [picks, onReorder, nameFor]);

  const remove = useCallback((pick) => {
    onRemove?.(pick.key);
    setAnnouncement(
      `${friendlyDate(pick.slot_date)} at ${formatTime(pick.slot_time)} removed. `
      + `${picks.length - 1} of ${max} times offered.`,
    );
  }, [onRemove, picks.length, max]);

  const pips = Array.from({ length: max }, (unused, index) => index < picks.length);

  return (
    <section
      aria-label="Your preferred times, in order"
      className={cn(
        'overflow-hidden rounded-card border border-subtle bg-surface shadow-soft',
        className,
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-subtle p-4">
        <h3 className="flex items-center gap-2.5 text-label-lg text-default">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-primary-100 text-primary-700"
          >
            <CalendarClock className="h-4 w-4" />
          </span>
          Times you are offering
        </h3>

        <div className="flex items-center gap-2.5">
          {/* The pips are decorative; the count beside them is the accessible
              version of the same fact. */}
          <span aria-hidden="true" className="flex items-center gap-1">
            {pips.map((filled, index) => (
              <span
                key={index}
                className={cn(
                  'h-1.5 w-4 rounded-pill transition-colors duration-200',
                  filled
                    ? 'bg-gradient-to-r from-primary-600 to-accent-700 dark:from-primary-400 dark:to-accent-300'
                    : 'bg-neutral-200',
                )}
              />
            ))}
          </span>
          <span className="font-numeric text-label-md tabular-nums text-muted">
            {picks.length} of {max}
          </span>
        </div>
      </header>

      <div className="p-4">
        {picks.length === 0 ? (
          <p className="text-body-sm text-muted">
            Nothing offered yet. Pick a date below, then tap the times that suit you. Your first pick
            becomes your first choice, and you can reorder them afterwards.
          </p>
        ) : (
          <>
            <ol className="space-y-2">
              {picks.map((pick, index) => (
                <li
                  key={pick.key}
                  className={cn(
                    'flex items-center gap-3 rounded-field border p-2.5 transition-colors duration-150',
                    index === 0
                      ? 'border-primary-300 bg-primary-50 shadow-soft'
                      : 'border-default bg-surface-sunken',
                  )}
                >
                  {/* The NUMBER, not a medal glyph: the rank is a literal
                      instruction to a doctor, so it is rendered as the digit the
                      request will carry. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      'grid h-8 w-8 shrink-0 place-items-center rounded-field font-numeric',
                      'text-label-md tabular-nums',
                      index === 0
                        ? 'bg-primary-600 text-white dark:text-primary-50'
                        : 'bg-neutral-200 text-neutral-700',
                    )}
                  >
                    {index + 1}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-label-md text-default">
                      {friendlyDate(pick.slot_date)} at {formatTime(pick.slot_time)}
                      {index === 0 && (
                        <span className="ml-2 text-caption font-normal text-primary-700">
                          first choice
                        </span>
                      )}
                    </p>
                    <p className="truncate text-caption text-subtle">with {nameFor(pick)}</p>
                  </div>

                  <div className="flex shrink-0 items-center gap-0.5">
                    <IconButton
                      aria-label={`Move ${friendlyDate(pick.slot_date)} at ${formatTime(pick.slot_time)} up to position ${index}`}
                      size="sm"
                      variant="ghost"
                      disabled={index === 0}
                      onClick={() => move(index, index - 1)}
                    >
                      <ArrowUp />
                    </IconButton>
                    <IconButton
                      aria-label={`Move ${friendlyDate(pick.slot_date)} at ${formatTime(pick.slot_time)} down to position ${index + 2}`}
                      size="sm"
                      variant="ghost"
                      disabled={index === picks.length - 1}
                      onClick={() => move(index, index + 1)}
                    >
                      <ArrowDown />
                    </IconButton>
                    <IconButton
                      aria-label={`Remove ${friendlyDate(pick.slot_date)} at ${formatTime(pick.slot_time)}`}
                      size="sm"
                      variant="ghost"
                      onClick={() => remove(pick)}
                    >
                      <X />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ol>

            <p className="mt-3 flex items-start gap-2 text-caption text-subtle">
              <ArrowUp aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Order matters: doctors see your first choice first. It is still a preference;
                whoever accepts, accepts one of these times.
              </span>
            </p>
          </>
        )}
      </div>

      <p aria-live="polite" className="ui-sr-only">{announcement}</p>
    </section>
  );
}

export { SlotPreferenceList };
