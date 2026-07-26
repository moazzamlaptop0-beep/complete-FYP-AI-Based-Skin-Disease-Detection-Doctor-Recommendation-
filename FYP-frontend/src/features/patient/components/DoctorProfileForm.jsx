/**
 * DoctorProfileForm — the ONE place a photograph actually reaches the server.
 *
 * `POST /api/doctor/profile` is multipart/form-data (NOT JSON) and reads
 * `request.form` plus `request.files['profile_image']`. Two consequences the UI
 * has to respect:
 *
 * 1. EVERY FIELD IS APPLIED ONLY WHEN TRUTHY. You cannot blank a field through
 *    this endpoint — sending `hospital: ''` leaves the old hospital in place. So
 *    empty inputs are omitted from the request entirely rather than sent as
 *    empty strings that quietly do nothing.
 * 2. CHANGING THE LICENCE RESETS VERIFICATION to 'pending' and clears the
 *    admin's note. That is a big enough consequence to say out loud next to the
 *    field, not to discover after saving.
 *
 * Content-Type is never set by hand: `lib/api.js` passes FormData straight
 * through so the browser can add the multipart boundary itself.
 */

import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Upload } from 'lucide-react';

import {
  Alert,
  Avatar,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  notify,
} from '../../../components/ui';
import { request } from '../../../lib/api';
import { doctors as doctorEndpoints } from '../../../lib/endpoints';
import { resolveImageUrl } from '../../../lib/imageUrl';

const TEXT_FIELDS = [
  { name: 'name', label: 'Full name', autoComplete: 'name' },
  { name: 'email', label: 'Email', type: 'email', autoComplete: 'email' },
  { name: 'specialty', label: 'Specialty' },
  { name: 'hospital', label: 'Clinic or hospital' },
  { name: 'city', label: 'City' },
  { name: 'phone', label: 'Phone', type: 'tel', autoComplete: 'tel' },
  { name: 'experience', label: 'Years of experience', type: 'number' },
];

/**
 * @param {object} props
 * @param {object|null} props.profile GET /api/doctor/profile payload.
 * @param {() => void} props.onSaved
 */
export function DoctorProfileForm({ profile, onSaved }) {
  const [values, setValues] = useState({});
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const fileInput = useRef(null);
  const previewUrl = useRef(null);

  useEffect(() => {
    setValues({
      name: profile?.name || '',
      email: profile?.email || '',
      specialty: profile?.specialty || '',
      hospital: profile?.hospital || '',
      city: profile?.city || '',
      phone: profile?.phone || '',
      experience: profile?.experience ? String(profile.experience) : '',
      license: profile?.license || '',
    });
  }, [profile]);

  // One object URL at a time, revoked on replace and on unmount.
  useEffect(() => () => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
  }, []);

  const setValue = (name) => (event) => {
    setValues((previous) => ({ ...previous, [name]: event.target.value }));
  };

  const pickFile = (event) => {
    const next = event.target.files?.[0] || null;
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = next ? URL.createObjectURL(next) : null;
    setFile(next);
    setPreview(previewUrl.current);
  };

  const licenceChanged = Boolean(values.license) && values.license !== (profile?.license || '');

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      // Only truthy values: the backend ignores falsy ones anyway, and sending
      // them makes the request look like it did something it did not.
      Object.entries(values).forEach(([key, value]) => {
        if (typeof value === 'string' ? value.trim() : value) form.append(key, String(value).trim());
      });
      if (file) form.append('profile_image', file);

      await request(doctorEndpoints.profile(), { method: 'POST', body: form });
      notify.success('Your profile has been updated.');
      setFile(null);
      if (fileInput.current) fileInput.current.value = '';
      onSaved?.();
    } catch (err) {
      setError(err?.message || 'Your profile could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  const currentPhoto = preview || resolveImageUrl(profile?.profile_image) || undefined;

  return (
    <Card as="form" padding="none" onSubmit={submit}>
      <CardHeader
        title="Clinic profile"
        description="What patients see in the directory. Blank fields are left unchanged — this form cannot erase a value."
        divider
      />
      <CardBody>
        <div className="flex flex-col gap-5">
          {error && <Alert tone="danger" title="We could not save it">{error}</Alert>}

          {/* --------------------------------------------------------- photo -- */}
          <div className="flex flex-wrap items-center gap-4">
            <Avatar src={currentPhoto} name={values.name} size="2xl" />
            <div className="min-w-0">
              <label
                htmlFor="doctor-photo"
                className="mb-1 block font-body text-label-md text-default"
              >
                Profile photo
              </label>
              <input
                id="doctor-photo"
                ref={fileInput}
                type="file"
                accept="image/*"
                onChange={pickFile}
                className={[
                  'block w-full max-w-xs font-body text-body-sm text-muted',
                  'file:mr-3 file:rounded-control file:border-0 file:bg-primary-600 file:px-3 file:py-2',
                  'file:font-body file:text-label-md file:text-white hover:file:bg-primary-700',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                ].join(' ')}
              />
              <p className="mt-1 font-body text-caption text-muted">
                Published on your public profile. This is the only image on the platform that is
                deliberately not access-controlled.
              </p>
            </div>
          </div>

          {/* --------------------------------------------------------- fields -- */}
          <div className="grid gap-4 sm:grid-cols-2">
            {TEXT_FIELDS.map((field) => (
              <Field key={field.name} label={field.label}>
                <Input
                  type={field.type || 'text'}
                  value={values[field.name] ?? ''}
                  onChange={setValue(field.name)}
                  autoComplete={field.autoComplete}
                  min={field.type === 'number' ? 0 : undefined}
                />
              </Field>
            ))}
          </div>

          {/* -------------------------------------------------------- licence -- */}
          <Field
            label="Licence number"
            hint="Changing this sends your profile back for admin verification."
          >
            <Input value={values.license ?? ''} onChange={setValue('license')} />
          </Field>

          {licenceChanged && (
            <Alert
              tone="warning"
              icon={<AlertTriangle className="h-4 w-4" aria-hidden="true" />}
              title="This resets your verification"
            >
              Saving a new licence number sets your status back to “pending” and clears the admin&apos;s
              note. You will not appear as verified until it is checked again.
            </Alert>
          )}
        </div>
      </CardBody>
      <div className="flex justify-end border-t border-subtle px-4 py-3">
        <Button type="submit" loading={busy} loadingText="Saving" leftIcon={<Upload className="h-4 w-4" />}>
          Save profile
        </Button>
      </div>
    </Card>
  );
}

export default DoctorProfileForm;
