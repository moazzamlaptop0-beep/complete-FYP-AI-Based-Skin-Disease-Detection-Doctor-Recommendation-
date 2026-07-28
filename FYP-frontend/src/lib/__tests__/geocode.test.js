/**
 * geocode.js — the normaliser and the never-throws contract.
 *
 * The city fallback chain is the part worth pinning hardest. Nominatim files a
 * settlement under `city`, `town`, `village` or `county` depending purely on how
 * big it is, so reading `address.city` alone silently loses most small towns,
 * which for a Pakistan-first product is most of the country.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ATTRIBUTION,
  MIN_QUERY_LENGTH,
  SEARCH_DEBOUNCE_MS,
  clearGeocodeCache,
  formatPlaceLabel,
  lookupPlaces,
  lookupReverse,
  normalisePlace,
  normalisePlaces,
  reverseGeocode,
  searchPlaces,
} from '../geocode';
import { jsonResponse } from '../../test/helpers';

/** A real `/search?format=jsonv2&addressdetails=1` hit, trimmed to what we read. */
const ISLAMABAD = Object.freeze({
  place_id: 298711635,
  osm_type: 'relation',
  osm_id: 421553,
  lat: '33.6001033',
  lon: '73.0442278',
  category: 'boundary',
  type: 'administrative',
  name: 'Islamabad',
  display_name: 'Islamabad, Islamabad Capital Territory, 44000, Pakistan',
  address: {
    city: 'Islamabad',
    state: 'Islamabad Capital Territory',
    'ISO3166-2-lvl4': 'PK-IS',
    postcode: '44000',
    country: 'Pakistan',
    country_code: 'pk',
  },
});

const LAHORE = Object.freeze({
  place_id: 259240712,
  osm_type: 'relation',
  osm_id: 8798466,
  lat: '31.5656822',
  lon: '74.3141829',
  display_name: 'Lahore, Punjab, Pakistan',
  address: { city: 'Lahore', state: 'Punjab', country: 'Pakistan', country_code: 'pk' },
});

/** A `fetch` stand-in whose body is not JSON at all (a Cloudflare error page). */
const htmlResponse = () => ({
  ok: true,
  status: 200,
  text: async () => '<html><body>429 Too Many Requests</body></html>',
});

beforeEach(() => {
  clearGeocodeCache();
  globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse([]));
});

describe('normalisePlace', () => {
  it('produces exactly the frozen shape, and nothing else', () => {
    const place = normalisePlace(ISLAMABAD);

    expect(place).toEqual({
      id: '298711635',
      label: 'Islamabad, Islamabad Capital Territory, 44000, Pakistan',
      city: 'Islamabad',
      state: 'Islamabad Capital Territory',
      country: 'Pakistan',
      latitude: 33.6001033,
      longitude: 73.0442278,
    });
    // No stray Nominatim keys ride along into the form payload.
    expect(Object.keys(place).sort()).toEqual([
      'city', 'country', 'id', 'label', 'latitude', 'longitude', 'state',
    ]);
    // lat/lon arrive as STRINGS and must come back out as numbers, because the
    // map and the "nearby doctors" ranking both do arithmetic on them.
    expect(typeof place.latitude).toBe('number');
    expect(typeof place.longitude).toBe('number');
  });

  it.each([
    ['city wins outright', { city: 'Lahore', town: 'T', village: 'V', county: 'C' }, 'Lahore'],
    ['falls back to town', { town: 'Murree', village: 'V', county: 'C' }, 'Murree'],
    ['falls back to village', { village: 'Bhurban', county: 'C' }, 'Bhurban'],
    ['falls back to county', { county: 'Rawalpindi District' }, 'Rawalpindi District'],
    ['skips an empty city', { city: '', town: 'Murree' }, 'Murree'],
    ['skips a whitespace-only city', { city: '   ', town: 'Murree' }, 'Murree'],
    ['ends up blank when nothing names a settlement', { country: 'Pakistan' }, ''],
  ])('city fallback chain: %s', (_label, address, expected) => {
    const place = normalisePlace({ ...ISLAMABAD, address });
    expect(place.city).toBe(expected);
  });

  it.each([
    ['state wins', { state: 'Punjab', region: 'R' }, 'Punjab'],
    ['falls back to region', { region: 'Azad Kashmir' }, 'Azad Kashmir'],
    ['blank when neither is present', { city: 'Lahore' }, ''],
  ])('state fallback chain: %s', (_label, address, expected) => {
    expect(normalisePlace({ ...ISLAMABAD, address }).state).toBe(expected);
  });

  it('reads the country, and tolerates a hit with no address block at all', () => {
    expect(normalisePlace({ ...ISLAMABAD, address: undefined })).toEqual({
      id: '298711635',
      label: 'Islamabad, Islamabad Capital Territory, 44000, Pakistan',
      city: '',
      state: '',
      country: '',
      latitude: 33.6001033,
      longitude: 73.0442278,
    });
  });

  it('trims whitespace out of every text field', () => {
    const place = normalisePlace({
      ...ISLAMABAD,
      display_name: '  Islamabad, Pakistan  ',
      address: { city: ' Islamabad ', state: ' ICT ', country: ' Pakistan ' },
    });
    expect(place).toMatchObject({
      label: 'Islamabad, Pakistan',
      city: 'Islamabad',
      state: 'ICT',
      country: 'Pakistan',
    });
  });

  it('builds a label from the address parts when display_name is missing', () => {
    const place = normalisePlace({ ...ISLAMABAD, display_name: undefined });
    expect(place.label).toBe('Islamabad, Islamabad Capital Territory, Pakistan');
  });

  it('falls back to osm_type/osm_id, then to the coordinates, for the id', () => {
    expect(normalisePlace({ ...ISLAMABAD, place_id: undefined }).id).toBe('relation/421553');
    expect(
      normalisePlace({ ...ISLAMABAD, place_id: undefined, osm_type: undefined }).id,
    ).toBe('33.6001033,73.0442278');
  });

  it.each([
    ['no coordinates', { ...ISLAMABAD, lat: undefined, lon: undefined }],
    ['unparseable coordinates', { ...ISLAMABAD, lat: 'nowhere', lon: 'nowhere' }],
    ['nothing to display', { lat: '1', lon: '2' }],
    ['not an object', 'Islamabad'],
    ['null', null],
  ])('returns null for an unusable hit: %s', (_label, hit) => {
    expect(normalisePlace(hit)).toBeNull();
  });
});

