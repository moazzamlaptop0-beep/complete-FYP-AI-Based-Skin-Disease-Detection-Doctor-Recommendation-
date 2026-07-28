/**
 * PageHeader — THE page heading block for every dashboard page.
 *
 * One implementation for the patient, doctor and admin surfaces, so the three
 * cannot drift into three different title scales again (they had: display-sm
 * vs heading-md vs heading-md). The doctor surface passes its WorkspaceChip
 * through `topSlot`; nothing role-specific lives here.
 */

import React from 'react';

import { cn } from '../../lib/cn';

/**
 * @param {object} props
 * @param {React.ReactNode} props.title
 * @param {React.ReactNode} [props.description]
 * @param {React.ReactNode} [props.actions] Right-aligned controls.
 * @param {React.ReactNode} [props.meta] Badges/counters under the title.
 * @param {React.ReactNode} [props.topSlot] Rendered above the title row (e.g. a workspace chip).
 * @param {React.ReactNode} [props.children] Rendered below the header row (e.g. a filter bar).
 * @param {string} [props.className]
 */
export default function PageHeader({
  title,
  description,
  actions,
  meta,
  topSlot,
  children,
  className,
}) {
  return (
    <header className={cn('mb-6 flex flex-col gap-3', className)}>
      {topSlot}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-display-sm text-default">{title}</h1>
          {description && (
            <p className="mt-1 max-w-2xl text-body-sm text-muted">{description}</p>
          )}
          {meta && <div className="mt-2 flex flex-wrap items-center gap-2">{meta}</div>}
        </div>

        {actions && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>

      {children}
    </header>
  );
}

export { PageHeader };
