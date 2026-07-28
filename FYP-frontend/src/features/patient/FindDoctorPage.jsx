/**
 * FindDoctorPage — a browsable directory of dermatologists.
 *
 * THE BUG THIS PAGE IS
 * --------------------
 * `NearbyDoctors` reads a scan out of `sessionStorage` on mount and, if there
 * isn't one, HARD REDIRECTS to `/try-now`. So "find a doctor" is unreachable
 * unless you have just run a scan — a patient who wants to know whether there is
 * a dermatologist in their city at all is bounced into uploading a photograph
 * first. The directory is public data (`/api/doctors/public` needs no token at
 * all); it should be browsable by anyone, at any time, and it is here.
 *
 * "Book with this doctor" therefore goes FORWARD into `/consult`, carrying the
 * doctor id, rather than the old direction of travel.
 *
 * FILTERING IS CLIENT-SIDE, DELIBERATELY
 * --------------------------------------
 * `/api/doctors/public` takes no query parameters — it returns the whole
 * directory in one array. Sending `?q=` would be a lie the backend ignores; the
 * filters live in the URL instead, so a filtered view is still linkable.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Stethoscope, UserSearch } from 'lucide-react';

import {
  Alert,
  Button,
  EmptyState,
  Field,
  SearchInput,
  Select,
  SkeletonCard,
} from '../../components/ui';
import { get } from '../../lib/api';
import { doctors as doctorEndpoints } from '../../lib/endpoints';
import { PATHS } from '../../routes';

import PageHeader from './components/PageHeader';
import DoctorCard from './components/DoctorCard';
import DoctorProfileDrawer from './components/DoctorProfileDrawer';
import { useResource } from './hooks/usePatientData';
import { realValue } from './lib/doctorDisplay';

const SORTS = [
  { value: 'rating', label: 'Highest rated' },
  { value: 'experience', label: 'Most experienced' },
  { value: 'fee', label: 'Lowest fee' },
  { value: 'name', label: 'Name (A–Z)' },
];

function haystack(doctor) {
  return [doctor.name, doctor.specialty, doctor.specialization, doctor.city, doctor.hospital]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

/** null sorts LAST in every direction — an unrated doctor is not the worst one. */
function compareBy(sort) {
  return (a, b) => {
    if (sort === 'name') return String(a.name || '').localeCompare(String(b.name || ''));
    if (sort === 'experience') return (Number(b.experience) || 0) - (Number(a.experience) || 0);
    if (sort === 'fee') {
      const feeA = Number(a.fees?.pkr) || Infinity;
      const feeB = Number(b.fees?.pkr) || Infinity;
      return feeA - feeB;
    }
    const ratingA = a.rating ?? a.average_rating;
    const ratingB = b.rating ?? b.average_rating;
    if (ratingA === null || ratingA === undefined) return 1;
    if (ratingB === null || ratingB === undefined) return -1;
    return Number(ratingB) - Number(ratingA);
  };
}

