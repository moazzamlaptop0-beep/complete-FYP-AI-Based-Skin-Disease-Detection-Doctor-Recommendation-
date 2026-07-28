/**
 * SensitiveImage — the ONE way any surface renders a patient's scan photograph.
 * ============================================================================
 *
 * WHY THIS EXISTS
 * ---------------
 * Every page in the app currently builds a raw `<img src="/static/uploads/…">`.
 * That URL is world-readable, carries no bearer token, and is the reason a
 * "sensitive" flag could never mean anything: the bytes were one guessable URL
 * away from anybody. This component never takes a file path. It takes a SCAN ID
 * and fetches `/api/scans/<id>/image?variant=` with the session's Authorization
 * header, so the server decides what you are allowed to see.
 *
 * CSS `blur()` IS NOT THE PRIVACY MECHANISM.
 * ------------------------------------------
 * A CSS filter is a client-side suggestion — "inspect element, delete the class"
 * defeats it, and the full-resolution bytes were in the browser the whole time.
 * Here the SERVER SENDS DIFFERENT BYTES: `variant=blur` is a separately rendered,
 * irreversibly downsampled image. The overlay below is an affordance telling the
 * viewer what they are looking at; it is not the control. The control is that
 * the sharp pixels never left the server.
 *
 * REVEALING IS AUDITED
 * --------------------
 * `variant=full` on a sensitive scan is honoured only when asked for explicitly,
 * and every such request writes an `image_access_log` row naming the viewer. The
 * reveal is therefore deliberately effortful and deliberately temporary: it
 * re-blurs after `revealSeconds`, when the tab is hidden, and on unmount.
 *
 * PUBLIC API — KEEP STABLE. The doctor and admin surfaces import this.
 *
 *   <SensitiveImage
 *     scanId={42}
 *     variant="thumb"        // thumb | blur | full — the BASE variant
 *     sensitive={scan.is_sensitive}
 *     deletedAt={scan.image_deleted_at}
 *     alt="Scan of the left forearm"
 *     canReveal                // show the Reveal button at all
 *     revealSeconds={30}
 *   />
 *
 * Also exported:
 *   <DeletedImagePlaceholder />        the "photo deleted, record retained" tile
 *   fetchScanImageBlob(scanId, variant)      -> Blob
 *   fetchScanImageDataUrl(scanId, variant)   -> 'data:image/…;base64,…'
 *
 * `fetchScanImageDataUrl` exists for html2canvas/jsPDF: html2canvas rasterises
 * the DOM with its own fetches, which carry no Authorization header, so an
 * authenticated <img> renders as a blank box in an exported PDF. Inlining the
 * bytes as a data URI first is the only thing that works.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Eye, EyeOff, ImageOff, RefreshCw, ShieldAlert } from 'lucide-react';

import { buildUrl } from '../../lib/api';
import { scans as scanEndpoints } from '../../lib/endpoints';
import * as storage from '../../lib/storage';
import { cn } from '../../lib/cn';
import { Button, Spinner } from '../ui';

/* ========================================================================== */
/* Transport                                                                  */
/* ========================================================================== */

/**
 * The raw-bytes read. `lib/api.js` is the only HTTP client in the app, but it
 * parses every response as text/JSON by design — it cannot hand back a Blob
 * without either sniffing content types (fragile) or growing a second pipeline.
 * So this one function does the transport itself, and it BORROWS the client's
 * pieces rather than reimplementing them: `buildUrl` for the base URL, the same
 * token/impersonation reads the client's header injection uses, and a path that
 * still comes from `endpoints.js`. No URL is templated here.
 *
 * @param {number|string} scanId
 * @param {'thumb'|'blur'|'full'} variant
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<{blob: Blob, servedVariant: string, sensitive: boolean}>}
 */
export async function fetchScanImageBlob(scanId, variant = 'thumb', options = {}) {
  const url = buildUrl(scanEndpoints.image(scanId, { variant }));
  const headers = { Accept: 'image/*' };

  const token = storage.getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const actingAs = storage.getActingAs();
  if (actingAs?.userId) headers['X-Act-As-User-Id'] = String(actingAs.userId);

  const response = await fetch(url, { method: 'GET', headers, signal: options.signal });

  if (!response.ok) {
    // 403 you may not see it · 404 deleted / no safe preview · 400 bad variant.
    const error = new Error(
      response.status === 403
        ? 'You do not have permission to view this image.'
        : response.status === 404
          ? 'This image is no longer available.'
          : 'The image could not be loaded.',
    );
    error.status = response.status;
    throw error;
  }

  return {
    blob: await response.blob(),
    // What the server ACTUALLY served, which may differ from what was asked for:
    // `thumb` is silently upgraded to `blur` for a non-owner of a sensitive scan.
    servedVariant: response.headers.get('X-Image-Variant') || variant,
    sensitive: response.headers.get('X-Image-Sensitive') === '1',
  };
}

