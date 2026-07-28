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
 * earlier answer without losing a later one, right up until the request is
 * actually sent, at which point the final step declares itself `terminal` and
 * the navigation retires rather than offering to "edit" something that has
 * already reached three doctors' inboxes.
 *
 * THE SHELL
 * ---------
 * A dedicated wizard frame, not a page with a widget in it:
 *  - `xl` and up : a true 3-column workspace. The rail keeps the journey, the
 *    step card grows to fill the middle, and a sticky right column carries the
 *    Next/Back/Start-over actions plus a "Step X of Y / Up next" card, so the
 *    space beside the content works instead of sitting empty.
 *  - `lg..xl`    : a sticky left rail owns the journey (brand, pitch, the full
 *    vertical stepper, trust notes); the step renders in a focused column with
 *    inline Back/Next below it.
 *  - below `lg`  : a slim top bar with "Step X of Y" and a brand-gradient
 *    progress bar; a compact horizontal stepper at `sm..lg`; Back/Next in a
 *    sticky bottom bar within thumb reach.
 *
 * ONE PROGRESS SYSTEM, THREE SIZES
 * --------------------------------
 * The rail meter, the phone bar under the header and the Stepper's own
 * connectors all draw from `PROGRESS_FILL` — the both-theme brand gradient — so
 * moving between breakpoints does not feel like moving between products. The
 * gradient's two stops resolve to the SAME physical colours in light and dark
 * (see tokens.css), which is what keeps white legible on it everywhere.
 *
 * THIS ROUTE IS `SECTIONS.FOCUSED`
 * --------------------------------
 * No AppShell, no DashboardLayout, no sidebar. It is also NOT behind
 * RequireAuth: an anonymous visitor is meant to be able to upload a photo and
 * see a result. The account is only required from the "Doctors" step onward,
 * and that gate is rendered as an invitation, not a wall.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Camera,
  CheckCircle2,
  ClipboardList,
  FileText,
  ListChecks,
  Lock,
  RotateCcw,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Stethoscope,
} from 'lucide-react';

import {
  Alert,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Stepper,
  cn,
} from '../../components/ui';
import { useOptionalAuth } from '../../context/AuthContext';
import { PATHS } from '../../routes';

import { ConsultProvider, useConsult } from './ConsultContext';
import InlineAuthDialog from './components/InlineAuthDialog';
import { STEPS, STEP_IDS, isPristineDraft } from './consultReducer';
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

/**
 * THE brand progress fill, shared by every progress surface on this page.
 *
 * `from-primary-600 to-accent-700` with `dark:from-primary-400 dark:to-accent-300`
 * is the one measured both-theme recipe: the light and dark stops resolve to the
 * same two physical colours, so the bar reads identically in either theme
 * instead of washing out to a pale blue.
 */
const PROGRESS_FILL =
  'bg-gradient-to-r from-primary-600 to-accent-700 dark:from-primary-400 dark:to-accent-300';

/** One tinted icon per step, for the step header chip. */
const STEP_ICONS = {
  [STEP_IDS.CAPTURE]: Camera,
  [STEP_IDS.RESULT]: Sparkles,
  [STEP_IDS.SYMPTOMS]: ClipboardList,
  [STEP_IDS.DOCTORS]: Stethoscope,
  [STEP_IDS.SLOTS]: CalendarDays,
  [STEP_IDS.DETAILS]: FileText,
  [STEP_IDS.REVIEW]: ListChecks,
  [STEP_IDS.CONFIRMATION]: CheckCircle2,
};

/** The "optional" affordance, so it looks the same in all three places. */
const OPTIONAL_CHIP =
  'ml-2.5 inline-flex items-center rounded-pill border border-default bg-surface-sunken '
  + 'px-2 py-0.5 align-middle text-label-sm font-medium text-subtle';

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
        + `ran is saved and will be added to your history: your photo, your result and your `
        + `answers stay exactly as they are, and "${step.title}" carries on the moment you are done.`
      }
      action={<Button onClick={onSignIn}>Sign in or create an account</Button>}
      secondaryAction={
        <span className="text-caption text-subtle">
          Nothing is lost. This happens right here, without leaving the page.
        </span>
      }
      bordered
    />
  );
}

