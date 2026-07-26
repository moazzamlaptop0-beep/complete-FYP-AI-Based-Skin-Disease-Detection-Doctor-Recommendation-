/**
 * ConsultPage — the consultation stepper.
 *
 * WHAT THIS REPLACES
 * ------------------
 * A three-page, one-way pipeline: /try-now uploaded a photo and showed a
 * verdict, /nearby-doctors made you pick exactly ONE doctor, `/send_report`
 * dispatched the scan to them, and ONLY THEN were you allowed to open a booking
 * modal. Every arrow was one-way. Getting a CRITICAL result was a dead end you
 * discovered after the report had already been sent, and re-taking a blurry
 * photo meant starting the whole thing again.
 *
 * Now it is one route, eight steps, and a state object that can be rewound in
 * three different ways (see consultReducer). Forward moves are guarded by each
 * step's `canEnter`; BACK IS NEVER GUARDED. You can always go and look at an
 * earlier answer without losing a later one — right up until the request is
 * actually sent, at which point the final step declares itself `terminal` and
 * the navigation retires rather than offering to "edit" something that has
 * already reached three doctors' inboxes.
 *
 * THIS ROUTE IS `SECTIONS.FOCUSED`
 * --------------------------------
 * No AppShell, no DashboardLayout, no sidebar — App.jsx renders it bare on
 * purpose, so the page owns its own (deliberately minimal) chrome. It is also
 * NOT behind RequireAuth: an anonymous visitor is meant to be able to upload a
 * photo and see a result. The account is only required from the "Doctors" step
 * onward, and that gate is rendered as an invitation, not a wall.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Lock, RotateCcw, ShieldCheck } from 'lucide-react';

import {
  Alert,
  Button,
  Card,
  CardBody,
  ConfirmDialog,
  EmptyState,
  Stepper,
  cn,
} from '../../components/ui';
import { useOptionalAuth } from '../../context/AuthContext';
import { PATHS } from '../../routes';

import { ConsultProvider, useConsult } from './ConsultContext';
import InlineAuthDialog from './components/InlineAuthDialog';
import { STEPS, isPristineDraft } from './consultReducer';
import { stepElementFor } from './steps';

/**
 * The last-resort full-page route, kept only for the footer link and for anyone
 * who lands here with JavaScript disabled mid-flow. The gate itself opens
 * <InlineAuthDialog> instead: NAVIGATING AWAY UNMOUNTS THIS PAGE, and the photo
 * is a File held in memory, which cannot be written to sessionStorage. A visitor
 * who signed in via a route change came back to an empty first step and had to
 * photograph their skin again.
 */
const SIGN_IN_HREF = `${PATHS.AUTH}?returnTo=${encodeURIComponent(PATHS.CONSULT)}`;

// ---------------------------------------------------------------------------
// Placeholder for a step whose component has not landed yet
// ---------------------------------------------------------------------------

function StepPlaceholder({ step }) {
  return (
    <EmptyState
      title={`${step.title} is not wired up yet`}
      description="This step of the flow is still being built. Everything you have entered so far is kept."
      size="sm"
      bordered
    />
  );
}

// ---------------------------------------------------------------------------
// The account gate — shown INSTEAD of a step that needs a session
// ---------------------------------------------------------------------------

function AccountGate({ step, onSignIn }) {
  return (
    <EmptyState
      icon={<Lock aria-hidden="true" className="h-6 w-6" />}
      tone="primary"
      title="Sign in to continue"
      description={
        `Choosing doctors needs an account, so their reply can reach you. The scan you just `
        + `ran is saved and will be added to your history — your photo, your result and your `
        + `answers stay exactly as they are, and "${step.title}" carries on the moment you are done.`
      }
      action={<Button onClick={onSignIn}>Sign in or create an account</Button>}
      secondaryAction={
        <span className="text-caption text-subtle">
          Nothing is lost — this happens right here, without leaving the page.
        </span>
      }
      bordered
    />
  );
}

// ---------------------------------------------------------------------------
// The flow
// ---------------------------------------------------------------------------

