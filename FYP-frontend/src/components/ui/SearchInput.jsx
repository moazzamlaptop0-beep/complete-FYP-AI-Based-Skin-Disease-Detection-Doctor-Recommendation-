import React, { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import Input from './Input';
import Spinner from './Spinner';

function SearchIcon(props) {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" {...props}>
      <circle cx="9" cy="9" r="5.25" stroke="currentColor" strokeWidth="1.75" />
      <path d="m13 13 4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Search field with a clear button and optional debounced change.
 *
 * Notes:
 *  - `type="search"` gives mobile keyboards a "Search" key and lets the OS
 *    offer history, but we suppress the native WebKit clear button (`ui-no-search-cancel`)
 *    because ours is keyboard-reachable and consistently placed.
 *  - `onDebouncedChange` fires `debounce`ms after typing stops. `onChange`
 *    still fires on every keystroke so a controlled parent stays in sync —
 *    debouncing the *input value* itself makes the field feel broken.
 *  - Escape clears the field (standard search affordance) before it can bubble
 *    to a surrounding Modal, so users do not accidentally close the dialog.
 *
 * @param {object} props
 * @param {string} [props.value] Controlled value.
 * @param {string} [props.defaultValue]
 * @param {(event: React.ChangeEvent<HTMLInputElement>) => void} [props.onChange]
 * @param {(value: string) => void} [props.onDebouncedChange] Receives the VALUE after `debounce` ms.
 * @param {number} [props.debounce=250]
 * @param {() => void} [props.onClear] Called when the field is cleared.
 * @param {string} [props.placeholder='Search']
 * @param {boolean} [props.loading=false] Shows a spinner in place of the clear button.
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {string} [props['aria-label']] Defaults to the placeholder.
 * @param {string} [props.className]
 */
const SearchInput = forwardRef(function SearchInput(
  {
    value,
    defaultValue = '',
    onChange,
    onDebouncedChange,
    debounce = 250,
    onClear,
    placeholder = 'Search',
    loading = false,
    size = 'md',
    className,
    onKeyDown,
    ...rest
  },
  ref,
) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const current = controlled ? value : internal;

  const innerRef = useRef(null);
  const timerRef = useRef(null);
  const debouncedRef = useRef(onDebouncedChange);
  const skipFirst = useRef(true);

  useEffect(() => {
    debouncedRef.current = onDebouncedChange;
  }, [onDebouncedChange]);

  const setRefs = useCallback(
    (node) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // Debounce off the resolved value so it works controlled AND uncontrolled.
  useEffect(() => {
    if (!debouncedRef.current) return undefined;
    // Do not fire on mount — that would trigger a search for the initial value
    // on every page load.
    if (skipFirst.current) {
      skipFirst.current = false;
      return undefined;
    }
    timerRef.current = setTimeout(() => debouncedRef.current?.(current), debounce);
    return () => clearTimeout(timerRef.current);
  }, [current, debounce]);

  const emit = (next) => {
    if (!controlled) setInternal(next);
  };

  const handleChange = (event) => {
    emit(event.target.value);
    onChange?.(event);
  };

  const handleClear = () => {
    emit('');
    onClear?.();
    // Synthesise a change so controlled parents reset too.
    if (onChange) {
      onChange({ target: { value: '', name: rest.name }, currentTarget: { value: '' } });
    }
    innerRef.current?.focus();
  };

  const handleKeyDown = (event) => {
    onKeyDown?.(event);
    if (event.key === 'Escape' && current) {
      event.preventDefault();
      event.stopPropagation();
      handleClear();
    }
  };

  const hasValue = Boolean(current);

  return (
    <Input
      ref={setRefs}
      type="search"
      role="searchbox"
      size={size}
      value={controlled ? value : undefined}
      defaultValue={controlled ? undefined : defaultValue}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      aria-label={rest['aria-label'] ?? placeholder}
      leftIcon={<SearchIcon className="h-4 w-4" />}
      className={cn('ui-no-search-cancel', className)}
      suffix={
        loading ? (
          <Spinner size="xs" label="Searching" />
        ) : hasValue ? (
          <button
            type="button"
            onClick={handleClear}
            aria-label="Clear search"
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
        ) : undefined
      }
      {...rest}
    />
  );
});

export { SearchInput };
export default SearchInput;
