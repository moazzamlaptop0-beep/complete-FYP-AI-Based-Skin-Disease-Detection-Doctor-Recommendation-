/**
 * api.js — envelope handling, both envelope-breakers, and the single-flight 401.
 *
 * These are the tests that stop a silent shape regression from reaching a
 * doctor's screen: the two breakers are frozen backend behaviour, and the
 * refresh stampede is the failure mode that logs users out at random.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  configureApi,
  request,
  requestDetailed,
  resetApiState,
} from '../api';
import { scans, schedule } from '../endpoints';
import * as storage from '../storage';
import { envelope, errorEnvelope, jsonResponse, textResponse } from '../../test/helpers';

/** Install a fake transport and hand back the spy. */
function mockFetch(handler) {
  const spy = vi.fn(handler);
  configureApi({ fetchImpl: spy });
  return spy;
}

beforeEach(() => {
  resetApiState();
  window.localStorage.clear();
});

describe('envelope unwrapping', () => {
  it('returns `data` from a standard success envelope', async () => {
    mockFetch(async () => jsonResponse(envelope({ id: 7, name: 'Ayesha' })));

    await expect(request('/api/doctors')).resolves.toEqual({ id: 7, name: 'Ayesha' });
  });

  it('keeps empty `data` payloads — `[]` and `{}` are real answers, not "missing"', async () => {
    mockFetch(async () => jsonResponse(envelope([])));

    await expect(request('/api/doctors')).resolves.toEqual([]);
  });

  it('returns the whole envelope when the route only sends a message', async () => {
    // /register, /verify-otp-email and friends have no `data` key at all.
    mockFetch(async () => jsonResponse(envelope(undefined, 'OTP sent to email'), 201));

    const result = await request('/register');
    expect(result).toEqual({ success: true, message: 'OTP sent to email' });

    const detailed = await requestDetailed('/register');
    expect(detailed.message).toBe('OTP sent to email');
  });

  it('throws a typed ApiError carrying the server error text', async () => {
    mockFetch(async () => jsonResponse(errorEnvelope('Invalid credentials'), 401));

    // skipAuthRefresh: a bad password must not trigger a refresh attempt.
    const error = await request('/login', { skipAuthRefresh: true }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.message).toBe('Invalid credentials');
    expect(error.isUnauthorized).toBe(true);
  });

  it('survives a non-JSON body — Flask returns raw HTML for 500 and 413', async () => {
    mockFetch(async () => textResponse('<!doctype html><html><title>500 Internal Server Error</title>', 500));

    const error = await request('/predict').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(500);
    // Never render markup at the user.
    expect(error.message).not.toContain('<');
    expect(error.bodyText).toContain('<!doctype');
  });

  it('reports a dead backend as a network ApiError rather than throwing TypeError', async () => {
    mockFetch(async () => { throw new TypeError('Failed to fetch'); });

    const error = await request('/api/doctors').catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(0);
    expect(error.isNetworkError).toBe(true);
  });
});

describe('envelope-breakers', () => {
  it('/api/slots/<id> returns the BARE ARRAY, not `.data`', async () => {
    mockFetch(async () => jsonResponse(['09:00', '09:30', '10:00']));

    const slots = await request(schedule.slots(3, '2026-08-03'));
    expect(Array.isArray(slots)).toBe(true);
    expect(slots).toEqual(['09:00', '09:30', '10:00']);
  });

  it('/api/slots/multi is NOT a bare-array route — its envelope is unwrapped', async () => {
    // The additive sibling shares the `/api/slots/` prefix but returns the
    // standard envelope. Matching it as a bare-array route made the defensive
    // branch hand back `[]`, i.e. "no doctor has any free time", on a 200.
    mockFetch(async () => jsonResponse({
      success: true,
      data: {
        date: '2026-08-03',
        by_doctor: { 7: [{ time: '09:00', status: 'available', duration: '30min' }] },
        doctor_ids: [7],
        max_doctors: 10,
      },
    }));

    const payload = await request(schedule.slotsMulti([7], '2026-08-03'));
    expect(Array.isArray(payload)).toBe(false);
    expect(payload.by_doctor['7'][0].time).toBe('09:00');
  });

  it('/doctor/update_scan/<id> returns the FLAT dict, not the decorative empty `data:{}`', async () => {
    mockFetch(async () => jsonResponse({
      success: true,
      message: 'Scan updated',
      data: {}, // decorative and empty — unwrapping this loses the scan
      id: 41,
      doctor_comment: 'Looks benign, review in 6 months.',
      invite_to_clinic: true,
      review_status: 'reviewed',
    }));

    const scan = await request(scans.update(41), { method: 'PUT', body: { comment: 'x' } });
    expect(scan.id).toBe(41);
    expect(scan.doctor_comment).toBe('Looks benign, review in 6 months.');
    expect(scan.invite_to_clinic).toBe(true);
    expect(scan).not.toEqual({});
  });

  it('still throws on an error from an envelope-breaking route', async () => {
    mockFetch(async () => jsonResponse(errorEnvelope('Date is required'), 400));

    const error = await request(schedule.slots(3, '')).catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(400);
    expect(error.message).toBe('Date is required');
  });
});

