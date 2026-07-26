import tailwindcssAnimate from 'tailwindcss-animate';

/** @type {import('tailwindcss').Config} */

/*
 * ============================================================================
 *  AI DERMATOLOGIST — DESIGN SYSTEM TAILWIND CONFIG
 * ============================================================================
 *
 *  SAFETY CONTRACT (Phase 2B-1)
 *  ----------------------------
 *  Everything below is *purely additive*. We never redefine a key that
 *  Tailwind ships by default, because existing (frozen) pages render off the
 *  stock scales and raw hex classes such as `bg-[#0c2b5e]`.
 *
 *  Specifically we DO NOT touch:
 *    - any default color name (slate, gray, blue, indigo, red, green, ...)
 *      NOTE: `neutral` IS a stock Tailwind color. We override it here only
 *      after verifying `neutral-*` has ZERO usages in src/ (see
 *      scripts/check-hex.mjs notes + the 2B-1 report). If that ever changes,
 *      rename this scale instead of editing pages.
 *    - fontSize keys xs..9xl        (we add display-* / heading-* / body-* / label-*)
 *    - borderRadius keys sm..3xl    (we add 4xl, 5xl, field, card, pill)
 *    - boxShadow keys sm..2xl       (we add card, elevated, overlay, focus, ...)
 *    - fontFamily.sans / .serif / .mono
 *      NOTE: `font-display` is already hand-defined inside a <style> block in
 *      RegisterPage.jsx ('Space Grotesk'). We therefore name our heading font
 *      `font-heading`, NOT `font-display`, so nothing collides.
 *    - borderColor.DEFAULT / ringColor.DEFAULT / any default variant selector
 *
 *  Colors are CSS-variable backed (`rgb(var(--x) / <alpha-value>)`) so the
 *  whole palette can flip light/dark from src/styles/tokens.css without a
 *  rebuild, and so `bg-primary-600/40` opacity modifiers keep working.
 * ============================================================================
 */

/** Build a `50..950 + DEFAULT` scale bound to CSS variables. */
const varScale = (name, defaultStep = 600) => {
  const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
  const scale = { DEFAULT: `rgb(var(--color-${name}-${defaultStep}) / <alpha-value>)` };
  for (const step of steps) {
    scale[step] = `rgb(var(--color-${name}-${step}) / <alpha-value>)`;
  }
  return scale;
};

const v = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;

