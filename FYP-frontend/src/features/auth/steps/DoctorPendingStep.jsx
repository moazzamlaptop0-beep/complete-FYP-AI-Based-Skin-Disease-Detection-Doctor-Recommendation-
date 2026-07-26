/**
 * DoctorPendingStep — "your account exists, your licence is being checked".
 *
 * This is a SIGNED-IN state, not an error. `verification_status` starts
 * 'pending' for every new doctor, and an admin approves the PMDC number before
 * case review is unlocked. The old flow dropped a pending doctor onto a doctor
 * dashboard full of empty tables with no explanation, which reads as "the app
 * is broken" rather than "we are checking your licence".
 *
 * Two things make this screen worth its own state:
 *   1. It says what happens next, and roughly when.
 *   2. It offers the patient workspace, which the account ALREADY has. The role
 *      hierarchy means a Doctor holds every patient permission, so nothing here
 *      is blocked — this is precisely the reason nobody needs a second account.
 *
 * `/auth/me` re-reads verification_status on every load, so once an admin
 * approves, the doctor dashboard appears without logging out and back in.
 */

import React from 'react';
import { ClipboardCheck, Clock, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Alert, Button } from '../../../components/ui';

const TIMELINE = [
  {
    icon: ClipboardCheck,
    title: 'We check your PMDC licence',
    body: 'An administrator verifies the number you entered against the register.',
  },
  {
    icon: Clock,
    title: 'Usually within one working day',
    body: 'You will get an email at the address you just confirmed as soon as it is decided.',
  },
  {
    icon: ShieldCheck,
    title: 'Then case review unlocks',
    body: 'Patient cases, your schedule and your clinic profile appear automatically — no need to sign in again.',
  },
];

/**
 * @param {object} props
 * @param {object|null} props.user
 * @param {string} props.homeRoute Where the patient workspace lives for them.
 * @param {'pending'|'rejected'|string} [props.status='pending']
 * @param {() => void} props.onContinue Navigates and leaves the auth screen.
 */
export default function DoctorPendingStep({ user, homeRoute, status = 'pending', onContinue }) {
  const rejected = status === 'rejected';

  return (
    <div className="space-y-6">
      {rejected ? (
        // A turned-down licence is NOT a pending one. Saying "we are still
        // checking" to someone who was rejected is the kind of half-truth that
        // generates support tickets forever.
        <Alert tone="warning" title="We could not verify this licence">
          {user?.name ? `${user.name}, your ` : 'Your '}
          PMDC number was not accepted. Your account still works for everything
          a patient account can do; contact support to have the licence
          reviewed again.
        </Alert>
      ) : (
        <Alert tone="success" title="Your email is verified">
          {user?.name ? `Thanks, ${user.name}. ` : ''}
          Your account is active and you are signed in.
        </Alert>
      )}

      <ol className={rejected ? 'hidden' : 'space-y-4'}>
        {TIMELINE.map((item, index) => {
          const Icon = item.icon;
          return (
            <li key={item.title} className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-control
                           bg-primary-50 text-primary-700 dark:bg-primary-950 dark:text-accent-400"
              >
                <Icon className="h-5 w-5" />
              </span>
              <div>
                <p className="font-body text-label-lg text-default">
                  <span className="ui-sr-only">{`Step ${index + 1}: `}</span>
                  {item.title}
                </p>
                <p className="text-body-sm text-muted">{item.body}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="space-y-3">
        <Button type="button" fullWidth size="lg" onClick={onContinue}>
          Continue to my account
        </Button>
        <p className="text-center text-body-sm text-muted">
          In the meantime you can{' '}
          <Link
            to="/try-now"
            className="rounded-field font-medium text-primary-700 underline-offset-2 hover:underline
                       outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2
                       focus-visible:ring-offset-surface dark:text-accent-400"
          >
            scan a photo
          </Link>{' '}
          and use everything a patient account can do.
        </p>
        <p className="ui-sr-only">{`Your account home is ${homeRoute}.`}</p>
      </div>
    </div>
  );
}

export { DoctorPendingStep };