// ---------------------------------------------------------------------------
// The shared progress meter (rail) — the same fill as the phone bar
// ---------------------------------------------------------------------------

function RailMeter({ stepIndex, total, percent }) {
  return (
    <div className="mt-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-label-md text-default">
          Step {stepIndex + 1} of {total}
        </p>
        <p className="font-numeric text-caption tabular-nums text-subtle">{percent}%</p>
      </div>
      {/* Decorative: the Stepper below and the line above carry the semantics. */}
      <div
        aria-hidden="true"
        className="mt-2 h-1.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
      >
        <div
          className={cn(
            'h-full rounded-pill transition-[width] duration-500 ease-emphasized',
            'motion-reduce:transition-none',
            PROGRESS_FILL,
          )}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
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
   * (rather than a row of disabled buttons), so the steps become what they
   * should be at that point: a picture of a finished journey.
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

  const progressPercent = Math.round(((stepIndex + 1) / STEPS.length) * 100);
  const StepIcon = STEP_ICONS[step.id] || ScanLine;

  return (
    <div className="flex min-h-screen bg-canvas text-default">
      {/* ------------------------------------------------------ desktop rail --
          Owns the left edge at lg+: brand, pitch, the whole journey. */}
      <aside
        aria-label="Consultation progress"
        className="sticky top-0 hidden h-screen w-80 shrink-0 flex-col border-r border-subtle bg-surface lg:flex"
      >
        <div className="flex h-16 items-center border-b border-subtle px-5">
          <Link
            to={PATHS.HOME}
            className={cn(
              'flex items-center gap-2.5 rounded-field px-1 py-1 outline-none',
              'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-surface',
            )}
          >
            {/* The brand chip states its own ink. `text-white` on the span AND on
                the glyph, so no ancestor's text colour can bleed into it. */}
            <span
              aria-hidden="true"
              className="inline-flex h-9 w-9 items-center justify-center rounded-field bg-gradient-to-br from-navy-500 to-aqua-500 text-white shadow-soft"
            >
              <ScanLine className="h-4 w-4 text-white" />
            </span>
            <span className="font-heading text-heading-sm text-default">
              AI <span className="text-accent-700 dark:text-accent-400">Dermatologist</span>
            </span>
          </Link>
        </div>

        <div className="ui-scrollbar flex-1 overflow-y-auto px-5 py-6">
          <p className="text-overline uppercase text-accent-700 dark:text-accent-400">AI skin check</p>
          {/* A <p>, not a heading: the rail renders BEFORE the <h1> in the DOM,
              so an <h2> here would put the document outline out of order. */}
          <p className="mt-1.5 font-heading text-heading-md text-default">
            From a photo to a plan
          </p>
          <p className="mt-1.5 text-body-sm text-muted">
            A photo, a result, and real doctors if it needs eyes on it. About three minutes.
          </p>

          <RailMeter stepIndex={stepIndex} total={STEPS.length} percent={progressPercent} />

          <Stepper
            steps={headerSteps}
            current={stepIndex}
            furthest={furthest}
            onStepChange={onHeaderStepChange}
            orientation="vertical"
            aria-label="Steps"
            className="mt-7"
          />
        </div>

        {/* The rail owns the PRIVACY half of the reassurance. The "triage aid,
            not a diagnosis" half lives in the trust footer, so the two are not
            saying the same sentence to the same person on the same screen. */}
        <div className="border-t border-subtle px-5 py-4">
          <p className="flex items-start gap-2 text-caption text-subtle">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-700 dark:text-accent-400" aria-hidden="true" />
            Your photo stays private. Only the doctors you pick can open it, and
            you decide who those are.
          </p>
        </div>
      </aside>

      {/* ------------------------------------------------------ main column -- */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-sticky border-b border-subtle bg-surface/95 backdrop-blur">
          <div className="flex h-14 items-center gap-2 px-4 sm:px-6">
            <Button
              as={Link}
              to={PATHS.HOME}
              variant="ghost"
              size="sm"
              leftIcon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />}
              className="lg:hidden"
            >
              <span className="hidden sm:inline">Home</span>
              <span className="sm:hidden ui-sr-only">Home</span>
            </Button>

            <div className="min-w-0 flex-1">
              <h1 className="truncate font-heading text-heading-sm text-default">
                AI skin check
              </h1>
              <p className="truncate text-caption text-subtle lg:hidden">
                Step {stepIndex + 1} of {STEPS.length}: {step.title}
                {step.optional ? ' (optional)' : ''}
              </p>
            </div>

            {showStartOver && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmReset(true)}
                leftIcon={<RotateCcw aria-hidden="true" className="h-4 w-4" />}
                className="text-danger-700 hover:bg-danger-50 hover:text-danger-700 xl:hidden"
              >
                <span className="hidden sm:inline">Start over</span>
                <span className="sm:hidden ui-sr-only">Start over</span>
              </Button>
            )}
          </div>

          {/* Journey progress, phones and tablets (the rail shows it at lg+).
              Same fill as the rail meter, so the two are one system. */}
          <div aria-hidden="true" className="h-1 w-full bg-surface-sunken lg:hidden">
            <div
              className={cn(
                'h-full transition-[width] duration-500 ease-emphasized motion-reduce:transition-none',
                PROGRESS_FILL,
              )}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </header>

        <main className="flex-1">
          <div className="mx-auto w-full max-w-6xl px-4 pb-8 pt-6 sm:px-6 lg:px-8 lg:pb-12 lg:pt-10 xl:max-w-none">
            {/* Compact horizontal stepper for tablets, where the rail is hidden
                but there is room for eight labelled markers. */}
            <div className="mb-6 hidden sm:block lg:hidden">
              <Stepper
                steps={headerSteps.map((entry) => ({
                  id: entry.id,
                  label: entry.label,
                  optional: entry.optional,
                  canEnter: entry.canEnter,
                }))}
                current={stepIndex}
                furthest={furthest}
                onStepChange={onHeaderStepChange}
                aria-label="Consultation progress"
              />
            </div>

            {state.image.restored && !state.image.file && (
              <Alert tone="info" className="mb-4" title="We kept your draft">
                Your answers and choices survived, but the browser cannot keep the photo file itself
                across a reload. Pick the photo again to carry on.
              </Alert>
            )}

            {/* THE one live region for "why Next is refusing". The footer bar
                and the xl actions column each render a visible, aria-hidden
                copy of this hint and point their Next button at this id, so a
                screen reader hears the message exactly once no matter which
                layout is active. */}
            <p id="consult-next-hint" aria-live="polite" className="ui-sr-only">
              {showNextButton && nextHint ? nextHint : ''}
            </p>

            {/* At xl+ the page becomes a true 3-column workspace: brand rail,
                the step card filling the middle, and a sticky actions column
                on the right. Below xl this wrapper is inert and the sticky
                footer bar owns navigation, exactly as before. */}
            <div className="xl:flex xl:items-start xl:gap-6">
              <div className="min-w-0 xl:flex-1">
                <Card padding="none" className="overflow-hidden">
                  <div
                    aria-hidden="true"
                    className="h-1 w-full bg-gradient-to-r from-navy-500 via-aqua-400 to-aqua-500"
                  />
                  <div className="p-5 sm:p-8 lg:p-10">
                    {/* Keyed on the step id so a step change replays the entrance
                        transition. The key only changes when the step does, so an
                        unrelated re-render never restarts it, and motion-reduce
                        drops the animation entirely rather than shortening it. */}
                    <div
                      key={step.id}
                      ref={panelRef}
                      tabIndex={-1}
                      role="group"
                      aria-labelledby="consult-step-title"
                      className="outline-none animate-ui-slide-up motion-reduce:animate-none"
                    >
                      <div className="flex items-start gap-4">
                        <span
                          aria-hidden="true"
                          className={cn(
                            'grid h-12 w-12 shrink-0 place-items-center rounded-card',
                            'bg-gradient-to-br from-primary-50 to-accent-50 text-primary-700',
                            'ring-1 ring-inset ring-primary-100',
                          )}
                        >
                          <StepIcon className="h-5 w-5" />
                        </span>
                        <div className="min-w-0 pt-0.5">
                          <h2
                            id="consult-step-title"
                            className="font-heading text-heading-lg text-default sm:text-display-sm"
                          >
                            {step.title}
                            {step.optional && <span className={OPTIONAL_CHIP}>optional</span>}
                          </h2>
                          <p className="mt-1.5 max-w-2xl text-body-md text-muted">
                            {step.description}
                          </p>
                        </div>
                      </div>

                      {/* A hairline between the header and the work, so the card
                          reads as "title, then form" rather than one long block. */}
                      <div
                        aria-hidden="true"
                        className="my-6 h-px w-full bg-gradient-to-r from-neutral-300 via-neutral-200 to-transparent"
                      />

                      {needsAccount ? (
                        <AccountGate step={step} onSignIn={() => setAuthOpen(true)} />
                      ) : stepElement || <StepPlaceholder step={step} />}
                    </div>
                  </div>
                </Card>

                {/* ----------------------------------------------------- nav --
                    Sticky on phones so Back/Next stay in thumb reach while a
                    long step scrolls; inline on larger screens; hidden at xl+
                    where the actions column takes over. */}
                {showFooterNav && (
                  <nav
                    aria-label="Step navigation"
                    className={cn(
                      'sticky bottom-0 z-sticky -mx-4 mt-5 flex flex-col-reverse gap-3 border-t border-subtle',
                      'bg-surface/95 px-4 py-3 backdrop-blur',
                      'sm:static sm:z-auto sm:mx-0 sm:flex-row sm:items-center sm:justify-between',
                      'sm:border-0 sm:bg-transparent sm:p-0 sm:backdrop-blur-0',
                      'xl:hidden',
                    )}
                  >
                    {stepIndex > 0 ? (
                      <Button
                        variant="outline"
                        onClick={back}
                        leftIcon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />}
                        fullWidth
                        className="sm:w-auto"
                      >
                        Back
                      </Button>
                    ) : (
                      <span aria-hidden="true" className="hidden sm:block" />
                    )}

                    <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                      {showNextButton && nextHint && (
                        <p
                          aria-hidden="true"
                          className="order-2 text-center text-caption text-subtle sm:order-1 sm:text-right"
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
                            variant="gradient"
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

                {/* ------------------------------------------- trust footer --
                    Closes the page the way a clinic closes a leaflet: what this
                    is, what it is not, and where to go if it is an emergency.
                    Shown at every breakpoint, because the reassurance is not
                    less true on a large screen. */}
                <footer className="mt-8 border-t border-default pt-5">
                  <ul className="grid gap-3 sm:grid-cols-2">
                    <li className="flex items-start gap-2.5 text-caption text-subtle">
                      <ShieldCheck
                        aria-hidden="true"
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-700 dark:text-accent-400"
                      />
                      <span>
                        Analysing sends the photo to our server so the model can read it. It reaches
                        a doctor only when you choose one, two steps from now.
                      </span>
                    </li>
                    <li className="flex items-start gap-2.5 text-caption text-subtle">
                      <AlertTriangle
                        aria-hidden="true"
                        className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-700"
                      />
                      <span>
                        This tool is a triage aid, not a diagnosis. If something is bleeding heavily,
                        spreading fast or you feel unwell, contact emergency care now.
                      </span>
                    </li>
                  </ul>
                  <p className="mt-4 text-caption text-subtle">
                    <Link
                      to={PATHS.PRIVACY}
                      className={cn(
                        'rounded-field underline decoration-dotted underline-offset-4 outline-none',
                        'hover:text-default focus-visible:ring-2 focus-visible:ring-focus',
                        'focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
                      )}
                    >
                      How we handle your photo
                    </Link>
                  </p>
                </footer>
              </div>

              {/* --------------------------------------- xl actions column --
                  The same handlers and disabled logic as the footer bar,
                  promoted to sticky cards so wide screens stop wasting the
                  right edge. Exactly one of the two navs is visible at any
                  breakpoint. Hidden once the flow is terminal, matching the
                  footer bar. */}
              {showFooterNav && (
                <aside className="hidden w-80 shrink-0 flex-col gap-4 self-start xl:sticky xl:top-20 xl:flex">
                  <Card
                    as="nav"
                    aria-label="Step actions"
                    padding="md"
                    className="flex flex-col gap-3"
                  >
                    {showNextButton && (
                      nextNeedsAccount ? (
                        <Button
                          onClick={() => setAuthOpen(true)}
                          leftIcon={<ShieldCheck aria-hidden="true" className="h-4 w-4" />}
                          rightIcon={<ArrowRight aria-hidden="true" className="h-4 w-4" />}
                          fullWidth
                        >
                          Sign in to continue
                        </Button>
                      ) : (
                        <Button
                          variant="gradient"
                          onClick={handleNext}
                          disabled={!canNext}
                          aria-describedby={nextHint ? 'consult-next-hint' : undefined}
                          rightIcon={<ArrowRight aria-hidden="true" className="h-4 w-4" />}
                          fullWidth
                        >
                          {step.optional ? `Continue to ${nextStep.title}` : `Next: ${nextStep.title}`}
                        </Button>
                      )
                    )}

                    {stepIndex > 0 && (
                      <Button
                        variant="outline"
                        onClick={back}
                        leftIcon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />}
                        fullWidth
                      >
                        Back
                      </Button>
                    )}

                    {showStartOver && (
                      <Button
                        variant="ghost"
                        onClick={() => setConfirmReset(true)}
                        leftIcon={<RotateCcw aria-hidden="true" className="h-4 w-4" />}
                        className="text-danger-700 hover:bg-danger-50 hover:text-danger-700"
                        fullWidth
                      >
                        Start over
                      </Button>
                    )}
                  </Card>

                  <Card padding="md">
                    <p className="text-overline uppercase text-accent-700 dark:text-accent-400">
                      Step {stepIndex + 1} of {STEPS.length}
                    </p>
                    <p className="mt-1.5 font-heading text-heading-sm text-default">
                      {step.title}
                      {step.optional && <span className={OPTIONAL_CHIP}>optional</span>}
                    </p>

                    {/* The same fill again, at card scale. */}
                    <div
                      aria-hidden="true"
                      className="mt-3 h-1.5 w-full overflow-hidden rounded-pill bg-surface-sunken"
                    >
                      <div
                        className={cn(
                          'h-full rounded-pill transition-[width] duration-500 ease-emphasized',
                          'motion-reduce:transition-none',
                          PROGRESS_FILL,
                        )}
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>

                    {showNextButton && nextHint && (
                      <p aria-hidden="true" className="mt-3 text-caption text-subtle">
                        {nextHint}
                      </p>
                    )}
                    {nextStep && (
                      <p className="mt-3 border-t border-subtle pt-3 text-caption text-muted">
                        Up next: <span className="font-medium text-default">{nextStep.title}</span>
                      </p>
                    )}
                  </Card>
                </aside>
              )}
            </div>
          </div>
        </main>
      </div>

      <InlineAuthDialog
        open={authOpen}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={handleAuthenticated}
        reason={
          'Your scan is saved and will be added to your history the moment you sign in. The '
          + 'photo, the result and your answers are all kept, and you carry straight on from here.'
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
