import React from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  BadgeCheck,
  CalendarCheck,
  Cpu,
  FileUp,
  MapPin,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  UserCheck,
  Zap,
} from 'lucide-react';

import { Button } from '../ui';
import { PATHS } from '../../routes';
import UVWidget from '../widgets/UVWidget';

/**
 * Landing hero. THEME-ADAPTIVE: built on the flipping token scales, so light
 * mode gets a bright, airy hero and dark mode a deep navy one, from the same
 * classes. Only the CTA gradient and the accent glows are shared brand
 * constants; everything else follows the theme.
 */

const STEPS = [
  {
    title: 'Create your profile',
    desc: 'Sign up in minutes and keep your skin records in one secure, private place.',
    icon: UserCheck,
    tint: 'bg-primary-100 text-primary-700',
  },
  {
    title: 'Scan your skin',
    desc: 'Upload a clear photo and get an instant AI assessment of the condition.',
    icon: Cpu,
    tint: 'bg-accent-100 text-accent-700',
  },
  {
    title: 'Match with a specialist',
    desc: 'Filter nearby verified dermatologists by fees, location, and open slots.',
    icon: MapPin,
    tint: 'bg-info-100 text-info-700',
  },
  {
    title: 'Share your report',
    desc: 'Send your AI pre-assessment to the doctor you choose in one tap.',
    icon: FileUp,
    tint: 'bg-success-100 text-success-700',
  },
  {
    title: 'Get a clinical review',
    desc: 'The doctor reviews your case and replies with next steps or a booking.',
    icon: Stethoscope,
    tint: 'bg-warning-100 text-warning-700',
  },
  {
    title: 'Track everything',
    desc: 'Appointments, reports, and follow-ups stay synced to your dashboard.',
    icon: CalendarCheck,
    tint: 'bg-danger-100 text-danger-700',
  },
];

const TRUST = [
  { icon: ShieldCheck, label: 'Private photos' },
  { icon: BadgeCheck, label: 'Verified doctors' },
  { icon: Zap, label: 'Results in seconds' },
];

