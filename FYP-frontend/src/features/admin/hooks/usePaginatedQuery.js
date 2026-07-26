/**
 * usePaginatedQuery — the ONE data hook behind every admin list page.
 *
 * WHY IT EXISTS
 * -------------
 * Five of the six admin pages read a `/admin/*` list route. All five need the
 * same seven things: page state, per-page state, a filter object that resets the
 * page when it changes, a loading flag, an error, a refetch, and protection
 * against a slow response for page 2 landing after the user already moved to
 * page 3. Writing that five times is how four of them end up subtly different.
 *
 * TWO RESPONSE SHAPES, ONE HOOK
 * -----------------------------
 * The phase-2A console routes answer the page envelope:
 *
 *     data: { items, page, per_page, total, has_more }
 *
 * but `/admin/doctors` — one of the frozen 39 — answers a BARE ARRAY, on
 * purpose, and is never changing. Rather than fork the hook, `normalizePage()`
 * accepts either: an array becomes a single full page whose `total` is its
 * length. `DoctorsPage` therefore uses the same hook as everyone else and
 * simply gets `serverPaginated: false` back, which is what it uses to decide
 * whether to filter client-side.
 *
 * RACE SAFETY
 * -----------
 * Every fetch carries a monotonic request id AND an AbortController. A response
 * whose id is stale is dropped instead of overwriting fresher state, and the
 * in-flight request is aborted on unmount so React never sets state on a dead
 * component.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, get } from '../../../lib/api';

/** Backend default; also its clamp floor for anything unparseable. */
export const DEFAULT_PER_PAGE = 20;
/** The backend silently clamps above this. */
export const MAX_PER_PAGE = 100;

export const PER_PAGE_OPTIONS = [10, 20, 50, 100];

/**
 * Coerce either supported response shape into one page descriptor.
 * @param {any} payload
 * @param {number} requestedPage
 * @param {number} requestedPerPage
 */
export function normalizePage(payload, requestedPage, requestedPerPage) {
  // `/admin/doctors` and friends: a bare array is the whole result set.
  if (Array.isArray(payload)) {
    return {
      items: payload,
      page: 1,
      perPage: payload.length || requestedPerPage,
      total: payload.length,
      hasMore: false,
      serverPaginated: false,
    };
  }

  if (payload && typeof payload === 'object' && Array.isArray(payload.items)) {
    const perPage = Number(payload.per_page) || requestedPerPage;
    const total = Number.isFinite(Number(payload.total)) ? Number(payload.total) : payload.items.length;
    return {
      items: payload.items,
      page: Number(payload.page) || requestedPage,
      perPage,
      total,
      hasMore: typeof payload.has_more === 'boolean'
        ? payload.has_more
        : requestedPage * perPage < total,
      serverPaginated: true,
    };
  }

  // A 200 with nothing usable in it. An empty list is the honest reading.
  return {
    items: [],
    page: requestedPage,
    perPage: requestedPerPage,
    total: 0,
    hasMore: false,
    serverPaginated: false,
  };
}

/** Stable dependency key for a plain filter object (order-insensitive). */
function filterKey(filters) {
  if (!filters || typeof filters !== 'object') return '';
  return JSON.stringify(
    Object.keys(filters)
      .sort()
      .reduce((acc, key) => {
        const value = filters[key];
        if (value === null || value === undefined || value === '') return acc;
        acc[key] = value;
        return acc;
      }, {}),
  );
}

/**
 * @param {object} config
 * @param {(params: object) => string} config.path  An `endpoints.admin.*` builder.
 * @param {object} [config.filters]     Filter values; `''`/null are dropped by `qs()`.
 * @param {number} [config.perPage=20]
 * @param {boolean} [config.enabled=true] Skip fetching entirely (e.g. while impersonating).
 * @param {boolean} [config.paginate=true] Send `page`/`per_page` at all.
 * @returns {{
 *   items: any[], page: number, perPage: number, total: number, hasMore: boolean,
 *   pageCount: number, serverPaginated: boolean,
 *   loading: boolean, refreshing: boolean, error: Error|null, loaded: boolean,
 *   setPage: (page:number)=>void, setPerPage: (size:number)=>void,
 *   refetch: () => void, patchItem: (id:any, patch:object)=>void, removeItem: (id:any)=>void
 * }}
 */
