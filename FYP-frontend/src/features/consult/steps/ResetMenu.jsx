/**
 * ResetMenu — the three ways out of a result, spelled out.
 *
 * The single most-requested change to this flow was "let me start again". That
 * turned out to be three different wishes, and collapsing them into one button
 * is what made the old page frustrating:
 *
 *   "Re-analyse this photo"  the photo is fine, the verdict looked wrong.
 *   "Replace photo"          the photo was bad; the doctors and times I picked
 *                            are still the ones I want.
 *   "Start over"             throw the lot away.
 *
 * Each one names exactly what it keeps, because "Reset" that silently discards
 * three doctors and five time slots is the bug we are fixing, not a UX detail.
 * The destructive one — and only the destructive one — asks for confirmation.
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ChevronDown, ImageUp, RefreshCw, Trash2 } from 'lucide-react';

import { Button, ConfirmDialog, cn } from '../../../components/ui';

/** @type {ReadonlyArray<{id:string, label:string, keeps:string, icon:any, tone:string}>} */
const OPTIONS = Object.freeze([
  Object.freeze({
    id: 'reanalyze',
    label: 'Re-analyse this photo',
    keeps: 'Keeps the photo, your answers, doctors and times.',
    icon: RefreshCw,
  }),
  Object.freeze({
    id: 'replace',
    label: 'Replace photo',
    keeps: 'Keeps your answers, doctors and times. Asks for a new picture.',
    icon: ImageUp,
  }),
  Object.freeze({
    id: 'startover',
    label: 'Start over',
    keeps: 'Clears everything, including the doctors and times you chose.',
    icon: Trash2,
    destructive: true,
  }),
]);

/**
 * @param {object} props
 * @param {() => void} [props.onReanalyze] Omit to HIDE "Re-analyse this photo" —
 *   a restored draft has the verdict but not the File, and an entry that cannot
 *   do what its own caption promises ("Keeps the photo…") is worse than absent.
 * @param {() => void} props.onReplacePhoto
 * @param {() => void} props.onStartOver
 * @param {string} [props.className]
 */
export default function ResetMenu({ onReanalyze, onReplacePhoto, onStartOver, className }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const containerRef = useRef(null);
  const triggerRef = useRef(null);
  const menuId = useId();

  const close = useCallback(() => setOpen(false), []);

  // Click-away and Escape. A menu that only closes when you pick something is a
  // trap on a phone, where there is nowhere else to click but the page.
  useEffect(() => {
    if (!open) return undefined;

    const onPointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) close();
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        close();
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('touchstart', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('touchstart', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, close]);

  const handleSelect = useCallback(
    (id) => {
      close();
      if (id === 'reanalyze') onReanalyze?.();
      else if (id === 'replace') onReplacePhoto?.();
      else if (id === 'startover') setConfirming(true);
    },
    [close, onReanalyze, onReplacePhoto],
  );

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <Button
        ref={triggerRef}
        variant="outline"
        size="sm"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        rightIcon={
          <ChevronDown
            aria-hidden="true"
            className={cn('h-4 w-4 transition-transform duration-200', open && 'rotate-180')}
          />
        }
      >
        Start again
      </Button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Ways to start again"
          className={cn(
            'absolute right-0 z-dropdown mt-2 w-[min(20rem,calc(100vw-2rem))]',
            'overflow-hidden rounded-card border border-subtle bg-surface shadow-popover',
          )}
        >
          {OPTIONS.filter((option) => option.id !== 'reanalyze' || typeof onReanalyze === 'function').map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                role="menuitem"
                onClick={() => handleSelect(option.id)}
                className={cn(
                  'flex w-full items-start gap-3 border-b border-subtle p-3 text-left last:border-b-0',
                  'outline-none transition-colors',
                  'hover:bg-surface-sunken focus-visible:bg-surface-sunken',
                  'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus',
                )}
              >
                <Icon
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 h-4 w-4 shrink-0',
                    option.destructive ? 'text-danger-600' : 'text-primary-600',
                  )}
                />
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block text-label-md',
                      option.destructive ? 'text-danger-700 dark:text-danger-400' : 'text-default',
                    )}
                  >
                    {option.label}
                  </span>
                  <span className="mt-0.5 block text-caption text-subtle">{option.keeps}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onStartOver?.();
        }}
        tone="danger"
        title="Start over?"
        confirmLabel="Yes, clear everything"
        cancelLabel="Keep what I have"
        description={
          'The photo, the result, your answers, the doctors you picked and the times you offered '
          + 'will all be cleared. If you only want a different picture, choose "Replace photo" '
          + 'instead — that keeps your choices.'
        }
      />
    </div>
  );
}
