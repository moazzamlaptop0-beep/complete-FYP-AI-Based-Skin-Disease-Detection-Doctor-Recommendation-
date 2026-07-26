import React, { createContext, useContext, useId, useMemo } from 'react';
import { cn } from '../../lib/cn';

/**
 * @typedef {object} FieldContextValue
 * @property {string} id            id given to the control
 * @property {string} labelId       id of the <Label>
 * @property {string} hintId        id of the hint text
 * @property {string} errorId       id of the error text
 * @property {string|undefined} describedBy  space-joined ids for aria-describedby
 * @property {boolean} invalid
 * @property {boolean} required
 * @property {boolean} disabled
 */

/** @type {React.Context<FieldContextValue|null>} */
const FieldContext = createContext(null);

/**
 * Read the surrounding <Field>. Returns `null` when a control is used
 * standalone, in which case the control falls back to its own props.
 * @returns {FieldContextValue|null}
 */
export function useFieldContext() {
  return useContext(FieldContext);
}

/**
 * Resolve the a11y wiring for a control, whether or not it sits in a <Field>.
 * Every input primitive in this system calls this so that id / label /
 * aria-describedby / aria-invalid are always consistent.
 *
 * @param {object} props
 * @param {string} [props.id]
 * @param {string} [props.error]
 * @param {string} [props.hint]
 * @param {boolean} [props.required]
 * @param {boolean} [props.disabled]
 * @param {string} [props['aria-describedby']]
 */
export function useControlA11y({
  id,
  error,
  hint,
  required,
  disabled,
  'aria-describedby': ariaDescribedBy,
} = {}) {
  const generated = useId();
  const field = useFieldContext();

  const resolvedId = id ?? field?.id ?? `ui-${generated}`;
  const invalid = Boolean(error) || Boolean(field?.invalid);

  const describedBy =
    [
      ariaDescribedBy,
      field?.describedBy,
      !field && hint ? `${resolvedId}-hint` : null,
      !field && error ? `${resolvedId}-error` : null,
    ]
      .filter(Boolean)
      .join(' ') || undefined;

  return {
    id: resolvedId,
    invalid,
    describedBy,
    required: required ?? field?.required ?? false,
    disabled: disabled ?? field?.disabled ?? false,
    hintId: `${resolvedId}-hint`,
    errorId: `${resolvedId}-error`,
  };
}

/**
 * Groups a label, a control, a hint and an error message, and wires the ARIA
 * relationships between them exactly once.
 *
 * Only the *error* is announced assertively; the hint is a plain description.
 * When both are present, `aria-describedby` lists hint then error so the
 * screen reader reads the guidance before the failure.
 *
 * @param {object} props
 * @param {string} [props.label] Convenience — renders a <Label> automatically.
 * @param {string} [props.hint] Helper text shown under the control.
 * @param {string} [props.error] Error text; presence flips the control to invalid.
 * @param {boolean} [props.required=false] Marks the control required and shows an asterisk.
 * @param {boolean} [props.disabled=false] Cascades to the control.
 * @param {string} [props.id] Override the generated control id.
 * @param {React.ReactNode} props.children The control (Input, Select, ...).
 * @param {string} [props.className]
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  disabled = false,
  id,
  children,
  className,
  ...rest
}) {
  const generated = useId();
  const resolvedId = id ?? `ui-${generated}`;

  const value = useMemo(() => {
    const hintId = `${resolvedId}-hint`;
    const errorId = `${resolvedId}-error`;
    return {
      id: resolvedId,
      labelId: `${resolvedId}-label`,
      hintId,
      errorId,
      describedBy:
        [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') || undefined,
      invalid: Boolean(error),
      required,
      disabled,
    };
  }, [resolvedId, hint, error, required, disabled]);

  return (
    <FieldContext.Provider value={value}>
      <div
        data-invalid={error ? '' : undefined}
        data-disabled={disabled ? '' : undefined}
        className={cn('flex w-full flex-col gap-1.5', className)}
        {...rest}
      >
        {label && <Label>{label}</Label>}
        {children}
        {hint && !error && <FieldHint>{hint}</FieldHint>}
        {error && <FieldError>{error}</FieldError>}
      </div>
    </FieldContext.Provider>
  );
}

/**
 * Label bound to the surrounding <Field>'s control.
 *
 * @param {object} props
 * @param {string} [props.htmlFor] Only needed outside a <Field>.
 * @param {boolean} [props.optional=false] Shows a muted "(optional)" suffix.
 * @param {React.ReactNode} props.children
 * @param {string} [props.className]
 */
export function Label({ htmlFor, optional = false, children, className, ...rest }) {
  const field = useFieldContext();
  return (
    <label
      id={field?.labelId}
      htmlFor={htmlFor ?? field?.id}
      className={cn(
        'font-body text-label-md text-default',
        field?.disabled && 'opacity-60',
        className,
      )}
      {...rest}
    >
      {children}
      {field?.required && (
        <span className="ml-0.5 text-danger-600 dark:text-danger-500" aria-hidden="true">
          *
        </span>
      )}
      {field?.required && <span className="ui-sr-only"> (required)</span>}
      {optional && <span className="ml-1.5 font-normal text-subtle">(optional)</span>}
    </label>
  );
}

/**
 * Muted helper text under a control.
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string} [props.className]
 */
export function FieldHint({ children, className, ...rest }) {
  const field = useFieldContext();
  return (
    <p id={field?.hintId} className={cn('text-caption text-subtle', className)} {...rest}>
      {children}
    </p>
  );
}

/**
 * Error text under a control. Announced politely via `role="alert"` so it is
 * read when it appears without interrupting the user mid-keystroke.
 * @param {object} props
 * @param {React.ReactNode} props.children
 * @param {string} [props.className]
 */
export function FieldError({ children, className, ...rest }) {
  const field = useFieldContext();
  return (
    <p
      id={field?.errorId}
      role="alert"
      className={cn(
        'flex items-start gap-1.5 text-caption font-medium text-danger-600 dark:text-danger-500',
        className,
      )}
      {...rest}
    >
      {children}
    </p>
  );
}

export default Field;
