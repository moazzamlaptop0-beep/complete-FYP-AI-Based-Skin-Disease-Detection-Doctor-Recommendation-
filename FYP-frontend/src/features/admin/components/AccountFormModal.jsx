/**
 * AccountFormModal — add or edit a doctor / patient account from the console.
 *
 * ONE COMPONENT, TWO MODES
 * ------------------------
 * Create (`POST /admin/users`) and edit (`PATCH /admin/users/<id>`) collect
 * almost the same fields, and splitting them into two files is how the licence
 * validation ends up in only one of them. `mode` switches the three things that
 * genuinely differ: the role picker (create only — role is immutable afterwards
 * and the backend 400s on an attempt), the password block (create only), and
 * whether the request is a POST or a PATCH.
 *
 * WHAT THE BACKEND WILL AND WILL NOT ACCEPT — MIRRORED HERE ON PURPOSE
 * -------------------------------------------------------------------
 *  * `role` is 'Doctor' | 'AI User'. There is no way to create an Admin over
 *    HTTP and there is not meant to be one, so the picker has two options and no
 *    "Admin" that would 403 after the user filled the form in.
 *  * A Doctor needs a licence number. It is UNIQUE, and it is NOT NULL on
 *    `doctor_profiles` — which is why editing a doctor who has no profile row yet
 *    (a real state: `/admin/doctors` reports those as 'pending') still demands
 *    one before it can create the row.
 *  * Verification is NOT on this form for an existing doctor. Approving a licence
 *    belongs to the Doctors page, because that is the path that writes
 *    verified_at / verified_by / the note AND emails the doctor. The one place
 *    this form touches it is at creation, where the admin is typing the licence
 *    in front of them and there is no prior decision to overwrite.
 *
 * PARTIAL PATCH, NOT A FULL REPLACE
 * ---------------------------------
 * `buildPatch` sends only the fields that actually changed. That matters more
 * than it looks: the endpoint treats `''` as "clear this column", so posting the
 * whole form back would rewrite every field the admin never looked at, and a
 * blank Hospital box would silently erase a hospital the doctor had filled in
 * themselves.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Copy, KeyRound, ShieldCheck, UserPlus } from 'lucide-react';

import {
  Alert,
  Button,
  Checkbox,
  Field,
  Input,
  Modal,
  ModalFooter,
  RadioGroup,
  Select,
  cn,
  notify,
} from '../../../components/ui';
import { patch, post } from '../../../lib/api';
import { admin as adminEndpoints } from '../../../lib/endpoints';
import { ROLES } from '../../../lib/permissions';

/** Matches ALLOWED_MANAGED_ROLES in app/services/admin_service.py. */
const ROLE_OPTIONS = [
  {
    value: ROLES.PATIENT,
    label: 'Patient',
    description: 'Can run scans, book appointments and rate doctors.',
  },
  {
    value: ROLES.DOCTOR,
    label: 'Doctor',
    description: 'Needs a PMDC licence number. Cannot take patients until verified.',
  },
];

const SPECIALTY_OPTIONS = [
  { value: '', label: 'Not set' },
  { value: 'Dermatology', label: 'Dermatology' },
  { value: 'Cosmetic Dermatology', label: 'Cosmetic Dermatology' },
  { value: 'Paediatric Dermatology', label: 'Paediatric Dermatology' },
  { value: 'Dermatologic Surgery', label: 'Dermatologic Surgery' },
  { value: 'General Physician', label: 'General Physician' },
];

const EMPTY = {
  name: '',
  email: '',
  role: ROLES.PATIENT,
  password: '',
  generatePassword: true,
  isVerified: true,
  approveNow: false,
  license: '',
  specialty: '',
  hospital: '',
  city: '',
  phone: '',
  experience: '',
};

/**
 * Seed the form from an existing row.
 *
 * Both list shapes are accepted, because the two pages that open this modal read
 * different endpoints: `/admin/doctors` returns the licence fields FLAT on the
 * row (13 keys, frozen contract), while `/admin/users` and the CRUD responses
 * nest them under `doctor`. Reading `row.doctor?.x ?? row.x` means neither page
 * has to reshape its data before opening the form.
 */
