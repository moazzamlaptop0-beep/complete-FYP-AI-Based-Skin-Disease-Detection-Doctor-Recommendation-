/**
 * AuthShell — the frame every state of the auth machine renders inside.
 *
 * There is exactly one of these because the four cross-cutting affordances the
 * brief demands (a back affordance, a server-error banner, a loading state and
 * inline field errors) must look and behave identically on all nine screens.
 * A step component only supplies its title, its fields and its submit button.
 *
 * The layout is a single centred column that grows to two columns of fields
 * only inside SignupDetailsStep, so the same shell works for a 1-field screen
 * and a 12-field one without a second variant.
 */

import React from 'react';
import { ArrowLeft, Stethoscope } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Alert, Button, Card, cn } from '../../../components/ui';

/**
 * @param {object} props
 * @param {string} props.title
 * @param {React.ReactNode} [props.subtitle]
 * @param {'md'|'lg'} [props.width='md'] `lg` for the signup form.
 * @param {() => void} [props.onBack] Renders the Back button when present.
 * @param {string} [props.backLabel='Back']
 * @param {React.ReactNode} [props.beforeForm] Slot above the fields (e.g. the email chip).
 * @param {?string} [props.error] Server-error banner copy.
 * @param {?string} [props.notice] Non-error banner copy.
 * @param {() => void} [props.onDismissError]
 * @param {React.ReactNode} [props.footer] Below the card.
 * @param {React.ReactNode} props.children
 */
export default function AuthShell({
  title,
  subtitle,
  width = 'md',
  onBack,
  backLabel = 'Back',
  beforeForm,
  error,
  notice,
  onDismissError,
  footer,
  children,
}) {
  return (
    <div className="flex min-h-screen w-full flex-col items-center justify-center bg-canvas px-4 py-10 sm:px-6">
      <div className={cn('w-full', width === 'lg' ? 'max-w-2xl' : 'max-w-md')}>
        {/* Brand. A link home doubles as the escape hatch on the first screen,
            where there is no previous state to go back to. */}
        <Link
          to="/"
          className={cn(
            'mx-auto mb-6 flex w-fit items-center gap-2.5 rounded-field px-2 py-1',
            'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
            'focus-visible:ring-offset-canvas',
          )}
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-control bg-primary-900 text-white dark:bg-primary-600">
            <Stethoscope aria-hidden="true" className="h-5 w-5" />
          </span>
          <span className="font-heading text-heading-md text-default">AI Dermatologist</span>
        </Link>

        <Card variant="elevated" padding="none" className="overflow-hidden">
          <div className="p-6 sm:p-8">
            {onBack && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onBack}
                leftIcon={<ArrowLeft aria-hidden="true" className="h-4 w-4" />}
                className="-ml-2 mb-4"
              >
                {backLabel}
              </Button>
            )}

            <header className="mb-6">
              <h1 className="font-heading text-display-sm text-default">{title}</h1>
              {subtitle && (
                <p className="mt-2 text-body-sm text-muted">{subtitle}</p>
              )}
            </header>

            {/* Banners live ABOVE the fields so a screen reader meets the
                failure before the control it is about. */}
            {error && (
              <Alert tone="danger" className="mb-5" onDismiss={onDismissError}>
                {error}
              </Alert>
            )}
            {!error && notice && (
              <Alert tone="info" className="mb-5" onDismiss={onDismissError}>
                {notice}
              </Alert>
            )}

            {beforeForm}

            {children}
          </div>
        </Card>

        {footer && <div className="mt-6 text-center text-body-sm text-muted">{footer}</div>}
      </div>
    </div>
  );
}

export { AuthShell };
