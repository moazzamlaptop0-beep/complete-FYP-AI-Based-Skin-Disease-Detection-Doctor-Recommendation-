/**
 * endpoints.js — the ONLY module in the app that contains URL strings.
 *
 * RULES
 * -----
 * 1. APPEND-ONLY. Never renumber, never re-sort an existing block. Entries are
 *    alphabetised WITHIN each group so two agents adding endpoints in different
 *    domains never touch the same lines.
 * 2. Every function returns a PATH (leading slash, no origin). `lib/api.js`
 *    prepends the base URL. Callers must never template a URL themselves.
 * 3. The HTTP method is documented in the JSDoc of each entry, because the
 *    backend is not RESTful — `/doctor/update_scan/<id>` is a PUT,
 *    `/api/override-severity/<id>` is a POST, `/api/doctor/profile` is both a
 *    GET and a POST on the same path.
 * 4. Anything marked `TODO(contract)` is an endpoint being built in parallel
 *    whose exact signature is not yet in docs/api-contract.md. The path is the
 *    agreed one; the request/response shape is a best guess and MUST be checked
 *    against the backend before it is relied on.
 *
 * The 39 frozen routes are marked `[contract]` with their appendix number.
 */

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/**
 * Build a query string. Skips null / undefined / '' so an unset filter never
 * becomes `?status=` — which the backend would read as a real (empty) filter.
 * @param {Record<string, any>} [params]
 * @returns {string} '' or '?a=1&b=2'
 */
