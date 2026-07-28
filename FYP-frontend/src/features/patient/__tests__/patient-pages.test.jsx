/**
 * Patient surface smoke tests.
 *
 * `vite build` proves every import resolves; it proves nothing about whether a
 * page RENDERS. A wrong prop name on a primitive, a hook called after an early
 * return, or a payload shape the page cannot survive all compile perfectly and
 * then throw on mount. These tests mount all five pages against stubbed
 * responses in the exact shapes docs/api-contract.md documents.
 *
 * They also pin the two decisions that are most likely to be "tidied" into bugs
 * later:
 *   - the directory is browsable with NO scan (the page it replaces hard
 *     redirects to /try-now without one);
 *   - the profile page is EDITABLE for every role, including a patient avatar
 *     upload. This assertion is the reverse of what it used to be: the page once
 *     had to explain that no endpoint stored a patient profile picture and that
 *     there was no patient update route at all, so it rendered a read-only record
 *     rather than inputs that discarded what was typed into them. `/api/profile`
 *     and `/api/profile/avatar` exist now, so the honest confession would itself
 *     be the lie.
 */

import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PatientScansPage from '../ScansPage';
import PatientAppointmentsPage from '../AppointmentsPage';
import PatientRequestsPage from '../RequestsPage';
import FindDoctorPage from '../FindDoctorPage';
import PatientProfilePage from '../ProfilePage';
import { AuthProvider } from '../../../context/AuthContext';
import { configureApi, resetApiState } from '../../../lib/api';
import * as storage from '../../../lib/storage';
import { envelope, jsonResponse, makeToken } from '../../../test/helpers';

const PATIENT_PERMISSIONS = [
  'scan.create', 'scan.read.own', 'scan.send_report',
  'appointment.book', 'appointment.read.own', 'appointment.manage.own',
  'rating.create', 'rating.read',
];

const USER = { id: 7, name: 'Sana Iqbal', email: 'sana@example.com', role: 'AI User' };

/** One scan row in the exact 18-key shape + the four ADDITIVE privacy keys. */
const SCAN = {
  id: 31, scan_id: 31, patient_id: 7,
  disease: 'Eczema', confidence: 0.87,
  status: 'Reviewed', review_status: 'Reviewed',
  doctor_comment: 'Keep it moisturised and come back in two weeks.',
  invite_to_clinic: false, severity: 'ROUTINE',
  doctor_id: 2, doctor_name: 'Dr Ayesha Khan', doctor_email: 'ayesha@clinic.pk',
  image_url: '/static/uploads/scan_x.jpg',
  created_at: '2026-07-01T10:00:00', updated_at: '2026-07-02T09:00:00',
  patient_rating: null, patient_review: null,
  is_sensitive: false, image_deleted_at: null, has_image: true,
  image_endpoint: '/api/scans/31/image',
};

/** One appointment in the 22-key shape — note date/time are emitted TWICE. */
const APPOINTMENT = {
  id: 12, doctor_id: 2, doctor_name: 'Dr Ayesha Khan',
  doctor_profile: { specialty: 'Dermatology', profile_image: '/static/uploads/doc_2.jpg' },
  date: '2030-01-05', time: '10:00', slot_date: '2030-01-05', slot_time: '10:00',
  disease: 'Eczema', duration: '30min', fees: { pkr: 2000.0, usd: 10.0 },
  status: 'Scheduled', cancellation_reason: null,
  scan_id: 31, scan_info: null,
  rating: null, review: null, patient_rating: null, patient_review: null,
  is_conflict: false, conflict_with_id: null, suggested_slots: null,
};

const REQUEST = {
  request_id: 4, patient_id: 7, patient_name: 'Sana Iqbal',
  scan_id: 31,
  scan: { id: 31, disease: 'Eczema', confidence: 0.87, severity: 'URGENT', is_sensitive: false, image_shared: false, image_url: null },
  status: 'Open', priority: 1, express: false,
  patient_note: 'It has spread since last week.',
  severity_level: 'URGENT', triage_score: 42, triage_reasons: ['Spreading rapidly'],
  consent_share_scan: false, matched_doctor_id: null, matched_appointment_id: null,
  expires_at: '2030-01-02T10:00:00', created_at: '2026-07-01T10:00:00',
  doctors: [
    { doctor_id: 2, doctor_name: 'Dr Ayesha Khan', specialty: 'Dermatology', profile_image: null, preference_rank: 1, response: 'Pending', decline_reason: null, responded_at: null },
    { doctor_id: 3, doctor_name: 'Dr Bilal Aziz', specialty: 'Dermatology', profile_image: null, preference_rank: 2, response: 'Declined', decline_reason: 'Fully booked', responded_at: '2026-07-01T12:00:00' },
  ],
  slots: [
    { slot_id: 9, doctor_id: null, slot_date: '2030-01-05', slot_time: '10:00', slot_start: '2030-01-05T10:00:00', rank: 1 },
  ],
  pending_doctor_count: 1, my_response: null, my_preference_rank: null,
};

