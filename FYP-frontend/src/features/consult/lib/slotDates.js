/**
 * slotDates.js — the 14-day window the Times step offers, as plain data.
 *
 * WHY LOCAL DATES AND NOT `toISOString()`
 * ---------------------------------------
 * `new Date().toISOString().slice(0, 10)` is the usual one-liner and it is wrong
 * for exactly the users this product has: it converts to UTC first, so at 02:00
 * in Karachi (UTC+05:00) it reports YESTERDAY. A patient tapping the first chip
 * in the strip would be asking for a date the backend has already binned as past
 * (`/api/slots/<id>` returns `[]` for a past date), and the screen would show an
 * empty day with no explanation. So the strip is built from the LOCAL calendar
 * date, which is what "today" means to the person holding the phone.
 *
 * The backend does its own filtering of already-passed times using a UTC `%H:%M`
 * comparison, so late in the local evening today's remaining chips can come back
 * shorter than the clock suggests. That is the server's call — it owns the
 * booking — and the UI just reports what it returns.
 */

/** `YYYY-MM-DD` in the browser's own timezone. */
export function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** A new Date `days` after `from`, with the time zeroed. */
export function addDays(from, days) {
  const next = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

export function todayISO(now = new Date()) {
  return toISODate(now);
}

/**
 * The strip itself.
 * @param {number} [days=14]
 * @param {Date} [now]
 * @returns {Array<{iso:string, weekday:string, dayNumber:string, month:string,
 *                  isToday:boolean, isWeekend:boolean, label:string}>}
 */
export function buildDateStrip(days = 14, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Array.from({ length: days }, (unused, offset) => {
    const date = addDays(start, offset);
    const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
    const month = date.toLocaleDateString(undefined, { month: 'short' });
    const dayNumber = String(date.getDate());
    return {
      iso: toISODate(date),
      weekday,
      dayNumber,
      month,
      isToday: offset === 0,
      isWeekend: date.getDay() === 0 || date.getDay() === 6,
      // The accessible name — "Sat 2 Aug" reads far better than "2".
      label: offset === 0
        ? `Today, ${weekday} ${dayNumber} ${month}`
        : offset === 1
          ? `Tomorrow, ${weekday} ${dayNumber} ${month}`
          : `${weekday} ${dayNumber} ${month}`,
    };
  });
}

/** "Today" / "Tomorrow" / "Sat 2 Aug" for an ISO date already in the strip. */
export function friendlyDate(iso, now = new Date()) {
  if (!iso) return '';
  const strip = buildDateStrip(14, now);
  const found = strip.find((entry) => entry.iso === iso);
  if (found) {
    if (found.isToday) return 'Today';
    return strip[1]?.iso === iso
      ? 'Tomorrow'
      : `${found.weekday} ${found.dayNumber} ${found.month}`;
  }
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return parsed.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export default { toISODate, addDays, todayISO, buildDateStrip, friendlyDate };
