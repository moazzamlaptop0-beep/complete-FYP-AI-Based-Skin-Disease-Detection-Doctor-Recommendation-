/**
 * passwordStrength.js — the client half of the password policy.
 *
 * THE SERVER IS THE AUTHORITY. `app/services/auth_service.validate_password`
 * rejects: empty, shorter than PASSWORD_MIN_LENGTH (8), all-numeric, and
 * anything in COMMON_PASSWORDS. Everything here is a mirror whose only job is
 * to say so BEFORE the round-trip — it can never be more permissive than the
 * server, and when the server disagrees the server wins (the machine surfaces
 * its message verbatim).
 *
 * `/auth/consent-documents` also returns `password_policy: {min_length, rules[]}`,
 * so the rules the user is shown come from the backend at runtime; the numbers
 * below are only the fallback for when that call has not landed yet.
 */

/** Matches app/services/auth_service.py COMMON_PASSWORDS in spirit — the short
 *  list of things a user is most likely to try that the server will bounce. */
const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890',
  'qwerty', 'qwerty123', 'letmein', 'welcome', 'welcome1', 'admin', 'admin123',
  'iloveyou', 'abc12345', 'football', 'monkey', 'dragon', 'sunshine', 'princess',
  'passw0rd', 'trustno1', 'starwars', 'whatever', 'zaq12wsx', 'qwertyuiop',
]);

export const DEFAULT_MIN_LENGTH = 8;

/**
 * The four bands the meter renders. `score` is the index, so a caller can do
 * `LEVELS[result.score]` without a lookup table of its own.
 * @type {ReadonlyArray<{id:string,label:string,tone:'danger'|'warning'|'primary'|'success'}>}
 */
export const LEVELS = Object.freeze([
  { id: 'weak', label: 'Weak', tone: 'danger' },
  { id: 'fair', label: 'Fair', tone: 'warning' },
  { id: 'good', label: 'Good', tone: 'primary' },
  { id: 'strong', label: 'Strong', tone: 'success' },
]);

/**
 * Hard policy check — the same three rules the server enforces.
 * @param {string} password
 * @param {number} [minLength=DEFAULT_MIN_LENGTH]
 * @returns {{ok:boolean, error:string|null}} `error` is user-facing copy.
 */
export function checkPasswordPolicy(password, minLength = DEFAULT_MIN_LENGTH) {
  const value = typeof password === 'string' ? password : '';
  const floor = Number.isFinite(minLength) && minLength > 0 ? minLength : DEFAULT_MIN_LENGTH;

  if (!value) return { ok: false, error: 'Password is required.' };
  if (value.length < floor) {
    return { ok: false, error: `Password must be at least ${floor} characters.` };
  }
  if (/^\d+$/.test(value)) {
    return { ok: false, error: 'Password cannot be all numbers.' };
  }
  if (COMMON.has(value.toLowerCase())) {
    return { ok: false, error: 'That password is too common. Please choose another.' };
  }
  return { ok: true, error: null };
}

/**
 * Soft, advisory scoring for the meter. Deliberately NOT a gate: a password may
 * be "Weak" and still be accepted, because the policy above is the only rule
 * that decides. Blocking on a made-up entropy score is how users end up with
 * `Passw0rd!` everywhere.
 *
 * @param {string} password
 * @param {number} [minLength=DEFAULT_MIN_LENGTH]
 * @returns {{score:0|1|2|3, level:{id:string,label:string,tone:string},
 *   percent:number, meets:{length:boolean,notNumeric:boolean,notCommon:boolean},
 *   suggestions:string[], policy:{ok:boolean,error:string|null}}}
 */
export function scorePassword(password, minLength = DEFAULT_MIN_LENGTH) {
  const value = typeof password === 'string' ? password : '';
  const floor = Number.isFinite(minLength) && minLength > 0 ? minLength : DEFAULT_MIN_LENGTH;
  const policy = checkPasswordPolicy(value, floor);

  const meets = {
    length: value.length >= floor,
    notNumeric: value.length > 0 && !/^\d+$/.test(value),
    notCommon: value.length > 0 && !COMMON.has(value.toLowerCase()),
  };

  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(value)).length;

  let points = 0;
  if (value.length >= floor) points += 1;
  if (value.length >= 12) points += 1;
  if (classes >= 2) points += 1;
  if (classes >= 3) points += 1;
  if (!policy.ok) points = 0;

  // points 0..4 -> score 0..3. A policy failure pins it to 0 regardless.
  const score = /** @type {0|1|2|3} */ (Math.max(0, Math.min(3, points - 1)));
  const suggestions = [];
  if (!meets.length) suggestions.push(`Use at least ${floor} characters`);
  if (value.length > 0 && value.length < 12) suggestions.push('12+ characters is much stronger');
  if (classes < 3) suggestions.push('Mix upper case, lower case, numbers or symbols');
  if (!meets.notCommon) suggestions.push('Avoid common passwords');

  return {
    score,
    level: LEVELS[score],
    // Empty stays at 0 so the meter is not "25% full" before a key is pressed.
    percent: value ? Math.round(((score + 1) / LEVELS.length) * 100) : 0,
    meets,
    suggestions,
    policy,
  };
}

export default { LEVELS, DEFAULT_MIN_LENGTH, checkPasswordPolicy, scorePassword };
