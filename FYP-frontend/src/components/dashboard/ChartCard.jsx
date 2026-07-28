/**
 * ChartCard — the frame a dashboard chart renders inside.
 *
 * Equal-height by construction (`h-full` + flex column) so a grid row of
 * charts lines up regardless of content. The header carries the title and an
 * optional icon chip; the body grows to fill.
 */

import React from 'react';

import { cn } from '../../lib/cn';
import Card from '../ui/Card';

const TONES = {
  primary: 'bg-primary-100 text-primary-700',
  accent: 'bg-accent-100 text-accent-700',
  info: 'bg-info-100 text-info-700',
  success: 'bg-success-100 text-success-700',
  warning: 'bg-warning-100 text-warning-700',
  danger: 'bg-danger-100 text-danger-700',
};

/**
 * @param {object} props
 * @param {React.ReactNode} props.title
 * @param {React.ReactNode} [props.description]
 * @param {React.ComponentType} [props.icon]
 * @param {keyof typeof TONES} [props.tone='primary']
 * @param {React.ReactNode} [props.actions]
 * @param {React.ReactNode} props.children
 * @param {string} [props.className]
 */
export default function ChartCard({
  title,
  description,
  icon: Icon,
  tone = 'primary',
  actions,
  children,
  className,
}) {
  return (
    <Card padding="none" className={cn('flex h-full flex-col', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-5 sm:px-6 sm:pt-6">
        <div className="flex min-w-0 items-start gap-2.5">
          {Icon && (
            <span
              className={cn(
                'grid h-8 w-8 shrink-0 place-items-center rounded-field',
                TONES[tone] ?? TONES.primary,
              )}
            >
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            <h2 className="font-heading text-heading-sm text-default">{title}</h2>
            {description && <p className="mt-0.5 text-caption text-muted">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
      <div className="flex-1 px-5 pb-5 sm:px-6 sm:pb-6">{children}</div>
    </Card>
  );
}

export { ChartCard };
