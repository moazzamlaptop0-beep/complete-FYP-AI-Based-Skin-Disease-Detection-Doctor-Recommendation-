import React, { createContext, forwardRef, useContext, useId } from 'react';
import { cn } from '../../lib/cn';
import { useFieldContext } from './Field';

const RadioGroupContext = createContext(null);

const SIZES = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-6 w-6',
};

const DOT = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
  lg: 'h-2.5 w-2.5',
};

/**
 * A set of mutually exclusive choices.
 *
 * Implemented with native `<input type="radio">` inside a `<fieldset>` rather
 * than `role="radiogroup"` + manual roving tabindex. The native control already
 * gives arrow-key navigation, form participation and correct
 * "2 of 5" announcements for free, and browsers scope the roving behaviour to
 * the shared `name` — which is exactly the semantics we want.
 *
 * Inside a `<Field>` the legend, required flag and disabled state are inherited.
 *
 * @param {object} props
 * @param {string} [props.name] Radio group name. Auto-generated when omitted.
 * @param {string|number} [props.value] Controlled selection.
 * @param {string|number} [props.defaultValue] Uncontrolled initial selection.
 * @param {(value: string) => void} [props.onChange] Receives the raw option VALUE, not the event.
 * @param {React.ReactNode} [props.legend] Group label rendered as a `<legend>`.
 * @param {Array<{value: string|number, label: React.ReactNode, description?: React.ReactNode, disabled?: boolean}>} [props.options]
 * @param {'vertical'|'horizontal'} [props.orientation='vertical']
 * @param {'default'|'card'} [props.variant='default'] `card` renders each option as a selectable tile.
 * @param {'sm'|'md'|'lg'} [props.size='md']
 * @param {boolean} [props.disabled]
 * @param {string} [props.className]
 * @param {React.ReactNode} [props.children] `<Radio>` children instead of `options`.
 */
export function RadioGroup({
  name,
  value,
  defaultValue,
  onChange,
  legend,
  options,
  orientation = 'vertical',
  variant = 'default',
  size = 'md',
  disabled,
  className,
  children,
  ...rest
}) {
  const field = useFieldContext();
  const generated = useId();
  const groupName = name ?? field?.id ?? `ui-radio-${generated}`;
  const isDisabled = disabled ?? field?.disabled ?? false;

  const context = {
    name: groupName,
    value,
    defaultValue,
    onChange,
    disabled: isDisabled,
    size,
    variant,
    invalid: Boolean(field?.invalid),
  };

  return (
    <RadioGroupContext.Provider value={context}>
      <fieldset
        disabled={isDisabled || undefined}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        aria-required={field?.required || undefined}
        className={cn('min-w-0 border-0 p-0', className)}
        {...rest}
      >
        {legend && (
          <legend className="mb-2 font-body text-label-md text-default">
            {legend}
            {field?.required && (
              <span className="ml-0.5 text-danger-600" aria-hidden="true">
                *
              </span>
            )}
          </legend>
        )}
        <div
          className={cn(
            'flex',
            orientation === 'horizontal' ? 'flex-row flex-wrap gap-x-5 gap-y-2.5' : 'flex-col gap-2.5',
            variant === 'card' && 'gap-2',
          )}
        >
          {options
            ? options.map((opt) => (
                <Radio
                  key={opt.value}
                  value={opt.value}
                  label={opt.label}
                  description={opt.description}
                  disabled={opt.disabled}
                />
              ))
            : children}
        </div>
      </fieldset>
    </RadioGroupContext.Provider>
  );
}

/**
 * One option inside a `<RadioGroup>`. Can also be used standalone by passing
 * `name`/`checked`/`onChange` directly.
 *
 * @param {object} props
 * @param {string|number} props.value
 * @param {React.ReactNode} [props.label]
 * @param {React.ReactNode} [props.description] Secondary line under the label.
 * @param {boolean} [props.disabled]
 * @param {string} [props.className] Applied to the wrapping <label>.
 */
export const Radio = forwardRef(function Radio(
  { value, label, description, disabled, className, id, ...rest },
  ref,
) {
  const group = useContext(RadioGroupContext);
  const generated = useId();
  const inputId = id ?? `ui-radio-opt-${generated}`;
  const size = group?.size ?? 'md';
  const isCard = group?.variant === 'card';
  const isDisabled = disabled ?? group?.disabled ?? false;

  // Controlled only when the group is controlled, otherwise React warns about
  // switching between controlled and uncontrolled.
  const controlled = group && group.value !== undefined;

  return (
    <label
      htmlFor={inputId}
      className={cn(
        'group inline-flex items-start gap-2.5',
        isCard &&
          'w-full rounded-field border border-default bg-surface p-3.5 transition-colors duration-150 ' +
            'hover:border-strong has-[:checked]:border-primary-600 has-[:checked]:bg-primary-50 ' +
            'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-focus has-[:focus-visible]:ring-offset-2 ' +
            'has-[:focus-visible]:ring-offset-canvas',
        isDisabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
        className,
      )}
    >
      <span className="relative inline-flex shrink-0 items-center justify-center pt-0.5">
        <input
          ref={ref}
          id={inputId}
          type="radio"
          name={group?.name}
          value={value}
          disabled={isDisabled || undefined}
          aria-invalid={group?.invalid || undefined}
          {...(controlled
            ? { checked: String(group.value) === String(value), onChange: () => group.onChange?.(value) }
            : {
                defaultChecked:
                  group?.defaultValue !== undefined
                    ? String(group.defaultValue) === String(value)
                    : undefined,
                onChange: (event) => group?.onChange?.(event.target.value),
              })}
          className="peer absolute h-0 w-0 opacity-0"
          {...rest}
        />
        <span
          aria-hidden="true"
          className={cn(
            'flex items-center justify-center rounded-pill border border-strong bg-surface',
            'transition-[border-color,background-color] duration-150 ease-emphasized',
            'peer-checked:border-primary-900 dark:peer-checked:border-primary-600',
            'peer-focus-visible:ring-2 peer-focus-visible:ring-focus peer-focus-visible:ring-offset-2',
            'peer-focus-visible:ring-offset-canvas',
            // the dot is a descendant, so `peer-checked:` needs an explicit
            // child selector to reach it
            'peer-checked:[&>span]:scale-100',
            group?.invalid && 'border-danger-500',
            SIZES[size] ?? SIZES.md,
          )}
        >
          <span
            className={cn(
              'block scale-0 rounded-pill bg-primary-900 transition-transform duration-150',
              'dark:bg-primary-600',
              DOT[size] ?? DOT.md,
            )}
          />
        </span>
      </span>

      {(label || description) && (
        <span className="flex min-w-0 flex-col gap-0.5">
          {label && (
            <span className="font-body text-body-sm font-medium text-default">{label}</span>
          )}
          {description && <span className="text-caption text-subtle">{description}</span>}
        </span>
      )}
    </label>
  );
});

export default RadioGroup;
