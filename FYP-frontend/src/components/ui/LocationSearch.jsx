import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import {
  ATTRIBUTION,
  MIN_QUERY_LENGTH,
  SEARCH_DEBOUNCE_MS,
  lookupPlaces,
} from '../../lib/geocode';
import Field from './Field';
import Input from './Input';
import Spinner from './Spinner';

/* ==========================================================================
   LocationSearch — the design system's FIRST combobox.
   --------------------------------------------------------------------------
   `Select.jsx` says, in as many words, that it stayed a native <select> on
   purpose: a custom listbox costs a roving-tabindex implementation and loses the
   OS picker on mobile. That trade-off is right for a fixed list of options. It
   is impossible here, because the options are FETCHED from what the user types,
   which is exactly the case WAI-ARIA calls a combobox and no native element
   covers. So this is a from-scratch, hand-wired combobox, and the wiring below
   is the APG "combobox with list autocomplete" pattern, not an approximation:

     input   role=combobox, aria-expanded, aria-controls, aria-autocomplete=list,
             aria-activedescendant pointing at the highlighted option
     popup   role=listbox with role=option children carrying aria-selected
     keys    Down/Up (open + move, wrapping), Home/End, Enter (commit),
             Escape (close, then clear), Tab (commit the highlight, then leave)
     speech  a polite live region announcing the settled result COUNT, because
             a sighted user sees the list appear and a screen reader user does not

   THREE THINGS THIS COMPONENT REFUSES TO DO
   -----------------------------------------
   1. It never becomes a required gate. The text stays free: `onTextChange` hands
      the raw keystrokes to the caller so a user whose city is not in
      OpenStreetMap, or who is offline, can type it and move on. A failed lookup
      shows a "type it by hand" notice, not an error.
   2. It never fights the user's typing. `value` is the COMMITTED selection and
      the query text is local state. An incoming `value` only overwrites the box
      when the user is not mid-edit (see the render-time sync below).
   3. It never hammers Nominatim. Every request is debounced, aborted when
      superseded, and served from `lib/geocode`'s cache when repeated.
   ========================================================================== */

const STATUS = Object.freeze({
  IDLE: 'idle',
  SEARCHING: 'searching',
  READY: 'ready',
  EMPTY: 'empty',
  FAILED: 'failed',
});

function SearchIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <circle cx="9" cy="9" r="5.25" stroke="currentColor" strokeWidth="1.75" />
      <path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

function PinIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <path
        d="M10 17.5s5.25-5.02 5.25-9a5.25 5.25 0 1 0-10.5 0c0 3.98 5.25 9 5.25 9Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="8.5" r="1.9" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/** "Islamabad" + "Islamabad Capital Territory, Pakistan" from one long label. */
function splitLabel(label) {
  const separator = label.indexOf(', ');
  if (separator === -1) return { primary: label, secondary: '' };
  return {
    primary: label.slice(0, separator),
    secondary: label.slice(separator + 2),
  };
}

/**
 * Searchable place picker that fills in city, state and country at once.
 *
 * @param {object} props
 * @param {{label?:string, city?:string, state?:string, country?:string,
 *   latitude?:number|null, longitude?:number|null}|null} [props.value]
 *   The COMMITTED selection. `null` means nothing is chosen.
 * @param {(next: object|null) => void} [props.onChange] Fires with the same
 *   shape on selection, and with `null` when the field is cleared.
 * @param {(text: string) => void} [props.onTextChange] Every keystroke, raw.
 *   Wire this when the caller keeps a free-text fallback (it always should).
 * @param {string} [props.label='Location'] Visible field label.
 * @param {string} [props.hint]
 * @param {string} [props.error] Presence flips the control to invalid.
 * @param {string} [props.id] Override the generated control id.
 * @param {string} [props.name] Submitted name for the underlying input.
 * @param {boolean} [props.disabled=false]
 * @param {string} [props.placeholder]
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {number} [props.minLength] Characters before a request is made.
 * @param {number} [props.debounce] Milliseconds of quiet before a request.
 * @param {string} [props.className] Applied to the <Field> wrapper.
 */
