import React, { forwardRef, useCallback, useLayoutEffect, useRef } from 'react';
import { cn } from '../../lib/cn';
import { useControlA11y } from './Field';
import { controlBase, controlInvalid } from './Input';

/**
 * Multi-line text control with optional auto-grow and a character counter.
 *
 * The counter is `aria-live="polite"` only past 80% of `maxLength`, so it stays
 * silent during normal typing and warns only when the limit is close.
 *
 * @param {object} props
 * @param {number} [props.rows=4] Initial visible rows.
 * @param {boolean} [props.autoResize=false] Grow with content instead of scrolling.
 * @param {number} [props.maxLength] Enables the character counter.
 * @param {boolean} [props.showCount=false] Force-show the counter (implied by `maxLength`).
 * @param {string} [props.error] Standalone error text (prefer `<Field error>`).
 * @param {string} [props.hint] Standalone hint text (prefer `<Field hint>`).
 * @param {string} [props.className]
 */
const Textarea = forwardRef(function Textarea(
  {
    rows = 4,
    autoResize = false,
    maxLength,
    showCount = false,
    error,
    hint,
    className,
    id,
    required,
    disabled,
    value,
    defaultValue,
    onChange,
    'aria-describedby': ariaDescribedBy,
    ...rest
  },
  ref,
) {
  const a11y = useControlA11y({
    id,
    required,
    disabled,
    error,
    hint,
    'aria-describedby': ariaDescribedBy,
  });
  const innerRef = useRef(null);

  const setRefs = useCallback(
    (node) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  const resize = useCallback(() => {
    const node = innerRef.current;
    if (!node || !autoResize) return;
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [autoResize]);

  useLayoutEffect(resize, [resize, value]);

  const handleChange = (event) => {
    onChange?.(event);
    resize();
  };

  const length = String(value ?? defaultValue ?? '').length;
  const counterVisible = Boolean(maxLength) || showCount;
  const nearLimit = Boolean(maxLength) && length >= maxLength * 0.8;

  return (
    <div className="w-full">
      <textarea
        ref={setRefs}
        id={a11y.id}
        rows={rows}
        maxLength={maxLength}
        value={value}
        defaultValue={defaultValue}
        onChange={handleChange}
        required={a11y.required || undefined}
        disabled={a11y.disabled || undefined}
        aria-invalid={a11y.invalid || undefined}
        aria-describedby={a11y.describedBy}
        aria-required={a11y.required || undefined}
        className={cn(
          controlBase,
          'ui-scrollbar min-h-[5rem] px-3.5 py-2.5 text-body-md',
          autoResize ? 'resize-none overflow-hidden' : 'resize-y',
          a11y.invalid && controlInvalid,
          className,
        )}
        {...rest}
      />
      {counterVisible && (
        <div
          aria-live={nearLimit ? 'polite' : 'off'}
          className={cn(
            'mt-1 text-right font-numeric text-caption tabular-nums',
            nearLimit ? 'text-warning-600 dark:text-warning-500' : 'text-subtle',
          )}
        >
          {length}
          {maxLength ? ` / ${maxLength}` : ''}
        </div>
      )}
    </div>
  );
});

export { Textarea };
export default Textarea;
