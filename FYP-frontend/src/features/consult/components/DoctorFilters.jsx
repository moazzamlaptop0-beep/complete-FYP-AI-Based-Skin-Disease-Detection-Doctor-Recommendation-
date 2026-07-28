/**
 * DoctorFilters — narrow the directory down to the doctors a patient would
 * actually consider.
 *
 * ONE SET OF CONTROLS, TWO PLACEMENTS
 * -----------------------------------
 * The refining fields are declared ONCE in `FilterFields` and then rendered
 * either inline (md and up, inside a disclosure panel under the bar) or inside a
 * bottom Drawer (below md). Duplicating the markup for "desktop filters" and
 * "mobile filters" is how the two drift apart — one gains a field, the other
 * keeps the old label — so there is only one copy here. `layout` changes the
 * CONTAINER (a stack in the sheet, a grid in the bar) and nothing else: the
 * labels, the option lists, the hints and the handlers are single-source.
 *
 * WHY SEARCH AND SORT LIVE IN THE BAR AND NOT IN `FilterFields`
 * ------------------------------------------------------------
 * They are the two controls people reach for first and the two they want to see
 * the current value of without opening anything, so they sit in the always-
 * visible bar at every breakpoint. Keeping them OUT of `FilterFields` is also
 * what stops them being rendered twice at once, which would put two inputs on
 * one piece of state and let a phone user type into the one that is off screen.
 *
 * ACTIVE FILTERS ARE CHIPS, AND EACH CHIP UNDOES ITSELF
 * ----------------------------------------------------
 * A count badge ("3") tells you that something is narrowing the list but not
 * what, so the only way to find the filter that emptied the directory is to open
 * the panel and read every field. The chip row names each active filter in the
 * words the control used and removes just that one on click, which is the
 * difference between "clear all and start again" and "drop the fee cap".
 *
 * WHY THE RADIUS FIELD DISABLES ITSELF
 * ------------------------------------
 * Distance only exists once the browser has given us a position. Rendering an
 * enabled "within 5 km" control that silently does nothing would be a lie, so it
 * is disabled with the reason attached, and the "Use my location" button sits
 * directly above it.
 */

import React, { useId, useState } from 'react';
import {
  Crosshair,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  X,
} from 'lucide-react';

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

/** Label lookup for the chip row, so a chip never invents its own wording. */
function labelOf(options, value) {
  const match = options.find((option) => String(option.value) === String(value));
  return match ? match.label : String(value);
}

/**
 * The active filters, in the order they appear in the panel, each with the patch
 * that switches it back off. Pure, so the chip row and the count can never
 * disagree about what is on.
 * @param {object} filters
 * @returns {Array<{id:string, label:string, patch:object}>}
 */
function activeChips(filters) {
  const chips = [];
  if (filters?.q) chips.push({ id: 'q', label: `“${filters.q}”`, patch: { q: '' } });
  if (filters?.city) chips.push({ id: 'city', label: filters.city, patch: { city: '' } });
  if (filters?.specialty) {
    chips.push({ id: 'specialty', label: filters.specialty, patch: { specialty: '' } });
  }
  if (filters?.minRating) {
    chips.push({
      id: 'minRating',
      label: labelOf(RATING_OPTIONS, filters.minRating),
      patch: { minRating: 0 },
    });
  }
  if (filters?.maxFee !== '' && filters?.maxFee !== undefined && filters?.maxFee !== null) {
    chips.push({ id: 'maxFee', label: labelOf(FEE_OPTIONS, filters.maxFee), patch: { maxFee: '' } });
  }
  if (filters?.radiusKm !== '' && filters?.radiusKm !== undefined && filters?.radiusKm !== null) {
    chips.push({
      id: 'radiusKm',
      label: labelOf(RADIUS_OPTIONS, filters.radiusKm),
      patch: { radiusKm: '' },
    });
  }
  if (filters?.availableOnly) {
    chips.push({ id: 'availableOnly', label: 'Publishes hours', patch: { availableOnly: false } });
  }
  if (filters?.verifiedOnly) {
    chips.push({ id: 'verifiedOnly', label: 'Verified only', patch: { verifiedOnly: false } });
  }
  return chips;
}

/**
 * The refining fields. Rendered inside the bar's disclosure panel at md+ and
 * inside the Drawer on a phone — never both at once.
 * @param {'stack'|'grid'} layout Container only. The fields are identical.
 */