export default {
  darkMode: 'class', // opt-in `.dark` on <html>. Verified: ZERO `dark:` classes
                     // exist in src/ today, so flipping off 'media' changes nothing.
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      /* ------------------------------------------------------------------ */
      /* COLOR                                                              */
      /* ------------------------------------------------------------------ */
      colors: {
        // Brand navy. primary-900 === #0c2b5e (the ~150x pasted brand hex),
        // primary-950 === #081d42 (the hover hex the pages already use).
        primary: varScale('primary', 900),

        // Brand teal. accent-400 === #3fd5c2.
        // accent-700 (#0f6e56) exists because #3fd5c2 on white is ~1.6:1 and
        // fails WCAG AA for text. Use accent-400 for fills/strokes, accent-700
        // for teal *text* and teal icons on light surfaces.
        accent: varScale('accent', 400),

        success: varScale('success', 600),
        warning: varScale('warning', 500),
        danger: varScale('danger', 600),
        neutral: varScale('neutral', 500),

        // ---- semantic aliases ----
        canvas: v('canvas'),
        surface: {
          DEFAULT: v('surface'),
          raised: v('surface-raised'),
          sunken: v('surface-sunken'),
          inverted: v('surface-inverted'),
        },
        overlay: v('overlay'),
        focus: v('focus'),
      },

      // `border-subtle` / `border-strong` / `border-default`.
      // NOTE: borderColor.DEFAULT is deliberately NOT set — plain `border`
      // must keep resolving to Tailwind's stock gray-200.
      borderColor: {
        subtle: v('line-subtle'),
        default: v('line'),
        strong: v('line-strong'),
        focus: v('focus'),
      },

      // `text-muted`, `text-subtle`, `text-inverted`, `text-default`.
      textColor: {
        default: v('text'),
        muted: v('text-muted'),
        subtle: v('text-subtle'),
        inverted: v('text-inverted'),
      },

      ringColor: {
        focus: v('focus'),
      },
      ringOffsetColor: {
        canvas: v('canvas'),
        surface: v('surface'),
      },

      /* ------------------------------------------------------------------ */
      /* TYPE                                                               */
      /* ------------------------------------------------------------------ */
      fontFamily: {
        // Named `heading` (not `display`) to avoid clobbering the existing
        // .font-display rule inside RegisterPage.jsx's <style> block.
        heading: ['var(--font-heading)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        body: ['var(--font-body)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        numeric: ['var(--font-numeric)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },

      // ADDITIVE fontSize keys only — text-xs .. text-9xl are untouched.
      fontSize: {
        'display-2xl': ['3.75rem', { lineHeight: '1.04', letterSpacing: '-0.022em', fontWeight: '700' }],
        'display-xl':  ['3rem',    { lineHeight: '1.06', letterSpacing: '-0.02em',  fontWeight: '700' }],
        'display-lg':  ['2.25rem', { lineHeight: '1.12', letterSpacing: '-0.018em', fontWeight: '700' }],
        'display-md':  ['1.875rem',{ lineHeight: '1.18', letterSpacing: '-0.015em', fontWeight: '700' }],
        'display-sm':  ['1.5rem',  { lineHeight: '1.24', letterSpacing: '-0.012em', fontWeight: '700' }],
        'heading-lg':  ['1.25rem', { lineHeight: '1.32', letterSpacing: '-0.01em',  fontWeight: '600' }],
        'heading-md':  ['1.125rem',{ lineHeight: '1.38', letterSpacing: '-0.008em', fontWeight: '600' }],
        'heading-sm':  ['1rem',    { lineHeight: '1.42', letterSpacing: '-0.005em', fontWeight: '600' }],
        'body-lg':     ['1.0625rem',{ lineHeight: '1.65' }],
        'body-md':     ['0.9375rem',{ lineHeight: '1.6' }],
        'body-sm':     ['0.875rem', { lineHeight: '1.55' }],
        'label-lg':    ['0.875rem', { lineHeight: '1.2', fontWeight: '600' }],
        'label-md':    ['0.8125rem',{ lineHeight: '1.2', fontWeight: '600' }],
        'label-sm':    ['0.75rem',  { lineHeight: '1.2', fontWeight: '600' }],
        'caption':     ['0.75rem',  { lineHeight: '1.45' }],
        'overline':    ['0.6875rem',{ lineHeight: '1.2', letterSpacing: '0.12em', fontWeight: '700' }],
      },

      /* ------------------------------------------------------------------ */
      /* SHAPE + DEPTH                                                      */
      /* ------------------------------------------------------------------ */
      // ADDITIVE keys only (rounded-sm..rounded-3xl untouched).
      borderRadius: {
        field: 'var(--radius-field)',   // inputs / small buttons
        control: 'var(--radius-control)',
        card: 'var(--radius-card)',     // cards / panels
        modal: 'var(--radius-modal)',
        pill: '9999px',
        '4xl': '2rem',
        '5xl': '2.5rem',
      },

      // ADDITIVE keys only (shadow-sm..shadow-2xl / inner / none untouched).
      boxShadow: {
        soft:        '0 1px 2px 0 rgb(var(--shadow-color) / 0.04), 0 1px 3px 0 rgb(var(--shadow-color) / 0.06)',
        card:        '0 1px 2px 0 rgb(var(--shadow-color) / 0.04), 0 4px 16px -2px rgb(var(--shadow-color) / 0.08)',
        'card-hover':'0 2px 4px 0 rgb(var(--shadow-color) / 0.05), 0 12px 28px -6px rgb(var(--shadow-color) / 0.14)',
        elevated:    '0 4px 8px -2px rgb(var(--shadow-color) / 0.06), 0 20px 40px -8px rgb(var(--shadow-color) / 0.18)',
        popover:     '0 6px 12px -4px rgb(var(--shadow-color) / 0.08), 0 18px 36px -10px rgb(var(--shadow-color) / 0.20)',
        overlay:     '0 12px 24px -8px rgb(var(--shadow-color) / 0.14), 0 40px 80px -20px rgb(var(--shadow-color) / 0.32)',
        focus:       '0 0 0 3px rgb(var(--color-focus) / 0.35)',
        'inner-soft':'inset 0 1px 2px 0 rgb(var(--shadow-color) / 0.06)',
      },

      // ADDITIVE keys only (z-0..z-50 / z-auto untouched).
      zIndex: {
        base: '0',
        raised: '10',
        sticky: '1100',
        dropdown: '1200',
        overlay: '1300',
        modal: '1400',
        popover: '1500',
        tooltip: '1600',
        toast: '1700',
      },

      /* ------------------------------------------------------------------ */
      /* MOTION                                                             */
      /* ------------------------------------------------------------------ */
      transitionTimingFunction: {
        // additive keys only; ease-linear/in/out/in-out untouched
        emphasized: 'cubic-bezier(0.2, 0, 0, 1)',
        overshoot: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },

      // All keyframe/animation names below are `ui-*` prefixed so they can
      // never collide with the app's hand-rolled `.animate-fadeIn`,
      // `.animate-fade-in-up`, `.animate-slideDown` or `.animate-custom-marquee`
      // rules, nor with tailwindcss-animate's `enter` / `exit`.
      animation: {
        'marquee': 'marquee 35s linear infinite', // PRE-EXISTING — do not remove
        'ui-fade-in': 'ui-fade-in 180ms cubic-bezier(0.2, 0, 0, 1) both',
        'ui-scale-in': 'ui-scale-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'ui-slide-up': 'ui-slide-up 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'ui-slide-down': 'ui-slide-down 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'ui-slide-in-right': 'ui-slide-in-right 260ms cubic-bezier(0.2, 0, 0, 1) both',
        'ui-slide-in-left': 'ui-slide-in-left 260ms cubic-bezier(0.2, 0, 0, 1) both',
        'ui-shimmer': 'ui-shimmer 1.6s ease-in-out infinite',
        'ui-indeterminate': 'ui-indeterminate 1.4s cubic-bezier(0.4, 0, 0.2, 1) infinite',
      },
      keyframes: {
        marquee: { // PRE-EXISTING — do not remove
          '0%': { transform: 'translateX(0%)' },
          '100%': { transform: 'translateX(-50%)' },
        },
        'ui-fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'ui-scale-in': {
          from: { opacity: '0', transform: 'scale(0.96)' },
          to: { opacity: '1', transform: 'scale(1)' },
        },
        'ui-slide-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'ui-slide-down': {
          from: { opacity: '0', transform: 'translateY(-8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'ui-slide-in-right': {
          from: { transform: 'translateX(100%)' },
          to: { transform: 'translateX(0)' },
        },
        'ui-slide-in-left': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        'ui-shimmer': {
          '0%': { opacity: '1' },
          '50%': { opacity: '0.45' },
          '100%': { opacity: '1' },
        },
        'ui-indeterminate': {
          '0%': { transform: 'translateX(-100%) scaleX(0.35)' },
          '50%': { transform: 'translateX(20%) scaleX(0.6)' },
          '100%': { transform: 'translateX(120%) scaleX(0.35)' },
        },
      },
    },
  },
  plugins: [
    // Activates the ~26 `animate-in / fade-in / zoom-in-95 / slide-in-from-*`
    // classes that were already written across the app but were dead CSS.
    // See the 2B-1 visual_deltas report for the exact list of affected files.
    tailwindcssAnimate,
  ],
}
