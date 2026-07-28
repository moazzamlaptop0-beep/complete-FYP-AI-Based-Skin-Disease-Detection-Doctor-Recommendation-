/**
 * DoctorFields — everything the platform needs to verify a clinician, revealed
 * by the "I am a healthcare professional" switch.
 *
 * WHY IT IS A DISCLOSURE AND NOT A SECOND FORM
 * --------------------------------------------
 * The old RegisterPage had a "Patient / Doctor" tab pair, so a doctor who
 * wanted their own scan history had to decide, on their first screen, which
 * kind of user they were — and the two answers produced two different accounts.
 * The RBAC hierarchy makes that unnecessary: 'Doctor' holds every patient
 * permission, so this is not a different account type, it is extra information
 * about the same one.
 *
 * WHAT THE BACKEND DOES WITH IT
 * -----------------------------
 * `license` is the only REQUIRED field (`/auth/register` 400s without it and
 * rejects a duplicate, before any row is written). Everything else is stored on
 * DoctorProfile and can be completed later from the doctor's own profile page.
 * `verification_status` always starts 'pending': a new doctor cannot review a
 * case until an admin approves the licence, which is why signup ends on
 * DoctorPendingStep rather than a dashboard.
 *
 * THE LOCATION IS ONE FACT WITH TWO INPUTS
 * ----------------------------------------
 * `city`, `state`, `country`, `latitude` and `longitude` all describe the same
 * clinic, so the searchable `LocationSearch` and the map below it are two views
 * of one value and are kept in lockstep:
 *
 *   pick a place  -> city + state + country + coordinates, and the pin moves
 *   move the pin  -> reverse geocoded back into city + state + country
 *   type anything -> stored verbatim as the city
 *
 * That last line is the important one. The whole block is OPTIONAL: a doctor
 * whose town is not in OpenStreetMap, or who is behind a firewall that blocks
 * the lookup, types their city and registers. Nothing here can ever gate the
 * submit button.
 *
 * The map is `React.lazy` — see ClinicLocationPicker for why Leaflet must not
 * be in the sign-in bundle.
 */

import React, { Suspense, lazy, useMemo } from 'react';
import { BadgeCheck } from 'lucide-react';

import { Alert, Field, Input, LocationSearch, Select, Skeleton } from '../../../components/ui';
import { formatPlaceLabel } from '../../../lib/geocode';

const ClinicLocationPicker = lazy(() => import('./ClinicLocationPicker'));

/** Common PMDC specialties; free text is still allowed via "Other". */
const SPECIALTIES = [
  'Dermatology',
  'General Physician',
  'Family Medicine',
  'Plastic Surgery',
  'Paediatrics',
  'Internal Medicine',
  'Oncology',
  'Other',
];

