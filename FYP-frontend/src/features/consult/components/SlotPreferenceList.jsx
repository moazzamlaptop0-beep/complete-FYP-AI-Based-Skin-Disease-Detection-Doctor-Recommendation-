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
 */

import React, { useCallback, useState } from 'react';
import { ArrowDown, ArrowUp, CalendarClock, X } from 'lucide-react';

import { Badge, IconButton, cn } from '../../../components/ui';
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

  return (
    <section
      aria-label="Your preferred times, in order"
      className={cn(
        'rounded-card border border-subtle bg-surface p-4',
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-label-lg text-default">
          <CalendarClock aria-hidden="true" className="h-4 w-4 text-primary-700 dark:text-primary-400" />
          Times you are offering
        </h3>
        <Badge tone={picks.length ? 'primary' : 'neutral'} size="sm">
          {picks.length} of {max}
        </Badge>
      </div>

      {picks.length === 0 ? (
        <p className="mt-3 text-body-sm text-muted">
          Nothing offered yet. Pick a date below, then tap the times that suit you — your first pick
          becomes your first choice, and you can reorder them afterwards.
        </p>
      ) : (
        <>
          <ol className="mt-3 space-y-2">
            {picks.map((pick, index) => (
              <li
                key={pick.key}
                className={cn(
                  'flex items-center gap-3 rounded-field border border-subtle bg-surface-sunken p-2.5',
                  index === 0 && 'border-primary-300 bg-primary-50 dark:bg-primary-950/40',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-pill text-label-md',
                    index === 0
                      ? 'bg-primary-600 text-white'
                      : 'bg-neutral-200 text-neutral-700',
                  )}
                >
                  {index + 1}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-label-md text-default">
                    {friendlyDate(pick.slot_date)} at {formatTime(pick.slot_time)}
                    {index === 0 && (
                      <span className="ml-2 font-normal text-caption text-primary-700 dark:text-primary-400">
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

          <p className="mt-3 text-caption text-subtle">
            Order matters: doctors see your first choice first. It is still a preference — whoever
            accepts, accepts one of these times.
          </p>
        </>
      )}

      <p aria-live="polite" className="ui-sr-only">{announcement}</p>
    </section>
  );
}

export { SlotPreferenceList };
