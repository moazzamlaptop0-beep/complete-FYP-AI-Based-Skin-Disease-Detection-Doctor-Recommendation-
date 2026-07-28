/**
 * StepSlots — offer up to FIVE preferred times, ranked, across the chosen doctors.
 *
 * WHAT THIS REPLACES
 * ------------------
 * `POST /api/book-slot` takes one doctor, one date, one time, and if that exact
 * slot is already taken the only way through was to have a server-verified
 * CRITICAL/URGENT scan — you had to have an emergency before you were allowed to
 * book. A patient without one simply hit a wall and had to guess again.
 *
 * A request now carries `preferred_slots[1..5]`, each with a `rank`, and the
 * doctors race for it: the first to accept one of those times closes the request
 * for everyone else. So the question this screen asks is not "when is your
 * appointment" — nobody knows that yet — but "which times would work for you".
 * That framing is repeated in the copy, in the ranked list and in the confirm
 * line, because a patient who thinks they have just booked five appointments has
 * been badly misled.
 *
 * ONE REQUEST PER DATE, NOT ONE PER DOCTOR
 * ----------------------------------------
 * `/api/slots/multi?doctor_ids=1,2,3&date=…` returns every chosen doctor's day in
 * a single enveloped response (see useMultiSlots for why three parallel calls to
 * the single-doctor route was the wrong shape).
 *
 * SLOTS ARE GROUPED BY DOCTOR AND ALWAYS NAMED
 * --------------------------------------------
 * A bare "09:30" chip is ambiguous the moment there is more than one doctor: two
 * of them can be free at 09:30 and those are two DIFFERENT offers. That, the date
 * strip and the "anything not explicitly available is taken" rule all live in
 * SlotOfferPicker, because the patient's requests page edits the same list on an
 * already-sent request and two copies of those rules would drift apart.
 *
 * This file is a thin wrapper: the date strip, slot chips and ranked list all
 * live in SlotOfferPicker / SlotPreferenceList. Only spacing, the explainer and
 * the "who is this going to" footer are styled here.
 *
 * NO DRAG AND DROP, HERE OR ANYWHERE IN THIS FLOW
 * ----------------------------------------------
 * Reordering the preference list is Up/Down buttons on purpose (see
 * SlotPreferenceList's header). Do not add a drag handle to this screen: the list
 * lives inside a scrolling page on a device the patient is holding in one hand,
 * and a drag gesture there competes with the scroll it is sitting in.
 */

import React, { useMemo } from 'react';
import { ArrowLeft, Clock, Info } from 'lucide-react';

import { AvatarGroup, Button, EmptyState, cn } from '../../../components/ui';
import { resolveImageUrl } from '../../../lib/imageUrl';
import { useConsult } from '../ConsultContext';
import { doctorIdOf } from '../consultReducer';
import SlotOfferPicker from '../components/SlotOfferPicker';
import SlotPreferenceList from '../components/SlotPreferenceList';

export default function StepSlots() {
  const { state, limits, addSlot, removeSlot, reorderSlots, goToStepId } = useConsult();

  const selectedDoctors = state.doctors.selected;
  const doctorIds = useMemo(
    () => selectedDoctors.map((doctor) => doctorIdOf(doctor)).filter((id) => id !== null),
    [selectedDoctors],
  );
  const doctorsById = useMemo(() => {
    const map = {};
    selectedDoctors.forEach((doctor) => {
      const id = doctorIdOf(doctor);
      if (id !== null) map[id] = doctor;
    });
    return map;
  }, [selectedDoctors]);

  const picks = state.slots.picks;

  // Defensive: STEPS.canEnter already refuses this step without a doctor, but a
  // restored draft is user-editable data and this is cheaper than a crash.
  if (selectedDoctors.length === 0) {
    return (
      <EmptyState
        icon={<Clock aria-hidden="true" className="h-6 w-6" />}
        tone="primary"
        title="Choose a doctor first"
        description="Times are shown per doctor, so we need to know who you would like to see."
        action={<Button onClick={() => goToStepId('doctors')}>Back to doctors</Button>}
        size="sm"
        bordered
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {/* -------------------------------------------------------- explainer --
          The wash is built from flipping token scales in BOTH directions, so it
          needs no `dark:` override: primary-50 and accent-50 are pale tints on
          light and deep tints on dark, which is exactly the effect wanted. */}
      <div
        className={cn(
          'flex items-start gap-3.5 rounded-card border border-info-100 p-4 shadow-soft sm:p-5',
          'bg-gradient-to-br from-info-50 via-surface to-accent-50',
        )}
      >
        <span
          aria-hidden="true"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-field bg-info-100 text-info-700"
        >
          <Info className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="font-heading text-heading-sm text-default">
            Offer up to {limits.MAX_SLOTS} times, best first
          </p>
          <p className="mt-1.5 text-body-sm text-muted">
            Nothing is booked yet. All {selectedDoctors.length}
            {' '}
            {selectedDoctors.length === 1 ? 'doctor sees' : 'doctors see'} the same list, and the
            first one to accept one of these times gets the appointment. The rest are closed
            automatically, so you will not end up with two.
          </p>
        </div>
      </div>

      {/* --------------------------------------------------- the ranked list -- */}
      <SlotPreferenceList
        picks={picks}
        max={limits.MAX_SLOTS}
        onRemove={removeSlot}
        onReorder={reorderSlots}
        doctorsById={doctorsById}
      />

      {/* ------------------------------------------- the date and the times -- */}
      <SlotOfferPicker
        doctorIds={doctorIds}
        doctorsById={doctorsById}
        picks={picks}
        max={limits.MAX_SLOTS}
        onAdd={addSlot}
        onRemove={removeSlot}
      />

      {/* ------------------------------------------------ who this is going to --
          The faces, not just a count: this is the last screen before the note
          and the review, and "changed your mind about who to ask" is a question
          people can only answer if they can see who they picked. */}
      <div
        className={cn(
          'flex flex-wrap items-center justify-between gap-3 rounded-card',
          'border border-default bg-surface-sunken p-3.5',
        )}
      >
        <div className="flex min-w-0 items-center gap-3">
          <AvatarGroup
            size="sm"
            items={selectedDoctors.map((doctor) => ({
              src: resolveImageUrl(doctor.photo, { fallback: null }) || undefined,
              name: doctor.name,
            }))}
          />
          <div className="min-w-0">
            <p className="truncate text-label-md text-default">
              Going to {selectedDoctors.length}
              {' '}
              {selectedDoctors.length === 1 ? 'doctor' : 'doctors'}
            </p>
            <p className="truncate text-caption text-subtle">
              {selectedDoctors.map((doctor) => doctor.name).join(', ')}
            </p>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => goToStepId('doctors')}
          leftIcon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />}
          className="shrink-0"
        >
          Change doctors
        </Button>
      </div>
    </div>
  );
}

export { StepSlots };
