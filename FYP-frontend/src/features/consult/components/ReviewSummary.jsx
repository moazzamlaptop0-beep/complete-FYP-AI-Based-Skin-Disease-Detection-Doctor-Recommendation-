/**
 * ReviewSummary — everything the request contains, with a way back to each part.
 *
 * IT READS LIKE AN ORDER, NOT LIKE A FORM PLAYED BACK
 * --------------------------------------------------
 * This is the last screen before a photograph of someone's skin reaches up to
 * three strangers, so it is laid out the way a clinical order is: a header that
 * names what is being sent, a four-figure "at a glance" strip so nothing has to
 * be counted by eye, then one titled block per part of the request. Each block
 * owns exactly one fact and exactly one way to change it.
 *
 * WHY EVERY SECTION HAS ITS OWN EDIT LINK
 * ---------------------------------------
 * A review screen whose only control is "Back" makes the user walk backwards
 * through four steps to fix a typo and then forwards through four more to
 * return. Because `STEP_GOTO` allows any BACKWARD jump unguarded and re-checks
 * every gate on the way forward, jumping straight to the step that owns a fact
 * is both safe and the obvious thing to offer. The links are real buttons with
 * accessible names that say what they edit ("Change the doctors"), not four
 * identical "Edit"s.
 *
 * WHY IT IS RENDERED FROM `requestPayload(state)` AND NOT FROM THE STATE
 * ---------------------------------------------------------------------
 * The payload builder drops slots whose doctor was de-selected, recomputes
 * ranks, trims the note and nulls skipped answers. Summarising the raw state
 * would therefore show a plan subtly different from the one being sent — a
 * fifth slot listed here and absent on the wire is exactly the bug a review
 * screen exists to prevent. So the counts and the order below come from the
 * payload; only the human labels (names, photos) come from the state.
 *
 * COLOUR CONTRACT
 * ---------------
 * The rank pills are a solid `primary-600` fill, which re-ramps to rgb(94 149 237)
 * on dark where white text is 3.0:1 and fails, so they carry the sanctioned
 * `dark:text-primary-50` twin. Every sunken row uses `border-default`, because in
 * light mode `border-subtle` and `bg-surface-sunken` resolve to the same rgb and a
 * subtle border on a sunken row is literally invisible.
 */

import React from 'react';
import {
  CalendarClock,
  FileText,
  ImageIcon,
  MessageSquareText,
  Pencil,
  Stethoscope,
  Users,
} from 'lucide-react';

import {
  Avatar,
  Badge,
  Button,
  SeverityBadge,
  cn,
} from '../../../components/ui';
import { formatTime } from '../../../lib/format';
import { resolveImageUrl } from '../../../lib/imageUrl';
import { STEP_IDS, effectiveSeverity, requestPayload } from '../consultReducer';
import { friendlyDate } from '../lib/slotDates';

/** Solid mid-scale fill, so the label needs its dark twin. */
const RANK_PILL = 'bg-primary-600 text-white dark:text-primary-50';

