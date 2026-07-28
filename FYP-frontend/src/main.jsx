/**
 * main.jsx — the composition root.
 * ============================================================================
 *
 * This file does four things and nothing else: it mounts React, it installs the
 * router, it installs the three providers in dependency order, and it catches
 * anything that escapes the tree. Routing itself lives in App.jsx; the route
 * table as data lives in routes.js.
 *
 * PROVIDER ORDER IS NOT ARBITRARY
 * -------------------------------
 *   BrowserRouter        outermost, so any provider that later needs
 *                        useNavigate/useLocation can take it without a
 *                        restructure. (None do today.)
 *     ThemeProvider      no dependencies; writes `class="dark"` onto <html>
 *                        before first paint so there is no light-mode flash.
 *       AuthProvider     needs nothing above it, but everything below reads it.
 *         RealtimeProvider  calls useOptionalAuth() to decide which SSE stream
 *                        to open, and opens none while status !== 'authed'.
 *                        It MUST sit inside AuthProvider or it would silently
 *                        never connect.
 *           App
 *
 * WHY THERE IS AN ERROR BOUNDARY HERE
 * -----------------------------------
 * App.jsx lazy-loads every dashboard, the auth screen and the scan stepper. A
 * lazy import that fails — which in production means a returning user whose tab
 * has been open across a deploy and whose hashed chunk no longer exists —
 * throws during render, and React unmounts the WHOLE tree. Without a boundary
 * that is a white screen with a console error nobody sees. With one it is a
 * "Reload" button, and the reload fetches the new index.html.
 *
 * The boundary deliberately imports nothing: no UI primitives, no context, no
 * i18n. It is the last thing standing when something else has already broken,
 * so it may not depend on anything that could be what broke.
 */

import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import './index.css';
import './i18n.js';

import App from './App.jsx';
import { AuthProvider } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { RealtimeProvider } from './context/RealtimeContext';

/**
 * A stale-deploy chunk failure, as opposed to a genuine bug in our code. The
 * two want different copy: one is fixed by reloading, the other is not.
 */
function isChunkLoadError(error) {
  const text = `${error?.name || ''} ${error?.message || ''}`;
  return /ChunkLoadError|Loading chunk|dynamically imported module|module script failed|Importing a module/i
    .test(text);
}

class RootErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
    this.handleReload = () => window.location.reload();
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept as a console error on purpose: there is no error-reporting service
    // in this project, and swallowing it would make the failure unreproducible.
    console.error('[AI Dermatologist] Unhandled render error:', error, info?.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    const stale = isChunkLoadError(error);

    return (
      <div
        role="alert"
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
          background: '#f8fafc',
          color: '#0f172a',
        }}
      >
        <div style={{ maxWidth: '32rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '1.375rem', fontWeight: 600, marginBottom: '0.75rem' }}>
            {stale ? 'A new version is available' : 'Something went wrong'}
          </h1>
          <p style={{ lineHeight: 1.6, marginBottom: '1.5rem', color: '#475569' }}>
            {stale
              ? 'The app was updated while this tab was open. Reloading will pick up the new version.'
              : 'The page could not be displayed. Reloading usually clears it. Your scans and reports are safe.'}
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              padding: '0.625rem 1.25rem',
              borderRadius: '0.625rem',
              border: 'none',
              background: '#0f766e',
              color: '#ffffff',
              fontSize: '0.9375rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload the page
          </button>
        </div>
      </div>
    );
  }
}

/**
 * Honours Vite's `base` so a sub-path deploy (`/app/`) routes correctly.
 * BASE_URL is '/' by default, which react-router treats as no basename.
 */
const basename = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '') || '/';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <RootErrorBoundary>
      <BrowserRouter basename={basename}>
        <ThemeProvider>
          <AuthProvider>
            <RealtimeProvider>
              <App />
            </RealtimeProvider>
          </AuthProvider>
        </ThemeProvider>
      </BrowserRouter>
    </RootErrorBoundary>
  </StrictMode>,
);