describe('normalisePlaces', () => {
  it('drops unusable hits and collapses visual duplicates', () => {
    const places = normalisePlaces([
      ISLAMABAD,
      { ...ISLAMABAD, place_id: 999 }, // same display_name, different node
      LAHORE,
      { ...LAHORE, lat: 'nope' },
      null,
    ]);

    expect(places.map((place) => place.city)).toEqual(['Islamabad', 'Lahore']);
  });

  it('returns [] for anything that is not an array', () => {
    expect(normalisePlaces(undefined)).toEqual([]);
    expect(normalisePlaces({ error: 'Unable to geocode' })).toEqual([]);
    expect(normalisePlaces('Islamabad')).toEqual([]);
  });
});

describe('formatPlaceLabel', () => {
  it('joins whichever parts exist, in city, state, country order', () => {
    expect(formatPlaceLabel({ city: 'Islamabad', state: 'ICT', country: 'Pakistan' }))
      .toBe('Islamabad, ICT, Pakistan');
    expect(formatPlaceLabel({ city: 'Islamabad', country: 'Pakistan' }))
      .toBe('Islamabad, Pakistan');
    expect(formatPlaceLabel({ city: '  ', state: '', country: '' })).toBe('');
    expect(formatPlaceLabel(null)).toBe('');
  });
});

describe('searchPlaces', () => {
  it('calls the documented Nominatim URL, in English', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse([ISLAMABAD]));

    const results = await searchPlaces('islamabad');

    expect(results).toHaveLength(1);
    const [url, init] = globalThis.fetch.mock.calls[0];
    expect(url).toContain('https://nominatim.openstreetmap.org/search?');
    expect(url).toContain('format=jsonv2');
    expect(url).toContain('addressdetails=1');
    expect(url).toContain('limit=8');
    expect(url).toContain('q=islamabad');
    expect(url).toContain('accept-language=en');
    // Nominatim is a third party and must never see this app's cookies.
    expect(init.credentials).toBe('omit');
  });

  it('caches by query, ignoring case and extra whitespace', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse([ISLAMABAD]));

    await searchPlaces('Islamabad');
    await searchPlaces('islamabad');
    await searchPlaces('  ISLAMABAD  ');

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('clearGeocodeCache forces the next lookup back onto the network', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse([ISLAMABAD]));

    await searchPlaces('islamabad');
    clearGeocodeCache();
    await searchPlaces('islamabad');

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('never asks the network about a query shorter than MIN_QUERY_LENGTH', async () => {
    expect(await searchPlaces('is')).toEqual([]);
    expect(await searchPlaces('  ')).toEqual([]);
    expect(await searchPlaces('')).toEqual([]);
    expect(await searchPlaces(undefined)).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['the network is down', () => vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))],
    ['Nominatim rate limits us', () => vi.fn().mockResolvedValue(jsonResponse({}, 429))],
    ['the body is an HTML error page', () => vi.fn().mockResolvedValue(htmlResponse())],
    ['the body is not a list', () => vi.fn().mockResolvedValue(jsonResponse({ error: 'nope' }))],
    ['fetch itself throws synchronously', () => vi.fn(() => { throw new Error('boom'); })],
  ])('resolves to [] and never throws when %s', async (_label, makeFetch) => {
    globalThis.fetch = makeFetch();

    await expect(searchPlaces('islamabad')).resolves.toEqual([]);
  });
});

