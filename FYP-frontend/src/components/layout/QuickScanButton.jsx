/**
 * QuickScanButton — the one CTA the whole product is about.
 *
 * "Scan my skin" is the single action every visitor is here for, so it gets a
 * permanent, unmissable home in the header, in the mobile tab bar and as a
 * floating action button on scrolled dashboards. It is deliberately the ONLY
 * `secondary` (teal) button in the chrome; everything else around it is ghost
 * or outline, so nothing competes with it.
 *
 * It is available to ANONYMOUS visitors on purpose — /try-now is public, and
 * gating the primary CTA behind a login is the fastest way to lose the user.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { ScanLine } from 'lucide-react';

import { cn } from '../../lib/cn';
import { PATHS } from '../../routes';
import Button from '../ui/Button';

/**
 * The canonical scan route, taken from the route table rather than typed here.
 * It used to be the literal '/try-now', which still resolves (App.jsx keeps it
 * as a permanent alias) but cost a redirect hop on the single most-used button
 * in the product.
 */
export const QUICK_SCAN_ROUTE = PATHS.CONSULT;

/**
 * @param {object} props
 * @param {'default'|'compact'|'fab'|'block'} [props.variant='default']
 *   default — header CTA with a label
 *   compact — icon + short label, for tight headers
 *   fab     — circular floating action button (mobile / scrolled dashboards)
 *   block   — full-width, for drawers and empty states
 * @param {string} [props.label='Scan my skin']
 * @param {string} [props.to=QUICK_SCAN_ROUTE]
 * @param {() => void} [props.onNavigate] Called before navigating (close a drawer).
 * @param {string} [props.className]
 */
export default function QuickScanButton({
  variant = 'default',
  label = 'Scan my skin',
  to = QUICK_SCAN_ROUTE,
  onNavigate,
  className,
  ...rest
}) {
  if (variant === 'fab') {
    return (
      <Link
        to={to}
        onClick={onNavigate}
        aria-label={label}
        className={cn(
          'inline-flex h-14 w-14 items-center justify-center rounded-pill bg-accent-400 text-primary-950',
          'shadow-elevated transition-transform duration-200 ease-overshoot',
          'hover:scale-105 active:scale-95 motion-reduce:transform-none',
          'outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2',
          'focus-visible:ring-offset-canvas',
          className,
        )}
        {...rest}
      >
        <ScanLine className="h-6 w-6" aria-hidden="true" />
      </Link>
    );
  }

  return (
    <Button
      as={Link}
      to={to}
      onClick={onNavigate}
      variant="secondary"
      size={variant === 'compact' ? 'sm' : 'md'}
      fullWidth={variant === 'block'}
      leftIcon={<ScanLine className="h-4 w-4" />}
      className={cn('shadow-soft', className)}
      {...rest}
    >
      {variant === 'compact' ? 'Scan' : label}
    </Button>
  );
}

export { QuickScanButton };
