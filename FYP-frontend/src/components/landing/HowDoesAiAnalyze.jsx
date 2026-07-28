import React from 'react';
import { ScanLine, Activity } from 'lucide-react';

/**
 * Landing section: how the AI analyzes skin images.
 * Two columns: numbered explanation steps on the left, a decorative
 * "analysis" panel on the right (theme-adaptive tokens, CSS only). All
 * styling is token based so it reads correctly in light and dark mode.
 */
const STEPS = [
  {
    title: 'Trained on confirmed cases',
    description:
      'AI Dermatologist uses a deep machine learning algorithm. The human ability to learn from examples has been transferred to a computer: the neural network was trained on a dermoscopic imaging database with tens of thousands of cases, each confirmed and assessed by dermatologists.',
  },
  {
    title: 'Reads thousands of features',
    description:
      'Like the ABCDE rule, the AI weighs asymmetry, boundary, color, diameter, and change over time to tell benign from malignant formations. The difference: the algorithm can analyze thousands of features in one image, not only five.',
  },
  {
    title: 'Improves with doctor feedback',
    description:
      'Productive cooperation with doctors keeps raising the quality of the algorithm. With growing experience it distinguishes benign from malignant tumors, finds risks of human papillomavirus, and classifies different types of acne.',
  },
];

const ABCDE_CHIPS = ['Asymmetry', 'Boundary', 'Color', 'Diameter', 'Evolution'];

const HowDoesAiAnalyze = () => {
  return (
    <section className="bg-surface py-20 sm:py-28" aria-labelledby="how-ai-analyzes-heading">
      <style>
        {`
          @keyframes hdaa-scan {
            0% { top: 8%; }
            100% { top: 88%; }
          }
          .hdaa-scanline {
            animation: hdaa-scan 3s ease-in-out infinite alternate;
          }
          @media (prefers-reduced-motion: reduce) {
            .hdaa-scanline { animation: none; top: 50%; }
          }
        `}
      </style>

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
          {/* LEFT: header + numbered explanation steps */}
          <div>
            <p className="text-overline uppercase tracking-widest text-accent-700 dark:text-accent-400">
              Under the hood
            </p>
            <h2
              id="how-ai-analyzes-heading"
              className="mt-3 font-heading text-display-md sm:text-display-lg text-default"
            >
              How does{' '}
              <span className="bg-gradient-to-r from-primary-600 to-accent-600 bg-clip-text text-transparent dark:from-primary-600 dark:to-accent-500">
                artificial intelligence
              </span>{' '}
              analyze images?
            </h2>
            <p className="mt-4 max-w-2xl text-body-lg text-muted">
              A neural network built with dermatologists, refined case by case.
            </p>

            <ol className="mt-10 space-y-8">
              {STEPS.map((step, index) => (
                <li key={step.title} className="relative flex gap-4 sm:gap-5">
                  {index < STEPS.length - 1 && (
                    <span
                      aria-hidden="true"
                      className="absolute left-[1.125rem] top-11 -bottom-8 w-px -translate-x-1/2 bg-neutral-200"
                    />
                  )}
                  <span
                    aria-hidden="true"
                    className="relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-field bg-gradient-to-br from-primary-600 to-accent-600 text-label-md text-white shadow-soft"
                  >
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="text-heading-sm text-default">{step.title}</h3>
                    <p className="mt-1.5 text-body-md text-muted">{step.description}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          {/* RIGHT: decorative analysis panel. Flipping tokens keep it light on
              light mode and deep on dark mode; purely illustrative, hidden from AT. */}
          <div aria-hidden="true" className="relative mx-auto w-full max-w-lg lg:max-w-none">
            <div className="relative overflow-hidden rounded-4xl border border-subtle bg-surface-sunken p-6 shadow-elevated sm:p-10">
              {/* ambient glows */}
              <div className="pointer-events-none absolute -right-20 -top-24 h-64 w-64 rounded-full bg-accent-400/15 blur-3xl" />
              <div className="pointer-events-none absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-primary-400/15 blur-3xl" />
              {/* faint grid texture */}
              <div
                className="pointer-events-none absolute inset-0"
                style={{
                  backgroundImage:
                    'linear-gradient(to right, rgb(var(--color-text) / 0.04) 1px, transparent 1px), ' +
                    'linear-gradient(to bottom, rgb(var(--color-text) / 0.04) 1px, transparent 1px)',
                  backgroundSize: '24px 24px',
                }}
              />

              {/* scan card */}
              <div className="relative rounded-card border border-subtle bg-surface p-5 shadow-card">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-field bg-accent-100 text-accent-700">
                      <ScanLine size={16} />
                    </span>
                    <span className="text-label-md text-default">Lesion scan</span>
                  </div>
                  <span className="inline-flex items-center gap-1.5 rounded-pill bg-accent-100 px-2.5 py-1 text-overline uppercase tracking-widest text-accent-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
                    Analyzing
                  </span>
                </div>

                {/* scan area with crosshair + moving scan line */}
                <div className="relative mt-4 h-44 overflow-hidden rounded-field border border-subtle bg-canvas sm:h-52">
                  <div
                    className="absolute inset-0"
                    style={{
                      backgroundImage:
                        'radial-gradient(circle at 50% 45%, rgb(var(--color-accent-400) / 0.15) 0%, transparent 60%)',
                    }}
                  />
                  {/* crosshair target */}
                  <div className="absolute left-1/2 top-1/2 h-20 w-20 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent-400/60" />
                  <div className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-accent-400/60" />
                  <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-500" />
                  {/* moving scan line */}
                  <div className="hdaa-scanline absolute inset-x-3">
                    <div className="h-px bg-gradient-to-r from-transparent via-accent-400 to-transparent" />
                    <div className="mx-auto -mt-1 h-2 w-3/4 bg-accent-400/20 blur-md" />
                  </div>
                </div>

                {/* feature chips */}
                <div className="mt-4 flex flex-wrap gap-2">
                  {ABCDE_CHIPS.map((chip) => (
                    <span
                      key={chip}
                      className="rounded-pill border border-subtle bg-surface-sunken px-2.5 py-1 text-label-sm text-muted"
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </div>

              {/* overlapping result card */}
              <div className="relative -mt-5 ml-8 rounded-card border border-subtle bg-surface p-4 shadow-card sm:ml-14">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 items-center justify-center rounded-field bg-accent-100 text-accent-700">
                    <Activity size={16} />
                  </span>
                  <span className="text-label-md text-default">Feature analysis</span>
                </div>
                <div className="mt-3 h-1.5 overflow-hidden rounded-pill bg-surface-sunken">
                  <div className="h-full w-4/5 rounded-pill bg-gradient-to-r from-primary-600 to-accent-700 dark:from-primary-400 dark:to-accent-300" />
                </div>
                <p className="mt-2.5 text-caption text-muted">
                  Thousands of features weighed in under a minute.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HowDoesAiAnalyze;
