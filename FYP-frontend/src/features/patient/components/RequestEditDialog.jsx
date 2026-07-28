/**
 * RequestEditDialog — the ONE dialog behind "edit this request" and "send it again".
 *
 * WHAT WAS MISSING
 * ----------------
 * A sent request was immutable and a closed one was a dead end. The only control
 * on the card was Withdraw, so "I can also do Thursday" meant withdrawing (which
 * emails three doctors that the case is closed and drops it out of their inbox)
 * and rebuilding the whole thing from the photo upload — the scan, the six
 * questions, the doctors and the times — for one extra time slot. A withdrawn or
 * expired request was worse: nothing on the page led anywhere, even though the
 * scan, the doctors and the answers were all still on the server.
 *
 * THE TWO MODES DIFFER IN EXACTLY ONE WAY THAT MATTERS
 * ---------------------------------------------------
 *   EDIT     PATCH /api/appointment-requests/<id>
 *            The SAME request. Nobody has accepted it, so the doctors keep their
 *            place in their inbox and are emailed what changed. Only the keys
 *            that actually differ are sent, and only the ones that differ count
 *            as a change server-side.
 *
 *   REAPPLY  POST /api/appointment-requests
 *            A NEW request reusing the old one's scan, answers and note, sent to
 *            whichever doctors the patient picks — the original ones by default,
 *            or different ones entirely. The withdrawn/expired/declined row is
 *            READ ONLY — history keeps showing what actually happened — so the
 *            response is a NEW request_id and the caller must refetch rather than
 *            patch a row.
 *
 * REASSIGNMENT IS WHAT MAKES A DECLINED REQUEST USABLE
 * ---------------------------------------------------
 * Carrying the original invitees forward is right for a withdrawn or expired
 * request and useless for a declined one, where the doctors who said no are
 * exactly the ones who must not be asked again. So in reapply mode the doctors
 * are EDITABLE (see DoctorReassignPicker) and anyone who declined starts
 * unselected. Without that, "find a different dermatologist" meant photographing
 * the same patch again, because the consult stepper begins at Capture.
 *
 * TIMES ALWAYS HAVE TO BE RE-CONFIRMED, IN BOTH MODES
 * ---------------------------------------------------
 * `normalize_slots` rejects the WHOLE list if ONE offered time has passed, so a
 * request sent yesterday cannot be re-sent verbatim and a stale pick would 400
 * the edit with nothing changed. Picks whose time has gone are therefore dropped
 * on open and the patient is told, rather than being handed a form that cannot
 * be submitted.
 *
 * WHO IS INVITED IS NOT EDITABLE HERE
 * ----------------------------------
 * Adding a doctor is a new invitation and removing one is a withdrawal aimed at a
 * single doctor; both are what the consult stepper's Doctors step is for. What
 * this dialog changes is everything those doctors have not acted on yet.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, Info, Save, Send, UserPlus, Zap } from 'lucide-react';

import {
  Alert,
  Button,
  Checkbox,
  Field,
  Modal,
  ModalFooter,
  Switch,
  Textarea,
  notify,
} from '../../../components/ui';
import { ApiError, patch, post } from '../../../lib/api';
import { requests as requestEndpoints } from '../../../lib/endpoints';
import { LIMITS, SYMPTOM_QUESTIONS, slotKey } from '../../consult/consultReducer';
import SlotOfferPicker from '../../consult/components/SlotOfferPicker';
import SlotPreferenceList from '../../consult/components/SlotPreferenceList';
import DoctorReassignPicker from './DoctorReassignPicker';

const MAX_NOTE = LIMITS.MAX_DESCRIPTION;

const MODES = {
  edit: {
    title: 'Edit this request',
    description:
      'Nobody has accepted it yet, so you can still change your times, your note and how urgent it '
      + 'is. The doctors keep their place in the queue and are told what changed.',
    confirmLabel: 'Save changes',
    icon: Save,
    success: 'Your request has been updated. The doctors still deciding have been told.',
  },
  reapply: {
    title: 'Send this request again',
    description:
      'The same scan and answers, sent to the doctors you choose here: the original ones, or '
      + 'different ones. No new photo, and the closed request stays in your history exactly as it is.',
    confirmLabel: 'Send request',
    icon: Send,
    success: 'Your request has been sent again.',
  },
};

/**
 * True when a date+time pair is already behind us, on the LOCAL clock the patient
 * is reading. The server re-checks against clinic time and rejects the whole list
 * on the first stale entry, so anything this refuses is genuinely unsendable.
 */
