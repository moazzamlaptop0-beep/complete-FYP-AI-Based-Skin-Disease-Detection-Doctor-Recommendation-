/**
 * permissions.js — a faithful client mirror of app/core/rbac.py.
 *
 * THE SERVER IS THE AUTHORITY. This file exists so the UI can decide what to
 * RENDER before (and if) `/auth/me` answers — hiding a button the user cannot
 * use is a UX concern, not a security control. Every one of these permissions is
 * re-checked server-side on the actual request.
 *
 * The sets are built by explicit union exactly like the backend:
 *     DOCTOR = PATIENT | {...}
 *     ADMIN  = DOCTOR  | {...}
 * which is the whole point of the refactor: a Doctor genuinely holds every
 * Patient permission, so a dermatologist can scan their own mole without a
 * second account. Role checks must therefore go through permissions, never
 * through `user.role === 'Doctor'` string equality.
 *
 * Role literals are frozen: 'Admin' | 'Doctor' | 'AI User'.
 */

export const ROLES = Object.freeze({
  ADMIN: 'Admin',
  DOCTOR: 'Doctor',
  PATIENT: 'AI User',
});

/** Every spelling that has ever reached this codebase -> canonical literal. */
const ROLE_ALIASES = Object.freeze({
  admin: ROLES.ADMIN,
  administrator: ROLES.ADMIN,
  doctor: ROLES.DOCTOR,
  dr: ROLES.DOCTOR,
  'ai user': ROLES.PATIENT,
  aiuser: ROLES.PATIENT,
  ai_user: ROLES.PATIENT,
  patient: ROLES.PATIENT,
  ai_derma: ROLES.PATIENT,
  user: ROLES.PATIENT,
});

/** Matches ROLE_RANK in app/core/rbac.py. Delegation needs STRICTLY higher rank. */
export const ROLE_RANK = Object.freeze({
  [ROLES.PATIENT]: 100,
  [ROLES.DOCTOR]: 200,
  [ROLES.ADMIN]: 300,
});

/** Any spelling -> the canonical role literal, or null. */
export function normalizeRole(value) {
  if (!value) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (Object.values(ROLES).includes(text)) return text;
  return ROLE_ALIASES[text.toLowerCase()] || null;
}

export function roleRank(value) {
  return ROLE_RANK[normalizeRole(value)] || 0;
}

/** Permission strings, byte-identical to the backend's Permission enum values. */
export const PERMISSIONS = Object.freeze({
  // scans
  SCAN_CREATE: 'scan.create',
  SCAN_READ_OWN: 'scan.read.own',
  SCAN_READ_ANY: 'scan.read.any',
  SCAN_SEND_REPORT: 'scan.send_report',
  SCAN_REVIEW_ASSIGNED: 'scan.review.assigned',
  SCAN_REVIEW_ANY: 'scan.review.any',
  SCAN_DELETE_ASSIGNED: 'scan.delete.assigned',
  SCAN_DELETE_ANY: 'scan.delete.any',
  SCAN_OVERRIDE_SEVERITY: 'scan.override_severity',
  // appointments
  APPOINTMENT_BOOK: 'appointment.book',
  APPOINTMENT_READ_OWN: 'appointment.read.own',
  APPOINTMENT_READ_ANY: 'appointment.read.any',
  APPOINTMENT_MANAGE_OWN: 'appointment.manage.own',
  APPOINTMENT_MANAGE_ANY: 'appointment.manage.any',
  APPOINTMENT_RESOLVE_CONFLICT: 'appointment.resolve_conflict',
  // schedule / doctor profile
  SCHEDULE_MANAGE: 'schedule.manage',
  DOCTOR_PROFILE_MANAGE: 'doctor.profile.manage',
  DOCTOR_VERIFY: 'doctor.verify',
  // ratings
  RATING_CREATE: 'rating.create',
  RATING_READ: 'rating.read',
  // admin / platform
  USER_READ_ANY: 'user.read.any',
  ADMIN_STATS: 'admin.stats',
  ADMIN_AUDIT_READ: 'admin.audit.read',
  ACTOR_ACT_AS: 'actor.act_as',
});

const PATIENT_PERMS = [
  PERMISSIONS.SCAN_CREATE,
  PERMISSIONS.SCAN_READ_OWN,
  PERMISSIONS.SCAN_SEND_REPORT,
  PERMISSIONS.APPOINTMENT_BOOK,
  PERMISSIONS.APPOINTMENT_READ_OWN,
  PERMISSIONS.APPOINTMENT_MANAGE_OWN,
  PERMISSIONS.RATING_CREATE,
  PERMISSIONS.RATING_READ,
];

const DOCTOR_PERMS = [
  ...PATIENT_PERMS,
  PERMISSIONS.SCAN_REVIEW_ASSIGNED,
  PERMISSIONS.SCAN_DELETE_ASSIGNED,
  PERMISSIONS.SCAN_OVERRIDE_SEVERITY,
  PERMISSIONS.APPOINTMENT_RESOLVE_CONFLICT,
  PERMISSIONS.SCHEDULE_MANAGE,
  PERMISSIONS.DOCTOR_PROFILE_MANAGE,
];

const ADMIN_PERMS = [
  ...DOCTOR_PERMS,
  PERMISSIONS.SCAN_READ_ANY,
  PERMISSIONS.SCAN_REVIEW_ANY,
  PERMISSIONS.SCAN_DELETE_ANY,
  PERMISSIONS.APPOINTMENT_READ_ANY,
  PERMISSIONS.APPOINTMENT_MANAGE_ANY,
  PERMISSIONS.DOCTOR_VERIFY,
  PERMISSIONS.USER_READ_ANY,
  PERMISSIONS.ADMIN_STATS,
  PERMISSIONS.ADMIN_AUDIT_READ,
  PERMISSIONS.ACTOR_ACT_AS,
];

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.PATIENT]: Object.freeze([...PATIENT_PERMS]),
  [ROLES.DOCTOR]: Object.freeze([...DOCTOR_PERMS]),
  [ROLES.ADMIN]: Object.freeze([...ADMIN_PERMS]),
});

/** Fallback permission list for a role, used until `/auth/me` supplies the real one. */
export function permissionsForRole(role) {
  return ROLE_PERMISSIONS[normalizeRole(role)] || [];
}

/** Does this permission list satisfy the requirement? */
export function hasPermission(permissions, permission) {
  if (!permission) return true;
  if (!Array.isArray(permissions)) return false;
  return permissions.includes(permission);
}

export function hasAllPermissions(permissions, required) {
  const list = Array.isArray(required) ? required : [required];
  return list.every((p) => hasPermission(permissions, p));
}

export function hasAnyPermission(permissions, required) {
  const list = Array.isArray(required) ? required : [required];
  if (!list.length) return true;
  return list.some((p) => hasPermission(permissions, p));
}

/** The dashboard a role lands on. These paths already exist in App.jsx. */
export const HOME_ROUTES = Object.freeze({
  [ROLES.ADMIN]: '/admin-dashboard',
  [ROLES.DOCTOR]: '/doctor-dashboard',
  [ROLES.PATIENT]: '/my-reports',
});

export function homeRouteForRole(role) {
  return HOME_ROUTES[normalizeRole(role)] || '/';
}

export default {
  HOME_ROUTES,
  PERMISSIONS,
  ROLES,
  ROLE_PERMISSIONS,
  ROLE_RANK,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  homeRouteForRole,
  normalizeRole,
  permissionsForRole,
  roleRank,
};
