/**
 * Dashboard charts — small, dependency-free, token-based.
 *
 * Two forms only, chosen for the data we actually have (bare list endpoints,
 * no server time-series):
 *
 *  - `ActivityBars`: a single-series bar chart over client-bucketed periods.
 *    Single series, so no legend (the card title names it). Fill is
 *    primary-500, which resolves to the SAME physical blue in light and dark
 *    (both validated ≥3:1 against their surfaces).
 *  - `StatusList`: labelled status rows (severity, appointment states) with a
 *    proportional track. Identity is carried by the row label + count, never
 *    by color alone; the fills are the validated status steps.
 *
 * Every mark is a real focusable element with a hover/focus tooltip, and each
 * chart ships an sr-only data summary as its table view.
 */

import React from 'react';

import { cn } from '../../lib/cn';
import { STATUS_FILLS } from './chartData';

/* -------------------------------------------------------------------------- */
/* ActivityBars                                                               */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} props
 * @param {Array<{key:string, label:string, value:number, hint?:string}>} props.data
 *   One entry per period, oldest first. `label` is the short axis label.
 * @param {string} props.ariaLabel What the chart shows, e.g. "Scans per week".
 * @param {string} [props.unit='items'] Plural noun for tooltips/summary.
 * @param {number} [props.height=112] Plot height in px.
 * @param {React.ReactNode} [props.empty] Rendered when every value is zero.
 * @param {string} [props.className]
 */
export function ActivityBars({
  data = [],
  ariaLabel,
  unit = 'items',
  height = 112,
  empty = null,
  className,
}) {
  const max = Math.max(...data.map((d) => d.value), 0);

  if (!data.length || max === 0) {
    return (
      empty || (
        <div
          className="flex items-center justify-center rounded-field bg-surface-sunken text-caption text-subtle"
          style={{ height: height + 28 }}
        >
          Nothing here yet
        </div>
      )
    );
  }

  return (
    <figure role="group" aria-label={ariaLabel} className={cn('w-full', className)}>
      <div className="flex items-end gap-1" style={{ height }}>
        {data.map((entry) => {
          // Anchored to the baseline; a non-zero value is always visible (min 6%).
          const ratio = entry.value === 0 ? 0 : Math.max(entry.value / max, 0.06);
          return (
            <div key={entry.key} className="group relative flex h-full flex-1 items-end">
              <button
                type="button"
                tabIndex={0}
                aria-label={`${entry.label}: ${entry.value} ${unit}`}
                className={cn(
                  'relative w-full cursor-default rounded-t border-0 p-0 transition-colors',
                  'outline-none focus-visible:ring-2 focus-visible:ring-focus',
                  entry.value === 0
                    ? 'h-0.5 bg-neutral-200'
                    : 'bg-primary-500 group-hover:bg-primary-600 dark:group-hover:bg-primary-600',
                )}
                style={entry.value === 0 ? undefined : { height: `${ratio * 100}%` }}
              />
              {/* Tooltip: hover or keyboard focus. */}
              <span
                role="presentation"
                className={cn(
                  'pointer-events-none absolute bottom-full left-1/2 z-raised mb-1.5 -translate-x-1/2',
                  'whitespace-nowrap rounded-control bg-surface-raised px-2 py-1 text-caption text-default',
                  'border border-subtle shadow-popover opacity-0 transition-opacity duration-100',
                  'group-hover:opacity-100 group-focus-within:opacity-100',
                )}
              >
                <span className="font-semibold tabular-nums">{entry.value}</span>
                {' '}{unit}{entry.hint ? ` · ${entry.hint}` : ` · ${entry.label}`}
              </span>
            </div>
          );
        })}
      </div>

      {/* Baseline + axis labels. Recessive by design. */}
      <div className="mt-1 border-t border-subtle pt-1">
        <div className="flex gap-1">
          {data.map((entry) => (
            <span
              key={entry.key}
              aria-hidden="true"
              className="flex-1 truncate text-center text-[0.625rem] leading-tight text-subtle"
            >
              {entry.label}
            </span>
          ))}
        </div>
      </div>

      {/* Table view for screen readers. */}
      <figcaption className="ui-sr-only">
        {data.map((entry) => `${entry.label}: ${entry.value} ${unit}`).join('. ')}
      </figcaption>
    </figure>
  );
}

/* -------------------------------------------------------------------------- */
/* StatusList                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * @param {object} props
 * @param {Array<{key:string, label:string, count:number, tone:keyof typeof STATUS_FILLS,
 *   icon?:React.ComponentType, hint?:string}>} props.items
 * @param {string} props.ariaLabel
 * @param {string} [props.className]
 */
export function StatusList({ items = [], ariaLabel, className }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <ul aria-label={ariaLabel} className={cn('flex flex-col gap-3.5', className)}>
      {items.map((item) => {
        const Icon = item.icon;
        const share = total === 0 ? 0 : item.count / total;
        return (
          <li key={item.key}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 text-body-sm text-default">
                {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-subtle" aria-hidden="true" />}
                <span className="truncate">{item.label}</span>
                {item.hint && <span className="truncate text-caption text-subtle">{item.hint}</span>}
              </span>
              <span className="shrink-0 text-label-md tabular-nums text-default">{item.count}</span>
            </div>
            <div
              role="presentation"
              className="h-2 overflow-hidden rounded-pill bg-surface-sunken"
            >
              <div
                className={cn(
                  'h-full rounded-pill transition-[width] duration-500 ease-emphasized',
                  STATUS_FILLS[item.tone] ?? STATUS_FILLS.primary,
                )}
                style={{ width: `${Math.round(share * 100)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