function hasPassed(slot) {
  const [year, month, day] = String(slot?.slot_date || '').split('-').map(Number);
  const [hour, minute] = String(slot?.slot_time || '').split(':').map(Number);
  if (![year, month, day, hour, minute].every((part) => Number.isFinite(part))) return false;
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime() < Date.now();
}

/**
 * The note WITHOUT the withdrawal marker.
 *
 * `cancel_request` appends "[Withdrawn] <reason>" onto `patient_note`, so a
 * withdrawn request's note ends with the reason the patient gave for withdrawing
 * it. Carrying that into a re-send would post "the rash cleared up" to three
 * doctors as the reason they are being asked to look.
 */
function noteWithoutWithdrawal(text) {
  const source = String(text || '');
  const marker = source.indexOf('[Withdrawn]');
  return (marker === -1 ? source : source.slice(0, marker)).trim();
}

/** All six false — the shape the triage engine expects when answers are given. */
function emptyAnswers() {
  return SYMPTOM_QUESTIONS.reduce((accumulator, question) => {
    accumulator[question.key] = false;
    return accumulator;
  }, {});
}

/**
 * @param {object} props
 * @param {'edit'|'reapply'} props.mode
 * @param {object|null} props.request A `/api/appointment-requests` item.
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {() => void} props.onDone Refetch the list — reapply returns a NEW id.
 */
