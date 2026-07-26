/**
 * PageHeader — the one heading block every doctor page uses.
 *
 * DashboardLayout accepts a `title` prop, but App.jsx mounts it once around an
 * <Outlet/>, so the per-page heading has to live in the page. Doing it here
 * rather than eight times keeps the h1 level, the counter placement and the
 * workspace chip identical across the surface.
 */

import React from 'react';

import { cn } from '../../../lib/cn';
import WorkspaceChip from './WorkspaceChip';

/**
 * @param {object} props
 * @param {React.ReactNode} props.title
 * @param {React.ReactNode} [props.description]
 * @param {React.ReactNode} [props.actions] Right-aligned controls.
 * @param {React.ReactNode} [props.meta] Badges/counters under the title.
 * @param {boolean} [props.chip=true] Render the workspace chip.
 * @param {string} [props.className]
 */
export default function PageHeader({
  title,
  description,
  actions,
  meta,
  chip = true,
  className,
}) {
  return (
    <header className={cn('mb-6 flex flex-col gap-3', className)}>
      {chip && <WorkspaceChip className="self-start" />}

      <div className="flex flex-wrap items-start justify-between gap-3">
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
    </header>
  );
}

export { PageHeader };
