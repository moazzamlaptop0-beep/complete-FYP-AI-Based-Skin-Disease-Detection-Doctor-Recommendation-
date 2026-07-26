/**
 * PageHeader — the title block every patient page opens with.
 *
 * DashboardLayout owns the chrome; this owns only the "what am I looking at and
 * what can I do here" row, so the five patient pages cannot drift into five
 * different heading sizes. Actions wrap under the title on a phone rather than
 * squeezing the heading to two characters.
 */

import React from 'react';

import { cn } from '../../../components/ui';

export function PageHeader({ title, description, actions, className, children }) {
  return (
    <header className={cn('mb-5 flex flex-col gap-3 sm:mb-6', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h1 className="font-heading text-heading-md text-default sm:text-heading-lg">{title}</h1>
          {description && (
            <p className="mt-1 max-w-prose font-body text-body-sm text-muted">{description}</p>
          )}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export default PageHeader;