export function LocationSearch({
  value = null,
  onChange,
  onTextChange,
  label = 'Location',
  hint,
  error,
  id,
  name,
  disabled = false,
  placeholder = 'Search for a city, hospital or area',
  size = 'md',
  minLength = MIN_QUERY_LENGTH,
  debounce = SEARCH_DEBOUNCE_MS,
  className,
  onKeyDown,
  ...rest
}) {
  const generated = useId();
  const controlId = id ?? `ui-loc-${generated}`;
  const listboxId = `${controlId}-listbox`;
  const optionId = (index) => `${controlId}-option-${index}`;

  const incomingLabel = typeof value?.label === 'string' ? value.label : '';

  const [query, setQuery] = useState(incomingLabel);
  const [syncedLabel, setSyncedLabel] = useState(incomingLabel);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState(STATUS.IDLE);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [nonce, setNonce] = useState(0);
  /** The user is driving this field: they typed, or opened the list with a key.
   *  Cleared by a commit, a clear and a blur. Doing double duty as the fetch
   *  effect's arming flag is what stops a search firing on mount and stops the
   *  echo of a committed selection triggering a second lookup for its own label. */
  const [editing, setEditing] = useState(false);

  const inputRef = useRef(null);
  const listRef = useRef(null);
  const wrapperRef = useRef(null);
  /** True while the input holds focus. Read only from the fetch continuation,
   *  where a `focused` state value would be a stale closure capture: a response
   *  must not pop the list open under a user who has already moved on. */
  const focusedRef = useRef(false);

  /* -- external value -> query text -------------------------------------- *
   * Adjusting state during render is the documented React pattern for "a prop
   * changed and derived state must follow", and it is the right tool here: an
   * effect would paint one frame of the stale text first, which reads as the box
   * flickering back to the old city when the map pin resolves.
   *
   * The `editing` guard is what makes it safe. While the user is typing, the
   * caller is echoing those same keystrokes back through `value.label`;
   * accepting them is harmless in the common case and would eat a character the
   * moment a caller batched its state update a tick late. So mid-edit we record
   * the new label and leave the text alone.                                     */
  if (incomingLabel !== syncedLabel) {
    setSyncedLabel(incomingLabel);
    if (!editing) setQuery(incomingLabel);
  }

  /* -- debounced, abortable fetch ---------------------------------------- *
   * Every state write lives inside the promise continuation, so nothing is set
   * synchronously during the effect. The cleanup does the three things a
   * type-ahead has to do: stop the pending timer, abort the in-flight request,
   * and mark the closure dead so a response that lost the race is ignored.     */
  useEffect(() => {
    const trimmed = query.trim();
    if (!editing || trimmed.length < minLength) return undefined;

    let live = true;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;

    const timer = setTimeout(() => {
      lookupPlaces(trimmed, { signal: controller?.signal }).then((outcome) => {
        if (!live || outcome.status === 'aborted') return;
        setActiveIndex(-1);
        if (outcome.status === 'failed') {
          setResults([]);
          setStatus(STATUS.FAILED);
          setOpen(false);
          return;
        }
        setResults(outcome.results);
        setStatus(outcome.results.length ? STATUS.READY : STATUS.EMPTY);
        if (focusedRef.current) setOpen(true);
      });
    }, debounce);

    return () => {
      live = false;
      controller?.abort();
      clearTimeout(timer);
    };
  }, [query, nonce, editing, minLength, debounce]);

  /* -- close when a pointer lands outside -------------------------------- *
   * Blur alone is not enough: tapping a non-focusable area on iOS leaves the
   * input focused, so the list would hang around over the content below.       */
  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (wrapperRef.current?.contains(event.target)) return;
      setOpen(false);
      setActiveIndex(-1);
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [open]);

  /* -- keep the highlighted row in view --------------------------------- */
  useEffect(() => {
    if (!open || activeIndex < 0) return;
    const row = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [open, activeIndex]);

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
  }, []);

  /**
   * Commit a place. `refocus` is false on Tab, where the browser is already
   * moving focus and stealing it back would trap the user in the field.
   */
  const selectPlace = useCallback((place, refocus = true) => {
    if (!place) return;
    setEditing(false);
    setQuery(place.label);
    setResults([]);
    setStatus(STATUS.IDLE);
    setOpen(false);
    setActiveIndex(-1);
    onChange?.({
      label: place.label,
      city: place.city,
      state: place.state,
      country: place.country,
      latitude: place.latitude,
      longitude: place.longitude,
    });
    if (refocus) inputRef.current?.focus();
  }, [onChange]);

  const clearSelection = useCallback(() => {
    setEditing(false);
    setQuery('');
    setResults([]);
    setStatus(STATUS.IDLE);
    setOpen(false);
    setActiveIndex(-1);
    onChange?.(null);
    onTextChange?.('');
    inputRef.current?.focus();
  }, [onChange, onTextChange]);

  const handleInput = (event) => {
    const next = event.target.value;
    setEditing(true);
    setQuery(next);
    setActiveIndex(-1);
    if (next.trim().length >= minLength) {
      // Deliberately NOT opening the popup here. An open popup means "there is
      // something to pick", so it appears when the answer does; progress lives
      // in the field's own spinner. Opening optimistically would also let a
      // still-empty popup swallow the Enter key, and this field is optional.
      // An ALREADY open popup stays open and shows a searching strip.
      setStatus(STATUS.SEARCHING);
    } else {
      setResults([]);
      setStatus(STATUS.IDLE);
      setOpen(false);
    }
    onTextChange?.(next);
  };

  /** Down/Up on a closed combobox. Re-arms the search when nothing is cached. */
  const openList = (index) => {
    if (results.length) {
      setOpen(true);
      setActiveIndex(index);
      return;
    }
    if (query.trim().length < minLength) return;
    setEditing(true);
    setStatus(STATUS.SEARCHING);
    setOpen(true);
    setNonce((current) => current + 1);
  };

  const retry = () => {
    if (query.trim().length < minLength) {
      inputRef.current?.focus();
      return;
    }
    setEditing(true);
    setStatus(STATUS.SEARCHING);
    setNonce((current) => current + 1);
    inputRef.current?.focus();
  };

  const handleKeyDown = (event) => {
    onKeyDown?.(event);
    if (disabled || event.defaultPrevented) return;
    const count = results.length;

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        if (!open) openList(count ? 0 : -1);
        else if (count) setActiveIndex((current) => (current + 1) % count);
        return;

      case 'ArrowUp':
        event.preventDefault();
        if (!open) openList(count ? count - 1 : -1);
        else if (count) setActiveIndex((current) => (current <= 0 ? count - 1 : current - 1));
        return;

      case 'Home':
        if (open && count) {
          event.preventDefault();
          setActiveIndex(0);
        }
        return;

      case 'End':
        if (open && count) {
          event.preventDefault();
          setActiveIndex(count - 1);
        }
        return;

      case 'Enter':
        // Only a popup with something IN it may swallow Enter. A closed field
        // leaves the key to the form, because "Create account" has to keep
        // working for a doctor who typed a city and never opened a list.
        if (!open) return;
        event.preventDefault();
        if (count && activeIndex >= 0 && results[activeIndex]) selectPlace(results[activeIndex]);
        else close();
        return;

      case 'Escape':
        // Escape dismisses the list first and only clears the field on a second
        // press, and it stops propagating so it cannot also close a surrounding
        // Modal out from under the user (the same rule SearchInput follows).
        if (open) {
          event.preventDefault();
          event.stopPropagation();
          close();
        } else if (query) {
          event.preventDefault();
          event.stopPropagation();
          clearSelection();
        }
        return;

      case 'Tab':
        // APG: Tab commits the highlighted option, THEN moves on. No
        // preventDefault, so focus still leaves the field.
        if (open && activeIndex >= 0 && results[activeIndex]) {
          selectPlace(results[activeIndex], false);
        } else if (open) {
          close();
        }
        return;

      default:
    }
  };

  const handleFocus = () => {
    focusedRef.current = true;
  };

  const handleBlur = (event) => {
    // Focus moving to the clear button, which lives inside this wrapper, is not
    // a blur as far as the popup is concerned.
    if (event.relatedTarget && wrapperRef.current?.contains(event.relatedTarget)) return;
    focusedRef.current = false;
    // Leaving the field ends the edit, which also cancels any pending lookup and
    // hands authority over the text back to `value`.
    setEditing(false);
    close();
  };

  const searching = status === STATUS.SEARCHING;
  const hasText = query.trim().length > 0;
  // Coordinates, not text: the pin means "this resolved to a real place on the
  // map", and free text the user is still typing has not.
  const pinned = Boolean(
    value && Number.isFinite(value.latitude) && Number.isFinite(value.longitude),
  );

  /** What a screen reader hears once a search settles. Never on every keystroke. */
  const liveMessage = (() => {
    if (status === STATUS.FAILED) {
      return 'Location search is unavailable. You can type your city instead.';
    }
    if (!open) return '';
    if (status === STATUS.EMPTY) return 'No matching places. You can type your city instead.';
    if (status === STATUS.READY && results.length) {
      return `${results.length} ${results.length === 1 ? 'place' : 'places'} found. `
        + 'Use the up and down arrow keys to review them.';
    }
    return '';
  })();

  return (
    <Field label={label} hint={hint} error={error} id={controlId} disabled={disabled} className={className}>
      <div
        ref={wrapperRef}
        className="relative w-full"
        onFocus={handleFocus}
        onBlur={handleBlur}
      >
        <Input
          ref={inputRef}
          size={size}
          name={name}
          type="text"
          role="combobox"
          value={query}
          onChange={handleInput}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          // Browser autofill would drop a saved value into a box whose listbox
          // knows nothing about it, so the two suggestion UIs would overlap.
          autoComplete="off"
          spellCheck={false}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          // A pin once something is committed, a magnifier while still hunting:
          // the icon is the only always-visible proof the field resolved.
          leftIcon={pinned ? <PinIcon className="h-4 w-4" /> : <SearchIcon className="h-4 w-4" />}
          suffix={searching ? (
            <Spinner size="xs" label="Searching for places" />
          ) : hasText ? (
            <button
              type="button"
              onClick={clearSelection}
              disabled={disabled}
              aria-label="Clear location"
              className={cn(
                'flex h-5 w-5 items-center justify-center rounded-pill text-subtle',
                'transition-colors hover:bg-surface-sunken hover:text-default',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
              )}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
                <path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </button>
          ) : undefined}
          {...rest}
        />

        {open && (
          <div
            className={cn(
              'absolute left-0 right-0 top-full z-dropdown mt-1.5 overflow-hidden',
              'rounded-card border border-default bg-surface-raised shadow-popover',
              'animate-ui-slide-down',
            )}
          >
            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label={`${label} suggestions`}
              className="max-h-64 overflow-y-auto overscroll-contain py-1"
            >
              {results.map((place, index) => {
                const { primary, secondary } = splitLabel(place.label);
                const active = index === activeIndex;
                return (
                  <li
                    key={place.id}
                    id={optionId(index)}
                    role="option"
                    aria-selected={active}
                    data-index={index}
                    // Keep focus on the input so `aria-activedescendant` stays
                    // the single source of truth for "where am I".
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => selectPlace(place)}
                    className={cn(
                      'mx-1 flex cursor-pointer items-start gap-2.5 rounded-control px-2.5 py-2',
                      'text-left transition-colors',
                      active
                        ? 'bg-primary-100 ring-2 ring-inset ring-primary-600'
                        : 'hover:bg-surface-sunken',
                    )}
                  >
                    <PinIcon className="mt-0.5 h-4 w-4 shrink-0 text-accent-700 dark:text-accent-400" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-body text-body-sm font-semibold text-default">
                        {primary}
                      </span>
                      {secondary && (
                        <span className="block truncate font-body text-caption text-muted">
                          {secondary}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>

            {searching && results.length === 0 && (
              <p className="flex items-center gap-2 px-3 py-3 font-body text-body-sm text-muted">
                <Spinner size="xs" label={null} />
                Searching for places…
              </p>
            )}

            {status === STATUS.EMPTY && (
              <p className="px-3 py-3 font-body text-body-sm text-muted">
                No places match that search. Type your city and carry on, we will keep what you type.
              </p>
            )}

            {results.length > 0 && (
              <p className="border-t border-default px-3 py-1.5 font-body text-caption text-subtle">
                {ATTRIBUTION}
              </p>
            )}
          </div>
        )}

        {/* Announced, never shown: sighted users watch the list appear. */}
        <span className="ui-sr-only" role="status" aria-live="polite">
          {liveMessage}
        </span>
      </div>

      {status === STATUS.FAILED && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-body text-caption text-warning-600">
          <span>Location search is unavailable right now. Type your city and carry on.</span>
          <button
            type="button"
            onClick={retry}
            className={cn(
              'rounded-control px-1.5 py-0.5 font-semibold underline underline-offset-2',
              'outline-none hover:bg-surface-sunken focus-visible:ring-2 focus-visible:ring-focus',
            )}
          >
            Try again
          </button>
        </div>
      )}
    </Field>
  );
}

export default LocationSearch;
