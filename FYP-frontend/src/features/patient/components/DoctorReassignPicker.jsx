/**
 * DoctorReassignPicker — swap the doctors on a request that is being re-sent.
 *
 * WHY A DECLINED REQUEST NEEDED THIS
 * ---------------------------------
 * Re-sending reused the ORIGINAL invitees, which is the right default for a
 * withdrawn or expired request and useless for a declined one: the doctors who
 * said no are exactly the doctors who must not be asked again. The patient's only
 * route to a different dermatologist was the consult stepper — i.e. photographing
 * the same patch again to produce a second scan, because the stepper begins at
 * Capture. The scan, the diagnosis, the six answers and the note are all still on
 * the server, so the only thing genuinely missing was "and send it to these
 * people instead".
 *
 * ONLY LICENCE-APPROVED DOCTORS ARE OFFERED
 * ----------------------------------------
 * `/api/doctors/public` also lists doctors whose licence is still 'pending', and
 * `POST /api/appointment-requests` refuses those with a 400 naming
 * `rejected_doctor_ids`. Filtering them out here means the patient cannot pick a
 * doctor the request will then bounce on.
 *
 * "ADD" IS NOT A DECISION YOU CAN MAKE FROM A NAME
 * -----------------------------------------------
 * The row shows a name, a specialty and a city, which is enough to recognise
 * somebody and not enough to CHOOSE somebody: the fee, the weekly hours, the
 * years of experience and what other patients said are all things a person wants
 * before they hand over a photograph of their skin. Every row therefore carries an
 * info button opening the same DoctorProfileDrawer the Find-a-doctor page uses —
 * one profile panel in the product, not a second summary that can drift from it.
 * `directory.all` is normalised for filtering; the drawer wants the raw API row,
 * which `normalizeDoctor` keeps as `.raw`.
 */

import React, { useMemo, useState } from 'react';
import { Check, Info, Plus, Star, Stethoscope, UserSearch } from 'lucide-react';

import {
  Alert,
  Avatar,
  Badge,
  Button,
  IconButton,
  SearchInput,
  Skeleton,
  Tooltip,
  cn,
} from '../../../components/ui';
import { resolveImageUrl } from '../../../lib/imageUrl';
import { useDoctorDirectory } from '../../consult/hooks/useDoctorDirectory';

import DoctorProfileDrawer from './DoctorProfileDrawer';

/**
 * @param {object} props
 * @param {Array<{id:number, name:string}>} props.selected In the patient's own preference order.
 * @param {number} props.max
 * @param {(doctor:object) => void} props.onToggle
 */
