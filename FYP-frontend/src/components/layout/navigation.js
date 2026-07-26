/**
 * navigation.js — the chrome's view of the route table.
 * ============================================================================
 *
 * WHAT THIS FILE IS NOW
 * ---------------------
 * A projection of `src/routes.js`, nothing more. It holds no links of its own.
 * AppNavbar, MobileDrawer, MobileTabBar, ProfileMenu and DashboardLayout keep
 * importing exactly the names they always did — PRIMARY_NAV, TAB_BAR_NAV,
 * WORKSPACE_NAV, PROFILE_MENU_ITEMS, visibleNav, visibleSections — so none of
 * those five components had to change. What changed is where the data comes
 * from.
 *
 * WHY IT CHANGED
 * --------------
 * The previous version was a hand-maintained copy of the route table, and it
 * had already drifted from reality in three separate ways:
 *
 *   1. Every link pointed at a PRE-REFACTOR path — `/try-now`, `/my-reports`,
 *      `/doctor-dashboard/referrals`. Those still resolve, because App.jsx keeps
 *      them all as permanent aliases, but each click would have cost a redirect
 *      hop AND broken NavLink's active state: you would be sitting on
 *      `/patient/scans` with "My scans" rendered as inactive, because the link's
 *      `to` said `/my-reports`.
 *   2. Six entries were marked `planned: true` and pointed at routes that do not
 *      exist in any table — `/settings`, `/profile`, `/admin-dashboard/users`,
 *      `/doctor-dashboard/profile`. Nothing filtered on that flag, so they were
 *      rendered as ordinary links straight into a redirect-to-home.
 *   3. The doctor sidebar was missing Requests entirely, and the patient sidebar
 *      was missing both Requests and Find-a-doctor, because those pages were
 *      added to the route table afterwards and nobody edited this file too.
 *
 * All three are the same bug: two lists that have to agree, and no mechanism
 * making them agree. There is now one list.
 *
 * VISIBILITY IS BY PERMISSION, NEVER BY ROLE STRING.
 * `permission: 'scan.read.own'` shows "My scans" to patients AND doctors AND
 * admins, because ROLE_PERMISSIONS is a real set union. `role === 'AI User'`
 * would hide a doctor's own scan history from them, which is the single-account
 * problem this refactor exists to fix.
 *
 * TO ADD A LINK: add a row to routes.js with the right `nav: [...]`. Do not add
 * anything here.
 */

import { NAV, SECTIONS, allowedForRole, navItems, sidebarSections } from '../../routes';

/**
 * @typedef {object} NavItem
 * @property {string} id
 * @property {string} label
 * @property {string} to
 * @property {React.ComponentType} [icon]
 * @property {string} [permission] Required permission; absent means "everyone".
 * @property {string[]} [anyPermission] At least one required.
 * @property {string[]} [excludeRoles] Roles that never see this link (nav only).
 * @property {boolean} [anonymous] Also show to logged-out visitors.
 * @property {boolean} [end] Match the route exactly (for index links).
 * @property {string} [section]
 * @property {string} [description]
 */

/** The primary header links (and the mobile drawer, which renders the same set). */
export const PRIMARY_NAV = Object.freeze(navItems(NAV.PRIMARY));

/**
 * The mobile bottom bar CANDIDATES, in navOrder. Four items maximum plus the
 * centre CTA — a fifth turns a 375px-wide bar into unreadable 60px columns.
 *
 * THE CAP IS APPLIED AFTER FILTERING, by `visibleTabBar` below, and that order
 * matters: an admin's four patient tabs are all excluded from their chrome, so
 * a cap taken here (over the raw list) would slice the admin rows off before
 * anybody could be filtered out of them, and the admin would be left with a
 * one-item bar reading "Home". Cap-then-filter also silently under-fills the bar
 * for anyone whose first four candidates they cannot all see.
 */
export const TAB_BAR_MAX_ITEMS = 4;
export const TAB_BAR_NAV = Object.freeze(navItems(NAV.TABBAR));

/**
 * Sidebar sections per workspace. Keys match the AuthContext workspace ids
 * ('patient' | 'doctor' | 'admin') that DashboardLayout indexes this object by.
 */
export const WORKSPACE_NAV = Object.freeze({
  patient: Object.freeze(sidebarSections(SECTIONS.PATIENT)),
  doctor: Object.freeze(sidebarSections(SECTIONS.DOCTOR)),
  admin: Object.freeze(sidebarSections(SECTIONS.ADMIN)),
});

/** The ProfileMenu entries, in order. */
export const PROFILE_MENU_ITEMS = Object.freeze(navItems(NAV.PROFILE));

/**
 * Filter a nav list for the current session.
 *
 * `permission` is ALL-semantics (it is a single string in practice) and
 * `anyPermission` is ANY-semantics, matching RequireAuth exactly — a link must
 * never be visible for a route the guard would bounce the user out of.
 *
 * `role` is the LAST word, and it can only ever REMOVE a link (`excludeRoles`,
 * see routes.js). It exists because permissions alone cannot express "an admin
 * holds scan.review.assigned but has no referrals of their own" — the union that
 * lets one account be a doctor and a patient also puts a doctor's and a
 * patient's whole navigation in front of every admin. Pass the EFFECTIVE role
 * (`auth.effectiveRole`), so an admin acting as a doctor still gets the doctor's
 * chrome.
 *
 * @param {ReadonlyArray<NavItem>} items
 * @param {{permissions?: string[], isAuthenticated?: boolean, role?: string|null}} session
 * @returns {NavItem[]}
 */
export function visibleNav(items, { permissions = [], isAuthenticated = false, role = null } = {}) {
  const held = Array.isArray(permissions) ? permissions : [];

  return (items || []).filter((item) => {
    if (!allowedForRole(item, role)) return false;
    if (item.permission) {
      return isAuthenticated && held.includes(item.permission);
    }
    if (Array.isArray(item.anyPermission) && item.anyPermission.length) {
      return isAuthenticated && item.anyPermission.some((p) => held.includes(p));
    }
    if (item.authenticated) return isAuthenticated;
    return true;
  });
}

/**
 * The bottom bar for one session: filtered, THEN capped. See TAB_BAR_NAV for
 * why that order is not interchangeable.
 */
export function visibleTabBar(session) {
  return visibleNav(TAB_BAR_NAV, session).slice(0, TAB_BAR_MAX_ITEMS);
}

/** Filter the grouped sidebar sections, dropping any section left empty. */
export function visibleSections(sections, session) {
  return (sections || [])
    .map((section) => ({ ...section, items: visibleNav(section.items, session) }))
    .filter((section) => section.items.length > 0);
}

export default {
  PRIMARY_NAV,
  PROFILE_MENU_ITEMS,
  TAB_BAR_MAX_ITEMS,
  TAB_BAR_NAV,
  WORKSPACE_NAV,
  visibleNav,
  visibleSections,
  visibleTabBar,
};