export function RequestEditDialog({ mode = 'edit', request, open, onClose, onDone }) {
  const config = MODES[mode] || MODES.edit;

  const [picks, setPicks] = useState([]);
  const [note, setNote] = useState('');
  const [express, setExpress] = useState(false);
  const [consent, setConsent] = useState(false);
  const [answers, setAnswers] = useState(() => emptyAnswers());
  const [answersTouched, setAnswersTouched] = useState(false);
  const [droppedTimes, setDroppedTimes] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  /** REAPPLY ONLY — `{id, name, photo}` in the patient's preference order. */
  const [selected, setSelected] = useState([]);

  const invites = useMemo(
    () => (Array.isArray(request?.doctors) ? request.doctors : []),
    [request],
  );

  /**
   * The invitees an EDIT may still offer times to. A doctor who has DECLINED
   * cannot accept anything, so offering their times back to the patient is
   * offering something that can never happen — which on an Open request leaves
   * exactly the ones still deciding.
   */
  const openInvites = useMemo(
    () => invites.filter((invite) => invite.response === 'Pending'),
    [invites],
  );

  /** Named in the reassign explainer, so "they start unselected" is not a mystery. */
  const declinedNames = useMemo(
    () => invites
      .filter((invite) => invite.response === 'Declined')
      .map((invite) => invite.doctor_name || `Doctor #${invite.doctor_id}`),
    [invites],
  );

  /** Editing keeps the invitees it was sent to; re-sending is free to reassign. */
  const doctorIds = useMemo(() => (
    mode === 'edit'
      ? openInvites.map((invite) => Number(invite.doctor_id)).filter(Number.isFinite)
      : selected.map((doctor) => Number(doctor.id)).filter(Number.isFinite)
  ), [mode, openInvites, selected]);

  const doctorsById = useMemo(() => {
    const map = {};
    if (mode === 'edit') {
      openInvites.forEach((invite) => {
        map[invite.doctor_id] = {
          name: invite.doctor_name || `Doctor #${invite.doctor_id}`,
          photo: invite.profile_image || null,
        };
      });
    } else {
      selected.forEach((doctor) => {
        map[doctor.id] = { name: doctor.name, photo: doctor.photo || null };
      });
    }
    return map;
  }, [mode, openInvites, selected]);

  // Re-seed from the request every time the dialog opens: it is the caller's list
  // row, and that row was refetched after the last mutation. Deliberately does
  // NOT depend on `doctorIds` — in reapply mode that is derived from `selected`,
  // which this effect writes, and the cycle would wipe the patient's picks on
  // every doctor they added.
  useEffect(() => {
    if (!open || !request) return;

    const invited = Array.isArray(request.doctors) ? request.doctors : [];
    const nameFor = (id) => invited.find((invite) => invite.doctor_id === id)?.doctor_name || '';

    // Anyone who DECLINED starts unselected: they are the reason this request is
    // being re-sent. The rest carry over so the common case is one click.
    setSelected(mode === 'reapply'
      ? invited
        .filter((invite) => invite.response !== 'Declined')
        .map((invite) => ({
          id: invite.doctor_id,
          name: invite.doctor_name || `Doctor #${invite.doctor_id}`,
          photo: invite.profile_image || null,
        }))
      : []);

    const stillOpen = new Set(
      invited.filter((invite) => invite.response === 'Pending').map((invite) => invite.doctor_id),
    );
    const existing = (Array.isArray(request.slots) ? request.slots : []).map((slot) => ({
      slot_date: slot.slot_date,
      slot_time: slot.slot_time,
      doctor_id: slot.doctor_id ?? null,
      doctorName: nameFor(slot.doctor_id),
      key: slotKey(slot),
    }));

    // Reapply always starts empty: every time on a closed request is either past
    // or was chosen for a week that has moved on, and silently carrying them
    // forward would look like a booking the patient never re-confirmed.
    const usable = mode === 'reapply'
      ? []
      : existing.filter((pick) => (
        !hasPassed(pick) && (pick.doctor_id === null || stillOpen.has(pick.doctor_id))
      ));

    setPicks(usable);
    setDroppedTimes(mode === 'reapply' ? 0 : existing.length - usable.length);
    setNote(
      (mode === 'reapply'
        ? noteWithoutWithdrawal(request.patient_note)
        : String(request.patient_note || '')
      ).slice(0, MAX_NOTE),
    );
    setExpress(Boolean(request.express));
    setConsent(Boolean(request.consent_share_scan));
    setAnswers({ ...emptyAnswers(), ...(request.scan?.questionnaire_answers || {}) });
    setAnswersTouched(false);
    setError(null);
    setBusy(false);
  }, [open, request, mode]);

  /**
   * Add or remove a doctor, and drop any time that belonged to one being removed
   * — the same rule the stepper's DOCTOR_TOGGLE follows, and the same rule the
   * server enforces (a preferred slot may only name a doctor on the request).
   */
  const toggleDoctor = useCallback((doctor) => {
    const id = Number(doctor?.id);
    if (!Number.isFinite(id)) return;

    setSelected((previous) => {
      if (previous.some((entry) => Number(entry.id) === id)) {
        setPicks((picked) => picked.filter((pick) => pick.doctor_id !== id));
        return previous.filter((entry) => Number(entry.id) !== id);
      }
      if (previous.length >= LIMITS.MAX_DOCTORS) return previous;
      return [...previous, { id, name: doctor.name, photo: doctor.photo || null }];
    });
  }, []);

  const addPick = useCallback((slot) => {
    setPicks((previous) => {
      if (previous.length >= LIMITS.MAX_SLOTS) return previous;
      const key = slotKey(slot);
      if (previous.some((pick) => pick.key === key)) return previous;
      return [...previous, { ...slot, key }];
    });
  }, []);

  const removePick = useCallback((key) => {
    setPicks((previous) => previous.filter((pick) => pick.key !== key));
  }, []);

  const reorderPicks = useCallback((from, to) => {
    setPicks((previous) => {
      if (to < 0 || to >= previous.length || from === to) return previous;
      const next = [...previous];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const toggleAnswer = useCallback((key) => {
    setAnswersTouched(true);
    setAnswers((previous) => ({ ...previous, [key]: !previous[key] }));
  }, []);

  if (!request) return null;

  /** `rank` is the POSITION IN THIS LIST, so it is recomputed at send time. */
  const preferredSlots = picks.map((pick, index) => ({
    slot_date: pick.slot_date,
    slot_time: pick.slot_time,
    doctor_id: pick.doctor_id ?? null,
    rank: index,
  }));

  // An EDIT with nobody left pending is a dead form — the invitees are fixed and
  // they have all replied. A REASSIGN with nobody chosen is just an unfinished
  // one, and the picker below is how it gets finished.
  const noDoctorsLeft = doctorIds.length === 0;
  const canSubmit = !noDoctorsLeft && preferredSlots.length >= LIMITS.MIN_SLOTS;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'edit') {
        // PARTIAL: `answers` is left out unless the patient actually touched the
        // six controls. Sending it re-runs triage, which can move the severity,
        // the express lane and the expiry — not something a note edit should do.
        const body = {
          preferred_slots: preferredSlots,
          patient_note: note.trim(),
          express,
          consent_share_scan: consent,
          ...(answersTouched ? { answers } : {}),
        };
        const result = await patch(requestEndpoints.update(request.request_id), body);
        notify.success(
          Array.isArray(result?.changed) && result.changed.length === 0
            ? 'Nothing had changed, so the request is untouched.'
            : config.success,
        );
      } else {
        await post(requestEndpoints.create(), {
          scan_id: request.scan_id ?? null,
          doctor_ids: doctorIds,
          preferred_slots: preferredSlots,
          // Whatever the patient last told us, unless they changed it here. Null
          // is deliberate: "skipped" is not "answered no to all six".
          answers: (answersTouched || request.scan?.questionnaire_answers) ? answers : null,
          patient_note: note.trim(),
          express,
          consent_share_scan: consent,
        });
        notify.success(config.success);
      }
      onClose?.();
      // Always a refetch: reapply returns a NEW request_id and an edit changes
      // expires_at and the severity badge, so patching the clicked row lies.
      onDone?.();
    } catch (err) {
      const conflict = err instanceof ApiError && err.status === 409;
      setError(
        conflict
          ? `${err.message} Close this and refresh your requests to see where it got to.`
          : (err?.message || 'That change could not be saved.'),
      );
    } finally {
      setBusy(false);
    }
  };

  const Icon = config.icon;

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      size="2xl"
      title={config.title}
      description={config.description}
      footer={
        <ModalFooter>
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            leftIcon={<Icon className="h-4 w-4" />}
            onClick={submit}
            loading={busy}
            loadingText={mode === 'edit' ? 'Saving' : 'Sending'}
            disabled={!canSubmit}
          >
            {config.confirmLabel}
          </Button>
        </ModalFooter>
      }
    >
      <div className="flex flex-col gap-5">
        {error && <Alert tone="danger" title="That did not go through">{error}</Alert>}

        {mode === 'edit' && noDoctorsLeft && (
          <Alert tone="warning" title="There is nobody left to ask on this request">
            Every doctor you invited has already replied, so there is nothing left to change here.
            Withdraw it and send it again. You can pick different dermatologists then, without
            re-scanning.
          </Alert>
        )}

        {droppedTimes > 0 && (
          <Alert tone="info" title={droppedTimes === 1 ? 'One of your times has passed' : `${droppedTimes} of your times have passed`}>
            {droppedTimes === 1 ? 'It has' : 'They have'} been taken off the list: a request cannot
            offer a time that is behind us. Pick {droppedTimes === 1 ? 'another' : 'others'} below.
          </Alert>
        )}

        {mode === 'reapply' && (
          <>
            <p className="flex items-start gap-2 rounded-card border border-subtle bg-surface-sunken p-3 font-body text-body-sm text-default">
              <Info aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-primary-700" />
              <span>
                Your scan
                {request.scan?.disease ? ` (${request.scan.disease})` : ''}
                {' '}
                and your answers come with it, no new photo. Choose up to {LIMITS.MAX_DOCTORS}
                {' '}
                dermatologists below and offer times from their own schedules. Nothing is booked:
                whoever accepts one of your times first takes the appointment.
                {declinedNames.length > 0 && (
                  <>
                    {' '}
                    {declinedNames.length === 1
                      ? `${declinedNames[0]} declined, so they start unselected.`
                      : `${declinedNames.join(' and ')} declined, so they start unselected.`}
                  </>
                )}
              </span>
            </p>

            <DoctorReassignPicker
              selected={selected}
              max={LIMITS.MAX_DOCTORS}
              onToggle={toggleDoctor}
            />
          </>
        )}

        {/* ---------------------------------------------------- the times -- */}
        {noDoctorsLeft && mode === 'reapply' ? (
          <p className="flex items-center gap-2 rounded-card border border-dashed border-strong p-4 font-body text-body-sm text-muted">
            <UserPlus aria-hidden="true" className="h-4 w-4 shrink-0" />
            Pick at least one doctor above and their free times will appear here.
          </p>
        ) : null}

        {!noDoctorsLeft && (
          <>
            <SlotPreferenceList
              picks={picks}
              max={LIMITS.MAX_SLOTS}
              onRemove={removePick}
              onReorder={reorderPicks}
              doctorsById={doctorsById}
            />

            <SlotOfferPicker
              doctorIds={doctorIds}
              doctorsById={doctorsById}
              picks={picks}
              max={LIMITS.MAX_SLOTS}
              onAdd={addPick}
              onRemove={removePick}
            />
          </>
        )}

        {/* -------------------------------------------------- the symptoms -- */}
        <fieldset className="rounded-card border border-subtle bg-surface p-4">
          <legend className="px-1 font-body text-label-md text-default">
            Has anything changed about the symptoms?
          </legend>
          <p className="mb-3 font-body text-caption text-subtle">
            Optional. Tick anything that is true now: it can raise how urgently the doctors see
            this, and it never lowers a severity a doctor has set by hand.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SYMPTOM_QUESTIONS.map((question) => (
              <Checkbox
                key={question.key}
                label={question.label}
                checked={Boolean(answers[question.key])}
                onChange={() => toggleAnswer(question.key)}
                size="sm"
              />
            ))}
          </div>
        </fieldset>

        {/* ----------------------------------------------------- the rest -- */}
        <Field
          label="Your note to the doctors"
          hint={`${note.length} of ${MAX_NOTE} characters. They read the first few lines first.`}
        >
          <Textarea
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, MAX_NOTE))}
            placeholder="e.g. it has started itching at night since I sent this"
            maxLength={MAX_NOTE}
          />
        </Field>

        <Switch
          label="Treat this as urgent (express)"
          description="Shortens the reply window to a few hours. Only genuine emergencies: it puts you in front of other patients."
          checked={express}
          onChange={(event) => setExpress(event.target.checked)}
        />

        <Checkbox
          label="These doctors may open the photograph"
          description={
            request.scan?.is_sensitive
              ? 'Your scan is marked sensitive, so they still get a blurred preview until they '
                + 'explicitly reveal it, and that is logged against their name.'
              : 'Untick and they see the diagnosis, the severity and your note, but not the picture.'
          }
          checked={consent}
          onChange={(event) => setConsent(event.target.checked)}
        />

        {!canSubmit && !noDoctorsLeft && (
          <p className="flex items-center gap-2 font-body text-body-sm text-muted">
            <CalendarClock aria-hidden="true" className="h-4 w-4 shrink-0" />
            Offer at least one time to {mode === 'edit' ? 'save this' : 'send this again'}.
          </p>
        )}

        {express && (
          <p className="flex items-start gap-2 font-body text-caption text-warning-700">
            <Zap aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              The express lane is confirmed against your scan&apos;s severity on the server, not
              against this switch. Ticking it cannot invent an emergency.
            </span>
          </p>
        )}
      </div>
    </Modal>
  );
}

export default RequestEditDialog;
