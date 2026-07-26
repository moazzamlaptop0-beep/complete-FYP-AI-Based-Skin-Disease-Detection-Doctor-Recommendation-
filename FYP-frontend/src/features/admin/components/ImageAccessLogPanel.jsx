/**
 * ImageAccessLogPanel — who has actually seen this person's skin.
 *
 * `GET /api/scans/<id>/access-log` returns the `image_access_log` rows for one
 * scan. The important detail, and the reason this panel says so out loud: only
 * `variant=full` views are recorded. A doctor who opened the case list and saw
 * a blurred thumbnail is NOT in here; a doctor who deliberately asked for the
 * full-resolution photo is. That makes the list answerable — "three people have
 * seen this photo" — instead of a page-view counter nobody can interpret.
 *
 * The panel is read-only on purpose. There is no "revoke" here because there is
 * nothing to revoke: the only lever is the patient's own image deletion, and
 * that lives on their surface.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Eye, EyeOff, RefreshCw, ShieldCheck } from 'lucide-react';

import {
  Alert,
  Badge,
  Button,
  EmptyState,
  RoleBadge,
  Skeleton,
  cn,
} from '../../../components/ui';
import { get } from '../../../lib/api';
import { scans as scanEndpoints } from '../../../lib/endpoints';
import { formatDateTime, formatRelativeTime } from '../../../lib/format';

const VARIANT_TONE = {
  full: 'danger',
  blur: 'warning',
  thumb: 'neutral',
};

/**
 * @param {object} props
 * @param {number|string} props.scanId
 * @param {boolean} [props.enabled=true] Skip the fetch (panel not visible yet).
 */
export function ImageAccessLogPanel({ scanId, enabled = true, className }) {
  const [state, setState] = useState({ rows: [], loading: true, error: null });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!enabled || !scanId) return undefined;

    let alive = true;
    const controller = new AbortController();
    setState((prev) => ({ ...prev, loading: true, error: null }));

    get(scanEndpoints.accessLog(scanId), { signal: controller.signal, timeoutMs: 15_000 })
      .then((data) => {
        if (!alive) return;
        setState({ rows: Array.isArray(data) ? data : [], loading: false, error: null });
      })
      .catch((error) => {
        if (!alive || error?.name === 'AbortError') return;
        setState({ rows: [], loading: false, error });
      });

    return () => {
      alive = false;
      controller.abort();
    };
  }, [scanId, enabled, nonce]);

  if (!enabled) return null;

  return (
    <section className={cn('flex flex-col gap-3', className)} aria-labelledby={`access-log-${scanId}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3
            id={`access-log-${scanId}`}
            className="flex items-center gap-2 text-heading-sm font-semibold text-neutral-900 dark:text-neutral-100"
          >
            <ShieldCheck className="h-4 w-4 text-primary-600 dark:text-primary-400" aria-hidden="true" />
            Image access log
          </h3>
          <p className="mt-0.5 text-caption text-muted">
            Full-resolution views only. Blurred and thumbnail previews are deliberately not recorded.
          </p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={reload}
          leftIcon={<RefreshCw className={cn('h-4 w-4', state.loading && 'animate-spin')} aria-hidden="true" />}
        >
          Refresh
        </Button>
      </div>

      {state.error ? (
        <Alert tone="danger" title="Could not load the access log">
          {state.error.message}
        </Alert>
      ) : state.loading ? (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading access log">
          {[0, 1, 2].map((i) => <Skeleton key={i} shape="rect" height={56} />)}
        </div>
      ) : state.rows.length === 0 ? (
        <EmptyState
          icon={<EyeOff className="h-6 w-6" aria-hidden="true" />}
          title="Nobody has opened the full photo"
          description="No full-resolution view has been recorded for this scan."
          size="sm"
          bordered
        />
      ) : (
        <ol className="flex flex-col gap-2">
          {state.rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-subtle bg-surface p-3"
            >
              <Eye className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5">
                  <span className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                    {row.viewer_name || `User #${row.viewer_id}`}
                  </span>
                  {row.viewer_role ? <RoleBadge role={row.viewer_role} size="sm" /> : null}
                  <Badge tone={VARIANT_TONE[row.variant] || 'neutral'} size="sm" variant="outline">
                    {row.variant || 'full'}
                  </Badge>
                  {row.attachment_id ? (
                    <Badge tone="neutral" size="sm" variant="outline">
                      attachment #{row.attachment_id}
                    </Badge>
                  ) : null}
                </p>
                <p className="text-caption text-muted">
                  {formatDateTime(row.viewed_at)}
                  {row.ip ? <span className="ml-2 font-mono">{row.ip}</span> : null}
                </p>
              </div>
              <span className="shrink-0 whitespace-nowrap text-caption text-muted">
                {formatRelativeTime(row.viewed_at)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export default ImageAccessLogPanel;
