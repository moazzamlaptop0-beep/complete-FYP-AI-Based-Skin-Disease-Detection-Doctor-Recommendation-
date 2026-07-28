import React, { forwardRef } from 'react';
import { cn } from '../../lib/cn';
import Spinner from './Spinner';

/**
 * Shared focus treatment. Uses `focus-visible` so mouse users never see a ring
 * but keyboard users always do.
 *
 * It is an OUTSIDE ring with a canvas-coloured offset, and that is deliberate:
 * `ring-focus` resolves to `primary-600`, which is the `gradient` variant's own
 * first stop and a near neighbour of `primary`'s fill, so an INSET ring on those
 * buttons would be drawn in the colour it sits on (1.0:1) with `outline-none`
 * having already removed the native indicator. The 2px offset gap is what keeps
 * the ring legible on every fill in the system.
 *
 * If a surface cannot afford an outside ring (segments inside a pill, rows flush
 * against each other) use an inset `ring-white` on a coloured fill. Never an
 * inset `ring-focus` on one.
 */
export const focusRing =
  'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-canvas';

/**
 * ONE INTERACTION MODEL, SHARED BY EVERY VARIANT
 * ----------------------------------------------
 * rest -> hover -> active are three DISTINCT tonal steps, never a shadow swap on
 * its own: elevation is invisible on a dark fill, invisible against a dark
 * canvas, and invisible to anyone whose display flattens soft shadows. Depth
 * moves WITH the tone instead (`shadow-soft` -> `shadow-card` on hover, back down
 * on press) and the press adds the 1px sink.
 *
 * Every animated property is declared ONCE here. A variant that restated
 * `transition-property` would be betting on stylesheet order between two
 * arbitrary `transition-[…]` utilities, which is not something a design system
 * should bet on. Variants may still set `duration-*`: tailwind-merge resolves
 * that group last-wins, so the variant's duration deterministically survives.
 *
 * `motion-reduce` kills both the transitions and the 1px sink, so the states are
 * still distinguishable but nothing moves.
 */
const BASE =
  'relative inline-flex items-center justify-center gap-2 whitespace-nowrap font-body font-semibold ' +
  'select-none ' +
  'transition-[background-color,background-position,border-color,box-shadow,color,opacity,transform] ' +
  'duration-150 ease-emphasized active:translate-y-px ' +
  'motion-reduce:transition-none motion-reduce:transform-none ' +
  'disabled:pointer-events-none aria-disabled:pointer-events-none ' +
  focusRing;

/**
 * Fills, measured against BOTH ramps.
 *
 * `primary`, `accent`, `danger`, `success` all RE-RAMP in dark mode (see
 * styles/tokens.css), so a fill that is dark on light is light on dark and the
 * label has to be re-pointed with it. Only three `dark:` shapes appear below and
 * each is a sanctioned one:
 *   1. `dark:bg-{scale}-600 dark:text-{scale}-50` — a solid mid-scale fill with
 *      the deep end of its own scale as the label.
 *   2. `dark:text-{scale}-50` alone, where the FILL does not flip (accent-400 is
 *      literal in both themes) but `text-primary-950` would have.
 *   3. The both-theme gradient recipe: `primary-600 -> accent-700` in light and
 *      `primary-400 -> accent-300` in dark resolve to the SAME two physical
 *      colours, rgb(27 92 197) and rgb(15 110 86), because the dark ramp is the
 *      light ramp reversed. White clears 6.2:1 on both, in both themes.
 *
 * Nothing here is a "double flip" (a `dark:` override on a class that already
 * flips), which is why `soft`, `outline` and `link` now carry no `dark:` half at
 * all: `text-primary-800` is rgb(16 58 127) on light and rgb(193 215 250) on
 * dark, and both are correct against their own theme's fill.
 */
