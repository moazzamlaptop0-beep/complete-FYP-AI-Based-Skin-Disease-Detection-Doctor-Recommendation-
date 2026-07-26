/**
 * useDoctorDirectory — load `/api/doctors/public` once, then filter/sort it in
 * memory.
 *
 * WHY IN MEMORY
 * -------------
 * The directory endpoint takes no query parameters at all — it returns every
 * approved and pending doctor in one array. Filtering therefore has to happen on
 * the client, and doing it here (rather than inside the step component) keeps
 * StepDoctors free of `useMemo` chains and lets the list view and the map view
 * share ONE derived array. If they each filtered independently, a doctor could
 * be visible on the map and absent from the list, which is precisely the kind of
 * inconsistency that makes a "nearby" feature untrustworthy.
 *
 * GEOLOCATION IS OPT-IN AND NEVER BLOCKING
 * ----------------------------------------
 * The permission prompt fires only when the patient presses "Use my location".
 * Asking on mount is a dark pattern, and — more practically — a browser that has
 * already been denied never resolves, so a mount-time request would leave the
 * list spinning for a permission that will never arrive. Without a position the
 * list still works; it just sorts by rating instead of distance and the radius
 * filter stays disabled.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, get } from '../../../lib/api';
import { doctors as doctorEndpoints } from '../../../lib/endpoints';
import {
  emptyFilters,
  filterDoctors,
  normalizeDoctors,
  sortDoctors,
  uniqueValues,
  withDistances,
} from '../lib/doctorModel';

/**
 * The browser's position, requested only on demand.
 * @returns {{position:[number,number]|null, status:string, error:string|null,
 *            request:()=>void, clear:()=>void, supported:boolean}}
 */
export function useGeolocation() {
  const [state, setState] = useState({ position: null, status: 'idle', error: null });
  const mounted = useRef(true);

  // Must re-arm on mount: StrictMode's simulated unmount fires the cleanup, and
  // without this the flag stays false after the remount, so the doctor list
  // loads and is then thrown away -- step 4 of the wizard would sit empty.
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const supported = typeof navigator !== 'undefined' && Boolean(navigator.geolocation);

  const request = useCallback(() => {
    if (!supported) {
      setState({
        position: null,
        status: 'error',
        error: 'This browser cannot share your location.',
      });
      return;
    }
    setState((previous) => ({ ...previous, status: 'loading', error: null }));
    navigator.geolocation.getCurrentPosition(
      (found) => {
        if (!mounted.current) return;
        setState({
          position: [found.coords.latitude, found.coords.longitude],
          status: 'success',
          error: null,
        });
      },
      (error) => {
        if (!mounted.current) return;
        setState({
          position: null,
          status: 'error',
          error: error?.code === 1
            ? 'Location permission was declined. You can still search by city.'
            : 'We could not read your location. You can still search by city.',
        });
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 300_000 },
    );
  }, [supported]);

  const clear = useCallback(() => {
    setState({ position: null, status: 'idle', error: null });
  }, []);

  return { ...state, request, clear, supported };
}

/**
 * @param {object} [options]
 * @param {boolean} [options.enabled=true] Skip the fetch entirely (anonymous
 *   visitors see the sign-in gate instead of the directory, and firing a request
 *   they will never see is just noise in the network tab).
 */
export function useDoctorDirectory({ enabled = true } = {}) {
  const [rows, setRows] = useState([]);
  const [status, setStatus] = useState(enabled ? 'loading' : 'idle');
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(emptyFilters);
  const [sortBy, setSortBy] = useState('rating');
  /** True once the user has explicitly chosen a sort, so we stop auto-switching. */
  const sortTouched = useRef(false);

  const mounted = useRef(true);
  const abortRef = useRef(null);
  // Re-arm on mount: StrictMode's simulated unmount fires this cleanup, and a
  // flag left false means the doctor list arrives and is discarded, leaving
  // step 4 of the wizard permanently empty.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const geo = useGeolocation();

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    setError(null);
    try {
      const data = await get(doctorEndpoints.publicList(), { signal: controller.signal });
      if (!mounted.current) return;
      setRows(normalizeDoctors(data));
      setStatus('success');
    } catch (caught) {
      if (caught?.name === 'AbortError' || !mounted.current) return;
      setError(caught instanceof ApiError
        ? caught.message
        : 'We could not load the doctor list. Check your connection and try again.');
      setStatus('error');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    load();
  }, [enabled, load]);

  /**
   * The first successful position switches the default sort to distance, which
   * is what someone who just pressed "Use my location" is asking for. It stops
   * doing that the moment they pick a sort themselves.
   */
  useEffect(() => {
    if (geo.position && !sortTouched.current) setSortBy('distance');
  }, [geo.position]);

  const chooseSort = useCallback((value) => {
    sortTouched.current = true;
    setSortBy(value);
  }, []);

  const patchFilters = useCallback((patch) => {
    setFilters((previous) => ({ ...previous, ...patch }));
  }, []);

  const resetFilters = useCallback(() => setFilters(emptyFilters()), []);

  const measured = useMemo(() => withDistances(rows, geo.position), [rows, geo.position]);

  const visible = useMemo(
    () => sortDoctors(filterDoctors(measured, filters), sortBy),
    [measured, filters, sortBy],
  );

  const cities = useMemo(() => uniqueValues(rows, 'city'), [rows]);
  const specialties = useMemo(() => uniqueValues(rows, 'specialty'), [rows]);

  return {
    /** Everything the API returned, normalised and distance-stamped. */
    all: measured,
    /** What the current filters and sort actually leave on screen. */
    doctors: visible,
    status,
    error,
    reload: load,

    filters,
    setFilters: patchFilters,
    resetFilters,
    sortBy,
    setSortBy: chooseSort,

    cities,
    specialties,

    geo,
    hasPosition: Boolean(geo.position),
  };
}

export default useDoctorDirectory;
