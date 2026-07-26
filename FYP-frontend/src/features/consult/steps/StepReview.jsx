/**
 * StepReview — the last screen before anything leaves the browser.
 *
 * WHAT CONSENT ACTUALLY CONTROLS HERE
 * -----------------------------------
 * `consent_share_scan` is not a formality and it is not a disclaimer. Look at
 * `_scan_payload()` in the backend's request_matching service: when the flag is
 * false the invited doctors still receive the prediction, the severity and the
 * notes, but `image_url` is NULL — they get the clinical summary WITHOUT the
 * photograph. The tick box is the single thing standing between a stranger and
 * a picture of this person's skin, which is why it is unticked by default, why
 * it is worded as a grant to named people rather than as "I agree to the terms",
 * and why the Send button will not fire without it.
 *
 * ONE SUBMIT PATH, TWO CALLS, ONE OF THEM OPTIONAL
 * ------------------------------------------------
 * Extra photos are uploaded first and BEST EFFORT (see `scans.createAttachment`
 * in endpoints.js — the route is not live yet). A failure there is reported and
 * then ignored: it must never cost the patient the appointment request, which is
 * the call that actually matters. The request itself is guarded by an in-flight
 * ref as well as by `submit.status`, because a ref updates synchronously and
 * two clicks 20ms apart both read the same React state.
 */

import React, { useCallback, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Lock, Send, ShieldCheck } from 'lucide-react';

import {
  Alert,
  Button,
  Checkbox,
  Spinner,
  cn,
} from '../../../components/ui';
import { ApiError, post, request } from '../../../lib/api';
import { requests as requestEndpoints, scans as scanEndpoints } from '../../../lib/endpoints';
import { PATHS } from '../../../routes';

import { useConsult } from '../ConsultContext';
import { ACTIONS, STEP_IDS, requestPayload, submitBlockers } from '../consultReducer';
import { uploadableAttachments } from '../lib/attachments';

import EmergencyBanner from '../components/EmergencyBanner';
import ReviewSummary from '../components/ReviewSummary';

const SIGN_IN_HREF = `${PATHS.AUTH}?returnTo=${encodeURIComponent(PATHS.CONSULT)}`;

/**
 * Upload the extra photos one at a time. Never throws.
 * @param {number} scanId
 * @param {Array<object>} attachments
 * @returns {Promise<{uploaded:number, failed:string[]}>}
 */
async function uploadAttachments(scanId, attachments) {
  const failed = [];
  let uploaded = 0;

  for (const attachment of attachments) {
    const form = new FormData();
    form.append('image', attachment.file, attachment.name || 'photo.jpg');
    try {
      // Sequential, not Promise.all: three parallel multipart uploads on a
      // phone connection is how you get all three to time out together.
      await request(scanEndpoints.createAttachment(scanId), {
        method: 'POST',
        body: form,
        timeoutMs: 60_000,
      });
      uploaded += 1;
    } catch {
      failed.push(attachment.name || 'a photo');
    }
  }

  return { uploaded, failed };
}

