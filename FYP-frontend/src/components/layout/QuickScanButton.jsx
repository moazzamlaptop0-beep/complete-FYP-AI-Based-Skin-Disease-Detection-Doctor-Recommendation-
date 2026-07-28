/**
 * QuickScanButton — ONE scan CTA, ONE gradient, four placements.
 *
 * WHAT CHANGED AND WHY
 * --------------------
 * This component used to render four unrelated buttons for the same action: a
 * teal `secondary` pill in the header, a smaller teal pill labelled "Scan" in
 * the dashboard topbar, a flat `accent-400` circle in the mobile tab bar and a
 * full-width teal bar in the drawer. Same product action, four visual
 * identities, none of them the app's hero gradient. That is what read cheap.
 *
 * Now every placement wears the single scan gradient (see SCAN_FILL: the same
 * stops the `gradient` Button variant uses, a hairline `ring-white/15`,
 * `shadow-soft` at rest) so the CTA is recognisable at a glance in the navbar,
 * the dashboard topbar, the mobile tab bar and the drawer. It is the only
 * gradient-filled control in the chrome.
 *
 * SPLIT BUTTON
 * ------------
 * The scan itself is not one thing: a visitor may want the live camera, a photo
 * they already have, an earlier result, or a human. So `default` and `compact`
 * are a split control: the whole left segment is still a plain <Link> straight
 * to the scan (one tap, unchanged), and a chevron segment opens the other scan
 * types. The gradient lives on the WRAPPER, once, so it runs continuously
 * across both segments instead of butting two fills together at a seam.
 *
 * `fab` deliberately keeps NO menu: a dropdown in the thumb zone of a phone is
 * a mis-tap waiting to happen, and the bottom bar already has room for nothing
 * else.
 *
 * Heights track the Button primitive (SIZES in components/ui/Button.jsx):
 * h-11 for `default`/`block`, h-9 for `compact`, so the CTA lines up with the
 * controls beside it instead of floating a pixel or two off the row.
 *
 * It stays available to ANONYMOUS visitors on purpose. /consult is public, and
 * gating the primary CTA behind a login is the fastest way to lose the user.
 */

import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Camera, ChevronDown, History, ScanLine, Stethoscope, Upload } from 'lucide-react';

import { cn } from '../../lib/cn';
import { useOptionalAuth } from '../../context/AuthContext';
import { PATHS, routeById } from '../../routes';
import { focusRing } from '../ui/Button';
import { visibleNav } from './navigation';
import useMenu from './useMenu';

/**
 * The canonical scan route, taken from the route table rather than typed here.
 * It used to be the literal '/try-now', which still resolves (App.jsx keeps it
 * as a permanent alias) but cost a redirect hop on the single most-used button
 * in the product.
 */
export const QUICK_SCAN_ROUTE = PATHS.CONSULT;

/**
 * The scan gradient. Single source of truth for every scan surface, including
 * the FAB and the drawer block, so the action never changes costume. It is the
 * same recipe as the `gradient` Button variant, so the hero CTA on a page and
 * the CTA in the chrome are one visual language.
 *
 * The `dark:` stops are NOT a double flip: `primary` and `accent` re-ramp in
 * dark mode, so the base stops would resolve to rgb(94,149,237) /
 * rgb(147,185,246) / rgb(115,226,212) there and white-on-those is 3.0:1 / 2.0:1
 * / 1.55:1, i.e. the word "Scan" disappears. `primary-400`, `primary-300` and
 * `accent-300` resolve on dark to the SAME physical colours the light stops
 * resolve to (rgb(27,92,197), rgb(20,73,159), rgb(15,110,86)), all >= 4.9:1
 * under white. This is the both-theme gradient recipe the design system
 * sanctions, and the one DashboardLayout's active sidebar pill already uses.
 */
const SCAN_FILL =
  'bg-gradient-to-r from-primary-600 via-primary-700 to-accent-700 ' +
  'dark:from-primary-400 dark:via-primary-300 dark:to-accent-300 text-white ' +
  'ring-1 ring-inset ring-white/15';

/** Shared typography for anything sitting on the gradient. */
const SCAN_LABEL = 'inline-flex items-center justify-center whitespace-nowrap font-body font-semibold';

