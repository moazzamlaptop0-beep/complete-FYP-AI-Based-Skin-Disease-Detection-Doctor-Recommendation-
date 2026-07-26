/**
 * usePatientData — the three hooks every patient page shares.
 *
 * `useResource` is the loading/empty/error contract in one place. Each page
 * needs the same four things (data, loading, error, refetch) and the same two
 * disciplines: abort on unmount, and NEVER write state from a response that a
 * newer request has already superseded. Duplicating that per page is how one
 * page ends up without an error state and another flashes stale rows.
 *
 * `refetch()` is deliberately the mutation story too. Rebook and reschedule
 * return a NEW appointment id and leave the old row alive in a different state;
 * patching the row in place would render the same visit twice. Every mutation
 * on these pages therefore ends in `refetch()`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { ApiError, request } from '../../../lib/api';

/**
 * @param {(signal: AbortSignal) => Promise<any>} loader
 * @param {{deps?: any[], enabled?: boolean, initialData?: any}} [options]
 * @returns {{data:any, loading:boolean, error:string|null, status:number|null, refetch:()=>void, setData:Function}}
 */
export function useResource(loader, options = {}) {
  const { deps = [], enabled = true, initialData = null } = options;

  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(Boolean(enabled));
  const [error, setError] = useState(null);
  const [status, setStatus] = useState(null);
  const [nonce, setNonce] = useState(0);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  /** Monotonic request id: only the newest response may write state. */
  const generation = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    generation.current += 1;
    const mine = generation.current;

    setLoading(true);
    setError(null);

    Promise.resolve(loaderRef.current(controller.signal))
      .then((payload) => {
        if (mine !== generation.current) return;
        setData(payload);
        setStatus(200);
        setLoading(false);
      })
      .catch((err) => {
        if (mine !== generation.current || err?.name === 'AbortError') return;
        setError(err instanceof ApiError ? err.message : (err?.message || 'Something went wrong.'));
        setStatus(err instanceof ApiError ? err.status : 0);
        setLoading(false);
      });

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, nonce, ...deps]);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  return { data, loading, error, status, refetch, setData };
}

/**
 * A one-shot mutation with its own busy/error state. Returns the payload so the
 * caller can read a new appointment id out of it.
 * @returns {{run:(path:string, options?:object)=>Promise<any>, busy:boolean, error:string|null, reset:()=>void}}
 */
export function useMutation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(async (path, requestOptions = {}) => {
    setBusy(true);
    setError(null);
    try {
      return await request(path, requestOptions);
    } catch (err) {
      const message = err instanceof ApiError ? err.message : (err?.message || 'Something went wrong.');
      setError(message);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  return { run, busy, error, reset: () => setError(null) };
}

/**
 * A paginated envelope (`{items, page, per_page, total, has_more}`), a bare
 * array, or `{data: [...]}` — normalised to one shape. The backend emits all
 * three across the routes these pages call.
 * @param {any} payload
 * @returns {{items: any[], total: number, page: number, perPage: number, hasMore: boolean}}
 */
export function normalizeList(payload) {
  if (Array.isArray(payload)) {
    return { items: payload, total: payload.length, page: 1, perPage: payload.length, hasMore: false };
  }
  if (payload && typeof payload === 'object') {
    const items = Array.isArray(payload.items)
      ? payload.items
      : Array.isArray(payload.data)
        ? payload.data
        : [];
    return {
      items,
      total: Number.isFinite(payload.total) ? payload.total : items.length,
      page: Number.isFinite(payload.page) ? payload.page : 1,
      perPage: Number.isFinite(payload.per_page) ? payload.per_page : items.length,
      hasMore: Boolean(payload.has_more),
    };
  }
  return { items: [], total: 0, page: 1, perPage: 0, hasMore: false };
}

export default { useResource, useMutation, normalizeList };
