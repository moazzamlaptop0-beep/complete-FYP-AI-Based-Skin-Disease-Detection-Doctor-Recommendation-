/**
 * DoctorFilters — narrow the directory down to the doctors a patient would
 * actually consider.
 *
 * ONE SET OF CONTROLS, TWO PLACEMENTS
 * -----------------------------------
 * The fields are declared ONCE in `FilterFields` and then rendered either inline
 * (md and up, as a sidebar) or inside a bottom Drawer (below md). Duplicating
 * the markup for "desktop filters" and "mobile filters" is how the two drift
 * apart — one gains a field, the other keeps the old label — so there is only
 * one copy here and the responsive decision is purely about where it is mounted.
 *
 * A phone is the likeliest device for this whole flow (the patient just took a
 * photo of their skin with it), so the mobile path is the one with the care:
 * a sticky trigger button that carries the active-filter count, a bottom sheet
 * that can be dismissed with Escape or a swipe-height drag handle, and a footer
 * with "Clear all" next to "Show N doctors" so the result count is visible
 * BEFORE the sheet closes.
 *
 * WHY THE RADIUS FIELD DISABLES ITSELF
 * ------------------------------------
 * Distance only exists once the browser has given us a position. Rendering an
 * enabled "within 5 km" control that silently does nothing would be a lie, so it
 * is disabled with the reason attached, and the "Use my location" button sits
 * directly above it.
 */

import React, { useId, useState } from 'react';
import { Crosshair, RotateCcw, SlidersHorizontal, X } from 'lucide-react';

import {
  Badge,
  Button,
  Drawer,
  Field,
  SearchInput,
  Select,
  Switch,
  cn,
} from '../../../components/ui';
import { activeFilterCount } from '../lib/doctorModel';

const RATING_OPTIONS = [
  { value: 0, label: 'Any rating' },
  { value: 3, label: '3 stars and up' },
  { value: 4, label: '4 stars and up' },
  { value: 4.5, label: '4.5 stars and up' },
];

const FEE_OPTIONS = [
  { value: '', label: 'Any fee' },
  { value: 1000, label: 'Up to Rs 1,000' },
  { value: 2000, label: 'Up to Rs 2,000' },
  { value: 3000, label: 'Up to Rs 3,000' },
  { value: 5000, label: 'Up to Rs 5,000' },
];

const RADIUS_OPTIONS = [
  { value: '', label: 'Any distance' },
  { value: 5, label: 'Within 5 km' },
  { value: 10, label: 'Within 10 km' },
  { value: 25, label: 'Within 25 km' },
  { value: 50, label: 'Within 50 km' },
];

const SORT_OPTIONS = [
  { value: 'rating', label: 'Best rated' },
  { value: 'distance', label: 'Nearest first' },
  { value: 'fee', label: 'Lowest fee' },
  { value: 'name', label: 'Name (A-Z)' },
];

/**
 * The fields themselves. Rendered inline on desktop and inside the Drawer on a
 * phone — never both at once.
 */
