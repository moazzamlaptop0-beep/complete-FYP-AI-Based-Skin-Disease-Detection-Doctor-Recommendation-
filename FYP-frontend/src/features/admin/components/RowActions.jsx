/**
 * RowActions — the overflow menu for a table row.
 *
 * WHY A MENU AND NOT MORE BUTTONS
 * -------------------------------
 * Once an admin can review, edit, reset a password, act as, suspend and delete,
 * the Actions column is six controls wide and the row's actual data gets squeezed
 * off the right of the screen — on a laptop, never mind a tablet. One primary
 * button plus a menu keeps the table readable and, more usefully, makes the
 * hierarchy explicit: the thing you came to do is a button, the rest are choices.
 *
 * WHY IT IS PORTALLED AND `position: fixed`
 * -----------------------------------------
 * DataTable's desktop wrapper is `overflow-x-auto` so a wide table can scroll.
 * Setting either axis to `auto` forces the OTHER axis's computed `overflow` away
 * from `visible` — so a plainly-absolute panel inside a table cell is CLIPPED at
 * the table's bottom edge, and on the last row that means the menu is invisible.
 * Portalling out of the table and positioning against the trigger's viewport rect
 * is the fix. `useMenu` already closes on scroll and resize (that is what
 * `closeOnScroll` is for), so the measured position can never go stale while the
 * panel is open.
 *
 * DISABLED ITEMS KEEP THEIR REASON
 * --------------------------------
 * Every destructive action here has server-side refusals (root accounts, your own
 * account, an account at or above your rank). Those items render disabled with
 * the reason as ordinary text UNDER the label rather than in a tooltip: a
 * disabled control swallows pointer events, and inside a menu a tooltip you
 * cannot hover is a reason nobody reads.
 *
 * Keyboard and focus come from `useMenu`, the same implementation ProfileMenu and
 * WorkspaceSwitcher use, so this is not a fourth hand-rolled dropdown.
 */

import React, { useCallback, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';

import { IconButton, Portal, cn } from '../../../components/ui';
import useMenu from '../../../components/layout/useMenu';

/** Panel width, in px. Needed as a number to keep it inside the viewport. */
const PANEL_WIDTH = 244;
/** Breathing room from the viewport edge. */
const EDGE_GUTTER = 8;

/**
 * @typedef {object} RowAction
 * @property {string} id
 * @property {string} label
 * @property {() => void} onSelect
 * @property {React.ComponentType} [icon]
 * @property {string|null} [disabledReason] Non-null renders the item disabled.
 * @property {boolean} [danger] Red styling for a destructive action.
 * @property {boolean} [separatorBefore] Rule above this item.
 */

/**
 * @param {object} props
 * @param {RowAction[]} props.actions Falsy entries are dropped, so a caller can
 *   inline `condition && {...}` without filtering first.
 * @param {string} props.label Accessible name, e.g. "Actions for Asma Riaz".
 * @param {'left'|'right'} [props.align='right'] Which edge of the trigger the
 *   panel lines up with. Flipped automatically when it would overflow.
 */
export function RowActions({ actions, label, align = 'right', className }) {
  const items = (actions || []).filter(Boolean);
  const menu = useMenu({ itemCount: items.length });
  const [coords, setCoords] = useState(null);

  /**
   * Measure the trigger and decide where the panel goes.
   *
   * Done in the OPENING EVENT rather than a layout effect: the rect read and the
   * `setCoords` land in the same batch as `useMenu`'s own open, so the panel's
   * first render already has its final position — no measure-then-reposition
   * pass, and no frame where it could paint somewhere wrong.
   */
  const measure = useCallback(() => {
    const trigger = menu.triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();

    let left = align === 'right' ? rect.right - PANEL_WIDTH : rect.left;
    // Keep it on screen whichever edge it was asked to hug.
    left = Math.min(left, window.innerWidth - PANEL_WIDTH - EDGE_GUTTER);
    left = Math.max(EDGE_GUTTER, left);

    // Flip above the trigger when there is not room below — the last row of a
    // long table is exactly where this menu is most likely to be opened.
    const estimatedHeight = items.length * 44 + 16;
    const roomBelow = window.innerHeight - rect.bottom;
    const openUp = roomBelow < estimatedHeight && rect.top > roomBelow;

    setCoords({
      left,
      ...(openUp
        ? { bottom: window.innerHeight - rect.top + 4 }
        : { top: rect.bottom + 4 }),
    });
  }, [menu.triggerRef, align, items.length]);

  if (!items.length) return null;

  return (
    <>
      <IconButton
        {...menu.getTriggerProps({
          'aria-label': label,
          // getTriggerProps runs these BEFORE its own toggle and only bails on
          // event.defaultPrevented, which neither of these sets.
          onClick: measure,
          onKeyDown: (event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') measure();
          },
        })}
        size="sm"
        variant="ghost"
        className={className}
      >
        <MoreHorizontal />
      </IconButton>

      {menu.open && coords ? (
        <Portal>
          <div
            {...menu.getMenuProps({ 'aria-label': label })}
            style={{ position: 'fixed', width: PANEL_WIDTH, ...coords }}
            className={cn(
              'z-dropdown overflow-hidden rounded-card border border-subtle',
              'bg-surface py-1 shadow-popover animate-ui-fade-in',
            )}
          >
            {items.map((action, index) => {
              const Icon = action.icon;
              const disabled = Boolean(action.disabledReason);
              return (
                <React.Fragment key={action.id}>
                  {action.separatorBefore ? (
                    <div role="separator" className="my-1 border-t border-subtle" />
                  ) : null}
                  <button
                    type="button"
                    {...menu.getItemProps(index, {
                      onClick: (event) => {
                        if (disabled) {
                          // Stop useMenu closing the panel: a click that does
                          // nothing should not also hide the explanation of why.
                          event.preventDefault();
                          return;
                        }
                        action.onSelect?.();
                      },
                    })}
                    aria-disabled={disabled || undefined}
                    className={cn(
                      'flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors',
                      'outline-none focus-visible:bg-surface-sunken',
                      disabled
                        ? 'cursor-not-allowed text-subtle'
                        : action.danger
                          ? 'text-danger-700 hover:bg-danger-50 dark:text-danger-400 dark:hover:bg-danger-950/40'
                          : 'text-default hover:bg-surface-sunken',
                    )}
                  >
                    {Icon ? <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : null}
                    <span className="min-w-0 flex-1">
                      <span className="block text-body-sm">{action.label}</span>
                      {disabled ? (
                        <span className="mt-0.5 block text-caption text-muted">
                          {action.disabledReason}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </React.Fragment>
              );
            })}
          </div>
        </Portal>
      ) : null}
    </>
  );
}

export default RowActions;
