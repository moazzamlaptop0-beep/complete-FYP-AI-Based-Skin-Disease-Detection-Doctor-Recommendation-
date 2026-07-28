/**
 * StatCard — one equal-sized dashboard stat tile.
 *
 * The grid owns the sizing (`auto-rows-fr` + `h-full` here), so every tile in
 * a row is the same height regardless of hint length. The icon sits in a
 * tonal chip; because every scale is CSS-variable backed, the tints adapt to
 * dark mode without explicit overrides.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';

import { cn } from '../../lib/cn';
import Card from '../ui/Card';
import Skeleton from '../ui/Skeleton';

const TONES = {
  primary: 'bg-primary-100 text-primary-700',
  accent: 'bg-accent-100 text-accent-700',
  info: 'bg-info-100 text-info-700',
  success: 'bg-success-100 text-success-700',
  warning: 'bg-warning-100 text-warning-700',
  danger: 'bg-danger-100 text-danger-700',
  neutral: 'bg-neutral-100 text-neutral-700',
};

/**
 * @param {object} props
 * @param {React.ReactNode} props.label What is being counted.
 * @param {React.ReactNode} props.value The number (already formatted).
 * @param {React.ReactNode} [props.hint] One line under the value.
 * @param {React.ComponentType} [props.icon]
 * @param {keyof typeof TONES} [props.tone='primary'] Icon chip tint.
 * @param {string} [props.to] Renders the whole tile as a link.
 * @param {boolean} [props.loading]
 * @param {boolean} [props.urgent] Warning ring for queues that block people.
 * @param {React.ReactNode} [props.badge] Small element next to the label.
 * @param {string} [props.className]
 */
export default function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'primary',
  to,
  loading = false,
  urgent = false,
  badge,
  className,
}) {
  const linkProps = to ? { as: Link, to, interactive: true } : {};

  return (
    <Card
      padding="md"
      className={cn(
        'group h-full',
        urgent && 'border-warning-300',
        className,
      )}
      {...linkProps}
    >
      <div className="flex h-full items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <p className="flex items-center gap-2 text-body-sm font-medium text-muted">
            <span className="truncate">{label}</span>
            {badge}
          </p>
          {loading ? (
            <Skeleton shape="rect" width={72} height={36} className="mt-2" />
          ) : (
            <p
              className={cn(
                'mt-1 font-heading text-display-sm tabular-nums',
                urgent ? 'text-warning-700' : 'text-default',
              )}
            >
              {value}
            </p>
          )}
          {hint && <p className="mt-1 text-caption text-muted">{hint}</p>}
        </div>

        <span className="relative shrink-0">
          {Icon && (
            <span
              className={cn(
                'grid h-11 w-11 place-items-center rounded-field transition-transform duration-200',
                'group-hover:scale-105',
                TONES[tone] ?? TONES.primary,
                urgent && TONES.warning,
              )}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
            </span>
          )}
          {to && (
            <ArrowUpRight
              aria-hidden="true"
              className={cn(
                'absolute -right-1.5 -top-1.5 h-4 w-4 text-subtle opacity-0 transition-opacity',
                'group-hover:opacity-100',
              )}
            />
          )}
        </span>
      </div>
    </Card>
  );
}

export { StatCard };