function FilterFields({
  filters,
  setFilters,
  sortBy,
  setSortBy,
  cities,
  specialties,
  geo,
  idPrefix,
}) {
  const hasPosition = Boolean(geo?.position);

  return (
    <div className="space-y-4">
      <Field label="Search" id={`${idPrefix}-q`}>
        <SearchInput
          value={filters.q}
          onChange={(event) => setFilters({ q: event.target.value })}
          placeholder="Name, hospital or city"
        />
      </Field>

      <Field label="City" id={`${idPrefix}-city`}>
        <Select
          value={filters.city}
          onChange={(event) => setFilters({ city: event.target.value })}
        >
          <option value="">Any city</option>
          {cities.map((city) => (
            <option key={city} value={city}>{city}</option>
          ))}
        </Select>
      </Field>

      <Field label="Specialty" id={`${idPrefix}-specialty`}>
        <Select
          value={filters.specialty}
          onChange={(event) => setFilters({ specialty: event.target.value })}
        >
          <option value="">Any specialty</option>
          {specialties.map((specialty) => (
            <option key={specialty} value={specialty}>{specialty}</option>
          ))}
        </Select>
      </Field>

      <Field label="Minimum rating" id={`${idPrefix}-rating`}>
        <Select
          value={String(filters.minRating)}
          onChange={(event) => setFilters({ minRating: Number(event.target.value) })}
          options={RATING_OPTIONS.map((option) => ({
            value: String(option.value),
            label: option.label,
          }))}
        />
      </Field>

      <Field
        label="Maximum fee"
        id={`${idPrefix}-fee`}
        hint="Doctors who have not published a fee are always shown."
      >
        <Select
          value={String(filters.maxFee)}
          onChange={(event) => setFilters({
            maxFee: event.target.value === '' ? '' : Number(event.target.value),
          })}
          options={FEE_OPTIONS.map((option) => ({
            value: String(option.value),
            label: option.label,
          }))}
        />
      </Field>

      {/* ------------------------------------------------------- distance -- */}
      <div className="space-y-2 rounded-card border border-subtle bg-surface-sunken p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-label-md text-default">Distance</p>
          <Button
            type="button"
            size="sm"
            variant={hasPosition ? 'ghost' : 'outline'}
            loading={geo?.status === 'loading'}
            onClick={geo?.request}
            leftIcon={<Crosshair aria-hidden="true" className="h-4 w-4" />}
          >
            {hasPosition ? 'Update location' : 'Use my location'}
          </Button>
        </div>

        <Field
          label="Search radius"
          id={`${idPrefix}-radius`}
          hint={hasPosition
            ? 'Straight-line distance from you, not driving distance.'
            : 'Share your location to sort and filter by distance.'}
          disabled={!hasPosition}
        >
          <Select
            value={String(filters.radiusKm)}
            onChange={(event) => setFilters({
              radiusKm: event.target.value === '' ? '' : Number(event.target.value),
            })}
            options={RADIUS_OPTIONS.map((option) => ({
              value: String(option.value),
              label: option.label,
            }))}
          />
        </Field>

        {geo?.error && (
          <p role="status" className="text-caption text-warning-600 dark:text-warning-400">
            {geo.error}
          </p>
        )}
      </div>

      <Field label="Sort by" id={`${idPrefix}-sort`}>
        <Select
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value)}
          options={SORT_OPTIONS.map((option) => ({
            ...option,
            disabled: option.value === 'distance' && !hasPosition,
          }))}
        />
      </Field>

      <div className="space-y-3 border-t border-subtle pt-4">
        <Switch
          checked={filters.availableOnly}
          onChange={(event) => setFilters({ availableOnly: event.target.checked })}
          label="Publishes working hours"
          description="Hides doctors who have not set up a weekly schedule yet."
          labelPosition="left"
          className="w-full items-start justify-between gap-4"
        />
        <Switch
          checked={filters.verifiedOnly}
          onChange={(event) => setFilters({ verifiedOnly: event.target.checked })}
          label="Verified doctors only"
          description="Admin has checked their licence. Unverified ones are badged, not hidden."
          labelPosition="left"
          className="w-full items-start justify-between gap-4"
        />
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.filters
 * @param {(patch:object)=>void} props.setFilters
 * @param {()=>void} props.resetFilters
 * @param {string} props.sortBy
 * @param {(value:string)=>void} props.setSortBy
 * @param {string[]} props.cities
 * @param {string[]} props.specialties
 * @param {object} props.geo useGeolocation() result
 * @param {number} props.resultCount How many doctors survive the current filters.
 */
export default function DoctorFilters({
  filters,
  setFilters,
  resetFilters,
  sortBy,
  setSortBy,
  cities,
  specialties,
  geo,
  resultCount,
  className,
}) {
  const [open, setOpen] = useState(false);
  const uid = useId();
  const active = activeFilterCount(filters);

  const shared = {
    filters,
    setFilters,
    sortBy,
    setSortBy,
    cities,
    specialties,
    geo,
  };

  return (
    <>
      {/* ---------------------------------------------- phone: sheet trigger -- */}
      <div className={cn('flex items-center gap-2 md:hidden', className)}>
        <Button
          type="button"
          variant="outline"
          onClick={() => setOpen(true)}
          leftIcon={<SlidersHorizontal aria-hidden="true" className="h-4 w-4" />}
          fullWidth
        >
          Filters
          {active > 0 && (
            <Badge tone="primary" size="sm" className="ml-2">{active}</Badge>
          )}
        </Button>
        {active > 0 && (
          <Button
            type="button"
            variant="ghost"
            onClick={resetFilters}
            leftIcon={<X aria-hidden="true" className="h-4 w-4" />}
          >
            Clear
          </Button>
        )}
      </div>

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        side="bottom"
        size="xl"
        showHandle
        title="Filter doctors"
        description="Everything here is optional."
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <Button
              type="button"
              variant="ghost"
              onClick={resetFilters}
              leftIcon={<RotateCcw aria-hidden="true" className="h-4 w-4" />}
            >
              Clear all
            </Button>
            <Button type="button" onClick={() => setOpen(false)}>
              Show {resultCount} {resultCount === 1 ? 'doctor' : 'doctors'}
            </Button>
          </div>
        }
      >
        <FilterFields {...shared} idPrefix={`${uid}-sheet`} />
      </Drawer>

      {/* ------------------------------------------------- desktop: sidebar -- */}
      <aside
        aria-label="Doctor filters"
        className={cn('hidden md:block', className)}
      >
        <div className="sticky top-4 rounded-card border border-subtle bg-surface p-4">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h3 className="text-label-lg text-default">Filters</h3>
            {active > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                leftIcon={<RotateCcw aria-hidden="true" className="h-4 w-4" />}
              >
                Clear
              </Button>
            )}
          </div>
          <FilterFields {...shared} idPrefix={`${uid}-side`} />
          <p className="mt-4 border-t border-subtle pt-3 text-caption text-subtle" aria-live="polite">
            {resultCount} {resultCount === 1 ? 'doctor matches' : 'doctors match'}
          </p>
        </div>
      </aside>
    </>
  );
}

export { DoctorFilters };
