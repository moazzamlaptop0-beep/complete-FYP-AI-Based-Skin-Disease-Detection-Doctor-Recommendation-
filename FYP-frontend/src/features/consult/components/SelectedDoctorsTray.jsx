/**
 * SelectedDoctorsTray — the running answer to "who am I sending this to?".
 *
 * WHY A STICKY TRAY AND NOT A COUNTER
 * -----------------------------------
 * The directory can be long, and the three chosen doctors scroll away from you
 * the moment you start browsing. A bare "3 selected" badge tells you the count
 * but not WHO, so the only way to check your own choice is to scroll back and
 * hunt for highlighted cards. The tray keeps the actual names on screen, each
 * with its own remove button, so removing the doctor you no longer want does not
 * require finding their card again.
 *
 * The chips are numbered because the order is meaningful: it is the order the
 * request stores `doctor_ids` in, and the Times step groups slots by it.
 *
 * ACCESSIBILITY
 * -------------
 * The tray is a `<section>` with an `aria-live="polite"` summary line, so adding
 * or removing a doctor is announced without moving focus. Each remove button
 * names its doctor ("Remove Dr Ayesha Khan") rather than saying "Remove", which
 * is the difference between a usable and a useless screen-reader pass over three
 * identical buttons.
 */

import React from 'react';
import { UserPlus, X } from 'lucide-react';

import { Avatar, Button, IconButton, cn } from '../../../components/ui';
import { resolveImageUrl } from '../../../lib/imageUrl';

/**
 * @param {object} props
 * @param {Array<object>} props.selected Doctors in the patient's chosen order.
 * @param {number} props.max
 * @param {(doctor:object)=>void} props.onRemove
 * @param {()=>void} [props.onContinue]
 * @param {string} [props.continueLabel]
 * @param {boolean} [props.canContinue]
 */
export default function SelectedDoctorsTray({
  selected = [],
  max = 3,
  onRemove,
  onContinue,
  continueLabel = 'Choose times',
  canContinue = true,
  className,
}) {
  const count = selected.length;
  const full = count >= max;

  return (
    <section
      aria-label="Chosen doctors"
      className={cn(
        // Full-bleed to the CardBody's own padding (px-5 sm:px-6), so the tray
        // reads as a bar attached to the panel rather than a floating box.
        'sticky bottom-0 z-raised -mx-5 mt-4 border-t border-subtle bg-surface-raised/95 px-5 py-3',
        'shadow-elevated backdrop-blur supports-[backdrop-filter]:bg-surface-raised/80',
        'sm:-mx-6 sm:px-6',
        className,
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-label-md text-default" aria-live="polite">
            {count === 0
              ? `Pick up to ${max} doctors`
              : `${count} of ${max} chosen${full ? ' — remove one to swap' : ''}`}
          </p>

          {count === 0 ? (
            <p className="mt-1 flex items-center gap-1.5 text-caption text-subtle">
              <UserPlus aria-hidden="true" className="h-3.5 w-3.5" />
              Your request goes to all of them at once. The first to accept gets the appointment.
            </p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {selected.map((doctor, index) => (
                <li key={doctor.id}>
                  <span
                    className={cn(
                      'inline-flex max-w-[15rem] items-center gap-1.5 rounded-pill border',
                      'border-primary-200 bg-primary-50 py-1 pl-1 pr-1 text-caption',
                      'text-primary-900 dark:border-primary-800 dark:bg-primary-950/60',
                      'dark:text-primary-100',
                    )}
                  >
                    <Avatar
                      src={resolveImageUrl(doctor.photo, { fallback: null }) || undefined}
                      name={doctor.name}
                      size="xs"
                    />
                    <span className="truncate font-medium">
                      {index + 1}. {doctor.name}
                    </span>
                    <IconButton
                      aria-label={`Remove ${doctor.name}`}
                      size="sm"
                      variant="ghost"
                      className="h-6 w-6 rounded-pill"
                      onClick={() => onRemove?.(doctor)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </IconButton>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {onContinue && (
          <Button
            type="button"
            onClick={onContinue}
            disabled={!canContinue || count === 0}
            className="shrink-0"
          >
            {continueLabel}
          </Button>
        )}
      </div>
    </section>
  );
}

export { SelectedDoctorsTray };
