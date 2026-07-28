/**
 * AuthShell — the frame every state of the auth machine renders inside.
 *
 * There is exactly one of these because the four cross-cutting affordances the
 * brief demands (a back affordance, a server-error banner, a loading state and
 * inline field errors) must look and behave identically on all nine screens.
 * A step component only supplies its title, its fields and its submit button.
 *
 * LAYOUT
 * A split screen at `lg` and up: the left half is the brand panel (product
 * pitch, trust markers) and the right half carries the step form. Below `lg`
 * the brand panel collapses to a compact header so the form is the first
 * thing a phone shows. Every step renders through this one frame, so the
 * machine, the tests and the steps never notice the layout.
 *
 * The brand panel is theme-adaptive: every class on it is a flipping token
 * (surface, primary, accent, info), so it reads as a soft light wash in light
 * mode and re-ramps to a deep tint in dark mode. Only the logo chip and the
 * card hairline still use the FIXED `navy`/`aqua` ramps, whose mid steps read
 * on both themes.
 *
 * THE WORDMARK CARRIES ITS OWN COLOUR. See `WORDMARK_TONES` below: half of this
 * mark used to be coloured by inheritance, which is the mechanism by which a
 * logo disappears in one theme and only one theme.
 */

import React from 'react';
import {
  ArrowLeft,
  CalendarCheck,
  Lock,
  ScanLine,
  ShieldCheck,
  Sparkles,
  Stethoscope,
} from 'lucide-react';
import { Link } from 'react-router-dom';

import { Alert, Button, Card, cn, focusRing } from '../../../components/ui';

const FEATURES = [
  {
    icon: ScanLine,
    tint: 'bg-primary-100 text-primary-700',
    title: 'AI skin analysis in seconds',
    text: 'Upload a photo and get an instant, private assessment.',
  },
  {
    icon: Stethoscope,
    tint: 'bg-accent-100 text-accent-700',
    title: 'Real dermatologists',
    text: 'Send your scan to verified doctors and hear back with a plan.',
  },
  {
    icon: CalendarCheck,
    tint: 'bg-info-100 text-info-700',
    title: 'Book on your terms',
    text: 'Offer the times that suit you and let doctors confirm one.',
  },
];

/**
 * The wordmark colours, per surface. BOTH words are listed for each tone, and
 * that is the point.
 *
 * The bug this replaces: the outer wordmark span carried no text-colour class at
 * all, so the word "AI" was whatever an ancestor happened to be setting, while
 * only the word "Dermatologist" was pinned. A mark that takes half its colour by
 * inheritance survives exactly as long as nobody edits an ancestor, and the
 * moment it is placed on a surface whose inherited colour is light, the first word
 * silently disappears. `tone` was worse: `onDark` pointed the second word at
 * `text-aqua-300` (rgb(115 226 212), a FIXED non-flipping scale, 1.7:1 on the
 * light auth panel) while leaving the first word to inheritance, so the first
 * caller to pass it would have lost the wordmark in LIGHT mode.
 *
 * `word` is the default text and `accent` is the teal half; on light surfaces
 * that is the sanctioned `accent-700 / dark:accent-400` pair, the only AA teal
 * text recipe in the system. `onDark` is for a permanently dark fill (a navy
 * band), so it uses the FIXED aqua ramp that does not re-ramp underneath it.
 */
const WORDMARK_TONES = Object.freeze({
  onLight: Object.freeze({ word: 'text-default', accent: 'text-accent-700 dark:text-accent-400' }),
  onDark: Object.freeze({ word: 'text-white', accent: 'text-aqua-300' }),
});

/**
 * @param {object} props
 * @param {'onDark'|'onLight'} [props.tone='onLight'] Where the mark sits: light
 *   surfaces (the panel wash, the canvas, `bg-surface`, `bg-surface-sunken`) want
 *   the AA teal word-mark; a permanently dark fill wants the aqua one.
 * @param {boolean} [props.compact=false]
 */
function BrandMark({ tone = 'onLight', compact = false }) {
  const colours = WORDMARK_TONES[tone] ?? WORDMARK_TONES.onLight;
  return (
    <span className="inline-flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-field text-white shadow-soft',
          // FIXED navy/aqua, so the chip and its white glyph read identically in
          // both themes and cannot be re-ramped out from under the mark.
          'bg-gradient-to-br from-navy-500 to-aqua-500 ring-1 ring-inset ring-white/20',
          compact ? 'h-9 w-9' : 'h-10 w-10',
        )}
      >
        <Sparkles aria-hidden="true" className={compact ? 'h-4 w-4' : 'h-5 w-5'} />
      </span>
      <span
        className={cn(
          'whitespace-nowrap font-heading',
          colours.word,
          compact ? 'text-heading-md' : 'text-heading-lg',
        )}
      >
        AI <span className={colours.accent}>Dermatologist</span>
      </span>
    </span>
  );
}

/** The lg+ brand half. Decorative content only: nothing here is interactive
 *  except the home link, so keyboard users reach the form in one Tab. */