export default function FindDoctorPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [openDoctor, setOpenDoctor] = useState(null);

  const q = params.get('q') || '';
  const city = params.get('city') || '';
  const specialty = params.get('specialty') || '';
  const sort = params.get('sort') || 'rating';

  const setParam = useCallback((key, value) => {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value); else next.delete(key);
      return next;
    }, { replace: true });
  }, [setParams]);

  const { data, loading, error, refetch } = useResource(
    (signal) => get(doctorEndpoints.publicList(), { signal }),
    { initialData: [] },
  );

  const all = useMemo(() => (Array.isArray(data) ? data : []), [data]);

  /** Built from the payload, so the options can never list a city with 0 doctors. */
  const { cities, specialties } = useMemo(() => {
    const citySet = new Set();
    const specialtySet = new Set();
    all.forEach((doctor) => {
      const cityName = realValue(doctor.city);
      if (cityName) citySet.add(cityName);
      const specialtyName = realValue(doctor.specialty || doctor.specialization);
      if (specialtyName) specialtySet.add(specialtyName);
    });
    return {
      cities: [...citySet].sort((a, b) => a.localeCompare(b)),
      specialties: [...specialtySet].sort((a, b) => a.localeCompare(b)),
    };
  }, [all]);

  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all
      .filter((doctor) => {
        if (city && realValue(doctor.city) !== city) return false;
        if (specialty && realValue(doctor.specialty || doctor.specialization) !== specialty) return false;
        if (needle && !haystack(doctor).includes(needle)) return false;
        return true;
      })
      .sort(compareBy(sort));
  }, [all, q, city, specialty, sort]);

  const hasFilters = Boolean(q || city || specialty);
  const clearFilters = () => setParams(new URLSearchParams(sort !== 'rating' ? { sort } : {}), { replace: true });

  /** Forward into the scan stepper with the doctor pre-selected. */
  const book = useCallback((doctor) => {
    navigate(`${PATHS.CONSULT}?doctor=${encodeURIComponent(doctor.id)}`);
  }, [navigate]);

  return (
    <>
      <PageHeader
        title="Find a doctor"
        description="Every verified dermatologist on the platform. Browse freely, you do not need a scan to look."
        actions={
          <Button
            variant="ghost"
            size="sm"
            leftIcon={<RefreshCw className="h-4 w-4" />}
            onClick={refetch}
            loading={loading && all.length > 0}
          >
            Refresh
          </Button>
        }
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end sm:gap-3">
          <div className="sm:w-64">
            <SearchInput
              defaultValue={q}
              onDebouncedChange={(value) => setParam('q', value)}
              onClear={() => setParam('q', '')}
              placeholder="Search name, clinic or city"
              aria-label="Search doctors"
            />
          </div>
          <Field label="City" className="sm:w-44">
            <Select
              value={city}
              onChange={(event) => setParam('city', event.target.value)}
              options={[{ value: '', label: 'Any city' }, ...cities.map((name) => ({ value: name, label: name }))]}
            />
          </Field>
          <Field label="Specialty" className="sm:w-52">
            <Select
              value={specialty}
              onChange={(event) => setParam('specialty', event.target.value)}
              options={[
                { value: '', label: 'Any specialty' },
                ...specialties.map((name) => ({ value: name, label: name })),
              ]}
            />
          </Field>
          <Field label="Sort by" className="sm:w-44">
            <Select
              value={sort}
              options={SORTS}
              onChange={(event) => setParam('sort', event.target.value)}
            />
          </Field>
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="self-start">
              Clear
            </Button>
          )}
        </div>
      </PageHeader>

      {error && (
        <Alert
          tone="danger"
          title="We could not load the directory"
          className="mb-4"
          actions={<Button size="sm" variant="outline" onClick={refetch}>Try again</Button>}
        >
          {error}
        </Alert>
      )}

      {loading && all.length === 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true">
          {Array.from({ length: 6 }).map((_, index) => <SkeletonCard key={index} lines={3} />)}
        </div>
      )}

      {!loading && !error && results.length === 0 && (
        hasFilters ? (
          <EmptyState
            icon={<UserSearch className="h-6 w-6" aria-hidden="true" />}
            title="No doctors match those filters"
            description="Try a different city or clear the filters to see everyone."
            action={<Button variant="outline" onClick={clearFilters}>Clear filters</Button>}
          />
        ) : (
          <EmptyState
            icon={<Stethoscope className="h-6 w-6" aria-hidden="true" />}
            title="No doctors are listed yet"
            description="Dermatologists appear here once an admin has approved their licence."
          />
        )
      )}

      {results.length > 0 && (
        <>
          <p className="mb-3 font-body text-body-sm text-muted" aria-live="polite">
            {results.length} {results.length === 1 ? 'doctor' : 'doctors'}
            {hasFilters ? ' match your filters' : ' available'}.
          </p>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((doctor) => (
              <li key={doctor.id} className="h-full">
                <DoctorCard doctor={doctor} onOpen={setOpenDoctor} onBook={book} />
              </li>
            ))}
          </ul>
        </>
      )}

      <DoctorProfileDrawer
        doctor={openDoctor}
        open={Boolean(openDoctor)}
        onClose={() => setOpenDoctor(null)}
        onBook={book}
      />
    </>
  );
}
