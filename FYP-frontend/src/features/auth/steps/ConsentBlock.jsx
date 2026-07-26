/**
 * ConsentBlock — one checkbox per document, driven by /auth/consent-documents.
 *
 * THE RULES THIS COMPONENT EXISTS TO ENFORCE
 * ------------------------------------------
 * 1. SEPARATE. Never one "I agree to the Terms, Privacy Policy and processing
 *    of my medical images" checkbox. Skin photographs are special-category
 *    health data; bundling their processing consent with a terms-of-use tick
 *    means you cannot later prove what was actually agreed to.
 * 2. NEVER PRE-TICKED. Every box starts false, including the optional ones.
 *    A pre-ticked opt-in is not an opt-in.
 * 3. REFUSABLE MEANS REFUSABLE. `mandatory` comes from the server
 *    (consent_service.CONSENT_SPECS), which is also what `missing_mandatory`
 *    validates against at registration time — so the form can never demand a
 *    box the API considers optional, nor let through one it considers required.
 * 4. VERSIONED. Each submitted item carries the document's version, because
 *    "did they agree to THIS wording" is the question that has to be answerable
 *    months later.
 *
 * ON `doctor_data_sharing`
 * -----------------------
 * It renders in the healthcare-professional group but stays OPTIONAL, because
 * the backend deliberately defines it that way: refusing it keeps AI triage
 * working and only means no human doctor is shown the images. Promoting it to
 * mandatory in the UI would be a mandatory "optional" consent — exactly what
 * the backend comment warns against — and the server would accept a refusal
 * anyway. If the product decides otherwise, that is a one-line change in
 * consent_service.CONSENT_SPECS, and this form follows automatically.
 */

import React from 'react';
import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Alert, Button, Checkbox, Spinner, cn } from '../../../components/ui';

// `buildConsentPayload` / `missingMandatory` live in ../consentPayload.js —
// this file exports a component and nothing else.

/**
 * FIRST-PERSON statements for the checkbox itself. The server's `title` is a
 * document NAME ("Medical Licence Attestation"), which is the right label for
 * the "read this" link but the wrong thing to put next to a tick box — a user
 * has to be able to read the line they are agreeing to as a sentence about
 * themselves. Types the server adds later fall back to the title, so an unknown
 * document still renders rather than disappearing.
 */
const STATEMENT_BY_TYPE = {
  terms_of_use: 'I accept the Terms of Use.',
  privacy_policy: 'I have read and accept the Privacy Policy.',
  medical_data_processing:
    'I consent to my skin photographs and health data being processed to produce an AI assessment.',
  license_attestation: 'I confirm this PMDC number is mine and accurate.',
  doctor_data_sharing: 'Share my scans with reviewing doctors.',
  marketing_email: 'Send me product news and skin health tips by email.',
};

function ConsentRow({ document: doc, checked, onToggle, disabled }) {
  const isInternal = typeof doc.url_path === 'string' && doc.url_path.startsWith('/');
  const statement = STATEMENT_BY_TYPE[doc.type] || doc.title;

  return (
    <div className="flex flex-col gap-1 rounded-field border border-subtle bg-surface p-3">
      <Checkbox
        name={`consent-${doc.type}`}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onToggle(doc.type, event.target.checked)}
        label={(
          <span className="text-body-sm text-default">
            {statement}
            {doc.mandatory
              ? <span className="ml-1 text-danger-600 dark:text-danger-500" aria-hidden="true">*</span>
              : <span className="ml-1.5 text-caption font-normal text-subtle">(optional)</span>}
            {doc.mandatory && <span className="ui-sr-only"> (required)</span>}
          </span>
        )}
      />
      {doc.url_path && (
        <div className="pl-7">
          {isInternal ? (
            <Link
              to={doc.url_path}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 rounded-field text-caption text-primary-700
                         underline-offset-2 hover:underline outline-none focus-visible:ring-2
                         focus-visible:ring-focus focus-visible:ring-offset-2
                         focus-visible:ring-offset-surface dark:text-accent-400"
            >
              Read {doc.title}
              <ExternalLink aria-hidden="true" className="h-3 w-3" />
              <span className="ui-sr-only"> (opens in a new tab)</span>
            </Link>
          ) : (
            <span className="text-caption text-subtle">Version {doc.version}</span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * @param {object} props
 * @param {Array<object>} props.documents Documents that apply to EVERYONE.
 * @param {Array<object>} props.doctorDocuments Documents added by the doctor switch.
 * @param {boolean} props.isDoctor
 * @param {Record<string, boolean>} props.value
 * @param {(type:string, granted:boolean) => void} props.onToggle
 * @param {boolean} [props.loading]
 * @param {?string} [props.loadError]
 * @param {() => void} [props.onRetry]
 * @param {?string} [props.error] Validation error for the whole block.
 * @param {boolean} [props.disabled]
 * @param {string} [props.className]
 */
export default function ConsentBlock({
  documents = [],
  doctorDocuments = [],
  isDoctor = false,
  value = {},
  onToggle,
  loading = false,
  loadError = null,
  onRetry,
  error = null,
  disabled = false,
  className,
}) {
  if (loading) {
    return (
      <div className={cn('flex items-center gap-2 py-4 text-body-sm text-muted', className)}>
        <Spinner size="sm" label={null} />
        Loading the agreements…
      </div>
    );
  }

  if (loadError) {
    return (
      <Alert
        tone="warning"
        className={className}
        title="We could not load the agreements"
        actions={onRetry && (
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        )}
      >
        An account cannot be created without recording what you agreed to, so
        please retry before continuing.
      </Alert>
    );
  }

  return (
    <fieldset
      className={cn('space-y-3', className)}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? 'consent-block-error' : undefined}
    >
      <legend className="mb-1 font-body text-label-md text-default">
        Your agreements
        <span className="ml-1 text-danger-600 dark:text-danger-500" aria-hidden="true">*</span>
      </legend>

      <div className="space-y-2">
        {documents.map((doc) => (
          <ConsentRow
            key={doc.type}
            document={doc}
            checked={Boolean(value[doc.type])}
            onToggle={onToggle}
            disabled={disabled}
          />
        ))}
      </div>

      {isDoctor && doctorDocuments.length > 0 && (
        <div className="space-y-2 rounded-card border border-primary-200 bg-primary-50/60 p-3 dark:border-primary-800 dark:bg-primary-950/40">
          <p className="text-label-md text-default">Because you are registering as a doctor</p>
          {doctorDocuments.map((doc) => (
            <ConsentRow
              key={doc.type}
              document={doc}
              checked={Boolean(value[doc.type])}
              onToggle={onToggle}
              disabled={disabled}
            />
          ))}
        </div>
      )}

      {error && (
        <p id="consent-block-error" role="alert" className="text-caption font-medium text-danger-600 dark:text-danger-500">
          {error}
        </p>
      )}
    </fieldset>
  );
}

export { ConsentBlock };