function FilterFields({
  filters,
  setFilters,
  cities,
  specialties,
  geo,
  idPrefix,
  layout = 'stack',
}) {
  const hasPosition = Boolean(geo?.position);
  const grid = layout === 'grid';

  return (
    <div className={cn(grid ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3' : 'space-y-4')}>
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

      {/* ------------------------------------------------------- distance --
          `border-default` rather than `border-subtle`: in light mode the subtle
          line token and the sunken surface token resolve to the same rgb, so a
          subtle border on a sunken well cannot be seen at all. */}
      <div
        className={cn(
          'space-y-2.5 rounded-card border border-default bg-surface-sunken p-3',
          grid && 'sm:col-span-2 lg:col-span-1',
        )}
      >
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
          <p role="status" className="text-caption text-warning-700">
            {geo.error}
          </p>
        )}
      </div>

      <div
        className={cn(
          'space-y-3 rounded-card border border-default bg-surface-sunken p-3',
          grid && 'sm:col-span-2 sm:grid sm:grid-cols-2 sm:gap-4 sm:space-y-0 lg:col-span-3',
        )}
      >
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const uid = useId();
  const active = activeFilterCount(filters);
  const chips = activeChips(filters);
  const panelId = `${uid}-panel`;
  const hasPosition = Boolean(geo?.position);

  const shared = {
    filters,
    setFilters,
    cities,
    specialties,
    geo,
  };

  return (
    <section
      aria-label="Search and filter doctors"
      className={cn(
        'rounded-card border border-subtle bg-surface p-3 shadow-soft sm:p-4',
        className,
      )}
    >
      {/* ------------------------------------------------------------- bar --
          Search always visible, sort beside it, then ONE control that opens the
          refining fields: a disclosure panel at md+, a bottom sheet below. */}
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <SearchInput
            value={filters.q}
            onChange={(event) => setFilters({ q: event.target.value })}
            placeholder="Name, hospital or city"
            aria-label="Search doctors by name, hospital or city"
          />
        </div>

        <div className="flex items-center gap-2.5">
          {/* Its own aria-label rather than a visible one: the bar is a toolbar,
              and a stacked "Sort by" caption above a 44-wide select is the thing
              that makes a filter row look like a form. */}
          <div className="min-w-0 flex-1 lg:w-44 lg:flex-none">
            <Select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value)}
              aria-label="Sort doctors by"
              options={SORT_OPTIONS.map((option) => ({
                ...option,
                disabled: option.value === 'distance' && !hasPosition,
              }))}
            />
          </div>

          {/* phone: the bottom sheet */}
          <Button
            type="button"
            variant="outline"
            onClick={() => setSheetOpen(true)}
            leftIcon={<SlidersHorizontal aria-hidden="true" className="h-4 w-4" />}
            className="shrink-0 md:hidden"
          >
            Filters
            {active > 0 && (
              <Badge tone="primary" size="sm" className="ml-2">{active}</Badge>
            )}
          </Button>

          {/* md and up: the inline disclosure */}
          <Button
            type="button"
            variant={panelOpen ? 'soft' : 'outline'}
            onClick={() => setPanelOpen((value) => !value)}
            aria-expanded={panelOpen}
            aria-controls={panelId}
            leftIcon={<SlidersHorizontal aria-hidden="true" className="h-4 w-4" />}
            className="hidden shrink-0 md:inline-flex"
          >
            {panelOpen ? 'Hide filters' : 'Filters'}
            {active > 0 && (
              <Badge tone="primary" size="sm" className="ml-2">{active}</Badge>
            )}
          </Button>
        </div>
      </div>

      {/* --------------------------------------------------- active filters -- */}
      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-subtle pt-3">
          <span className="flex items-center gap-1.5 text-caption text-subtle">
            <Sparkles aria-hidden="true" className="h-3.5 w-3.5" />
            Narrowed by
          </span>
          <ul className="flex min-w-0 flex-wrap gap-2">
            {chips.map((chip) => (
              <li key={chip.id}>
                <button
                  type="button"
                  onClick={() => setFilters(chip.patch)}
                  aria-label={`Remove filter ${chip.label}`}
                  className={cn(
                    'inline-flex max-w-[14rem] items-center gap-1.5 rounded-pill border',
                    'border-primary-200 bg-primary-50 py-1 pl-2.5 pr-2 text-caption',
                    'font-medium text-primary-900 outline-none transition-colors duration-150',
                    'hover:border-primary-400 hover:bg-primary-100',
                    'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
                    'focus-visible:ring-offset-surface',
                  )}
                >
                  <span className="truncate">{chip.label}</span>
                  <X aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                </button>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={resetFilters}
            leftIcon={<RotateCcw aria-hidden="true" className="h-4 w-4" />}
          >
            Clear all
          </Button>
        </div>
      )}

      {/* ------------------------------------------- md+ disclosure panel --
          Unmounted when closed rather than hidden, so the sheet and the panel
          can never both hold a live copy of the same field. */}
      {panelOpen && (
        <div
          id={panelId}
          className="mt-3 hidden border-t border-subtle pt-4 md:block animate-ui-slide-down motion-reduce:animate-none"
        >
          <FilterFields {...shared} idPrefix={`${uid}-panel`} layout="grid" />
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-subtle pt-3">
            <p className="text-caption text-subtle" aria-live="polite">
              {resultCount} {resultCount === 1 ? 'doctor matches' : 'doctors match'}
            </p>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPanelOpen(false)}>
              Done
            </Button>
          </div>
        </div>
      )}

      {/* ------------------------------------------------ phone: the sheet -- */}
      <Drawer
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
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
            <Button type="button" onClick={() => setSheetOpen(false)}>
              Show {resultCount} {resultCount === 1 ? 'doctor' : 'doctors'}
            </Button>
          </div>
        }
      >
        <FilterFields {...shared} idPrefix={`${uid}-sheet`} layout="stack" />
      </Drawer>
    </section>
  );
}

export { DoctorFilters };