function seedFrom(row) {
  if (!row) return { ...EMPTY };
  const doctor = row.doctor || {};
  const isDoctor = (row.role || (row.license !== undefined ? ROLES.DOCTOR : ROLES.PATIENT)) === ROLES.DOCTOR;

  return {
    ...EMPTY,
    name: row.name || '',
    email: row.email || '',
    role: isDoctor ? ROLES.DOCTOR : (row.role || ROLES.PATIENT),
    isVerified: row.is_verified !== false,
    license: doctor.license ?? row.license ?? '',
    specialty: doctor.specialty ?? row.specialty ?? '',
    hospital: doctor.hospital ?? row.hospital ?? '',
    city: doctor.city ?? row.city ?? '',
    phone: doctor.phone ?? row.phone ?? '',
    experience: String(doctor.experience ?? row.experience ?? '') === 'null'
      ? ''
      : String(doctor.experience ?? row.experience ?? ''),
  };
}

/** The five licence columns, as the API names them. */
const DOCTOR_KEYS = ['license', 'specialty', 'hospital', 'city', 'phone'];

/**
 * Only what changed. See the header: a full replace would clear columns the
 * admin never touched.
 * @returns {{payload: object, dirty: boolean}}
 */
function buildPatch(form, original) {
  const seed = seedFrom(original);
  const payload = {};

  if (form.name.trim() !== seed.name) payload.name = form.name.trim();
  if (form.email.trim() !== seed.email) payload.email = form.email.trim();
  if (form.isVerified !== seed.isVerified) payload.is_verified = form.isVerified;

  if (form.role === ROLES.DOCTOR) {
    const doctor = {};
    DOCTOR_KEYS.forEach((key) => {
      const next = String(form[key] ?? '').trim();
      if (next !== String(seed[key] ?? '')) doctor[key] = next;
    });
    const experience = String(form.experience ?? '').trim();
    if (experience !== String(seed.experience ?? '')) doctor.experience = experience;
    if (Object.keys(doctor).length) {
      // The licence always rides along: on a doctor with no profile row yet the
      // server has to INSERT one, and `license` is NOT NULL there.
      payload.doctor = { license: String(form.license || '').trim(), ...doctor };
    }
  }

  return { payload, dirty: Object.keys(payload).length > 0 };
}

/** The create body. Separate from buildPatch because "absent" means something
 *  different on a POST: there is no previous value to preserve. */
function buildCreate(form) {
  const body = {
    name: form.name.trim(),
    email: form.email.trim(),
    role: form.role,
    is_verified: form.isVerified,
  };
  // Omitting `password` entirely is the signal to have one generated. Sending
  // `''` would be a policy violation instead.
  if (!form.generatePassword && form.password) body.password = form.password;

  if (form.role === ROLES.DOCTOR) {
    body.doctor = {
      license: form.license.trim(),
      specialty: form.specialty.trim(),
      hospital: form.hospital.trim(),
      city: form.city.trim(),
      phone: form.phone.trim(),
      experience: form.experience.trim(),
      verification_status: form.approveNow ? 'approved' : 'pending',
    };
    if (form.approveNow) {
      body.doctor.verification_note = 'Licence entered and verified by an administrator on account creation.';
    }
  }
  return body;
}

/** Local validation. Deliberately a subset of the server's — it exists to save a
 *  round trip, never to be the authority. */
function validate(form, mode) {
  if (!form.name.trim()) return 'A name is required.';
  if (!form.email.trim()) return 'An email address is required.';
  if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(form.email.trim())) {
    return 'That email address does not look valid.';
  }
  if (form.role === ROLES.DOCTOR && !form.license.trim()) {
    return 'A PMDC licence number is required for a doctor account.';
  }
  if (mode === 'create' && !form.generatePassword) {
    if (!form.password) return 'Type a password or switch back to generating one.';
    // Mirrors auth_service.validate_password: length, all-numeric, common list.
    // The common-password list lives server-side only; that check stays a 400.
    if (form.password.length < 8) return 'Password must be at least 8 characters.';
    if (/^\d+$/.test(form.password)) return 'Password cannot be all numbers.';
  }
  return null;
}

/**
 * The one-time reveal for a generated password.
 *
 * It is shown here and nowhere else, ever: only the hash is stored, so an admin
 * who closes this without copying it has to reset rather than look it up. That is
 * the correct trade and the copy said so, so the panel is loud about it.
 */
