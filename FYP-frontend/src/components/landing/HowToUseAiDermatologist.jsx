import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Camera, FileCheck2, ScanSearch } from 'lucide-react';
import { Button } from '../ui';
import { PATHS } from '../../routes';

// Self-contained scroll-reveal hook, no extra dependencies required
const useReveal = (threshold = 0.2) => {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, visible];
};

/* Tonal icon chips rotate through theme-aware scale pairs; every scale flips
   automatically in dark mode, so no dark: overrides are needed here. */
const STEPS = [
  {
    id: '01',
    title: 'Take a photo',
    description:
      'Get close, under 10 cm, keep the skin mark in focus, and center it in the frame without hair, wrinkles, or other objects.',
    Icon: Camera,
    chip: 'bg-primary-100 text-primary-700',
  },
  {
    id: '02',
    title: 'Identify and send',
    description:
      'Send your photo to the Artificial Intelligence. The system analyzes it and sends you a risk assessment.',
    Icon: ScanSearch,
    chip: 'bg-info-100 text-info-700',
  },
  {
    id: '03',
    title: 'Receive your risk assessment',
    description:
      'Get the result within 60 seconds, covering 9 conditions plus a healthy-skin baseline, with advice on the next steps to take.',
    Icon: FileCheck2,
    chip: 'bg-accent-100 text-accent-700',
  },
];

const HowToUseAiDermatologist = () => {
  const [gridRef, gridVisible] = useReveal(0.15);
  const [ctaRef, ctaVisible] = useReveal(0.4);

  return (
    <section
      aria-labelledby="how-to-use-heading"
      className="bg-canvas py-20 sm:py-28"
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="mx-auto mb-14 max-w-3xl text-center sm:mb-16">
          <p className="text-overline uppercase tracking-widest text-accent-700 dark:text-accent-400">
            How it works
          </p>
          <h2
            id="how-to-use-heading"
            className="mt-3 font-heading text-display-lg text-default sm:text-display-xl"
          >
            How to use AI Dermatologist
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-body-lg text-muted">
            Three simple steps take you from a photo to a risk assessment in about a
            minute.
          </p>
        </div>

        {/* Connected steps */}
        <div ref={gridRef} className="relative">
          {/* Connector line through the step number circles (md+) */}
          <div
            aria-hidden="true"
            className="absolute left-[16.67%] right-[16.67%] top-6 hidden h-0.5 rounded-pill bg-gradient-to-r from-primary-600 to-accent-700 opacity-25 dark:from-primary-400 dark:to-accent-300 md:block"
          />

          <ol className="grid auto-rows-fr grid-cols-1 gap-10 md:grid-cols-3 md:gap-6 lg:gap-8">
            {STEPS.map((step, index) => (
              <li
                key={step.id}
                style={{ animationDelay: `${index * 140}ms` }}
                className={`${gridVisible ? 'animate-ui-slide-up motion-reduce:animate-none' : 'opacity-0'} flex h-full flex-col items-center`}
              >
                {/* Numbered gradient circle, matching the Stepper's complete state */}
                <span
                  aria-hidden="true"
                  className="relative z-10 flex h-12 w-12 shrink-0 items-center justify-center rounded-pill bg-gradient-to-br from-primary-600 to-accent-700 font-heading text-heading-md text-white shadow-soft dark:from-primary-400 dark:to-accent-300"
                >
                  {index + 1}
                </span>

                {/* Step card */}
                <div className="mt-4 flex w-full flex-1 flex-col items-center rounded-card border border-subtle bg-surface p-6 text-center shadow-card transition duration-300 hover:-translate-y-0.5 hover:shadow-card-hover sm:p-8">
                  <span
                    aria-hidden="true"
                    className={`flex h-11 w-11 items-center justify-center rounded-field ${step.chip}`}
                  >
                    <step.Icon className="h-6 w-6" strokeWidth={1.75} />
                  </span>
                  <h3 className="mt-4 font-heading text-heading-md text-default">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-body-sm text-muted">{step.description}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        {/* Call to action */}
        <div
          ref={ctaRef}
          className={`${ctaVisible ? 'animate-ui-slide-up motion-reduce:animate-none' : 'opacity-0'} mx-auto mt-12 flex max-w-2xl flex-col items-center gap-6 text-center sm:mt-16`}
        >
          <Button
            as={Link}
            to={PATHS.CONSULT}
            variant="gradient"
            size="lg"
            rightIcon={<ArrowRight className="h-5 w-5" />}
          >
            Try it now
          </Button>
          <p className="text-caption text-subtle">
            You can take a photo on your mobile phone or upload one from your computer.
            View your results online or send them to your email address.
          </p>
        </div>
      </div>
    </section>
  );
};

export default HowToUseAiDermatologist;
