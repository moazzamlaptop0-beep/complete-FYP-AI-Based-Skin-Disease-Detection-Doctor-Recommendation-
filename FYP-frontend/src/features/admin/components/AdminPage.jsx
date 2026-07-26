/**
 * The shared chrome for the six admin pages.
 *
 * DashboardLayout already owns the sidebar, the rail and the mobile tab bar, so
 * nothing here draws navigation. What it does draw is the part every admin page
 * repeats: a titled header with a right-hand action slot, a filter row that
 * collapses to a single column on a phone, and a table block that knows the
 * three states a data view can be in (loading / error / empty) so that no page
 * has to remember all three.
 */

import React from 'react';
import { RefreshCw } from 'lucide-react';

import { Alert, Button, DataTable, cn } from '../../../components/ui';

/**
 * @param {object} props
 * @param {React.ReactNode} props.title
 * @param {React.ReactNode} [props.description]
 * @param {React.ReactNode} [props.actions] Right-aligned controls.
 * @param {React.ReactNode} [props.banner] Full-width notice under the header.
 * @param {boolean} [props.paused=false] Hide the body and show only the banner.
 *   Used while impersonating: the queries are disabled, so an empty table would
 *   read as "there is no data" when the truth is "you are not allowed to ask".
 * @param {React.ReactNode} props.children
 */
export function AdminPage({ title, description, actions, banner, paused = false, children, className }) {
  return (
    <div className={cn('flex flex-col gap-5', className)}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-heading-md font-semibold text-neutral-900 dark:text-neutral-50">
            {title}
          </h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-body-sm text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </header>

      {banner}
      {paused ? null : children}
    </div>
  );
}

/**
 * A responsive filter row. Children are the controls; each should be wrapped in
 * whatever width class it wants, and the row wraps rather than scrolls so a
 * 375px viewport gets one control per line instead of a hidden overflow.
 */
export function FilterBar({ children, onReset, resetDisabled, busy, onRefresh, className }) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-lg border border-subtle bg-surface p-3 sm:flex-row sm:flex-wrap sm:items-end',
        className,
      )}
    >
      {children}
      {(onReset || onRefresh) ? (
        <div className="flex items-center gap-2 sm:ml-auto">
          {onReset ? (
            <Button variant="ghost" size="sm" onClick={onReset} disabled={resetDisabled}>
              Clear filters
            </Button>
          ) : null}
          {onRefresh ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              leftIcon={<RefreshCw className={cn('h-4 w-4', busy && 'animate-spin')} aria-hidden="true" />}
            >
              Refresh
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * A segmented filter — the "Pending / Approved / All" style switch.
 *
 * Deliberately NOT the Tabs primitive: these switch a query, not a panel, so
 * the ARIA tab pattern (with its owned tabpanel and roving tabindex) would be
 * a lie. This is a labelled group of toggle buttons, which is what it is.
 *
 * @param {object} props
 * @param {Array<{value:string,label:string,count?:number}>} props.options
 * @param {string} props.value
 * @param {(value:string)=>void} props.onChange
 * @param {string} props.label Accessible group name.
 */
export function SegmentedFilter({ options, value, onChange, label, className }) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-1.5', className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value || 'all'}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-body-sm transition',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-1 focus-visible:ring-offset-canvas',
              active
                ? 'border-primary-400 bg-primary-50 font-medium text-primary-800 dark:border-primary-700 dark:bg-primary-900/40 dark:text-primary-200'
                : 'border-subtle bg-surface text-muted hover:text-neutral-800 dark:hover:text-neutral-200',
            )}
          >
            {option.label}
            {typeof option.count === 'number' ? (
              <span className="tabular-nums opacity-70">({option.count})</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The table block for a `usePaginatedQuery` result.
 *
 * Errors take over the whole block rather than sitting above a stale table: an
 * admin acting on rows they think are current, after the refresh that produced
 * them failed, is exactly the kind of mistake an audit log records forever.
 *
 * @param {object} props
 * @param {ReturnType<import('../hooks/usePaginatedQuery').usePaginatedQuery>} props.query
 * @param {Array<object>} props.columns
 * @param {Array<object>} [props.rows] Override `query.items` (client-side filtering).
 */
export function AdminTable({
  query,
  columns,
  rows,
  caption,
  emptyTitle = 'Nothing to show',
  emptyDescription,
  empty,
  onRowClick,
  mobileCard,
  rowKey,
  density = 'default',
  pagination,
  className,
}) {
  const data = rows ?? query.items;

  if (query.error) {
    return (
      <Alert
        tone="danger"
        title="Could not load this list"
        actions={
          <Button size="sm" variant="outline" onClick={query.refetch}>
            Try again
          </Button>
        }
      >
        {query.error.message || 'The server did not answer. Check that the backend is running.'}
      </Alert>
    );
  }

  // No <Card> wrapper: DataTable already draws its own rounded, bordered
  // surface (and its own for the empty state), so nesting one inside a Card
  // produces a visible double border.
  const paginationProps = pagination !== undefined
    ? pagination
    : (query.serverPaginated && (query.total > query.perPage || query.page > 1))
      ? {
        page: query.page,
        pageSize: query.perPage,
        total: query.total,
        onPageChange: query.setPage,
        onPageSizeChange: query.setPerPage,
        pageSizeOptions: [10, 20, 50, 100],
      }
      : undefined;

  return (
    <DataTable
      columns={columns}
      data={data}
      rowKey={rowKey}
      caption={caption}
      loading={query.loading}
      loadingRows={6}
      density={density}
      stickyHeader
      onRowClick={onRowClick}
      mobileCard={mobileCard}
      empty={empty}
      emptyTitle={emptyTitle}
      emptyDescription={emptyDescription}
      className={cn('transition-opacity', query.refreshing && 'opacity-60', className)}
      pagination={paginationProps}
    />
  );
}

/** A dense "label above value" cell, used everywhere a table row needs two lines. */
export function StackCell({ primary, secondary, className }) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="truncate font-medium text-neutral-900 dark:text-neutral-100">{primary}</div>
      {secondary ? <div className="truncate text-caption text-muted">{secondary}</div> : null}
    </div>
  );
}

export default AdminPage;
