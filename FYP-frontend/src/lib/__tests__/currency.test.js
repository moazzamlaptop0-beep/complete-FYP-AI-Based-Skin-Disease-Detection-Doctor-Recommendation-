import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { describeRate, getPkrPerUsd, pkrToUsd, resetRateCache } from '../currency';

const OK = {
  result: 'success',
  base_code: 'USD',
  rates: { PKR: 278.5, EUR: 0.92 },
  time_last_update_unix: 1_769_000_000,
};

const jsonOnce = (payload, ok = true) => ({ ok, json: async () => payload });

beforeEach(() => {
  window.localStorage.clear();
  resetRateCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pkrToUsd', () => {
  it('converts and rounds to cents', () => {
    expect(pkrToUsd(2000, 278.5)).toBe(7.18);
    expect(pkrToUsd(0, 278.5)).toBe(0);
  });

  it('treats an emptied field as zero, which is what saving it stores', () => {
    // The form posts `Number(form.pkr) || 0`, so a blank PKR box IS a zero fee.
    // Reporting null here instead would strand a stale USD figure beside it.
    expect(pkrToUsd('', 278.5)).toBe(0);
  });

  it('returns null rather than NaN for anything unusable', () => {
    expect(pkrToUsd('abc', 278.5)).toBe(null);
    expect(pkrToUsd(-5, 278.5)).toBe(null);
    expect(pkrToUsd(2000, null)).toBe(null);
    expect(pkrToUsd(2000, 0)).toBe(null);
  });

  it('rejects a rate outside sane bounds, because a fee priced off it is nonsense', () => {
    expect(pkrToUsd(2000, 3)).toBe(null);
    expect(pkrToUsd(2000, 99_999)).toBe(null);
  });

  it('accepts a numeric string, which is what an <input> hands over', () => {
    expect(pkrToUsd('2000', 278.5)).toBe(7.18);
  });
});

describe('describeRate', () => {
  it('quotes the rate the way people say it', () => {
    expect(describeRate(278.5)).toBe('1 USD = 278.50 PKR');
  });
  it('says nothing for an unusable rate', () => {
    expect(describeRate(null)).toBe(null);
    expect(describeRate(0)).toBe(null);
  });
});

describe('getPkrPerUsd', () => {
  it('reads the live rate and stamps it with the feed time, not ours', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonOnce(OK)));

    const found = await getPkrPerUsd();
    expect(found).toEqual({ rate: 278.5, at: 1_769_000_000_000, stale: false });
  });

  it('serves the cache inside the TTL without a second request', async () => {
    const fetchMock = vi.fn(async () => jsonOnce(OK));
    vi.stubGlobal('fetch', fetchMock);

    await getPkrPerUsd({ now: 1_000 });
    const again = await getPkrPerUsd({ now: 2_000 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(again.rate).toBe(278.5);
    expect(again.stale).toBe(false);
  });

  it('refetches once the cache is older than the TTL', async () => {
    const fetchMock = vi.fn(async () => jsonOnce(OK));
    vi.stubGlobal('fetch', fetchMock);

    await getPkrPerUsd();
    await getPkrPerUsd({ now: Date.now() + 13 * 60 * 60 * 1000 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls back to the cached rate, flagged stale, when the feed is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonOnce(OK)));
    await getPkrPerUsd();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const found = await getPkrPerUsd({ force: true });

    expect(found).toEqual({ rate: 278.5, at: 1_769_000_000_000, stale: true });
  });

  it('returns null rather than inventing a rate when there is nothing cached', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await getPkrPerUsd()).toBe(null);
  });

  it('rejects a malformed or out-of-range payload instead of trusting it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonOnce({ result: 'error' })));
    expect(await getPkrPerUsd()).toBe(null);

    resetRateCache();
    vi.stubGlobal('fetch', vi.fn(async () => jsonOnce({ result: 'success', rates: {} })));
    expect(await getPkrPerUsd()).toBe(null);

    resetRateCache();
    vi.stubGlobal('fetch', vi.fn(async () => jsonOnce({ result: 'success', rates: { PKR: 0 } })));
    expect(await getPkrPerUsd()).toBe(null);

    resetRateCache();
    vi.stubGlobal('fetch', vi.fn(async () => jsonOnce({ result: 'success', rates: { PKR: 9e9 } })));
    expect(await getPkrPerUsd()).toBe(null);
  });

  it('treats a non-200 as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonOnce(OK, false)));
    expect(await getPkrPerUsd()).toBe(null);
  });

  it('coalesces concurrent callers into one request', async () => {
    const fetchMock = vi.fn(async () => jsonOnce(OK));
    vi.stubGlobal('fetch', fetchMock);

    const [a, b, c] = await Promise.all([getPkrPerUsd(), getPkrPerUsd(), getPkrPerUsd()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.rate).toBe(278.5);
    expect(b.rate).toBe(278.5);
    expect(c.rate).toBe(278.5);
  });
});
