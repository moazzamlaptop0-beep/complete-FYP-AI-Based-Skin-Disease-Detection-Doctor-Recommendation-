import React, { useState, useEffect, useRef } from 'react';
import {
  Flame,
  ShieldAlert,
  Droplets,
  Sun,
  CircleDot,
  Layers,
  Waves,
  Fingerprint,
  Microscope,
  HeartPulse,
} from 'lucide-react';

/**
 * "What the AI detects" section, redesigned on the semantic token system so it
 * reads correctly in light AND dark mode: bg-surface section, header rhythm
 * pattern, then a 2/3/5 responsive grid of condition cards with tonal icon
 * chips rotating the six theme scales.
 */

// Lightweight scroll-reveal hook (no external deps)
const useInView = (threshold = 0.1) => {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.disconnect();
        }
      },
      { threshold }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [threshold]);
  return [ref, inView];
};

// Tonal chip recipes rotating the six theme scales. Every scale here is
// CSS-variable backed and flips automatically in dark mode, so no `dark:`
// overrides are required.
const CHIP_TONES = [
  'bg-primary-100 text-primary-700',
  'bg-accent-100 text-accent-700',
  'bg-info-100 text-info-700',
  'bg-success-100 text-success-700',
  'bg-warning-100 text-warning-700',
  'bg-danger-100 text-danger-700',
];

const ConditionAnalysis = () => {
  const [gridRef, gridInView] = useInView(0.08);

  // Matches the 10-class model exactly: 9 trained conditions + 1 healthy-skin class.
  const conditions = [
    { name: 'Eczema', note: 'Itchy, dry, inflamed patches', icon: Flame },
    { name: 'Melanoma', note: 'The most serious skin cancer', icon: ShieldAlert },
    { name: 'Atopic Dermatitis', note: 'Chronic eczema tied to allergies', icon: Droplets },
    { name: 'Basal Cell Carcinoma', note: 'The most common skin cancer', icon: Sun },
    { name: 'Melanocytic Nevi', note: 'Common moles, usually harmless', icon: CircleDot },
    { name: 'Benign Keratosis', note: 'Non-cancerous rough or scaly growths', icon: Layers },
    { name: 'Psoriasis and Lichen Planus', note: 'Autoimmune scaly patches and rashes', icon: Waves },
    { name: 'Seborrheic Keratoses', note: 'Harmless growths that appear with age', icon: Fingerprint },
    { name: 'Tinea and Fungal Infections', note: 'Ringworm and related fungal marks', icon: Microscope },
    { name: 'Normal, Healthy Skin', note: 'No visible signs of concern', icon: HeartPulse },
  ];

  return (
    <section className="bg-surface py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="max-w-2xl">
          <p className="text-overline uppercase tracking-widest text-accent-700 dark:text-accent-400">
            Instant analysis
          </p>
          <h2 className="mt-3 font-heading text-display-md text-default sm:text-display-lg">
            What can the AI detect in{' '}
            <span className="bg-gradient-to-r from-primary-600 to-accent-600 bg-clip-text text-transparent dark:from-primary-600 dark:to-accent-500">
              60 seconds?
            </span>
          </h2>
          <p className="mt-4 max-w-2xl text-body-lg text-muted">
            The model is trained across 10 dermatologist-informed classes, from early cancer markers
            to a clear healthy-skin read.
          </p>
        </div>

        {/* Condition grid: 2 / 3 / 5 columns */}
        <div
          ref={gridRef}
          className="mt-12 grid auto-rows-fr grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5"
        >
          {conditions.map((item, index) => (
            <div
              key={item.name}
              style={{ transitionDelay: `${index * 50}ms` }}
              className={`flex h-full flex-col gap-3 rounded-card border border-subtle bg-surface p-4 shadow-card transition duration-500 hover:-translate-y-0.5 hover:shadow-card-hover sm:p-5 ${
                gridInView ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
              }`}
            >
              <span
                className={`flex h-10 w-10 items-center justify-center rounded-field ${CHIP_TONES[index % CHIP_TONES.length]}`}
              >
                <item.icon size={18} strokeWidth={2} aria-hidden="true" />
              </span>
              <div>
                <h3 className="text-heading-sm text-default">{item.name}</h3>
                <p className="mt-1 text-body-sm text-muted">{item.note}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Closing caption */}
        <p className="mt-8 text-center text-caption text-subtle">
          Class 10 is healthy skin: the AI confirms a clear result instead of only flagging
          problems. For best accuracy, take photos in natural daylight without zoom.
        </p>
      </div>
    </section>
  );
};

export default ConditionAnalysis;
