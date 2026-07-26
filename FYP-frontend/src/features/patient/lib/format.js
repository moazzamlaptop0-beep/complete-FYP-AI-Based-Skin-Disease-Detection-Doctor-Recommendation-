/**
 * format.js — the patient surface's display helpers.
 *
 * All of these exist because the backend is honest about being messy and the UI
 * has to be consistent anyway:
 *  - timestamps are ISO strings, or null, or occasionally ''
 *  - `appointment_date` is free text (the contract says so), so it may not parse
 *  - confidence arrives as 0.87 from one route and 87 from another
 *  - `triage_reasons` / `patient_questionnaire` are JSON *strings* on some rows
 *    and already-parsed objects on others
 * One place to be defensive beats a `?? '—'` on every line of every page.
 */

/** The dash we show for "nothing here", so it is the same glyph everywhere. */
export const EMPTY = '—';

/** @param {string|null|undefined} value ISO-8601 @returns {Date|null} */
export function toDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** '12 Mar 2026' */
export function formatDate(value) {
  const date = toDate(value);
  if (!date) return typeof value === 'string' && value ? value : EMPTY;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** '12 Mar 2026, 14:30' */
export function formatDateTime(value) {
  const date = toDate(value);
  if (!date) return typeof value === 'string' && value ? value : EMPTY;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}, ${
    date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/** 'in 3 days' / '2 hours ago'. Falls back to the absolute date past a month. */
export function formatRelative(value) {
  const date = toDate(value);
  if (!date) return EMPTY;
  const diffMs = date.getTime() - Date.now();
  const abs = Math.abs(diffMs);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (abs < minute) return 'just now';
  if (abs > 30 * day) return formatDate(value);

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (abs < hour) return rtf.format(Math.round(diffMs / minute), 'minute');
  if (abs < day) return rtf.format(Math.round(diffMs / hour), 'hour');
  return rtf.format(Math.round(diffMs / day), 'day');
}

/**
 * '87%'. `/predict` returns a percentage, some listings return a 0-1 fraction;
 * anything ≤ 1 is treated as a fraction.
 */
export function formatConfidence(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return EMPTY;
  const percent = number <= 1 ? number * 100 : number;
  return `${Math.round(percent)}%`;
}

/** The same value as a 0-100 number, for <Progress>. */
export function confidencePercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, number <= 1 ? number * 100 : number));
}

/** 'PKR 2,000' — `fees.pkr` is 0.0 on the appointment route and null on the directory. */
export function formatFee(amount, currency = 'PKR') {
  const number = Number(amount);
  if (!Number.isFinite(number) || number <= 0) return null;
  return `${currency} ${number.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * Parse a field that is a JSON string on some rows and already an object on
 * others (`triage_reasons`, `patient_questionnaire`, `scan_info`).
 * @param {any} value
 * @param {any} [fallback]
 */
export function parseMaybeJson(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/** 'itchy_or_painful' -> 'Itchy or painful' */
export function humanizeKey(key) {
  return String(key)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

/** Render a questionnaire answer without printing a bare `true`. */
export function formatAnswer(value) {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  if (value === null || value === undefined || value === '') return 'Not answered';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
  return String(value);
}

/** 'YYYY-MM-DD' for today, in the LOCAL timezone (toISOString would drift). */
export function todayIso(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * Is this appointment in the future? `appointment_date` is free text, so a row
 * we cannot parse is treated as UPCOMING — showing a visit that may already have
 * happened is recoverable; hiding one that has not is not.
 */
export function isUpcoming(appointment) {
  const dateText = appointment?.slot_date || appointment?.date || appointment?.appointment_date;
  const timeText = appointment?.slot_time || appointment?.time || '';
  if (!dateText) return true;
  const parsed = new Date(`${dateText}${timeText ? ` ${timeText}` : ''}`);
  if (Number.isNaN(parsed.getTime())) return true;
  return parsed.getTime() >= Date.now() - 60 * 60 * 1000; // an hour's grace
}

/** Statuses that mean "this visit is over or off". */
export const CLOSED_STATUSES = Object.freeze(['Completed', 'Cancelled', 'Reassigned']);

export function isClosed(status) {
  return CLOSED_STATUSES.includes(String(status || ''));
}

export default {
  EMPTY,
  formatAnswer,
  formatConfidence,
  formatDate,
  formatDateTime,
  formatFee,
  formatRelative,
  humanizeKey,
  isClosed,
  isUpcoming,
  parseMaybeJson,
  todayIso,
  toDate,
};
