import React from 'react';
import { Target, BadgeCheck, Clock, Home, MessageCircle, CheckCircle2 } from 'lucide-react';

/**
 * Rolling proof-points band. Token-first restyle of the original marquee:
 * the mechanic (duplicated track + `animate-custom-marquee`) is unchanged,
 * but every surface, border, and text color now comes from the semantic
 * design system so the section reads correctly in light AND dark mode.
 */

// Tonal chip recipes rotate the six theme scales. All of these scales are
// CSS-variable backed and flip automatically in dark mode, so no `dark:`
// overrides are needed here.
const CHIP_TONES = [
  'bg-primary-100 text-primary-700',
  'bg-accent-100 text-accent-700',
  'bg-info-100 text-info-700',
  'bg-success-100 text-success-700',
  'bg-warning-100 text-warning-700',
  'bg-danger-100 text-danger-700',
];

const FeaturesMarquee = () => {
  // Copy matches the real 10-class model (9 conditions + healthy baseline).
  const features = [
    {
      id: 1,
      icon: Target,
      text: (
        <>
          <span className="font-semibold text-default">Screens for 9 skin conditions</span>, including
          melanoma and skin cancer
        </>
      ),
    },
    {
      id: 2,
      icon: BadgeCheck,
      text: (
        <>
          <span className="font-semibold text-default">Over 97% accuracy</span>, based on AI and a
          clinical database
        </>
      ),
    },
    {
      id: 3,
      icon: Clock,
      text: (
        <>
          <span className="font-semibold text-default">Results</span> within{' '}
          <span className="font-semibold text-default">1 minute</span>
        </>
      ),
    },
    {
      id: 4,
      icon: CheckCircle2,
      text: (
        <>
          <span className="font-semibold text-default">Confirms healthy skin too</span>, not just
          problems
        </>
      ),
    },
    {
      id: 5,
      icon: Home,
      text: (
        <>
          Enables <span className="font-semibold text-default">instant at-home screening</span>
        </>
      ),
    },
    {
      id: 6,
      icon: MessageCircle,
      text: (
        <>
          <span className="font-semibold text-default">24/7 personal AI consultant</span>
        </>
      ),
    },
  ];

  return (
    <section className="overflow-hidden bg-canvas py-20 sm:py-28">
      {/* Section header */}
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="text-overline uppercase tracking-widest text-accent-700 dark:text-accent-400">
            Why AI Dermatologist
          </p>
          <h2 className="mt-3 font-heading text-display-md text-default sm:text-display-lg">
            Built with dermatologists, powered by AI
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-body-lg text-muted">
            Clinical-grade screening you can run from your couch. Here is what the platform does for
            you.
          </p>
        </div>
      </div>

      {/* Marquee band */}
      <div className="group relative flex overflow-hidden py-2">
        {/* Edge fade masks: `from-canvas` flips with the theme token, so the
            fade matches the section background in both light and dark mode. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 z-raised w-16 bg-gradient-to-r from-canvas to-transparent sm:w-24"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 z-raised w-16 bg-gradient-to-l from-canvas to-transparent sm:w-24"
        />

        {/* Animated track: list rendered twice for a seamless loop. */}
        <div className="flex w-max animate-custom-marquee group-hover:[animation-play-state:paused] motion-reduce:animate-none">
          {[...Array(2)].map((_, copyIndex) => (
            <div
              key={copyIndex}
              aria-hidden={copyIndex === 1 ? 'true' : undefined}
              className="flex gap-4 px-2 sm:gap-6 sm:px-3"
            >
              {features.map((feature, index) => (
                <div
                  key={`${copyIndex}-${feature.id}`}
                  className="flex cursor-default items-center gap-3 whitespace-nowrap rounded-pill border border-subtle bg-surface px-5 py-3.5 shadow-soft transition duration-300 hover:-translate-y-0.5 hover:shadow-card-hover sm:px-6 sm:py-4"
                >
                  <span
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-pill ${CHIP_TONES[index % CHIP_TONES.length]}`}
                  >
                    <feature.icon size={15} strokeWidth={2.25} aria-hidden="true" />
                  </span>
                  <span className="text-body-sm text-muted sm:text-body-md">{feature.text}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default FeaturesMarquee;
