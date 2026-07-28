/**
 * routes.js — THE route table, as data.
 * ============================================================================
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Before this, "what routes exist" was spread across five places that
 * disagreed with each other: App.jsx's <Routes>, the public Navbar's hardcoded
 * <Link>s, the doctor sidebar, the admin sidebar, and navigation.js. Adding a
 * page meant editing four files, and forgetting one of them is how a link ends
 * up visible to the wrong role — or pointing at a route that 404s.
 *
 * Everything now derives from the array below:
 *   - App.jsx           -> <Route> elements + the guards
 *   - navigation.js     -> PRIMARY_NAV / TAB_BAR_NAV / WORKSPACE_NAV / PROFILE_MENU
 *   - AuthContext       -> the workspace list (WORKSPACES)
 *   - QuickScanButton   -> QUICK_SCAN_ROUTE
 *
 * This module holds NO components and imports nothing heavier than icons, so it
 * is safe to import from a context, a test, or a nav bar without dragging a
 * page into the bundle. App.jsx owns the id -> lazy component mapping.
 *
 * VISIBILITY AND ACCESS ARE BY PERMISSION, NEVER BY ROLE STRING
 * ------------------------------------------------------------
 * `permission: 'scan.read.own'` opens /patient/scans to patients AND doctors
 * AND admins, because ROLE_PERMISSIONS is a real set union (see lib/permissions
 * and app/core/rbac.py). `role === 'AI User'` would lock a dermatologist out of
 * their own scan history and push them into a second account — the exact
 * problem this refactor exists to remove.
 *
 * The server re-checks every one of these. Hiding a link the user cannot use is
 * a UX concern; it is not the security control.
 *
 * `excludeRoles` — VISIBILITY ONLY, NEVER ACCESS
 * ----------------------------------------------
 * Because ADMIN_PERMS ⊃ DOCTOR_PERMS ⊃ PATIENT_PERMS, an admin holds
 * `scan.review.assigned` and `appointment.book` and therefore used to be shown
 * "Patient cases", "Referrals", "My scans", "Find a doctor" and a doctor+patient
 * workspace of their own. Every one of those was a dead end: an admin has no
 * DoctorProfile, so their doctor workspace lists no referrals, no schedule and
 * no ratings, and their patient workspace lists scans they never ran. The right
 * way for an admin to see a doctor's or a patient's surface is to ACT AS one
 * (ViewAsPicker → X-Act-As-User-Id), where the data is real and the action is
 * audited.
 *
 * So the doctor and patient NAV ENTRIES carry `excludeRoles: [ROLES.ADMIN]`.
 * Read that as "do not put this link in an admin's chrome", nothing more:
 *
 *   - `sectionRoutes()` in App.jsx does NOT consult it, so the ROUTES stay open
 *     to an admin. A pasted URL still works, and — critically — impersonation
 *     still works: the chrome filters on the EFFECTIVE role
 *     (`AuthContext.effectiveRole`, which is the act-as target's while
 *     delegating), so an admin acting as a doctor gets the full doctor sidebar.
 *   - `patient.profile` is deliberately NOT excluded. It is the account page
 *     every signed-in role needs, admins included.
 */

import {
  Activity,
  BadgeCheck,
  CalendarDays,
  ClipboardList,
  FileText,
  HelpCircle,
  Home,
  Inbox,
  LayoutDashboard,
  Lock,
  MapPin,
  ScanLine,
  ScrollText,
  Settings,
  ShieldCheck,
  Star,
  Stethoscope,
  UserCog,
  Users,
} from 'lucide-react';

import { PERMISSIONS, ROLES, normalizeRole } from './lib/permissions';

// ---------------------------------------------------------------------------
// Sections — which chrome a route renders inside
// ---------------------------------------------------------------------------

/**
 * PUBLIC  — AppShell chrome (navbar + footer + mobile tab bar), open to anyone.
 * FOCUSED — no chrome at all, full width. Used by logged-OUT visitors too, so
 *           it must never be behind a guard: the auth screen and the scan
 *           stepper both live here.
 * PATIENT / DOCTOR / ADMIN — DashboardLayout chrome behind RequireAuth.
 */
export const SECTIONS = Object.freeze({
  PUBLIC: 'public',
  FOCUSED: 'focused',
  PATIENT: 'patient',
  DOCTOR: 'doctor',
  ADMIN: 'admin',
});

