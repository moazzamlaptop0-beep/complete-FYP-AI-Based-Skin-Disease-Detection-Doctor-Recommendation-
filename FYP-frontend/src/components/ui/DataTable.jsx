import React, { useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import { SkeletonTable } from './Skeleton';
import EmptyState from './EmptyState';
import Pagination from './Pagination';

/**
 * @typedef {object} Column
 * @property {string} key                 Unique key; also the default data accessor.
 * @property {React.ReactNode} header     Column heading.
 * @property {(row: any, index: number) => React.ReactNode} [render] Custom cell renderer.
 * @property {(row: any) => string|number} [accessor] Value used for sorting/`row[key]` override.
 * @property {boolean} [sortable]         Enables click-to-sort on the header.
 * @property {'left'|'center'|'right'} [align='left']
 * @property {string} [width]             CSS width, e.g. '12rem' or '15%'.
 * @property {boolean} [numeric]          Right-aligns and applies tabular numerals.
 * @property {boolean} [hideOnMobile]     Omit from the mobile card fallback.
 * @property {string} [className]         Extra classes for the cell.
 */

function SortIcon({ direction }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className="h-3.5 w-3.5 shrink-0">
      <path
        d="m4.5 6.5 3.5-3 3.5 3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(direction === 'asc' ? 'opacity-100' : 'opacity-30')}
      />
      <path
        d="m4.5 9.5 3.5 3 3.5-3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn(direction === 'desc' ? 'opacity-100' : 'opacity-30')}
      />
    </svg>
  );
}

const ALIGN = { left: 'text-left', center: 'text-center', right: 'text-right' };

function valueOf(row, column) {
  if (typeof column.accessor === 'function') return column.accessor(row);
  return row?.[column.key];
}

/**
 * Tabular data with a built-in mobile card fallback.
 *
 * The mobile fallback is the point of this component. Below `md` the `<table>`
 * is replaced by a stack of label/value cards, so patient history and the
 * doctor queue stop forcing a horizontal scroll on a phone — currently the
 * single worst responsive failure in the app. Pass `mobileCard` to render your
 * own card, or let the default label/value list handle it.
 *
 * Semantics: a real `<table>` with `<caption>`, `<th scope="col">` and
 * `aria-sort` on the active sort column, so screen readers can navigate by
 * row/column. Sortable headers are `<button>`s inside the `<th>`, never a
 * click handler on the `<th>` itself (which no keyboard can reach).
 *
 * Sorting/pagination are UNCONTROLLED by default but become controlled the
 * moment you pass `sort`/`page` — so a server-side table just wires the
 * callbacks and keeps its own state.
 *
 * @param {object} props
 * @param {Column[]} props.columns
 * @param {any[]} props.data
 * @param {(row: any, index: number) => string|number} [props.rowKey] Defaults to `row.id ?? index`.
 * @param {React.ReactNode} [props.caption] Table caption; visually hidden but announced.
 * @param {boolean} [props.loading=false] Renders skeleton rows.
 * @param {number} [props.loadingRows=5]
 * @param {React.ReactNode} [props.empty] Custom empty state.
 * @param {string} [props.emptyTitle='Nothing to show']
 * @param {string} [props.emptyDescription]
 * @param {(row: any, index: number) => void} [props.onRowClick] Makes rows activatable (click + Enter/Space).
 * @param {(row: any, index: number) => React.ReactNode} [props.mobileCard] Custom mobile renderer.
 * @param {boolean} [props.stickyHeader=false]
 * @param {'default'|'compact'} [props.density='default']
 * @param {boolean} [props.zebra=false] Alternating row tint.
 * @param {{key: string, direction: 'asc'|'desc'}|null} [props.sort] Controlled sort.
 * @param {(sort: {key: string, direction: 'asc'|'desc'}|null) => void} [props.onSortChange]
 * @param {object} [props.pagination] Props forwarded to `<Pagination>`; omit to hide it.
 * @param {string} [props.className]
 */