const Hero = () => (
  <section
    aria-labelledby="hero-heading"
    className="relative overflow-hidden bg-canvas text-default"
  >
    {/* CSS-only ambience. Every layer is token- or fixed-brand-based, so it
        reads as a soft wash in light mode and a deep glow in dark mode. */}
    <div aria-hidden="true" className="pointer-events-none absolute inset-0">
      <div className="absolute inset-0 bg-gradient-to-br from-primary-100/60 via-transparent to-accent-100/50" />
      <div className="absolute -left-32 -top-24 h-[28rem] w-[28rem] rounded-pill bg-primary-400/20 blur-3xl" />
      <div className="absolute -bottom-32 -right-24 h-[26rem] w-[26rem] rounded-pill bg-accent-400/20 blur-3xl" />
      <div
        className="absolute inset-0 opacity-70"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgb(var(--color-text) / 0.04) 1px, transparent 1px), ' +
            'linear-gradient(to bottom, rgb(var(--color-text) / 0.04) 1px, transparent 1px)',
          backgroundSize: '3.5rem 3.5rem',
          maskImage: 'radial-gradient(ellipse 80% 70% at 50% 30%, black 35%, transparent 80%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 70% at 50% 30%, black 35%, transparent 80%)',
        }}
      />
    </div>

    {/* Sits below a sticky (in-flow) h-16 navbar, so top padding is its own. */}
    <div className="relative mx-auto max-w-7xl px-4 pb-20 pt-14 sm:px-6 sm:pb-24 sm:pt-20 lg:px-8 lg:pt-24">
      <div className="grid items-center gap-12 lg:grid-cols-12 lg:gap-10">
        {/* Left: pitch */}
        <div className="hero-reveal lg:col-span-7">
          <p className="inline-flex items-center gap-2 rounded-pill border border-subtle bg-surface/80 px-3.5 py-1.5 text-overline uppercase tracking-widest text-accent-700 shadow-soft backdrop-blur dark:text-accent-400">
            <Sparkles size={14} aria-hidden="true" />
            AI dermatology, verified doctors
          </p>

          <h1
            id="hero-heading"
            className="mt-6 font-heading text-display-lg text-default sm:text-display-xl lg:text-display-2xl"
          >
            Clear answers for your skin,
            <span className="block bg-gradient-to-r from-primary-600 to-accent-600 bg-clip-text text-transparent">
              from scan to specialist.
            </span>
          </h1>

          <p className="mt-5 max-w-xl text-body-lg text-muted">
            Upload a photo, get an instant AI assessment, and share it with a verified
            dermatologist near you. Your whole skin care journey lives in one secure place.
          </p>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              as={Link}
              to={PATHS.CONSULT}
              variant="gradient"
              size="lg"
              rightIcon={<ArrowRight size={16} />}
            >
              Start a free skin check
            </Button>
            <Button
              as={Link}
              to={PATHS.PATIENT_FIND_DOCTOR}
              variant="outline"
              size="lg"
            >
              Find a doctor
            </Button>
          </div>

          <ul className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3 text-body-sm text-subtle">
            {TRUST.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.label} className="inline-flex items-center gap-2">
                  <Icon size={16} className="text-accent-700 dark:text-accent-400" aria-hidden="true" />
                  {item.label}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Right: the live UV widget in a floating surface card */}
        <div className="hero-reveal lg:col-span-5">
          <div className="relative mx-auto w-full max-w-sm lg:ml-auto">
            <div
              aria-hidden="true"
              className="absolute -inset-5 rounded-4xl bg-accent-400/15 blur-2xl"
            />
            <div className="hero-float relative">
              <div className="overflow-hidden rounded-card border border-subtle bg-surface shadow-elevated">
                <div
                  aria-hidden="true"
                  className="h-1 w-full bg-gradient-to-r from-navy-500 via-aqua-400 to-aqua-500"
                />
                <UVWidget />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom edge: how it works, as tonal surface cards */}
      <div className="mt-16 border-t border-subtle pt-10 lg:mt-20">
        <p className="text-overline uppercase tracking-widest text-accent-700 dark:text-accent-400">
          How it works
        </p>
        <h2 className="mt-1.5 font-heading text-heading-lg text-default">
          From first photo to follow-up
        </h2>

        <ol className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <li
                key={step.title}
                className="rounded-card border border-subtle bg-surface p-5 shadow-card transition duration-300 hover:-translate-y-0.5 hover:shadow-card-hover"
              >
                <div className="flex items-center justify-between">
                  <span
                    className={`flex h-9 w-9 items-center justify-center rounded-field ${step.tint}`}
                  >
                    <Icon size={18} aria-hidden="true" />
                  </span>
                  <span className="font-numeric text-caption text-subtle">0{index + 1}</span>
                </div>
                <h3 className="mt-3 text-heading-sm text-default">{step.title}</h3>
                <p className="mt-1.5 text-body-sm text-muted">{step.desc}</p>
              </li>
            );
          })}
        </ol>
      </div>
    </div>

    {/* Keyframes Tailwind cannot express; guarded for reduced motion. */}
    <style
      dangerouslySetInnerHTML={{
        __html: `
          @keyframes hero-float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
          }
          @keyframes hero-reveal {
            from { opacity: 0; transform: translateY(16px); }
            to { opacity: 1; transform: translateY(0); }
          }
          .hero-float { animation: hero-float 6s ease-in-out infinite; }
          .hero-reveal { animation: hero-reveal 0.7s cubic-bezier(0.16, 1, 0.3, 1) both; }
          @media (prefers-reduced-motion: reduce) {
            .hero-float, .hero-reveal { animation: none; }
          }
        `,
      }}
    />
  </section>
);

export default Hero;
