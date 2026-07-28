/**
 * SignupDetailsStep — ONE signup form for patients and doctors.
 *
 * This is the screen the brief is really about: "consent based signup for
 * doctor so single form for all". The only structural difference between the
 * two registrations is a Switch. Flip it and the professional fields and the
 * doctor-specific agreements appear inline; leave it and they are not in the
 * DOM at all. There is no second tab, no second route, and no second account.
 *
 * VALIDATION HAPPENS TWICE, ON PURPOSE
 * ------------------------------------
 * Here (so the user is not made to wait for a round-trip to be told a field is
 * blank) and on the server (which is the only authority). The client check is a
 * strict mirror of `validate_password` + `missing_mandatory` and can never be
 * the more permissive of the two.
 */

import React, { useMemo, useState } from 'react';
import { Stethoscope } from 'lucide-react';

import { Button, Field, Input, Switch, cn } from '../../../components/ui';

import EmailChip from '../components/EmailChip';
import PasswordInput from '../components/PasswordInput';
import PasswordStrengthMeter from '../components/PasswordStrengthMeter';
import { buildConsentPayload, missingMandatory } from '../consentPayload';
import { checkPasswordPolicy } from '../passwordStrength';
import useConsentDocuments from '../useConsentDocuments';

import ConsentBlock from './ConsentBlock';
import DoctorFields from './DoctorFields';

/**
 * The doctor sub-payload. `state` and `country` sit alongside `city` because the
 * location control fills all three from one search, and `/auth/register` stores
 * whichever of them it knows about, so sending them is safe either way.
 */
const EMPTY_DOCTOR = Object.freeze({
  license: '',
  specialty: '',
  hospital: '',
  city: '',
  state: '',
  country: '',
  phone: '',
  experience: '',
  latitude: null,
  longitude: null,
});

/**
 * @param {object} props
 * @param {string} props.email
 * @param {boolean} props.busy
 * @param {Record<string,string>} props.fieldErrors Server-derived errors.
 * @param {(values:object) => void} props.onSubmit
 * @param {() => void} props.onChangeEmail
 */
export default function SignupDetailsStep({
  email,
  busy,
  fieldErrors,
  onSubmit,
  onChangeEmail,
}) {
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isDoctor, setIsDoctor] = useState(false);
  const [doctor, setDoctor] = useState({ ...EMPTY_DOCTOR });
  const [consents, setConsents] = useState({});
  const [localErrors, setLocalErrors] = useState({});

  const {
    patientDocuments,
    doctorOnlyDocuments,
    passwordPolicy,
    loading: consentsLoading,
    error: consentsError,
    reload: reloadConsents,
  } = useConsentDocuments();

  /** Exactly the documents this signup is agreeing to, in submit order. */
  const applicableDocuments = useMemo(
    () => (isDoctor ? [...patientDocuments, ...doctorOnlyDocuments] : patientDocuments),
    [isDoctor, patientDocuments, doctorOnlyDocuments],
  );

  // Server errors win: they arrived after the local ones and know more.
  const errors = { ...localErrors, ...fieldErrors };
  const minLength = Number(passwordPolicy?.min_length) || undefined;

  const handleSubmit = (event) => {
    event.preventDefault();

    const next = {};
    if (!name.trim()) next.name = 'Enter your full name.';

    const policy = checkPasswordPolicy(password, minLength);
    if (!policy.ok) next.password = policy.error;
    else if (confirm !== password) next.confirm = 'The two passwords do not match.';

    if (isDoctor && !String(doctor.license || '').trim()) {
      next.license = 'A PMDC licence number is required to register as a doctor.';
    }

    const missing = missingMandatory(applicableDocuments, consents);
    if (missing.length) {
      next.consents = 'Please accept the required agreements to create your account.';
    }

    setLocalErrors(next);
    if (Object.keys(next).length) return;

    onSubmit({
      name: name.trim(),
      password,
      isDoctor,
      doctor: isDoctor
        ? {
          ...doctor,
          license: String(doctor.license || '').trim(),
          // The location trio travels together: the combobox fills all three
          // from one pick, and a hand-typed city arrives with the other two
          // blank, which is a perfectly valid (and optional) answer.
          city: String(doctor.city || '').trim(),
          state: String(doctor.state || '').trim(),
          country: String(doctor.country || '').trim(),
          // `experience` is coerced to int server-side; send a number or nothing.
          experience: doctor.experience === '' ? undefined : Number(doctor.experience),
        }
        : undefined,
      consents: buildConsentPayload(applicableDocuments, consents),
    });
  };

  return (
    <>
      <EmailChip email={email} onChange={onChangeEmail} />

      <form noValidate onSubmit={handleSubmit} className="space-y-5">
        {/* Password managers need the account name to file the new credential. */}
        <input
          type="email"
          name="email"
          value={email}
          readOnly
          autoComplete="username"
          tabIndex={-1}
          aria-hidden="true"
          className="hidden"
        />

        <Field label="Full name" error={errors.name} required>
          <Input
            name="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Dr. Ayesha Khan"
            autoComplete="name"
            autoFocus
          />
        </Field>

        <div>
          <Field label="Password" error={errors.password} required>
            <PasswordInput
              name="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              placeholder="Choose a password"
            />
          </Field>
          <PasswordStrengthMeter
            value={password}
            minLength={minLength}
            rules={passwordPolicy?.rules}
          />
        </div>

        <Field label="Confirm password" error={errors.confirm} required>
          <PasswordInput
            name="confirm-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            placeholder="Type it again"
          />
        </Field>

        {/* THE KEY CONTROL. One switch instead of a second registration form. */}
        <div
          className={cn(
            'flex items-start gap-3 rounded-card border p-4 transition-colors duration-200',
            isDoctor
              ? 'border-accent-400 bg-accent-50'
              : 'border-default bg-surface-sunken',
          )}
        >
          <span
            aria-hidden="true"
            className={cn(
              'mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-field transition-colors',
              isDoctor
                ? 'bg-accent-100 text-accent-700'
                : 'bg-neutral-100 text-neutral-600',
            )}
          >
            <Stethoscope className="h-5 w-5" />
          </span>
          <Switch
            checked={isDoctor}
            onChange={(event) => setIsDoctor(event.target.checked)}
            label="I am a healthcare professional"
            description="Doctors get case reviews and a schedule, plus everything a patient account can do."
            labelPosition="left"
            className="w-full"
          />
        </div>

        {isDoctor && (
          <DoctorFields
            value={doctor}
            onChange={(patch) => setDoctor((current) => ({ ...current, ...patch }))}
            fieldErrors={errors}
            disabled={busy}
          />
        )}

        <ConsentBlock
          documents={patientDocuments}
          doctorDocuments={doctorOnlyDocuments}
          isDoctor={isDoctor}
          value={consents}
          onToggle={(type, granted) => setConsents((current) => ({ ...current, [type]: granted }))}
          loading={consentsLoading}
          loadError={consentsError}
          onRetry={reloadConsents}
          error={errors.consents}
          disabled={busy}
        />

        <Button
          type="submit"
          fullWidth
          size="lg"
          loading={busy}
          loadingText="Creating your account…"
          // An account cannot be created without a recorded consent decision.
          disabled={consentsLoading || Boolean(consentsError)}
        >
          Create account
        </Button>

        <p className="text-center text-caption text-subtle">
          We will email you a 6-digit code to confirm this address.
        </p>
      </form>
    </>
  );
}

export { SignupDetailsStep };