export function DataTable({
  columns = [],
  data = [],
  rowKey,
  caption,
  loading = false,
  loadingRows = 5,
  empty,
  emptyTitle = 'Nothing to show',
  emptyDescription,
  onRowClick,
  mobileCard,
  stickyHeader = false,
  density = 'default',
  zebra = false,
  sort,
  onSortChange,
  pagination,
  className,
  ...rest
}) {
  const [internalSort, setInternalSort] = useState(null);
  const controlledSort = sort !== undefined;
  const activeSort = controlledSort ? sort : internalSort;

  const rows = useMemo(() => {
    // Controlled sorting means the caller (or the server) already ordered the
    // data — re-sorting here would fight them.
    if (controlledSort || !activeSort) return data;
    const column = columns.find((c) => c.key === activeSort.key);
    if (!column) return data;

    const factor = activeSort.direction === 'asc' ? 1 : -1;
    return [...data].sort((a, b) => {
      const av = valueOf(a, column);
      const bv = valueOf(b, column);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls always last, regardless of direction
      if (bv == null) return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * factor;
    });
  }, [data, columns, activeSort, controlledSort]);

  const toggleSort = (key) => {
    const next =
      activeSort?.key !== key
        ? { key, direction: 'asc' }
        : activeSort.direction === 'asc'
          ? { key, direction: 'desc' }
          : null; // third click clears the sort
    if (!controlledSort) setInternalSort(next);
    onSortChange?.(next);
  };

  const cellPad = density === 'compact' ? 'px-3 py-2' : 'px-4 py-3';
  const keyFor = (row, index) => (rowKey ? rowKey(row, index) : (row?.id ?? index));

  if (loading) {
    return (
      <div className={cn('w-full rounded-card border border-subtle bg-surface p-4', className)}>
        <SkeletonTable rows={loadingRows} columns={columns.length || 4} />
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className={cn('w-full rounded-card border border-subtle bg-surface', className)}>
        {empty ?? <EmptyState title={emptyTitle} description={emptyDescription} />}
      </div>
    );
  }

  const activate = (row, index) => onRowClick?.(row, index);

  return (
    <div className={cn('w-full', className)} {...rest}>
      {/* ---------------- desktop: real table ---------------- */}
      <div
        className={cn(
          'ui-scrollbar hidden overflow-x-auto rounded-card border border-subtle bg-surface md:block',
        )}
      >
        <table className="w-full border-collapse text-left">
          {caption && <caption className="ui-sr-only">{caption}</caption>}
          <thead
            className={cn(
              'bg-surface-sunken',
              stickyHeader && 'sticky top-0 z-raised shadow-[0_1px_0_0_rgb(var(--color-line))]',
            )}
          >
            <tr>
              {columns.map((column) => {
                const isSorted = activeSort?.key === column.key;
                const align = column.numeric ? 'right' : (column.align ?? 'left');
                return (
                  <th
                    key={column.key}
                    scope="col"
                    style={column.width ? { width: column.width } : undefined}
                    aria-sort={
                      column.sortable
                        ? isSorted
                          ? activeSort.direction === 'asc'
                            ? 'ascending'
                            : 'descending'
                          : 'none'
                        : undefined
                    }
                    className={cn(
                      cellPad,
                      'whitespace-nowrap font-body text-label-sm uppercase tracking-[0.04em] text-muted',
                      ALIGN[align],
                    )}
                  >
                    {column.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-control outline-none',
                          'transition-colors hover:text-default',
                          'focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
                          'focus-visible:ring-offset-canvas',
                          isSorted && 'text-default',
                          align === 'right' && 'flex-row-reverse',
                        )}
                      >
                        {column.header}
                        <SortIcon direction={isSorted ? activeSort.direction : null} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={keyFor(row, index)}
                onClick={onRowClick ? () => activate(row, index) : undefined}
                onKeyDown={
                  onRowClick
                    ? (event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          activate(row, index);
                        }
                      }
                    : undefined
                }
                tabIndex={onRowClick ? 0 : undefined}
                role={onRowClick ? 'button' : undefined}
                className={cn(
                  'border-t border-subtle transition-colors',
                  zebra && index % 2 === 1 && 'bg-surface-sunken/50',
                  onRowClick &&
                    'cursor-pointer outline-none hover:bg-primary-50/60 focus-visible:bg-primary-50/60 ' +
                      'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
                )}
              >
                {columns.map((column) => {
                  const align = column.numeric ? 'right' : (column.align ?? 'left');
                  return (
                    <td
                      key={column.key}
                      className={cn(
                        cellPad,
                        'align-middle font-body text-body-sm text-default',
                        column.numeric && 'font-numeric tabular-nums',
                        ALIGN[align],
                        column.className,
                      )}
                    >
                      {column.render ? column.render(row, index) : valueOf(row, column)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------------- mobile: card fallback ---------------- */}
      <div className="flex flex-col gap-3 md:hidden">
        {rows.map((row, index) => {
          if (mobileCard) {
            return (
              <React.Fragment key={keyFor(row, index)}>{mobileCard(row, index)}</React.Fragment>
            );
          }
          const visible = columns.filter((c) => !c.hideOnMobile);
          const [primary, ...restCols] = visible;
          const Wrapper = onRowClick ? 'button' : 'div';

          return (
            <Wrapper
              key={keyFor(row, index)}
              type={onRowClick ? 'button' : undefined}
              onClick={onRowClick ? () => activate(row, index) : undefined}
              className={cn(
                'w-full rounded-card border border-subtle bg-surface p-4 text-left',
                onRowClick &&
                  'transition-colors outline-none hover:border-default focus-visible:ring-2 ' +
                    'focus-visible:ring-focus focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
              )}
            >
              {primary && (
                <div className="mb-3 font-body text-label-lg text-default">
                  {primary.render ? primary.render(row, index) : valueOf(row, primary)}
                </div>
              )}
              <dl className="grid grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2">
                {restCols.map((column) => (
                  <React.Fragment key={column.key}>
                    <dt className="text-caption uppercase tracking-[0.04em] text-subtle">
                      {column.header}
                    </dt>
                    <dd
                      className={cn(
                        'text-right text-body-sm text-default',
                        column.numeric && 'font-numeric tabular-nums',
                      )}
                    >
                      {column.render ? column.render(row, index) : valueOf(row, column)}
                    </dd>
                  </React.Fragment>
                ))}
              </dl>
            </Wrapper>
          );
        })}
      </div>

      {pagination && <Pagination className="mt-4" {...pagination} />}
    </div>
  );
}

export default DataTable;
