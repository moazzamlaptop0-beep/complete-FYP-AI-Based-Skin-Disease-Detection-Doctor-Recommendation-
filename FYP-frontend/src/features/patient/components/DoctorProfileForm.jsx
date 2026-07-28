/**
 * DoctorProfileForm — the clinic half of a doctor's account.
 *
 * THREE THINGS MOVED THIS ROUND, AND WHY
 * --------------------------------------
 * 1. THE TEXT FIELDS NOW GO THROUGH `PATCH /api/profile` (`{doctor: {...}}`),
 *    not the legacy multipart `POST /api/doctor/profile`. The old route applied
 *    only TRUTHY values, so a doctor who left a clinic could not remove the old
 *    hospital name: deleting the contents of the box did nothing at all. The new
 *    route treats an empty string as "clear this", so blanking a field finally
 *    means what it looks like. The header copy changed with it.
 * 2. THE EMAIL FIELD IS GONE. It used to sit in this form and reach
 *    `user.email` with no verification whatsoever, which made a stolen session
 *    enough to move the account to another inbox. The address now belongs to the
 *    OTP flow in EmailChangeCard, and the backend rejects it here.
 * 3. LATITUDE AND LONGITUDE ARE EDITABLE. `/api/doctors/public` ranks "nearby
 *    doctors" by these two columns, and until now a doctor who moved clinic had
 *    no way to correct them: the map pin was collected once at registration and
 *    then frozen, so patients kept being sent to an old address. `state` and
 *    `country` came along for the same reason.
 *
 * THE PHOTO IS DELIBERATELY STILL THE OTHER ROUTE
 * ----------------------------------------------
 * `profile_image` is the PUBLIC headshot served unauthenticated from
 * `/api/doctors/<id>/photo` for the directory. It is a different picture from the
 * private account avatar and only `POST /api/doctor/profile` stores it, so a save
 * with a new photo is two calls: the JSON patch, then the multipart upload with
 * `profile_image` alone. Content-Type is never set by hand — `lib/api.js` passes
 * FormData through so the browser owns the boundary.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, MapPin, Save } from 'lucide-react';

import {
  Alert,
  Avatar,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  Input,
  LocationSearch,
  notify,
} from '../../../components/ui';
import { ApiError, profile as profileApi, request } from '../../../lib/api';
import { doctors as doctorEndpoints } from '../../../lib/endpoints';
import { AVATAR_LIMITS, prettyBytes, validateImageFile } from '../../../lib/imageFile';
import { resolveImageUrl } from '../../../lib/imageUrl';

const TEXT_FIELDS = [
  { name: 'specialty', label: 'Specialty', placeholder: 'Dermatology' },
  { name: 'hospital', label: 'Clinic or hospital' },
  { name: 'phone', label: 'Clinic phone', type: 'tel', autoComplete: 'tel' },
  { name: 'experience', label: 'Years of experience', type: 'number' },
];

/** Everything this form sends inside `doctor`. */
const DOCTOR_KEYS = [
  'specialty', 'hospital', 'city', 'phone', 'experience',
  'state', 'country', 'latitude', 'longitude', 'license',
];

/** Of those, the ones backed by a numeric column. */
const NUMERIC_KEYS = ['experience', 'latitude', 'longitude'];

/** Same 5 MB / PNG-JPG-WebP rules as the account avatar, and the same messages. */
const PHOTO_LIMITS = AVATAR_LIMITS;
const ACCEPT = PHOTO_LIMITS.ACCEPTED_TYPES.join(',');

/** See AvatarUploader: white on `primary-600` is 3.0:1 in dark mode, so no fill. */
const FILE_INPUT_CLASS = [
  'block w-full max-w-xs font-body text-body-sm text-muted',
  'file:mr-3 file:cursor-pointer file:rounded-control file:border file:border-default',
  'file:bg-surface-raised file:px-3 file:py-2 file:font-body file:text-label-md file:text-default',
  'hover:file:bg-surface-sunken',
  'rounded-field outline-none focus-visible:ring-2 focus-visible:ring-focus',
  'focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
].join(' ');

