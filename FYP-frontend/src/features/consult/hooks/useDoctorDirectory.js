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
 * GEOLOCATION IS AUTOMATIC HERE, AND NEVER BLOCKING
 * -------------------------------------------------
 * "Which doctors are near me" is the whole question this step answers, so the
 * position is requested for the caller that asks for it (`autoLocate`) rather
 * than waiting for a button press that most people never find. Distances, the
 * nearest-first sort and the radius filter are all dead weight without it.
 *
 * It is still not a mount-time free-for-all. The Permissions API is consulted
 * first and a DENIED permission is never re-requested, because that call never
 * resolves: no success callback, no error callback, just a promise the list
 * would wait on forever. Everything degrades: with no position the list sorts
 * by rating, the cards read "Share your location" instead of a distance, and
 * the radius filter stays disabled with its reason attached.
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

  /**
   * Ask once, without stranding anyone. A permission that is already `denied`
   * produces a getCurrentPosition call that never calls back at all, so the
   * only safe automatic request is one that checks first. Where the Permissions
   * API is missing (older Safari) we fall through to a normal request, which
   * still has its error callback as a backstop.
   */
  const requestAuto = useCallback(async () => {
    if (!supported) return;
    try {
      const permissions = navigator.permissions;
      if (permissions?.query) {
        const status = await permissions.query({ name: 'geolocation' });
        if (status.state === 'denied') {
          setState({
            position: null,
            status: 'error',
            error: 'Location is blocked for this site. You can still search by city.',
          });
          return;
        }
      }
    } catch {
      // A browser that cannot answer the question gets asked the normal way.
    }
    request();
  }, [supported, request]);

  return { ...state, request, requestAuto, clear, supported };
}

/**
 * @param {object} [options]
 * @param {boolean} [options.enabled=true] Skip the fetch entirely (anonymous
 *   visitors see the sign-in gate instead of the directory, and firing a request
 *   they will never see is just noise in the network tab).
 * @param {boolean} [options.autoLocate=false] Ask for the position as soon as
 *   the directory is enabled, so distances and the nearest-first sort are there
 *   without a button press. Off by default: only a screen whose job is "doctors
 *   near me" has earned the prompt.
 */
export function useDoctorDirectory({ enabled = true, autoLocate = false } = {}) {
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

  // One automatic attempt per mount. `asked` is a ref, not state, so a re-render
  // caused by the position arriving cannot queue a second prompt.
  const asked = useRef(false);
  const requestPosition = geo.requestAuto;
  useEffect(() => {
    if (!enabled || !autoLocate || asked.current) return;
    asked.current = true;
    requestPosition();
  }, [enabled, autoLocate, requestPosition]);

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