/** 'basal_cell_carcinoma' -> 'Basal cell carcinoma'. Mirrors StepResult. */
function prettyDisease(value) {
  const text = String(value || '').replace(/[_-]+/g, ' ').trim();
  if (!text) return 'No clear match';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * One block of the summary.
 * @param {object} props
 * @param {string} props.title
 * @param {React.ReactNode} props.icon
 * @param {string} props.editLabel The BUTTON's accessible name — never bare "Edit".
 * @param {() => void} props.onEdit
 */
function Section({ title, icon, editLabel, onEdit, children }) {
  return (
    <section className="border-t border-subtle p-4 first:border-t-0 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* h4, not h3: the masthead below is the h3 and this component renders
            inside ConsultPage's own h2, so the outline stays in order. */}
        <h4 className="flex items-center gap-2.5 text-label-lg text-default">
          <span
            aria-hidden="true"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-field bg-primary-100 text-primary-700"
          >
            {icon}
          </span>
          {title}
        </h4>
        <Button
          variant="ghost"
          size="sm"
          onClick={onEdit}
          leftIcon={<Pencil aria-hidden="true" className="h-3.5 w-3.5" />}
        >
          {editLabel}
        </Button>
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** One figure in the at-a-glance strip. */
function Glance({ label, value }) {
  return (
    <div className="min-w-0 flex-1 px-3 py-2.5 first:pl-0 last:pr-0">
      <p className="text-overline uppercase text-subtle">{label}</p>
      <p className="mt-0.5 truncate text-label-md text-default">{value}</p>
    </div>
  );
}

/**
 * @param {object} props
 * @param {object} props.state the whole consult state
 * @param {(id:string)=>void} props.onEditStep
 */
export default function ReviewSummary({ state, onEditStep }) {
  const payload = requestPayload(state);
  const { analysis, triage, image, doctors, details } = state;
  const severity = effectiveSeverity(state);
  const percent = analysis.confidence === null ? null : Math.round(analysis.confidence * 100);

  /** Name lookup for the slot rows, from the doctors actually being invited. */
  const doctorsById = {};
  doctors.selected.forEach((doctor) => {
    const id = doctor.id ?? doctor.doctor_id ?? doctor.user_id;
    if (id !== undefined && id !== null) doctorsById[Number(id)] = doctor;
  });

  const attachments = Array.isArray(details.attachments) ? details.attachments : [];
  const sendableAttachments = attachments.filter((entry) => entry.file);

  return (
    <div className="overflow-hidden rounded-card border border-subtle bg-surface shadow-card">
      {/* --------------------------------------------------------- masthead --
          Names the document before listing its contents, the way a printed order
          does. The hairline is the both-theme brand gradient. */}
      <div
        aria-hidden="true"
        className={cn(
          'h-1 w-full',
          'bg-gradient-to-r from-primary-600 to-accent-700 dark:from-primary-400 dark:to-accent-300',
        )}
      />
      <header className="border-b border-subtle bg-surface-sunken p-4 sm:p-5">
        <p className="text-overline uppercase text-accent-700 dark:text-accent-400">
          What you are sending
        </p>
        <h3 className="mt-1 font-heading text-heading-md text-default">
          Consultation request summary
        </h3>

        <div className="mt-3 flex items-stretch divide-x divide-default">
          <Glance label="Scan" value={payload.scan_id ? `#${payload.scan_id}` : 'Not saved'} />
          <Glance
            label="Doctors"
            value={`${payload.doctor_ids.length} invited`}
          />
          <Glance
            label="Times"
            value={`${payload.preferred_slots.length} offered`}
          />
          <Glance
            label="Your note"
            value={payload.patient_note ? `${payload.patient_note.length} chars` : 'None'}
          />
        </div>
      </header>

      {/* ------------------------------------------------------------- scan -- */}
      <Section
        title="The scan"
        icon={<Stethoscope className="h-4 w-4" />}
        editLabel="Change the photo"
        onEdit={() => onEditStep(STEP_IDS.CAPTURE)}
      >
        <div className="flex gap-4">
          <div className="h-20 w-20 shrink-0 overflow-hidden rounded-card border border-default bg-surface-sunken sm:h-24 sm:w-24">
            {image.previewUrl || image.dataUrl ? (
              <img
                src={image.previewUrl || image.dataUrl}
                alt="The area you photographed"
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-caption text-subtle">
                <ImageIcon aria-hidden="true" className="h-5 w-5" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <p className="font-heading text-heading-sm text-default">
              {prettyDisease(analysis.disease)}
            </p>
            <p className="mt-0.5 text-body-sm text-muted">
              {percent === null ? 'Confidence not reported' : `${percent}% model confidence`}
              {image.isSensitive && ' · marked sensitive'}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {severity && <SeverityBadge severity={severity} />}
              {payload.express && <Badge tone="warning" size="sm">Express</Badge>}
              {payload.answers === null ? (
                <Badge tone="neutral" size="sm">Questions skipped</Badge>
              ) : (
                <Badge tone="primary" size="sm">
                  {Object.values(payload.answers).filter(Boolean).length} of 6 symptoms flagged
                </Badge>
              )}
            </div>
          </div>
        </div>

        {triage.reasons.length > 0 && (
          <ul className="mt-3 space-y-1">
            {triage.reasons.map((reason) => (
              <li key={reason} className="flex gap-2 text-body-sm text-muted">
                <span
                  aria-hidden="true"
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-pill bg-primary-500"
                />
                <span>{reason}</span>
              </li>
            ))}
          </ul>
        )}

        {!payload.scan_id && (
          <p className="mt-3 text-body-sm text-danger-700">
            This scan has no saved id, so it cannot be attached. Go back and run the analysis again.
          </p>
        )}
      </Section>

      {/* ---------------------------------------------------------- doctors -- */}
      <Section
        title={`Doctors invited (${payload.doctor_ids.length})`}
        icon={<Users className="h-4 w-4" />}
        editLabel="Change the doctors"
        onEdit={() => onEditStep(STEP_IDS.DOCTORS)}
      >
        <ol className="space-y-2">
          {doctors.selected.map((doctor, index) => {
            const photo = resolveImageUrl(doctor.photo, { fallback: null });
            return (
              <li
                key={doctor.id ?? index}
                className="flex items-center gap-3 rounded-field border border-default bg-surface-sunken p-2.5"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-pill',
                    'font-numeric text-caption tabular-nums',
                    RANK_PILL,
                  )}
                >
                  {index + 1}
                </span>
                <Avatar src={photo || undefined} name={doctor.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-label-md text-default">{doctor.name}</p>
                  <p className="truncate text-caption text-subtle">
                    {doctor.specialty}
                    {doctor.city && ` · ${doctor.city}`}
                  </p>
                </div>
                {!doctor.isVerified && (
                  <Badge tone="warning" size="sm">Pending approval</Badge>
                )}
              </li>
            );
          })}
        </ol>
        <p className="mt-2 text-caption text-subtle">
          All {payload.doctor_ids.length === 1 ? 'of them' : payload.doctor_ids.length} get the same
          request at the same time. The first to accept takes it, and the others are told it is
          closed, so you will never be double-booked.
        </p>
      </Section>

      {/* ------------------------------------------------------------ times -- */}
      <Section
        title={`Times you are offering (${payload.preferred_slots.length})`}
        icon={<CalendarClock className="h-4 w-4" />}
        editLabel="Change the times"
        onEdit={() => onEditStep(STEP_IDS.SLOTS)}
      >
        <ol className="space-y-2">
          {payload.preferred_slots.map((slot, index) => (
            <li
              key={`${slot.slot_date}|${slot.slot_time}|${slot.doctor_id ?? 'any'}`}
              className={cn(
                'flex items-center gap-3 rounded-field border p-2.5',
                index === 0
                  ? 'border-primary-300 bg-primary-50'
                  : 'border-default bg-surface-sunken',
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-pill',
                  'font-numeric text-caption tabular-nums',
                  index === 0 ? RANK_PILL : 'bg-neutral-200 text-neutral-700',
                )}
              >
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-label-md text-default">
                  {friendlyDate(slot.slot_date)} at {formatTime(slot.slot_time)}
                  {index === 0 && (
                    <span className="ml-2 text-caption font-normal text-primary-700">
                      first choice
                    </span>
                  )}
                </p>
                <p className="truncate text-caption text-subtle">
                  with{' '}
                  {slot.doctor_id === null
                    ? 'any of the doctors above'
                    : doctorsById[slot.doctor_id]?.name || `Doctor #${slot.doctor_id}`}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      {/* ------------------------------------------------------------- note -- */}
      <Section
        title="What you told them"
        icon={<MessageSquareText className="h-4 w-4" />}
        editLabel="Change your description"
        onEdit={() => onEditStep(STEP_IDS.DETAILS)}
      >
        {payload.patient_note ? (
          <blockquote className="whitespace-pre-wrap rounded-field border-l-4 border-primary-400 bg-surface-sunken p-3.5 text-body-sm text-default">
            {payload.patient_note}
          </blockquote>
        ) : (
          <p className="text-body-sm text-muted">
            You have not added a description. That is fine, but a sentence about when it started
            and whether it has changed is the thing a photo cannot show.
          </p>
        )}

        {attachments.length > 0 && (
          <div className="mt-3">
            <p className="flex items-center gap-1.5 text-caption text-subtle">
              <FileText aria-hidden="true" className="h-3.5 w-3.5" />
              {sendableAttachments.length} extra photo
              {sendableAttachments.length === 1 ? '' : 's'}
              {attachments.length !== sendableAttachments.length
                && ` (${attachments.length - sendableAttachments.length} could not be restored from your draft)`}
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {attachments.map((attachment) => (
                <li key={attachment.id}>
                  {attachment.thumbUrl ? (
                    <img
                      src={attachment.thumbUrl}
                      alt={`Extra photo: ${attachment.name}`}
                      className={cn(
                        'h-14 w-14 rounded-field border border-default object-cover',
                        !attachment.file && 'opacity-50 grayscale',
                      )}
                    />
                  ) : (
                    <span className="flex h-14 w-14 items-center justify-center rounded-field border border-default bg-surface-sunken text-caption text-subtle">
                      ?
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>
    </div>
  );
}

export { ReviewSummary };
