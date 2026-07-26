/**
 * ScanLightbox — the full-screen examination view for a patient's scan photo.
 * ============================================================================
 *
 * WHY A SEPARATE COMPONENT FROM <SensitiveImage>
 * ----------------------------------------------
 * SensitiveImage is a *tile*: fixed box, `object-cover`, no interaction beyond
 * the audited reveal. A doctor deciding whether to accept a request needs the
 * opposite — the whole frame, magnified, rotatable, pannable. Bolting that onto
 * the tile would put pan/zoom state on every list row in the inbox. So this is
 * an overlay that mounts only while it is open, and the tile stays cheap.
 *
 * IT REUSES THE PRIVACY TRANSPORT, IT DOES NOT REIMPLEMENT IT
 * ----------------------------------------------------------
 * Bytes still come from `fetchScanImageBlob` (authenticated `/api/scans/<id>/
 * image?variant=`), so the server decides what may be seen. A sensitive scan
 * opens on the server-rendered `blur` variant and only swaps to `full` after an
 * explicit, audit-logged reveal — the same contract SensitiveImage honours, and
 * for the same reason: CSS is not a privacy control. The reveal expires, and it
 * expires *harder* here, because a magnified clinical photograph left on screen
 * is exactly the leak the countdown exists for.
 *
 * There is deliberately no download / open-in-new-tab / right-click-save
 * affordance. The object URL is revoked on close.
 *
 * GEOMETRY
 * --------
 * One transform, applied in this order: `translate(tx, ty) scale(s) rotate(r)`.
 * Translate comes FIRST so pan stays in unrotated screen pixels — drag right,
 * the image goes right, even at 270°. `scale === 1` is defined as "fitted", so
 * fit/reset is just `scale = 1` and there is no separate fit mode to keep in
 * sync. Rotating to an odd quarter-turn re-bases that fit (a portrait photo
 * turned sideways no longer fits at 1) while PRESERVING the doctor's current
 * magnification relative to it.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Eye,
  FlipHorizontal2,
  ImageOff,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  RotateCw,
  ShieldAlert,
  X,
} from 'lucide-react';

import { cn } from '../../lib/cn';
import { Portal, Scrim, useFocusTrap, useScrollLock, usePresence } from '../ui/Overlay';
import { Spinner } from '../ui';
import { fetchScanImageBlob } from './SensitiveImage';

const MIN_SCALE = 0.2;
const MAX_SCALE = 12;
/** Multiplier per button press / keyboard step. Wheel uses a finer curve. */
const STEP = 1.35;

const clampScale = (value) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));

/* ========================================================================== */
/* Chrome                                                                     */
/* ========================================================================== */

/**
 * Toolbar button. Intentionally NOT the token <Button>: this chrome sits on a
 * near-black backdrop where the light-surface variants are unreadable, and it
 * must stay legible regardless of the app theme the doctor is running.
 */
function ToolButton({ label, onClick, disabled, active, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : Boolean(active)}
      title={label}
      className={cn(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control',
        'text-white/90 outline-none transition-colors',
        'hover:bg-white/15 hover:text-white',
        'focus-visible:ring-2 focus-visible:ring-white/70',
        'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
        active && 'bg-white/20 text-white',
      )}
    >
      <span aria-hidden="true" className="inline-flex">{children}</span>
    </button>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-0.5 h-5 w-px shrink-0 bg-white/20" />;
}

/* ========================================================================== */
/* ScanLightbox                                                               */
/* ========================================================================== */

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {number|string} props.scanId
 * @param {boolean} [props.sensitive=false] The scan's `is_sensitive` flag.
 * @param {boolean} [props.canReveal=false] Offer the audited full-resolution reveal.
 * @param {number} [props.revealSeconds=45] How long a reveal lasts.
 * @param {string} [props.alt]
 * @param {React.ReactNode} [props.title] Shown top-left, e.g. the prediction.
 * @param {React.ReactNode} [props.subtitle] Second line, e.g. patient + request id.
 * @param {string|null} [props.deletedAt] `image_deleted_at`; truthy ⇒ nothing to show.
 * @param {boolean} [props.hasImage=true]
 */
