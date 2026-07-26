/**
 * RealtimeContext — ONE EventSource per session.
 *
 * WHAT IT REPLACES
 * ----------------
 * Today DoctorDashboard.jsx:259 and PatientHistory.jsx:535 each open their own
 * `new EventSource(url)` with NO ticket, per page, per mount. Every one of those
 * connections pins a Flask worker for hours (the backend polls the DB every 5s
 * per connection), and every one of them is unauthenticated — the backend logs
 * each as `DEPRECATED-UNAUTH-SSE` and treats it as an open data-leak event.
 *
 * WHAT THIS DOES INSTEAD
 * ----------------------
 * One connection for the whole tab. Before connecting it POSTs
 * /api/stream-ticket (Bearer-authed, 60s TTL) and passes `?ticket=`, because
 * `EventSource` cannot send an Authorization header — that is the entire reason
 * the ticket route exists. If the ticket call fails it still connects without
 * one, since the backend's legacy unauthenticated mode is on in development and
 * a broken dashboard would be worse than a logged warning. That fallback dies
 * the day ALLOW_LEGACY_UNAUTH_SSE goes false in production.
 *
 * WIRE FORMAT (frozen — see app/api/streams/routes.py)
 * ---------------------------------------------------
 *   `data: {json}\n\n`  only when the payload CHANGED
 *   `: heartbeat\n\n`   otherwise — a comment, which EventSource deliberately
 *                       never delivers to onmessage
 * There are no named events, so everything arrives on 'message'. Payloads:
 *   doctor  -> {scans[], appointments[], pending_count, completed_count, cancelled_count}
 *   patient -> {scans[], appointments[]}
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { buildUrl, post } from '../lib/api';
import { streams as streamEndpoints } from '../lib/endpoints';
import { PERMISSIONS, hasAnyPermission } from '../lib/permissions';
import { useOptionalAuth } from './AuthContext';

/** Backoff schedule in ms. Caps at 30s — a dead backend must not be hammered. */
const BACKOFF_STEPS = [1_000, 2_000, 5_000, 10_000, 20_000, 30_000];
/** Jitter so N tabs reconnecting after an outage do not arrive in lockstep. */
const JITTER_RATIO = 0.25;

export const RealtimeContext = createContext(null);

/**
 * Which stream this session should be on, derived from permissions rather than
 * `role === 'Doctor'`. A doctor holds SCAN_READ_OWN too, but their dashboard is
 * the doctor one; the patient surface asks for its stream explicitly.
 */
