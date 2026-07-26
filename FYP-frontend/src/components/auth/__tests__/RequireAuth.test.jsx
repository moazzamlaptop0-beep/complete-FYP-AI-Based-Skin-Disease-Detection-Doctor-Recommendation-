/**
 * RequireAuth — the hierarchy test.
 *
 * The headline case: an ADMIN opening a DOCTOR-gated route is ALLOWED, because
 * access is evaluated from rank/permissions rather than `user.role === 'Doctor'`.
 * ProtectedRoute.jsx bounces that admin to /admin-dashboard today.
 */

import React from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import RequireAuth from '../RequireAuth';
import { AuthProvider } from '../../../context/AuthContext';
import { configureApi, resetApiState } from '../../../lib/api';
import * as storage from '../../../lib/storage';
import { envelope, jsonResponse, makeToken } from '../../../test/helpers';

function LoginStub() {
  const location = useLocation();
  return <div data-testid="login">login{location.search}</div>;
}

function renderGuarded(guardProps, { initialEntry = '/secure' } = {}) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route
            path="/secure"
            element={(
              <RequireAuth {...guardProps}>
                <div data-testid="secure">clinical content</div>
              </RequireAuth>
            )}
          />
          <Route path="/login" element={<LoginStub />} />
          <Route path="/admin-dashboard" element={<div data-testid="admin-home">admin home</div>} />
          <Route path="/my-reports" element={<div data-testid="patient-home">patient home</div>} />
          <Route path="/" element={<div data-testid="home">home</div>} />
        </Routes>
      </MemoryRouter>
    </AuthProvider>,
  );
}

/** Seed a live session and answer /auth/me with the given permissions. */
function seedSession(role, permissions) {
  storage.setToken(makeToken({ user_id: 1, role }));
  storage.setUser({ id: 1, name: 'Test User', email: 't@e.st', role });
  configureApi({
    fetchImpl: vi.fn(async () => jsonResponse(envelope({
      user: { id: 1, name: 'Test User', email: 't@e.st', role },
      permissions,
    }))),
  });
}

beforeEach(() => {
  resetApiState();
  window.localStorage.clear();
});

describe('anonymous', () => {
  it('redirects to the auth route and carries returnTo', async () => {
    configureApi({ fetchImpl: vi.fn(async () => jsonResponse(envelope({}))) });

    renderGuarded({ roles: 'AI User' });

    await waitFor(() => expect(screen.getByTestId('login')).toBeInTheDocument());
    expect(screen.getByTestId('login')).toHaveTextContent('returnTo=%2Fsecure');
    expect(screen.queryByTestId('secure')).not.toBeInTheDocument();
  });

  it('treats an EXPIRED token as anonymous instead of mounting the page', async () => {
    storage.setToken(makeToken({ user_id: 1, role: 'Admin' }, -60));
    storage.setUser({ id: 1, name: 'Test User', email: 't@e.st', role: 'Admin' });
    // The expired token triggers a refresh attempt first; deny it.
    configureApi({
      fetchImpl: vi.fn(async () => jsonResponse({ success: false, error: 'Session expired!' }, 401)),
    });

    renderGuarded({ roles: 'Admin' });

    await waitFor(() => expect(screen.getByTestId('login')).toBeInTheDocument());
  });
});

describe('hierarchy', () => {
  it('lets an ADMIN through a DOCTOR-gated route (ProtectedRoute would bounce them)', async () => {
    seedSession('Admin', [
      'scan.read.own', 'scan.read.any', 'scan.review.assigned', 'scan.review.any',
      'admin.stats', 'actor.act_as',
    ]);

    renderGuarded({ roles: 'Doctor' });

    await waitFor(() => expect(screen.getByTestId('secure')).toBeInTheDocument());
  });

  it('lets a DOCTOR through a patient-permission route — one account, both surfaces', async () => {
    seedSession('Doctor', ['scan.read.own', 'scan.create', 'scan.review.assigned', 'schedule.manage']);

    renderGuarded({ permission: 'scan.read.own' });

    await waitFor(() => expect(screen.getByTestId('secure')).toBeInTheDocument());
  });

  it('blocks a PATIENT from a doctor-permission route and sends them somewhere usable', async () => {
    seedSession('AI User', ['scan.create', 'scan.read.own', 'appointment.book']);

    renderGuarded({ permission: 'scan.review.assigned' });

    await waitFor(() => expect(screen.getByTestId('patient-home')).toBeInTheDocument());
    expect(screen.queryByTestId('secure')).not.toBeInTheDocument();
  });

  it('honours minLevel as a rank comparison', async () => {
    seedSession('Doctor', ['scan.read.own', 'scan.review.assigned']);

    renderGuarded({ minLevel: 'Admin' });

    // A doctor does not outrank an admin.
    await waitFor(() => expect(screen.queryByTestId('secure')).not.toBeInTheDocument());
  });
});