const asText = (value) => (value === null || value === undefined ? '' : String(value));

/** A finite number, or null. Latitude/longitude are numeric columns. */
function toCoordinate(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function valuesFrom(doctor) {
  return {
    specialty: asText(doctor?.specialty),
    hospital: asText(doctor?.hospital),
    city: asText(doctor?.city),
    phone: asText(doctor?.phone),
    experience: asText(doctor?.experience),
    state: asText(doctor?.state),
    country: asText(doctor?.country),
    latitude: asText(doctor?.latitude),
    longitude: asText(doctor?.longitude),
    license: asText(doctor?.license),
  };
}

/**
 * @param {object} props
 * @param {object|null} props.doctor The `doctor` block from GET /api/profile.
 * @param {string} [props.name] The account name, for the photo's initials
 *   fallback — the `doctor` block carries clinic columns, not the person's name.
 * @param {(next: object) => void} [props.onSaved] Handed the PATCH response.
 */
export default function DoctorProfileForm({ doctor, name, onSaved }) {
  // The baseline is keyed on the VALUES, not on the object identity. The page
  // holds one profile and merges into it, so an avatar upload or an email change
  // hands down a new reference with identical clinic columns — and re-seating the
  // form on that would throw away whatever the doctor had half-typed here.
  const snapshot = JSON.stringify(valuesFrom(doctor));
  const initial = useMemo(() => JSON.parse(snapshot), [snapshot]);

  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);
  /** The by-hand escape hatch for a place OpenStreetMap does not know. */
  const [manual, setManual] = useState(false);

  const fileInput = useRef(null);
  const previewUrl = useRef(null);

  useEffect(() => {
    setValues(initial);
    setErrors({});
  }, [initial]);

  // One object URL at a time, revoked on replace and on unmount.
  useEffect(() => () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
  }, []);

  const setValue = (name) => (event) => {
    const next = event.target.value;
    setSaved(false);
    setValues((previous) => ({ ...previous, [name]: next }));
    setErrors((previous) => (previous[name] ? { ...previous, [name]: undefined } : previous));
  };

  const pickFile = (event) => {
    const next = event.target.files?.[0] || null;
    if (!next) return;

    const invalid = validateImageFile(next, PHOTO_LIMITS);
    if (invalid) {
      if (fileInput.current) fileInput.current.value = '';
      setErrors((previous) => ({ ...previous, profile_image: invalid }));
      return;
    }

    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = URL.createObjectURL(next);
    setErrors((previous) => ({ ...previous, profile_image: undefined }));
    setSaved(false);
    setFile(next);
    setPreview(previewUrl.current);
  };

  /** The committed selection LocationSearch renders, built from the four columns. */
  const location = useMemo(() => {
    const label = [values.city, values.state, values.country].filter(Boolean).join(', ');
    if (!label && !values.latitude && !values.longitude) return null;
    return {
      label,
      city: values.city,
      state: values.state,
      country: values.country,
      latitude: toCoordinate(values.latitude),
      longitude: toCoordinate(values.longitude),
    };
  }, [values.city, values.state, values.country, values.latitude, values.longitude]);

  const applyLocation = (next) => {
    setSaved(false);
    setValues((previous) => ({
      ...previous,
      city: asText(next?.city),
      state: asText(next?.state),
      country: asText(next?.country),
      latitude: asText(next?.latitude),
      longitude: asText(next?.longitude),
    }));
  };

  const licenceChanged = Boolean(values.license) && values.license !== asText(doctor?.license);

  const dirty = DOCTOR_KEYS.some((key) => values[key].trim() !== initial[key].trim())
    || Boolean(file);

  const validate = () => {
    const found = {};
    const experience = values.experience.trim();
    if (experience) {
      const years = Number(experience);
      if (!Number.isFinite(years) || years < 0 || years > 70) {
        found.experience = 'Enter a number of years between 0 and 70.';
      }
    }
    const latitude = values.latitude.trim();
    if (latitude) {
      const parsed = toCoordinate(latitude);
      if (parsed === null || parsed < -90 || parsed > 90) {
        found.latitude = 'Latitude runs from -90 to 90.';
      }
    }
    const longitude = values.longitude.trim();
    if (longitude) {
      const parsed = toCoordinate(longitude);
      if (parsed === null || parsed < -180 || parsed > 180) {
        found.longitude = 'Longitude runs from -180 to 180.';
      }
    }
    if (Boolean(latitude) !== Boolean(longitude)) {
      const key = latitude ? 'longitude' : 'latitude';
      found[key] = 'A map pin needs both a latitude and a longitude.';
    }
    return found;
  };

  const submit = async (event) => {
    event.preventDefault();
    setError(null);
    setSaved(false);

    const found = validate();
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      // Only the touched keys. An empty string is a real instruction now, so a
      // field the doctor never opened must not be sent at all.
      const payload = {};
      DOCTOR_KEYS.forEach((key) => {
        const value = values[key].trim();
        if (value === initial[key].trim()) return;
        // latitude, longitude and experience back NUMERIC columns, so they are
        // sent as numbers rather than as the strings an <input> hands over. The
        // empty string still goes through untouched, because that is the one
        // value PATCH /api/profile reads as "clear this column".
        payload[key] = NUMERIC_KEYS.includes(key) && value !== '' ? Number(value) : value;
      });

      let next = null;
      if (Object.keys(payload).length > 0) {
        next = await profileApi.update({ doctor: payload });
      }

      const photoUploaded = Boolean(file);
      if (file) {
        // The public headshot's only home. Sent on its own so nothing else in
        // this form depends on the legacy truthy-only semantics.
        const form = new FormData();
        form.append('profile_image', file);
        await request(doctorEndpoints.profile(), { method: 'POST', body: form });
        setFile(null);
        if (fileInput.current) fileInput.current.value = '';
        if (previewUrl.current) {
          URL.revokeObjectURL(previewUrl.current);
          previewUrl.current = null;
        }
        setPreview(null);
      }

      setSaved(true);
      notify.success('Your clinic profile has been updated.');
      // A new headshot lands on the OTHER route, so the patch response (if there
      // even was one) does not carry its filename. `null` tells the page to
      // refetch rather than merge a payload that is missing the photo.
      onSaved?.(photoUploaded ? null : next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Your profile could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const currentPhoto = preview || resolveImageUrl(doctor?.profile_image) || undefined;

  return (
    <Card as="form" padding="none" onSubmit={submit} noValidate>
      <CardHeader
        title="Clinic profile"
        description="What patients see in the directory. Clearing a box removes that detail from your listing."
        divider
      />
      <CardBody>
        <div className="flex flex-col gap-5">
          {error && <Alert tone="danger" title="We could not save it">{error}</Alert>}
          {saved && !error && <Alert tone="success">Your clinic profile has been saved.</Alert>}

          {/* --------------------------------------------------------- photo -- */}
          <div className="flex flex-wrap items-center gap-4">
            <Avatar src={currentPhoto} name={name} size="2xl" shape="rounded" />
            <div className="min-w-0">
              <label
                htmlFor="doctor-photo"
                className="mb-1 block font-body text-label-md text-default"
              >
                Directory photo
              </label>
              <input
                id="doctor-photo"
                ref={fileInput}
                type="file"
                accept={ACCEPT}
                onChange={pickFile}
                className={FILE_INPUT_CLASS}
              />
              <p className="mt-1.5 font-body text-caption leading-relaxed text-muted">
                PNG, JPG or WebP, up to {prettyBytes(PHOTO_LIMITS.MAX_IMAGE_BYTES)}. Published on
                your public profile: this is the only image on the platform that is deliberately not
                access controlled.
              </p>
              {errors.profile_image && (
                <p role="alert" className="mt-1 font-body text-caption font-medium text-danger-600">
                  {errors.profile_image}
                </p>
              )}
            </div>
          </div>

          {/* --------------------------------------------------------- fields -- */}
          <div className="grid gap-4 sm:grid-cols-2">
            {TEXT_FIELDS.map((field) => (
              <Field key={field.name} label={field.label} error={errors[field.name]}>
                <Input
                  type={field.type || 'text'}
                  value={values[field.name]}
                  onChange={setValue(field.name)}
                  autoComplete={field.autoComplete}
                  placeholder={field.placeholder}
                  min={field.type === 'number' ? 0 : undefined}
                  max={field.type === 'number' ? 70 : undefined}
                />
              </Field>
            ))}
          </div>

          {/* ------------------------------------------------------ location -- */}
          <div className="flex flex-col gap-4 rounded-card border border-default bg-surface-sunken p-4">
            <div>
              <h4 className="flex items-center gap-1.5 font-heading text-heading-sm text-default">
                <MapPin className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                Where you practise
              </h4>
              <p className="mt-1 font-body text-body-sm text-muted">
                Patients searching for a dermatologist near them are ranked by this pin, so keep it
                current if you move clinic.
              </p>
            </div>

            <LocationSearch
              label="Clinic location"
              hint="Search for the clinic, area or city. Picking a result fills in the city, region and map pin."
              value={location}
              onChange={applyLocation}
              error={errors.latitude || errors.longitude}
              id="doctor-clinic-location"
              placeholder="Search for a city or clinic"
            />

            <p className="font-body text-caption text-muted" aria-live="polite">
              {Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude)
                ? `Pinned at ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}.`
                : 'No map pin yet. You will still appear in the directory, just not in distance order.'}
            </p>

            {/* The search cannot be the only way in. It asks OpenStreetMap, which
                does not know every clinic, can be rate limited and is unreachable
                offline — and a doctor whose town is missing from a gazetteer must
                still be able to say where they work. LocationSearch's own notes ask
                callers to keep exactly this escape hatch. */}
            <div>
              <Button
                type="button"
                variant="link"
                size="sm"
                aria-expanded={manual}
                aria-controls="doctor-location-manual"
                onClick={() => setManual((open) => !open)}
              >
                {manual ? 'Hide the manual fields' : 'Type the location in by hand instead'}
              </Button>
            </div>

            {manual && (
              <div id="doctor-location-manual" className="grid gap-4 sm:grid-cols-2">
                <Field label="City" error={errors.city}>
                  <Input value={values.city} onChange={setValue('city')} />
                </Field>
                <Field label="Region or state" error={errors.state}>
                  <Input value={values.state} onChange={setValue('state')} />
                </Field>
                <Field label="Country" error={errors.country}>
                  <Input value={values.country} onChange={setValue('country')} />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Latitude" error={errors.latitude}>
                    <Input value={values.latitude} onChange={setValue('latitude')} inputMode="decimal" />
                  </Field>
                  <Field label="Longitude" error={errors.longitude}>
                    <Input value={values.longitude} onChange={setValue('longitude')} inputMode="decimal" />
                  </Field>
                </div>
              </div>
            )}
          </div>

          {/* -------------------------------------------------------- licence -- */}
          <Field
            label="Licence number"
            hint="Changing this sends your profile back for admin verification."
            error={errors.license}
          >
            <Input value={values.license} onChange={setValue('license')} />
          </Field>

          {licenceChanged && (
            <Alert
              tone="warning"
              icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
              title="This resets your verification"
            >
              Saving a new licence number sets your status back to “pending” and clears the
              admin&apos;s note. You will not appear as verified until it is checked again.
            </Alert>
          )}
        </div>
      </CardBody>
      <CardFooter align="between">
        <p className="font-body text-caption text-muted" aria-live="polite">
          {dirty ? 'You have unsaved changes.' : 'Everything here is saved.'}
        </p>
        <Button
          type="submit"
          loading={busy}
          loadingText="Saving"
          disabled={!dirty}
          leftIcon={<Save className="h-4 w-4" />}
        >
          Save clinic profile
        </Button>
      </CardFooter>
    </Card>
  );
}

export { DoctorProfileForm };
