import React from 'react';
import { BrainCircuit, Timer, Smartphone, Wallet } from 'lucide-react';

/**
 * Landing section: the four core benefits of AI Dermatologist.
 * Token-only styling so the section reads correctly in light and dark mode.
 */
const BENEFITS = [
  {
    title: 'Smart',
    description:
      'Created through the joint work of IT specialists and doctors, our AI has the same accuracy as a professional dermatologist.',
    icon: BrainCircuit,
    chip: 'bg-primary-100 text-primary-700',
  },
  {
    title: 'Simple',
    description:
      'Place your phone near a mole or other formation on the skin, and within one minute you will find out if there is cause for concern.',
    icon: Timer,
    chip: 'bg-accent-100 text-accent-700',
  },
  {
    title: 'Accessible',
    description:
      'AI Dermatologist is available anytime, anywhere. Keep your health in check at your fingertips, even when you are on the go.',
    icon: Smartphone,
    chip: 'bg-info-100 text-info-700',
  },
  {
    title: 'Affordable',
    description:
      'Leading image analytics at a price fit for any request or budget. Flexible plans and customizable bundles save both time and money.',
    icon: Wallet,
    chip: 'bg-success-100 text-success-700',
  },
];

const WhyUseAiDermatologist = () => {
  return (
    <section className="bg-canvas py-20 sm:py-28" aria-labelledby="why-ai-derm-heading">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="max-w-2xl">
          <p className="text-overline uppercase tracking-widest text-accent-700 dark:text-accent-400">
            Why AI Dermatologist
          </p>
          <h2
            id="why-ai-derm-heading"
            className="mt-3 font-heading text-display-md sm:text-display-lg text-default"
          >
            Why is AI Dermatologist worth using?
          </h2>
          <p className="mt-4 text-body-lg text-muted">
            Skin checks that are smart, quick, and within reach whenever you want reassurance.
          </p>
        </div>

        {/* Benefit cards */}
        <div className="mt-12 grid auto-rows-fr gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-4">
          {BENEFITS.map((benefit) => {
            const Icon = benefit.icon;
            return (
              <article
                key={benefit.title}
                className="group h-full rounded-card border border-subtle bg-surface p-6 shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-card-hover"
              >
                <span
                  aria-hidden="true"
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-field ${benefit.chip}`}
                >
                  <Icon size={22} strokeWidth={1.75} />
                </span>
                <h3 className="mt-4 text-heading-md text-default">{benefit.title}</h3>
                <p className="mt-2 text-body-sm text-muted">{benefit.description}</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default WhyUseAiDermatologist;