const DOCTOR = {
  id: 2, name: 'Dr Ayesha Khan', email: 'ayesha@clinic.pk',
  specialty: 'Dermatology', specialization: 'Dermatology',
  hospital: 'Shifa Clinic', city: 'Lahore', latitude: null, longitude: null, phone: null,
  rating: 4.5, average_rating: 4.5, total_reviews: 12,
  fees: { pkr: 2000.0, usd: 10.0, duration: '30min', buffer_time: 0 },
  schedule: [{ day: 'Wednesday', start: '09:00', end: '17:00', available: true }],
  experience: 8, profile_image: '/static/uploads/doc_2.jpg',
  photo_endpoint: '/api/doctors/2/photo', verification_status: 'approved',
};

/** GET /api/profile for the patient in session — the self-account contract. */
const PROFILE = {
  id: 7, name: 'Sana Iqbal', email: 'sana@example.com', role: 'AI User',
  phone: '03001234567', city: 'Lahore', date_of_birth: '1996-04-11', gender: 'Female',
  avatar_url: null, avatar_endpoint: null,
  is_verified: true, created_at: '2026-01-05T09:00:00',
  pending_email: null, doctor: null,
};

/** Route the stub by path, so one mock serves every page. */
function routeFetch(url) {
  const path = String(url).replace(/^https?:\/\/[^/]+/, '');
  if (path.startsWith('/auth/me')) {
    return jsonResponse(envelope({ user: USER, permissions: PATIENT_PERMISSIONS }));
  }
  if (path.startsWith('/api/profile')) return jsonResponse(envelope(PROFILE));
  if (path.startsWith('/patient/scans/')) return jsonResponse(envelope([SCAN]));
  if (path.startsWith('/api/patient-appointments/')) return jsonResponse(envelope([APPOINTMENT]));
  if (path.startsWith('/api/appointment-requests')) {
    return jsonResponse(envelope({ items: [REQUEST], page: 1, limit: 10, total: 1, pages: 1 }));
  }
  if (path.startsWith('/api/doctors/public')) return jsonResponse(envelope([DOCTOR]));
  if (path.startsWith('/doctor/ratings/')) {
    return jsonResponse(envelope({ average_rating: 4.5, rating_count: 1, reviews: [] }));
  }
  return jsonResponse(envelope([]));
}

function renderPage(ui, { route = '/' } = {}) {
  return render(
    <AuthProvider>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </AuthProvider>,
  );
}

beforeEach(() => {
  resetApiState();
  storage.clearSession();
  storage.setToken(makeToken({ user_id: 7, role: 'AI User' }));
  storage.setUser(USER);
  configureApi({ fetchImpl: vi.fn(async (url) => routeFetch(url)) });
  // SensitiveImage reads raw bytes with the global fetch (the api client parses
  // every body as text/JSON and cannot hand back a Blob), so it needs its own
  // stand-in or jsdom attempts a real request to localhost:5000.
  globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, headers: { get: () => null } }));
});