/** The nav surfaces a route can appear on. A route may be on several, or none. */
export const NAV = Object.freeze({
  PRIMARY: 'primary', // desktop header + mobile drawer
  TABBAR: 'tabbar', // phone bottom bar (max 4 + the scan CTA)
  SIDEBAR: 'sidebar', // DashboardLayout rail
  PROFILE: 'profile', // account dropdown
});

// ---------------------------------------------------------------------------
// Paths — import these instead of typing a string
// ---------------------------------------------------------------------------

export const PATHS = Object.freeze({
  // public
  HOME: '/',
  FAQ: '/faq',
  PRIVACY: '/privacy-policy',
  TERMS: '/terms-of-use',

  // focused
  AUTH: '/auth',
  CONSULT: '/consult',

  // patient
  PATIENT_ROOT: '/patient',
  PATIENT_OVERVIEW: '/patient/overview',
  PATIENT_SCANS: '/patient/scans',
  PATIENT_APPOINTMENTS: '/patient/appointments',
  PATIENT_REQUESTS: '/patient/requests',
  PATIENT_FIND_DOCTOR: '/patient/find-doctor',
  PATIENT_PROFILE: '/patient/profile',

  // doctor
  DOCTOR_ROOT: '/doctor',
  DOCTOR_OVERVIEW: '/doctor/overview',
  DOCTOR_REFERRALS: '/doctor/referrals',
  DOCTOR_REQUESTS: '/doctor/requests',
  DOCTOR_APPOINTMENTS: '/doctor/appointments',
  DOCTOR_SCHEDULE: '/doctor/schedule',
  DOCTOR_PATIENTS: '/doctor/patients',
  DOCTOR_PATIENT_DETAIL: '/doctor/patients/:patientId',
  DOCTOR_RATINGS: '/doctor/ratings',
  DOCTOR_PENDING_APPROVAL: '/doctor/pending-approval',

  // admin
  ADMIN_ROOT: '/admin',
  ADMIN_OVERVIEW: '/admin/overview',
  ADMIN_DOCTORS: '/admin/doctors',
  ADMIN_PATIENTS: '/admin/patients',
  ADMIN_SCANS: '/admin/scans',
  ADMIN_APPOINTMENTS: '/admin/appointments',
  ADMIN_AUDIT_LOG: '/admin/audit-log',
  ADMIN_SETTINGS: '/admin/settings',
});

