import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';

const SHAPES = {
  text: 'rounded-md',
  circle: 'rounded-pill',
  rect: 'rounded-field',
  card: 'rounded-card',
};

/**
 * Loading placeholder.
 *
 * Accessibility: skeletons are decorative and MUST NOT be announced — a screen
 * reader reading fifteen empty boxes is worse than silence. Each block is
 * `aria-hidden`; announce loading ONCE at the region level instead, e.g.
 * `<div role="status" aria-busy="true"><span class="ui-sr-only">Loading
 * scans</span>{skeletons}</div>`. `<SkeletonGroup>` does exactly that for you.
 *
 * @param {object} props
 * @param {'text'|'circle'|'rect'|'card'} [props.shape='text']
 * @param {string|number} [props.width] CSS width (e.g. '60%', 240).
 * @param {string|number} [props.height] CSS height. Defaults per shape.
 * @param {'pulse'|'sweep'|'none'} [props.animation='pulse'] `sweep` adds a shimmer pass.
 * @param {string} [props.className]
 */
const Skeleton = forwardRef(function Skeleton(
  { shape = 'text', width, height, animation = 'pulse', className, style, ...rest },
  ref,
) {
  return (
    <span
      ref={ref}
      aria-hidden="true"
      data-ui-skeleton=""
      className={cn(
        'relative block overflow-hidden bg-neutral-200',
        shape === 'text' && 'h-4 w-full',
        shape === 'circle' && 'h-10 w-10 shrink-0',
        shape === 'rect' && 'h-10 w-full',
        shape === 'card' && 'h-32 w-full',
        animation === 'pulse' && 'animate-ui-shimmer',
        animation === 'sweep' && 'ui-skeleton-sweep',
        SHAPES[shape] ?? SHAPES.text,
        className,
      )}
      style={{ width, height, ...style }}
      {...rest}
    />
  );
});

/**
 * Wraps skeletons in a single polite live region so AT announces the load once
 * and then announces the real content when it arrives.
 *
 * @param {object} props
 * @param {boolean} [props.loading=true]
 * @param {string} [props.label='Loading'] Announced text.
 * @param {React.ReactNode} [props.children] The skeletons.
 * @param {string} [props.className]
 */
export function SkeletonGroup({ loading = true, label = 'Loading', children, className, ...rest }) {
  return (
    <div
      role="status"
      aria-busy={loading || undefined}
      aria-live="polite"
      className={cn('w-full', className)}
      {...rest}
    >
      <span className="ui-sr-only">{loading ? label : 'Loaded'}</span>
      {children}
    </div>
  );
}

/**
 * Several text lines with a shortened last line, which reads as a paragraph
 * rather than a stack of identical bars.
 *
 * @param {object} props
 * @param {number} [props.lines=3]
 * @param {string} [props.lastLineWidth='65%']
 * @param {string} [props.className]
 */
export function SkeletonText({ lines = 3, lastLineWidth = '65%', className, ...rest }) {
  return (
    <div className={cn('flex w-full flex-col gap-2', className)} {...rest}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          shape="text"
          width={i === lines - 1 && lines > 1 ? lastLineWidth : '100%'}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton shaped like a `<Card>` with an avatar, title and body lines.
 *
 * @param {object} props
 * @param {boolean} [props.avatar=true]
 * @param {number} [props.lines=2]
 * @param {string} [props.className]
 */
export function SkeletonCard({ avatar = true, lines = 2, className, ...rest }) {
  return (
    <div
      className={cn('rounded-card border border-subtle bg-surface p-5', className)}
      {...rest}
    >
      <div className="flex items-center gap-3">
        {avatar && <Skeleton shape="circle" />}
        <div className="flex-1 space-y-2">
          <Skeleton width="45%" height={14} />
          <Skeleton width="30%" height={10} />
        </div>
      </div>
      {lines > 0 && (
        <div className="mt-4">
          <SkeletonText lines={lines} />
        </div>
      )}
    </div>
  );
}

/**
 * Placeholder rows matching `<DataTable>`'s grid.
 *
 * @param {object} props
 * @param {number} [props.rows=5]
 * @param {number} [props.columns=4]
 * @param {string} [props.className]
 */
export function SkeletonTable({ rows = 5, columns = 4, className, ...rest }) {
  return (
    <div className={cn('w-full space-y-3', className)} {...rest}>
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className="flex items-center gap-4">
          {Array.from({ length: columns }, (_, c) => (
            <Skeleton
              key={c}
              height={12}
              className={cn('flex-1', c === 0 && 'max-w-[8rem]')}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export { Skeleton };
export default Skeleton;
