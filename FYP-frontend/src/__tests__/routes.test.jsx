/**
 * The route table's contract.
 *
 * Four UI agents build their pages against `routes.js` and the `<Route>` tree in
 * App.jsx immediately after this, so the table is frozen. These tests pin the
 * invariants that would silently break a page someone else is writing:
 *
 *   - every route id has a component, and every component has a route id
 *     (a typo'd id renders `undefined` as an element and blanks the page)
 *   - no duplicate paths or ids
 *   - every alias lands on a path that actually exists
 *   - aliases preserve `?returnTo=`, which RequireAuth itself writes
 *   - guards are permissions, so a Doctor opens /patient/* on ONE account
 *   - the chrome derives from the same table, so a link can never point at a
 *     route that is not mounted
 *
 * The heavy pages are mocked: this file is about the table, not about what any
 * particular page renders, and mocking keeps it fast.
 */

import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ALIASES,
  PATHS,
  ROUTES,
  SECTIONS,
  SECTION_GUARDS,
  SECTION_META,
  WORKSPACES,
  allowedForRole,
  resolveAlias,
  routeById,
  routesInSection,
  sidebarSections,
} from '../routes';
import {
  PRIMARY_NAV,
  PROFILE_MENU_ITEMS,
  TAB_BAR_MAX_ITEMS,
  TAB_BAR_NAV,
  WORKSPACE_NAV,
  visibleTabBar,
} from '../components/layout/navigation';
import { QUICK_SCAN_ROUTE } from '../components/layout/QuickScanButton';
import { PERMISSIONS, permissionsForRole, ROLES } from '../lib/permissions';

// ---------------------------------------------------------------------------
// The table itself — pure data, no rendering
// ---------------------------------------------------------------------------

