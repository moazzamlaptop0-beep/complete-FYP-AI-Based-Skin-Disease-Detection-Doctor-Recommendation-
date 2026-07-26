/**
 * useDoctorQuery — the one data-fetching primitive the doctor surface uses.
 *
 * WHY NOT A LIBRARY
 * -----------------
 * The project has no react-query and adding one for six screens is not worth
 * the bundle. What every doctor page actually needs is small and identical:
 * loading / data / error, a manual refresh, cancellation on unmount, and a way
 * for a live update to trigger a quiet re-fetch that does NOT flash a skeleton
 * over a screen the doctor is reading.
 *
 * `silent` is the whole point of the second state field. A referral queue that
 * blanks itself every time an SSE tick arrives is unusable.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError } from '../../../lib/api';

/**
 * @template T
 * @param {(signal: AbortSignal) => Promise<T>} fetcher Stable across renders —
 *   wrap it in useCallback, its identity is the re-fetch trigger.
 * @param {object} [options]
 * @param {boolean} [options.enabled=true] Skip the call entirely (missing id).
 * @param {T} [options.initialData=null]
 * @returns {{data:T|null, error:Error|null, loading:boolean, refreshing:boolean,
 *   refresh:(opts?:{silent?:boolean})=>Promise<void>, setData:Function}}
 */
export default function useDoctorQuery(fetcher, { enabled = true, initialData = null } = {}) {
  const [data, setData] = useState(initialData);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [refreshing, setRefreshing] = useState(false);

  const mounted = useRef(true);
  const controller = useRef(null);
  /** Bumped on every run so a slow first response cannot overwrite a fast second. */
  const runId = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      controller.current?.abort();
    };
  }, []);

  const run = useCallback(async ({ silent = false } = {}) => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    const id = runId.current + 1;
    runId.current = id;

    if (silent) setRefreshing(true);
    else setLoading(true);

    try {
      const result = await fetcher(next.signal);
      if (!mounted.current || runId.current !== id) return;
      setData(result);
      setError(null);
    } catch (caught) {
      if (!mounted.current || runId.current !== id) return;
      // An abort is us, not a failure — never surface it.
      if (caught?.name === 'AbortError' || (caught instanceof ApiError && caught.status === 0 && next.signal.aborted)) {
        return;
      }
      setError(caught);
    } finally {
      if (mounted.current && runId.current === id) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [enabled, fetcher]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    run();
  }, [enabled, run]);

  const refresh = useCallback((opts) => run({ silent: true, ...opts }), [run]);

  return { data, error, loading, refreshing, refresh, setData };
}

export { useDoctorQuery };
