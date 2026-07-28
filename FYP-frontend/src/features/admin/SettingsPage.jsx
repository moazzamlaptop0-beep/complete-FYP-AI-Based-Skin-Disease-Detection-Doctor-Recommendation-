/**
 * AdminSettingsPage — the platform's email and OTP configuration.
 *
 * Talks to the frozen settings contract (see lib/api.js `admin.settings`):
 *   GET  /api/admin/settings            -> {email:{...}, otp:{...}}
 *   PUT  /api/admin/settings            partial {email, otp}; email_pass is write-only
 *   POST /api/admin/settings/test-email -> 502 carries the REAL smtplib error text
 *
 * Two deliberate choices:
 *  - `email_pass` is never echoed by the server, so the field starts empty and
 *    is only included in the PUT when the admin actually typed a replacement.
 *    `email_pass_set` drives the placeholder so "blank" reads as "kept", not
 *    "missing".
 *  - The test-email failure body is rendered VERBATIM. A paraphrased
 *    "delivery failed" hides the one string (bad credentials, blocked port,
 *    TLS mismatch) that lets an admin fix SMTP without shell access.
 *
 * Writes are additionally root-gated server-side; a non-root admin's 403 is
 * shown inline with the exact reason instead of a generic failure.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Mail, Save, Send, ShieldCheck } from 'lucide-react';

import {
  Alert,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Skeleton,
  SkeletonGroup,
  Switch,
  TabList,
  TabPanel,
  TabTrigger,
  Tabs,
} from '../../components/ui';
import { PageHeader } from '../../components/dashboard';
import { ApiError, admin as adminApi } from '../../lib/api';
import { useAuth } from '../../context/AuthContext';
import { ImpersonationNotice } from './components/ImpersonationNotice';

const ROOT_ONLY_MESSAGE = 'Only the root administrator can change system settings.';

/** The email-tab fields that can carry a validation error, for tab switching. */
const EMAIL_ERROR_FIELDS = ['smtp_host', 'smtp_port'];

/** The four bounded OTP numbers, rendered and validated from one table. */
const OTP_NUMBER_FIELDS = [
  {
    name: 'otp_expiry_minutes',
    label: 'Code expiry (minutes)',
    min: 1,
    max: 120,
    hint: 'How long a code stays usable, 1 to 120 minutes.',
  },
  {
    name: 'otp_max_attempts',
    label: 'Wrong guesses per code',
    min: 1,
    max: 10,
    hint: 'Attempts before the code is invalidated, 1 to 10.',
  },
  {
    name: 'otp_resend_cooldown_seconds',
    label: 'Resend cooldown (seconds)',
    min: 10,
    max: 600,
    hint: 'Minimum wait between resend requests, 10 to 600 seconds.',
  },
  {
    name: 'otp_length',
    label: 'Code length (digits)',
    min: 4,
    max: 8,
    hint: 'Digits in each code, 4 to 8.',
  },
];

/** Server payload -> flat form state. Numbers become strings so a half-typed
 *  value never crashes a controlled number input. */
function toFormState(data) {
  const email = (data && typeof data === 'object' && data.email) || {};
  const otp = (data && typeof data === 'object' && data.otp) || {};
  const num = (value) => (value === null || value === undefined ? '' : String(value));
  return {
    smtp_host: email.smtp_host == null ? '' : String(email.smtp_host),
    smtp_port: num(email.smtp_port),
    smtp_use_ssl: Boolean(email.smtp_use_ssl),
    email_user: email.email_user == null ? '' : String(email.email_user),
    email_pass: '',
    email_enabled: Boolean(email.email_enabled),
    otp_verification_enabled: Boolean(otp.otp_verification_enabled),
    otp_expiry_minutes: num(otp.otp_expiry_minutes),
    otp_max_attempts: num(otp.otp_max_attempts),
    otp_resend_cooldown_seconds: num(otp.otp_resend_cooldown_seconds),
    otp_length: num(otp.otp_length),
  };
}