export default function DoctorReassignPicker({ selected = [], max = 3, onToggle }) {
  const directory = useDoctorDirectory();
  /** The normalised row whose profile panel is open, or null. */
  const [previewing, setPreviewing] = useState(null);

  const selectedIds = useMemo(
    () => new Set(selected.map((doctor) => Number(doctor.id))),
    [selected],
  );

  // Approved only, and the ones already chosen float to the top so a patient who
  // has picked three can see and unpick them without scrolling for them.
  const rows = useMemo(() => {
    const approved = directory.doctors.filter((doctor) => doctor.isVerified);
    const chosen = approved.filter((doctor) => selectedIds.has(doctor.id));
    const rest = approved.filter((doctor) => !selectedIds.has(doctor.id));
    return [...chosen, ...rest];
  }, [directory.doctors, selectedIds]);

  const full = selected.length >= max;
  const previewChosen = Boolean(previewing && selectedIds.has(previewing.id));
  // At the ceiling, the profile panel must not offer an "Add" that the toggle
  // would silently swallow.
  const previewBlocked = Boolean(previewing) && !previewChosen && full;

  return (
    <section className="rounded-card border border-subtle bg-surface p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-body text-label-lg text-default">
          <UserSearch aria-hidden="true" className="h-4 w-4 text-primary-700 dark:text-primary-400" />
          Who should see it this time?
        </h3>
        <Badge tone={selected.length ? 'primary' : 'neutral'} size="sm">
          {selected.length} of {max}
        </Badge>
      </header>

      <SearchInput
        value={directory.filters.q}
        onChange={(event) => directory.setFilters({ q: event.target.value })}
        placeholder="Search by name, specialty or city"
        aria-label="Search doctors"
      />

      {full && (
        <Alert tone="info" className="mt-3">
          That is the maximum of {max} doctors. Remove one to swap it for another.
        </Alert>
      )}

      {directory.status === 'error' && (
        <Alert
          tone="danger"
          className="mt-3"
          actions={<Button size="sm" variant="outline" onClick={directory.reload}>Try again</Button>}
        >
          {directory.error}
        </Alert>
      )}

      {directory.status === 'loading' && (
        <div className="mt-3 flex flex-col gap-2" aria-busy="true">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex items-center gap-3 rounded-field border border-subtle p-2.5">
              <Skeleton shape="circle" className="h-9 w-9" />
              <Skeleton width="45%" height={12} />
            </div>
          ))}
        </div>
      )}

      {directory.status === 'success' && rows.length === 0 && (
        <p className="mt-3 font-body text-body-sm text-muted">
          No approved dermatologist matches that search. Clear the box to see everybody.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="ui-scrollbar mt-3 flex max-h-72 flex-col gap-2 overflow-y-auto pr-1">
          {rows.map((doctor) => {
            const chosen = selectedIds.has(doctor.id);
            const rank = chosen
              ? selected.findIndex((entry) => Number(entry.id) === doctor.id) + 1
              : 0;

            return (
              <li key={doctor.id}>
                <div
                  className={cn(
                    'flex items-center gap-3 rounded-field border p-2.5',
                    chosen ? 'border-primary-600 bg-primary-50 dark:bg-primary-950/40' : 'border-subtle bg-surface',
                  )}
                >
                  <Avatar
                    src={resolveImageUrl(doctor.photo, { fallback: null }) || undefined}
                    name={doctor.name}
                    size="sm"
                    shape="rounded"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-body text-label-md text-default">
                      {doctor.name}
                      {chosen && (
                        <span className="ml-2 font-normal text-caption text-primary-700 dark:text-primary-400">
                          your {rank === 1 ? '1st' : rank === 2 ? '2nd' : '3rd'} choice
                        </span>
                      )}
                    </p>
                    <p className="truncate font-body text-caption text-subtle">
                      <Stethoscope aria-hidden="true" className="mr-1 inline h-3 w-3" />
                      {doctor.specialty}
                      {doctor.city ? ` · ${doctor.city}` : ''}
                      {doctor.rating ? ` · ${doctor.rating.toFixed(1)}` : ''}
                      {doctor.rating ? <Star aria-hidden="true" className="ml-0.5 inline h-3 w-3" /> : null}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Tooltip content={`See ${doctor.name}'s fees, hours and reviews`}>
                      <IconButton
                        size="sm"
                        variant="outline"
                        aria-label={`Details for ${doctor.name}`}
                        onClick={() => setPreviewing(doctor)}
                      >
                        <Info />
                      </IconButton>
                    </Tooltip>
                    <Button
                      size="sm"
                      variant={chosen ? 'success' : 'primary'}
                      leftIcon={chosen ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                      disabled={!chosen && full}
                      onClick={() => onToggle?.(doctor)}
                    >
                      {chosen ? 'Chosen' : 'Add'}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* The panel's primary action ADDS to the request rather than booking a
          slot, and it closes itself — the patient came here to decide, and having
          decided they should be back at the list with the choice already made. */}
      <DoctorProfileDrawer
        doctor={previewing?.raw || previewing}
        open={Boolean(previewing)}
        onClose={() => setPreviewing(null)}
        bookLabel={
          previewChosen
            ? 'Remove from this request'
            : previewBlocked
              ? `You already have ${max} doctors`
              : 'Add to this request'
        }
        onBook={() => {
          if (previewBlocked) return;
          if (previewing) onToggle?.(previewing);
          setPreviewing(null);
        }}
      />
    </section>
  );
}

export { DoctorReassignPicker };
