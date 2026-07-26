/**
 * storage.js — the corrupt-value contract.
 *
 * ProtectedRoute.jsx:7 does a bare `JSON.parse(localStorage.getItem('user'))`
 * inside render today: one truncated value white-screens the entire app. These
 * tests pin the fix.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import * as storage from '../storage';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('corrupt values never throw', () => {
  it('returns null for a half-written `user` and self-heals the key', () => {
    window.localStorage.setItem('user', '{"name":"Ayesha", "rol');

    expect(() => storage.getUser()).not.toThrow();
    expect(storage.getUser()).toBeNull();
    // The poison is removed, so the next read is clean rather than permanently broken.
    expect(window.localStorage.getItem('user')).toBeNull();
  });

  it('returns the fallback for a corrupt namespaced value', () => {
    window.localStorage.setItem('aiderma:acting_as', 'not json at all');

    expect(storage.get('acting_as', 'fallback')).toBe('fallback');
    expect(storage.getActingAs()).toBeNull();
  });

  it('rejects a non-object `user` (an array or a bare string is not a session)', () => {
    storage.setRawJSON('user', ['not', 'a', 'user']);
    expect(storage.getUser()).toBeNull();
  });

  it('treats the literal strings "undefined" / "null" as no token', () => {
    window.localStorage.setItem('token', 'undefined');
    expect(storage.getToken()).toBeNull();

    window.localStorage.setItem('token', 'null');
    expect(storage.getToken()).toBeNull();
  });
});

describe('legacy compatibility', () => {
  it('writes `token` and `user` in the exact format the untouched pages read', () => {
    storage.setToken('jwt-value');
    storage.setUser({ id: 1, name: 'Ayesha', role: 'Doctor' });

    // Bare keys, not namespaced — the eight legacy pages read these directly.
    expect(window.localStorage.getItem('token')).toBe('jwt-value');
    expect(JSON.parse(window.localStorage.getItem('user')).role).toBe('Doctor');
  });

  it('clearSession removes the legacy keys AND the namespace, but nothing else', () => {
    storage.setToken('jwt-value');
    storage.setUser({ id: 1 });
    storage.set('theme', 'dark');
    window.localStorage.setItem('unrelated-tool', 'keep me');

    storage.clearSession();

    expect(storage.getToken()).toBeNull();
    expect(storage.getUser()).toBeNull();
    expect(storage.get('theme', null)).toBeNull();
    expect(window.localStorage.getItem('unrelated-tool')).toBe('keep me');
  });
});
