import React, { useMemo } from 'react';
import { cn } from '../../lib/cn';
import Select from './Select';

const ELLIPSIS = 'ellipsis';

/**
 * Build the page list with ellipses.
 *
 * Always shows first + last + a window around the current page, so the control
 * never changes width as you page through 200 results (a jumping pagination bar
 * makes the "next" button move out from under the cursor).
 *
 * @param {number} current 1-based
 * @param {number} total
 * @param {number} siblings pages either side of current
 * @returns {(number|'ellipsis')[]}
 */
export function buildPageRange(current, total, siblings = 1) {
  const window = siblings * 2 + 5; // first, last, current, 2 ellipses
  if (total <= window) return Array.from({ length: total }, (_, i) => i + 1);

  const left = Math.max(current - siblings, 1);
  const right = Math.min(current + siblings, total);
  const showLeftEllipsis = left > 2;
  const showRightEllipsis = right < total - 1;

  if (!showLeftEllipsis && showRightEllipsis) {
    const count = 3 + siblings * 2;
    return [...Array.from({ length: count }, (_, i) => i + 1), ELLIPSIS, total];
  }
  if (showLeftEllipsis && !showRightEllipsis) {
    const count = 3 + siblings * 2;
    return [1, ELLIPSIS, ...Array.from({ length: count }, (_, i) => total - count + 1 + i)];
  }
  return [
    1,
    ELLIPSIS,
    ...Array.from({ length: right - left + 1 }, (_, i) => left + i),
    ELLIPSIS,
    total,
  ];
}

function Chevron({ direction = 'right', ...props }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path
        d={direction === 'right' ? 'm8 5 5 5-5 5' : 'm12 5-5 5 5 5'}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const itemBase =
  'inline-flex h-9 min-w-9 items-center justify-center rounded-control px-2.5 ' +
  'font-body text-label-md transition-colors duration-150 outline-none ' +
  'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-canvas disabled:pointer-events-none disabled:opacity-40';

/**
 * Page navigation.
 *
 * Semantics: a `<nav>` labelled "Pagination" containing a list of real
 * `<button>`s. The active page carries `aria-current="page"`, which is what
 * lets a screen-reader user answer "where am I?" without counting. Each button
 * has an explicit `aria-label` ("Go to page 4") because a bare "4" is
 * meaningless out of context.
 *
 * Renders nothing when there is one page or fewer — an empty pager is noise.
 *
 * @param {object} props
 * @param {number} props.page Current page, 1-based.
 * @param {number} [props.pageSize=10]
 * @param {number} [props.total] Total item count; used for the summary and to derive `pageCount`.
 * @param {number} [props.pageCount] Explicit page count (server-driven). Overrides `total`.
 * @param {(page: number) => void} props.onPageChange
 * @param {(size: number) => void} [props.onPageSizeChange] Renders a rows-per-page picker.
 * @param {number[]} [props.pageSizeOptions=[10, 25, 50, 100]]
 * @param {number} [props.siblings=1] Pages shown either side of the current one.
 * @param {boolean} [props.showSummary=true] "Showing 1-10 of 84".
 * @param {boolean} [props.compact=false] Hide numbers, show "Page 3 of 9".
 * @param {string} [props.className]
 */
export function Pagination({
  page = 1,
  pageSize = 10,
  total,
  pageCount,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  siblings = 1,
  showSummary = true,
  compact = false,
  className,
  ...rest
}) {
  const pages = pageCount ?? (total != null ? Math.max(Math.ceil(total / pageSize), 1) : 1);
  const current = Math.min(Math.max(page, 1), pages);

  const range = useMemo(() => buildPageRange(current, pages, siblings), [current, pages, siblings]);

  const from = total != null ? Math.min((current - 1) * pageSize + 1, total) : null;
  const to = total != null ? Math.min(current * pageSize, total) : null;

  const go = (next) => {
    const target = Math.min(Math.max(next, 1), pages);
    if (target !== current) onPageChange?.(target);
  };

  if (pages <= 1 && !onPageSizeChange) return null;

  return (
    <nav
      aria-label="Pagination"
      className={cn(
        'flex flex-col-reverse items-center justify-between gap-3 sm:flex-row',
        className,
      )}
      {...rest}
    >
      <div className="flex items-center gap-3">
        {showSummary && total != null && (
          <p className="text-caption text-muted" aria-live="polite">
            Showing <span className="font-numeric tabular-nums text-default">{from}</span>–
            <span className="font-numeric tabular-nums text-default">{to}</span> of{' '}
            <span className="font-numeric tabular-nums text-default">{total}</span>
          </p>
        )}
        {onPageSizeChange && (
          <label className="flex items-center gap-2 text-caption text-muted">
            <span className="whitespace-nowrap">Rows</span>
            <Select
              size="sm"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              aria-label="Rows per page"
              className="w-[4.5rem]"
              options={pageSizeOptions.map((n) => ({ value: n, label: String(n) }))}
            />
          </label>
        )}
      </div>

      {pages > 1 && (
        <ul className="flex items-center gap-1">
          <li>
            <button
              type="button"
              onClick={() => go(current - 1)}
              disabled={current <= 1}
              aria-label="Go to previous page"
              className={cn(itemBase, 'text-muted hover:bg-surface-sunken hover:text-default')}
            >
              <Chevron direction="left" className="h-4 w-4" />
              <span className="ui-sr-only">Previous</span>
            </button>
          </li>

          {compact ? (
            <li className="px-3 font-numeric text-label-md tabular-nums text-muted">
              Page {current} of {pages}
            </li>
          ) : (
            range.map((item, index) =>
              item === ELLIPSIS ? (
                <li
                  key={`gap-${index}`}
                  aria-hidden="true"
                  className="px-1 text-label-md text-subtle"
                >
                  &hellip;
                </li>
              ) : (
                <li key={item}>
                  <button
                    type="button"
                    onClick={() => go(item)}
                    aria-label={`Go to page ${item}`}
                    aria-current={item === current ? 'page' : undefined}
                    className={cn(
                      itemBase,
                      'font-numeric tabular-nums',
                      item === current
                        ? 'bg-primary-900 text-white dark:bg-primary-600'
                        : 'text-muted hover:bg-surface-sunken hover:text-default',
                    )}
                  >
                    {item}
                  </button>
                </li>
              ),
            )
          )}

          <li>
            <button
              type="button"
              onClick={() => go(current + 1)}
              disabled={current >= pages}
              aria-label="Go to next page"
              className={cn(itemBase, 'text-muted hover:bg-surface-sunken hover:text-default')}
            >
              <span className="ui-sr-only">Next</span>
              <Chevron direction="right" className="h-4 w-4" />
            </button>
          </li>
        </ul>
      )}
    </nav>
  );
}

export default Pagination;