export function qs(params) {
  if (!params || typeof params !== 'object') return '';
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') return;
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== null && item !== undefined && item !== '') search.append(key, String(item));
      });
      return;
    }
    search.append(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** Path-segment encode, so an id or filename can never break out of its slot. */
const seg = (value) => encodeURIComponent(String(value));

// ---------------------------------------------------------------------------
// admin
// ---------------------------------------------------------------------------

export const admin = {
  /** GET `/admin/appointments` — ADDITIVE. Paginated.
   *  Params `{page, per_page, status, doctor, patient, date_from, date_to, date_field}`
   *  where date_field ∈ 'created'|'slot' (default 'created'). `appointment_date`
   *  is free text, so only date_field='slot' is range-filterable. */
  appointments: (params) => `/admin/appointments${qs(params)}`,

  /** GET `/admin/audit-log` — ADDITIVE (singular "log", not "logs"). Paginated.
   *  Params `{page, per_page, actor, subject, action, action_prefix, target_type, date_from, date_to}`.
   *  Same table `require_permission` writes on every X-Act-As-User-Id request, so
   *  impersonations show up here next to suspensions. */
  auditLog: (params) => `/admin/audit-log${qs(params)}`,

  /** POST `/admin/users` — ADDITIVE, `user.manage.any`. Provision an account.
   *  Body `{name, email, role:'Doctor'|'AI User', password?, is_verified?,
   *  doctor:{license, specialty, hospital, city, phone, experience, latitude,
   *  longitude, verification_status?:'pending'|'approved', verification_note?}}`.
   *
   *  NOTE THE SHARED PATH: this is the same rule as `users()` with a different
   *  method, which is why both live in this file rather than being templated.
   *
   *  `password` is OPTIONAL — omit it and the server generates one, returning it
   *  as `data.temporary_password`. That value is shown ONCE and is never
   *  retrievable again, so the UI must surface it before the modal closes.
   *  `is_verified` defaults to TRUE and NO OTP is sent: an admin entering the
   *  details is the verification. 403 for role 'Admin' (seed-only, unchanged). */
  createUser: () => '/admin/users',

  /** DELETE `/admin/doctors/<id>` — [contract #23] cascades; 400 on FK block. */
  deleteDoctor: (doctorId) => `/admin/doctors/${seg(doctorId)}`,

  /** DELETE `/api/admin/scans/<id>` — ADDITIVE, `scan.delete.any`. Returns
   *  `{scan_id, purged_files}`. NOTE THE `/api` PREFIX: unlike every other
   *  `/admin/*` route this one lives under the scans blueprint.
   *  This is the IRREVERSIBLE twin of `scans.deleteImage()` — it destroys the
   *  `ai_scans` row itself (prediction, severity, doctor comment, triage
   *  reasons), not just the pixels. A patient exercising erasure must always be
   *  sent to `scans.deleteImage()`; this exists for genuinely bad data. */
  deleteScan: (scanId) => `/api/admin/scans/${seg(scanId)}`,

  /** GET `/admin/doctors?status=` — [contract #21] status filter is applied in
   *  Python after loading every doctor, so profile-less doctors count as 'pending'. */
  doctors: (params) => `/admin/doctors${qs(params)}`,

  /** GET `/admin/patients` — ADDITIVE. Paginated.
   *  Params `{page, per_page, q, is_active}`; items carry scan_count / appointment_count. */
  patients: (params) => `/admin/patients${qs(params)}`,

  /** DELETE `/admin/users/<id>` — ADDITIVE, `user.manage.any`. HARD delete, and
   *  ONLY for an account with no clinical history. 400 when anything is linked,
   *  carrying `data:{scans, appointments_as_patient, appointments_as_doctor,
   *  reviews_written, reviews_received, alternative}` — show those counts and
   *  send the admin to Suspend instead. 403 on is_root or an equal/higher role,
   *  400 on yourself. */
  deleteUser: (userId) => `/admin/users/${seg(userId)}`,

  /** POST `/admin/users/<id>/reset-password` — ADDITIVE, `user.manage.any`.
   *  Body `{new_password?}`; omit it to have one generated and returned as
   *  `data.temporary_password` (shown ONCE).
   *
   *  SIDE EFFECT THE UI MUST STATE: every session the target holds is ended
   *  (token_version bump + refresh revocation), so they are signed out of every
   *  device. Refuses YOUR OWN account with 400 — that would revoke the session
   *  making the request; use `auth.changePassword()` for that. */
  resetUserPassword: (userId) => `/admin/users/${seg(userId)}/reset-password`,

  /** GET `/admin/scans` — ADDITIVE. Paginated. Params `{page, per_page, severity,
   *  status, review_status, patient, doctor, date_from, date_to}`. Items carry BOTH
   *  the legacy `image_url` and the authenticated `image_endpoint` (null once the
   *  patient deleted the photo) — lib/imageUrl.js prefers image_endpoint. */
  scans: (params) => `/admin/scans${qs(params)}`,

  /** GET `/admin/stats` — [contract #20] `{total_users, total_scans, total_doctors, pending_doctor_verifications}`. */
  stats: () => '/admin/stats',

  /** PATCH `/admin/users/<id>` — ADDITIVE, `user.manage.any`. PARTIAL update:
   *  a key you do not send is left alone, and a key sent as `''` CLEARS that
   *  column. Body `{name?, email?, is_verified?, doctor?:{...}}`.
   *
   *  `role` is REFUSED with a 400, not ignored — an account's role is immutable
   *  here. Verification also stays out: use `verifyDoctor()`, which is the route
   *  that emails the doctor. Editing your OWN row is allowed (unlike reset /
   *  delete); `is_root` targets are always 403. */
  updateUser: (userId) => `/admin/users/${seg(userId)}`,

  /** PATCH `/admin/users/<id>/status` — ADDITIVE. Body `{is_active: bool, reason?}`.
   *  The soft alternative to DELETE /admin/doctors/<id>. 403 on an is_root target,
   *  400 when deactivating yourself. */
  updateUserStatus: (userId) => `/admin/users/${seg(userId)}/status`,

  /** GET `/admin/users` — ADDITIVE. Paginated. Params `{page, per_page, q, role,
   *  is_active, is_root, is_verified}`. Rows carry `is_root` so the UI can lock them. */
  users: (params) => `/admin/users${qs(params)}`,

  /** PUT `/admin/doctors/<id>/verify` — [contract #22] body `{action:'approve'|'reject', note}`. */
  verifyDoctor: (doctorId) => `/admin/doctors/${seg(doctorId)}/verify`,
};

// NOTE ON IMPERSONATION
// ---------------------
// There is no POST "start impersonating" route and there is not meant to be one.
// Delegation is a per-request header: send `X-Act-As-User-Id: <id>` and the
// backend checks actor.act_as, a STRICTLY higher role rank, a non-root target,
// and writes an audit_logs row. lib/api.js injects the header from
// AuthContext.actingAs, so callers never deal with it directly.

// ---------------------------------------------------------------------------
// appointments
// ---------------------------------------------------------------------------

export const appointments = {
  /** POST `/api/book-slot` — [contract #29] body `{patient_id, doctor_id, slot_date, slot_time, scan_id?, appointment_id?}`.
   *  Note the keys are slot_date/slot_time, NOT date/time. Three success shapes: 201 new, 200 rebook, 201 urgent conflict. */
  bookSlot: () => '/api/book-slot',

  /** DELETE `/api/delete-appointment/<id>` — [contract #34] SOFT delete (hidden_from_doctor = true). */
  deleteAppointment: (appointmentId) => `/api/delete-appointment/${seg(appointmentId)}`,

  /** GET `/api/doctor-appointments/<id>` — [contract #31] 17 keys, two-stage priority sort. */
  doctorAppointments: (doctorId) => `/api/doctor-appointments/${seg(doctorId)}`,

  /** GET `/api/patient-appointments/<id>` — [contract #32] 22 keys, date/time emitted twice. */
  patientAppointments: (patientId) => `/api/patient-appointments/${seg(patientId)}`,

  /** POST `/api/patient-appointments/<id>/cancel` — ADDITIVE, PATIENT. Body `{reason?}`.
   *  The patient side had NO cancel at all before this: the two existing mutation
   *  routes check `doctor_id`, so a patient was structurally unable to cancel.
   *  Cancelling one half of a Pending-Conflict pair RELEASES the other (the
   *  survivor goes back to 'Scheduled'); the response carries
   *  `conflict_released_appointment_id`. 400 when already Cancelled or Completed. */
  patientCancel: (appointmentId) => `/api/patient-appointments/${seg(appointmentId)}/cancel`,

  /** POST `/api/patient-appointments/<id>/reschedule` — ADDITIVE, PATIENT.
   *  Body `{slot_date, slot_time, note?}`.
   *  NON-DESTRUCTIVE: the original row is set to 'Cancelled' ("Rescheduled by the
   *  patient.") and a NEW row is inserted, so the response `id` is a NEW
   *  appointment id and `previous_appointment_id` names the old one. Callers MUST
   *  refetch the list rather than patching the row in place, or the old row and
   *  the new one both render as live. 409 when the target slot is taken. */
  patientReschedule: (appointmentId) => `/api/patient-appointments/${seg(appointmentId)}/reschedule`,

  /** POST `/api/appointments/<id>/rebook` — ADDITIVE, PATIENT. Body `{slot_date, slot_time, note?}`.
   *  "Re-appointment an old record": inserts a NEW appointment with the SAME
   *  doctor and the SAME scan, `rebooked_from_id` pointing at `<id>`. The source
   *  row is READ ONLY — history keeps showing what actually happened. 201 with a
   *  NEW appointment id; 409 when the slot is taken. */
  rebook: (appointmentId) => `/api/appointments/${seg(appointmentId)}/rebook`,

  /** PUT `/api/resolve-conflict/<id>` — [contract #30] the URL id is the WINNER. Body `{reason?}`. */
  resolveConflict: (appointmentId) => `/api/resolve-conflict/${seg(appointmentId)}`,

  /** PUT `/api/update-appointment/<id>` — [contract #33] body `{status, reason?}`.
   *  status ∈ Scheduled|Confirmed|Completed|Cancelled only. */
  updateAppointment: (appointmentId) => `/api/update-appointment/${seg(appointmentId)}`,
};

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

// NOTE ON THE TWO AUTH SURFACES
// -----------------------------
// The six LEGACY routes (`/login`, `/register`, `/verify-otp-email`,
// `/resend-otp`, `/forgot-password`, `/reset-password`) are four of the frozen
// 39 plus two siblings; they keep their bare paths and their exact shapes
// forever. The `/auth/*` twin of each is the PURPOSE-SCOPED replacement the
// unified auth screen uses, and is named with a `…Unified` suffix so the pair
// is obvious at the call site. Routes that only exist on the new surface
// (`checkEmail`, `consentDocuments`, `verifyOtp`) get their natural name.
//
// What the new twins add over the legacy six:
//   /auth/login          + refresh_token, + `session` (the /auth/me payload),
//                        403 carries data.next='otp' instead of a bare message
//   /auth/register       nested `doctor` object + `consents[]` in ONE call
//   /auth/verify-otp     `purpose` scoping; purpose='signup' returns a session
//   /auth/resend-otp     cooldown is per-purpose
//   /auth/forgot-password never confirms whether an address exists (always 200)
//   /auth/reset-password  policy always enforced, ends every existing session
export const auth = {
  /** POST — accept a consent document version. TODO(contract): body `{document_id, version}` unconfirmed. */
  acceptConsent: () => '/auth/consents/accept',

  /** POST `/auth/change-password` — body `{current_password, new_password}`.
   *  Verifies the current password (401/400 on a mismatch) and then applies the
   *  same `validate_password` policy as reset.
   *
   *  IT MUST NOT SIGN THE CALLER OUT. The response either says nothing extra
   *  (the token version was left alone) or carries a fresh bundle
   *  `{token, refresh_token, token_type, expires_in}` that the client seats. A
   *  caller therefore reads `data.token` and, when it is there, writes it through
   *  `lib/storage` before rehydrating — never logs out on success. */
  changePassword: () => '/auth/change-password',

  /** POST `/auth/check-email` — ADDITIVE. Body `{email}`.
   *  Returns `{status:'new'|'unverified'|'existing', next:'signup'|'otp'|'password'}`
   *  and NOTHING else — no name, no role. This is what replaces "pick Login or
   *  Register, then pick your role" with one field. Rate limited and timing
   *  padded server-side, so do not poll it per keystroke. */
  checkEmail: () => '/auth/check-email',

  /** GET `/auth/consent-documents?role=Doctor` — ADDITIVE, unauthenticated.
   *  Returns `{documents:[{type, version, title, url_path, mandatory}],
   *  password_policy:{min_length, rules[]}}`. `mandatory` is role-aware:
   *  license_attestation only appears for role='Doctor'. */
  consentDocuments: (params) => `/auth/consent-documents${qs(params)}`,

  /** GET — consent documents the current user still owes. TODO(contract): shape unconfirmed. */
  consents: () => '/auth/consents',

  /** POST `/auth/email-change/cancel` — ADDITIVE, AUTHENTICATED. No body.
   *  Clears `users.pending_email` and consumes any outstanding email_change OTP,
   *  so an abandoned change never leaves a half-finished address on the account. */
  emailChangeCancel: () => '/auth/email-change/cancel',

  /** POST `/auth/email-change/request` — ADDITIVE, AUTHENTICATED.
   *  Body `{new_email, current_password}`. Checks the address is free
   *  (case-insensitive), stores it as `users.pending_email`, and mails an OTP
   *  with purpose 'email_change' TO THE NEW ADDRESS — proving the caller can read
   *  the inbox they are moving to is the entire point of the flow.
   *  → `{pending_email, resend_in_seconds}`. */
  emailChangeRequest: () => '/auth/email-change/request',

  /** POST `/auth/email-change/verify` — ADDITIVE, AUTHENTICATED. Body `{otp}`.
   *  Swaps `pending_email` into `email`, clears it, writes the `auth.email_change`
   *  audit row. → `{email}`. Wrong guesses count toward the same 5 per code as
   *  every other purpose. */
  emailChangeVerify: () => '/auth/email-change/verify',

  /** POST `/forgot-password` — [contract #6] body `{email}`. */
  forgotPassword: () => '/forgot-password',

  /** POST `/auth/forgot-password` — ADDITIVE. Body `{email}`. ALWAYS 200 (never
   *  confirms an address exists); 429 inside the 45s per-purpose cooldown.
   *  Success data `{next:'otp', otp_purpose:'reset', email}`. */
  forgotPasswordUnified: () => '/auth/forgot-password',

  /** POST `/login` — [contract #5] body `{email, password, role}`.
   *  `role` is still ACCEPTED but is now DELIBERATELY IGNORED by the backend —
   *  the stored role is the only authority. Returns `{token, user}`. */
  login: () => '/login',

  /** POST `/auth/login` — ADDITIVE. Body `{email, password}` (`role` ignored).
   *  Returns `{token, refresh_token, token_type, expires_in, session, user}`
   *  where `session` is the whole /auth/me payload. 403 on an unverified email
   *  carries `data:{next:'otp', otp_purpose:'signup', email}`; 403 on a
   *  deactivated account carries no `next`. */
  loginUnified: () => '/auth/login',

  /** POST — revoke the current refresh token. TODO(contract): built in parallel.
   *  The client logs out locally regardless of the response. */
  logout: () => '/auth/logout',

  /** POST — revoke every session (bumps users.token_version). TODO(contract). */
  logoutAll: () => '/auth/logout-all',

  /** GET `/auth/me` — rehydrate the session: user, doctor profile, permissions,
   *  workspaces, pending consents. This is what lets an admin-approved doctor
   *  see their new verification_status without logging out and back in.
   *  TODO(contract): built in parallel; AuthContext tolerates missing keys. */
  me: () => '/auth/me',

  /** POST `/auth/refresh` — exchange the refresh token (httpOnly cookie or body)
   *  for a new access token. TODO(contract): built in parallel.
   *  lib/api.js calls this exactly once per 401 burst (single-flight). */
  refresh: () => '/auth/refresh',

  /** POST `/register` — [contract #2] role is whitelisted server-side to
   *  ('AI User','Doctor'); anything else silently becomes 'AI User'. */
  register: () => '/register',

  /** POST `/auth/register` — ADDITIVE. Body
   *  `{name, email, password, role, doctor:{license, specialty, hospital, city,
   *  phone, experience, latitude, longitude}, consents:[{type, version, granted}]}`.
   *  Same role whitelist as legacy (`'Admin'` is impossible). A missing MANDATORY
   *  consent is a 400 whose `data.missing_consents` names them. Returns 201
   *  `{email, role, next:'otp', otp_purpose:'signup'}` — NO session yet. */
  registerUnified: () => '/auth/register',

  /** POST `/resend-otp` — [contract #4] 429 when inside the 45s cooldown. */
  resendOtp: () => '/resend-otp',

  /** POST `/auth/resend-otp` — ADDITIVE. Body `{email, purpose}` where purpose ∈
   *  'signup'|'reset'|'email_change'. Cooldown is PER PURPOSE, so a signup code
   *  no longer blocks a password reset. 429 message is
   *  'Please wait {n}s before requesting another OTP.' */
  resendOtpUnified: () => '/auth/resend-otp',

  /** POST `/reset-password` — [contract #7] body `{email, otp, new_password}`.
   *  Side effect: also sets is_verified = true. */
  resetPassword: () => '/reset-password',

  /** POST `/auth/reset-password` — ADDITIVE. Body `{email, otp, new_password}`.
   *  CONSUMES the 'reset' code, applies the password policy unconditionally and
   *  ends every existing session (token_version bump + refresh revocation). */
  resetPasswordUnified: () => '/auth/reset-password',

  /** DELETE — revoke one refresh token by id. TODO(contract). */
  revokeSession: (sessionId) => `/auth/sessions/${seg(sessionId)}`,

  /** GET — list active refresh tokens / devices. TODO(contract). */
  sessions: () => '/auth/sessions',

  /** POST `/auth/verify-otp` — ADDITIVE. Body `{email, otp, purpose}`.
   *  purpose='signup' CONSUMES the code, verifies the account and returns a full
   *  session bundle (`{token, refresh_token, session, user}`) — no second login
   *  round-trip. purpose='reset' only VALIDATES (the code must stay live for
   *  /auth/reset-password) and returns `{next:'new_password'}`. Wrong guesses
   *  count toward 5 per code either way. */
  verifyOtp: () => '/auth/verify-otp',

  /** POST `/verify-otp-email` — [contract #3] body `{email, otp}`. */
  verifyOtpEmail: () => '/verify-otp-email',
};

// ---------------------------------------------------------------------------
// chat
// ---------------------------------------------------------------------------

export const chat = {
  /** POST `/api/chat` — [contract #35] body `{message}`; token OPTIONAL.
   *  Anonymous callers get the 'Guest' system prompt. */
  send: () => '/api/chat',
};

// ---------------------------------------------------------------------------
// doctors
// ---------------------------------------------------------------------------

export const doctors = {
  /** GET | POST `/api/doctor/profile` — [contract #39] ONE path, two methods.
   *  POST is multipart/form-data (NOT JSON) and only applies truthy fields. */
  profile: () => '/api/doctor/profile',

  /** GET `/api/doctors` — [contract #17] byte-identical to publicList(); the
   *  backend literally calls the same function. */
  list: () => '/api/doctors',

  /** GET `/api/doctors/public` — [contract #16] doctors WITHOUT a DoctorProfile
   *  row are omitted; 'rejected' profiles are omitted; 'pending' ARE listed. */
  publicList: () => '/api/doctors/public',

  /** GET `/api/doctors/<id>/photo` — ADDITIVE, DELIBERATELY UNAUTHENTICATED.
   *  A professional headshot on a public directory, unlike a scan image, so it
   *  is safe in a plain `<img src>`. 404 (not 403) when there is no photo.
   *  The directory payload already carries this path as `photo_endpoint`;
   *  prefer that field and use this builder only when you have just an id. */
  photo: (doctorId) => `/api/doctors/${seg(doctorId)}/photo`,
};

// ---------------------------------------------------------------------------
// media
// ---------------------------------------------------------------------------

export const media = {
  /** GET — the future privacy-gated scan image route (thumb/full variants,
   *  every view written to image_access_log).
   *  TODO(contract): not live yet. lib/imageUrl.js prefers a server-supplied
   *  `image_endpoint` field over this builder. */
  scanImage: (scanId, params) => `/api/scans/${seg(scanId)}/image${qs(params)}`,

  /** GET `/static/uploads/<filename>` — [contract #1] PUBLIC, no auth, world-readable. */
  upload: (filename) => `/static/uploads/${String(filename).split('/').map(seg).join('/')}`,
};

// ---------------------------------------------------------------------------
// profile — the signed-in user's own account, whatever their role
// ---------------------------------------------------------------------------

// NOTE ON THE TWO PROFILE SURFACES
// --------------------------------
// `/api/profile` is the SELF surface: any authenticated role reads and edits
// their own account through it, and the id comes from the JWT. It is not a
// replacement for `doctors.profile()` — that route still owns the public
// headshot (`profile_image`), which is served unauthenticated from
// `/api/doctors/<id>/photo` and is a different picture from the account avatar.
// `email` and `role` are REJECTED with a 400 on the PATCH: the address has its
// own OTP flow (`auth.emailChangeRequest()`) and a role is not self-service.
export const profile = {
  /** POST | DELETE `/api/profile/avatar` — ADDITIVE, one path, two methods.
   *  POST is multipart/form-data with the field name `avatar` (NOT `image`,
   *  NOT `profile_image`) → `{avatar_url, avatar_endpoint}`. The server validates
   *  the extension against {png,jpg,jpeg,webp}, refuses anything over 5 MB and
   *  downscales to a 512px square. DELETE → `{avatar_url: null}`.
   *  `lib/imageFile.js` mirrors the type and size rules so the client can refuse
   *  a bad pick before spending the upload. */
  avatar: () => '/api/profile/avatar',

  /** GET | PATCH `/api/profile` — ADDITIVE, any authenticated role.
   *
   *  GET → `{id, name, email, role, phone, city, date_of_birth ('YYYY-MM-DD'|null),
   *  gender, avatar_url, avatar_endpoint, is_verified, created_at, pending_email,
   *  doctor:{...}|null}` where `doctor` is present only for a doctor and carries
   *  specialty, hospital, city, phone, experience, license, latitude, longitude,
   *  state, country, profile_image, verification_status, verification_note,
   *  fees_pkr.
   *
   *  PATCH is PARTIAL: `{name?, phone?, city?, date_of_birth?, gender?,
   *  doctor?:{specialty?, hospital?, city?, phone?, experience?, latitude?,
   *  longitude?, state?, country?}}`, and returns the same shape as GET.
   *
   *  AN EMPTY STRING CLEARS the field — the OPPOSITE of the legacy
   *  `POST /api/doctor/profile`, which only ever applied truthy values and so
   *  could not blank anything. A form built for that route must not be pointed at
   *  this one without re-reading what "I deleted the contents of this box" means.
   *  `email` and `role` are 400s here. */
  me: () => '/api/profile',
};

// ---------------------------------------------------------------------------
// ratings
// ---------------------------------------------------------------------------

export const ratings = {
  /** GET `/api/doctor/ratings` — [contract #37] SELF, id from JWT.
   *  Wrapper keys are `average` / `total` / `reviews`. */
  mine: () => '/api/doctor/ratings',

  /** GET `/doctor/ratings/<id>` — [contract #38] PUBLIC, id from URL.
   *  Same review list, DIFFERENT wrapper keys: `average_rating` / `rating_count`. */
  publicForDoctor: (doctorId) => `/doctor/ratings/${seg(doctorId)}`,

  /** POST `/api/rate-doctor` — [contract #36] body `{doctor_id, rating, scan_id?, appointment_id?, review?}`.
   *  patient_id comes from the JWT and is ignored in the body. */
  rate: () => '/api/rate-doctor',
};

// ---------------------------------------------------------------------------
// requests — the multi-doctor consultation request (replaces /send_report)
// ---------------------------------------------------------------------------

export const requests = {
  /** POST `/api/appointment-requests/<id>/accept` — ADDITIVE, DOCTOR.
   *  Body `{slot_id}`. Accepting one doctor's slot closes the request for the rest. */
  accept: (requestId) => `/api/appointment-requests/${seg(requestId)}/accept`,

  /** POST `/api/appointment-requests/<id>/cancel` — ADDITIVE, PATIENT. Body `{reason?}`. */
  cancel: (requestId) => `/api/appointment-requests/${seg(requestId)}/cancel`,

  /** POST `/api/appointment-requests` — ADDITIVE. Body
   *  `{scan_id, doctor_ids[1..3], preferred_slots[{slot_date, slot_time, doctor_id?, rank}][1..5],
   *    answers|null, patient_note, express, consent_share_scan}`.
   *  `answers` is DELIBERATELY nullable: the six symptom booleans are optional and
   *  "skipped" is not the same input as "answered no to all six". */
  create: () => '/api/appointment-requests',

  /** POST `/api/appointment-requests/<id>/decline` — ADDITIVE, DOCTOR. Body `{reason}`. */
  decline: (requestId) => `/api/appointment-requests/${seg(requestId)}/decline`,

  /** GET `/api/doctor/appointment-requests` — ADDITIVE. The doctor's inbox; id from the JWT. */
  forDoctor: (params) => `/api/doctor/appointment-requests${qs(params)}`,

  /** GET `/api/appointment-requests/<id>` — ADDITIVE. One request with its slots and replies. */
  get: (requestId) => `/api/appointment-requests/${seg(requestId)}`,

  /** GET `/api/appointment-requests` — ADDITIVE. The patient's own requests. */
  list: (params) => `/api/appointment-requests${qs(params)}`,

  /** PATCH `/api/appointment-requests/<id>` — ADDITIVE, PATIENT. PARTIAL update
   *  of a request nobody has answered yet. Body
   *  `{preferred_slots?[1..5], patient_note?, express?, consent_share_scan?, answers?}`;
   *  a key you do not send is left alone.
   *
   *  `preferred_slots` REPLACES the whole list — `rank` orders the entire array,
   *  so a merge would leave two slots claiming the same position. Every slot is
   *  re-validated by `normalize_slots`, which means a time that has passed since
   *  the request was sent is a 400 (the caller must drop stale picks first).
   *
   *  The invited DOCTORS are deliberately not editable: changing who you ask is a
   *  new request, which is what `create()` is for. 409 unless the request is
   *  still Open and unexpired. Sending `answers` re-runs triage and can move the
   *  severity, the express lane and `expires_at`, so only send it when the
   *  patient actually touched those controls. Response is the full request plus
   *  `changed[]` (empty when nothing differed). */
  update: (requestId) => `/api/appointment-requests/${seg(requestId)}`,
};

// ---------------------------------------------------------------------------
// scans
// ---------------------------------------------------------------------------

export const scans = {
  /** GET `/api/scans/<id>/access-log` — ADDITIVE. Owner or Admin.
   *  Returns `[{id, viewer_id, viewer_name, viewer_role, variant, attachment_id,
   *  ip, viewed_at}]`. ONLY `variant='full'` views are written here — `thumb`
   *  and `blur` deliberately are not, so this list answers "who has actually
   *  seen this person's skin", not "who loaded the page". */
  accessLog: (scanId) => `/api/scans/${seg(scanId)}/access-log`,

  /** GET `/api/scans/<id>/attachments` — ADDITIVE. Same `can_view` predicate as
   *  the image route. Returns `data: [attachment]`. */
  attachments: (scanId) => `/api/scans/${seg(scanId)}/attachments`,

  /** POST `/api/scans/<id>/attachments` — TODO(contract): **NOT LIVE YET**.
   *  Multipart `image` (+ optional `caption`), one file per call, for the extra
   *  context photos the consult stepper's Details step collects.
   *
   *  Why it is here at all: `scan_attachments` exists as a table, is READ by
   *  `attachments()` / `attachmentImage()`, and is purged by
   *  `DELETE /api/scans/<id>/image` — but nothing in the backend inserts a row,
   *  so today this path answers 404/405. The consult flow therefore treats every
   *  attachment upload as BEST EFFORT: a failure is reported to the patient
   *  ("bring them to the appointment") and NEVER blocks
   *  `requests.create()`, which is the call that actually matters.
   *  Confirm the field names against docs/api-contract.md before relying on it. */
  createAttachment: (scanId) => `/api/scans/${seg(scanId)}/attachments`,

  /** DELETE `/doctor/delete_scan/<id>` — [contract #13]. */
  delete: (scanId) => `/doctor/delete_scan/${seg(scanId)}`,

  /** DELETE `/api/scans/<id>/image` — ADDITIVE. Body
   *  `{reason, consent_ack:true, confirm_text:'DELETE'}`. Purges the FILE ONLY:
   *  the row and every clinical field survive, so a doctor's existing comment and
   *  the audit trail are not rewritten by a patient exercising erasure. */
  deleteImage: (scanId) => `/api/scans/${seg(scanId)}/image`,

  /** GET `/api/scans/<id>/image?variant=thumb|blur|full` — ADDITIVE, AUTHENTICATED.
   *  A scan flagged `is_sensitive` serves the BLURRED placeholder unless
   *  `variant=full` is asked for explicitly, and that request is audit-logged. */
  image: (scanId, params) => `/api/scans/${seg(scanId)}/image${qs(params)}`,

  /** GET `/doctor/scans/<id>` — [contract #15] params `{search, status, sort, page, limit}`.
   *  Pagination applies ONLY when both page and limit parse as ints. */
  forDoctor: (doctorId, params) => `/doctor/scans/${seg(doctorId)}${qs(params)}`,

  /** GET `/patient/scans/<id>` — [contract #14] 18 keys; image_url is '/'-prefixed. */
  forPatient: (userId) => `/patient/scans/${seg(userId)}`,

  /** POST `/api/override-severity/<id>` — [contract #11] body `{severity, reason}`. */
  overrideSeverity: (scanId) => `/api/override-severity/${seg(scanId)}`,

  /** POST `/predict` — [contract #8] multipart: `image` file + `user_id` form field,
   *  plus the ADDITIVE `is_sensitive` flag ('true'/'false' — multipart fields are
   *  strings). Returned image_url has NO leading slash here (every listing route
   *  adds one). Anonymous callers may omit `user_id`. */
  predict: () => '/predict',

  /** POST `/api/scans/claim` — adopt this browser's pre-sign-up scans.
   *  Body `{guest_token}`. Idempotent: a claimed row returns its existing id. */
  claimGuest: () => '/api/scans/claim',

  /** GET `/api/scans/<id>/report-status` — [contract #10] `{report_sent: bool}`.
   *  The backend is the source of truth for the "already sent" lock. */
  reportStatus: (scanId) => `/api/scans/${seg(scanId)}/report-status`,

  /** POST `/send_report` — [contract #9] body `{scan_id, doctor_id, answers}`.
   *  LEGACY: one scan to exactly ONE doctor, and the old flow FORCED it before a
   *  slot could be booked. The consult stepper uses `requests.create()` instead. */
  sendReport: () => '/send_report',

  /** PATCH `/api/scans/<id>/sensitivity` — ADDITIVE. Body `{is_sensitive, reason}`.
   *  Flips which variant `scans.image()` serves to everyone but the owner. */
  sensitivity: (scanId) => `/api/scans/${seg(scanId)}/sensitivity`,

  /** PUT `/doctor/update_scan/<id>` — [contract #12] body `{comment, invite_to_clinic}`.
   *  ENVELOPE-BREAKER: returns a FLAT dict, scan fields at the top level next to
   *  a decorative `success`/`message` and an empty `data:{}`. lib/api.js
   *  normalises this — never read `.data` from this response. */
  update: (scanId) => `/doctor/update_scan/${seg(scanId)}`,
};

// ---------------------------------------------------------------------------
// schedule
// ---------------------------------------------------------------------------

export const schedule = {
  /** GET `/api/doctor-availability/<id>` — [contract #25] PUBLIC. Day order is
   *  NOT Mon→Sun; always `.find()` by day name. */
  availability: (doctorId) => `/api/doctor-availability/${seg(doctorId)}`,

  /** GET `/api/doctor-fees/<id>` — [contract #27] PUBLIC. No row ⇒ 200 with
   *  `{pkr:0, usd:0, duration:'30min', buffer_time:0}` — never a 404. */
  fees: (doctorId) => `/api/doctor-fees/${seg(doctorId)}`,

  /** GET `/api/slots/<id>?date=YYYY-MM-DD` — [contract #28] PUBLIC.
   *  ENVELOPE-BREAKER: success is a BARE ARRAY, errors use the envelope.
   *  lib/api.js normalises both. `date` is REQUIRED (400 without it). */
  slots: (doctorId, date) => `/api/slots/${seg(doctorId)}${qs({ date })}`,

  /** GET `/api/slots/multi?doctor_ids=1,2,3&date=YYYY-MM-DD` — ADDITIVE.
   *  ENVELOPED (unlike its single-doctor sibling): `{by_doctor: {"1": [...], ...}}`.
   *  One round trip for the "offer up to 5 times across up to 3 doctors" picker.
   *  `doctorIds` is joined with commas here so no caller templates the list. */
  slotsMulti: (doctorIds, date) => `/api/slots/multi${qs({
    doctor_ids: (Array.isArray(doctorIds) ? doctorIds : [doctorIds])
      .filter((id) => id !== null && id !== undefined && id !== '')
      .join(','),
    date,
  })}`,

  /** POST `/api/update-availability` — [contract #24] body `{doctor_id, schedule, confirm_override?}`.
   *  The ONLY success:false response in the API that carries `data` (409 conflicts). */
  updateAvailability: () => '/api/update-availability',

  /** POST `/api/update-fees` — [contract #26] body `{doctor_id|user_id, pkr, usd, duration, buffer_time}`.
   *  The id is compared with `int != int`, so a string id 403s. Send a number. */
  updateFees: () => '/api/update-fees',
};

// ---------------------------------------------------------------------------
// streams (SSE)
// ---------------------------------------------------------------------------

export const streams = {
  /** GET `/api/doctor-updates-stream/<id>?ticket=` — [contract #18] text/event-stream.
   *  Legacy unauthenticated mode is still accepted by the backend; pass a ticket. */
  doctorUpdates: (doctorId, ticket) => `/api/doctor-updates-stream/${seg(doctorId)}${qs({ ticket })}`,

  /** GET `/api/patient-updates-stream/<id>?ticket=` — [contract #19] text/event-stream. */
  patientUpdates: (patientId, ticket) => `/api/patient-updates-stream/${seg(patientId)}${qs({ ticket })}`,

  /** POST `/api/stream-ticket` — ADDITIVE (not one of the 39). Bearer-authed.
   *  Returns `{ticket, expires_in, user_id}`; TTL is 60s by default. */
  ticket: () => '/api/stream-ticket',
};

// ---------------------------------------------------------------------------
// system
// ---------------------------------------------------------------------------

export const system = {
  /** GET `/healthz` — liveness. Additive health blueprint, not one of the 39. */
  health: () => '/healthz',
  /** GET `/readyz` — readiness (DB reachable). */
  ready: () => '/readyz',
};

// ---------------------------------------------------------------------------
// triage
// ---------------------------------------------------------------------------

export const triage = {
  /** POST `/api/triage-preview` — ADDITIVE. Body `{disease, confidence, answers}`
   *  where `answers` is the six symptom booleans (or null / omitted when the user
   *  skipped them). Returns `{severity, triage_score, triage_reasons, is_emergency}`.
   *
   *  READ-ONLY BY DESIGN: it scores a candidate scan WITHOUT writing anything, so
   *  the stepper can show the severity before the patient has committed to
   *  sending it to anybody. This is what lets "emergency" stop being a dead end
   *  that had to be discovered after a report was already dispatched. */
  preview: () => '/api/triage-preview',
};

const endpoints = {
  admin,
  appointments,
  auth,
  chat,
  doctors,
  media,
  profile,
  qs,
  ratings,
  requests,
  scans,
  schedule,
  streams,
  system,
  triage,
};

export default endpoints;
