import { clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * tailwind-merge instance taught about the custom scales added in
 * tailwind.config.js. Without this, `twMerge('text-body-sm', 'text-danger-600')`
 * would treat both as font-size and drop the color (they share the `text-`
 * prefix), and `rounded-card` / `shadow-card` would be unrecognised.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [
        {
          text: [
            'display-2xl', 'display-xl', 'display-lg', 'display-md', 'display-sm',
            'heading-lg', 'heading-md', 'heading-sm',
            'body-lg', 'body-md', 'body-sm',
            'label-lg', 'label-md', 'label-sm',
            'caption', 'overline',
          ],
        },
      ],
      rounded: [{ rounded: ['field', 'control', 'card', 'modal', 'pill', '4xl', '5xl'] }],
      shadow: [
        {
          shadow: [
            'soft', 'card', 'card-hover', 'elevated',
            'popover', 'overlay', 'focus', 'inner-soft',
          ],
        },
      ],
      'font-family': [{ font: ['heading', 'body', 'numeric'] }],
      z: [
        {
          z: [
            'base', 'raised', 'sticky', 'dropdown',
            'overlay', 'modal', 'popover', 'tooltip', 'toast',
          ],
        },
      ],
    },
  },
});

/**
 * Merge Tailwind class names with conflict resolution.
 *
 * Accepts anything `clsx` accepts (strings, arrays, conditional objects) and
 * resolves Tailwind conflicts left-to-right so a caller-supplied `className`
 * always beats the component's own defaults.
 *
 * @param {...(string|number|boolean|null|undefined|Record<string, unknown>|Array<unknown>)} inputs
 * @returns {string}
 *
 * @example
 * cn('px-4 py-2', isActive && 'bg-primary-900', className)
 * cn('bg-primary-900', 'bg-danger-600') // -> 'bg-danger-600'
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}

export default cn;
