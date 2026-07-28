/**
 * EmergencyBanner — what a CRITICAL or URGENT triage does, and what it must not do.
 *
 * THE WHOLE POINT: EMERGENCY IS NOT A PREREQUISITE
 * ------------------------------------------------
 * In the old flow an urgent verdict was a dead end. You reached it only AFTER
 * the report had already been dispatched to a single doctor, the screen told you
 * to go to a hospital, and the booking path simply stopped. The one user who
 * most needed an appointment was the one user who could not make one.
 *
 * So this component has three hard rules, and they are rules, not preferences:
 *
 *   1. IT NEVER BLOCKS. It is rendered inline, in the normal document flow. It
 *      is not a Modal, it does not trap focus, it does not disable Next, and no
 *      step's `canEnter` consults it. Nothing about it is dismissible-or-stuck.
 *   2. IT OFFERS, IT DOES NOT DEMAND. The express lane is a Switch the patient
 *      may set either way. The backend's own `TriageService.is_express` already
 *      forces express on for CRITICAL/URGENT (`requested or severity in
 *      (CRITICAL, URGENT)`), so for those two the control is shown ON, disabled,
 *      and explained — pretending the patient can turn it off would be a lie.
 *   3. FOR CRITICAL IT GIVES REAL-WORLD ADVICE. An app that scores a mole as
 *      critical and then only offers its own booking form is implying it is a
 *      substitute for care. It is not. So CRITICAL says, first and in plain
 *      words, to seek in-person care — and then, separately, that booking here
 *      is still available and still worth doing.
 *
 * WHERE IT APPEARS
 * ----------------
 * Inside the stepper, on the steps where the patient is making decisions the
 * severity is relevant to (Details and Review). StepResult carries its own
 * first-sighting version of this message, so this one deliberately does not
 * repeat the reveal — it is the persistent reminder plus the lane control.
 */

import React, { useCallback, useId } from 'react';
import { Ambulance, Phone, ShieldAlert, Zap } from 'lucide-react';

import { Alert, Badge, Switch, cn } from '../../../components/ui';
import { useConsult } from '../ConsultContext';
import { effectiveSeverity } from '../consultReducer';

/** The two tiers that turn this on. Compared case-insensitively. */
const CRITICAL = 'critical';
const URGENT = 'urgent';

/**
 * Module-private on purpose: exporting a plain function beside a component is
 * what breaks Fast Refresh for the whole file (`react-refresh/only-export-components`).
 * @param {string|null} severity
 * @returns {{level:'critical'|'urgent'|null, forced:boolean}}
 */
function severityLane(severity) {
  const value = String(severity || '').trim().toLowerCase();
  if (value === CRITICAL) return { level: CRITICAL, forced: true };
  if (value === URGENT) return { level: URGENT, forced: true };
  return { level: null, forced: false };
}

/**
 * @param {object} props
 * @param {boolean} [props.showLaneControl=true] Review shows the control; a step
 *   that only needs the warning can turn it off.
 * @param {string} [props.className]
 */
export default function EmergencyBanner({ showLaneControl = true, className }) {
  const { state, setExpress } = useConsult();
  const severity = effectiveSeverity(state);
  const { level, forced } = severityLane(severity);
  const switchId = useId();

  const handleExpress = useCallback((event) => {
    // Switch may hand back an event or a boolean depending on how it is driven;
    // read the checked flag when there is one, otherwise take the value.
    const next = typeof event === 'boolean' ? event : Boolean(event?.target?.checked);
    setExpress(next);
  }, [setExpress]);

  // Not urgent: no banner at all. An "everything is fine" box on a routine
  // result is noise that trains people to skip the box that matters.
  if (!level) return null;

  const isCritical = level === CRITICAL;
  // Forced by the backend for both tiers, so the UI shows it as already on.
  const expressOn = forced || state.express;

  return (
    <div className={cn('space-y-3', className)}>
      <Alert
        tone={isCritical ? 'danger' : 'warning'}
        title={
          isCritical
            ? 'Get this looked at in person, soon'
            : 'This should be seen sooner rather than later'
        }
        icon={
          isCritical
            ? <Ambulance aria-hidden="true" className="h-5 w-5" />
            : <ShieldAlert aria-hidden="true" className="h-5 w-5" />
        }
      >
        {isCritical ? (
          <>
            <p>
              The triage score puts this in the highest band. Please arrange to be seen face to
              face: your GP, a walk-in clinic, or a hospital. If it is bleeding heavily, spreading
              quickly, or you feel unwell, feverish or dizzy, treat it as an emergency and go now.
            </p>
            <p className="mt-2 flex items-start gap-2">
              <Phone aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                This app cannot examine you, cannot take a biopsy and is not a substitute for
                seeing a doctor in person. It is a triage aid.
              </span>
            </p>
            <p className="mt-2">
              <strong className="font-semibold">Keep going with this request as well.</strong>{' '}
              A dermatologist appointment is still worth having, and an urgent result no longer
              stops you from booking one. That used to be the case and it was wrong.
            </p>
          </>
        ) : (
          <>
            <p>
              The triage score is above routine, so your request goes out on the fast lane and the
              doctors you picked see it at the top of their inbox.
            </p>
            <p className="mt-2">
              If it changes quickly, starts bleeding, or you begin to feel unwell before anyone
              replies, do not wait for this. See someone in person.
            </p>
          </>
        )}
      </Alert>

      {/* ------------------------------------------------------- express lane --
          `border-default`, not `border-subtle`: in light mode `line-subtle` and
          `surface-sunken` are the SAME rgb, so a subtle border on a sunken panel
          is invisible and the control floats with no edge at all. */}
      {showLaneControl && (
        <div className="rounded-card border border-default bg-surface-sunken p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              {/* Tonal chip rather than an icon inside the label text, so the
                  accessible name is "Express lane, On" and not "Express lane"
                  with a decorative glyph glued to the front of it. */}
              <span
                aria-hidden="true"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-field bg-warning-100 text-warning-700"
              >
                <Zap className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                {/* A <p>, not a <label>: Switch already wraps its input in a label,
                    and two <label for> elements pointing at one control is how you
                    get a doubled accessible name. `aria-labelledby` instead. */}
                <p
                  id={`${switchId}-label`}
                  className="flex flex-wrap items-center gap-2 text-label-lg text-default"
                >
                  Express lane
                  {expressOn && <Badge tone="warning" size="sm">On</Badge>}
                </p>
                <p id={`${switchId}-help`} className="mt-1 text-body-sm text-muted">
                  {/* 4 and 72 are TriageService.EXPRESS_TTL_HOURS and
                      ROUTINE_TTL_HOURS. This used to say "the usual 48", which is
                      a deadline the backend has never used. */}
                  Doctors have <strong className="font-semibold">4 hours</strong> to reply instead of
                  the usual 72, the invitation email is flagged priority, and your request sorts
                  above routine ones.
                </p>
                {forced && (
                  <p className="mt-1.5 text-caption text-subtle">
                    A {isCritical ? 'critical' : 'urgent'} score always uses this lane, so it cannot
                    be switched off here. You can still change every other part of the request.
                  </p>
                )}
              </div>
            </div>

            <Switch
              checked={expressOn}
              disabled={forced}
              onChange={handleExpress}
              aria-labelledby={`${switchId}-label`}
              aria-describedby={`${switchId}-help`}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export { EmergencyBanner };
