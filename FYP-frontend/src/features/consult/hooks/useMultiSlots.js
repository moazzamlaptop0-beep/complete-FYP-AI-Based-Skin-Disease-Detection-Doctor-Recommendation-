/**
 * useMultiSlots — every chosen doctor's free times for ONE date, in ONE request.
 *
 * WHY NOT THREE CALLS TO `/api/slots/<id>`
 * ----------------------------------------
 * Because that is what the old booking modal did, and with three doctors and a
 * 14-day strip it turns a date tap into three round trips whose responses can
 * arrive out of order — you tap 5 Aug, then 6 Aug, and the slower 5 Aug response
 * lands last and repaints the 6th with the 5th's times. `/api/slots/multi`
 * returns `{by_doctor: {"7": [...], "9": [...]}}` for all of them at once, so
 * there is one request, one AbortController, and one thing to be stale.
 *
 * Note the envelope difference the two siblings have: `/api/slots/<id>` answers
 * with a BARE ARRAY (a frozen legacy quirk) while `/api/slots/multi` uses the
 * standard envelope. `lib/api.js` normalises both, which is why nothing here has
 * to know about it.
 *
 * CACHING
 * -------
 * Results are memoised per `date|doctor_ids` for the lifetime of the step, so
 * walking back and forth along the date strip is instant and does not re-hit the
 * API. The cache is deliberately NOT persisted: slot availability is the most
 * perishable data in the product, and a slot cached from a previous session is
 * a slot that is probably gone.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ApiError, get } from '../../../lib/api';
import { schedule as scheduleEndpoints } from '../../../lib/endpoints';

/** `{time, status, duration}` -> the shape the picker and the reducer share. */
function normalizeSlotRow(row, doctorId, date) {
  if (!row) return null;
  const time = typeof row === 'string' ? row : row.time ?? row.slot_time;
  if (!time) return null;
  return {
    doctor_id: doctorId,
    slot_date: date,
    slot_time: String(time),
    duration: (row && row.duration) || '30min',
    // Anything that is not explicitly 'available' is treated as taken. A new
    // status the backend adds later must not silently become bookable.
    available: (row?.status ?? 'available') === 'available',
    status: row?.status ?? 'available',
  };
}

/**
 * @param {Array<number>} doctorIds
 * @param {string} date `YYYY-MM-DD`
 */
export function useMultiSlots(doctorIds, date) {
  // A stable primitive for the dependency arrays; the array identity changes on
  // every render of the parent and would restart the request forever.
  const idsKey = useMemo(
    () => [...new Set((doctorIds || []).filter((id) => Number.isFinite(Number(id))).map(Number))]
      .sort((a, b) => a - b)
      .join(','),
    [doctorIds],
  );

  const cache = useRef(new Map());
  const abortRef = useRef(null);
  const mounted = useRef(true);
  const [state, setState] = useState({ status: 'idle', byDoctor: {}, error: null });

  // Re-arm on mount: StrictMode's simulated unmount fires this cleanup, and a
  // flag left false means the fetched slots are dropped on arrival, so step 5
  // would sit on its skeleton with the data already in hand.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const load = useCallback(async ({ force = false } = {}) => {
    if (!idsKey || !date) {
      setState({ status: 'idle', byDoctor: {}, error: null });
      return;
    }
    const cacheKey = `${date}|${idsKey}`;
    if (!force && cache.current.has(cacheKey)) {
      setState({ status: 'success', byDoctor: cache.current.get(cacheKey), error: null });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setState((previous) => ({ ...previous, status: 'loading', error: null }));

    try {
      const ids = idsKey.split(',');
      const data = await get(scheduleEndpoints.slotsMulti(ids, date), {
        signal: controller.signal,
      });
      if (!mounted.current) return;

      const source = data?.by_doctor && typeof data.by_doctor === 'object' ? data.by_doctor : {};
      const byDoctor = {};
      ids.forEach((id) => {
        const rows = Array.isArray(source[id]) ? source[id] : Array.isArray(source[Number(id)])
          ? source[Number(id)]
          : [];
        byDoctor[id] = rows.map((row) => normalizeSlotRow(row, Number(id), date)).filter(Boolean);
      });

      cache.current.set(cacheKey, byDoctor);
      setState({ status: 'success', byDoctor, error: null });
    } catch (caught) {
      if (caught?.name === 'AbortError' || !mounted.current) return;
      setState({
        status: 'error',
        byDoctor: {},
        error: caught instanceof ApiError
          ? caught.message
          : 'We could not load available times for that day.',
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [idsKey, date]);

  useEffect(() => {
    load();
  }, [load]);

  return {
    status: state.status,
    byDoctor: state.byDoctor,
    error: state.error,
    reload: useCallback(() => load({ force: true }), [load]),
  };
}

export default useMultiSlots;
