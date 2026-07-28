/**
 * ProfileDetailsForm — name, phone, city, date of birth, gender.
 *
 * WHAT AN EMPTY BOX MEANS HERE
 * ---------------------------
 * `PATCH /api/profile` treats an empty string as "clear this column". That is the
 * exact opposite of the legacy `POST /api/doctor/profile`, which only ever
 * applied truthy values and so silently left the old value in place. Blanking a
 * field on this form therefore really does delete it, and the hint says so —
 * discovering it either way round after saving is the worst outcome.
 *
 * ONLY WHAT CHANGED IS SENT
 * -------------------------
 * The request carries the touched keys and nothing else. Sending the whole record
 * back on every save would rewrite columns the user never looked at, which turns
 * a one-field edit into a five-field audit entry and makes a concurrent change
 * from another device disappear.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Check, Save } from 'lucide-react';

import {
  Alert,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Field,
  Input,
  Select,
  notify,
} from '../../../components/ui';
import { ApiError, profile as profileApi } from '../../../lib/api';

/** Offered as data, not a hard-coded <option> list, so the values stay one line. */
const GENDER_OPTIONS = ['Female', 'Male', 'Other', 'Prefer not to say'];

/** users.date_of_birth is a real Date column; nothing before this is a person. */
const EARLIEST_BIRTH_YEAR = 1900;

const EDITABLE_KEYS = ['name', 'phone', 'city', 'date_of_birth', 'gender'];

/** The form's shape, from whatever GET /api/profile returned. */
function valuesFrom(source) {
  return {
    name: source?.name ?? '',
    phone: source?.phone ?? '',
    city: source?.city ?? '',
    date_of_birth: source?.date_of_birth ?? '',
    gender: source?.gender ?? '',
  };
}

/**
 * Per-field rules. Deliberately permissive on the phone: this is a Pakistan-first
 * product with international patients, so anything that looks like a dialable
 * number passes and only obvious nonsense is refused.
 * @param {ReturnType<typeof valuesFrom>} values
 * @returns {Record<string,string>} field name -> message, empty when valid
 */