function integerError(value, min, max) {
  const number = Number(value);
  if (String(value).trim() === '' || !Number.isInteger(number) || number < min || number > max) {
    return `Enter a whole number from ${min} to ${max}.`;
  }
  return undefined;
}

function validate(form) {
  const errors = {};
  if (!form.smtp_host.trim()) errors.smtp_host = 'Enter the SMTP host.';
  const portError = integerError(form.smtp_port, 1, 65535);
  if (portError) errors.smtp_port = portError;
  OTP_NUMBER_FIELDS.forEach(({ name, min, max }) => {
    const error = integerError(form[name], min, max);
    if (error) errors[name] = error;
  });
  return errors;
}

function asApiError(err) {
  return err instanceof ApiError ? err : new ApiError(0, String(err?.message || err));
}

export default function AdminSettingsPage() {
  const { user, actingAs } = useAuth();

  // Server truth and the draft the admin edits.
  const [form, setForm] = useState(null);
  const [baseline, setBaseline] = useState('');
  const [emailPassSet, setEmailPassSet] = useState(false);

  const [loadError, setLoadError] = useState(null);
  const [nonce, setNonce] = useState(0);

  const [tab, setTab] = useState('email');
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);
  const [saved, setSaved] = useState(false);

  const [testTo, setTestTo] = useState(() => user?.email || '');
  const [testing, setTesting] = useState(false);
  const [testError, setTestError] = useState(null);
  const [testSentTo, setTestSentTo] = useState('');

  // Loading is derived: nothing has arrived and nothing has failed yet.
  const loading = form === null && !loadError;
  const dirty = useMemo(
    () => form !== null && JSON.stringify(form) !== baseline,
    [form, baseline],
  );

  const adopt = useCallback((data) => {
    const next = toFormState(data);
    setForm(next);
    setBaseline(JSON.stringify(next));
    setEmailPassSet(Boolean(data?.email?.email_pass_set));
  }, []);

  const reload = useCallback(() => {
    setForm(null);
    setLoadError(null);
    setFieldErrors({});
    setSaveError(null);
    setSaved(false);
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    // Delegated requests lose the admin permission set, so this call is
    // guaranteed to fail while impersonating. Do not make it.
    if (actingAs) return undefined;

    let alive = true;
    const controller = new AbortController();

    adminApi.settings
      .get({ signal: controller.signal, timeoutMs: 15_000 })
      .then((data) => {
        if (alive) adopt(data);
      })
      .catch((err) => {
        if (!alive || err?.name === 'AbortError') return;
        setLoadError(asApiError(err));
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [actingAs, adopt, nonce]);

  // The signed-in admin usually tests against their own inbox; fill it in once
  // the session is known without clobbering anything they typed.
  useEffect(() => {
    if (user?.email) setTestTo((prev) => prev || user.email);
  }, [user?.email]);

  const setField = useCallback((name, value) => {
    setForm((prev) => (prev ? { ...prev, [name]: value } : prev));
    setSaved(false);
    setSaveError(null);
    setFieldErrors((prev) => {
      if (!prev[name]) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!form || saving) return;
    const errors = validate(form);
    setFieldErrors(errors);
    const errorKeys = Object.keys(errors);
    if (errorKeys.length) {
      // Surface the failing field: a hidden panel's error is an invisible wall.
      setTab(errorKeys.some((key) => EMAIL_ERROR_FIELDS.includes(key)) ? 'email' : 'otp');
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const payload = {
        email: {
          smtp_host: form.smtp_host.trim(),
          smtp_port: Number(form.smtp_port),
          smtp_use_ssl: form.smtp_use_ssl,
          email_user: form.email_user.trim() || null,
          email_enabled: form.email_enabled,
          // Write-only: only sent when the admin typed a replacement.
          ...(form.email_pass ? { email_pass: form.email_pass } : {}),
        },
        otp: {
          otp_verification_enabled: form.otp_verification_enabled,
          otp_expiry_minutes: Number(form.otp_expiry_minutes),
          otp_max_attempts: Number(form.otp_max_attempts),
          otp_resend_cooldown_seconds: Number(form.otp_resend_cooldown_seconds),
          otp_length: Number(form.otp_length),
        },
      };
      const next = await adminApi.settings.update(payload);
      adopt(next);
      setSaved(true);
    } catch (err) {
      setSaveError(asApiError(err));
    } finally {
      setSaving(false);
    }
  }, [adopt, form, saving]);

  const handleTestEmail = useCallback(async () => {
    const to = testTo.trim();
    setTestError(null);
    setTestSentTo('');
    if (!to) {
      setTestError(new ApiError(400, 'Enter an address to send the test message to.'));
      return;
    }
    setTesting(true);
    try {
      await adminApi.settings.testEmail(to);
      setTestSentTo(to);
    } catch (err) {
      setTestError(asApiError(err));
    } finally {
      setTesting(false);
    }
  }, [testTo]);

  let body = null;
  if (actingAs) {
    body = null;
  } else if (loadError) {
    body = loadError.status === 403 ? (
      <Alert tone="danger" title="System settings are locked">
        {ROOT_ONLY_MESSAGE}
      </Alert>
    ) : (
      <Alert
        tone="danger"
        title="Could not load settings"
        actions={(
          <Button size="sm" variant="outline" onClick={reload}>
            Try again
          </Button>
        )}
      >
        {loadError.message || 'The server did not answer. Check that the backend is running.'}
      </Alert>
    );
  } else if (loading) {
    body = (
      <SkeletonGroup label="Loading settings">
        <div className="flex flex-col gap-4">
          <Skeleton shape="rect" height={42} className="max-w-sm" />
          <Skeleton shape="card" height={340} />
          <Skeleton shape="card" height={150} />
        </div>
      </SkeletonGroup>
    );
  } else {
    body = (
      <>
        <Tabs value={tab} onValueChange={setTab}>
          <TabList aria-label="Settings sections">
            <TabTrigger value="email" icon={<Mail />}>
              Email and SMTP
            </TabTrigger>
            <TabTrigger value="otp" icon={<ShieldCheck />}>
              OTP and verification
            </TabTrigger>
          </TabList>

          {/* ---------------------------------------------------- email tab -- */}
          <TabPanel value="email" className="flex flex-col gap-5">
            <Card as="section" padding="none">
              <CardHeader
                divider
                title="SMTP delivery"
                description="Where outgoing mail is handed off. OTP codes, reports and notifications all leave through this server."
              />
              <CardBody className="flex flex-col gap-5">
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field label="SMTP host" required error={fieldErrors.smtp_host}>
                    <Input
                      value={form.smtp_host}
                      onChange={(e) => setField('smtp_host', e.target.value)}
                      placeholder="smtp.gmail.com"
                      autoComplete="off"
                    />
                  </Field>
                  <Field
                    label="SMTP port"
                    required
                    hint="1 to 65535. Usually 465 with SSL, 587 without."
                    error={fieldErrors.smtp_port}
                  >
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={65535}
                      value={form.smtp_port}
                      onChange={(e) => setField('smtp_port', e.target.value)}
                    />
                  </Field>
                  <Field
                    label="Sender email address"
                    hint="The account the platform signs in to the SMTP server with."
                  >
                    <Input
                      type="email"
                      value={form.email_user}
                      onChange={(e) => setField('email_user', e.target.value)}
                      placeholder="alerts@example.com"
                      autoComplete="off"
                    />
                  </Field>
                  <Field
                    label="Email password"
                    hint={
                      emailPassSet
                        ? 'A password is stored. Typing here replaces it when you save.'
                        : 'Stored write-only. It is never shown again after saving.'
                    }
                  >
                    <Input
                      type="password"
                      value={form.email_pass}
                      onChange={(e) => setField('email_pass', e.target.value)}
                      placeholder={emailPassSet ? 'Saved, leave blank to keep' : 'App password'}
                      autoComplete="new-password"
                    />
                  </Field>
                </div>

                <div className="flex flex-col gap-4 rounded-field bg-surface-sunken p-4 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
                  <Switch
                    checked={form.smtp_use_ssl}
                    onChange={(e) => setField('smtp_use_ssl', e.target.checked)}
                    label="Use SSL"
                    description="On for implicit SSL (usually port 465), off for STARTTLS (usually 587)."
                  />
                  <Switch
                    checked={form.email_enabled}
                    onChange={(e) => setField('email_enabled', e.target.checked)}
                    label="Email sending enabled"
                    description="When off, the platform sends no mail at all, including OTP codes."
                  />
                </div>
              </CardBody>
            </Card>

            <Card as="section" padding="none">
              <CardHeader
                divider
                title="Send a test email"
                description="Uses the last saved settings, not unsaved edits. Save first if you changed anything above."
              />
              <CardBody className="flex flex-col gap-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <Field label="Send to" className="sm:max-w-sm">
                    <Input
                      type="email"
                      value={testTo}
                      onChange={(e) => {
                        setTestTo(e.target.value);
                        setTestError(null);
                        setTestSentTo('');
                      }}
                      placeholder="you@example.com"
                    />
                  </Field>
                  <Button
                    variant="outline"
                    onClick={handleTestEmail}
                    loading={testing}
                    loadingText="Sending"
                    leftIcon={<Send className="h-4 w-4" aria-hidden="true" />}
                    className="sm:shrink-0"
                  >
                    Send test email
                  </Button>
                </div>
                {testError ? (
                  // The backend's 502 carries the raw smtplib error; show it
                  // verbatim so SMTP problems are diagnosable from this page.
                  <Alert tone="danger" title="The test email failed">
                    {testError.message}
                  </Alert>
                ) : null}
                {testSentTo ? (
                  <Alert tone="success" title="Test email sent">
                    {`Handed to the SMTP server for ${testSentTo}. Check the inbox and the spam folder.`}
                  </Alert>
                ) : null}
              </CardBody>
            </Card>
          </TabPanel>

          {/* ------------------------------------------------------ otp tab -- */}
          <TabPanel value="otp" className="flex flex-col gap-5">
            <Card as="section" padding="none">
              <CardHeader
                divider
                title="OTP and verification"
                description="How the one-time codes for sign-up and password resets behave."
              />
              <CardBody className="flex flex-col gap-5">
                <div className="rounded-field bg-surface-sunken p-4">
                  <Switch
                    checked={form.otp_verification_enabled}
                    onChange={(e) => setField('otp_verification_enabled', e.target.checked)}
                    label="Require an email code for new accounts"
                    description="When off, new accounts are activated without an email code."
                  />
                </div>

                <div className="grid gap-5 sm:grid-cols-2">
                  {OTP_NUMBER_FIELDS.map(({ name, label, min, max, hint }) => (
                    <Field key={name} label={label} hint={hint} error={fieldErrors[name]}>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={min}
                        max={max}
                        value={form[name]}
                        onChange={(e) => setField(name, e.target.value)}
                      />
                    </Field>
                  ))}
                </div>
              </CardBody>
            </Card>
          </TabPanel>
        </Tabs>

        {saveError ? (
          <Alert tone="danger" title="Could not save settings">
            {saveError.status === 403 ? ROOT_ONLY_MESSAGE : saveError.message}
          </Alert>
        ) : null}
        {saved ? (
          <Alert tone="success" title="Settings saved">
            They apply to the next email sent and the next code issued.
          </Alert>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
          {dirty && !saving ? (
            <p className="text-body-sm text-muted" role="status">
              You have unsaved changes.
            </p>
          ) : null}
          <Button
            onClick={handleSave}
            loading={saving}
            loadingText="Saving"
            disabled={!dirty}
            leftIcon={<Save className="h-4 w-4" aria-hidden="true" />}
          >
            Save settings
          </Button>
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        className="mb-0"
        title="Settings"
        description="Email delivery and OTP verification for the whole platform. Changes apply as soon as they are saved."
      />
      <ImpersonationNotice />
      {body}
    </div>
  );
}