describe('lookupPlaces', () => {
  it('reports a failure so the UI can offer manual entry instead of "no matches"', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    const outcome = await lookupPlaces('islamabad');

    expect(outcome.status).toBe('failed');
    expect(outcome.results).toEqual([]);
    expect(outcome.error).toMatch(/could not reach/i);
  });

  it('reports an EMPTY success separately from a failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse([]));

    expect(await lookupPlaces('zzzzzzzz')).toEqual({ status: 'ok', results: [], error: null });
  });

  it('does not cache a failure, so the next keystroke retries', async () => {
    globalThis.fetch = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(jsonResponse([ISLAMABAD]));

    expect((await lookupPlaces('islamabad')).status).toBe('failed');
    expect((await lookupPlaces('islamabad')).results).toHaveLength(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('short circuits an already aborted signal without touching the network', async () => {
    const controller = new AbortController();
    controller.abort();

    expect(await lookupPlaces('islamabad', { signal: controller.signal }))
      .toEqual({ status: 'aborted', results: [], error: null });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('reports an in-flight abort as aborted, NOT as a failure', async () => {
    globalThis.fetch = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => {
        reject(new DOMException('The user aborted a request.', 'AbortError'));
      });
    }));
    const controller = new AbortController();

    const pending = lookupPlaces('islamabad', { signal: controller.signal });
    controller.abort();

    expect(await pending).toEqual({ status: 'aborted', results: [], error: null });
  });
});

describe('reverseGeocode', () => {
  it('normalises the single reverse hit', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(ISLAMABAD));

    const place = await reverseGeocode(33.6001, 73.0442);

    expect(place).toMatchObject({
      city: 'Islamabad',
      state: 'Islamabad Capital Territory',
      country: 'Pakistan',
    });
    const url = globalThis.fetch.mock.calls[0][0];
    expect(url).toContain('https://nominatim.openstreetmap.org/reverse?');
    expect(url).toContain('format=jsonv2');
    expect(url).toContain('addressdetails=1');
    expect(url).toContain('lat=33.6001');
    expect(url).toContain('lon=73.0442');
    expect(url).toContain('accept-language=en');
  });

  it('returns null for a coordinate Nominatim cannot name', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ error: 'Unable to geocode' }));

    expect(await reverseGeocode(0, 0)).toBeNull();
  });

  it('returns null, with no request, for coordinates that are not numbers', async () => {
    expect(await reverseGeocode(null, null)).toBeNull();
    expect(await reverseGeocode('', '')).toBeNull();
    expect(await reverseGeocode(Number.NaN, 12)).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('caches to 4 decimal places, so nudging the pin by a metre is free', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse(ISLAMABAD));

    await reverseGeocode(33.60010, 73.04422);
    await reverseGeocode(33.600104, 73.044219);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('never throws when the lookup dies', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(reverseGeocode(33.6, 73.04)).resolves.toBeNull();
    expect((await lookupReverse(31.5, 74.3)).status).toBe('failed');
  });
});

describe('the politeness contract', () => {
  it('exports a debounce long enough for Nominatim’s usage policy', () => {
    // The policy asks for a low request rate; anything under 300ms turns a typed
    // city name into a burst of requests.
    expect(SEARCH_DEBOUNCE_MS).toBeGreaterThanOrEqual(300);
    expect(MIN_QUERY_LENGTH).toBeGreaterThanOrEqual(2);
  });

  it('exports the attribution the OSM licence requires', () => {
    expect(ATTRIBUTION).toMatch(/OpenStreetMap/);
  });
});
