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
 */

import React, { useMemo } from 'react';
import { Info, Users } from 'lucide-react';

import { Badge, Button, EmptyState } from '../../../components/ui';
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
        icon={<Users aria-hidden="true" className="h-6 w-6" />}
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
    <div className="space-y-5">
      {/* -------------------------------------------------------- explainer -- */}
      <div className="rounded-card border border-subtle bg-surface-sunken p-4">
        <p className="flex items-start gap-2 text-body-sm text-default">
          <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary-700 dark:text-primary-400" />
          <span>
            Offer <strong>up to {limits.MAX_SLOTS} times</strong> that would work for you, best
            first. Nothing is booked yet: all {selectedDoctors.length}
            {' '}
            {selectedDoctors.length === 1 ? 'doctor sees' : 'doctors see'} the same list, and the
            first one to accept one of these times gets the appointment. The rest are closed
            automatically — you will not end up with two.
          </span>
        </p>
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

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-subtle pt-4">
        <p className="text-caption text-subtle">
          Changed your mind about who to ask?
        </p>
        <Button variant="ghost" size="sm" onClick={() => goToStepId('doctors')}>
          Back to doctors
          <Badge tone="neutral" size="sm" className="ml-2">
            {selectedDoctors.length}
          </Badge>
        </Button>
      </div>
    </div>
  );
}

export { StepSlots };