function validateProfileDetails(values) {
  const errors = {};
  const name = String(values.name || '').trim();
  const phone = String(values.phone || '').trim();
  const city = String(values.city || '').trim();
  const dob = String(values.date_of_birth || '').trim();

  if (!name) errors.name = 'Your name cannot be empty.';
  else if (name.length < 2) errors.name = 'That is too short to be a name.';
  else if (name.length > 120) errors.name = 'Please keep your name under 120 characters.';

  if (phone) {
    if (phone.length > 32) errors.phone = 'Please keep the number under 32 characters.';
    else if (!/^[+0-9\s()./-]+$/.test(phone)) {
      errors.phone = 'Use digits, spaces and + ( ) - only.';
    } else if (phone.replace(/\D/g, '').length < 7) {
      errors.phone = 'That does not look like a complete phone number.';
    }
  }

  if (city && city.length > 120) errors.city = 'Please keep the city under 120 characters.';

  if (dob) {
    const parsed = new Date(`${dob}T00:00:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(parsed.getTime())) {
      errors.date_of_birth = 'Use a real date.';
    } else if (parsed.getTime() > Date.now()) {
      errors.date_of_birth = 'A date of birth cannot be in the future.';
    } else if (parsed.getFullYear() < EARLIEST_BIRTH_YEAR) {
      errors.date_of_birth = `Please use a year after ${EARLIEST_BIRTH_YEAR}.`;
    }
  }

  return errors;
}

/**
 * @param {object} props
 * @param {object} props.profile GET /api/profile payload.
 * @param {(next: object) => void} props.onSaved Handed the PATCH response.
 */
export default function ProfileDetailsForm({ profile, onSaved }) {
  // Destructured on purpose: the baseline must re-seat when one of THESE five
  // columns changes, not whenever the page hands down a new object. Merging an
  // email change into the held profile creates a new reference, and depending on
  // the reference would throw away whatever the user had half-typed here.
  const {
    name: storedName,
    phone: storedPhone,
    city: storedCity,
    date_of_birth: storedDob,
    gender: storedGender,
  } = profile || {};

  const initial = useMemo(
    () => valuesFrom({
      name: storedName,
      phone: storedPhone,
      city: storedCity,
      date_of_birth: storedDob,
      gender: storedGender,
    }),
    [storedName, storedPhone, storedCity, storedDob, storedGender],
  );

  const [values, setValues] = useState(initial);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  // A save, or a refetch from elsewhere on the page, re-seats the baseline so the
  // dirty check compares against what the SERVER now holds.
  useEffect(() => {
    setValues(initial);
    setErrors({});
  }, [initial]);

  const changedKeys = EDITABLE_KEYS.filter(
    (key) => String(values[key] ?? '').trim() !== String(initial[key] ?? '').trim(),
  );
  const dirty = changedKeys.length > 0;

  const setValue = (key) => (event) => {
    const next = event.target.value;
    setSaved(false);
    setValues((previous) => ({ ...previous, [key]: next }));
    // Clear only THIS field's error as it is retyped; leaving it up while the
    // user fixes it reads as "still wrong".
    setErrors((previous) => (previous[key] ? { ...previous, [key]: undefined } : previous));
  };

  // A stored value the list does not offer (an older record, or a value an admin
  // typed) must still be selectable, or saving an unrelated field would silently
  // rewrite it.
  const genderOptions = useMemo(() => {
    const list = [...GENDER_OPTIONS];
    const current = String(storedGender || '').trim();
    if (current && !list.includes(current)) list.unshift(current);
    return [{ value: '', label: 'Not specified' }]
      .concat(list.map((label) => ({ value: label, label })));
  }, [storedGender]);

  const submit = async (event) => {
    event.preventDefault();
    setFormError(null);
    setSaved(false);

    const found = validateProfileDetails(values);
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    if (!dirty) return;

    const payload = {};
    changedKeys.forEach((key) => { payload[key] = String(values[key] ?? '').trim(); });

    setBusy(true);
    try {
      const next = await profileApi.update(payload);
      setSaved(true);
      notify.success('Your details have been saved.');
      onSaved?.(next);
    } catch (err) {
      if (err instanceof ApiError && err.data && typeof err.data === 'object') {
        // A field-shaped 400 from the server wins over anything guessed here.
        const fromServer = {};
        EDITABLE_KEYS.forEach((key) => {
          const message = err.data[key];
          if (typeof message === 'string' && message) fromServer[key] = message;
        });
        if (Object.keys(fromServer).length > 0) setErrors(fromServer);
      }
      setFormError(err instanceof ApiError ? err.message : 'Your details could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card as="form" padding="none" onSubmit={submit} noValidate>
      <CardHeader
        title="Your details"
        description="Used on your appointments and to help a doctor reach you. Clearing a box deletes that detail."
        divider
      />
      <CardBody>
        <div className="flex flex-col gap-4">
          {formError && <Alert tone="danger" title="We could not save that">{formError}</Alert>}
          {saved && !formError && (
            <Alert tone="success" icon={<Check className="h-5 w-5" aria-hidden="true" />}>
              Saved.
            </Alert>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" required error={errors.name} className="sm:col-span-2">
              <Input
                value={values.name}
                onChange={setValue('name')}
                autoComplete="name"
                maxLength={120}
              />
            </Field>

            <Field
              label="Phone"
              hint="Optional. A doctor sees this only on an appointment you booked with them."
              error={errors.phone}
            >
              <Input
                type="tel"
                value={values.phone}
                onChange={setValue('phone')}
                autoComplete="tel"
                maxLength={32}
              />
            </Field>

            <Field label="City" error={errors.city}>
              <Input
                value={values.city}
                onChange={setValue('city')}
                autoComplete="address-level2"
                maxLength={120}
              />
            </Field>

            <Field
              label="Date of birth"
              hint="Skin conditions present differently at different ages."
              error={errors.date_of_birth}
            >
              <Input
                type="date"
                value={values.date_of_birth}
                onChange={setValue('date_of_birth')}
                autoComplete="bday"
              />
            </Field>

            <Field label="Gender" error={errors.gender}>
              <Select
                value={values.gender}
                onChange={setValue('gender')}
                options={genderOptions}
              />
            </Field>
          </div>
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
          Save changes
        </Button>
      </CardFooter>
    </Card>
  );
}

export { ProfileDetailsForm };