/**
 * Focus treatment for the two segments INSIDE the pill.
 *
 * Inset, because an offset ring would cut a canvas-coloured gap through the
 * middle of the gradient. WHITE, not `ring-focus`: `ring-focus` is
 * `--color-focus`, which is primary-600, which is the gradient's own first stop,
 * so the ring was drawn in the exact colour it sat on (1.00:1 at the left edge)
 * and `outline-none` had already removed the native one. White clears 4.9:1
 * against every stop of SCAN_FILL in both themes.
 */
const SEGMENT_FOCUS =
  'outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white';

/**
 * Focus treatment for a row of the dropdown. `ring-focus` is the right colour
 * here (the panel is `bg-surface`, not the gradient) and it has to be a RING:
 * a background tint on its own is not a visible focus indicator.
 */
const ROW_FOCUS =
  'outline-none focus-visible:bg-surface-sunken focus-visible:ring-2 ' +
  'focus-visible:ring-inset focus-visible:ring-focus';

/**
 * Hover and press feedback for anything sitting ON the gradient: two real tonal
 * steps rather than a shadow swap, so they still read on a dark canvas.
 *
 * Hover LIGHTENS by 10% white, which is the strongest white wash the label
 * survives: the teal end of the gradient is rgb(15 110 86) and 10% white puts it
 * at 4.99:1 under the label, while 20% would drop it to 4.06:1 and fail AA.
 * Press DARKENS instead (`bg-overlay` is rgb(2 6 23) light / black dark, dark in
 * both themes), so the press step can never cost contrast and it reads as
 * pressing in rather than lighting up. `active:` is generated after `hover:`, so
 * the press wins while the pointer is held down.
 */
const ON_FILL_PRESS = 'hover:bg-white/10 active:bg-overlay/15';

/**
 * The visibility rules of an existing route, read off the route table instead of
 * retyped here.
 *
 * Two of the menu rows point at GUARDED patient pages, and both guards have to
 * come along or the row lies about where it leads:
 *  - `permission` is what keeps "Find a doctor" off an anonymous visitor's menu.
 *    Without it `visibleNav` falls through to "show everyone" and the tap lands
 *    on /login?returnTo=… instead of a page.
 *  - `excludeRoles` is what keeps a patient surface out of an ADMIN's chrome.
 *    An admin holds every patient permission (the role sets are a union), so
 *    permissions alone cannot express it.
 *
 * Deriving both means this list cannot drift from routes.js, which is the whole
 * reason navigation.js stopped hand-copying links.
 */
function guardsFor(routeId) {
  const route = routeById(routeId);
  return {
    ...(route?.permission ? { permission: route.permission } : {}),
    ...(route?.excludeRoles ? { excludeRoles: [...route.excludeRoles] } : {}),
  };
}

/**
 * The scan types the chevron offers, in menu order.
 *
 * `permission` is read by `visibleNav` (the same filter the rest of the chrome
 * uses), so "My scans" appears for anyone holding `scan.read.own` — patient,
 * doctor or admin. Never role strings: a dermatologist scanning their own mole
 * holds that permission too.
 *
 * `group: 'more'` marks the rows that are NOT a scan, which get a divider.
 *
 * The `?capture=` deep links are read by the consult page from
 * window.location.search, so no caller gains a router dependency.
 */
const SCAN_TYPES = Object.freeze([
  Object.freeze({
    id: 'scan.camera',
    label: 'Take a photo',
    description: 'Use your camera for a live shot.',
    to: `${QUICK_SCAN_ROUTE}?capture=camera`,
    icon: Camera,
    chip: 'bg-primary-100 text-primary-700',
  }),
  Object.freeze({
    id: 'scan.upload',
    label: 'Upload a photo',
    description: 'Pick an image already on this device.',
    to: `${QUICK_SCAN_ROUTE}?capture=upload`,
    icon: Upload,
    chip: 'bg-accent-100 text-accent-700',
  }),
  Object.freeze({
    ...guardsFor('patient.findDoctor'),
    id: 'scan.findDoctor',
    label: 'Find a doctor',
    description: 'Skip the scan and browse verified specialists.',
    to: PATHS.PATIENT_FIND_DOCTOR,
    icon: Stethoscope,
    chip: 'bg-info-100 text-info-700',
    group: 'more',
  }),
  Object.freeze({
    ...guardsFor('patient.scans'),
    id: 'scan.history',
    label: 'My scans',
    description: 'Revisit an earlier result.',
    to: PATHS.PATIENT_SCANS,
    icon: History,
    chip: 'bg-success-100 text-success-700',
    group: 'more',
  }),
]);