export function TemporaryPasswordPanel({ password, email, onDone, title }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      notify.success('Temporary password copied.');
    } catch {
      // Clipboard access is refused in plenty of contexts (no HTTPS, a denied
      // permission). The value is on screen and selectable, so this is a nudge,
      // not a failure.
      notify.info('Copy was blocked — select the password and copy it manually.');
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Alert
        tone="warning"
        title="Copy this now — it cannot be shown again"
        icon={<KeyRound className="h-5 w-5" aria-hidden="true" />}
      >
        Only a hash is stored, so nobody can look this up later. If it is lost, reset the password
        again.
      </Alert>

      <div className="rounded-lg border border-subtle bg-surface-sunken p-4">
        <p className="text-caption text-muted">{title || 'Temporary password'}</p>
        <p className="mt-1 select-all break-all font-mono text-heading-sm text-neutral-900 dark:text-neutral-50">
          {password}
        </p>
        {email ? (
          <p className="mt-2 text-caption text-muted">
            for <span className="font-medium">{email}</span>
          </p>
        ) : null}
      </div>

      <p className="text-body-sm text-muted">
        We have also emailed it to them. If that address is wrong or the mail bounces, this is the
        only copy.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          variant="outline"
          onClick={copy}
          leftIcon={<Copy className="h-4 w-4" aria-hidden="true" />}
        >
          {copied ? 'Copied' : 'Copy password'}
        </Button>
        <Button variant="primary" onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {'create'|'edit'} props.mode
 * @param {boolean} props.open
 * @param {object|null} [props.row] The account being edited (edit mode).
 * @param {string} [props.defaultRole] Which role a fresh form starts on.
 * @param {(result: object, mode: string) => void} props.onSaved
 * @param {() => void} props.onClose
 */
export default function AccountFormModal({
  mode = 'create',
  open,
  row = null,
  defaultRole = ROLES.PATIENT,
  onSaved,
  onClose,
}) {
  const [form, setForm] = useState(() => ({ ...EMPTY, role: defaultRole }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  /** Set once a create returns a generated password: the modal switches to the
   *  reveal panel instead of closing, or the admin never sees the credential. */
  const [reveal, setReveal] = useState(null);

  const rowId = row?.id;

  // Re-seed whenever a different row (or a fresh create) is opened. Keyed on the
  // id rather than the object so an optimistic patch upstream does not reset a
  // form the admin is halfway through typing.
  useEffect(() => {
    if (!open) return;
    setForm(mode === 'edit' ? seedFrom(row) : { ...EMPTY, role: defaultRole });
    setError(null);
    setReveal(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, rowId, defaultRole]);

  const set = (key) => (event) => {
    const value = event?.target?.type === 'checkbox' ? event.target.checked : event.target.value;
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const isDoctor = form.role === ROLES.DOCTOR;
  const editing = mode === 'edit';

  const dirty = useMemo(
    () => (editing ? buildPatch(form, row).dirty : true),
    [editing, form, row],
  );

  const submit = async () => {
    const complaint = validate(form, mode);
    if (complaint) {
      setError(complaint);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      if (editing) {
        const { payload, dirty: hasChanges } = buildPatch(form, row);
        if (!hasChanges) {
          onClose();
          return;
        }
        const result = await patch(adminEndpoints.updateUser(row.id), payload);
        notify.success(`${result?.name || 'Account'} updated.`);
        onSaved?.(result, 'edit');
        onClose();
        return;
      }

      const result = await post(adminEndpoints.createUser(), buildCreate(form));
      notify.success(`${result?.name || 'Account'} created.`);
      onSaved?.(result, 'create');

      if (result?.temporary_password) {
        setReveal({ password: result.temporary_password, email: result.email });
        return; // stay open — this is the only chance to read it
      }
      onClose();
    } catch (err) {
      // 400s carry a real message ("Email already exists", the password policy,
      // "This license number is already registered."). Show it verbatim.
      setError(err?.message || 'The account could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  if (reveal) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        size="md"
        title="Account created"
        description={form.name || reveal.email}
      >
        <TemporaryPasswordPanel
          password={reveal.password}
          email={reveal.email}
          onDone={onClose}
        />
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${row?.name || 'account'}` : 'Add an account'}
      description={editing
        ? row?.email
        : 'The account works immediately — no email verification step unless you ask for one.'}
      footer={
        <ModalFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={busy}
            disabled={editing && !dirty}
            leftIcon={editing
              ? <BadgeCheck className="h-4 w-4" aria-hidden="true" />
              : <UserPlus className="h-4 w-4" aria-hidden="true" />}
          >
            {editing ? 'Save changes' : 'Create account'}
          </Button>
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-5">
        {error ? <Alert tone="danger" title="Could not save">{error}</Alert> : null}

        {!editing ? (
          <RadioGroup
            name="account-role"
            legend="Account type"
            variant="card"
            value={form.role}
            onChange={(value) => setForm((prev) => ({ ...prev, role: value }))}
            options={ROLE_OPTIONS}
          />
        ) : (
          <Alert tone="neutral" title={`This is a ${isDoctor ? 'doctor' : 'patient'} account`}>
            An account&apos;s type cannot be changed here — a doctor needs a licence, a verification
            decision and an email, so switching one would hide all three. Create the right account
            type and suspend this one.
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" required>
            <Input value={form.name} onChange={set('name')} autoComplete="off" placeholder="Asma Riaz" />
          </Field>
          <Field
            label="Email"
            required
            hint={editing ? 'Changing this changes what they sign in with.' : undefined}
          >
            <Input
              type="email"
              value={form.email}
              onChange={set('email')}
              autoComplete="off"
              placeholder="name@example.com"
            />
          </Field>
        </div>

        {isDoctor ? (
          <fieldset className="flex flex-col gap-4 rounded-lg border border-subtle p-4">
            <legend className="px-1 text-label-md text-default">Licence &amp; clinic</legend>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="PMDC licence number"
                required
                hint="Must be unique across the platform."
              >
                <Input
                  value={form.license}
                  onChange={set('license')}
                  autoComplete="off"
                  placeholder="PMDC-12345-D"
                  className="font-mono"
                />
              </Field>
              <Field label="Specialty">
                <Select value={form.specialty} onChange={set('specialty')} options={SPECIALTY_OPTIONS} />
              </Field>
              <Field label="Hospital / clinic">
                <Input value={form.hospital} onChange={set('hospital')} autoComplete="off" />
              </Field>
              <Field label="City">
                <Input value={form.city} onChange={set('city')} autoComplete="off" />
              </Field>
              <Field label="Phone">
                <Input value={form.phone} onChange={set('phone')} autoComplete="off" placeholder="+92 300 1234567" />
              </Field>
              <Field label="Years of experience">
                <Input type="number" min="0" max="70" value={form.experience} onChange={set('experience')} />
              </Field>
            </div>

            {editing ? (
              <p className="text-caption text-muted">
                Approving or rejecting this licence is on the Doctors page — that is the path that
                records who decided and emails the doctor.
              </p>
            ) : (
              <Checkbox
                checked={form.approveNow}
                onChange={set('approveNow')}
                label="I have checked this licence — approve it now"
                description="Skips the pending queue so they can take patients immediately. Leave off to review it later."
              />
            )}
          </fieldset>
        ) : null}

        {!editing ? (
          <fieldset className="flex flex-col gap-3 rounded-lg border border-subtle p-4">
            <legend className="px-1 text-label-md text-default">First sign-in</legend>

            <Checkbox
              checked={form.generatePassword}
              onChange={set('generatePassword')}
              label="Generate a temporary password"
              description="Shown once, right after you create the account, and emailed to them."
            />

            {!form.generatePassword ? (
              <Field
                label="Password"
                required
                hint="At least 8 characters, not all numbers, and not a commonly used password."
              >
                <Input
                  type="text"
                  value={form.password}
                  onChange={set('password')}
                  autoComplete="new-password"
                  className="font-mono"
                />
              </Field>
            ) : null}
          </fieldset>
        ) : null}

        <Checkbox
          checked={form.isVerified}
          onChange={set('isVerified')}
          label="Email is already verified"
          description={form.isVerified
            ? 'They can sign in straight away. You are vouching for the address.'
            : 'They will have to enter an emailed code before they can sign in.'}
        />

        {!form.isVerified && !editing ? (
          <Alert tone="warning" title="They will be stuck until they get the code">
            The usual reason to add an account by hand is that the person cannot receive email.
            Leaving this off puts them back on the OTP screen.
          </Alert>
        ) : null}

        <p className={cn('flex items-start gap-2 text-caption text-muted')}>
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Recorded in the audit log against your account, with what you changed.
        </p>
      </div>
    </Modal>
  );
}

export { AccountFormModal };
