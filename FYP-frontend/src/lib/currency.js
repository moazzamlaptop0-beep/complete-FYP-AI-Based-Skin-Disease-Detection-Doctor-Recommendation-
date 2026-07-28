/**
 * currency.js — the live PKR/USD rate, for the doctor fee editor.
 *
 * WHY A REAL RATE AND NOT A CONSTANT
 * ----------------------------------
 * Fees are stored in BOTH currencies (`doctor_fees.pkr` and `.usd`) and the
 * backend never converts between them, so whatever the doctor types is what a
 * patient is shown. A hardcoded divisor bakes today's rate into next year's
 * price list; PKR has moved far enough in single years to make that a real
 * mispricing, not a rounding quibble.
 *
 * THE SOURCE
 * ----------
 * open.er-api.com: free, no key, no attribution requirement, and it publishes
 * PKR. (The ECB-backed feeds that Frankfurter and friends wrap do NOT quote
 * PKR at all, which rules them out for this app.) One request per 12 hours per
 * browser, because the published rate itself only updates daily.
 *
 * THE RULES
 * ---------
 * 1. NEVER THROWS. A fee editor must open whether or not a third party is up.
 * 2. NEVER INVENTS A RATE. On failure with nothing cached this returns null and
 *    the caller keeps the field manual. A plausible-looking made-up number is
 *    worse than an honest "we could not check": the doctor would ship it.
 * 3. A stale cached rate is offered, clearly flagged `stale`, rather than
 *    dropped. Yesterday's rate is a fine default; silence is not.
 */

import * as storage from './storage';

/** Base USD so the cached number reads the way people quote it: PKR per 1 USD. */
const ENDPOINT = 'https://open.er-api.com/v6/latest/USD';
const CACHE_KEY = 'fx_pkr_per_usd';
const TTL_MS = 12 * 60 * 60 * 1000;
const TIMEOUT_MS = 8000;

/** Bounds sanity-check. A feed that returns 0, a negative, or a wild number is
 *  a broken feed, and a fee priced off it would be nonsense. */
const MIN_RATE = 50;
const MAX_RATE = 2000;

/** Requests in flight, so a re-render storm cannot fan out into N fetches. */
let inFlight = null;

function isUsableRate(value) {
  const rate = Number(value);
  return Number.isFinite(rate) && rate >= MIN_RATE && rate <= MAX_RATE;
}

function readCache() {
  const saved = storage.get(CACHE_KEY, null);
  if (!saved || typeof saved !== 'object') return null;
  if (!isUsableRate(saved.rate) || !Number.isFinite(saved.at)) return null;
  return { rate: Number(saved.rate), at: Number(saved.at) };
}

function writeCache(entry) {
  storage.set(CACHE_KEY, entry);
}

/**
 * PKR per 1 USD.
 * @param {{force?: boolean, now?: number}} [options]
 * @returns {Promise<{rate:number, at:number, stale:boolean}|null>}
 */
export async function getPkrPerUsd({ force = false, now = Date.now() } = {}) {
  const cached = readCache();
  if (!force && cached && now - cached.at < TTL_MS) {
    return { ...cached, stale: false };
  }

  if (!inFlight) {
    inFlight = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const response = await fetch(ENDPOINT, {
          signal: controller.signal,
          // Nothing here is ours and nothing here is authenticated.
          credentials: 'omit',
        });
        if (!response.ok) return null;
        const data = await response.json();
        if (data?.result !== 'success' || !isUsableRate(data?.rates?.PKR)) return null;

        const entry = {
          rate: Number(data.rates.PKR),
          // The feed's own timestamp when it gives one: "updated" should mean
          // when the RATE changed, not when this browser happened to ask.
          at: Number.isFinite(data.time_last_update_unix)
            ? data.time_last_update_unix * 1000
            : Date.now(),
        };
        writeCache(entry);
        return { ...entry, stale: false };
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
        inFlight = null;
      }
    })();
  }

  const fresh = await inFlight;
  if (fresh) return fresh;
  // The feed is down. Yesterday's number, honestly labelled, beats nothing.
  return cached ? { ...cached, stale: true } : null;
}

/**
 * Convert a PKR fee to USD at `pkrPerUsd`, rounded to cents.
 * @returns {number|null} null when either input is unusable, never NaN.
 */
export function pkrToUsd(pkr, pkrPerUsd) {
  const amount = Number(pkr);
  const rate = Number(pkrPerUsd);
  if (!Number.isFinite(amount) || amount < 0) return null;
  if (!isUsableRate(rate)) return null;
  return Math.round((amount / rate) * 100) / 100;
}

/** "1 USD = 278.50 PKR" */
export function describeRate(rate) {
  const value = Number(rate);
  if (!isUsableRate(value)) return null;
  return `1 USD = ${value.toFixed(2)} PKR`;
}

/** Test seam: drop the cached rate and any in-flight request. */
export function resetRateCache() {
  storage.remove(CACHE_KEY);
  inFlight = null;
}

export default { getPkrPerUsd, pkrToUsd, describeRate, resetRateCache };