/** Per-variant rhythm. Compact is the same shape on a tighter grid. */
const METRICS = {
  default: {
    track: 'h-11',
    label: 'gap-2 px-5 text-label-lg',
    chevron: 'px-2.5',
    divider: 'my-2',
  },
  compact: {
    track: 'h-9',
    label: 'gap-1.5 px-3.5 text-label-md',
    chevron: 'px-2',
    divider: 'my-1.5',
  },
};

/**
 * @param {object} props
 * @param {'default'|'compact'|'fab'|'block'} [props.variant='default']
 *   default — header CTA with a label, plus the scan-type menu
 *   compact — same control on a tighter grid, for dense headers
 *   fab     — circular floating action button (mobile tab bar), single tap
 *   block   — full-width, for drawers and empty states
 * @param {string} [props.label='Scan my skin']
 * @param {string} [props.to=QUICK_SCAN_ROUTE]
 * @param {boolean} [props.menu] Offer the scan-type menu. Defaults to true on
 *   `default`/`compact`; always false on `fab`/`block`.
 * @param {() => void} [props.onNavigate] Called before navigating (close a drawer).
 * @param {string} [props.className]
 */
export default function QuickScanButton({
  variant = 'default',
  label = 'Scan my skin',
  to = QUICK_SCAN_ROUTE,
  menu: enableMenu,
  onNavigate,
  className,
  ...rest
}) {
  const auth = useOptionalAuth();

  // MobileTabBar renders this outside an AuthProvider on purpose, so read auth
  // through the non-throwing hook it uses and treat "no provider" as anonymous.
  const permissions = auth?.permissions;
  const isAuthenticated = Boolean(auth?.isAuthenticated);
  const effectiveRole = auth?.effectiveRole ?? null;

  const items = useMemo(
    () => visibleNav(SCAN_TYPES, { permissions, isAuthenticated, role: effectiveRole }),
    [permissions, isAuthenticated, effectiveRole],
  );

  // The count MUST match the rendered rows or the arrow keys walk off the end.
  const dropdown = useMenu({ itemCount: items.length });

  if (variant === 'fab') {
    return (
      <Link
        to={to}
        onClick={onNavigate}
        aria-label={label}
        className={cn(
          'inline-flex h-14 w-14 items-center justify-center rounded-pill',
          SCAN_FILL,
          'shadow-elevated transition-[background-color,box-shadow,transform] duration-200 ease-overshoot',
          'motion-reduce:transition-none',
          'hover:scale-105 active:scale-95 motion-reduce:transform-none',
          ON_FILL_PRESS,
          focusRing,
          className,
        )}
        {...rest}
      >
        <ScanLine className="h-6 w-6" aria-hidden="true" />
      </Link>
    );
  }

  if (variant === 'block') {
    return (
      <Link
        to={to}
        onClick={onNavigate}
        className={cn(
          SCAN_LABEL,
          'h-11 w-full gap-2 rounded-pill px-5 text-label-lg',
          SCAN_FILL,
          'shadow-soft transition-[background-color,box-shadow,transform] duration-150 ease-emphasized',
          'hover:shadow-card-hover active:translate-y-px active:shadow-soft',
          'motion-reduce:transition-none motion-reduce:transform-none',
          ON_FILL_PRESS,
          focusRing,
          className,
        )}
        {...rest}
      >
        <ScanLine className="h-4 w-4 shrink-0" aria-hidden="true" />
        {label}
      </Link>
    );
  }

  const metrics = METRICS[variant] ?? METRICS.default;
  const showMenu = enableMenu !== false;
  const text = variant === 'compact' ? 'Scan' : label;

  // Group order matters twice: it draws the divider, and it fixes the roving
  // focus order, so the indexes below are one continuous run across both groups.
  const scanRows = items.filter((item) => item.group !== 'more');
  const moreRows = items.filter((item) => item.group === 'more');

  const renderRow = (item, index, first) => {
    const Icon = item.icon;
    return (
      <Link
        key={item.id}
        to={item.to}
        {...dropdown.getItemProps(index, { onClick: onNavigate })}
        className={cn(
          'flex w-full items-start gap-3 rounded-field px-2 py-2 text-left',
          'transition-colors hover:bg-surface-sunken',
          // The tint alone cannot be the focus indicator: surface ->
          // surface-sunken is 1.10:1 and is the same class hover uses, so the
          // roving focus useMenu maintains would be invisible AND
          // indistinguishable from a hovered row. Inset, because rows sit flush
          // against each other and an offset ring would overlap its neighbours.
          ROW_FOCUS,
          dropdown.activeIndex === index && 'bg-surface-sunken',
          // `border-default`, not `border-subtle`: in light mode --color-line-subtle
          // and the panel's own surface are one step apart at 1.03:1, so a subtle
          // rule between two groups of rows simply is not there.
          first && moreRows.length && item.group === 'more' && 'mt-1.5 border-t border-default pt-2.5',
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-field',
            item.chip,
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label-md text-default">{item.label}</span>
          <span className="block truncate text-caption text-muted">{item.description}</span>
        </span>
      </Link>
    );
  };

  return (
    <div className={cn('relative inline-flex', className)}>
      {/*
        The gradient lives HERE, once, so it runs continuously behind both
        segments. Putting it on each segment leaves a visible seam.
      */}
      <span
        className={cn(
          'inline-flex items-stretch rounded-pill',
          metrics.track,
          SCAN_FILL,
          'shadow-soft transition-shadow duration-150 ease-emphasized hover:shadow-card-hover',
          'motion-reduce:transition-none',
        )}
      >
        <Link
          to={to}
          onClick={onNavigate}
          className={cn(
            SCAN_LABEL,
            metrics.label,
            showMenu ? 'rounded-l-pill' : 'rounded-pill',
            'transition-colors duration-150 ease-emphasized motion-reduce:transition-none',
            ON_FILL_PRESS,
            SEGMENT_FOCUS,
          )}
          {...rest}
        >
          <ScanLine className="h-4 w-4 shrink-0" aria-hidden="true" />
          {text}
        </Link>

        {showMenu && (
          <>
            <span aria-hidden="true" className={cn('w-px shrink-0 bg-white/20', metrics.divider)} />
            <button
              type="button"
              {...dropdown.getTriggerProps({ 'aria-label': 'More scan options' })}
              className={cn(
                SCAN_LABEL,
                metrics.chevron,
                'rounded-r-pill transition-colors duration-150 ease-emphasized',
                'motion-reduce:transition-none',
                ON_FILL_PRESS,
                SEGMENT_FOCUS,
              )}
            >
              <ChevronDown
                className={cn(
                  // Only the TRANSITION goes under motion-reduce; the rotation
                  // itself is the open/closed indicator and has to stay.
                  'h-4 w-4 transition-transform duration-150 ease-emphasized',
                  'motion-reduce:transition-none',
                  dropdown.open && 'rotate-180',
                )}
                aria-hidden="true"
              />
            </button>
          </>
        )}
      </span>

      {showMenu && dropdown.open && (
        <div
          {...dropdown.getMenuProps({ 'aria-label': 'Scan options' })}
          className={cn(
            'absolute right-0 top-full z-dropdown mt-2 w-72 origin-top-right',
            'rounded-card border border-subtle bg-surface p-1.5 shadow-popover',
            'animate-ui-fade-in',
          )}
        >
          <p className="px-2 pb-1.5 pt-1 text-overline text-subtle">Start a skin check</p>
          {scanRows.map((item, index) => renderRow(item, index, false))}
          {moreRows.map((item, index) => renderRow(item, scanRows.length + index, index === 0))}
        </div>
      )}
    </div>
  );
}

export { QuickScanButton };
