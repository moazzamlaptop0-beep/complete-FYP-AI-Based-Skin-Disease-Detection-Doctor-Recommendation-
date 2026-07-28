import React from 'react';
import { CalendarClock } from 'lucide-react';

const SECTIONS = [
  {
    title: '1. Medical Disclaimer',
    body: (
      <p>
        <strong className="font-semibold text-default">
          AI Dermatologist is NOT a replacement for professional medical advice, diagnosis, or
          treatment.
        </strong>{' '}
        The application is designed solely to provide users with the ability to image, track, and
        monitor areas of skin concern. Always seek the advice of a qualified healthcare provider or
        dermatologist with any questions you may have regarding a medical condition.
      </p>
    ),
  },
  {
    title: '2. User Responsibilities',
    body: (
      <ul className="list-disc space-y-2 pl-5 marker:text-accent-700 dark:marker:text-accent-400">
        <li>You must be at least 18 years old to use this service.</li>
        <li>You agree to provide accurate and complete information when creating an account.</li>
        <li>
          You are responsible for maintaining the confidentiality of your account login
          information.
        </li>
        <li>
          You agree not to upload inappropriate, offensive, or illegal images to the platform.
        </li>
      </ul>
    ),
  },
  {
    title: '3. Intellectual Property',
    body: (
      <p>
        All content, features, and functionality on this website (including but not limited to
        text, graphics, logos, and AI algorithms) are the exclusive property of AI Dermatologist
        and are protected by international copyright and trademark laws.
      </p>
    ),
  },
  {
    title: '4. Limitation of Liability',
    body: (
      <p>
        In no event shall AI Dermatologist, nor its directors, employees, or partners, be liable
        for any indirect, incidental, special, consequential, or punitive damages arising out of
        your use or inability to use the service.
      </p>
    ),
  },
  {
    title: '5. Changes to Terms',
    body: (
      <p>
        We reserve the right to modify or replace these Terms at any time. We will notify you of
        any changes by posting the new Terms on this page. Your continued use of the service after
        any such changes constitutes your acceptance of the new Terms.
      </p>
    ),
  },
];

const TermsOfUse = () => {
  return (
    <div className="bg-canvas">
      {/* Page header */}
      <header className="border-b border-subtle bg-gradient-to-br from-primary-50 via-surface to-accent-50 dark:from-surface-sunken dark:via-surface dark:to-surface-sunken">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
          <p className="text-overline uppercase tracking-widest text-accent-700 dark:text-accent-400">
            Legal
          </p>
          <h1 className="mt-3 font-heading text-display-md text-default sm:text-display-lg">
            Terms of Use
          </h1>
          <p className="mt-4 max-w-2xl text-body-lg text-muted">
            Please read these Terms of Use carefully before using the AI Dermatologist website and
            application. By accessing or using our services, you agree to be bound by these terms.
          </p>
          <p className="mt-6 inline-flex items-center gap-2 rounded-pill border border-subtle bg-surface px-3.5 py-1.5 text-caption text-muted">
            <CalendarClock
              className="h-3.5 w-3.5 text-accent-700 dark:text-accent-400"
              aria-hidden="true"
            />
            Last updated: June 2026
          </p>
        </div>
      </header>

      {/* Terms content */}
      <article className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="divide-y divide-subtle">
          {SECTIONS.map((section) => (
            <section key={section.title} className="py-8 first:pt-0 last:pb-0">
              <h2 className="font-heading text-heading-md text-default">{section.title}</h2>
              <div className="mt-3 space-y-3 text-body-md leading-relaxed text-muted">
                {section.body}
              </div>
            </section>
          ))}
        </div>
      </article>
    </div>
  );
};

export default TermsOfUse;
