import React from 'react';
import { CalendarClock } from 'lucide-react';

const EmailLink = () => (
  <a
    href="mailto:support@ai-derm.com"
    className="font-medium text-accent-700 underline-offset-4 hover:underline dark:text-accent-400"
  >
    support@ai-derm.com
  </a>
);

const SECTIONS = [
  {
    title: '1. Information We Collect',
    body: (
      <p>
        We may collect personal identification information such as your name, email address, and
        demographic data. When you use our skin scanning feature, we securely collect and process
        the images you upload solely for the purpose of analysis and tracking.
      </p>
    ),
  },
  {
    title: '2. How We Use Your Information',
    body: (
      <ul className="list-disc space-y-2 pl-5 marker:text-accent-700 dark:marker:text-accent-400">
        <li>To provide, operate, and maintain our AI scanning services.</li>
        <li>To improve, personalize, and expand our website&apos;s functionality.</li>
        <li>To communicate with you regarding updates, support, or security alerts.</li>
        <li>To monitor and analyze usage and trends to improve your experience.</li>
      </ul>
    ),
  },
  {
    title: '3. Data Security',
    body: (
      <p>
        We implement a variety of security measures to maintain the safety of your personal
        information. Your uploaded images are encrypted and stored on secure servers. However,
        please be aware that no method of transmission over the internet is 100% secure.
      </p>
    ),
  },
  {
    title: '4. Sharing of Information',
    body: (
      <p>
        We do not sell, trade, or rent your personal identification information to others. We may
        share generic aggregated demographic information not linked to any personal identification
        information with our business partners and trusted affiliates.
      </p>
    ),
  },
  {
    title: '5. Contact Us',
    body: (
      <>
        <p>If you have any questions or concerns about this Privacy Policy, please contact us at:</p>
        <p className="font-medium text-default">
          Email: <EmailLink />
        </p>
      </>
    ),
  },
];

const PrivacyPolicy = () => {
  return (
    <div className="bg-canvas">
      {/* Page header */}
      <header className="border-b border-subtle bg-gradient-to-br from-primary-50 via-surface to-accent-50 dark:from-surface-sunken dark:via-surface dark:to-surface-sunken">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
          <p className="text-overline uppercase tracking-widest text-accent-700 dark:text-accent-400">
            Legal
          </p>
          <h1 className="mt-3 font-heading text-display-md text-default sm:text-display-lg">
            Privacy Policy
          </h1>
          <p className="mt-4 max-w-2xl text-body-lg text-muted">
            Welcome to AI Dermatologist. Your privacy is critically important to us. This Privacy
            Policy explains how we collect, use, disclose, and safeguard your information when you
            visit our website or use our application.
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

      {/* Policy content */}
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

export default PrivacyPolicy;