export function ScanLightbox({
  open,
  onClose,
  scanId,
  sensitive = false,
  canReveal = false,
  revealSeconds = 45,
  alt = 'Skin scan',
  title,
  subtitle,
  deletedAt = null,
  hasImage = true,
}) {
  const { mounted, state } = usePresence(open);

  const panelRef = useRef(null);
  const stageRef = useRef(null);
  const imgRef = useRef(null);
  const urlRef = useRef(null);
  /** Live pointers, keyed by pointerId — 1 ⇒ pan, 2 ⇒ pinch. */
  const pointersRef = useRef(new Map());
  const panRef = useRef(null);
  const pinchRef = useRef(null);

  const [objectUrl, setObjectUrl] = useState(null);
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [error, setError] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [view, setView] = useState({ scale: 1, rotation: 0, flipped: false, tx: 0, ty: 0 });
  // Mirrors `panRef` into render, purely so the cursor and the transform
  // transition can react to a drag. The ref stays the source of truth inside
  // the pointer handlers, which must not wait for a commit.
  const [dragging, setDragging] = useState(false);

  const disabled = Boolean(deletedAt) || !hasImage || scanId === null || scanId === undefined;
  const activeVariant = sensitive && !revealed ? 'blur' : 'full';

  useScrollLock(open);
  useFocusTrap(panelRef, { active: open, onEscape: onClose });

  const resetView = useCallback(() => {
    setView({ scale: 1, rotation: 0, flipped: false, tx: 0, ty: 0 });
  }, []);

  /* ---------------------------------------------------------------- fetch -- */
  /* eslint-disable react-hooks/set-state-in-effect --
     These three effects synchronise with things outside React — an HTTP fetch,
     an object-URL lifetime, an interval — and their "loading"/"closed"/"tick"
     states cannot be derived during render. This is the same shape, and the
     same justification, as SensitiveImage's fetch and countdown. */
  useEffect(() => {
    if (!open || disabled) return undefined;

    const controller = new AbortController();
    let cancelled = false;

    setStatus('loading');
    setError(null);

    fetchScanImageBlob(scanId, activeVariant, { signal: controller.signal })
      .then(({ blob }) => {
        if (cancelled) return;
        const next = URL.createObjectURL(blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = next;
        setObjectUrl(next);
        setStatus('ready');
      })
      .catch((caught) => {
        if (cancelled || caught?.name === 'AbortError') return;
        setError(caught?.message || 'The image could not be loaded.');
        setStatus('error');
        // A failed reveal must not leave the chrome claiming to be revealed.
        setRevealed(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open, disabled, scanId, activeVariant]);

  /* ------------------------------------------------------- close teardown -- */
  // Closing throws away the bytes AND the geometry: reopening a case should
  // start from the fitted view, not from wherever the last examination left the
  // pan. Revoking here (not only on unmount) means a closed lightbox is holding
  // no decrypted-in-memory copy of a clinical photograph.
  useEffect(() => {
    if (open) return;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setObjectUrl(null);
    setRevealed(false);
    setStatus('loading');
    resetView();
  }, [open, resetView]);

  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
  }, []);

  /* ------------------------------------------------------ reveal lifetime -- */
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
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!revealed || typeof document === 'undefined') return undefined;
    const reblur = () => {
      if (document.visibilityState === 'hidden') setRevealed(false);
    };
    document.addEventListener('visibilitychange', reblur);
    window.addEventListener('blur', reblur);
    return () => {
      document.removeEventListener('visibilitychange', reblur);
      window.removeEventListener('blur', reblur);
    };
  }, [revealed]);

  /* ------------------------------------------------------------ geometry -- */

  /**
   * What `scale` means "fitted" for a given rotation. At 0°/180° the <img> is
   * already laid out to fit (`object-contain`), so it is 1. At 90°/270° the
   * laid-out box is turned across the stage, so fitting needs the smaller of
   * the two cross ratios.
   */
  const fitScaleFor = useCallback((rotation) => {
    if (rotation % 180 === 0) return 1;
    const stage = stageRef.current;
    const img = imgRef.current;
    if (!stage || !img || !img.offsetWidth || !img.offsetHeight) return 1;
    return Math.min(stage.clientWidth / img.offsetHeight, stage.clientHeight / img.offsetWidth);
  }, []);

  /** Zoom about a fixed point given in stage-centre-relative pixels. */
  const zoomAbout = useCallback((factor, px = 0, py = 0) => {
    setView((previous) => {
      const scale = clampScale(previous.scale * factor);
      if (scale === previous.scale) return previous;
      const ratio = scale / previous.scale;
      return {
        ...previous,
        scale,
        tx: px - (px - previous.tx) * ratio,
        ty: py - (py - previous.ty) * ratio,
      };
    });
  }, []);

  const rotateBy = useCallback((degrees) => {
    setView((previous) => {
      const rotation = (previous.rotation + degrees + 360) % 360;
      // Preserve the doctor's magnification *relative to fit* across the turn,
      // so rotating a photo they had zoomed to 3× does not dump them back to 1×
      // or fling the subject off the stage.
      const factor = fitScaleFor(rotation) / (fitScaleFor(previous.rotation) || 1);
      return {
        ...previous,
        rotation,
        scale: clampScale(previous.scale * (factor || 1)),
        tx: 0,
        ty: 0,
      };
    });
  }, [fitScaleFor]);

  /** True 1:1 pixels: the natural width over the laid-out (untransformed) width. */
  const zoomToActualSize = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.naturalWidth || !img.offsetWidth) return;
    setView((previous) => ({
      ...previous,
      scale: clampScale(img.naturalWidth / img.offsetWidth),
      tx: 0,
      ty: 0,
    }));
  }, []);

  /* -------------------------------------------------------------- pointer -- */

  const stagePoint = (event) => {
    const stage = stageRef.current;
    if (!stage) return { x: 0, y: 0 };
    const box = stage.getBoundingClientRect();
    return {
      x: event.clientX - (box.left + box.width / 2),
      y: event.clientY - (box.top + box.height / 2),
    };
  };

  const onWheel = (event) => {
    if (status !== 'ready') return;
    event.preventDefault();
    const point = stagePoint(event);
    // deltaY is device-dependent (pixels on a trackpad, ~100 per notch on a
    // mouse); an exponential curve makes both feel the same.
    zoomAbout(Math.exp(-event.deltaY / 400), point.x, point.y);
  };

  const onPointerDown = (event) => {
    if (status !== 'ready' || event.button === 2) return;
    const stage = stageRef.current;
    stage?.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointersRef.current.size === 2) {
      const [a, b] = Array.from(pointersRef.current.values());
      pinchRef.current = { distance: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
      panRef.current = null;
      setDragging(false);
      return;
    }
    panRef.current = { x: event.clientX, y: event.clientY, tx: view.tx, ty: view.ty };
    setDragging(true);
  };

  const onPointerMove = (event) => {
    const pointers = pointersRef.current;
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size >= 2 && pinchRef.current) {
      const [a, b] = Array.from(pointers.values());
      const distance = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const stage = stageRef.current;
      const box = stage?.getBoundingClientRect();
      const midX = box ? (a.x + b.x) / 2 - (box.left + box.width / 2) : 0;
      const midY = box ? (a.y + b.y) / 2 - (box.top + box.height / 2) : 0;
      zoomAbout(distance / pinchRef.current.distance, midX, midY);
      pinchRef.current.distance = distance;
      return;
    }

    const pan = panRef.current;
    if (!pan) return;
    setView((previous) => ({
      ...previous,
      tx: pan.tx + (event.clientX - pan.x),
      ty: pan.ty + (event.clientY - pan.y),
    }));
  };

  const endPointer = (event) => {
    pointersRef.current.delete(event.pointerId);
    stageRef.current?.releasePointerCapture?.(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) {
      panRef.current = null;
      setDragging(false);
    }
  };

  /* ------------------------------------------------------------- keyboard -- */
  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key;
      const pan = (dx, dy) => setView((p) => ({ ...p, tx: p.tx + dx, ty: p.ty + dy }));

      if (key === '+' || key === '=') { event.preventDefault(); zoomAbout(STEP); }
      else if (key === '-' || key === '_') { event.preventDefault(); zoomAbout(1 / STEP); }
      else if (key === '0') { event.preventDefault(); resetView(); }
      else if (key === '1') { event.preventDefault(); zoomToActualSize(); }
      else if (key === 'r') { event.preventDefault(); rotateBy(90); }
      else if (key === 'R') { event.preventDefault(); rotateBy(-90); }
      else if (key === 'ArrowLeft') { event.preventDefault(); pan(40, 0); }
      else if (key === 'ArrowRight') { event.preventDefault(); pan(-40, 0); }
      else if (key === 'ArrowUp') { event.preventDefault(); pan(0, 40); }
      else if (key === 'ArrowDown') { event.preventDefault(); pan(0, -40); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, zoomAbout, resetView, zoomToActualSize, rotateBy]);

  /* ---------------------------------------------------------------- render -- */
  if (!mounted) return null;

  const percent = Math.round(view.scale * 100);
  const ready = status === 'ready' && objectUrl;
  const showProtected = sensitive && !revealed;

  return (
    <Portal>
      <div
        className="fixed inset-0 z-modal flex flex-col"
        data-state={state}
        role="dialog"
        aria-modal="true"
        aria-label={`${alt} — full view`}
        ref={panelRef}
        tabIndex={-1}
      >
        <Scrim
          onClick={onClose}
          blur={false}
          className={cn(
            'bg-neutral-950/92',
            state === 'closed' && 'opacity-0 transition-opacity duration-150',
          )}
        />

        {/* ---------------------------------------------------------- head -- */}
        <div className="relative z-raised flex items-start gap-3 px-4 pt-4 sm:px-6">
          <div className="min-w-0 flex-1">
            {title && (
              <h2 className="truncate font-heading text-heading-sm text-white">{title}</h2>
            )}
            {subtitle && (
              <p className="mt-0.5 truncate font-body text-body-sm text-white/70">{subtitle}</p>
            )}
          </div>
          <ToolButton label="Close full view (Esc)" onClick={onClose}>
            <X className="h-5 w-5" />
          </ToolButton>
        </div>

        {/* --------------------------------------------------------- stage -- */}
        <div
          ref={stageRef}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endPointer}
          onPointerCancel={endPointer}
          onDoubleClick={(event) => {
            if (!ready) return;
            const point = stagePoint(event);
            if (view.scale > 1.05) resetView();
            else zoomAbout(2.5 / view.scale, point.x, point.y);
          }}
          className={cn(
            'relative z-raised flex min-h-0 flex-1 items-center justify-center overflow-hidden',
            'touch-none select-none px-4 py-4 sm:px-6',
            ready && (dragging ? 'cursor-grabbing' : 'cursor-grab'),
          )}
        >
          {disabled && (
            <p className="flex flex-col items-center gap-2 text-center font-body text-body-sm text-white/70">
              <ImageOff className="h-7 w-7" aria-hidden="true" />
              {deletedAt
                ? 'The patient deleted this photograph. The diagnosis and history are retained.'
                : 'No photograph was stored for this scan.'}
            </p>
          )}

          {!disabled && status === 'loading' && (
            <div className="flex flex-col items-center gap-3">
              <Spinner size="md" />
              <span className="font-body text-body-sm text-white/70">Loading the full image…</span>
            </div>
          )}

          {!disabled && status === 'error' && (
            <p className="flex max-w-sm flex-col items-center gap-2 text-center font-body text-body-sm text-white/70">
              <ShieldAlert className="h-7 w-7" aria-hidden="true" />
              {error}
            </p>
          )}

          {ready && (
            <img
              ref={imgRef}
              src={objectUrl}
              alt={showProtected ? `${alt} (protected preview)` : alt}
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
              style={{
                transform:
                  `translate(${view.tx}px, ${view.ty}px) scale(${view.scale}) `
                  + `rotate(${view.rotation}deg) scaleX(${view.flipped ? -1 : 1})`,
              }}
              className={cn(
                'max-h-full max-w-full object-contain will-change-transform',
                // Only animate the discrete controls; a transition here would
                // make drag-to-pan feel like it is lagging behind the pointer.
                dragging ? '' : 'transition-transform duration-150 ease-emphasized',
              )}
            />
          )}
        </div>

        {/* ------------------------------------------------- protection bar -- */}
        {!disabled && sensitive && (
          <div className="relative z-raised mx-auto mb-2 flex max-w-full items-center gap-3 rounded-pill bg-white/10 px-3 py-1.5">
            {showProtected ? (
              <>
                <span className="font-body text-caption text-white/85">
                  Protected preview — the sharp image is held on the server.
                </span>
                {canReveal && (
                  <button
                    type="button"
                    onClick={() => setRevealed(true)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-pill bg-white px-2.5 py-1',
                      'font-body text-caption font-medium text-neutral-900 outline-none',
                      'hover:bg-white/90 focus-visible:ring-2 focus-visible:ring-white/70',
                    )}
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    Reveal
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="font-body text-caption text-white/85">
                  Revealed and logged · re-blurs in {secondsLeft}s
                </span>
                <button
                  type="button"
                  onClick={() => setRevealed(false)}
                  className={cn(
                    'rounded-pill px-2 py-0.5 font-body text-caption text-white outline-none',
                    'hover:bg-white/20 focus-visible:ring-2 focus-visible:ring-white/70',
                  )}
                >
                  Hide
                </button>
              </>
            )}
          </div>
        )}

        {/* ------------------------------------------------------- toolbar -- */}
        <div className="relative z-raised flex justify-center px-4 pb-4 sm:pb-6">
          <div
            className={cn(
              'flex max-w-full items-center gap-0.5 overflow-x-auto rounded-pill',
              'border border-white/15 bg-neutral-900/80 px-1.5 py-1 backdrop-blur-sm',
            )}
            role="toolbar"
            aria-label="Image controls"
          >
            <ToolButton
              label="Zoom out (−)"
              onClick={() => zoomAbout(1 / STEP)}
              disabled={!ready || view.scale <= MIN_SCALE}
            >
              <Minus className="h-4 w-4" />
            </ToolButton>
            <span
              className="w-14 shrink-0 text-center font-body text-caption tabular-nums text-white/80"
              aria-live="polite"
            >
              {ready ? `${percent}%` : '—'}
            </span>
            <ToolButton
              label="Zoom in (+)"
              onClick={() => zoomAbout(STEP)}
              disabled={!ready || view.scale >= MAX_SCALE}
            >
              <Plus className="h-4 w-4" />
            </ToolButton>

            <Divider />

            <ToolButton label="Rotate left (Shift+R)" onClick={() => rotateBy(-90)} disabled={!ready}>
              <RotateCcw className="h-4 w-4" />
            </ToolButton>
            <ToolButton label="Rotate right (R)" onClick={() => rotateBy(90)} disabled={!ready}>
              <RotateCw className="h-4 w-4" />
            </ToolButton>
            <ToolButton
              label="Mirror horizontally"
              onClick={() => setView((p) => ({ ...p, flipped: !p.flipped }))}
              disabled={!ready}
              active={view.flipped}
            >
              <FlipHorizontal2 className="h-4 w-4" />
            </ToolButton>

            <Divider />

            <ToolButton label="Actual size, 1:1 (1)" onClick={zoomToActualSize} disabled={!ready}>
              <Maximize2 className="h-4 w-4" />
            </ToolButton>
            <button
              type="button"
              onClick={resetView}
              disabled={!ready}
              className={cn(
                'shrink-0 rounded-pill px-3 py-1.5 font-body text-caption text-white/90 outline-none',
                'transition-colors hover:bg-white/15 hover:text-white',
                'focus-visible:ring-2 focus-visible:ring-white/70',
                'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
              )}
              title="Fit to screen (0)"
            >
              Fit
            </button>
          </div>
        </div>

        <p className="ui-sr-only">
          Scroll or pinch to zoom, drag to pan, R to rotate, 1 for actual size, 0 to fit,
          Escape to close.
        </p>
      </div>
    </Portal>
  );
}

export default ScanLightbox;
