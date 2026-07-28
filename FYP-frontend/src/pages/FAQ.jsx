import React from 'react';
import { ChevronDown, MessageCircleQuestion } from 'lucide-react';

import { Button, cn, focusRing } from '../components/ui';

const SUPPORT_EMAIL = 'support@ai-derm.com';

const SupportLink = () => (
  <a
    href={`mailto:${SUPPORT_EMAIL}`}
    className="font-medium text-accent-700 underline-offset-4 hover:underline dark:text-accent-400"
  >
    {SUPPORT_EMAIL}
  </a>
);

const FAQS = [
  {
    question: 'How does the AI Dermatologist work?',
    answer:
      'Our AI system analyzes the images you upload to track and monitor skin concerns. It uses advanced algorithms to compare your image with thousands of dermatological cases to provide insights.',
  },
  {
    question: 'Is this a replacement for a real doctor?',
    answer:
      'No. The AI scan is a triage aid, not a medical diagnosis. It helps you image, track and monitor areas of concern and decide when to see a specialist. Always consult a certified dermatologist or healthcare professional for real medical advice.',
  },
  {
    question: 'Is my data and uploaded images secure?',
    answer:
      'Yes, we prioritize your privacy. All uploaded images are encrypted and strictly used for the purpose of monitoring your skin health. We do not share your personal data with third parties.',
  },
  {
    question: 'Who can see the photos I upload?',
    answer:
      'Your photos are private by default. Only you can see them, and a doctor sees a scan only when you choose to share it as part of a consultation or referral.',
  },
  {
    question: 'Are the doctors on the platform verified?',
    answer:
      'Yes. Every dermatologist profile is reviewed and approved by our team before it becomes visible to patients, so you only ever book a consultation with a verified doctor.',
  },
  {
    question: 'Do I need separate accounts for the patient and doctor sides?',
    answer:
      'No. One account covers everything. A verified doctor gets a doctor workspace and a personal skin health space on the same login, and can switch between them at any time.',
  },
  {
    question: 'How can I contact support?',
    answer: (
      <>
        If you have any questions or face any issues, you can contact our support team directly via
        email at <SupportLink />.
      </>
    ),
  },
];

const FAQ = () => {
  return (
    <div className="bg-canvas">
      {/* Page header */}
      <header className="border-b border-subtle bg-gradient-to-br from-primary-50 via-surface to-accent-50 dark:from-surface-sunken dark:via-surface dark:to-surface-sunken">
        <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-16 lg:px-8">
          <p className="text-overline uppercase tracking-widest text-accent-700 dark:text-accent-400">
            Support
          </p>
          <h1 className="mt-3 font-heading text-display-md text-default sm:text-display-lg">
            Frequently asked questions
          </h1>
          <p className="mt-4 max-w-2xl text-body-lg text-muted">
            Quick answers about the AI scan, your photos, verified doctors and your account. If you
            cannot find what you need, our support team is one email away.
          </p>
        </div>
      </header>

      {/* Q&A accordion */}
      <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16 lg:px-8">
        <div className="flex flex-col gap-3">
          {FAQS.map((item, index) => (
            <details
              key={item.question}
              open={index === 0 || undefined}
              className="group rounded-card border border-subtle bg-surface shadow-soft transition-colors open:border-accent-500/60 open:shadow-card"
            >
              <summary
                className={cn(
                  'flex cursor-pointer select-none list-none items-center justify-between gap-4',
                  'rounded-card px-5 py-4 text-left [&::-webkit-details-marker]:hidden',
                  focusRing,
                )}
              >
                <span className="font-heading text-heading-sm text-default">{item.question}</span>
                <span
                  aria-hidden="true"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-accent-100 text-accent-700 transition-transform duration-200 group-open:rotate-180"
                >
                  <ChevronDown className="h-4 w-4" />
                </span>
              </summary>
              <div className="border-t border-subtle px-5 pb-5 pt-4 text-body-md leading-relaxed text-muted">
                {item.answer}
              </div>
            </details>
          ))}
        </div>

        {/* Contact strip */}
        <div className="mt-10 flex flex-col items-start gap-4 rounded-card border border-subtle bg-surface p-6 shadow-soft sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-4">
            <span
              aria-hidden="true"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-field bg-primary-100 text-primary-700"
            >
              <MessageCircleQuestion className="h-5 w-5" />
            </span>
            <div>
              <h2 className="font-heading text-heading-sm text-default">Still have questions?</h2>
              <p className="mt-1 text-body-sm text-muted">
                Write to us at <SupportLink /> and we will get back to you.
              </p>
            </div>
          </div>
          <Button as="a" href={`mailto:${SUPPORT_EMAIL}`} variant="soft" className="shrink-0">
            Email support
          </Button>
        </div>
      </div>
    </div>
  );
};

export default FAQ;