describe('request headers', () => {
  it('injects the Bearer token and the impersonation header', async () => {
    storage.setToken('token-abc');
    storage.setActingAs({ userId: 42, name: 'Demo Patient' });

    const spy = mockFetch(async () => jsonResponse(envelope({ ok: true })));
    await request('/api/doctors');

    const [, init] = spy.mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer token-abc');
    expect(init.headers['X-Act-As-User-Id']).toBe('42');
  });

  it('never sets Content-Type on FormData — the browser owns the boundary', async () => {
    const spy = mockFetch(async () => jsonResponse(envelope({ ok: true })));
    const form = new FormData();
    form.append('user_id', '3');

    await request('/predict', { method: 'POST', body: form });

    const [, init] = spy.mock.calls[0];
    expect(init.headers['Content-Type']).toBeUndefined();
    expect(init.body).toBe(form);
  });
});

describe('single-flight 401 refresh', () => {
  it('shares ONE refresh across concurrent 401s and retries both requests', async () => {
    const seen = new Set();
    let refreshCalls = 0;

    mockFetch(async (url) => {
      if (url.includes('/auth/refresh')) {
        refreshCalls += 1;
        return jsonResponse(envelope({ token: 'fresh-token' }));
      }
      if (!seen.has(url)) {
        seen.add(url);
        return jsonResponse(errorEnvelope('Session expired! Please login again.'), 401);
      }
      return jsonResponse(envelope({ url }));
    });

    const [a, b] = await Promise.all([
      request('/patient/scans/1'),
      request('/api/patient-appointments/1'),
    ]);

    // Two 401s, ONE refresh. Six parallel dashboard requests must not become
    // six refreshes racing to invalidate each other's token.
    expect(refreshCalls).toBe(1);
    expect(a.url).toContain('/patient/scans/1');
    expect(b.url).toContain('/api/patient-appointments/1');
    expect(storage.getToken()).toBe('fresh-token');
  });

  it('logs out exactly once when the refresh itself fails', async () => {
    const onUnauthorized = vi.fn();
    configureApi({ onUnauthorized });

    mockFetch(async (url) => {
      if (url.includes('/auth/refresh')) {
        return jsonResponse(errorEnvelope('Refresh token revoked'), 401);
      }
      return jsonResponse(errorEnvelope('Token is missing! Unauthorized access.'), 401);
    });

    const results = await Promise.allSettled([
      request('/patient/scans/1'),
      request('/api/patient-appointments/1'),
    ]);

    expect(results.every((r) => r.status === 'rejected')).toBe(true);
    expect(results[0].reason).toBeInstanceOf(ApiError);
    expect(results[0].reason.status).toBe(401);
    // Coalesced: two failures, one logout, one toast.
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not attempt a refresh when the caller opts out', async () => {
    let refreshCalls = 0;
    mockFetch(async (url) => {
      if (url.includes('/auth/refresh')) {
        refreshCalls += 1;
        return jsonResponse(envelope({ token: 'x' }));
      }
      return jsonResponse(errorEnvelope('Invalid credentials'), 401);
    });

    await expect(request('/login', { skipAuthRefresh: true })).rejects.toBeInstanceOf(ApiError);
    expect(refreshCalls).toBe(0);
  });
});
