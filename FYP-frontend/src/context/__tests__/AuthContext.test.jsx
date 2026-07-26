/**
 * AuthContext — login, logout, rehydrate, and the backend-down path.
 *
 * The last one is the important one: a dead Flask must leave the public landing
 * page usable, so `status` has to leave 'loading' on EVERY path.
 */

import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider, useAuth } from '../AuthContext';
import { configureApi, resetApiState } from '../../lib/api';
import * as storage from '../../lib/storage';
import { envelope, jsonResponse, makeToken, textResponse } from '../../test/helpers';

function mockFetch(handler) {
  const spy = vi.fn(handler);
  configureApi({ fetchImpl: spy });
  return spy;
}

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="status">{auth.status}</span>
      <span data-testid="name">{auth.user?.name ?? ''}</span>
      <span data-testid="verification">{auth.user?.verification_status ?? ''}</span>
      <span data-testid="degraded">{String(auth.degraded)}</span>
      <span data-testid="permissions">{auth.permissions.join(',')}</span>
      <span data-testid="workspaces">{auth.workspaces.map((w) => w.id).join(',')}</span>
      <span data-testid="effective-role">{auth.effectiveRole ?? ''}</span>
      <button type="button" onClick={() => auth.login({ email: 'a@b.c', password: 'x', role: 'Doctor' })}>
        log in
      </button>
      <button type="button" onClick={() => auth.logout()}>log out</button>
    </div>
  );
}

const renderAuth = () => render(<AuthProvider><Probe /></AuthProvider>);

beforeEach(() => {
  resetApiState();
  window.localStorage.clear();
});

describe('mount', () => {
  it('answers "anon" immediately when there is no session — no network wait', () => {
    const spy = mockFetch(async () => jsonResponse(envelope({})));
    renderAuth();

    expect(screen.getByTestId('status')).toHaveTextContent('anon');
    // An anonymous visitor must not block the landing page on a request.
    expect(spy).not.toHaveBeenCalled();
  });

  it('rehydrates from /auth/me, so an admin-approved doctor sees it without re-login', async () => {
    // What /login left behind yesterday, when the doctor was still pending.
    storage.setToken(makeToken({ user_id: 5, role: 'Doctor' }));
    storage.setUser({ id: 5, name: 'Dr Ayesha', email: 'a@b.c', role: 'Doctor', verification_status: 'pending' });

    mockFetch(async (url) => {
      if (url.includes('/auth/me')) {
        return jsonResponse(envelope({
          user: { id: 5, name: 'Dr Ayesha', email: 'a@b.c', role: 'Doctor', verification_status: 'approved' },
          permissions: ['scan.read.own', 'scan.review.assigned', 'schedule.manage'],
        }));
      }
      return jsonResponse(envelope({}));
    });

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authed'));
    expect(screen.getByTestId('verification')).toHaveTextContent('approved');
    // And the legacy `user` key is updated too, because eight untouched pages read it.
    expect(storage.getUser().verification_status).toBe('approved');
    // A doctor gets BOTH surfaces — the whole point of the permission union.
    expect(screen.getByTestId('workspaces')).toHaveTextContent('doctor,patient');
  });

  it('gives an admin ONE workspace even when the server still sends three', async () => {
    // `workspaces_for` in auth_service.py is a role→tuple map, so an older
    // backend (or a future edit to it) can hand back the doctor and patient
    // surfaces an admin has no data for. The client owns which surfaces it
    // renders; the server's list may only ever narrow it.
    storage.setToken(makeToken({ user_id: 1, role: 'Admin' }));
    storage.setUser({ id: 1, name: 'Ops Admin', email: 'ops@x.c', role: 'Admin' });

    mockFetch(async (url) => {
      if (url.includes('/auth/me')) {
        return jsonResponse(envelope({
          user: { id: 1, name: 'Ops Admin', email: 'ops@x.c', role: 'Admin' },
          permissions: ['admin.stats', 'scan.read.own', 'scan.review.assigned', 'schedule.manage'],
          workspaces: [
            { key: 'admin', label: 'Admin Console', route: '/admin-dashboard' },
            { key: 'doctor', label: 'Doctor Dashboard', route: '/doctor-dashboard' },
            { key: 'patient', label: 'My Scans', route: '/my-reports' },
          ],
        }));
      }
      return jsonResponse(envelope({}));
    });

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authed'));
    expect(screen.getByTestId('workspaces')).toHaveTextContent('admin');
    expect(screen.getByTestId('workspaces')).not.toHaveTextContent('doctor');
    // Capability is untouched — only the destination list narrowed.
    expect(screen.getByTestId('permissions')).toHaveTextContent('schedule.manage');
  });

  it('reports the ACT-AS target as the effective role, so the chrome follows', async () => {
    // Nav visibility filters on effectiveRole. Without this, an admin acting as
    // a doctor would be sent to /doctor/referrals with every doctor link hidden.
    storage.setToken(makeToken({ user_id: 1, role: 'Admin' }));
    storage.setUser({ id: 1, name: 'Ops Admin', email: 'ops@x.c', role: 'Admin' });
    storage.setActingAs({ userId: 7, name: 'Dr Ayesha', role: 'Doctor' });

    mockFetch(async () => jsonResponse(envelope({
      user: { id: 1, name: 'Ops Admin', email: 'ops@x.c', role: 'Admin' },
      permissions: ['admin.stats', 'scan.review.assigned'],
    })));

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authed'));
    expect(screen.getByTestId('effective-role')).toHaveTextContent('Doctor');
  });

  it('degrades to the cached session when the backend is down — never an infinite spinner', async () => {
    storage.setToken(makeToken({ user_id: 5, role: 'Doctor' }));
    storage.setUser({ id: 5, name: 'Dr Ayesha', email: 'a@b.c', role: 'Doctor' });

    mockFetch(async () => { throw new TypeError('Failed to fetch'); });

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('status')).not.toHaveTextContent('loading'));
    expect(screen.getByTestId('status')).toHaveTextContent('authed');
    expect(screen.getByTestId('degraded')).toHaveTextContent('true');
    expect(screen.getByTestId('name')).toHaveTextContent('Dr Ayesha');
  });

  it('degrades the same way when /auth/me is not deployed yet (HTML 404)', async () => {
    storage.setToken(makeToken({ user_id: 5, role: 'Doctor' }));
    storage.setUser({ id: 5, name: 'Dr Ayesha', email: 'a@b.c', role: 'Doctor' });

    mockFetch(async () => textResponse('<!doctype html><title>404 Not Found</title>', 404));

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authed'));
    expect(screen.getByTestId('degraded')).toHaveTextContent('true');
  });

  it('drops the session when /auth/me says 401', async () => {
    storage.setToken(makeToken({ user_id: 5, role: 'Doctor' }));
    storage.setUser({ id: 5, name: 'Dr Ayesha', email: 'a@b.c', role: 'Doctor' });

    mockFetch(async () => jsonResponse({ success: false, error: 'Invalid Token!' }, 401));

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anon'));
    expect(storage.getToken()).toBeNull();
    expect(storage.getUser()).toBeNull();
  });
});

