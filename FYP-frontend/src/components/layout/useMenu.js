/**
 * useMenu — one keyboard/focus implementation for every dropdown in the chrome.
 *
 * ProfileMenu, WorkspaceSwitcher and NotificationBell all need the identical
 * behaviour the WAI-ARIA menu-button pattern demands, and hand-rolling it three
 * times is how two of them end up unusable with a keyboard:
 *
 *   - trigger: aria-haspopup="menu", aria-expanded, opens on click,
 *     ArrowDown opens AND focuses the first item, ArrowUp the last
 *   - items: ArrowUp/ArrowDown roving focus, Home/End, Esc closes and returns
 *     focus to the trigger, Tab closes
 *   - pointer: click outside closes; a scroll or resize closes (the panel is
 *     anchored, and an anchored panel that stays put after a scroll is worse
 *     than one that disappears)
 *
 * It returns prop-getters rather than rendering anything, so each menu keeps
 * full control of its own markup.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * @param {{itemCount: number, onSelect?: (index:number)=>void, closeOnScroll?: boolean}} options
 */
export function useMenu({ itemCount = 0, closeOnScroll = true } = {}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  // Index -> DOM node. A Map rather than an array so a shrinking item list
  // cannot leave a stale node behind, and so nothing has to be trimmed during
  // render (mutating a ref while rendering is a React rules violation).
  const itemRefs = useRef(new Map());

  const focusItem = useCallback((index) => {
    if (index < 0 || index >= itemCount) return;
    setActiveIndex(index);
    // Focus after paint: on the opening keystroke the items do not exist yet.
    requestAnimationFrame(() => {
      itemRefs.current.get(index)?.focus?.();
    });
  }, [itemCount]);

  const close = useCallback((returnFocus = true) => {
    setOpen(false);
    setActiveIndex(-1);
    if (returnFocus) triggerRef.current?.focus?.();
  }, []);

  const openMenu = useCallback((index = -1) => {
    setOpen(true);
    if (index >= 0) focusItem(index);
    else setActiveIndex(-1);
  }, [focusItem]);

  const toggle = useCallback(() => {
    setOpen((prev) => {
      if (prev) setActiveIndex(-1);
      return !prev;
    });
  }, []);

  // -- outside click / scroll / resize ---------------------------------------
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;

    const onPointerDown = (event) => {
      const target = event.target;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      // No focus return: the user is clicking somewhere else on purpose.
      setOpen(false);
      setActiveIndex(-1);
    };

    const onScrollOrResize = () => {
      setOpen(false);
      setActiveIndex(-1);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('resize', onScrollOrResize);
    if (closeOnScroll) window.addEventListener('scroll', onScrollOrResize, true);

    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('resize', onScrollOrResize);
      if (closeOnScroll) window.removeEventListener('scroll', onScrollOrResize, true);
    };
  }, [open, closeOnScroll]);

  // -- prop getters ----------------------------------------------------------
  const getTriggerProps = useCallback((props = {}) => ({
    ...props,
    ref: (node) => {
      triggerRef.current = node;
      if (typeof props.ref === 'function') props.ref(node);
      else if (props.ref) props.ref.current = node;
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open,
    onClick: (event) => {
      props.onClick?.(event);
      if (event.defaultPrevented) return;
      toggle();
    },
    onKeyDown: (event) => {
      props.onKeyDown?.(event);
      if (event.defaultPrevented) return;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        openMenu(0);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        openMenu(itemCount - 1);
      } else if (event.key === 'Escape' && open) {
        event.preventDefault();
        close();
      }
    },
  }), [open, toggle, openMenu, itemCount, close]);

  const getMenuProps = useCallback((props = {}) => ({
    ...props,
    ref: (node) => {
      menuRef.current = node;
      if (typeof props.ref === 'function') props.ref(node);
      else if (props.ref) props.ref.current = node;
    },
    role: 'menu',
    tabIndex: -1,
    onKeyDown: (event) => {
      props.onKeyDown?.(event);
      if (event.defaultPrevented) return;
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          close();
          break;
        case 'Tab':
          // Let focus leave naturally, but do not leave a ghost panel behind.
          setOpen(false);
          setActiveIndex(-1);
          break;
        case 'ArrowDown':
          event.preventDefault();
          focusItem(activeIndex + 1 >= itemCount ? 0 : activeIndex + 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          focusItem(activeIndex - 1 < 0 ? itemCount - 1 : activeIndex - 1);
          break;
        case 'Home':
          event.preventDefault();
          focusItem(0);
          break;
        case 'End':
          event.preventDefault();
          focusItem(itemCount - 1);
          break;
        default:
          break;
      }
    },
  }), [close, focusItem, activeIndex, itemCount]);

  const getItemProps = useCallback((index, props = {}) => ({
    ...props,
    ref: (node) => {
      if (node) itemRefs.current.set(index, node);
      else itemRefs.current.delete(index);
    },
    role: 'menuitem',
    tabIndex: index === activeIndex ? 0 : -1,
    onFocus: (event) => {
      props.onFocus?.(event);
      setActiveIndex(index);
    },
    onClick: (event) => {
      props.onClick?.(event);
      if (event.defaultPrevented) return;
      // Selecting always dismisses; returning focus to the trigger would fight
      // a navigation, so only do it for in-place actions.
      setOpen(false);
      setActiveIndex(-1);
    },
  }), [activeIndex]);

  return useMemo(() => ({
    open,
    activeIndex,
    openMenu,
    close,
    toggle,
    triggerRef,
    menuRef,
    getTriggerProps,
    getMenuProps,
    getItemProps,
  }), [open, activeIndex, openMenu, close, toggle, getTriggerProps, getMenuProps, getItemProps]);
}

export default useMenu;
