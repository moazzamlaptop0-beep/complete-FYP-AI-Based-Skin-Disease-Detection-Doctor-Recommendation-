/**
 * Layout smoke tests.
 *
 * These components are NOT wired into routing yet, which means `vite build`
 * never reaches them — nothing imports them from main.jsx, so a broken import
 * or a bad hook would sit undetected until the phase that mounts them. These
 * tests are what actually compiles and renders the chrome.
 *
 * They also pin the three behaviours that are easy to regress by hand:
 * keyboard dismissal of the account menu, the impersonation banner, and the
 * fact that a doctor is offered BOTH workspaces.
 */

import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import AppShell from '../AppShell';
import DashboardLayout from '../DashboardLayout';
import ProfileMenu from '../ProfileMenu';
import ViewAsBanner from '../ViewAsBanner';
import WorkspaceSwitcher from '../WorkspaceSwitcher';
import { AuthProvider } from '../../../context/AuthContext';
import { ThemeProvider } from '../../../context/ThemeContext';
import { configureApi, resetApiState } from '../../../lib/api';
import * as storage from '../../../lib/storage';
import { envelope, jsonResponse, makeToken } from '../../../test/helpers';

function seedSession(role, permissions) {
  storage.setToken(makeToken({ user_id: 1, role }));
  storage.setUser({ id: 1, name: 'Dr Ayesha Khan', email: 'ayesha@clinic.pk', role });
  configureApi({
    fetchImpl: vi.fn(async () => jsonResponse(envelope({
      user: { id: 1, name: 'Dr Ayesha Khan', email: 'ayesha@clinic.pk', role },
      permissions,
    }))),
  });
}

const DOCTOR_PERMISSIONS = [
  'scan.create', 'scan.read.own', 'scan.send_report',
  'appointment.book', 'appointment.read.own', 'appointment.manage.own',
  'rating.create', 'rating.read',
  'scan.review.assigned', 'scan.delete.assigned', 'scan.override_severity',
  'appointment.resolve_conflict', 'schedule.manage', 'doctor.profile.manage',
];

function renderWithProviders(ui, { route = '/' } = {}) {
  return render(
    <AuthProvider>
      <ThemeProvider>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </ThemeProvider>
    </AuthProvider>,
  );
}

beforeEach(() => {
  resetApiState();
  window.localStorage.clear();
});

describe('AppShell', () => {
  it('renders the anonymous chrome: skip link, brand, and the Scan CTA', () => {
    configureApi({ fetchImpl: vi.fn(async () => jsonResponse(envelope({}))) });

    renderWithProviders(<AppShell><p>landing content</p></AppShell>);

    expect(screen.getByRole('link', { name: /skip to content/i })).toBeInTheDocument();
    expect(screen.getByText('landing content')).toBeInTheDocument();
    // The primary CTA is available to logged-out visitors on purpose.
    expect(screen.getAllByRole('link', { name: /scan/i }).length).toBeGreaterThan(0);
    // And the skip link has somewhere to land.
    expect(document.getElementById('main-content')).toBeTruthy();
  });

  it('shows account controls once authenticated', async () => {
    seedSession('Doctor', DOCTOR_PERMISSIONS);

    renderWithProviders(<AppShell><p>dashboard</p></AppShell>);

    await waitFor(() => expect(screen.getByText('Dr Ayesha Khan')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /^sign up$/i })).not.toBeInTheDocument();
  });
});

describe('ProfileMenu', () => {
  it('opens, exposes menu semantics, and closes on Escape', async () => {
    seedSession('Doctor', DOCTOR_PERMISSIONS);
    const user = userEvent.setup();

    renderWithProviders(<ProfileMenu />);
    await waitFor(() => expect(screen.getByText('Dr Ayesha Khan')).toBeInTheDocument());

    const trigger = document.querySelector('[aria-haspopup="menu"]');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    await user.click(trigger);
    const menu = await screen.findByRole('menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    // A doctor sees "My scans" because they hold scan.read.own — one account.
    // The label now comes from routes.js, which is sentence-case throughout.
    expect(within(menu).getByText('My scans')).toBeInTheDocument();
    expect(within(menu).getByText('Logout')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('WorkspaceSwitcher', () => {
  it('offers a doctor BOTH surfaces without a second account', async () => {
    seedSession('Doctor', DOCTOR_PERMISSIONS);

    renderWithProviders(<WorkspaceSwitcher variant="inline" />);

    await waitFor(() => expect(screen.getByText('Doctor workspace')).toBeInTheDocument());
    expect(screen.getByText('My skin health')).toBeInTheDocument();
  });

  it('renders nothing for a patient, who has only one surface', async () => {
    seedSession('AI User', ['scan.create', 'scan.read.own', 'appointment.book']);

    const { container } = renderWithProviders(<WorkspaceSwitcher variant="inline" />);

    await waitFor(() => expect(storage.getUser()).not.toBeNull());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('ViewAsBanner', () => {
  it('announces the impersonation and offers an exit', () => {
    configureApi({ fetchImpl: vi.fn(async () => jsonResponse(envelope({}))) });
    const onExit = vi.fn();

    renderWithProviders(
      <ViewAsBanner actingAs={{ userId: 42, name: 'Bilal Ahmed', role: 'AI User' }} onExit={onExit} />,
    );

    const banner = screen.getByRole('status');
    expect(banner).toHaveTextContent('Acting as Bilal Ahmed');
    expect(banner).toHaveTextContent('every action is recorded');
    expect(screen.getByRole('button', { name: /exit/i })).toBeInTheDocument();
  });

  it('renders nothing when nobody is being impersonated', () => {
    configureApi({ fetchImpl: vi.fn(async () => jsonResponse(envelope({}))) });

    const { container } = renderWithProviders(<ViewAsBanner />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('DashboardLayout', () => {
  it('renders the doctor sidebar and keeps mobile navigation present', async () => {
    seedSession('Doctor', DOCTOR_PERMISSIONS);

    renderWithProviders(
      <DashboardLayout title="Referrals"><p>case list</p></DashboardLayout>,
      { route: '/doctor-dashboard/referrals' },
    );

    const sidebar = await screen.findByRole('complementary', { name: /dashboard navigation/i });
    expect(within(sidebar).getByRole('link', { name: 'Referrals' })).toBeInTheDocument();
    expect(within(sidebar).getByRole('link', { name: 'Schedule & fees' })).toBeInTheDocument();

    // The mobile bar exists in the DOM (CSS hides it from md up) — today the
    // doctor dashboard has NO mobile navigation at all.
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Referrals', level: 1 })).toBeInTheDocument();
  });
});
