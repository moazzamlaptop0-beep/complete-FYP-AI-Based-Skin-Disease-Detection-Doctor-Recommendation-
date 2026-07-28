/**
 * Footer — the public-site footer.
 *
 * Token-based (no raw hex), dark-mode aware, and derived from the same route
 * table as every other nav surface. Four zones: brand + pitch, product links,
 * legal links, contact. The bottom bar carries social icons and copyright.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import {
  Facebook,
  Instagram,
  Linkedin,
  Mail,
  ScanLine,
  Send,
  Sparkles,
  Twitter,
} from 'lucide-react';

import { cn } from '../../lib/cn';
import { PATHS } from '../../routes';
import Button, { focusRing } from '../ui/Button';

const PRODUCT_LINKS = [
  { label: 'AI skin check', to: PATHS.CONSULT },
  { label: 'Find a doctor', to: PATHS.PATIENT_FIND_DOCTOR },
  { label: 'My scans', to: PATHS.PATIENT_SCANS },
  { label: 'FAQ', to: PATHS.FAQ },
];

const LEGAL_LINKS = [
  { label: 'Privacy policy', to: PATHS.PRIVACY },
  { label: 'Terms of use', to: PATHS.TERMS },
];

const SOCIALS = [
  { label: 'Facebook', href: '#', icon: Facebook },
  { label: 'LinkedIn', href: '#', icon: Linkedin },
  { label: 'Twitter', href: '#', icon: Twitter },
  { label: 'Instagram', href: '#', icon: Instagram },
  { label: 'Telegram', href: '#', icon: Send },
];

/**
 * Every interactive element in the footer borrows `focusRing` from the Button
 * primitive instead of rolling its own.
 *
 * The old ring was `ring-accent-400`, the literal brand teal: 1.67:1 against the
 * light footer, i.e. a keyboard user could not see where they were. `ring-focus`
 * is 5.7:1 on the same surface and re-ramps for dark, and using the shared token
 * means the footer no longer looks like a second design system.
 */
function FooterLink({ to, children }) {
  return (
    <Link
      to={to}
      className={cn(
        'rounded-control text-body-sm text-muted',
        'transition-colors duration-150 ease-emphasized motion-reduce:transition-none',
        'hover:text-accent-700 dark:hover:text-accent-400',
        focusRing,
      )}
    >
      {children}
    </Link>
  );
}

export default function Footer() {
  return (
    // `border-default`, not `border-subtle`: the footer's own fill IS
    // `surface-sunken`, and in light mode `--color-line-subtle` and
    // `--color-surface-sunken` are the same rgb(241 245 249), so the edge that
    // separates the footer from the page was drawn in its own colour.
    <footer className="relative w-full overflow-hidden border-t border-default bg-surface-sunken">
      {/* Brand gradient hairline along the top edge. */}
      <div
        aria-hidden="true"
        className="h-1 w-full bg-gradient-to-r from-navy-500 via-aqua-400 to-aqua-500"
      />

      {/* Soft glow accents. Decorative only. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-pill bg-primary-400/10 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-32 right-0 h-80 w-80 rounded-pill bg-accent-400/10 blur-3xl"
      />

      <div className="relative mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:py-16">
        <div className="grid gap-10 lg:grid-cols-12">
          {/* ------------------------------------------------ brand + pitch -- */}
          <div className="flex flex-col gap-4 lg:col-span-5">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-field bg-gradient-to-br from-navy-500 to-aqua-500 text-white shadow-soft">
                <Sparkles className="h-5 w-5" aria-hidden="true" />
              </span>
              {/* Both words carry their own colour token. A wordmark that takes
                  its colour by inheritance is one careless ancestor away from
                  disappearing in a single theme. */}
              <span className="font-heading text-heading-lg text-default">
                AI <span className="text-accent-700 dark:text-accent-400">Dermatologist</span>
              </span>
            </div>

            <p className="max-w-md text-body-sm leading-relaxed text-muted">
              AI Dermatologist is not intended to perform diagnosis. It helps you image, track and
              monitor areas of skin concern, and connects you with real dermatologists when it
              matters.
            </p>

            <div>
              <Button
                as={Link}
                to={PATHS.CONSULT}
                variant="secondary"
                size="sm"
                leftIcon={<ScanLine className="h-4 w-4" aria-hidden="true" />}
              >
                Start a free skin check
              </Button>
            </div>
          </div>

          {/* ---------------------------------------------------- link rows -- */}
          <nav aria-label="Product" className="lg:col-span-2">
            <p className="mb-3 text-overline uppercase text-subtle">Product</p>
            <ul className="flex flex-col gap-2.5">
              {PRODUCT_LINKS.map((link) => (
                <li key={link.to}>
                  <FooterLink to={link.to}>{link.label}</FooterLink>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-label="Legal" className="lg:col-span-2">
            <p className="mb-3 text-overline uppercase text-subtle">Legal</p>
            <ul className="flex flex-col gap-2.5">
              {LEGAL_LINKS.map((link) => (
                <li key={link.to}>
                  <FooterLink to={link.to}>{link.label}</FooterLink>
                </li>
              ))}
            </ul>
          </nav>

          {/* ------------------------------------------------------ contact -- */}
          <div className="lg:col-span-3">
            <p className="mb-3 text-overline uppercase text-subtle">Contact</p>
            <p className="text-body-sm text-muted">
              Questions about our AI system? We answer within one working day.
            </p>
            <a
              href="mailto:support@ai-derm.com"
              className={cn(
                'mt-3 inline-flex items-center gap-2 rounded-field border border-default',
                'bg-surface px-3.5 py-2.5 text-body-sm font-semibold text-default',
                'transition-[background-color,border-color,color] duration-150 ease-emphasized',
                'motion-reduce:transition-none',
                'hover:border-accent-400/60 hover:text-accent-700 dark:hover:text-accent-400',
                'active:bg-primary-100',
                focusRing,
              )}
            >
              <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
              support@ai-derm.com
            </a>
          </div>
        </div>

        {/* ----------------------------------------------------- bottom bar -- */}
        <div className="mt-12 flex flex-col items-center gap-5 border-t border-default pt-6 md:flex-row md:justify-between">
          <div className="flex items-center gap-2">
            {SOCIALS.map((social) => {
              const Icon = social.icon;
              return (
                <a
                  key={social.label}
                  href={social.href}
                  aria-label={social.label}
                  className={cn(
                    'inline-flex h-9 w-9 items-center justify-center rounded-field border border-default',
                    'text-muted',
                    'transition-[background-color,border-color,color] duration-150 ease-emphasized',
                    'motion-reduce:transition-none',
                    'hover:border-accent-400/60 hover:bg-surface hover:text-accent-700',
                    'active:bg-primary-100 dark:hover:text-accent-400',
                    focusRing,
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </a>
              );
            })}
          </div>

          <p className="text-caption text-subtle">
            AI Dermatologist. All rights reserved. Copyright © {new Date().getFullYear()}
          </p>
        </div>
      </div>
    </footer>
  );
}
