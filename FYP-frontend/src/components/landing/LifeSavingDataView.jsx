import React, { useEffect, useRef, useState } from 'react';

// Self-contained scroll-reveal hook
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

// Counts up to `target` once `trigger` becomes true; respects prefers-reduced-motion
const useCountUp = (target, trigger, duration = 1400) => {
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!trigger) return;
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let start = null;
    let raf;
    const step = (timestamp) => {
      if (start === null) start = timestamp;
      const progress = Math.min((timestamp - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(eased * target));
      if (progress < 1) raf = requestAnimationFrame(step);
    };
    // Reduced motion: jump straight to the final value in a single frame.
    raf = requestAnimationFrame(reduceMotion ? () => setValue(target) : step);
    return () => cancelAnimationFrame(raf);
  }, [trigger, target, duration]);
  return value;
};

/*
 * Extracted so useCountUp runs at this component's own top level (hooks cannot
 * be called inside .map() callbacks; each card needs its own instance).
 *
 * The reveal animation lives on the outer wrapper and the hover transform on
 * the inner card: `animate-ui-slide-up` fills `both`, so a transform utility on
 * the SAME element would be overridden by the finished animation.
 */
const StatCard = ({ stat, index, sectionVisible }) => {
  const count = useCountUp(stat.value, sectionVisible, 1200 + index * 150);
  return (
    <div
      style={{ animationDelay: `${index * 120}ms` }}
      className={`${sectionVisible ? 'animate-ui-slide-up motion-reduce:animate-none' : 'opacity-0'} h-full`}
    >
      <div className="flex h-full flex-col rounded-card border border-subtle bg-surface p-6 shadow-card transition duration-300 hover:-translate-y-0.5 hover:shadow-card-hover sm:p-8">
        <span className="text-overline uppercase tracking-widest text-subtle">
          {stat.label}
        </span>

        {/* Big animated number: navy by default, teal for the highlight stat */}
        <p
          className={`mt-5 font-heading text-5xl font-bold leading-none tracking-tight ${
            stat.highlight ? 'text-accent-700 dark:text-accent-400' : 'text-primary-700'
          }`}
        >
          {count}
          <span className="text-accent-700 dark:text-accent-400">{stat.suffix}</span>
        </p>

        <h3 className="mb-6 mt-3 text-heading-sm text-default">{stat.headline}</h3>

        <p className="mt-auto border-t border-subtle pt-4 text-body-sm text-muted">
          {stat.details}
        </p>
      </div>
    </div>
  );
};

const LifeSavingDataView = () => {
  const cancerStats = [
    {
      id: 1,
      label: 'Global impact',
      value: 2,
      suffix: '+',
      headline: 'people die of skin cancer every hour, worldwide',
      details: 'Skin cancer is the most common cancer in the US and globally.',
    },
    {
      id: 2,
      label: 'Rapid spread',
      value: 2,
      suffix: 'nd',
      headline: 'most common cancer in people aged 15 to 29',
      details: 'Melanoma can spread earlier and more quickly. Age offers no protection.',
    },
    {
      id: 3,
      label: 'Lifetime risk',
      value: 2,
      suffix: '%',
      headline: 'lifetime risk: about 1 in 50 people develop skin cancer',
      details: 'Early detection is key to survival.',
    },
    {
      id: 4,
      label: 'The ultimate fact',
      value: 99,
      suffix: '%',
      headline: '5-year survival rate with early detection',
      details: 'Your life is worth identifying skin cancer early.',
      highlight: true,
    },
  ];

  const [sectionRef, sectionVisible] = useReveal(0.2);

  return (
    /* Theme-adaptive band: flipping tokens keep it light on light mode and
       deep on dark mode automatically. */
    <section
      ref={sectionRef}
      aria-labelledby="life-saving-heading"
      className="relative overflow-hidden bg-canvas py-20 sm:py-28"
    >
      {/* Ambient glows */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-primary-400/15 blur-3xl" />
        <div className="absolute -bottom-40 -right-24 h-[28rem] w-[28rem] rounded-full bg-accent-400/15 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="mx-auto mb-14 max-w-3xl text-center sm:mb-16">
          <p className="text-overline uppercase tracking-widest text-accent-700 dark:text-accent-400">
            Why early detection matters
          </p>
          <h2
            id="life-saving-heading"
            className="mt-3 font-heading text-display-lg text-default sm:text-display-xl"
          >
            AI Dermatologist can save your life
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-body-lg text-muted">
            One of the most dangerous diseases that AI Dermatologist can help identify is
            skin cancer. Skin cancer is the most common cancer in the United States and
            worldwide.
          </p>
        </div>

        {/* Equal-height stat grid */}
        <div className="grid auto-rows-fr grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5 xl:grid-cols-4">
          {cancerStats.map((stat, index) => (
            <StatCard key={stat.id} stat={stat} index={index} sectionVisible={sectionVisible} />
          ))}
        </div>
      </div>
    </section>
  );
};

export default LifeSavingDataView;
