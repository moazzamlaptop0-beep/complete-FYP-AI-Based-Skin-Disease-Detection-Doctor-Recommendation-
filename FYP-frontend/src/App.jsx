/**
 * App.jsx — THE route table.
 * ============================================================================
 *
 * Every path in the product is declared here, exactly once, and every one of
 * them is derived from `src/routes.js` — the data module that the navbar, the
 * mobile tab bar, the dashboard sidebar and AuthContext's workspace list all
 * read from too. Add a route there, not here.
 *
 * WHAT CHANGED, AND WHY
 * ---------------------
 * 1. CHROME IS A LAYOUT ROUTE, NOT A STRING TEST.
 *    The old file decided whether to show the navbar with
 *    `noLayoutPages.some(p => pathname.startsWith(p))`. That is why `/logins`
 *    would have lost its chrome, why every new dashboard path had to be added
 *    to an array in a second place, and why `/nearby-doctors` rendered with no
 *    navigation at all. A page's chrome is now decided by which layout route it
 *    sits in, which cannot drift.
 *
 * 2. GUARDS ARE PERMISSIONS, NOT ROLE STRINGS.
 *    `<ProtectedRoute allowedRole="AI User">` blocked an ADMIN from a patient
 *    page and a DOCTOR from their own scan history — which is precisely what
 *    drove users to register a second account. RequireAuth evaluates
 *    `permissions[]`, and because ROLE_PERMISSIONS is a set union
 *    (PATIENT ⊂ DOCTOR ⊂ ADMIN), a doctor opening /patient/scans just works.
 *
 * 3. NOTHING THAT EVER RESOLVED 404s.
 *    Every pre-refactor URL is a permanent alias (see ALIASES in routes.js).
 *    They preserve the query string, so `/login?returnTo=%2Fpatient%2Fscans` —
 *    which is what RequireAuth itself writes — still returns the user to where
 *    they were going.
 *
 * 4. THE HEAVY ROUTES ARE LAZY.
 *    The dashboards, the scan stepper, the auth screen and the Leaflet map are
 *    all React.lazy, so the landing page no longer ships them.
 *
 * PAGES THAT DO NOT EXIST YET
 * ---------------------------
 * Each one is a real file at the path below rendering `ComingSoon`. The next
 * steps replace those file CONTENTS. The route table is final: building a page
 * must never require an edit here.
 */

import React, { Suspense, lazy, useEffect } from 'react';
import {
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useParams,
  useSearchParams,
} from 'react-router-dom';

import {
  ALIASES,
  SECTIONS,
  SECTION_GUARDS,
  SECTION_META,
  resolveAlias,
  routesInSection,
} from './routes';

import RequireAuth from './components/auth/RequireAuth';
import AppShell from './components/layout/AppShell';
import DashboardLayout from './components/layout/DashboardLayout';
import Footer from './components/layout/Footer';
import ViewAsBanner from './components/layout/ViewAsBanner';
import Spinner from './components/ui/Spinner';
import { ToastProvider } from './components/ui/Toast';
import FloatingChatbot from './components/widgets/FloatingChatbot';

// -- the landing page, kept exactly as composed before -----------------------
// Static, not lazy: this is the first paint for every new visitor, and putting
// a network round-trip in front of the hero would cost more than the bytes save.
import Hero from './components/landing/Hero';
import FeaturesMarquee from './components/landing/FeaturesMarquee';
import ConditionAnalysis from './components/landing/ConditionAnalysis';
import LifeSavingDataView from './components/landing/LifeSavingDataView';
import WhyUseAiDermatologist from './components/landing/WhyUseAiDermatologist';
import HowToUseAiDermatologist from './components/landing/HowToUseAiDermatologist';
import HowDoesAiAnalyze from './components/landing/HowDoesAiAnalyze';

import NotFound from './pages/NotFound';

// ---------------------------------------------------------------------------
// Lazy pages — id (routes.js) -> component
// ---------------------------------------------------------------------------