describe('login / logout', () => {
  it('login stores the LEGACY keys in the old format and authenticates', async () => {
    const token = makeToken({ user_id: 9, role: 'Doctor' });
    mockFetch(async (url) => {
      if (url.includes('/login')) {
        return jsonResponse(envelope({
          token,
          user: { id: 9, name: 'Dr Sara', email: 'a@b.c', role: 'Doctor', joined_at: 'Jan 2024', verification_status: 'approved' },
        }));
      }
      // /auth/me is not deployed yet in this scenario.
      return textResponse('<!doctype html><title>404</title>', 404);
    });

    renderAuth();
    await userEvent.click(screen.getByRole('button', { name: 'log in' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authed'));
    expect(window.localStorage.getItem('token')).toBe(token);
    expect(JSON.parse(window.localStorage.getItem('user'))).toMatchObject({
      id: 9,
      role: 'Doctor',
      joined_at: 'Jan 2024',
    });
    expect(screen.getByTestId('permissions')).toHaveTextContent('scan.review.assigned');
  });

  it('logout is the ONE implementation: revoke, clear everything, back to anon', async () => {
    storage.setToken(makeToken({ user_id: 5, role: 'AI User' }));
    storage.setUser({ id: 5, name: 'Bilal', email: 'b@c.d', role: 'AI User' });
    storage.set('theme', 'dark');
    window.sessionStorage.setItem('lastScanResult', '{"id":1}');

    const spy = mockFetch(async (url) => {
      if (url.includes('/auth/me')) return jsonResponse(envelope({ user: { id: 5, name: 'Bilal', email: 'b@c.d', role: 'AI User' } }));
      return jsonResponse(envelope(undefined, 'Logged out'));
    });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authed'));

    await userEvent.click(screen.getByRole('button', { name: 'log out' }));

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anon'));
    expect(storage.getToken()).toBeNull();
    expect(storage.getUser()).toBeNull();
    expect(storage.get('theme', null)).toBeNull();
    // The sessionStorage scan cache the old Navbar cleared by hand.
    expect(window.sessionStorage.getItem('lastScanResult')).toBeNull();
    expect(spy.mock.calls.some(([url]) => url.includes('/auth/logout'))).toBe(true);
  });

  it('logs out locally even when the revoke call fails', async () => {
    storage.setToken(makeToken({ user_id: 5, role: 'AI User' }));
    storage.setUser({ id: 5, name: 'Bilal', email: 'b@c.d', role: 'AI User' });

    mockFetch(async (url) => {
      if (url.includes('/auth/me')) return jsonResponse(envelope({ user: { id: 5, name: 'Bilal', email: 'b@c.d', role: 'AI User' } }));
      throw new TypeError('Failed to fetch');
    });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authed'));

    await userEvent.click(screen.getByRole('button', { name: 'log out' }));

    // A network failure must never trap someone inside a logged-in shell.
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anon'));
    expect(storage.getToken()).toBeNull();
  });
});

describe('cross-tab sync', () => {
  it('goes anonymous when another tab clears the token', async () => {
    storage.setToken(makeToken({ user_id: 5, role: 'AI User' }));
    storage.setUser({ id: 5, name: 'Bilal', email: 'b@c.d', role: 'AI User' });

    mockFetch(async () => jsonResponse(envelope({ user: { id: 5, name: 'Bilal', email: 'b@c.d', role: 'AI User' } })));

    renderAuth();
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authed'));

    // What the browser does in THIS tab when another tab logs out.
    // Wrapped in act(): the listener sets state outside React's event system.
    await act(async () => {
      storage.clearSession();
      window.dispatchEvent(new StorageEvent('storage', { key: 'token', newValue: null }));
    });

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anon'));
  });
});