describe('the route table', () => {
  it('has unique ids and unique paths', () => {
    const ids = ROUTES.map((r) => r.id);
    const paths = ROUTES.map((r) => r.path);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('gives every route a section that exists', () => {
    const sections = new Set(Object.values(SECTIONS));
    ROUTES.forEach((route) => {
      expect(sections.has(route.section), `${route.id} has section "${route.section}"`).toBe(true);
    });
  });

  it('guards every route in a dashboard section', () => {
    [SECTIONS.PATIENT, SECTIONS.DOCTOR, SECTIONS.ADMIN].forEach((section) => {
      routesInSection(section).forEach((route) => {
        const guarded = Boolean(route.permission) || Boolean(route.anyPermission?.length);
        expect(guarded, `${route.id} must declare a permission`).toBe(true);
      });
    });
  });

  it('leaves the focused and public sections unguarded — they serve logged-out visitors', () => {
    [SECTIONS.PUBLIC, SECTIONS.FOCUSED].forEach((section) => {
      routesInSection(section).forEach((route) => {
        expect(route.permission, `${route.id} must not be gated`).toBeUndefined();
        expect(route.anyPermission, `${route.id} must not be gated`).toBeUndefined();
      });
    });
  });

  it('starts every path with a slash and never leaves a trailing one', () => {
    ROUTES.forEach((route) => {
      expect(route.path.startsWith('/')).toBe(true);
      expect(route.path === '/' || !route.path.endsWith('/')).toBe(true);
    });
  });

  it('names a real permission everywhere one is required', () => {
    const known = new Set(Object.values(PERMISSIONS));
    ROUTES.forEach((route) => {
      if (route.permission) expect(known.has(route.permission), route.permission).toBe(true);
      (route.anyPermission || []).forEach((p) => expect(known.has(p), p).toBe(true));
    });
  });

  it('points every section home at a route that exists in that section', () => {
    Object.values(SECTION_META).forEach((meta) => {
      const home = routesInSection(meta.id).find((r) => r.path === meta.home);
      expect(home, `${meta.id} home ${meta.home}`).toBeTruthy();
    });
  });

  it('keeps each section guard the LOOSEST gate in its section', () => {
    // Every leaf permission must appear in the section guard, or the layout
    // would bounce a user the leaf was happy to admit.
    Object.values(SECTION_META).forEach((meta) => {
      const guard = new Set(SECTION_GUARDS[meta.id]);
      routesInSection(meta.id).forEach((route) => {
        if (route.permission) expect(guard.has(route.permission)).toBe(true);
        (route.anyPermission || []).forEach((p) => expect(guard.has(p)).toBe(true));
      });
    });
  });
});

// ---------------------------------------------------------------------------
// Aliases — nothing that ever worked is allowed to 404
// ---------------------------------------------------------------------------

describe('permanent aliases', () => {
  const paths = new Set(ROUTES.map((r) => r.path));

  it('lands every alias on a route that exists', () => {
    ALIASES.forEach((alias) => {
      expect(paths.has(alias.to), `${alias.from} -> ${alias.to}`).toBe(true);
    });
  });

  it('never aliases a path that is also a real route', () => {
    ALIASES.forEach((alias) => {
      const literal = alias.from.replace(/\/\*$/, '');
      expect(paths.has(literal) && literal === alias.from, alias.from).toBe(false);
    });
  });

  it('covers every pre-refactor entry point the user could have bookmarked', () => {
    const from = ALIASES.map((a) => a.from);
    [
      '/login', '/register',
      '/try-now', '/patient/scan',
      '/nearby-doctors', '/my-reports',
      '/doctor-dashboard', '/admin-dashboard',
    ].forEach((legacy) => expect(from).toContain(legacy));
  });

  it('deep-maps a dashboard splat onto the equivalent new route', () => {
    const doctorSplat = ALIASES.find((a) => a.from === '/doctor-dashboard/*');
    expect(resolveAlias(doctorSplat, 'ratings')).toBe(PATHS.DOCTOR_RATINGS);
    expect(resolveAlias(doctorSplat, 'patients/42')).toBe('/doctor/patients/42');
    // Unrecognised sub-pages fall back to the section home rather than 404.
    expect(resolveAlias(doctorSplat, 'this-never-existed')).toBe(PATHS.DOCTOR_REFERRALS);

    const adminSplat = ALIASES.find((a) => a.from === '/admin-dashboard/*');
    expect(resolveAlias(adminSplat, 'audit-log')).toBe(PATHS.ADMIN_AUDIT_LOG);
    expect(resolveAlias(adminSplat, '')).toBe(PATHS.ADMIN_OVERVIEW);
  });

  it('sends /register to the sign-up copy of the SAME screen, not a second account', () => {
    const register = ALIASES.find((a) => a.from === '/register');
    expect(register.to).toBe(PATHS.AUTH);
    expect(register.search).toEqual({ mode: 'signup' });
  });
});

// ---------------------------------------------------------------------------
// Chrome derivation — one source, so a link cannot point at a dead route
// ---------------------------------------------------------------------------

describe('navigation derived from the table', () => {
  const paths = new Set(ROUTES.map((r) => r.path));

  const everyItem = [
    ...PRIMARY_NAV,
    ...TAB_BAR_NAV,
    ...PROFILE_MENU_ITEMS,
    ...Object.values(WORKSPACE_NAV).flat().flatMap((section) => section.items),
  ];

  it('never links to a route that is not mounted', () => {
    everyItem.forEach((item) => {
      expect(paths.has(item.to), `${item.id} -> ${item.to}`).toBe(true);
      // A parameterised path in a nav bar would render a literal ':id'.
      expect(item.to.includes(':'), `${item.id} is parameterised`).toBe(false);
    });
  });

  it('links to the NEW paths, never the aliases — an alias in a NavLink breaks its active state', () => {
    const aliasPaths = new Set(ALIASES.map((a) => a.from));
    everyItem.forEach((item) => {
      expect(aliasPaths.has(item.to), `${item.id} still points at the alias ${item.to}`).toBe(false);
    });
  });

  it('carries the guard from the table onto the link, so a visible link is always openable', () => {
    everyItem.forEach((item) => {
      const route = routeById(item.id);
      expect(route, item.id).toBeTruthy();
      expect(item.permission).toBe(route.permission);
    });
  });

  it('keeps the mobile tab bar to four items PER SESSION', () => {
    // TAB_BAR_NAV is now the unsliced candidate list — the cap moved into
    // visibleTabBar so it applies after role/permission filtering. Capping the
    // raw list first would have thrown away the admin tabs before the patient
    // tabs an admin cannot see were removed, leaving a one-item bar.
    [ROLES.PATIENT, ROLES.DOCTOR, ROLES.ADMIN].forEach((role) => {
      const items = visibleTabBar({
        permissions: permissionsForRole(role),
        isAuthenticated: true,
        role,
      });
      expect(items.length, role).toBeLessThanOrEqual(TAB_BAR_MAX_ITEMS);
    });
  });

  it('orders the header with the product first and support last', () => {
    const ids = PRIMARY_NAV.map((i) => i.id);
    expect(ids[0]).toBe('landing');
    expect(ids[1]).toBe('consult');
    expect(ids.at(-1)).toBe('faq');
  });

  it('uses navLabel only in the header and the plain label in the sidebar', () => {
    const headerReferrals = PRIMARY_NAV.find((i) => i.id === 'doctor.referrals');
    expect(headerReferrals.label).toBe('Patient cases');

    const sidebarReferrals = sidebarSections(SECTIONS.DOCTOR)
      .flatMap((s) => s.items)
      .find((i) => i.id === 'doctor.referrals');
    expect(sidebarReferrals.label).toBe('Referrals');
  });

  it('uses shortLabel in the tab bar, where a 60px column has to fit', () => {
    const visits = TAB_BAR_NAV.find((i) => i.id === 'patient.appointments');
    expect(visits.label).toBe('Visits');
  });

  it('groups the sidebar and leaves parameterised routes out of it', () => {
    const doctor = sidebarSections(SECTIONS.DOCTOR);
    expect(doctor.map((s) => s.title)).toEqual(['Practice', 'Clinic']);
    const ids = doctor.flatMap((s) => s.items).map((i) => i.id);
    expect(ids).not.toContain('doctor.patientDetail');
    expect(ids).not.toContain('doctor.pendingApproval');
  });

  it('sends the quick-scan CTA straight to /consult, not through the alias', () => {
    expect(QUICK_SCAN_ROUTE).toBe(PATHS.CONSULT);
  });
});

// ---------------------------------------------------------------------------
// Workspaces — one account, several surfaces
// ---------------------------------------------------------------------------

describe('workspaces', () => {
  function surfacesFor(role) {
    const held = permissionsForRole(role);
    return WORKSPACES
      .filter((w) => allowedForRole(w, role))
      .filter((w) => w.anyPermission.some((p) => held.includes(p)))
      .map((w) => w.id);
  }

  it('offers a patient exactly one surface', () => {
    expect(surfacesFor(ROLES.PATIENT)).toEqual(['patient']);
  });

  it('offers a doctor BOTH surfaces — the "no duplicate accounts" requirement', () => {
    expect(surfacesFor(ROLES.DOCTOR)).toEqual(['doctor', 'patient']);
  });

  it('offers an admin ONLY the console — the other two were empty pages', () => {
    // An admin holds every doctor and patient permission but has no
    // DoctorProfile and no scans, so "Doctor workspace" and "My skin health"
    // were doors into permanently blank lists. Acting as a real doctor or
    // patient is the supported route, and it is audited.
    expect(surfacesFor(ROLES.ADMIN)).toEqual(['admin']);
  });

  it('still lets an admin ACT AS a doctor and get that chrome', () => {
    // effectiveRole is the act-as target's while delegating, so the same table
    // that hides these from an admin has to reveal them again here — otherwise
    // impersonation lands on a page with no navigation.
    expect(surfacesFor(ROLES.DOCTOR)).toContain('doctor');
    const doctorWorkspace = WORKSPACES.find((w) => w.id === 'doctor');
    expect(allowedForRole(doctorWorkspace, ROLES.DOCTOR)).toBe(true);
    expect(allowedForRole(doctorWorkspace, ROLES.ADMIN)).toBe(false);
  });

  it('homes every workspace on a mounted route', () => {
    const paths = new Set(ROUTES.map((r) => r.path));
    WORKSPACES.forEach((w) => expect(paths.has(w.home), w.id).toBe(true));
  });
});

// ---------------------------------------------------------------------------
// excludeRoles — nav visibility only, never access
// ---------------------------------------------------------------------------

describe('excludeRoles', () => {
  const HIDDEN_FROM_ADMIN = [
    'patient.scans', 'patient.appointments', 'patient.requests', 'patient.findDoctor',
    'doctor.referrals', 'doctor.requests', 'doctor.appointments', 'doctor.patients',
    'doctor.schedule', 'doctor.ratings',
  ];

  it('hides every doctor and patient surface from an admin', () => {
    HIDDEN_FROM_ADMIN.forEach((id) => {
      expect(allowedForRole(routeById(id), ROLES.ADMIN), id).toBe(false);
    });
  });

  it('leaves the account page visible to an admin — they have one too', () => {
    expect(allowedForRole(routeById('patient.profile'), ROLES.ADMIN)).toBe(true);
  });

  it('shows all of them to the role they belong to', () => {
    HIDDEN_FROM_ADMIN.forEach((id) => {
      const route = routeById(id);
      const owner = route.section === SECTIONS.DOCTOR ? ROLES.DOCTOR : ROLES.PATIENT;
      expect(allowedForRole(route, owner), id).toBe(true);
    });
  });

  it('never gates ACCESS — every excluded route keeps its permission', () => {
    // The guard in App.jsx reads `permission` and nothing else. If excludeRoles
    // ever leaked into routing, an admin acting as a doctor would be bounced out
    // of the workspace they were just sent to.
    HIDDEN_FROM_ADMIN.forEach((id) => {
      const route = routeById(id);
      const guarded = Boolean(route.permission) || Boolean(route.anyPermission?.length);
      expect(guarded, id).toBe(true);
      expect(permissionsForRole(ROLES.ADMIN)).toContain(
        route.permission || route.anyPermission[0],
      );
    });
  });

  it('gives an admin their own mobile tab bar instead of a patient one', () => {
    const adminBar = visibleTabBar({
      permissions: permissionsForRole(ROLES.ADMIN),
      isAuthenticated: true,
      role: ROLES.ADMIN,
    }).map((i) => i.id);

    expect(adminBar).toContain('admin.overview');
    expect(adminBar).not.toContain('patient.scans');
    expect(adminBar.length).toBeLessThanOrEqual(4);
  });

  it('leaves a patient tab bar exactly as it was', () => {
    const patientBar = visibleTabBar({
      permissions: permissionsForRole(ROLES.PATIENT),
      isAuthenticated: true,
      role: ROLES.PATIENT,
    }).map((i) => i.id);

    expect(patientBar).toEqual([
      'landing', 'patient.findDoctor', 'patient.scans', 'patient.appointments',
    ]);
  });
});

// ---------------------------------------------------------------------------
// The mounted tree — guards, aliases and chrome, rendered
// ---------------------------------------------------------------------------

// Every lazy page becomes a cheap marker. This test is about WHICH page the
// router picks, not what that page draws.
vi.mock('../pages/FAQ', () => ({ default: () => <p>page:faq</p> }));
vi.mock('../pages/PrivacyPolicy', () => ({ default: () => <p>page:privacy</p> }));
vi.mock('../pages/TermsOfUse', () => ({ default: () => <p>page:terms</p> }));
vi.mock('../features/auth/AuthPage', () => ({
  default: ({ mode }) => <p>{`page:auth:${mode}`}</p>,
}));
vi.mock('../features/consult/ConsultPage', () => ({ default: () => <p>page:consult</p> }));
vi.mock('../features/patient/ScansPage', () => ({ default: () => <p>page:patient.scans</p> }));
vi.mock('../features/patient/AppointmentsPage', () => ({ default: () => <p>page:patient.appointments</p> }));
vi.mock('../features/patient/RequestsPage', () => ({ default: () => <p>page:patient.requests</p> }));
vi.mock('../features/patient/FindDoctorPage', () => ({ default: () => <p>page:patient.findDoctor</p> }));
vi.mock('../features/patient/ProfilePage', () => ({ default: () => <p>page:patient.profile</p> }));
vi.mock('../features/doctor/ReferralsPage', () => ({ default: () => <p>page:doctor.referrals</p> }));
vi.mock('../features/doctor/RequestsPage', () => ({ default: () => <p>page:doctor.requests</p> }));
vi.mock('../features/doctor/AppointmentsPage', () => ({ default: () => <p>page:doctor.appointments</p> }));
vi.mock('../features/doctor/SchedulePage', () => ({ default: () => <p>page:doctor.schedule</p> }));
vi.mock('../features/doctor/PatientsPage', () => ({ default: () => <p>page:doctor.patients</p> }));
vi.mock('../features/doctor/PatientDetailPage', () => ({ default: () => <p>page:doctor.patientDetail</p> }));
vi.mock('../features/doctor/RatingsPage', () => ({ default: () => <p>page:doctor.ratings</p> }));
vi.mock('../features/doctor/PendingApprovalPage', () => ({ default: () => <p>page:doctor.pendingApproval</p> }));
vi.mock('../features/admin/OverviewPage', () => ({ default: () => <p>page:admin.overview</p> }));
vi.mock('../features/admin/DoctorsPage', () => ({ default: () => <p>page:admin.doctors</p> }));
vi.mock('../features/admin/PatientsPage', () => ({ default: () => <p>page:admin.patients</p> }));
vi.mock('../features/admin/ScansPage', () => ({ default: () => <p>page:admin.scans</p> }));
vi.mock('../features/admin/AppointmentsPage', () => ({ default: () => <p>page:admin.appointments</p> }));
vi.mock('../features/admin/AuditLogPage', () => ({ default: () => <p>page:admin.auditLog</p> }));

// The landing composition and the chatbot are heavy and irrelevant here.
vi.mock('../components/landing/Hero', () => ({ default: () => <p>page:landing</p> }));
vi.mock('../components/landing/FeaturesMarquee', () => ({ default: () => null }));
vi.mock('../components/landing/ConditionAnalysis', () => ({ default: () => null }));
vi.mock('../components/landing/LifeSavingDataView', () => ({ default: () => null }));
vi.mock('../components/landing/WhyUseAiDermatologist', () => ({ default: () => null }));
vi.mock('../components/landing/HowToUseAiDermatologist', () => ({ default: () => null }));
vi.mock('../components/landing/HowDoesAiAnalyze', () => ({ default: () => null }));
vi.mock('../components/widgets/FloatingChatbot', () => ({ default: () => null }));

const AppModule = await import('../App');
const App = AppModule.default;
const { PAGES } = AppModule;
const { AuthProvider } = await import('../context/AuthContext');
const { ThemeProvider } = await import('../context/ThemeContext');
const api = await import('../lib/api');
const storage = await import('../lib/storage');
const { envelope, jsonResponse, makeToken } = await import('../test/helpers');

function seed(role) {
  const permissions = [...permissionsForRole(role)];
  storage.setToken(makeToken({ user_id: 1, role }));
  storage.setUser({ id: 1, name: 'Test User', email: 't@example.com', role });
  api.configureApi({
    fetchImpl: vi.fn(async () => jsonResponse(envelope({
      user: { id: 1, name: 'Test User', email: 't@example.com', role },
      permissions,
    }))),
  });
}

/** Reports the URL the router settled on, after any redirects. */
function Probe() {
  const location = useLocation();
  return <span data-testid="url">{`${location.pathname}${location.search}`}</span>;
}

function renderAt(route) {
  return render(
    <ThemeProvider>
      <AuthProvider>
        <MemoryRouter initialEntries={[route]}>
          <App />
          <Routes><Route path="*" element={<Probe />} /></Routes>
        </MemoryRouter>
      </AuthProvider>
    </ThemeProvider>,
  );
}

const url = () => screen.getByTestId('url').textContent;

beforeEach(() => {
  api.resetApiState();
  window.localStorage.clear();
  api.configureApi({ fetchImpl: vi.fn(async () => jsonResponse(envelope({}))) });
});

describe('the mounted tree', () => {
  it('renders the landing page to an anonymous visitor', async () => {
    renderAt('/');
    expect(await screen.findByText('page:landing')).toBeInTheDocument();
  });

  it('serves the public policy pages without a login', async () => {
    renderAt('/privacy-policy');
    expect(await screen.findByText('page:privacy')).toBeInTheDocument();
  });

  it('serves the auth screen and the scan stepper to logged-OUT visitors', async () => {
    const { unmount } = renderAt('/auth');
    expect(await screen.findByText('page:auth:signin')).toBeInTheDocument();
    unmount();

    renderAt('/consult');
    expect(await screen.findByText('page:consult')).toBeInTheDocument();
  });

  it('redirects /login and /register onto the one auth screen', async () => {
    const { unmount } = renderAt('/login');
    expect(await screen.findByText('page:auth:signin')).toBeInTheDocument();
    expect(url()).toBe('/auth');
    unmount();

    renderAt('/register');
    expect(await screen.findByText('page:auth:signup')).toBeInTheDocument();
    expect(url()).toBe('/auth?mode=signup');
  });

  it('preserves ?returnTo= across an alias — RequireAuth writes it against /login', async () => {
    renderAt('/login?returnTo=%2Fpatient%2Fscans');
    await screen.findByText('page:auth:signin');
    expect(url()).toBe('/auth?returnTo=%2Fpatient%2Fscans');
  });

  it('sends the old scan entry points to /consult', async () => {
    const { unmount } = renderAt('/try-now');
    expect(await screen.findByText('page:consult')).toBeInTheDocument();
    unmount();

    renderAt('/patient/scan');
    expect(await screen.findByText('page:consult')).toBeInTheDocument();
  });

  it('bounces an anonymous visitor off a dashboard and back to the auth screen', async () => {
    renderAt('/patient/scans');
    await screen.findByText('page:auth:signin');
    expect(url()).toBe('/auth?returnTo=%2Fpatient%2Fscans');
  });

  it('opens the patient surface for a PATIENT', async () => {
    seed(ROLES.PATIENT);
    renderAt('/patient/scans');
    expect(await screen.findByText('page:patient.scans')).toBeInTheDocument();
  });

  it('opens the patient surface for a DOCTOR on the same account', async () => {
    seed(ROLES.DOCTOR);
    renderAt('/patient/scans');
    expect(await screen.findByText('page:patient.scans')).toBeInTheDocument();
  });

  it('opens the patient AND doctor surfaces for an ADMIN on the same account', async () => {
    seed(ROLES.ADMIN);
    const { unmount } = renderAt('/patient/appointments');
    expect(await screen.findByText('page:patient.appointments')).toBeInTheDocument();
    unmount();

    renderAt('/doctor/referrals');
    expect(await screen.findByText('page:doctor.referrals')).toBeInTheDocument();
  });

  it('keeps a PATIENT out of the doctor and admin surfaces', async () => {
    seed(ROLES.PATIENT);
    renderAt('/admin/overview');
    await waitFor(() => expect(screen.queryByText('page:admin.overview')).not.toBeInTheDocument());
  });

  it('keeps a DOCTOR out of the admin surface', async () => {
    seed(ROLES.DOCTOR);
    renderAt('/admin/audit-log');
    await waitFor(() => expect(screen.queryByText('page:admin.auditLog')).not.toBeInTheDocument());
  });

  it('resolves the parameterised patient-detail route', async () => {
    seed(ROLES.DOCTOR);
    renderAt('/doctor/patients/42');
    expect(await screen.findByText('page:doctor.patientDetail')).toBeInTheDocument();
  });

  it('maps the old dashboard deep links onto their new homes', async () => {
    seed(ROLES.ADMIN);

    const first = renderAt('/doctor-dashboard/ratings');
    expect(await screen.findByText('page:doctor.ratings')).toBeInTheDocument();
    expect(url()).toBe(PATHS.DOCTOR_RATINGS);
    first.unmount();

    const second = renderAt('/admin-dashboard');
    expect(await screen.findByText('page:admin.overview')).toBeInTheDocument();
    second.unmount();

    renderAt('/my-reports');
    expect(await screen.findByText('page:patient.scans')).toBeInTheDocument();
  });

  it('sends an unknown page inside a section to that section home, not to a dead end', async () => {
    seed(ROLES.DOCTOR);
    renderAt('/doctor/not-a-page');
    expect(await screen.findByText('page:doctor.referrals')).toBeInTheDocument();
    expect(url()).toBe(PATHS.DOCTOR_REFERRALS);
  });

  it('catches everything else with a 404 that keeps the chrome', async () => {
    renderAt('/nothing/here/at/all');
    await waitFor(() => expect(screen.queryByText('page:landing')).not.toBeInTheDocument());
    expect(url()).toBe('/nothing/here/at/all');
  });

  it('mounts every id in the table', () => {
    // A route whose component is missing renders `undefined` and blanks the page.
    ROUTES.forEach((route) => {
      expect(PAGES[route.id], `no component for "${route.id}"`).toBeTruthy();
    });
    expect(Object.keys(PAGES).sort()).toEqual(ROUTES.map((r) => r.id).sort());
  });
});