/** Build `/doctor/patients/42` without concatenating strings at the call site. */
export function doctorPatientPath(patientId) {
  return `/doctor/patients/${encodeURIComponent(String(patientId))}`;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/**
 * @typedef {object} AppRoute
 * @property {string}   id          Stable key. App.jsx maps this to a component.
 * @property {string}   path        The router path (may contain :params).
 * @property {string}   section     One of SECTIONS.
 * @property {string}   label       Page/nav label.
 * @property {string}   [navLabel]  Overrides `label` in PRIMARY_NAV / drawer.
 * @property {string}   [shortLabel] Overrides `label` in the mobile tab bar.
 * @property {Function} [icon]      lucide icon component.
 * @property {string}   [permission] Required permission (ALL semantics).
 * @property {string[]} [anyPermission] At least one required.
 * @property {string[]} [excludeRoles] Roles this route is hidden from in NAV only.
 *   Access is unaffected — see the `excludeRoles` note at the top of this file.
 * @property {boolean}  [anonymous] Visible to logged-out visitors.
 * @property {boolean}  [end]       Exact match for NavLink / index routes.
 * @property {string[]} [nav]       Which NAV surfaces list this route.
 * @property {number}   [navOrder]  Sort key for the FLAT surfaces (header, tab
 *   bar, profile menu); lower first, default 100, ties keep table order. It is
 *   deliberately NOT applied to the sidebar: `sidebarSections` keeps table order
 *   so that its group headings stay in a stable, meaningful sequence rather than
 *   being reshuffled by a header-only preference.
 * @property {string}   [group]     Sidebar group heading.
 * @property {string}   [description] Longer copy for empty states / menus.
 */

/** The default `navOrder`. Rows that do not care sort between the pinned ones. */
const DEFAULT_NAV_ORDER = 100;

/**
 * The nav-only exclusion every doctor/patient surface carries. Named rather than
 * inlined so one grep finds every row it applies to, and so the reason lives in
 * exactly one place (the `excludeRoles` note in the file header).
 */
const NOT_IN_ADMIN_CHROME = Object.freeze([ROLES.ADMIN]);

/** @type {ReadonlyArray<AppRoute>} */
export const ROUTES = Object.freeze([
  // ---------------------------------------------------------------- public --
  {
    id: 'landing',
    path: PATHS.HOME,
    section: SECTIONS.PUBLIC,
    label: 'Home',
    icon: Home,
    anonymous: true,
    end: true,
    // TABBAR only. The header's brand mark IS the link home, so a "Home" item
    // beside it was the same destination twice in one bar. The phone bottom bar
    // has no brand mark, so it keeps the tab.
    nav: [NAV.TABBAR],
    navOrder: 10,
  },
  {
    id: 'faq',
    path: PATHS.FAQ,
    section: SECTIONS.PUBLIC,
    label: 'FAQ',
    icon: HelpCircle,
    anonymous: true,
    nav: [NAV.PRIMARY],
    // Pinned last in the header: a support link must never outrank the product.
    navOrder: 90,
  },
  {
    id: 'privacy',
    path: PATHS.PRIVACY,
    section: SECTIONS.PUBLIC,
    label: 'Privacy policy',
    icon: Lock,
    anonymous: true,
    nav: [],
  },
  {
    id: 'terms',
    path: PATHS.TERMS,
    section: SECTIONS.PUBLIC,
    label: 'Terms of use',
    icon: FileText,
    anonymous: true,
    nav: [],
  },

  // --------------------------------------------------------------- focused --
  {
    id: 'auth',
    path: PATHS.AUTH,
    section: SECTIONS.FOCUSED,
    label: 'Sign in',
    icon: BadgeCheck,
    anonymous: true,
    nav: [],
    description: 'One account for patients, doctors and admins.',
  },
  {
    id: 'consult',
    path: PATHS.CONSULT,
    section: SECTIONS.FOCUSED,
    label: 'AI Scan',
    navLabel: 'AI Scan',
    icon: ScanLine,
    anonymous: true,
    // Deliberately in NO nav surface. QuickScanButton is the scan entry point on
    // every surface (header, dashboard topbar, phone tab bar, drawer); a header
    // link beside that CTA was two scan buttons competing for one action.
    nav: [],
    description: 'Upload a photo, answer a few optional questions, pick your doctors and times.',
  },

  // --------------------------------------------------------------- patient --
  {
    id: 'patient.overview',
    path: PATHS.PATIENT_OVERVIEW,
    section: SECTIONS.PATIENT,
    label: 'Overview',
    icon: LayoutDashboard,
    permission: PERMISSIONS.SCAN_READ_OWN,
    excludeRoles: NOT_IN_ADMIN_CHROME,
    group: 'My health',
    nav: [NAV.SIDEBAR],
    end: true,
    description: 'Your skin health at a glance: scans, reviews and visits.',
  },
  {
    id: 'patient.scans',
    path: PATHS.PATIENT_SCANS,
    section: SECTIONS.PATIENT,
    label: 'My scans',
    shortLabel: 'Scans',
    icon: FileText,
    permission: PERMISSIONS.SCAN_READ_OWN,
    excludeRoles: NOT_IN_ADMIN_CHROME,
    group: 'My health',
    nav: [NAV.PRIMARY, NAV.TABBAR, NAV.SIDEBAR, NAV.PROFILE],
    navOrder: 40,
    end: true,
    description: 'Every scan you have run, with its report and history.',
  },
  {
    id: 'patient.appointments',
    path: PATHS.PATIENT_APPOINTMENTS,
    section: SECTIONS.PATIENT,
    label: 'Appointments',
    shortLabel: 'Visits',
    icon: CalendarDays,
    permission: PERMISSIONS.APPOINTMENT_READ_OWN,
    excludeRoles: NOT_IN_ADMIN_CHROME,
    group: 'My health',
    nav: [NAV.TABBAR, NAV.SIDEBAR, NAV.PROFILE],
    navOrder: 45,
    description: 'Upcoming and past visits, and re-booking from an old record.',
  },
  {
    id: 'patient.requests',
    path: PATHS.PATIENT_REQUESTS,
    section: SECTIONS.PATIENT,
    label: 'Consultation requests',
    shortLabel: 'Requests',
    icon: ClipboardList,
    permission: PERMISSIONS.APPOINTMENT_BOOK,
    excludeRoles: NOT_IN_ADMIN_CHROME,
    group: 'My health',
    nav: [NAV.SIDEBAR],
    description: 'Requests you sent to several doctors at once, and who replied.',
  },
  {
    id: 'patient.findDoctor',
    path: PATHS.PATIENT_FIND_DOCTOR,
    section: SECTIONS.PATIENT,
    label: 'Find a doctor',
    shortLabel: 'Doctors',
    icon: MapPin,
    permission: PERMISSIONS.APPOINTMENT_BOOK,
    excludeRoles: NOT_IN_ADMIN_CHROME,
    group: 'My health',
    nav: [NAV.PRIMARY, NAV.TABBAR, NAV.SIDEBAR],
    navOrder: 30,
    description: 'Dermatologists near you, on a map.',
  },
  {
    id: 'patient.profile',
    path: PATHS.PATIENT_PROFILE,
    section: SECTIONS.PATIENT,
    label: 'Profile',
    icon: UserCog,
    // Held by every signed-in role, so this is "any authenticated user".
    permission: PERMISSIONS.SCAN_READ_OWN,
    group: 'Account',
    nav: [NAV.SIDEBAR, NAV.PROFILE],
    // First in the account dropdown, where "Profile" is the conventional lead.
    navOrder: 10,
    description: 'Your details, consents and privacy choices.',
  },

  // ---------------------------------------------------------------- doctor --
  {
    id: 'doctor.overview',
    path: PATHS.DOCTOR_OVERVIEW,
    section: SECTIONS.DOCTOR,
    label: 'Overview',
    icon: LayoutDashboard,
    permission: PERMISSIONS.SCAN_REVIEW_ASSIGNED,
    excludeRoles: NOT_IN_ADMIN_CHROME,
    group: 'Practice',
    nav: [NAV.SIDEBAR],
    end: true,
    description: 'Your practice at a glance: queue, bookings and rating.',
  },
  {
    id: 'doctor.referrals',
    path: PATHS.DOCTOR_REFERRALS,
    section: SECTIONS.DOCTOR,
    label: 'Referrals',
    navLabel: 'Patient cases',
    icon: ClipboardList,
    permission: PERMISSIONS.SCAN_REVIEW_ASSIGNED,
    excludeRoles: NOT_IN_ADMIN_CHROME,
    group: 'Practice',
    nav: [NAV.PRIMARY, NAV.SIDEBAR],
    navOrder: 50,
    end: true,
    description: 'Scans sent to you for review.',
  },
  {
    id: 'doctor.requests',
    path: PATHS.DOCTOR_REQUESTS,
    section: SECTIONS.DOCTOR,
    label: 'Requests',
    icon: Inbox,
    permission: PERMISSIONS.SCAN_REVIEW_ASSIGNED,
    excludeRoles: NOT_IN_ADMIN_CHROME,
    group: 'Practice',
    nav: [NAV.SIDEBAR],
    description: 'Appointment requests addressed to you, with the times the patient offered.',
  },
  {
    id: 'doctor.appointments',
    path: PATHS.DOCTOR_APPOINTMENTS,
    section: SECTIONS.DOCTOR,
    label: 'Appointments',
    icon: CalendarDays,
    permission: PERMISSIONS.APPOINTMENT_RESOLVE_CONFLICT,
    excludeRoles: NOT_IN_ADMIN_CHROME,
    group: 'Practice',
    nav: [NAV.SIDEBAR],
  },
  {
    id: 'doctor.patients',
    path: PATHS.DOCTOR_PATIENTS,
    section: SECTIONS.DOCTOR,
    label: 'Patients',
    icon: Users,
    permission: PERMISSIONS.SCAN_REVIEW_ASSIGNED,
    excludeRoles: NOT_IN_ADMIN_CHROME,
    group: 'Practice',
    nav: [NAV.SIDEBAR],
    end: true,
  },
  {
    id: 'doctor.patientDetail',
    path: PATHS.DOCTOR_PATIENT_DETAIL,
    section: SECTIONS.DOCTOR,
    label: 'Patient',
    icon: Users,
    permission: PERMISSIONS.SCAN_REVIEW_ASSIGNED,
    nav: [], // reached from the patient list, never from a nav bar
  },
  {
    id: 'doctor.schedule',
    path: PATHS.DOCTOR_SCHEDULE,
    section: SECTIONS.DOCTOR,
    label: 'Schedule & fees',
    icon: Activity,
    permission: PERMISSIONS.SCHEDULE_MANAGE,
    excludeRoles: NOT_IN_ADMIN_CHROME,
    group: 'Clinic',
    nav: [NAV.SIDEBAR],
  },
  {
    id: 'doctor.ratings',
    path: PATHS.DOCTOR_RATINGS,
    section: SECTIONS.DOCTOR,
    label: 'Ratings',
    icon: Star,
    permission: PERMISSIONS.DOCTOR_PROFILE_MANAGE,
    excludeRoles: NOT_IN_ADMIN_CHROME,
    group: 'Clinic',
    nav: [NAV.SIDEBAR],
  },
  {
    id: 'doctor.pendingApproval',
    path: PATHS.DOCTOR_PENDING_APPROVAL,
    section: SECTIONS.DOCTOR,
    label: 'Verification',
    icon: BadgeCheck,
    // A doctor awaiting (or refused) licence approval still holds the Doctor
    // permission set — `require_doctor_approved` is a separate backend gate — so
    // this page must stay reachable for exactly them.
    anyPermission: [PERMISSIONS.SCHEDULE_MANAGE, PERMISSIONS.DOCTOR_PROFILE_MANAGE],
    nav: [],
    description: 'Where your licence check has got to.',
  },

  // ----------------------------------------------------------------- admin --
  //
  // These four are also on NAV.TABBAR. Before, an admin on a phone got the
  // PATIENT tab bar (Find a doctor / Scans / Visits) because they hold those
  // permissions; now that those rows are excluded from admin chrome, without
  // these the bar would collapse to "Home" alone. The cap is applied AFTER
  // role filtering (navigation.js), so a patient's bar is unchanged — these sort
  // at 60+ and are dropped for them by permission anyway.
  {
    id: 'admin.overview',
    path: PATHS.ADMIN_OVERVIEW,
    section: SECTIONS.ADMIN,
    label: 'Overview',
    navLabel: 'Admin',
    shortLabel: 'Console',
    icon: LayoutDashboard,
    permission: PERMISSIONS.ADMIN_STATS,
    group: 'Platform',
    nav: [NAV.PRIMARY, NAV.TABBAR, NAV.SIDEBAR],
    navOrder: 60,
    end: true,
  },
  {
    id: 'admin.doctors',
    path: PATHS.ADMIN_DOCTORS,
    section: SECTIONS.ADMIN,
    label: 'Doctors',
    icon: Stethoscope,
    permission: PERMISSIONS.DOCTOR_VERIFY,
    group: 'Platform',
    nav: [NAV.TABBAR, NAV.SIDEBAR],
    navOrder: 61,
  },
  {
    id: 'admin.patients',
    path: PATHS.ADMIN_PATIENTS,
    section: SECTIONS.ADMIN,
    label: 'Patients',
    icon: Users,
    permission: PERMISSIONS.USER_READ_ANY,
    group: 'Platform',
    nav: [NAV.TABBAR, NAV.SIDEBAR],
    navOrder: 62,
  },
  {
    id: 'admin.scans',
    path: PATHS.ADMIN_SCANS,
    section: SECTIONS.ADMIN,
    label: 'Scans',
    icon: ScanLine,
    permission: PERMISSIONS.SCAN_READ_ANY,
    group: 'Oversight',
    nav: [NAV.SIDEBAR],
  },
  {
    id: 'admin.appointments',
    path: PATHS.ADMIN_APPOINTMENTS,
    section: SECTIONS.ADMIN,
    label: 'Appointments',
    shortLabel: 'Bookings',
    icon: CalendarDays,
    permission: PERMISSIONS.APPOINTMENT_READ_ANY,
    group: 'Oversight',
    nav: [NAV.TABBAR, NAV.SIDEBAR],
    navOrder: 63,
  },
  {
    id: 'admin.auditLog',
    path: PATHS.ADMIN_AUDIT_LOG,
    section: SECTIONS.ADMIN,
    label: 'Audit log',
    icon: ScrollText,
    permission: PERMISSIONS.ADMIN_AUDIT_READ,
    group: 'Oversight',
    nav: [NAV.SIDEBAR],
  },
  {
    id: 'admin.settings',
    path: PATHS.ADMIN_SETTINGS,
    section: SECTIONS.ADMIN,
    label: 'Settings',
    icon: Settings,
    // Same admin-only gate as the audit log — the tightest permission any admin
    // route already carries. The backend additionally restricts WRITES to the
    // root administrator; the client shows that 403 inline rather than hiding
    // the page from non-root admins who may still read the configuration.
    permission: PERMISSIONS.ADMIN_AUDIT_READ,
    group: 'Oversight',
    nav: [NAV.SIDEBAR],
    description: 'Email delivery and OTP verification for the whole platform.',
  },
]);

// ---------------------------------------------------------------------------
// Guarded sections
// ---------------------------------------------------------------------------

/**
 * The three dashboard sections. `base` is what the layout route and the
 * per-section 404 hang off; `home` is where a bare `/patient` lands.
 */
export const SECTION_META = Object.freeze({
  [SECTIONS.PATIENT]: Object.freeze({
    id: SECTIONS.PATIENT,
    base: PATHS.PATIENT_ROOT,
    home: PATHS.PATIENT_OVERVIEW,
    label: 'My skin health',
    workspace: 'patient',
  }),
  [SECTIONS.DOCTOR]: Object.freeze({
    id: SECTIONS.DOCTOR,
    base: PATHS.DOCTOR_ROOT,
    home: PATHS.DOCTOR_OVERVIEW,
    label: 'Doctor workspace',
    workspace: 'doctor',
  }),
  [SECTIONS.ADMIN]: Object.freeze({
    id: SECTIONS.ADMIN,
    base: PATHS.ADMIN_ROOT,
    home: PATHS.ADMIN_OVERVIEW,
    label: 'Admin console',
    workspace: 'admin',
  }),
});

/** Every route that lives in a section, in table order. */
export function routesInSection(section) {
  return ROUTES.filter((route) => route.section === section);
}

/** Look a route up by its stable id. */
export function routeById(id) {
  return ROUTES.find((route) => route.id === id) || null;
}

/** Look a route up by its literal path (no param matching). */
export function routeByPath(path) {
  return ROUTES.find((route) => route.path === path) || null;
}

/**
 * The guard for a whole section: the union of every permission any of its
 * routes accepts, evaluated with ANY semantics. It is deliberately the *loosest*
 * gate in the section — each leaf route still carries its own, stricter one, so
 * a patient who reaches /admin/* is stopped here and a doctor who reaches
 * /admin/audit-log is stopped at the leaf.
 * @returns {string[]}
 */
export function sectionPermissions(section) {
  const seen = new Set();
  routesInSection(section).forEach((route) => {
    if (route.permission) seen.add(route.permission);
    (route.anyPermission || []).forEach((permission) => seen.add(permission));
  });
  return [...seen];
}

export const SECTION_GUARDS = Object.freeze({
  [SECTIONS.PATIENT]: Object.freeze(sectionPermissions(SECTIONS.PATIENT)),
  [SECTIONS.DOCTOR]: Object.freeze(sectionPermissions(SECTIONS.DOCTOR)),
  [SECTIONS.ADMIN]: Object.freeze(sectionPermissions(SECTIONS.ADMIN)),
});

// ---------------------------------------------------------------------------
// Workspaces — one account, several surfaces
// ---------------------------------------------------------------------------

/**
 * The surfaces an account can open, most privileged first. AuthContext derives
 * `workspaces` from this when `/auth/me` does not supply them, and normalises
 * the server's list against it (the server answers `{key,label,route}` with the
 * pre-refactor routes; the CLIENT owns routing, so its paths win).
 *
 * A Doctor gets BOTH the doctor and the patient workspace, by permission — that
 * is the whole "no duplicate accounts" requirement in one array.
 *
 * AN ADMIN GETS ONE. A doctor's patient workspace is genuinely theirs: they have
 * their own skin, their own scans, their own appointments. An admin's "doctor
 * workspace" is not — there is no DoctorProfile behind it, so Referrals,
 * Schedule & fees and Ratings are all permanently empty, and the switcher was
 * offering a door into three blank pages. `excludeRoles` removes those two
 * entries for an admin; ACTING AS a specific doctor or patient is how an admin
 * reaches a real one, and that path is audited.
 */
export const WORKSPACES = Object.freeze([
  Object.freeze({
    id: 'admin',
    label: 'Admin console',
    description: 'Platform, doctors and audit trail',
    route: PATHS.ADMIN_ROOT,
    home: PATHS.ADMIN_OVERVIEW,
    role: ROLES.ADMIN,
    anyPermission: Object.freeze([PERMISSIONS.ADMIN_STATS]),
  }),
  Object.freeze({
    id: 'doctor',
    label: 'Doctor workspace',
    description: 'Patient cases, schedule and clinic profile',
    route: PATHS.DOCTOR_ROOT,
    home: PATHS.DOCTOR_OVERVIEW,
    role: ROLES.DOCTOR,
    excludeRoles: NOT_IN_ADMIN_CHROME,
    anyPermission: Object.freeze([
      PERMISSIONS.SCAN_REVIEW_ASSIGNED,
      PERMISSIONS.SCAN_REVIEW_ANY,
      PERMISSIONS.SCHEDULE_MANAGE,
    ]),
  }),
  Object.freeze({
    id: 'patient',
    label: 'My skin health',
    description: 'Your own scans, reports and appointments',
    route: PATHS.PATIENT_ROOT,
    home: PATHS.PATIENT_OVERVIEW,
    role: ROLES.PATIENT,
    excludeRoles: NOT_IN_ADMIN_CHROME,
    anyPermission: Object.freeze([PERMISSIONS.SCAN_CREATE, PERMISSIONS.SCAN_READ_OWN]),
  }),
]);

export function workspaceById(id) {
  if (!id) return null;
  return WORKSPACES.find((workspace) => workspace.id === id) || null;
}

/**
 * Is this row (a ROUTE, a nav item or a WORKSPACES entry) part of `role`'s own
 * chrome?
 *
 * The ONE place `excludeRoles` is interpreted, so "hidden from an admin's
 * navigation" can never drift into "an admin cannot open it". Anything without
 * an `excludeRoles` array is visible to everyone who holds its permission, which
 * is every row but the ten doctor/patient nav entries.
 *
 * @param {{excludeRoles?: string[]}} row
 * @param {string|null} role The EFFECTIVE role — while an admin is acting as
 *   someone, pass the target's role so the chrome matches the surface.
 */
export function allowedForRole(row, role) {
  const excluded = row?.excludeRoles;
  if (!Array.isArray(excluded) || !excluded.length) return true;
  const resolved = normalizeRole(role);
  if (!resolved) return true;
  return !excluded.includes(resolved);
}

// ---------------------------------------------------------------------------
// Permanent aliases — every pre-refactor deep link still resolves
// ---------------------------------------------------------------------------

/**
 * Nothing that ever worked is allowed to 404. A bookmark, an email link, a
 * QR code on a printed report — they all keep landing somewhere sensible.
 *
 * `remapUnder` deep-maps the splat: `/doctor-dashboard/ratings` becomes
 * `/doctor/ratings` because that route exists, and anything unrecognised falls
 * back to `to`. That is how a doctor's bookmarked sub-page survives, instead of
 * everyone being dumped on the section index.
 *
 * `search` is merged INTO the incoming query string, which is preserved. This
 * matters: RequireAuth bounces anonymous visitors to `/login?returnTo=…`, and
 * an alias that dropped the query would silently break every return-to-page.
 *
 * @type {ReadonlyArray<{from:string, to:string, remapUnder?:string, search?:Record<string,string>}>}
 */
export const ALIASES = Object.freeze([
  // auth — /login is still RequireAuth.AUTH_ROUTE and is still what the navbar,
  // the drawer and every existing ?returnTo= link point at.
  { from: '/login', to: PATHS.AUTH },
  { from: '/register', to: PATHS.AUTH, search: { mode: 'signup' } },

  // the scan flow
  { from: '/try-now', to: PATHS.CONSULT },
  { from: '/patient/scan', to: PATHS.CONSULT },

  // directory
  { from: '/nearby-doctors', to: PATHS.PATIENT_FIND_DOCTOR },

  // patient dashboard
  { from: '/my-reports', to: PATHS.PATIENT_SCANS },
  { from: '/my-reports/*', to: PATHS.PATIENT_SCANS, remapUnder: PATHS.PATIENT_ROOT },

  // doctor dashboard
  { from: '/doctor-dashboard', to: PATHS.DOCTOR_OVERVIEW },
  { from: '/doctor-dashboard/*', to: PATHS.DOCTOR_OVERVIEW, remapUnder: PATHS.DOCTOR_ROOT },

  // admin dashboard
  { from: '/admin-dashboard', to: PATHS.ADMIN_OVERVIEW },
  { from: '/admin-dashboard/*', to: PATHS.ADMIN_OVERVIEW, remapUnder: PATHS.ADMIN_ROOT },

  // section indexes
  { from: PATHS.PATIENT_ROOT, to: PATHS.PATIENT_OVERVIEW },
  { from: PATHS.DOCTOR_ROOT, to: PATHS.DOCTOR_OVERVIEW },
  { from: PATHS.ADMIN_ROOT, to: PATHS.ADMIN_OVERVIEW },
]);

/**
 * Where an alias hit actually goes.
 * @param {{to:string, remapUnder?:string}} alias
 * @param {string} [splat] The `*` capture, e.g. 'ratings' or 'patients/42'.
 * @returns {string}
 */
export function resolveAlias(alias, splat) {
  if (!alias?.remapUnder || !splat) return alias?.to || PATHS.HOME;
  const trimmed = String(splat).replace(/^\/+|\/+$/g, '');
  if (!trimmed) return alias.to;

  const candidate = `${alias.remapUnder}/${trimmed}`;
  if (routeByPath(candidate)) return candidate;

  // '/doctor-dashboard/patients/42' -> '/doctor/patients/42': match the
  // parameterised route by segment count and literal prefix.
  const parts = candidate.split('/');
  const matched = ROUTES.find((route) => {
    const routeParts = route.path.split('/');
    if (routeParts.length !== parts.length) return false;
    return routeParts.every((segment, i) => segment.startsWith(':') || segment === parts[i]);
  });
  return matched ? candidate : alias.to;
}

// ---------------------------------------------------------------------------
// Nav derivation — everything the chrome renders comes from here
// ---------------------------------------------------------------------------

/**
 * The label a route wears on one particular surface.
 *
 * TABBAR  — `shortLabel`: a 60px column fits "Visits", not "Appointments".
 * PRIMARY — `navLabel`: the global header is read by everyone, so a doctor's
 *   "Referrals" needs the wider "Patient cases" and admin's "Overview" needs to
 *   say "Admin" to be meaningful next to Home and FAQ.
 * SIDEBAR / PROFILE — the plain `label`. These render INSIDE a workspace that is
 *   already titled, so the disambiguating prefix is noise: the doctor sidebar
 *   should read "Referrals", not "Patient cases", under a "Practice" heading.
 */
function labelFor(route, surface) {
  if (surface === NAV.TABBAR) return route.shortLabel || route.label;
  if (surface === NAV.PRIMARY) return route.navLabel || route.label;
  return route.label;
}

/** Turn a route row into the `{id,label,to,icon,permission,...}` nav items the
 *  layout components already consume. */
function toNavItem(route, surface) {
  const label = labelFor(route, surface);

  return {
    id: route.id,
    label,
    to: route.path,
    icon: route.icon,
    end: route.end,
    section: route.section,
    description: route.description,
    ...(route.permission ? { permission: route.permission } : {}),
    ...(route.anyPermission ? { anyPermission: [...route.anyPermission] } : {}),
    // Carried onto the item so `visibleNav` can apply it without reaching back
    // into ROUTES for every render.
    ...(route.excludeRoles ? { excludeRoles: [...route.excludeRoles] } : {}),
    ...(route.anonymous ? { anonymous: true } : {}),
  };
}

/**
 * Every route that opts into a flat nav surface, sorted by `navOrder` and then
 * by table position (Array.prototype.sort is stable, so equal keys keep their
 * declared order).
 * @param {string} surface One of NAV.
 * @returns {Array<object>}
 */
export function navItems(surface) {
  return ROUTES
    .filter((route) => Array.isArray(route.nav) && route.nav.includes(surface))
    .slice()
    .sort((a, b) => (a.navOrder ?? DEFAULT_NAV_ORDER) - (b.navOrder ?? DEFAULT_NAV_ORDER))
    .map((route) => toNavItem(route, surface));
}

/**
 * The sidebar for one section, grouped by `group` in first-appearance order and
 * with parameterised/hidden routes left out.
 * @param {string} section
 * @returns {Array<{title:string, items:Array<object>}>}
 */
export function sidebarSections(section) {
  const groups = [];
  const byTitle = new Map();

  routesInSection(section)
    .filter((route) => Array.isArray(route.nav) && route.nav.includes(NAV.SIDEBAR))
    .forEach((route) => {
      const title = route.group || '';
      if (!byTitle.has(title)) {
        const entry = { title, items: [] };
        byTitle.set(title, entry);
        groups.push(entry);
      }
      byTitle.get(title).items.push(toNavItem(route, NAV.SIDEBAR));
    });

  return groups;
}

export default {
  ALIASES,
  NAV,
  PATHS,
  ROUTES,
  SECTIONS,
  SECTION_GUARDS,
  SECTION_META,
  WORKSPACES,
  allowedForRole,
  doctorPatientPath,
  navItems,
  resolveAlias,
  routeById,
  routeByPath,
  routesInSection,
  sectionPermissions,
  sidebarSections,
  workspaceById,
};