const VARIANTS = {
  /**
   * Deep navy in light, the interactive blue in dark. Hover lifts a step
   * (900 -> 800 light, 600 -> 700 dark, lighter in both ramps), press deepens.
   */
  primary:
    'bg-primary-900 text-white shadow-soft '
    + 'hover:bg-primary-800 hover:shadow-card active:bg-primary-950 active:shadow-soft '
    + 'dark:bg-primary-600 dark:text-primary-50 dark:hover:bg-primary-700 dark:active:bg-primary-800',

  /**
   * Brand gradient, for the one hero CTA a screen leads with.
   *
   * The fill is 150% wide and parked left; hover slides it right, which is a real
   * tonal change (blue-led -> teal-led) rather than a shadow swap, and press
   * pulls it back to centre. Every stop is AA under white in BOTH themes, so the
   * label survives wherever the slide stops.
   */
  gradient:
    'bg-gradient-to-r from-primary-600 via-primary-700 to-accent-700 '
    + 'dark:from-primary-400 dark:via-primary-300 dark:to-accent-300 '
    + 'bg-[length:150%_100%] bg-left text-white shadow-card duration-200 '
    + 'hover:bg-right hover:shadow-card-hover active:bg-center active:shadow-soft',

  /** Tonal wash: lighter than primary, stronger than ghost. Flat by design. */
  soft:
    'bg-primary-50 text-primary-800 shadow-none '
    + 'hover:bg-primary-100 hover:text-primary-900 active:bg-primary-200',

  /**
   * Brand teal. `accent-400` is one of the two FIXED brand anchors and does not
   * flip, so only the LABEL needs a dark twin: `text-primary-950` is rgb(8 29 66)
   * on light but rgb(241 246 254) on dark, and near-white on teal is 1.7:1.
   * `dark:text-primary-50` lands back on rgb(8 29 66), 9.1:1.
   */
  secondary:
    'bg-accent-400 text-primary-950 shadow-soft dark:text-primary-50 '
    + 'hover:bg-accent-500 hover:shadow-card active:bg-accent-600 active:shadow-soft',

  /**
   * The quiet bordered button, and the most-used variant in the app. Hover fills
   * with the tonal wash AND brings the border up to `primary-400`, which is the
   * palest stop that still clears 3:1 against white for a non-text edge.
   */
  outline:
    'border border-strong bg-transparent text-primary-900 shadow-none '
    + 'hover:border-primary-400 hover:bg-primary-50 hover:text-primary-950 '
    + 'active:bg-primary-100',

  ghost:
    'bg-transparent text-muted shadow-none '
    + 'hover:bg-surface-sunken hover:text-default active:bg-neutral-200',

  danger:
    'bg-danger-600 text-white shadow-soft dark:text-danger-50 '
    + 'hover:bg-danger-700 hover:shadow-card active:bg-danger-800 active:shadow-soft '
    + 'focus-visible:ring-danger-500',

  /**
   * `success-700`, not 600: white on `success-600` is 3.8:1 in light mode, i.e.
   * it fails AA for a 14px label. 700 is 5.5:1 light, and on dark the same class
   * re-ramps to rgb(110 231 183) where `success-50` reads 10:1 on it. The focus
   * ring moves to 700 for the same reason — `ring-success-500` was 2.4:1 against
   * the light canvas, under the 3:1 a focus indicator needs.
   */
  success:
    'bg-success-700 text-white shadow-soft dark:text-success-50 '
    + 'hover:bg-success-800 hover:shadow-card active:bg-success-900 active:shadow-soft '
    + 'focus-visible:ring-success-700',

  /** Inline text link. Owns no box, so it opts out of the sink. */
  link:
    'bg-transparent p-0 h-auto shadow-none text-primary-700 underline-offset-4 '
    + 'hover:text-primary-800 hover:underline active:text-primary-900 active:translate-y-0',
};

const SIZES = {
  sm: 'h-9 px-3.5 text-label-md rounded-control',
  md: 'h-11 px-5 text-label-lg rounded-field',
  lg: 'h-12 px-7 text-body-md font-bold rounded-field',
  icon: 'h-11 w-11 p-0 rounded-field',
};

const SPINNER_SIZE = { sm: 'xs', md: 'sm', lg: 'sm', icon: 'sm' };

/**
 * The spinner's own box, so the slot that holds it can be reserved at rest
 * WITHOUT mounting a spinner. Mounting one everywhere would leave an
 * `animate-spin` running on every idle button on the page.
 */
const SPINNER_BOX = { xs: 'h-3 w-3', sm: 'h-4 w-4', md: 'h-5 w-5' };

/** Cross-fade used by every layer that swaps in or out of the loading state. */
const FADE = 'transition-opacity duration-150 ease-emphasized motion-reduce:transition-none';
const fade = (visible) => cn(FADE, visible ? 'opacity-100' : 'opacity-0');

/**
 * The one button in the system. Replaces the 146 hand-rolled `<button>`s.
 *
 * LOADING, AND WHY THE WIDTH NEVER JUMPS
 * --------------------------------------
 * A button that grows by a spinner's width the moment it is pressed reflows the
 * row it sits in, which is the single most common way a loading state reads
 * cheap. Nothing here changes the button's box:
 *  - `leftIcon` or `loadingText` present -> the spinner gets a PERMANENT slot,
 *    sharing one grid cell with the icon so the slot is as wide as the wider of
 *    the two and never resizes. The icon cross-fades out, the spinner in.
 *  - neither present -> the label stays in flow and only fades to `opacity-0`
 *    while an absolutely-positioned spinner fades in over it. The box is
 *    reserved by content that is still there, just invisible.
 *  - `size="icon"` takes the same path, so the glyph reserves its own box.
 *  - `loadingText` shares a grid cell with `children`, so the label reserves the
 *    wider of the two strings and the swap is a cross-fade, not a reflow.
 *
 * Keyboard/AT behaviour:
 *  - `loading` sets `aria-busy` and blocks activation WITHOUT setting the native
 *    `disabled` attribute, so the button keeps focus (a `disabled` element loses
 *    it, which strands keyboard users mid-form). Clicks, Enter and Space are all
 *    swallowed by the handlers instead, and `aria-disabled` tells AT the control
 *    is not actionable right now.
 *  - A loading button is NOT dimmed. `opacity-55` is for a genuinely disabled
 *    control; applying it to a busy one drags the spinner and the label under AA
 *    on the gradient and on every dark fill.
 *  - Whichever of `children` / `loadingText` is visible is the accessible name;
 *    the other is `aria-hidden`, so the name never doubles up mid-transition.
 *  - When rendered as a non-button element via `as`, `role="button"`,
 *    `tabIndex` and Space/Enter activation are wired automatically.
 *  - Icons are `aria-hidden`; give icon-only buttons an `aria-label`
 *    (or just use `<IconButton>`, which requires one).
 *
 * @param {object} props
 * @param {'primary'|'gradient'|'soft'|'secondary'|'outline'|'ghost'|'danger'|'success'|'link'} [props.variant='primary']
 * @param {'sm'|'md'|'lg'|'icon'} [props.size='md']
 * @param {boolean} [props.loading=false] Shows a spinner and blocks activation.
 * @param {string} [props.loadingText] Replaces children while loading.
 * @param {React.ReactNode} [props.leftIcon] Icon before the label.
 * @param {React.ReactNode} [props.rightIcon] Icon after the label.
 * @param {boolean} [props.fullWidth=false] Stretch to the container width.
 * @param {React.ElementType} [props.as='button'] Polymorphic element (e.g. `Link`, `'a'`).
 * @param {'button'|'submit'|'reset'} [props.type='button'] Only applied when `as` is a button.
 * @param {boolean} [props.disabled]
 * @param {string} [props.className]
 * @param {React.ReactNode} [props.children]
 */