/** A finite number, or null for '', null, undefined and rubbish. */
function numberOrNull(raw) {
  if (raw === '' || raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * @param {object} props
 * @param {object} props.value `{license, specialty, hospital, city, state, country,
 *   phone, experience, latitude, longitude}`
 * @param {(patch: object) => void} props.onChange Shallow-merged into `value`.
 * @param {Record<string,string>} props.fieldErrors
 * @param {boolean} [props.disabled]
 */
export default function DoctorFields({ value, onChange, fieldErrors = {}, disabled = false }) {
  const set = (key) => (event) => onChange({ [key]: event.target.value });

  const latitude = numberOrNull(value.latitude);
  const longitude = numberOrNull(value.longitude);

  const city = String(value.city || '').trim();
  const state = String(value.state || '').trim();
  const country = String(value.country || '').trim();

  /**
   * The combobox's committed selection, rebuilt from the payload rather than
   * stored twice. `label` is derived, so nothing extra rides along to the API,
   * and a value that is nothing but coordinates stays `null` (the pin is real,
   * the place name is not yet).
   */
  const location = useMemo(() => {
    if (!city && !state && !country) return null;
    return {
      label: formatPlaceLabel({ city, state, country }),
      city,
      state,
      country,
      latitude,
      longitude,
    };
  }, [city, state, country, latitude, longitude]);

  /** A place chosen from the list, or `null` when the field is cleared. */
  const handleLocationChange = (place) => {
    if (!place) {
      onChange({ city: '', state: '', country: '' });
      return;
    }
    onChange({
      city: place.city || place.label || '',
      state: place.state || '',
      country: place.country || '',
      latitude: Number.isFinite(place.latitude) ? place.latitude : latitude,
      longitude: Number.isFinite(place.longitude) ? place.longitude : longitude,
    });
  };

  /**
   * Free text. Kept verbatim as the city so a lookup that finds nothing, or
   * never runs at all, still produces a registerable profile. The coordinates
   * survive: a pin placed on the map is not invalidated by retyping the city.
   */
  const handleLocationText = (text) => {
    onChange({ city: text, state: '', country: '' });
  };

  /** A user-placed pin, named by the reverse lookup. Coordinates already sent. */
  const handleResolvedPlace = (place) => {
    onChange({
      city: place.city || city,
      state: place.state || '',
      country: place.country || '',
    });
  };

  return (
    <div className="space-y-4 rounded-card border border-primary-200 bg-primary-50/60 p-4">
      <div className="flex items-start gap-2">
        <BadgeCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-primary-700 dark:text-accent-400" />
        <div>
          <p className="font-body text-label-lg text-default">Professional details</p>
          <p className="text-caption text-muted">
            An admin checks your PMDC licence before you can review patient cases.
            You can still use every patient feature straight away.
          </p>
        </div>
      </div>

      <Field
        label="PMDC licence number"
        error={fieldErrors.license}
        hint="Exactly as it appears on your PMDC registration."
        required
      >
        <Input
          name="license"
          value={value.license || ''}
          onChange={set('license')}
          placeholder="e.g. 12345-P"
          autoComplete="off"
          disabled={disabled}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Specialty" error={fieldErrors.specialty}>
          <Select
            name="specialty"
            value={value.specialty || ''}
            onChange={set('specialty')}
            placeholder="Select a specialty"
            options={SPECIALTIES.map((item) => ({ value: item, label: item }))}
            disabled={disabled}
          />
        </Field>

        <Field label="Years of experience" error={fieldErrors.experience}>
          <Input
            name="experience"
            type="number"
            min="0"
            max="70"
            inputMode="numeric"
            value={value.experience ?? ''}
            onChange={set('experience')}
            placeholder="0"
            disabled={disabled}
          />
        </Field>

        <Field label="Hospital or clinic" error={fieldErrors.hospital}>
          <Input
            name="hospital"
            value={value.hospital || ''}
            onChange={set('hospital')}
            placeholder="e.g. Shifa International"
            autoComplete="organization"
            disabled={disabled}
          />
        </Field>

        <Field label="Contact number" error={fieldErrors.phone} hint="Shown to patients who book with you.">
          <Input
            name="phone"
            type="tel"
            inputMode="tel"
            value={value.phone || ''}
            onChange={set('phone')}
            placeholder="+92 300 0000000"
            autoComplete="tel"
            disabled={disabled}
          />
        </Field>
      </div>

      {/* CITY, PROVINCE and COUNTRY in one control. The label stays "City"
          because that is the field a doctor is looking for. */}
      <div className="space-y-1.5">
        <LocationSearch
          name="city"
          label="City"
          value={location}
          onChange={handleLocationChange}
          onTextChange={handleLocationText}
          error={fieldErrors.city || fieldErrors.state || fieldErrors.country}
          hint="Start typing and pick your city, we will fill in the province and country. You can also just type it."
          placeholder="e.g. Islamabad"
          disabled={disabled}
        />
        {(state || country) && (
          <p className="text-caption text-muted">
            We will also save
            {' '}
            <span className="font-medium text-default">
              {[state, country].filter(Boolean).join(' and ')}
            </span>
            {' '}
            with your profile.
          </p>
        )}
      </div>

      <div>
        <p className="mb-2 font-body text-label-md text-default">
          Clinic location <span className="font-normal text-subtle">(optional)</span>
        </p>
        <Suspense
          fallback={(
            <div className="space-y-2">
              <Skeleton className="h-56 w-full rounded-card" />
              <p className="text-caption text-subtle">Loading the map…</p>
            </div>
          )}
        >
          <ClinicLocationPicker
            latitude={latitude}
            longitude={longitude}
            onChange={(nextLatitude, nextLongitude) => onChange({
              latitude: nextLatitude,
              longitude: nextLongitude,
            })}
            onResolvePlace={handleResolvedPlace}
          />
        </Suspense>
      </div>

      <Alert tone="info" className="text-caption">
        Registering as a doctor does not limit you: your account keeps every
        patient feature, so you never need a second one to scan your own skin.
      </Alert>
    </div>
  );
}

export { DoctorFields, SPECIALTIES };