function BrandPanel() {
  return (
    // `border-default`: the panel's fill IS `surface-sunken`, and in light mode
    // `--color-line-subtle` is the same rgb, so the seam between the brand half
    // and the form half was invisible there.
    <div className="relative hidden overflow-hidden border-r border-default bg-surface-sunken lg:flex lg:flex-col">
      {/* soft wash + decorative glows, all flipping tokens */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary-100/70 via-transparent to-accent-100/60"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-28 top-10 h-96 w-96 rounded-pill bg-primary-400/15 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-24 bottom-0 h-96 w-96 rounded-pill bg-accent-400/15 blur-3xl"
      />

      <div className="relative flex flex-1 flex-col justify-between p-10 xl:p-14">
        <Link to="/" className={cn('w-fit rounded-field', focusRing)}>
          <BrandMark />
        </Link>

        <div className="my-10 max-w-md">
          <h2 className="font-heading text-display-md text-default xl:text-display-lg">
            Skin answers,
            {/* GRADIENT TEXT, so both stops are read as text and both have to clear
                contrast. `accent-600` was rgb(24 160 133) on this light wash, i.e.
                2.98:1, a hair under the 3:1 a display heading needs. `accent-700`
                is 5.0:1 on light and re-ramps to rgb(168 240 230) on dark, where it
                is higher still, so one pair of classes serves both themes. */}
            <span className="block bg-gradient-to-r from-primary-600 to-accent-700 bg-clip-text text-transparent">
              without the waiting room.
            </span>
          </h2>
          <p className="mt-4 text-body-md leading-relaxed text-muted">
            One account for everything: your scans, your reports, your doctors
            and your appointments.
          </p>

          <ul className="mt-8 flex flex-col gap-5">
            {FEATURES.map((feature) => {
              const Icon = feature.icon;
              return (
                <li key={feature.title} className="flex items-start gap-3.5">
                  <span
                    className={cn(
                      'mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-field',
                      feature.tint,
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span>
                    <span className="block text-label-lg text-default">{feature.title}</span>
                    <span className="mt-0.5 block text-body-sm text-muted">{feature.text}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-caption text-subtle">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-accent-700 dark:text-accent-400" aria-hidden="true" />
            Verified doctors only
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Lock className="h-4 w-4 text-accent-700 dark:text-accent-400" aria-hidden="true" />
            Your photos stay private
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * @param {object} props
 * @param {string} props.title
 * @param {React.ReactNode} [props.subtitle]
 * @param {'md'|'lg'} [props.width='md'] `lg` for the signup form.
 * @param {() => void} [props.onBack] Renders the Back button when present.
 * @param {string} [props.backLabel='Back']
 * @param {React.ReactNode} [props.beforeForm] Slot above the fields (e.g. the email chip).
 * @param {?string} [props.error] Server-error banner copy.
 * @param {?string} [props.notice] Non-error banner copy.
 * @param {() => void} [props.onDismissError]
 * @param {React.ReactNode} [props.footer] Below the card.
 * @param {React.ReactNode} props.children
 */
export default function AuthShell({
  title,
  subtitle,
  width = 'md',
  onBack,
  backLabel = 'Back',
  beforeForm,
  error,
  notice,
  onDismissError,
  footer,
  children,
}) {
  return (
    <div className="grid min-h-screen w-full bg-canvas text-default lg:grid-cols-2">
      <BrandPanel />

      {/* ----------------------------------------------------- form column -- */}
      <div className="flex flex-col">
        {/* Compact brand header, phones and tablets only. */}
        <div className="flex justify-center px-4 pt-8 lg:hidden">
          <Link to="/" className={cn('rounded-field px-2 py-1', focusRing)}>
            <BrandMark tone="onLight" compact />
          </Link>
        </div>

        <div className="flex flex-1 items-center justify-center px-4 py-8 sm:px-6 lg:py-12">
          <div className={cn('w-full', width === 'lg' ? 'max-w-2xl' : 'max-w-md')}>
            <Card variant="elevated" padding="none" className="overflow-hidden">
              {/* Gradient hairline: the card's one decoration. */}
              <div
                aria-hidden="true"
                className="h-1 w-full bg-gradient-to-r from-navy-500 via-aqua-400 to-aqua-500"
              />
              <div className="p-6 sm:p-8">
                {onBack && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={onBack}
                    leftIcon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />}
                    className="-ml-2 mb-4"
                  >
                    {backLabel}
                  </Button>
                )}

                <header className="mb-6">
                  <h1 className="font-heading text-display-sm text-default">{title}</h1>
                  {subtitle && (
                    <p className="mt-2 text-body-sm text-muted">{subtitle}</p>
                  )}
                </header>

                {/* Banners live ABOVE the fields so a screen reader meets the
                    failure before the control it is about. */}
                {error && (
                  <Alert tone="danger" className="mb-5" onDismiss={onDismissError}>
                    {error}
                  </Alert>
                )}
                {!error && notice && (
                  <Alert tone="info" className="mb-5" onDismiss={onDismissError}>
                    {notice}
                  </Alert>
                )}

                {beforeForm}

                {children}
              </div>
            </Card>

            {footer && <div className="mt-6 text-center text-body-sm text-muted">{footer}</div>}

            <p className="mt-6 flex items-center justify-center gap-1.5 text-caption text-subtle lg:hidden">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Verified doctors. Private photos. One account.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export { AuthShell };