const Button = forwardRef(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingText,
    leftIcon,
    rightIcon,
    fullWidth = false,
    as: Component = 'button',
    type = 'button',
    disabled = false,
    className,
    children,
    onClick,
    onKeyDown,
    ...rest
  },
  ref,
) {
  const isNativeButton = Component === 'button';
  const inert = disabled || loading;

  const handleClick = (event) => {
    if (inert) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  };

  // Non-button elements do not activate on Space/Enter for free.
  const handleKeyDown = (event) => {
    onKeyDown?.(event);
    if (isNativeButton || event.defaultPrevented) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      handleClick(event);
    }
  };

  const iconOnly = size === 'icon';
  const spinnerKey = SPINNER_SIZE[size] ?? 'sm';
  const hasLoadingText = Boolean(loadingText) && !iconOnly;

  // A permanent slot only exists when something already occupies that space at
  // rest (an icon) or when the caller has declared a loading label and therefore
  // needs the spinner beside it. Otherwise the spinner goes over the label.
  const spinnerInSlot = !iconOnly && (Boolean(leftIcon) || hasLoadingText);

  // The label steps aside when the loading treatment needs its space: either
  // because `loadingText` is taking over, or because the spinner is centred on
  // top of it.
  const labelHidden = loading && (hasLoadingText || !spinnerInSlot);

  return (
    <Component
      ref={ref}
      type={isNativeButton ? type : undefined}
      // Deliberately NOT `inert`: a loading button must keep focus. Activation is
      // blocked by handleClick/handleKeyDown and announced via aria-disabled.
      disabled={isNativeButton ? disabled || undefined : undefined}
      role={isNativeButton ? undefined : 'button'}
      tabIndex={isNativeButton ? undefined : inert ? -1 : 0}
      aria-disabled={inert || undefined}
      aria-busy={loading || undefined}
      data-loading={loading ? '' : undefined}
      data-variant={variant}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={cn(
        BASE,
        VARIANTS[variant] ?? VARIANTS.primary,
        variant !== 'link' && (SIZES[size] ?? SIZES.md),
        fullWidth && 'w-full',
        // Dimmed only when genuinely unavailable. See the loading note above.
        disabled && !loading && 'opacity-55 shadow-none',
        className,
      )}
      {...rest}
    >
      {spinnerInSlot && (
        <span aria-hidden="true" className="grid shrink-0 place-items-center">
          <span className={cn('col-start-1 row-start-1', SPINNER_BOX[spinnerKey], fade(loading))}>
            {loading && <Spinner size={spinnerKey} label={null} />}
          </span>
          {leftIcon && (
            <span className={cn('col-start-1 row-start-1 inline-flex items-center', fade(!loading))}>
              {leftIcon}
            </span>
          )}
        </span>
      )}

      <span className="grid min-w-0 place-items-center">
        <span
          aria-hidden={loading && hasLoadingText ? 'true' : undefined}
          className={cn(
            'col-start-1 row-start-1 inline-flex items-center',
            fade(!labelHidden),
          )}
        >
          {children}
        </span>
        {hasLoadingText && (
          <span
            aria-hidden={loading ? undefined : 'true'}
            className={cn('col-start-1 row-start-1 inline-flex items-center', fade(loading))}
          >
            {loadingText}
          </span>
        )}
      </span>

      {!iconOnly && rightIcon && (
        <span
          aria-hidden="true"
          className={cn('inline-flex shrink-0 items-center', fade(!labelHidden))}
        >
          {rightIcon}
        </span>
      )}

      {!spinnerInSlot && (
        <span
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute inset-0 flex items-center justify-center',
            fade(loading),
          )}
        >
          {loading && <Spinner size={spinnerKey} label={null} />}
        </span>
      )}
    </Component>
  );
});

export { Button };
export default Button;