export function usePaginatedQuery({
  path,
  filters,
  queryKey = '',
  perPage: initialPerPage = DEFAULT_PER_PAGE,
  enabled = true,
  paginate = true,
}) {
  const [page, setPageState] = useState(1);
  const [perPage, setPerPageState] = useState(initialPerPage);
  const [state, setState] = useState({
    items: [],
    total: 0,
    hasMore: false,
    serverPaginated: paginate,
    loading: enabled,
    error: null,
    loaded: false,
  });

  // `queryKey` is how a page that swaps ENDPOINT without changing its filters
  // (Patients ⇄ All users) still triggers a refetch: `path` is read through a
  // ref, so it cannot be an effect dependency on its own.
  const paramKey = filterKey(filters);
  const key = `${queryKey}|${paramKey}`;
  const requestId = useRef(0);
  const abortRef = useRef(null);
  const mounted = useRef(true);
  const [nonce, setNonce] = useState(0);

  // A filter change invalidates the current offset: page 4 of a 3-page result
  // is an empty screen that looks like "no data" rather than "bad page".
  const previousKey = useRef(key);
  useEffect(() => {
    if (previousKey.current !== key) {
      previousKey.current = key;
      setPageState(1);
    }
  }, [key]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const pathRef = useRef(path);
  pathRef.current = path;

  useEffect(() => {
    if (!enabled) {
      setState((prev) => ({ ...prev, loading: false }));
      return undefined;
    }

    const id = requestId.current + 1;
    requestId.current = id;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    const params = {
      ...(paramKey ? JSON.parse(paramKey) : {}),
      ...(paginate ? { page, per_page: perPage } : {}),
    };

    get(pathRef.current(params), { signal: controller.signal, timeoutMs: 20_000 })
      .then((payload) => {
        if (!mounted.current || requestId.current !== id) return;
        const normalized = normalizePage(payload, page, perPage);
        setState({
          items: normalized.items,
          total: normalized.total,
          hasMore: normalized.hasMore,
          serverPaginated: normalized.serverPaginated,
          loading: false,
          error: null,
          loaded: true,
        });
      })
      .catch((error) => {
        if (!mounted.current || requestId.current !== id) return;
        // An abort is us superseding ourselves, not a failure to report.
        if (error?.name === 'AbortError') return;
        setState((prev) => ({
          ...prev,
          items: [],
          total: 0,
          hasMore: false,
          loading: false,
          loaded: true,
          error: error instanceof Error ? error : new ApiError(0, String(error)),
        }));
      });

    return () => controller.abort();
  }, [key, paramKey, page, perPage, enabled, paginate, nonce]);

  const setPage = useCallback((next) => {
    setPageState((current) => {
      const value = Math.max(1, Math.floor(Number(next) || 1));
      return value === current ? current : value;
    });
  }, []);

  const setPerPage = useCallback((next) => {
    const value = Math.min(MAX_PER_PAGE, Math.max(1, Math.floor(Number(next) || DEFAULT_PER_PAGE)));
    setPerPageState(value);
    setPageState(1);
  }, []);

  const refetch = useCallback(() => setNonce((n) => n + 1), []);

  /** Optimistically fold a mutation result into the loaded page. */
  const patchItem = useCallback((id, patch) => {
    setState((prev) => ({
      ...prev,
      items: prev.items.map((item) => (item?.id === id ? { ...item, ...patch } : item)),
    }));
  }, []);

  const removeItem = useCallback((id) => {
    setState((prev) => ({
      ...prev,
      items: prev.items.filter((item) => item?.id !== id),
      total: Math.max(0, prev.total - 1),
    }));
  }, []);

  const pageCount = useMemo(() => {
    if (!state.serverPaginated) return 1;
    return Math.max(1, Math.ceil((state.total || 0) / (perPage || DEFAULT_PER_PAGE)));
  }, [state.serverPaginated, state.total, perPage]);

  return {
    ...state,
    page,
    perPage,
    pageCount,
    // "loading" is the first paint; "refreshing" is a page/filter change over
    // data that is already on screen, which must not blank the table.
    loading: state.loading && !state.loaded,
    refreshing: state.loading && state.loaded,
    setPage,
    setPerPage,
    refetch,
    patchItem,
    removeItem,
  };
}

export default usePaginatedQuery;
