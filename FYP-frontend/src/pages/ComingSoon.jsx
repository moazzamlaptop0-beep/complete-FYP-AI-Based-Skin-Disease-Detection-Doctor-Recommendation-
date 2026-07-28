/**
 * ComingSoon — the honest placeholder for a route whose page is being built.
 *
 * WHY THIS EXISTS
 * ---------------
 * The route table is final; the pages that hang off it are built in parallel by
 * separate steps. Mounting the OLD pre-refactor page at a new path would be
 * worse than a placeholder: those pages read localStorage directly, run their
 * own logout and open their own unauthenticated EventSource, so half a
 * migration would look like it worked while quietly reintroducing every problem
 * this refactor removes.
 *
 * So a not-yet-built route renders this instead. It is a real page, it sits
 * inside the same chrome, keeps the nav highlighted and tells the user what is
 * coming. It is built entirely on the shared ui primitives, so it inherits
 * the theme and never has to be restyled.
 *
 * REPLACING ONE
 * -------------
 * Each placeholder lives at the exact path App.jsx lazy-imports for that route
 * (see the PAGES map in App.jsx). Replace the FILE CONTENTS with the real page,
 * keeping the default export. Do not move or rename the file, and do not edit
 * App.jsx: the route table is fixed.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Hammer } from 'lucide-react';

import { Button, Card, EmptyState } from '../components/ui';
import { PATHS } from '../routes';

/**
 * @param {object} props
 * @param {string} props.title Page name, e.g. 'My scans'.
 * @param {string} [props.description] What this page will do.
 * @param {string} [props.backTo] Where the escape hatch points.
 * @param {string} [props.backLabel]
 */
export default function ComingSoon({
  title,
  description,
  backTo = PATHS.HOME,
  backLabel = 'Back to home',
}) {
  return (
    <Card variant="elevated" padding="none" className="overflow-hidden">
      {/* Brand hairline: marks the panel as intentional, not broken. */}
      <div
        aria-hidden="true"
        className="h-1.5 w-full bg-gradient-to-r from-primary-600 via-primary-700 to-accent-600"
      />
      <EmptyState
        icon={<Hammer className="h-6 w-6" aria-hidden="true" />}
        tone="primary"
        title={title}
        titleAs="h1"
        size="lg"
        description={description || 'This page is being built in the next step.'}
        action={(
          <Button as={Link} to={backTo} variant="soft" leftIcon={<ArrowLeft className="h-4 w-4" />}>
            {backLabel}
          </Button>
        )}
      >
        <p className="mx-auto max-w-prose rounded-field bg-surface-sunken px-4 py-3 text-caption text-muted">
          The route, its guard and its place in the navigation are already final.
          Only the contents of this panel change.
        </p>
      </EmptyState>
    </Card>
  );
}

/**
 * Build a placeholder page component from a routes.js row. Keeps each
 * placeholder file down to two lines and guarantees the copy matches the nav.
 * @param {{label:string, description?:string}} route
 * @param {{backTo?:string, backLabel?:string}} [options]
 */
export function comingSoonFor(route, options = {}) {
  function Placeholder() {
    return (
      <ComingSoon
        title={route?.label || 'Coming soon'}
        description={route?.description}
        {...options}
      />
    );
  }
  Placeholder.displayName = `ComingSoon(${route?.id || route?.label || 'page'})`;
  return Placeholder;
}

export { ComingSoon };