/** Same read, encoded as a data URI so html2canvas can rasterise it. */
export async function fetchScanImageDataUrl(scanId, variant = 'full', options = {}) {
  const { blob } = await fetchScanImageBlob(scanId, variant, options);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('The image could not be encoded.'));
    reader.readAsDataURL(blob);
  });
}

/* ========================================================================== */
/* Placeholders                                                               */
/* ========================================================================== */

/**
 * What a deleted photograph looks like. The wording is load-bearing: a patient
 * who erased their photo must not think they also erased their diagnosis, and a
 * doctor looking at the case must not think the record was tampered with.
 */
export function DeletedImagePlaceholder({ className, compact = false }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-card border border-dashed',
        'border-subtle bg-surface-sunken p-3 text-center',
        className,
      )}
      role="img"
      aria-label="Photo deleted by the patient. The diagnosis and history are retained."
    >
      <ImageOff className={cn('shrink-0 text-subtle', compact ? 'h-5 w-5' : 'h-6 w-6')} aria-hidden="true" />
      {!compact && (
        <p className="max-w-[22ch] font-body text-caption leading-snug text-muted">
          Photo deleted by the patient. The diagnosis and history are retained.
        </p>
      )}
    </div>
  );
}

function MissingImagePlaceholder({ className, compact, message, onRetry }) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-2 rounded-card border border-dashed',
        'border-subtle bg-surface-sunken p-3 text-center',
        className,
      )}
    >
      <ShieldAlert className={cn('shrink-0 text-subtle', compact ? 'h-5 w-5' : 'h-6 w-6')} aria-hidden="true" />
      {!compact && <p className="max-w-[24ch] font-body text-caption leading-snug text-muted">{message}</p>}
      {!compact && onRetry && (
        <Button size="sm" variant="ghost" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

/* ========================================================================== */
/* SensitiveImage                                                             */
/* ========================================================================== */

/**
 * @param {object} props
 * @param {number|string} props.scanId
 * @param {'thumb'|'blur'|'full'} [props.variant='thumb'] The base variant to load.
 * @param {boolean} [props.sensitive=false] The scan's `is_sensitive` flag.
 * @param {string|null} [props.deletedAt] `image_deleted_at`; truthy ⇒ placeholder.
 * @param {string} [props.alt]
 * @param {boolean} [props.canReveal=false] Offer the audited full-resolution reveal.
 * @param {number} [props.revealSeconds=30] How long a reveal lasts.
 * @param {boolean} [props.hasImage=true] `has_image`; false ⇒ never fetch.
 * @param {string} [props.className] The frame.
 * @param {string} [props.imgClassName] The <img> itself.
 * @param {boolean} [props.compact=false] Thumbnail mode: icon-only placeholders.
 * @param {() => void} [props.onClick] Makes the frame activatable.
 */
export function SensitiveImage({
  scanId,
  variant = 'thumb',
  sensitive = false,
  deletedAt = null,
  alt = 'Skin scan',
  canReveal = false,
  revealSeconds = 30,
  hasImage = true,
  className,
  imgClassName,
  compact = false,
  onClick,
  ...rest
}) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | ready | error
  const [error, setError] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);

  /** Every object URL we have ever minted, so none can leak. */
  const urlRef = useRef(null);
  const setUrl = useCallback((next) => {
    if (urlRef.current && urlRef.current !== next) URL.revokeObjectURL(urlRef.current);
    urlRef.current = next;
    setObjectUrl(next);
  }, []);

  const deleted = Boolean(deletedAt);
  const disabled = deleted || !hasImage || scanId === null || scanId === undefined;

  // A sensitive scan is requested as `blur` explicitly. Asking for `thumb` would
  // be silently upgraded anyway for a non-owner, but being explicit means the
  // owner (who WOULD get the sharp thumb) sees the same protected preview as
  // everybody else until they choose to reveal.
  const baseVariant = sensitive ? 'blur' : variant;
  const activeVariant = revealed ? 'full' : baseVariant;

  /* ---------------------------------------------------------------- fetch -- */
  useEffect(() => {
    if (disabled) {
      setUrl(null);
      setState('idle');
      return undefined;
    }

    const controller = new AbortController();
    let cancelled = false;

    setState('loading');
    setError(null);

    fetchScanImageBlob(scanId, activeVariant, { signal: controller.signal })
      .then(({ blob }) => {
        if (cancelled) return;
        setUrl(URL.createObjectURL(blob));
        setState('ready');
      })
      .catch((err) => {
        if (cancelled || err?.name === 'AbortError') return;
        setError(err?.message || 'The image could not be loaded.');
        setState('error');
        // A failed reveal must not leave the UI claiming to be revealed.
        setRevealed(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [scanId, activeVariant, disabled, setUrl, reloadKey]);

  /* -------------------------------------------------------------- teardown -- */
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  /* ------------------------------------------------------ reveal countdown -- */
  useEffect(() => {
    if (!revealed) {
      setSecondsLeft(0);
      return undefined;
    }
    setSecondsLeft(revealSeconds);
    const timer = setInterval(() => {
      setSecondsLeft((n) => {
        if (n <= 1) {
          setRevealed(false);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [revealed, revealSeconds]);

  /* --------------------------------------- re-blur when the tab goes away --- */
  useEffect(() => {
    if (!revealed || typeof document === 'undefined') return undefined;
    const onVisibility = () => {
      // Someone alt-tabbing away from an unblurred clinical photograph on a
      // shared screen is exactly the case this protects.
      if (document.visibilityState === 'hidden') setRevealed(false);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onVisibility);
    };
  }, [revealed]);

  /* ---------------------------------------------------------------- render -- */
  const frame = cn(
    'relative isolate overflow-hidden rounded-card border border-subtle bg-surface-sunken',
    onClick && 'cursor-zoom-in',
    className,
  );

  if (deleted) return <DeletedImagePlaceholder className={cn(frame, 'border-dashed')} compact={compact} />;

  if (!hasImage) {
    return (
      <MissingImagePlaceholder
        className={cn(frame, 'border-dashed')}
        compact={compact}
        message="No photograph was stored for this scan."
      />
    );
  }

  if (state === 'error') {
    return (
      <MissingImagePlaceholder
        className={cn(frame, 'border-dashed')}
        compact={compact}
        message={error}
        onRetry={() => setReloadKey((n) => n + 1)}
      />
    );
  }

  const showOverlay = sensitive && !revealed;

  return (
    <div className={frame} {...rest}>
      {state === 'loading' && !objectUrl && (
        <div className="flex h-full w-full items-center justify-center p-4">
          <Spinner size="sm" />
          <span className="ui-sr-only">Loading image</span>
        </div>
      )}

      {objectUrl && (
        <img
          src={objectUrl}
          alt={showOverlay ? `${alt} (protected preview)` : alt}
          onClick={onClick}
          className={cn(
            'h-full w-full object-cover transition-opacity duration-200',
            state === 'loading' && 'opacity-60',
            imgClassName,
          )}
          draggable={false}
        />
      )}

      {/* The overlay LABELS the protection; the server enforced it. */}
      {showOverlay && (
        <div
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center gap-2',
            'bg-neutral-950/45 p-2 text-center backdrop-blur-[1px]',
          )}
        >
          <EyeOff className={cn('shrink-0 text-white', compact ? 'h-4 w-4' : 'h-5 w-5')} aria-hidden="true" />
          {!compact && (
            <p className="font-body text-caption font-medium leading-tight text-white">Sensitive image</p>
          )}
          {canReveal && (
            <Button
              size="sm"
              variant="secondary"
              leftIcon={<Eye className="h-3.5 w-3.5" />}
              onClick={(event) => {
                event.stopPropagation();
                setRevealed(true);
              }}
              className={compact ? 'px-2 py-1 text-caption' : undefined}
            >
              Reveal
            </Button>
          )}
        </div>
      )}

      {/* Revealed: a visible, ticking reminder that this view was logged. */}
      {sensitive && revealed && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-neutral-950/70 px-2 py-1">
          <span className="font-body text-caption text-white">
            Revealed · re-blurs in {secondsLeft}s
          </span>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setRevealed(false);
            }}
            className={cn(
              'rounded-control px-1.5 py-0.5 font-body text-caption text-white outline-none',
              'hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-focus',
            )}
          >
            Hide
          </button>
        </div>
      )}
    </div>
  );
}

export default SensitiveImage;