describe('patient surface', () => {
  it('lists scans with their prediction, severity and doctor', async () => {
    renderPage(<PatientScansPage />);
    // getAllBy*: DataTable renders BOTH the table row and the mobile card and
    // hides one with CSS, so every cell legitimately appears twice.
    expect((await screen.findAllByText('Eczema')).length).toBeGreaterThan(0);
    expect(screen.getByText('Dr Ayesha Khan')).toBeInTheDocument();
    expect(screen.getAllByText(/87%/).length).toBeGreaterThan(0);
  });

  it('shows an upcoming appointment with the actions a patient could not reach before', async () => {
    renderPage(<PatientAppointmentsPage />);
    expect(await screen.findByText('Dr Ayesha Khan')).toBeInTheDocument();
    // Cancel and Reschedule are the two the backend had no patient route for.
    expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reschedule/i })).toBeInTheDocument();
  });

  it('shows each invited doctor’s response and the ranked slots on a request', async () => {
    renderPage(<PatientRequestsPage />);
    expect(await screen.findByText(/Doctors you invited/)).toBeInTheDocument();
    expect(screen.getByText('Declined')).toBeInTheDocument();
    expect(screen.getByText('Fully booked', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/Times you offered/)).toBeInTheDocument();
    // Open requests can be withdrawn — the only patient-side control on them.
    expect(screen.getByRole('button', { name: /withdraw request/i })).toBeInTheDocument();
  });

  it('browses the doctor directory without a scan in session', async () => {
    // No scan is seeded anywhere: the page this replaces would have redirected.
    renderPage(<FindDoctorPage />);
    expect(await screen.findByText('Dr Ayesha Khan')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /book with this doctor/i })).toBeInTheDocument();
  });

  it('lets a patient edit their own account, photo included', async () => {
    const { container } = renderPage(<PatientProfilePage />);
    await waitFor(() => expect(screen.getAllByText('Sana Iqbal').length).toBeGreaterThan(0));

    // A real avatar upload: POST /api/profile/avatar stores one for every role.
    const fileInput = container.querySelector('input[type="file"]');
    expect(fileInput).not.toBeNull();
    expect(fileInput.getAttribute('accept')).toContain('image/png');

    // Every editable section renders, seeded from GET /api/profile.
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Sana Iqbal');
    expect(screen.getByLabelText(/^phone$/i)).toHaveValue('03001234567');
    expect(screen.getByLabelText(/date of birth/i)).toHaveValue('1996-04-11');
    expect(screen.getByLabelText(/^gender$/i)).toHaveValue('Female');
    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /change my email address/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /change password/i })).toBeInTheDocument();

    // A patient has no clinic profile, so that section stays away.
    expect(screen.queryByText(/clinic profile/i)).toBeNull();

    // The two paragraphs this page used to print are no longer true.
    expect(screen.queryByText(/no endpoint on this platform that stores a patient profile picture/i))
      .toBeNull();
    expect(screen.queryByText(/exposes no patient profile update route/i)).toBeNull();
  });

  it('shows a doctor the clinic section, sourced from the profile payload', async () => {
    const doctorProfile = {
      ...PROFILE,
      id: 2, name: 'Dr Ayesha Khan', email: 'ayesha@clinic.pk', role: 'Doctor',
      doctor: {
        specialty: 'Dermatology', hospital: 'Shifa Clinic', city: 'Lahore',
        phone: '04211234567', experience: 8, license: 'PMC-1234',
        latitude: 31.5204, longitude: 74.3587, state: 'Punjab', country: 'Pakistan',
        profile_image: '/static/uploads/doc_2.jpg',
        verification_status: 'approved', verification_note: null, fees_pkr: 2000,
      },
    };
    configureApi({
      fetchImpl: vi.fn(async (url) => {
        const path = String(url).replace(/^https?:\/\/[^/]+/, '');
        if (path.startsWith('/api/profile')) return jsonResponse(envelope(doctorProfile));
        return routeFetch(url);
      }),
    });

    renderPage(<PatientProfilePage />);
    expect(await screen.findByText('Clinic profile')).toBeInTheDocument();
    expect(screen.getByLabelText(/specialty/i)).toHaveValue('Dermatology');
    expect(screen.getByLabelText(/licence number/i)).toHaveValue('PMC-1234');
    // The map pin is editable at last, through the shared combobox: a doctor who
    // moved clinic could not correct latitude/longitude anywhere before.
    expect(screen.getByRole('combobox', { name: /clinic location/i })).toBeInTheDocument();
    expect(screen.getByText(/Pinned at 31\.5204, 74\.3587/)).toBeInTheDocument();
    // The email field is gone from the clinic form on purpose: the address now
    // belongs to the OTP flow, and that route used to change it unverified.
    expect(screen.getByRole('button', { name: /save clinic profile/i })).toBeInTheDocument();
  });

  it('surfaces a half-finished email change instead of hiding it', async () => {
    configureApi({
      fetchImpl: vi.fn(async (url) => {
        const path = String(url).replace(/^https?:\/\/[^/]+/, '');
        if (path.startsWith('/api/profile')) {
          return jsonResponse(envelope({ ...PROFILE, pending_email: 'sana.new@example.com' }));
        }
        return routeFetch(url);
      }),
    });

    renderPage(<PatientProfilePage />);
    expect(await screen.findByText(/A change is waiting for a code/)).toBeInTheDocument();
    expect(screen.getByText('sana.new@example.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enter the code/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancel the change/i })).toBeInTheDocument();
    // The address only swaps once the code is entered, so the old one still
    // stands: once in the identity card, once in the email section.
    expect(screen.getAllByText('sana@example.com').length).toBeGreaterThan(0);
  });
});
