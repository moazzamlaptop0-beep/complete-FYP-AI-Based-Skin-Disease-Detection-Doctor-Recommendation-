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
 * The map is `React.lazy` — see ClinicLocationPicker for why Leaflet must not
 * be in the sign-in bundle.
 */

import React, { Suspense, lazy } from 'react';
import { BadgeCheck } from 'lucide-react';

import { Alert, Field, Input, Select, Skeleton } from '../../../components/ui';

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

/**
 * @param {object} props
 * @param {object} props.value `{license, specialty, hospital, city, phone, experience, latitude, longitude}`
 * @param {(patch: object) => void} props.onChange Shallow-merged into `value`.
 * @param {Record<string,string>} props.fieldErrors
 * @param {boolean} [props.disabled]
 */
export default function DoctorFields({ value, onChange, fieldErrors = {}, disabled = false }) {
  const set = (key) => (event) => onChange({ [key]: event.target.value });

  return (
    <div className="space-y-4 rounded-card border border-primary-200 bg-primary-50/60 p-4 dark:border-primary-800 dark:bg-primary-950/40">
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

        <Field label="City" error={fieldErrors.city}>
          <Input
            name="city"
            value={value.city || ''}
            onChange={set('city')}
            placeholder="e.g. Islamabad"
            autoComplete="address-level2"
            disabled={disabled}
          />
        </Field>
      </div>

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
            latitude={Number.isFinite(Number(value.latitude)) && value.latitude !== '' && value.latitude !== null
              ? Number(value.latitude) : null}
            longitude={Number.isFinite(Number(value.longitude)) && value.longitude !== '' && value.longitude !== null
              ? Number(value.longitude) : null}
            onChange={(latitude, longitude) => onChange({ latitude, longitude })}
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