export default function StepReview() {
  const {
    state,
    dispatch,
    isAuthenticated,
    setConsent,
    goToStepId,
  } = useConsult();

  const consentId = useId();
  const [attachmentWarning, setAttachmentWarning] = useState(null);
  const [rejectedDoctors, setRejectedDoctors] = useState([]);
  /** Synchronous double-submit guard — React state is not fast enough. */
  const inFlight = useRef(false);

  const payload = requestPayload(state);
  const blockers = submitBlockers(state);
  const sending = state.submit.status === 'loading';
  const extras = uploadableAttachments(state.details.attachments);

  const handleSubmit = useCallback(async () => {
    if (inFlight.current) return;
    if (submitBlockers(state).length > 0) return;

    inFlight.current = true;
    setAttachmentWarning(null);
    setRejectedDoctors([]);
    dispatch({ type: ACTIONS.SUBMIT_START });

    const body = requestPayload(state);

    try {
      // 1. Best effort, and only when there is both a scan and something to send.
      const files = uploadableAttachments(state.details.attachments);
      if (body.scan_id && files.length > 0) {
        const { failed } = await uploadAttachments(body.scan_id, files);
        if (failed.length) {
          setAttachmentWarning(
            `${failed.length} of your extra photo${failed.length === 1 ? '' : 's'} could not be `
            + 'attached. Your request was still sent — bring them to the appointment, or add them '
            + 'from the scan afterwards.',
          );
        }
      }

      // 2. The call that matters.
      const data = await post(requestEndpoints.create(), body, { timeoutMs: 30_000 });
      // SUBMIT_SUCCESS also advances to the confirmation step, in one dispatch.
      dispatch({ type: ACTIONS.SUBMIT_SUCCESS, payload: data });
    } catch (error) {
      // The backend refuses doctors whose licence an admin has not approved and
      // names them in `data.rejected_doctor_ids`. Echoing raw ids at a patient is
      // useless, so translate them back into the names they picked.
      const ids = Array.isArray(error?.data?.rejected_doctor_ids)
        ? error.data.rejected_doctor_ids.map(Number)
        : [];
      if (ids.length) {
        setRejectedDoctors(
          ids.map((id) => {
            const match = state.doctors.selected.find(
              (doctor) => Number(doctor.id ?? doctor.doctor_id ?? doctor.user_id) === id,
            );
            return match?.name || `Doctor #${id}`;
          }),
        );
      }
      dispatch({
        type: ACTIONS.SUBMIT_ERROR,
        payload: {
          message: error instanceof ApiError
            ? error.message
            : 'Could not send that request. Check your connection and try again.',
        },
      });
    } finally {
      inFlight.current = false;
    }
  }, [state, dispatch]);

  // ---------------------------------------------------------------- gate ----
  // A guard for a direct mount; ConsultPage normally swaps in its own AccountGate
  // before this component is ever rendered.
  if (!isAuthenticated) {
    return (
      <Alert
        tone="info"
        title="Sign in to send this"
        icon={<Lock aria-hidden="true" className="h-5 w-5" />}
        actions={<Button as={Link} to={SIGN_IN_HREF} size="sm">Sign in</Button>}
      >
        Your photo, your answers and the plan you built are kept in this tab.
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <EmergencyBanner />

      <ReviewSummary state={state} onEditStep={goToStepId} />

      {/* ---------------------------------------------------------- consent -- */}
      <section
        className={cn(
          'rounded-card border-2 p-4',
          state.consent.shareScan
            ? 'border-success-300 bg-success-50 dark:bg-success-950/30'
            : 'border-primary-300 bg-surface-sunken',
        )}
      >
        <Checkbox
          id={consentId}
          checked={state.consent.shareScan}
          onChange={(event) => setConsent({ shareScan: event.target.checked })}
          label={
            <span className="text-label-md text-default">
              Share this scan and my answers with the{' '}
              {payload.doctor_ids.length === 1
                ? 'doctor'
                : `${payload.doctor_ids.length} doctors`}{' '}
              I picked
            </span>
          }
          description={
            <span className="text-body-sm text-muted">
              Without this they receive the prediction, the severity and your description but
              <strong className="font-semibold"> not the photograph</strong>. Only the doctors
              listed above get access, only until one of them accepts or the request expires, and
              every time one of them opens the full-size image it is written to the access log on
              your scan.
            </span>
          }
        />
      </section>

      {/* --------------------------------------------------------- problems -- */}
      {state.submit.status === 'error' && (
        <Alert
          tone="danger"
          title="That did not send"
          icon={<AlertCircle aria-hidden="true" className="h-5 w-5" />}
          actions={
            rejectedDoctors.length > 0 ? (
              <Button size="sm" onClick={() => goToStepId(STEP_IDS.DOCTORS)}>
                Pick different doctors
              </Button>
            ) : (
              <Button size="sm" onClick={handleSubmit}>Try again</Button>
            )
          }
        >
          {state.submit.error}
          {rejectedDoctors.length > 0 && (
            <>
              {' '}
              <strong className="font-semibold">
                {rejectedDoctors.join(', ')}
              </strong>{' '}
              {rejectedDoctors.length === 1 ? 'is' : 'are'} not accepting bookings right now —
              their licence has not been approved yet, or the account is inactive. Nothing was
              sent; go back and choose someone else.
            </>
          )}
        </Alert>
      )}

      {attachmentWarning && (
        <Alert tone="warning" onDismiss={() => setAttachmentWarning(null)}>
          {attachmentWarning}
        </Alert>
      )}

      {/* ----------------------------------------------------------- submit -- */}
      <div className="space-y-3">
        {blockers.length > 0 && (
          <ul id="review-blockers" className="space-y-1">
            {blockers.map((blocker) => (
              <li key={blocker} className="flex gap-2 text-body-sm text-warning-800 dark:text-warning-300">
                <AlertCircle aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{blocker}</span>
              </li>
            ))}
          </ul>
        )}

        <Button
          onClick={handleSubmit}
          disabled={blockers.length > 0 || sending}
          loading={sending}
          loadingText={extras.length > 0 ? 'Sending your request…' : 'Sending…'}
          size="lg"
          fullWidth
          leftIcon={<Send aria-hidden="true" className="h-4 w-4" />}
          aria-describedby={blockers.length > 0 ? 'review-blockers' : undefined}
        >
          Send to {payload.doctor_ids.length}{' '}
          {payload.doctor_ids.length === 1 ? 'doctor' : 'doctors'}
        </Button>

        {sending && (
          <p aria-live="polite" className="flex items-center justify-center gap-2 text-caption text-subtle">
            <Spinner size="sm" />
            Do not close this tab — sending your request.
          </p>
        )}

        <p className="flex items-start gap-2 text-caption text-subtle">
          <ShieldCheck aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Sending does not book anything. It invites these doctors to accept one of your times;
            the appointment only exists once one of them does, and you can cancel the request until
            then.
          </span>
        </p>
      </div>
    </div>
  );
}
