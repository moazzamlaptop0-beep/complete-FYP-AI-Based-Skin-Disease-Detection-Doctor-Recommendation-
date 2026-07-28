/**
 * StepDoctors — choose up to THREE doctors for one request.
 *
 * THIS IS THE STEP THE REDESIGN EXISTS FOR
 * ----------------------------------------
 * The old path was: scan -> /nearby-doctors -> pick exactly ONE doctor ->
 * `/send_report` pins that doctor onto the scan -> only now may you open the
 * booking modal. One doctor, chosen before you knew whether they had any free
 * time, and no way back: `report_sent` was a one-way latch on the scan row.
 *
 * Here the request fans out. `POST /api/appointment-requests` takes
 * `doctor_ids[1..3]`, all three are notified together, and the FIRST to accept
 * closes it for the others (`/accept` is a SELECT … FOR UPDATE on the request
 * row precisely so two doctors cannot both win). That is why this screen never
 * asks the patient to rank doctors by preference — they are not a queue, they
 * are a race, and the tray says so in those words.
 *
 * WHY THE CAP IS THREE AND WHY IT IS ENFORCED IN THE REDUCER
 * ---------------------------------------------------------
 * The backend rejects a fourth id outright, so the UI must not let one be added.
 * `DOCTOR_TOGGLE` refuses past `LIMITS.MAX_DOCTORS` rather than this component
 * doing it, which means the cap survives a restored draft and cannot be
 * out-clicked. Removing a doctor here also drops any slot the Times step had
 * already collected for them (same reducer case) — otherwise a request could
 * carry a preferred time belonging to a doctor who is no longer on it, and the
 * backend would 400 on the mismatch.
 *
 * THE CAP IS SAID THREE TIMES, IN THREE REGISTERS
 * -----------------------------------------------
 * In prose in the explainer, as a live count in the toolbar, and as three filled
 * or empty pips in the tray. That is not repetition for its own sake: people
 * arrive at this screen expecting to pick ONE doctor (every other booking product
 * they have used works that way), and a rule stated once in a paragraph is a rule
 * they discover by having a card refuse to tick.
 *
 * LIST AND MAP SHOW THE SAME ARRAY
 * --------------------------------
 * Both views render `directory.doctors`, the single filtered+sorted array from
 * useDoctorDirectory. The map is `React.lazy`, so Leaflet (~161 kB) only
 * downloads for someone who actually presses "Map"; the list path never pays for
 * it.
 */

import React, { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  List,
  Lock,
  Map as MapIcon,
  MapPin,
  RefreshCw,
  SearchX,
  Sparkles,
  Users,
} from 'lucide-react';

import {
  Alert,
  Button,
  EmptyState,
  SkeletonCard,
  SkeletonGroup,
  Spinner,
  cn,
} from '../../../components/ui';
import { PATHS } from '../../../routes';
import { useConsult } from '../ConsultContext';
import { doctorIdOf } from '../consultReducer';
import { useDoctorDirectory } from '../hooks/useDoctorDirectory';
import DoctorCard from '../components/DoctorCard';
import DoctorFilters from '../components/DoctorFilters';
import SelectedDoctorsTray from '../components/SelectedDoctorsTray';

/** Leaflet stays in its own chunk — see the header note. */
const DoctorMap = lazy(() => import('../components/DoctorMap'));

const SIGN_IN_HREF = `${PATHS.AUTH}?returnTo=${encodeURIComponent(PATHS.CONSULT)}`;

/**
 * List / Map, as a segmented control.
 *
 * The active segment is a raised white pill inside a sunken track, which is the
 * one segmented-control treatment in this app that survives both themes without
 * a `dark:` override. The focus ring is the standard OUTSIDE ring: an inset ring
 * would be drawn inside a segment that is only 2px from its neighbour.
 */
