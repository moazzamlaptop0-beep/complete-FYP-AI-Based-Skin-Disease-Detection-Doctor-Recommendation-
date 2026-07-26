/**
 * jwt.js — expiry and claim reading.
 *
 * The rule under test: "cannot prove it is valid" and "is invalid" are the same
 * answer for a client-side gate. Anything undecodable is expired.
 */

import { describe, expect, it } from 'vitest';

import { decodeToken, getRole, getUserId, isExpired, isValid, millisUntilExpiry } from '../jwt';
import { makeToken } from '../../test/helpers';

describe('isExpired', () => {
  it('is false for a live token', () => {
    expect(isExpired(makeToken({}, 3600))).toBe(false);
  });

  it('is true for a token that already died', () => {
    expect(isExpired(makeToken({}, -10))).toBe(true);
  });

  it('honours the leeway, so a request never leaves with a token that dies in flight', () => {
    const token = makeToken({}, 20);
    expect(isExpired(token)).toBe(false);
    expect(isExpired(token, 30)).toBe(true);
  });

  it('is true for a missing or malformed token', () => {
    expect(isExpired(null)).toBe(true);
    expect(isExpired('')).toBe(true);
    expect(isExpired('not.a.jwt')).toBe(true);
    expect(isExpired('only-one-segment')).toBe(true);
  });
});

describe('claims', () => {
  it('decodes this backend\'s payload shape', () => {
    const token = makeToken({ user_id: 12, role: 'Doctor' });

    expect(decodeToken(token)).toMatchObject({ user_id: 12, role: 'Doctor' });
    expect(getUserId(token)).toBe(12);
    // The role literal is never normalised here — 'Admin' | 'Doctor' | 'AI User'.
    expect(getRole(token)).toBe('Doctor');
  });

  it('returns null rather than throwing for garbage', () => {
    expect(decodeToken('a.b.c')).toBeNull();
    expect(getUserId('a.b.c')).toBeNull();
  });

  it('treats a token with no `exp` as non-expiring — the server still decides', () => {
    const token = makeToken({ exp: undefined });

    expect(decodeToken(token).exp).toBeUndefined();
    expect(isExpired(token)).toBe(false);
    expect(millisUntilExpiry(token)).toBe(Number.POSITIVE_INFINITY);
    expect(isValid(token)).toBe(true);
  });
});