function ConsultFlow() {
  const consult = useConsult();
  const { state, stepIndex, furthest, step, canNext, blockedReason, goToStep, next, back, resetAll } =
    consult;

  const auth = useOptionalAuth();
  const isAuthenticated = Boolean(auth?.isAuthenticated);

  const [confirmReset, setConfirmReset] = useState(false);
  const panelRef = useRef(null);
  const lastStep = useRef(stepIndex);

  /**
   * Move focus (and the viewport) to the panel when the step changes, so a
   * keyboard or screen-reader user is not left at the bottom of the previous
   * step's form. Deliberately NOT on first mount — stealing focus on page load
   * is its own accessibility problem.
   */
  useEffect(() => {
    if (lastStep.current === stepIndex) return;
    lastStep.current = stepIndex;
    const node = panelRef.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    node.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [stepIndex]);

  /**
   * An account is only needed from `requiresAuth` steps onward. Anonymous
   * visitors get steps 1-3 in full.
   */
  const needsAccount = Boolean(step.requiresAuth) && !isAuthenticated;
  const nextStep = STEPS[stepIndex + 1] || null;
  const nextNeedsAccount = Boolean(nextStep?.requiresAuth) && !isAuthenticated;

  const [authOpen, setAuthOpen] = useState(false);

  /**
   * Signed in without leaving the page. Two things still have to happen:
   *
   * 1. RUN (OR RE-RUN) THE ANALYSIS. /predict REQUIRES a session — it is
   *    @require_permission(SCAN_CREATE) and 400s without a user_id, because
   *    ai_scans.user_id is NOT NULL and an ownerless scan is one nobody could
   *    list, delete or consent for. So a photo chosen before signing in has
   *    scan_id === null. The File is still in memory precisely because this was
   *    a dialog, so POSTing it now creates the real row.
   * 2. ADVANCE. They asked for the next step before being interrupted.
   */
  const handleAuthenticated = useCallback(async () => {
    setAuthOpen(false);

    if (consult.state.analysis.scanId == null) {
      // CLAIM FIRST. The guest scan is a real row in `guest_scans`, so adopting
      // it reuses the stored file AND the verdict already on screen. Re-running
      // /predict would classify the image a second time, and a model is not
      // guaranteed to answer identically twice — the diagnosis someone saw as a
      // guest could quietly differ from the one saved to their record.
      const claimed = await consult.claimGuestScans();

      // Only upload if there was nothing to claim (token expired, or the photo
      // was chosen after signing in started).
      if (!claimed && consult.state.image.file) {
        await consult.analyze();
      }
    }

    if (nextNeedsAccount) next();
  }, [consult, nextNeedsAccount, next]);

  /**
   * The guard the ui/Stepper primitive wants. It only knows indices, whereas our
   * `canEnter` reads the whole state, so we adapt: walk forward from 0 and stop
   * at the first step this state cannot satisfy — the same rule the reducer's
   * STEP_GOTO applies, so a clickable dot never disagrees with what happens when
   * you click it.
   */
  const headerSteps = useMemo(() => {
    // A plain forward loop, NOT `.map` with a mutable flag captured by the
    // callback: reassigning across that closure boundary is what the React
    // Compiler's immutability rule (correctly) refuses, because a memo block is
    // allowed to re-run its callback independently.
    const items = [];
    let blocked = false;
    for (let index = 0; index < STEPS.length; index += 1) {
      const entry = STEPS[index];
      const ok = index === 0 ? true : !blocked && entry.canEnter(state);
      if (!ok) blocked = true;
      items.push({
        id: entry.id,
        label: entry.title,
        description: entry.description,
        optional: entry.optional,
        canEnter: () => ok,
      });
    }
    return items;
  }, [state]);

  /**
   * Once the request has been sent the header stops being a navigation control.
   * Stepper renders no interactive element at all when `onStepChange` is absent
   * (rather than a row of disabled buttons), so the dots become what they should
   * be at that point: a picture of a finished journey.
   */
  const onHeaderStepChange = step.terminal ? undefined : goToStep;

  const handleNext = useCallback(() => {
    if (!canNext || nextNeedsAccount) return;
    next();
  }, [canNext, nextNeedsAccount, next]);

  const handleReset = useCallback(() => {
    setConfirmReset(false);
    resetAll();
  }, [resetAll]);

  // An ELEMENT, built once at module scope (see steps/index.js). Creating the
  // component value here instead would remount the step — and lose StepCapture's
  // camera/crop state — on any unrelated re-render of this page.
  const stepElement = stepElementFor(step.id);

  /** Why the Next button is refusing, in one sentence, or ''. */
  const nextHint = nextNeedsAccount
    ? 'Sign in to choose doctors and offer times.'
    : blockedReason;

  const showStartOver = !isPristineDraft(state) && !step.terminal;

  /**
   * The confirmation step is terminal, and the Review step's Send button IS its
   * primary action — a footer "Next: Sent" beside it would be a second, weaker
   * button for the same job that cannot work until the first one has. Both flags
   * are declared on the step in consultReducer, so this page never grows a list
   * of step ids it treats specially.
   */
  const showFooterNav = !step.terminal;
  const showNextButton = showFooterNav && Boolean(nextStep) && !step.hideNext;

  return (
    <div className="min-h-screen bg-canvas text-default">
      {/* ------------------------------------------------------------ header -- */}
      <header className="border-b border-subtle bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 sm:px-6">
          <Button
            as={Link}
            to={PATHS.HOME}
            variant="ghost"
            size="sm"
            leftIcon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />}
          >
            <span className="hidden sm:inline">Home</span>
            <span className="sm:hidden ui-sr-only">Home</span>
          </Button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate font-heading text-heading-sm text-default sm:text-heading-md">
              AI skin check
            </h1>
            <p className="hidden truncate text-caption text-subtle sm:block">
              Step {stepIndex + 1} of {STEPS.length} — {step.description}
            </p>
          </div>

          {showStartOver && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmReset(true)}
              leftIcon={<RotateCcw aria-hidden="true" className="h-4 w-4" />}
            >
              <span className="hidden sm:inline">Start over</span>
              <span className="sm:hidden ui-sr-only">Start over</span>
            </Button>
          )}
        </div>
      </header>

      {/* ----------------------------------------------------------- stepper -- */}
      <div className="border-b border-subtle bg-surface">
        <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
          {/* Six labelled columns do not fit 375px, so phones get dots plus a
              text line; tablets and up get the full stepper. */}
          <div className="sm:hidden">
            <Stepper
              steps={headerSteps}
              current={stepIndex}
              furthest={furthest}
              onStepChange={onHeaderStepChange}
              variant="dots"
              aria-label="Consultation progress"
            />
            <p className="mt-2 text-center text-label-md text-default">
              {step.title}
              {step.optional && <span className="ml-1 font-normal text-subtle">(optional)</span>}
            </p>
          </div>
          <div className="hidden sm:block">
            <Stepper
              steps={headerSteps}
              current={stepIndex}
              furthest={furthest}
              onStepChange={onHeaderStepChange}
              aria-label="Consultation progress"
            />
          </div>
        </div>
      </div>

      {/* -------------------------------------------------------------- body -- */}
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        {state.image.restored && !state.image.file && (
          <Alert tone="info" className="mb-4" title="We kept your draft">
            Your answers and choices survived, but the browser cannot keep the photo file itself
            across a reload. Pick the photo again to carry on.
          </Alert>
        )}

        <Card>
          <CardBody>
            <div
              ref={panelRef}
              tabIndex={-1}
              role="group"
              aria-labelledby="consult-step-title"
              className="outline-none"
            >
              <div className="mb-5">
                <h2
                  id="consult-step-title"
                  className="font-heading text-heading-md text-default"
                >
                  {step.title}
                  {step.optional && (
                    <span className="ml-2 align-middle text-label-sm font-normal text-subtle">
                      optional
                    </span>
                  )}
                </h2>
                <p className="mt-1 text-body-sm text-muted">{step.description}</p>
              </div>

              {needsAccount ? (
                <AccountGate step={step} onSignIn={() => setAuthOpen(true)} />
              ) : stepElement || <StepPlaceholder step={step} />}
            </div>
          </CardBody>
        </Card>

        {/* --------------------------------------------------------- footer -- */}
        {showFooterNav && (
          <nav
            aria-label="Step navigation"
            className={cn(
              'mt-5 flex flex-col-reverse gap-3',
              'sm:flex-row sm:items-center sm:justify-between',
            )}
          >
            <Button
              variant="outline"
              onClick={back}
              disabled={stepIndex === 0}
              leftIcon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />}
              fullWidth
              className="sm:w-auto"
            >
              Back
            </Button>

            <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
              {showNextButton && nextHint && (
                <p
                  className="order-2 text-center text-caption text-subtle sm:order-1 sm:text-right"
                  id="consult-next-hint"
                >
                  {nextHint}
                </p>
              )}
              {showNextButton && (
                nextNeedsAccount ? (
                  <Button
                    onClick={() => setAuthOpen(true)}
                    className="order-1 sm:order-2"
                    rightIcon={<ArrowRight aria-hidden="true" className="h-4 w-4" />}
                    leftIcon={<ShieldCheck aria-hidden="true" className="h-4 w-4" />}
                  >
                    Sign in to continue
                  </Button>
                ) : (
                  <Button
                    onClick={handleNext}
                    disabled={!canNext}
                    aria-describedby={nextHint ? 'consult-next-hint' : undefined}
                    className="order-1 sm:order-2"
                    rightIcon={<ArrowRight aria-hidden="true" className="h-4 w-4" />}
                    fullWidth
                  >
                    {step.optional ? `Continue to ${nextStep.title}` : `Next: ${nextStep.title}`}
                  </Button>
                )
              )}
            </div>
          </nav>
        )}

        <p className="mt-6 text-center text-caption text-subtle">
          This tool is a triage aid, not a diagnosis. If something is bleeding heavily, spreading
          fast or you feel unwell, contact emergency care now.
        </p>
      </main>

      <InlineAuthDialog
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={handleAuthenticated}
        reason={
          'Your scan is saved and will be added to your history the moment you sign in — the '
          + 'photo, the result and your answers are all kept. You carry straight on from here.'
        }
      />

      <ConfirmDialog
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={handleReset}
        tone="danger"
        title="Start over?"
        confirmLabel="Start over"
        cancelLabel="Keep my draft"
        description={
          'This clears the photo, the result, your answers, the doctors you picked and the times '
          + 'you offered. It cannot be undone.'
        }
      />
    </div>
  );
}

export default function ConsultPage() {
  return (
    <ConsultProvider>
      <ConsultFlow />
    </ConsultProvider>
  );
}