function ViewToggle({ view, onChange }) {
  const options = [
    { id: 'list', label: 'List', icon: List },
    { id: 'map', label: 'Map', icon: MapIcon },
  ];

  return (
    <div
      role="group"
      aria-label="Directory view"
      className="inline-flex shrink-0 rounded-field border border-default bg-surface-sunken p-1"
    >
      {options.map((option) => {
        const Icon = option.icon;
        const active = view === option.id;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.id)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-control px-3.5 py-1.5 text-label-md',
              'outline-none transition-[background-color,color,box-shadow] duration-150',
              'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
              'focus-visible:ring-offset-canvas',
              active
                ? 'bg-surface text-primary-800 shadow-soft ring-1 ring-inset ring-primary-100'
                : 'text-muted hover:text-default',
            )}
          >
            <Icon aria-hidden="true" className="h-4 w-4" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export default function StepDoctors() {
  const { state, toggleDoctor, limits, isAuthenticated, goToStepId } = useConsult();
  const [view, setView] = useState('list');

  // This step exists to answer "who is near me", so it asks for the position
  // itself instead of hiding it behind the filter drawer's button.
  const directory = useDoctorDirectory({ enabled: isAuthenticated, autoLocate: true });

  const selected = state.doctors.selected;
  const selectedIds = useMemo(
    () => new Set(selected.map((doctor) => doctorIdOf(doctor)).filter((id) => id !== null)),
    [selected],
  );
  const full = selected.length >= limits.MAX_DOCTORS;

  const handleToggle = useCallback((doctor) => {
    toggleDoctor(doctor);
  }, [toggleDoctor]);

  /**
   * ConsultPage normally renders its own AccountGate INSTEAD of this component,
   * so this branch is a belt-and-braces guard: it keeps the step correct if it is
   * ever mounted directly (a test, a future deep link) instead of silently
   * firing an authenticated request as an anonymous visitor.
   */
  if (!isAuthenticated) {
    return (
      <EmptyState
        icon={<Lock aria-hidden="true" className="h-6 w-6" />}
        tone="primary"
        title="Sign in to choose doctors"
        description={
          'Your photo, the result and your answers are already saved in this tab and will still '
          + 'be here when you come back.'
        }
        action={<Button as={Link} to={SIGN_IN_HREF}>Sign in or create an account</Button>}
        bordered
      />
    );
  }

  const showingEmpty = directory.status === 'success' && directory.doctors.length === 0;
  const countLabel = directory.status === 'loading'
    ? 'Loading doctors…'
    : `${directory.doctors.length} ${directory.doctors.length === 1 ? 'doctor' : 'doctors'}`;

  return (
    <div className="flex flex-col gap-5">
      {/* -------------------------------------------------------- explainer --
          A tinted panel rather than a plain well: this paragraph is the one
          thing on the screen that changes how a patient reads everything else,
          so it is allowed to look like a statement. The wash uses flipping
          scales in both directions, so no `dark:` override is needed. */}
      <div
        className={cn(
          'flex items-start gap-3.5 rounded-card border border-primary-100 p-4 shadow-soft sm:p-5',
          'bg-gradient-to-br from-primary-50 via-surface to-accent-50',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'grid h-10 w-10 shrink-0 place-items-center rounded-field text-white',
            'bg-gradient-to-br from-primary-600 to-accent-700 shadow-soft',
            'dark:from-primary-400 dark:to-accent-300',
          )}
        >
          <Users className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="font-heading text-heading-sm text-default">
            One request, up to {limits.MAX_DOCTORS} doctors
          </p>
          <p className="mt-1.5 text-body-sm text-muted">
            They all receive the same request at the same time, and the first one to accept takes
            the appointment. The rest are closed out automatically. Choosing three is not three
            bookings; it is one booking with three chances of a fast reply.
          </p>
        </div>
      </div>

      {/*
        Filters sit in their own full-width band above the results instead of a
        squeezed sidebar. ONE instance, not one per breakpoint: below md the
        component renders a trigger button that opens a bottom sheet; from md up
        it renders its refining fields in an inline disclosure under the bar.
        Mounting it twice would mean two Drawers, two sets of field ids and two
        copies of the same state to keep in step.
      */}
      <DoctorFilters
        filters={directory.filters}
        setFilters={directory.setFilters}
        resetFilters={directory.resetFilters}
        sortBy={directory.sortBy}
        setSortBy={directory.setSortBy}
        cities={directory.cities}
        specialties={directory.specialties}
        geo={directory.geo}
        resultCount={directory.doctors.length}
      />

      {/* ---------------------------------------------------------- results -- */}
      <div className="min-w-0">
        {/* result count + chosen count + list/map toggle in one tidy toolbar */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <p className="min-w-0 text-label-lg text-default" aria-live="polite">
              {countLabel}
              {directory.hasPosition && directory.sortBy === 'distance' ? ', nearest first' : ''}
            </p>
            {/* The position is requested automatically, so its state is reported
                here rather than only inside the filter drawer. */}
            <span className="inline-flex items-center gap-1.5 text-caption text-subtle">
              <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              {directory.geo.status === 'loading' && 'Finding you, to measure distances'}
              {directory.geo.status === 'success' && 'Distances are from your location'}
              {directory.geo.status === 'error' && (directory.geo.error || 'Location unavailable')}
              {directory.geo.status === 'idle' && 'Share your location to see distances'}
            </span>
            <span
              className={cn(
                'inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-0.5 text-caption font-semibold',
                full
                  ? 'border-success-200 bg-success-50 text-success-700'
                  : 'border-default bg-surface-sunken text-muted',
              )}
            >
              <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
              {selected.length} of {limits.MAX_DOCTORS} chosen
            </span>
          </div>
          <ViewToggle view={view} onChange={setView} />
        </div>

        {/* ------------------------------------------------------ states -- */}
        {directory.status === 'loading' && (
          <SkeletonGroup label="Loading doctors" className="grid gap-4 sm:grid-cols-2">
            {[0, 1, 2, 3].map((key) => (
              <SkeletonCard key={key} lines={3} />
            ))}
          </SkeletonGroup>
        )}

        {directory.status === 'error' && (
          <Alert
            tone="danger"
            title="We could not load the doctor list"
            icon={<AlertTriangle aria-hidden="true" className="h-5 w-5" />}
            actions={
              <Button
                size="sm"
                variant="outline"
                onClick={directory.reload}
                leftIcon={<RefreshCw aria-hidden="true" className="h-4 w-4" />}
              >
                Try again
              </Button>
            }
          >
            {directory.error} Nothing you have entered has been lost.
          </Alert>
        )}

        {showingEmpty && (
          <EmptyState
            icon={<SearchX aria-hidden="true" className="h-6 w-6" />}
            tone="primary"
            title="No doctors match those filters"
            description="Widen the search: clearing the city or the maximum fee usually helps most."
            action={
              <Button variant="outline" onClick={directory.resetFilters}>
                Clear filters
              </Button>
            }
            size="sm"
            bordered
          />
        )}

        {/* -------------------------------------------------------- list -- */}
        {directory.status === 'success' && directory.doctors.length > 0 && view === 'list' && (
          <ul className="grid auto-rows-fr gap-4 sm:grid-cols-2">
            {directory.doctors.map((doctor) => {
              const isSelected = selectedIds.has(doctor.id);
              return (
                <li key={doctor.id} className="h-full">
                  <DoctorCard
                    doctor={doctor}
                    selected={isSelected}
                    disabled={full && !isSelected}
                    rank={isSelected
                      ? selected.findIndex((entry) => doctorIdOf(entry) === doctor.id) + 1
                      : undefined}
                    onToggle={handleToggle}
                    className="h-full"
                  />
                </li>
              );
            })}
          </ul>
        )}

        {/* --------------------------------------------------------- map -- */}
        {directory.status === 'success' && directory.doctors.length > 0 && view === 'map' && (
          <Suspense
            fallback={
              <div
                role="status"
                className="flex h-80 items-center justify-center rounded-card border border-default bg-surface-sunken"
              >
                <Spinner label="Loading map" />
              </div>
            }
          >
            <DoctorMap
              doctors={directory.doctors}
              selectedIds={selectedIds}
              onToggle={handleToggle}
              origin={directory.geo.position}
              full={full}
            />
          </Suspense>
        )}
      </div>

      {/* ------------------------------------------------------------- tray --
          Bleeds to the step card's own padding so it reads as a bar attached to
          the panel rather than a floating box. ConsultPage pads the panel
          `p-5 sm:p-8 lg:p-10`, and the tray's default only knows about its own
          `-mx-5 sm:-mx-6`, so BOTH larger steps have to be restated here or the
          bar sits inside a visible gutter from `sm` up. */}
      <SelectedDoctorsTray
        selected={selected}
        max={limits.MAX_DOCTORS}
        onRemove={handleToggle}
        onContinue={() => goToStepId('slots')}
        continueLabel="Choose times"
        canContinue={selected.length > 0}
        className="mt-0 sm:-mx-8 sm:px-8 lg:-mx-10 lg:px-10"
      />
    </div>
  );
}

export { StepDoctors };
