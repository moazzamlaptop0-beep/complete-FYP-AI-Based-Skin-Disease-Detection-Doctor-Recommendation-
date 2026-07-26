/**
 * format.js — every user-visible value conversion in one place.
 *
 * The backend is not consistent about formats and the contract freezes that
 * inconsistency, so the FRONTEND has to absorb it:
 *   - scans use `.isoformat()`            -> "2026-07-20T10:11:12.131415"
 *   - /admin/doctors uses strftime        -> "2026-07-20 10:11"
 *   - ratings use strftime                -> "Jul 25, 2026"
 *   - /login sends joined_at              -> "Jan 2024"
 *   - appointments send date + time apart -> "2026-08-03" + "09:00"
 * Every parser here is total: an unparseable value returns the placeholder,
 * never "Invalid Date" and never a thrown error inside a render.
 */

const EM_DASH = '—';

// ---------------------------------------------------------------------------
// Date parsing
// ---------------------------------------------------------------------------

/**
 * Parse anything the API might hand us into a Date, or null.
 * Handles: Date, epoch ms/seconds, ISO strings, "YYYY-MM-DD HH:MM",
 * "YYYY-MM-DD", and the bare "HH:MM" time strings (relative to today).
 * @returns {Date|null}
 */
export function parseDate(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  if (typeof value === 'number' && Number.isFinite(value)) {
    // Heuristic: anything below ~1e11 is seconds, not milliseconds.
    const date = new Date(value < 1e11 ? value * 1000 : value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;

  // "YYYY-MM-DD HH:MM[:SS]" — Python strftime output. Safari refuses the space.
  const spaced = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)/.exec(text);
  if (spaced) {
    const date = new Date(`${spaced[1]}T${spaced[2]}`);
    if (!Number.isNaN(date.getTime())) return date;
  }

  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Combine the separate `slot_date` ("2026-08-03") + `slot_time` ("09:00") fields. */
export function parseDateTimeParts(datePart, timePart) {
  if (!datePart) return null;
  const time = typeof timePart === 'string' && /^\d{1,2}:\d{2}/.test(timePart.trim())
    ? timePart.trim().padStart(5, '0')
    : '00:00';
  return parseDate(`${String(datePart).trim().slice(0, 10)}T${time}`);
}

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

function safeFormat(date, options, locale) {
  try {
    return new Intl.DateTimeFormat(locale || undefined, options).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/** "3 Aug 2026". Falls back to `placeholder` for junk input. */
export function formatDate(value, { locale, placeholder = EM_DASH } = {}) {
  const date = parseDate(value);
  if (!date) return placeholder;
  return safeFormat(date, { day: 'numeric', month: 'short', year: 'numeric' }, locale);
}

/** "3 Aug 2026, 09:00". */
export function formatDateTime(value, { locale, placeholder = EM_DASH } = {}) {
  const date = parseDate(value);
  if (!date) return placeholder;
  return safeFormat(
    date,
    { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' },
    locale,
  );
}

/**
 * "9:00 AM" from a Date, an ISO string, or a bare "09:00" slot string.
 * Slot strings are the common case (`/api/slots`, `slot_time`).
 */
export function formatTime(value, { locale, placeholder = EM_DASH, hour12 = true } = {}) {
  if (typeof value === 'string' && /^\d{1,2}:\d{2}$/.test(value.trim())) {
    const [h, m] = value.trim().split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return placeholder;
    if (!hour12) return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const suffix = h >= 12 ? 'PM' : 'AM';
    const hour = h % 12 === 0 ? 12 : h % 12;
    return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
  }
  const date = parseDate(value);
  if (!date) return placeholder;
  return safeFormat(date, { hour: '2-digit', minute: '2-digit', hour12 }, locale);
}

/** "Jan 2024" — matches the `joined_at` the backend already sends. */
export function formatMonthYear(value, { locale, placeholder = EM_DASH } = {}) {
  if (typeof value === 'string' && /^[A-Za-z]{3} \d{4}$/.test(value.trim())) return value.trim();
  const date = parseDate(value);
  if (!date) return placeholder;
  return safeFormat(date, { month: 'short', year: 'numeric' }, locale);
}

/**
 * "3 minutes ago" / "in 2 days". Uses Intl.RelativeTimeFormat where available.
 */
export function formatRelativeTime(value, { locale, now = Date.now(), placeholder = EM_DASH } = {}) {
  const date = parseDate(value);
  if (!date) return placeholder;

  const deltaMs = date.getTime() - now;
  const absSeconds = Math.abs(deltaMs) / 1000;

  if (absSeconds < 45) return deltaMs <= 0 ? 'just now' : 'in a moment';

  /** @type {Array<[Intl.RelativeTimeFormatUnit, number]>} */
  const units = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['week', 60 * 60 * 24 * 7],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
  ];

  const [unit, seconds] = units.find(([, s]) => absSeconds >= s) || ['second', 1];
  const amount = Math.round(deltaMs / 1000 / seconds);

  try {
    return new Intl.RelativeTimeFormat(locale || undefined, { numeric: 'auto' }).format(amount, unit);
  } catch {
    const n = Math.abs(amount);
    const label = `${n} ${unit}${n === 1 ? '' : 's'}`;
    return amount < 0 ? `${label} ago` : `in ${label}`;
  }
}

// ---------------------------------------------------------------------------
// Numbers, money, confidence
// ---------------------------------------------------------------------------

/**
 * Currency. PKR renders whole rupees (fractional paisa is noise on a fee), USD
 * renders cents. Both fall back to a manual string if Intl lacks the locale.
 * The API sends `null` for "no fee configured" — that is NOT zero, so it renders
 * as the placeholder rather than "Rs 0".
 */
export function formatCurrency(amount, currency = 'PKR', { locale, placeholder = EM_DASH } = {}) {
  if (amount === null || amount === undefined || amount === '') return placeholder;
  const value = Number(amount);
  if (!Number.isFinite(value)) return placeholder;

  const code = String(currency).toUpperCase();
  const fractionDigits = code === 'PKR' ? 0 : 2;
  const defaultLocale = code === 'PKR' ? 'en-PK' : 'en-US';

  try {
    return new Intl.NumberFormat(locale || defaultLocale, {
      style: 'currency',
      currency: code,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(value);
  } catch {
    const symbol = code === 'PKR' ? 'Rs' : '$';
    return `${symbol} ${value.toFixed(fractionDigits)}`;
  }
}

/** `{pkr, usd}` from the API rendered as "Rs 2,000 / $10". */
export function formatFees(fees, { locale, placeholder = EM_DASH } = {}) {
  if (!fees || typeof fees !== 'object') return placeholder;
  const parts = [];
  if (fees.pkr !== null && fees.pkr !== undefined) parts.push(formatCurrency(fees.pkr, 'PKR', { locale }));
  if (fees.usd !== null && fees.usd !== undefined) parts.push(formatCurrency(fees.usd, 'USD', { locale }));
  return parts.length ? parts.join(' / ') : placeholder;
}

/**
 * Normalise the AI confidence to a 0-100 number.
 *
 * See api-contract.md G5: the DB stores 0-100, the triage engine assumes 0-1,
 * and reason strings can contain values like 8734. DoctorDashboard.jsx:504 and
 * PatientHistory.jsx:589 already do this exact dance inline; it lives here now.
 *   0 < v <= 1     -> v * 100   (a probability slipped through)
 *   v > 1000       -> v / 100   (double-scaled)
 *   otherwise      -> clamp 0-100
 * @returns {number|null}
 */
export function normalizeConfidence(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw)) return null;
  let percent = raw;
  if (percent > 0 && percent <= 1) percent *= 100;
  else if (percent > 100) percent = percent > 1000 ? percent / 100 : percent;
  return Math.min(100, Math.max(0, percent));
}

/** "87.3%" — the normalised confidence, ready to render. */
export function formatConfidence(value, { digits = 1, placeholder = EM_DASH } = {}) {
  const percent = normalizeConfidence(value);
  if (percent === null) return placeholder;
  const rounded = Number(percent.toFixed(digits));
  return `${rounded}%`;
}

/** "1,234". */
export function formatNumber(value, { locale, placeholder = EM_DASH, ...options } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return placeholder;
  try {
    return new Intl.NumberFormat(locale || undefined, options).format(num);
  } catch {
    return String(num);
  }
}

/** "4.5" for a star rating, or "New" when the doctor has none (API sends null). */
export function formatRating(value, { placeholder = 'New', digits = 1 } = {}) {
  if (value === null || value === undefined) return placeholder;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return placeholder;
  return num.toFixed(digits);
}

/** "2.4 MB" for upload size checks against the 10 MB MAX_CONTENT_LENGTH. */
export function formatBytes(bytes, { digits = 1, placeholder = EM_DASH } = {}) {
  const num = Number(bytes);
  if (!Number.isFinite(num) || num < 0) return placeholder;
  if (num === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(num) / Math.log(1024)));
  return `${Number((num / 1024 ** index).toFixed(digits))} ${units[index]}`;
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/**
 * "Ayesha Khan" -> "AK". Used by Avatar. Handles single names, extra spaces and
 * non-latin scripts (takes the first codepoint of each of the first two words).
 */
export function initials(name, { max = 2, fallback = '?' } = {}) {
  if (!name || typeof name !== 'string') return fallback;
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return fallback;
  return words.slice(0, max).map((w) => Array.from(w)[0]).join('').toUpperCase();
}

/** Truncate to `length` characters with an ellipsis, on a word boundary. */
export function truncate(text, length = 80, suffix = '…') {
  if (!text || typeof text !== 'string') return '';
  if (text.length <= length) return text;
  const cut = text.slice(0, length);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > length * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}${suffix}`;
}

/**
 * The model returns "2. Melanoma" / "4. Basal Cell Carcinoma (BCC)". Strip the
 * numeric prefix for display without touching the stored value.
 */
export function formatDiseaseName(value, { placeholder = 'Unknown' } = {}) {
  if (!value || typeof value !== 'string') return placeholder;
  return value.replace(/^\s*\d+\.\s*/, '').trim() || placeholder;
}

/** 'AI User' -> 'Patient' for display only. The literal is never renamed in data. */
export function formatRole(role) {
  if (role === 'AI User' || role === 'Patient') return 'Patient';
  if (role === 'Doctor') return 'Doctor';
  if (role === 'Admin') return 'Admin';
  return role || 'Guest';
}

/** 'Pending-Conflict' -> 'Pending Conflict'. Display only. */
export function formatStatus(status) {
  if (!status || typeof status !== 'string') return EM_DASH;
  return status.replace(/[-_]/g, ' ');
}

export default {
  formatBytes,
  formatConfidence,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatDiseaseName,
  formatFees,
  formatMonthYear,
  formatNumber,
  formatRating,
  formatRelativeTime,
  formatRole,
  formatStatus,
  formatTime,
  initials,
  normalizeConfidence,
  parseDate,
  parseDateTimeParts,
  truncate,
};