const FAQ = lazy(() => import('./pages/FAQ'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfUse = lazy(() => import('./pages/TermsOfUse'));

const AuthPage = lazy(() => import('./features/auth/AuthPage'));
const ConsultPage = lazy(() => import('./features/consult/ConsultPage'));

const PatientOverview = lazy(() => import('./features/patient/OverviewPage'));
const PatientScans = lazy(() => import('./features/patient/ScansPage'));
const PatientAppointments = lazy(() => import('./features/patient/AppointmentsPage'));
const PatientRequests = lazy(() => import('./features/patient/RequestsPage'));
const PatientFindDoctor = lazy(() => import('./features/patient/FindDoctorPage'));
const PatientProfile = lazy(() => import('./features/patient/ProfilePage'));

const DoctorOverview = lazy(() => import('./features/doctor/OverviewPage'));
const DoctorReferrals = lazy(() => import('./features/doctor/ReferralsPage'));
const DoctorRequests = lazy(() => import('./features/doctor/RequestsPage'));
const DoctorAppointments = lazy(() => import('./features/doctor/AppointmentsPage'));
const DoctorSchedule = lazy(() => import('./features/doctor/SchedulePage'));
const DoctorPatients = lazy(() => import('./features/doctor/PatientsPage'));
const DoctorPatientDetail = lazy(() => import('./features/doctor/PatientDetailPage'));
const DoctorRatings = lazy(() => import('./features/doctor/RatingsPage'));
const DoctorPendingApproval = lazy(() => import('./features/doctor/PendingApprovalPage'));

const AdminOverview = lazy(() => import('./features/admin/OverviewPage'));
const AdminDoctors = lazy(() => import('./features/admin/DoctorsPage'));
const AdminPatients = lazy(() => import('./features/admin/PatientsPage'));
const AdminScans = lazy(() => import('./features/admin/ScansPage'));
const AdminAppointments = lazy(() => import('./features/admin/AppointmentsPage'));
const AdminAuditLog = lazy(() => import('./features/admin/AuditLogPage'));
const AdminSettings = lazy(() => import('./features/admin/SettingsPage'));

/** The landing page composition — unchanged from before the refactor. */
function Landing() {
  return (
    <>
      <Hero />
      <FeaturesMarquee />
      <ConditionAnalysis />
      <LifeSavingDataView />
      <WhyUseAiDermatologist />
      <HowToUseAiDermatologist />
      <HowDoesAiAnalyze />
    </>
  );
}

/**
 * `/auth` is one component in two moods. `?mode=signup` only changes the
 * headline — the flow is email-first either way, so someone who already has an
 * account and lands on the "sign up" copy is still routed to their password
 * step instead of being pushed into a second account.
 */
function AuthRoute() {
  const [params] = useSearchParams();
  return <AuthPage mode={params.get('mode') === 'signup' ? 'signup' : 'signin'} />;
}

/** routes.js id -> element. Every id in ROUTES must appear here. */
const PAGES = Object.freeze({
  landing: <Landing />,
  faq: <FAQ />,
  privacy: <PrivacyPolicy />,
  terms: <TermsOfUse />,

  auth: <AuthRoute />,
  consult: <ConsultPage />,

  'patient.overview': <PatientOverview />,
  'patient.scans': <PatientScans />,
  'patient.appointments': <PatientAppointments />,
  'patient.requests': <PatientRequests />,
  'patient.findDoctor': <PatientFindDoctor />,
  'patient.profile': <PatientProfile />,

  'doctor.overview': <DoctorOverview />,
  'doctor.referrals': <DoctorReferrals />,
  'doctor.requests': <DoctorRequests />,
  'doctor.appointments': <DoctorAppointments />,
  'doctor.schedule': <DoctorSchedule />,
  'doctor.patients': <DoctorPatients />,
  'doctor.patientDetail': <DoctorPatientDetail />,
  'doctor.ratings': <DoctorRatings />,
  'doctor.pendingApproval': <DoctorPendingApproval />,

  'admin.overview': <AdminOverview />,
  'admin.doctors': <AdminDoctors />,
  'admin.patients': <AdminPatients />,
  'admin.scans': <AdminScans />,
  'admin.appointments': <AdminAppointments />,
  'admin.auditLog': <AdminAuditLog />,
  'admin.settings': <AdminSettings />,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Scroll to the top on navigation. Skipped when the browser restores a scroll
 *  position itself (back/forward), which it does for POP navigations. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** The Suspense fallback for a lazily-loaded page. Deliberately quiet: it shows
 *  for a few hundred ms and must not look like an error state. */
function PageLoading() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center">
      <Spinner size="lg" label="Loading…" className="text-primary-700" />
    </div>
  );
}

/** Merge alias-supplied params into the incoming query string without
 *  clobbering it — `?returnTo=` must survive the hop. */
function mergeSearch(search, extra) {
  const params = new URLSearchParams(search || '');
  Object.entries(extra || {}).forEach(([key, value]) => {
    if (!params.has(key)) params.set(key, String(value));
  });
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * A permanent alias. Preserves the query string and hash, and deep-maps the
 * splat where the new table has an equivalent route
 * (`/doctor-dashboard/ratings` -> `/doctor/ratings`).
 */
function AliasRedirect({ alias }) {
  const location = useLocation();
  const params = useParams();
  const pathname = resolveAlias(alias, params['*']);

  return (
    <Navigate
      replace
      to={{ pathname, search: mergeSearch(location.search, alias.search), hash: location.hash }}
    />
  );
}

/** A 404 inside a dashboard section: the chrome stays, so the user is not
 *  dumped on a bare page with no way back into their workspace. */
function SectionNotFound({ section }) {
  const meta = SECTION_META[section];
  return <Navigate to={meta?.home || '/'} replace />;
}

// ---------------------------------------------------------------------------
// Layouts
// ---------------------------------------------------------------------------

/** Public pages: full app chrome, full-bleed content (the landing sections and
 *  the policy pages own their own backgrounds and gutters). */
function PublicLayout() {
  return (
    <AppShell width="full" padded={false} footer={<Footer />}>
      <Suspense fallback={<PageLoading />}>
        <Outlet />
      </Suspense>
    </AppShell>
  );
}

/**
 * Focused pages: no navbar, no footer, no tab bar, full width. The auth screen
 * and the scan stepper both want the whole viewport and are both used by
 * LOGGED-OUT visitors, so this layout carries no guard.
 *
 * ViewAsBanner still renders — an admin acting as someone else must never lose
 * sight of it, least of all while running a scan as that person.
 */
function FocusedLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-default">
      <ViewAsBanner />
      <main id="main-content" tabIndex={-1} className="flex-1 outline-none">
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

/** A guarded dashboard section: sidebar at lg, icon rail at md, mobile tab bar
 *  below that. The section guard is the LOOSEST permission in the section; each
 *  leaf route below still carries its own. */
function WorkspaceLayout({ section }) {
  const meta = SECTION_META[section];
  return (
    <RequireAuth anyPermission={[...SECTION_GUARDS[section]]}>
      <DashboardLayout workspace={meta.workspace}>
        <Suspense fallback={<PageLoading />}>
          <Outlet />
        </Suspense>
      </DashboardLayout>
    </RequireAuth>
  );
}

/** Turn the routes.js rows for a section into guarded <Route> elements. */
function sectionRoutes(section) {
  return routesInSection(section).map((route) => (
    <Route
      key={route.id}
      path={route.path}
      element={(
        <RequireAuth
          permission={route.permission}
          anyPermission={route.anyPermission ? [...route.anyPermission] : undefined}
        >
          {PAGES[route.id]}
        </RequireAuth>
      )}
    />
  ));
}

/** Public/focused rows need no guard. */
function openRoutes(section) {
  return routesInSection(section).map((route) => (
    <Route key={route.id} path={route.path} element={PAGES[route.id]} />
  ));
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

export default function App() {
  return (
    <>
      <ScrollToTop />

      <Routes>
        {/* ------------------------------------------------ permanent aliases --
            Declared first for readability only: React Router ranks by
            specificity, so a real route always beats an alias splat. */}
        {ALIASES.map((alias) => (
          <Route key={alias.from} path={alias.from} element={<AliasRedirect alias={alias} />} />
        ))}

        {/* ---------------------------------------------------------- focused --
            /auth and /consult. No chrome, no guard. */}
        <Route element={<FocusedLayout />}>
          {openRoutes(SECTIONS.FOCUSED)}
        </Route>

        {/* ---------------------------------------------------------- patient --
            Guarded by PERMISSION, which is what lets a Doctor or an Admin open
            their own patient surface on their own single account. */}
        <Route element={<WorkspaceLayout section={SECTIONS.PATIENT} />}>
          {sectionRoutes(SECTIONS.PATIENT)}
          <Route path="/patient/*" element={<SectionNotFound section={SECTIONS.PATIENT} />} />
        </Route>

        {/* ----------------------------------------------------------- doctor -- */}
        <Route element={<WorkspaceLayout section={SECTIONS.DOCTOR} />}>
          {sectionRoutes(SECTIONS.DOCTOR)}
          <Route path="/doctor/*" element={<SectionNotFound section={SECTIONS.DOCTOR} />} />
        </Route>

        {/* ------------------------------------------------------------ admin -- */}
        <Route element={<WorkspaceLayout section={SECTIONS.ADMIN} />}>
          {sectionRoutes(SECTIONS.ADMIN)}
          <Route path="/admin/*" element={<SectionNotFound section={SECTIONS.ADMIN} />} />
        </Route>

        {/* ----------------------------------------------------------- public --
            Last, because it owns the global catch-all. */}
        <Route element={<PublicLayout />}>
          {openRoutes(SECTIONS.PUBLIC)}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>

      {/* Global, on every surface — unchanged. */}
      <FloatingChatbot />

      {/* ------------------------------------------------------------ toasts --
          The single mount point for the whole app. Without it react-hot-toast
          has no <Toaster> host, so every `notify.success(...)` / `notify.error(...)`
          call across the admin, doctor and patient features resolved, queued a
          toast and rendered nothing at all — silent success and, worse, silent
          failure. It lives OUTSIDE <Routes> so a navigation cannot unmount it
          mid-toast, and after FloatingChatbot so its z-toast container is last
          in DOM order as well as highest in the z stack. */}
      <ToastProvider />
    </>
  );
}

export { PAGES, Landing };