export function defaultStreamFor(user, permissions) {
  const id = Number(user?.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  if (hasAnyPermission(permissions, [
    PERMISSIONS.SCAN_REVIEW_ASSIGNED,
    PERMISSIONS.SCAN_REVIEW_ANY,
  ])) {
    return { kind: 'doctor', id };
  }
  return { kind: 'patient', id };
}

function streamUrl(stream, ticket) {
  if (!stream) return null;
  const path = stream.kind === 'doctor'
    ? streamEndpoints.doctorUpdates(stream.id, ticket || undefined)
    : streamEndpoints.patientUpdates(stream.id, ticket || undefined);
  return buildUrl(path);
}

function backoffDelay(attempt) {
  const base = BACKOFF_STEPS[Math.min(attempt, BACKOFF_STEPS.length - 1)];
  return Math.round(base * (1 + (Math.random() * 2 - 1) * JITTER_RATIO));
}

export function RealtimeProvider({ children, enabled = true, stream: streamOverride = null }) {
  const auth = useOptionalAuth();
  const [status, setStatus] = useState('idle'); // idle|connecting|open|reconnecting|unsupported|disabled
  const [data, setData] = useState(null);
  const [lastEventAt, setLastEventAt] = useState(null);
  const [error, setError] = useState(null);
  const [manualStream, setManualStream] = useState(null);

  const sourceRef = useRef(null);
  const retryTimer = useRef(null);
  const attemptRef = useRef(0);
  const subscribers = useRef(new Set());
  const closedByUs = useRef(false);
  /**
   * PER-INVOCATION cancellation token.
   *
   * `closedByUs` is a single shared boolean and every `connect()` resets it to
   * false on entry. So when a teardown lands while an earlier connect is parked
   * on the 5s ticket fetch, the replacement connect immediately UNDOES the
   * cancellation: the stale attempt passes its own guard, builds an EventSource
   * and overwrites `sourceRef`. One of the two connections is then unreachable —
   * `teardown()` only closes what is in `sourceRef`, so it is never closed, not
   * on unmount and not on logout, and it keeps streaming the previous user's
   * scans, emails and diagnoses while pinning a Flask worker that re-queries the
   * DB every 5 seconds.
   *
   * Deterministic under StrictMode (mount -> cleanup -> mount) and reachable in
   * production on any auth-state change inside the ticket window. Each attempt
   * now carries its own id and bails if it is no longer the current one.
   */
  const runId = useRef(0);

  /**
   * The stream identity, as a PRIMITIVE ("doctor:7" or null).
   *
   * WHY NOT JUST MEMO THE OBJECT — this was an infinite reconnect loop.
   * `defaultStreamFor()` returns a fresh `{kind, id}` literal every call, and
   * this memo used to depend on the whole `auth` value. AuthContext legitimately
   * produces a new value whenever anything about the session changes (the
   * proactive token refresh alone does it on a timer), so `stream` became a NEW
   * OBJECT on a schedule. The connect effect below lists `stream` as a
   * dependency, so each new identity tore the EventSource down and rebuilt it,
   * which called setStatus, which re-rendered — a reconnect storm every few
   * seconds that looked like the page reloading itself.
   *
   * Depending on primitives means the identity only changes when the stream
   * genuinely changes: a different user, or a different role surface.
   */
  // Collapsed to a BOOLEAN before it reaches the memo. `auth.permissions` is an
  // array, so depending on it directly would reintroduce the same identity
  // churn this whole block exists to avoid.
  const reviewsScans = hasAnyPermission(auth?.permissions, [
    PERMISSIONS.SCAN_REVIEW_ASSIGNED,
    PERMISSIONS.SCAN_REVIEW_ANY,
  ]);

  const streamKey = useMemo(() => {
    if (streamOverride) return `${streamOverride.kind}:${streamOverride.id}`;
    if (manualStream) return `${manualStream.kind}:${manualStream.id}`;
    if (!auth || auth.status !== 'authed') return null;
    const id = Number(auth.user?.id);
    if (!Number.isFinite(id) || id <= 0) return null;
    return `${reviewsScans ? 'doctor' : 'patient'}:${id}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    streamOverride?.kind, streamOverride?.id,
    manualStream?.kind, manualStream?.id,
    auth?.status, auth?.user?.id, reviewsScans,
  ]);

  /** The object the rest of the hook wants, rebuilt ONLY when the key changes. */
  const stream = useMemo(() => {
    if (!streamKey) return null;
    const [kind, rawId] = streamKey.split(':');
    return { kind, id: Number(rawId) };
  }, [streamKey]);

  /** Subscribe to every payload. Returns an unsubscribe function. */
  const subscribe = useCallback((handler) => {
    if (typeof handler !== 'function') return () => {};
    subscribers.current.add(handler);
    return () => { subscribers.current.delete(handler); };
  }, []);

  const teardown = useCallback(() => {
    closedByUs.current = true;
    // Invalidate every attempt currently in flight, including ones parked on the
    // ticket fetch that a later connect() would otherwise revive.
    runId.current += 1;
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    if (sourceRef.current) {
      try { sourceRef.current.close(); } catch { /* already dead */ }
      sourceRef.current = null;
    }
  }, []);

  const connect = useCallback(async (target) => {
    if (!target) return;
    if (typeof EventSource === 'undefined') {
      setStatus('unsupported');
      return;
    }

    runId.current += 1;
    const myRun = runId.current;
    closedByUs.current = false;

    // A fresh ticket per connection attempt: the TTL is 60s and only has to
    // survive the handshake.
    let ticket = null;
    try {
      const payload = await post(streamEndpoints.ticket(), {}, { timeoutMs: 5_000 });
      ticket = payload?.ticket || null;
    } catch {
      // Legacy unauthenticated mode. Logged loudly by the backend; still works
      // in development. Do not block the dashboard on it.
      ticket = null;
    }

    // Superseded (or torn down) while the ticket was in flight. `closedByUs`
    // alone is not enough — see the comment on `runId`.
    if (myRun !== runId.current || closedByUs.current) return;

    const url = streamUrl(target, ticket);
    if (!url) return;

    setStatus((prev) => (prev === 'open' ? prev : (attemptRef.current > 0 ? 'reconnecting' : 'connecting')));

    let source;
    try {
      source = new EventSource(url);
    } catch (err) {
      setError(err);
      scheduleReconnect(target);
      return;
    }
    // Belt and braces: never leave a live connection unreferenced.
    if (sourceRef.current && sourceRef.current !== source) {
      try { sourceRef.current.close(); } catch { /* already dead */ }
    }
    sourceRef.current = source;

    source.onopen = () => {
      attemptRef.current = 0;
      setError(null);
      setStatus('open');
    };

    source.onmessage = (event) => {
      let payload;
      try {
        payload = JSON.parse(event.data);
      } catch {
        // A malformed frame must not kill the stream.
        return;
      }
      setData(payload);
      setLastEventAt(Date.now());
      subscribers.current.forEach((handler) => {
        try { handler(payload, target); } catch { /* one bad subscriber must not stop the rest */ }
      });
    };

    source.onerror = () => {
      // EventSource auto-reconnects, but it reuses the SAME url — and our ticket
      // has a 60s TTL, so its retry would 401 forever once enforcement is on.
      // Close it and do our own backoff with a fresh ticket.
      try { source.close(); } catch { /* ignore */ }
      if (sourceRef.current === source) sourceRef.current = null;
      if (closedByUs.current) return;
      setStatus('reconnecting');
      scheduleReconnect(target);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Declared after `connect` uses it; hoisted by function scoping on purpose so
  // the two can reference each other without a ref dance.
  function scheduleReconnect(target) {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    const delay = backoffDelay(attemptRef.current);
    attemptRef.current += 1;
    retryTimer.current = setTimeout(() => { connect(target); }, delay);
  }

  // -- lifecycle -------------------------------------------------------------
  useEffect(() => {
    if (!enabled) {
      teardown();
      setStatus('disabled');
      return undefined;
    }
    if (!stream) {
      teardown();
      setStatus('idle');
      setData(null);
      return undefined;
    }

    attemptRef.current = 0;
    connect(stream);

    return () => { teardown(); };
  }, [enabled, stream, connect, teardown]);

  // -- come back from sleep / offline ---------------------------------------
  useEffect(() => {
    if (typeof window === 'undefined' || !enabled || !stream) return undefined;

    const revive = () => {
      // Already connected, or a backoff attempt is already queued.
      if (sourceRef.current || retryTimer.current) return;
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      attemptRef.current = 0;
      connect(stream);
    };

    window.addEventListener('online', revive);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', revive);
    return () => {
      window.removeEventListener('online', revive);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', revive);
    };
  }, [enabled, stream, connect]);

  const reconnect = useCallback(() => {
    teardown();
    attemptRef.current = 0;
    if (stream) connect(stream);
  }, [connect, stream, teardown]);

  const value = useMemo(() => ({
    status,
    isConnected: status === 'open',
    data,
    lastEventAt,
    error,
    stream,
    subscribe,
    reconnect,
    /** Point the single connection at another stream (a doctor opening their own patient surface). */
    setStream: setManualStream,
  }), [status, data, lastEventAt, error, stream, subscribe, reconnect]);

  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

/**
 * @returns {{status:string, isConnected:boolean, data:object|null, lastEventAt:number|null,
 *   error:any, stream:{kind:string,id:number}|null, subscribe:(fn:Function)=>Function,
 *   reconnect:()=>void, setStream:Function}}
 */
export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime must be used inside <RealtimeProvider>.');
  }
  return context;
}

export function useOptionalRealtime() {
  return useContext(RealtimeContext);
}

/**
 * Subscribe to stream payloads without re-rendering on every tick.
 * @param {(payload:object, stream:object)=>void} handler
 */
export function useRealtimeSubscription(handler) {
  const context = useContext(RealtimeContext);
  const saved = useRef(handler);

  // Kept in an effect, not assigned during render: a ref write during render is
  // a React rules violation and misbehaves under concurrent rendering.
  useEffect(() => { saved.current = handler; }, [handler]);

  useEffect(() => {
    if (!context) return undefined;
    return context.subscribe((payload, stream) => saved.current?.(payload, stream));
  }, [context]);
}

export default RealtimeContext;
