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
  RefreshCw,
  SearchX,
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

function ViewToggle({ view, onChange }) {
  const options = [
    { id: 'list', label: 'List', icon: List },
    { id: 'map', label: 'Map', icon: MapIcon },
  ];

  return (
    <div
      role="group"
      aria-label="Directory view"
      className="inline-flex rounded-field border border-subtle bg-surface-sunken p-0.5"
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
              'inline-flex items-center gap-1.5 rounded-control px-3 py-1.5 text-label-md',
              'outline-none transition-colors duration-150',
              'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1',
              'focus-visible:ring-offset-canvas',
              active
                ? 'bg-surface text-default shadow-soft'
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

  const directory = useDoctorDirectory({ enabled: isAuthenticated });

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

  return (
    <div className="space-y-4">
      {/* -------------------------------------------------------- explainer -- */}
      <div className="rounded-card border border-subtle bg-surface-sunken p-4">
        <p className="flex items-start gap-2 text-body-sm text-default">
          <Users aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary-700 dark:text-primary-400" />
          <span>
            Pick <strong>up to {limits.MAX_DOCTORS} doctors</strong>. They all receive the same
            request at the same time, and the first one to accept takes the appointment — the rest
            are closed out automatically. Choosing three is not three bookings; it is one booking
            with three chances of a fast reply.
          </span>
        </p>
      </div>

      {/* --------------------------------------------------------- controls -- */}
      <div className="flex items-center justify-between gap-3">
        <p className="min-w-0 truncate text-body-sm text-muted" aria-live="polite">
          {directory.status === 'loading'
            ? 'Loading doctors…'
            : `${directory.doctors.length} ${directory.doctors.length === 1 ? 'doctor' : 'doctors'}`}
          {directory.hasPosition && directory.sortBy === 'distance' ? ', nearest first' : ''}
        </p>
        <ViewToggle view={view} onChange={setView} />
      </div>

      <div className="grid gap-5 md:grid-cols-[16rem_minmax(0,1fr)]">
        {/*
          ONE instance, not one per breakpoint. Below md it renders as a button
          that opens a bottom sheet; from md up it renders as the sticky sidebar.
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

        <div className="min-w-0">
          {/* ------------------------------------------------------ states -- */}
          {directory.status === 'loading' && (
            <SkeletonGroup label="Loading doctors" className="grid gap-3 sm:grid-cols-2">
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
              description="Widen the search — clearing the city or the maximum fee usually helps most."
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
            <ul className="grid gap-3 sm:grid-cols-2">
              {directory.doctors.map((doctor) => {
                const isSelected = selectedIds.has(doctor.id);
                return (
                  <li key={doctor.id}>
                    <DoctorCard
                      doctor={doctor}
                      selected={isSelected}
                      disabled={full && !isSelected}
                      rank={isSelected
                        ? selected.findIndex((entry) => doctorIdOf(entry) === doctor.id) + 1
                        : undefined}
                      onToggle={handleToggle}
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
                  className="flex h-80 items-center justify-center rounded-card border border-subtle bg-surface-sunken"
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
      </div>

      {/* ------------------------------------------------------------- tray -- */}
      <SelectedDoctorsTray
        selected={selected}
        max={limits.MAX_DOCTORS}
        onRemove={handleToggle}
        onContinue={() => goToStepId('slots')}
        continueLabel="Choose times"
        canContinue={selected.length > 0}
      />
    </div>
  );
}

export { StepDoctors };
