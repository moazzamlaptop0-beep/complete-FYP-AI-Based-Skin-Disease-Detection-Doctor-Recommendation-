/**
 * A render smoke test for the whole screen: every import resolves, the first
 * state paints, and the email -> password transition works end to end through
 * the real `lib/api` client (only `fetch` is stubbed).
 */

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiState } from '../../../lib/api';
import { AuthProvider } from '../../../context/AuthContext';
import { envelope, jsonResponse } from '../../../test/helpers';

import AuthPage from '../AuthPage';
import { resolveReturnTo } from '../returnTo';
import { clearFlowSnapshot } from '../useAuthMachine';

function renderPage(initialEntries = ['/login']) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AuthProvider>
        <AuthPage />
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetApiState();
  clearFlowSnapshot();
});

describe('resolveReturnTo', () => {
  it('accepts a same-origin absolute path', () => {
    expect(resolveReturnTo({ search: '?returnTo=%2Fdoctor-dashboard%2Fratings' }))
      .toBe('/doctor-dashboard/ratings');
  });

  it('refuses an off-site or protocol-relative destination', () => {
    expect(resolveReturnTo({ search: '?returnTo=https%3A%2F%2Fevil.example' })).toBeNull();
    expect(resolveReturnTo({ search: '?returnTo=%2F%2Fevil.example' })).toBeNull();
  });

  it('refuses to bounce back to the auth route itself', () => {
    expect(resolveReturnTo({ search: '?returnTo=%2Flogin' })).toBeNull();
  });

  it('reads the router state RequireAuth sets', () => {
    expect(resolveReturnTo({ state: { returnTo: '/my-reports' } })).toBe('/my-reports');
  });
});

describe('<AuthPage />', () => {
  it('renders the email step with a guest escape hatch', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: /sign in or create an account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toHaveAttribute('autocomplete', 'email');
    expect(screen.getByRole('link', { name: /continue as guest/i })).toHaveAttribute('href', '/try-now');
    // No role selector anywhere. That is the entire point of this screen.
    expect(screen.queryByText(/^AI User$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('shows an inline field error for a malformed address, without a request', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/email address/i), 'nope');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/email address/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('moves to the password step for a known address', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      jsonResponse(envelope({ status: 'existing', next: 'password' })),
    );
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByLabelText(/email address/i), 'demo.doctor@aiderma.local');
    await user.click(screen.getByRole('button', { name: /continue/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    });
    expect(screen.getByLabelText(/^password/i)).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByText('demo.doctor@aiderma.local')).toBeInTheDocument();
    // Back + "Change" are both present: no dead ends.
    expect(screen.getByRole('button', { name: /^back$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /change email address/i })).toBeInTheDocument();
  });
});
