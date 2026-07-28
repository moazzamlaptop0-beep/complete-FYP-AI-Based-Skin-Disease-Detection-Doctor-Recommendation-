/**
 * Chart data helpers — pure functions and constants, split from charts.jsx so
 * the component file keeps Fast Refresh.
 */

/**
 * The validated status fills (see the palette validation in the overhaul
 * notes): dark steps are re-picked, not auto-flipped.
 */
export const STATUS_FILLS = {
  danger: 'bg-danger-700 dark:bg-danger-500',
  warning: 'bg-warning-600 dark:bg-warning-400',
  success: 'bg-success-600 dark:bg-success-400',
  info: 'bg-info-600 dark:bg-info-500',
  primary: 'bg-primary-500',
  neutral: 'bg-neutral-400',
};

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Parse the backend's date strings safely (Safari rejects 'YYYY-MM-DD HH:MM'). */
function toTime(value) {
  if (!value) return null;
  const text = String(value).trim().replace(' ', 'T');
  const time = new Date(text).getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * Bucket records into the last `count` calendar weeks by a date field.
 * @param {Array<object>} rows
 * @param {(row:object) => any} getDate
 * @param {number} [count=8]
 * @returns {Array<{key:string, label:string, value:number, hint:string}>}
 */
export function bucketByWeek(rows, getDate, count = 8) {
  const now = new Date();
  // Monday of the current week, local time.
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayOfWeek = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - dayOfWeek);
  const currentWeekStart = monday.getTime();

  const buckets = Array.from({ length: count }, (_, i) => {
    const start = currentWeekStart - (count - 1 - i) * WEEK_MS;
    const date = new Date(start);
    const label = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return { key: String(start), label, value: 0, hint: `week of ${label}`, start };
  });

  (rows || []).forEach((row) => {
    const time = toTime(getDate(row));
    if (time === null) return;
    const bucket = buckets.find((b) => time >= b.start && time < b.start + WEEK_MS);
    if (bucket) bucket.value += 1;
  });

  return buckets.map((bucket) => ({
    key: bucket.key,
    label: bucket.label,
    value: bucket.value,
    hint: bucket.hint,
  }));
}
