# AI Dermatologist — Backend API Contract

**Source of truth:** `app.py` (3296 lines, 39 `@app.route` declarations) as of this document.
**Purpose:** frozen reference for the monolith → blueprint refactor. Every path, method, status code and
JSON key below must survive the refactor **byte-identical**. The existing React frontend gets zero changes.

**Verified route count: 39.** Blueprint distribution confirmed exactly as planned:

| Blueprint | Routes | URL prefix (none is enforced today — do NOT add one) |
|---|---|---|
| `auth` | 6 | `/register`, `/login`, `/verify-otp-email`, `/resend-otp`, `/forgot-password`, `/reset-password` |
| `scans` | 8 | `/predict`, `/send_report`, `/api/scans/...`, `/api/override-severity/...`, `/doctor/update_scan/...`, `/doctor/delete_scan/...`, `/patient/scans/...`, `/doctor/scans/...` |
| `doctors` | 3 | `/api/doctors/public`, `/api/doctors`, `/api/doctor/profile` |
| `ratings` | 3 | `/api/rate-doctor`, `/api/doctor/ratings`, `/doctor/ratings/<id>` |
| `schedule` | 5 | `/api/update-availability`, `/api/doctor-availability/<id>`, `/api/update-fees`, `/api/doctor-fees/<id>`, `/api/slots/<id>` |
| `appointments` | 6 | `/api/book-slot`, `/api/resolve-conflict/<id>`, `/api/doctor-appointments/<id>`, `/api/patient-appointments/<id>`, `/api/update-appointment/<id>`, `/api/delete-appointment/<id>` |
| `admin` | 4 | `/admin/stats`, `/admin/doctors`, `/admin/doctors/<id>/verify`, `/admin/doctors/<id>` |
| `streams` | 2 | `/api/doctor-updates-stream/<id>`, `/api/patient-updates-stream/<id>` |
| `chat` | 1 | `/api/chat` |
| `media` | 1 | `/static/uploads/<path:filename>` |
| **Total** | **39** | |

The URL paths are irregular by design (mixed `/api/...`, `/doctor/...`, `/admin/...`, bare `/predict`).
Blueprints must be registered **without** `url_prefix`, or with a prefix that reproduces the exact string.

> **Routes added after this document was frozen** are additive and live in their own sections. They never
> change a path, decorator or response shape listed above. So far: **§7b** — six new `admin` console routes
> (`/admin/patients`, `/admin/users`, `/admin/scans`, `/admin/appointments`, `/admin/audit-log`,
> `PATCH /admin/users/<id>/status`) and **§7c** — four account-CRUD routes (`POST /admin/users`,
> `PATCH /admin/users/<id>`, `POST /admin/users/<id>/reset-password`, `DELETE /admin/users/<id>`).
> The frozen count stays **39**.

---

## The response envelope

`generate_response(success, message="", error="", data=None, status_code=200)` — `app.py:54-63`.

```python
res = {"success": success}
if message: res["message"] = message      # falsy ("" / None) => key OMITTED
if error:   res["error"] = error          # falsy => key OMITTED
if data is not None: res["data"] = data   # [] and {} ARE included; None is omitted
return jsonify(res), status_code
```

Consequences the port must preserve:

- `message` and `error` keys are **absent**, not null, when empty.
- `data` **is** emitted when it is `[]` or `{}` (the check is `is not None`, not truthiness).
- A `success: false` response can still carry `data` — `/api/update-availability` 409 does exactly that.
- Flask 3.1.3 with default `app.json.sort_keys = True` ⇒ **keys serialize alphabetically**. Do not
  swap the JSON provider (orjson etc.) or flip `sort_keys`; byte output would change.

**There are no `@app.errorhandler` registrations.** 404 / 405 / 413 (`MAX_CONTENT_LENGTH` = 10 MB) / unhandled
500 all return Flask's default **HTML** error pages, not the envelope. Adding error handlers during the
refactor would be a behavior change — don't.

## Decorators

| Decorator | Lines | Behavior | Failure responses |
|---|---|---|---|
| `token_required` | 99-115 | decodes JWT, sets `request.current_user` | 401 `Token is missing! Unauthorized access.` / `Session expired! Please login again.` / `Invalid Token!` |
| `token_optional` | 117-129 | sets `request.current_user = None` then overwrites if a valid token is present; **never rejects** | none |
| `admin_required` | 131-150 | requires `role == 'Admin'` | 401 as above, 403 `Access denied! Only Admins allowed.` |
| `doctor_required` | 152-171 | requires `role == 'Doctor'` | 401 as above, 403 `Access denied! Only Doctors allowed.` |
| `patient_required` | 173-192 | requires `role in ['AI User', 'Patient']` | 401 as above, 403 `Access denied! Only Patients allowed.` |

`token_required` is defined but **never applied to any route**. JWT payload is exactly
`{'user_id': int, 'role': str, 'exp': int}`, HS256, 24 h (`app.py:472-476`). Role literals in DB and JWT are
`'Admin'`, `'Doctor'`, `'AI User'` — never rename. `patient_required` additionally tolerates a legacy
`'Patient'` literal that nothing writes today; keep the tolerance.

---

## 1. `auth` — 6 routes

| Path | Methods | Decorator | Lines | Request | Success response |
|---|---|---|---|---|---|
| `/register` | POST | none | 263-356 | JSON: `name`\*, `email`\*, `password`\*, `role`, `license`, `specialty`, `hospital`, `city`, `phone`, `latitude`, `longitude` | **201** `{"success":true,"message":"OTP sent to email"}` |
| `/verify-otp-email` | POST | none | 358-394 | JSON: `email`\*, `otp`\* | **200** `{"success":true,"message":"Email verified successfully"}` |
| `/resend-otp` | POST | none | 398-453 | JSON: `email`\* | **200** `{"success":true,"message":"A new OTP has been sent to your email."}` |
| `/login` | POST | none | 455-506 | JSON: `email`\*, `password`\*, `role`\* | **200** `{"success":true,"data":{"token":"<jwt>","user":{…}}}` |
| `/forgot-password` | POST | none | 508-546 | JSON: `email`\* | **200** `{"success":true,"message":"Password reset OTP sent to your email."}` |
| `/reset-password` | POST | none | 548-594 | JSON: `email`\*, `otp`\*, `new_password`\* | **200** `{"success":true,"message":"Password updated successfully!"}` |

### `/login` response body (exact)

```json
{
  "success": true,
  "data": {
    "token": "<HS256 JWT>",
    "user": {
      "id": 1,
      "name": "…",
      "email": "…",
      "role": "AI User",
      "joined_at": "Jan 2024",
      "verification_status": "approved"
    }
  }
}
```

- `joined_at` = `user.created_at.strftime("%b %Y")`, fallback literal `"Jan 2024"` when `created_at` is NULL.
- `verification_status` is present **only** when `user.role == 'Doctor'` (`app.py:490-492`); falls back to
  `'pending'` when the doctor has no `DoctorProfile` row.
- `role` in the request body must **equal** the stored role exactly, or the response is
  **401** `{"success":false,"error":"Invalid credentials"}` — the frontend login form sends the role the
  user picked. Unverified account ⇒ **403** `Please verify your email first`.

### `/register` details

- `role` is whitelisted server-side to `('AI User', 'Doctor')`; anything else (including `'Admin'`) is
  silently coerced to `'AI User'` and logged. Admins can never be created via this route.
- `license` is required only when the final role is `Doctor`; missing ⇒ 400
  `PMDC license number is required for doctor registration`, duplicate ⇒ 400
  `This license number is already registered.`
- The whole thing is one transaction: `db.flush()` for both rows, OTP email sent, **then** a single
  `db.commit()`. Email failure ⇒ `db.rollback()` + 500. Preserve this ordering.
- Doctor profiles are created with `verification_status='pending'`.

### OTP mechanics (shared, `app.py:234-261`, `396`)

`OTP_EXPIRY_MINUTES = 10`, `OTP_MAX_ATTEMPTS = 5`, `OTP_RESEND_COOLDOWN_SECONDS = 45`.
`_is_otp_valid()` returns `(bool, error_message)`; the caller increments `otp_attempts` only when
`user.otp_code` is set. Cooldown violation on `/resend-otp` ⇒ **429**
`Please wait {n}s before requesting another OTP.` (`n` is an int, string-interpolated).
`/reset-password` sets `is_verified = True` as a side effect — that is deliberate (rescues stuck accounts).

---

## 2. `scans` — 8 routes

| Path | Methods | Decorator | Lines | Request | Success response |
|---|---|---|---|---|---|
| `/predict` | POST | `@patient_required` | 600-669 | multipart: `files['image']`\*, `form['user_id']` | **201** `{"success":true,"data":{"scan_id","disease","confidence","image_url"}}` |
| `/send_report` | POST | `@patient_required` | 754-842 | JSON: `scan_id`\*, `doctor_id`\*, `answers` | **200** `{"success":true,"message":"Report evaluated and sent.","data":{…}}` |
| `/api/scans/<int:scan_id>/report-status` | GET | `@patient_required` | 857-876 | — | **200** `{"success":true,"data":{"report_sent":bool}}` |
| `/api/override-severity/<int:scan_id>` | POST | `@doctor_required` | 882-916 | JSON: `severity`\*, `reason`\* | **200** `{"success":true,"message":"Severity updated.","data":{"severity_level","override_reason"}}` |
| `/doctor/update_scan/<int:scan_id>` | PUT | `@doctor_required` | 922-987 | JSON: `comment` \| `doctor_comment`, `invite_to_clinic` | **200 FLAT DICT — no envelope** (see Gotchas) |
| `/doctor/delete_scan/<int:scan_id>` | DELETE | `@doctor_required` | 993-1030 | — | **200** `{"success":true,"message":"Scan deleted from history"}` |
| `/patient/scans/<int:user_id>` | GET | `@patient_required` | 1036-1094 | — | **200** `{"success":true,"data":[…]}` |
| `/doctor/scans/<int:doctor_id>` | GET | `@doctor_required` | 1096-1175 | query: `search`, `status`, `sort`, `page`, `limit` | **200** `{"success":true,"data":[…]}` |

### `/predict`

```json
{"success": true,
 "data": {"scan_id": 42, "disease": "2. Melanoma", "confidence": 87.34,
          "image_url": "static/uploads/scan_<uuid4hex>_<secure_filename>"}}
```

- `image_url` has **no leading slash** here. Every *listing* endpoint returns `"/" + scan.image_url`.
  Both forms must be preserved (the frontend normalizes with `getSafeImageUrl`).
- Allowed extensions `{png, jpg, jpeg, webp}`; filename `scan_{uuid4().hex}_{secure_filename(name)}`.
- `user_id` arrives as a **form string**; `"null"`, `"undefined"`, `""` (case-insensitive) are treated as
  absent → scan saved with `user_id = None`. Non-numeric otherwise ⇒ 400 `Invalid user ID format`.
  A mismatch against `request.current_user['user_id']` ⇒ 403 `Unauthorized user ID mismatch`.
  **Note:** the file is written to disk and the model runs *before* any of these validations, so a
  rejected request still leaves an upload on disk. Preserve the ordering; don't "fix" it in the port.
- Confidence normalization (`app.py:622-630`): `>100` ⇒ `/100`; `0 < v <= 1.0` ⇒ `*100`; clamped 0-100,
  rounded to 2 dp; any `ValueError/TypeError` ⇒ `0.0`. Stored in `ai_scans.confidence` on a **0-100** scale.

### `/send_report`

Request `answers` is the questionnaire object; the six recognized keys (`TriageService.SYMPTOM_WEIGHTS`,
`app.py:695-702`) are `is_bleeding` (3), `growing_fast` (3), `has_severe_pain` (2), `irregular_border` (2),
`color_change` (2), `diameter_over_6mm` (1). Score ≥ 5 ⇒ symptom tier `URGENT`.

```json
{"success": true, "message": "Report evaluated and sent.",
 "data": {"is_urgent": true, "severity_level": "URGENT", "triage_score": 6,
          "triage_reasons": ["Patient reported: is bleeding, growing fast"],
          "duration": "immediately (within 2-4 hours)"}}
```

`duration` is one of exactly two literals: `"immediately (within 2-4 hours)"` or `"within 24-48 hours"`.
Side effects: sets `scan.doctor_id`, `patient_questionnaire` (JSON string), `severity_level`,
`triage_score`, `triage_reasons` (JSON string), `status = "Pending"`.

### `/patient/scans/<user_id>` — array element (18 keys, exact order in source)

`id`, `scan_id`, `patient_id`, `disease`, `confidence`, `status`, `review_status`, `doctor_comment`,
`invite_to_clinic`, `severity`, `doctor_id`, `doctor_name`, `doctor_email`, `image_url`, `created_at`,
`updated_at`, `patient_rating`, `patient_review`.

- `disease` = `prediction_result`; `severity` = `severity_level or "ROUTINE"`.
- `doctor_name` falls back to `scan.doctor_name or "N/A"`, `doctor_email` to `scan.doctor_email or ""`,
  then both are overwritten from the live `User` row when `doctor_id` resolves.
- `image_url` = `"/" + scan.image_url` or `""`.
- timestamps are `.isoformat()` or `null`.
- Ratings are scoped to `patient_id == user_id`.

### `/doctor/scans/<doctor_id>` — array element (18 keys)

`id`, `scan_id`, `doctor_id`, `patient_id`, `patient_name`, `patient_email`, `disease`, `confidence`,
`status`, `review_status`, `doctor_comment`, `questionnaire_answers`, `invite_to_clinic`, `image_url`,
`created_at`, `updated_at`, `patient_rating`, `patient_review`.

- `patient_name` fallback `"Unknown"`, `patient_email` fallback `null`.
- `questionnaire_answers` is `json.loads(scan.patient_questionnaire)` — a **parsed object**, or `null`
  when absent/unparseable (bare `except Exception: pass`).
- Query params: `search` ⇒ `ILIKE %search%` on `prediction_result`; `status` ⇒ exact match on
  `AIScan.status`; `sort=asc` ⇒ `id ASC`, anything else ⇒ `id DESC`; pagination applies **only when both**
  `page` and `limit` parse as ints (`offset((page-1)*limit).limit(limit)`). Ratings here are **not**
  scoped to a patient (unlike the patient listing).

---

## 3. `doctors` — 3 routes

| Path | Methods | Decorator | Lines | Request | Success response |
|---|---|---|---|---|---|
| `/api/doctors/public` | GET | none | 1181-1270 | — | **200** `{"success":true,"data":[…]}` |
| `/api/doctors` | GET | none | 1272-1274 | — | identical to `/api/doctors/public` |
| `/api/doctor/profile` | GET, POST | `@doctor_required` | 3162-3285 | GET: — / POST: multipart form | see below |

### `/api/doctors/public` — array element

```json
{"id":1,"name":"…","email":"…","specialty":"Skin Specialist","specialization":"Skin Specialist",
 "hospital":null,"city":"N/A","latitude":null,"longitude":null,"phone":null,
 "rating":4.5,"average_rating":4.5,"total_reviews":12,
 "fees":{"pkr":2000.0,"usd":10.0,"duration":"30min","buffer_time":0},
 "schedule":[{"day":"Monday","start":"09:00","end":"17:00","available":true}],
 "experience":0,"profile_image":"/static/uploads/doc_1_….jpg","verification_status":"pending"}
```

- `specialty` and `specialization` are **both** emitted with the same value (fallback
  `"Skin Specialist"`); `city` falls back to the literal `"N/A"`; `hospital` and `phone` fall back to
  `null` (deliberate — no fake data). `profile_image` is `"/" + profile.profile_image` or `null`.
- `rating` / `average_rating` are `null` when the doctor has no ratings (deliberate — frontend shows a
  "New" badge). `fees.pkr` / `fees.usd` are `null` when no `DoctorFees` row exists, while `duration`
  defaults to `"30min"` and `buffer_time` to `0`. `schedule` is `null` (not `[]`) when empty.
- Doctors **without a `DoctorProfile` row are skipped entirely** (`continue`, line 1210-1211), as are
  profiles with `verification_status == 'rejected'`. `pending` doctors are still listed.

`/api/doctors` is a plain Python call — `return get_public_doctors()` — not a redirect and not a second
query. In the blueprint port, keep it as a function call so the two responses can never diverge.

### `/api/doctor/profile`

**GET** → `{"success":true,"data":{ "name","email","specialty","hospital","city","phone","experience",
"license","profile_image","fees_pkr","verification_status","verification_note" }}`.
String fields default to `''` (not null), `experience` and `fees_pkr` to `0`,
`verification_status` to `'pending'`, `profile_image` to `null` and is prefixed with `/` when it isn't already.

**POST** reads **`request.form`** (multipart, not JSON): `name`, `email`, `specialty` **or**
`specialization`, `hospital`, `city`, `phone`, `experience`, `license`; plus `request.files['profile_image']`.
Response **200** `{"success":true,"message":"Profile updated successfully!"}`.

- Every field is applied only when truthy — you cannot blank a field through this endpoint.
- Email change is duplicate-checked ⇒ 400 `This email is already registered with another account.`
- A **changed** license resets `verification_status='pending'` and clears `verification_note`,
  `verified_at`, `verified_by`; duplicate license ⇒ 400
  `This license number is already registered with another account.`
- Uploaded image is saved as `doc_{doctor_id}_{YYYYmmdd_HHMMSS}_{secure_filename}` and stored as
  `static/uploads/<name>` (no leading slash in DB).
- Two HTTP methods share one view function and one `SessionLocal()`; if the port splits GET and POST into
  separate handlers the URL rule must still advertise `methods=['GET','POST']` for the same path.

---

## 4. `ratings` — 3 routes

| Path | Methods | Decorator | Lines | Request | Success response |
|---|---|---|---|---|---|
| `/api/rate-doctor` | POST | `@patient_required` | 3018-3077 | JSON: `doctor_id`\*, `rating`\*, `scan_id`, `appointment_id`, `review` | **200** `{"success":true,"message":"Rating successfully submitted."}` or `"Rating successfully updated."` |
| `/api/doctor/ratings` | GET | `@doctor_required` | 3079-3118 | — | **200** `{"success":true,"data":{"average","total","reviews":[…]}}` |
| `/doctor/ratings/<int:doctor_id>` | GET | none | 3120-3156 | — | **200** `{"success":true,"data":{"average_rating","rating_count","reviews":[…]}}` |

- `patient_id` is taken from the JWT, **never** from the body.
- `rating` is `float()`-cast and range-checked 1-5 (400 `Rating must be between 1 and 5`); the DB column is
  `Integer`, so a fractional value is silently **rounded** on write — Postgres rounds half away from zero,
  so 4.5 lands as `5` and 3.5 as `4` (verified against `ai_derma_db`; an earlier revision of this document
  said "truncated to 4", which is wrong). Behaviour is unchanged from the monolith — same code, same column.
  `review` defaults to `''`.
- Upsert key: `(patient_id, doctor_id, scan_id)` when `scan_id` is given, else
  `(patient_id, doctor_id, appointment_id)`. If neither is given a new row is always inserted.
- Review element (identical in both GET routes): `{"id","patient_name","rating","review",
  "appointment_id","scan_id","date"}` where `patient_name` falls back to `"Verified Patient"` and `date`
  is `created_at.strftime("%b %d, %Y")` (e.g. `"Jul 25, 2026"`) or `null`.
- **The two GET routes wrap the same list under different key names.** `/api/doctor/ratings` (self, from
  JWT) uses `average` / `total`; `/doctor/ratings/<id>` (public, id from URL) uses `average_rating` /
  `rating_count`. Both averages are `round(x, 1)`, both are `0.0` when there are no ratings.
  Do not unify them.

---

## 5. `schedule` — 5 routes

| Path | Methods | Decorator | Lines | Request | Success response |
|---|---|---|---|---|---|
| `/api/update-availability` | POST | `@doctor_required` | 1928-2031 | JSON: `doctor_id`\*, `schedule`\*, `confirm_override` | **200** `{"success":true,"message":"Schedule updated successfully"}` |
| `/api/doctor-availability/<int:doctor_id>` | GET | none | 2034-2071 | — | **200** `{"success":true,"data":[{"day","off","slots"}]}` |
| `/api/update-fees` | POST | `@doctor_required` | 2076-2117 | JSON: `doctor_id` \| `user_id`\*, `pkr`, `usd`, `duration`, `buffer_time` | **200** `{"success":true,"message":"Fees and Gap updated successfully"}` |
| `/api/doctor-fees/<int:doctor_id>` | GET | none | 2119-2143 | — | **200** `{"success":true,"data":{"pkr","usd","duration","buffer_time"}}` |
| `/api/slots/<int:doctor_id>` | GET | none | 2264-2281 | query: `date`\* | **200 BARE JSON ARRAY — no envelope** (see Gotchas) |

### `/api/update-availability`

Request `schedule` is a list of day objects:
`{"day": "Mon - Fri" | "Monday" | "Mon", "off": bool, "slots": [{"start":"09:00","end":"13:00","break_name":"Lunch"}], "start": "…", "end": "…"}`
(`start`/`end` at the day level is the legacy single-shift fallback, used only when `slots` is empty).

Pipeline, in order — all three stages must stay in this sequence:
1. `validate_schedule_slots()` (1792-1826) — all-or-nothing; `start >= end` or overlapping shifts ⇒ **400**
   with a human-readable message like `Monday: shift start time (17:00) must be before end time (09:00).`
   or `Monday: shifts overlap — 09:00-13:00 and 12:00-15:00 clash.` (note the em-dash `—` in the overlap
   message). Comparison is lexicographic on zero-padded `HH:MM` strings.
2. Orphan check (`find_appointments_orphaned_by_schedule_change`, 1843-1925) unless
   `confirm_override` is truthy ⇒ **409**:
   ```json
   {"success": false,
    "error": "This change would leave existing booked appointments without matching availability.",
    "data": {"requires_confirmation": true,
             "conflicts": [{"appointment_id":7,"date":"2026-08-03","time":"09:00",
                            "status":"Scheduled","patient_name":"…"}]}}
   ```
   This is the **only** `success:false` response in the whole API that carries a `data` object.
3. Delete-all-then-reinsert of `DoctorAvailability` rows for that doctor. `"Mon - Fri"` is expanded to
   individual days by `expand_and_standardize_days()` (1744-1789, handles weekend wrap like `Fri - Sun`).
   Off days get one placeholder row with `start_time=None, end_time=None, is_off=True`. Each extra shift
   in a day stores the *previous* shift's end as `break_start_time`, its own start as `break_end_time`
   and `break_name` (default `'Break'`); the first shift of a day gets all three as `None`.

### `/api/doctor-availability/<doctor_id>`

Rows are regrouped per day into `{"day": "Monday", "off": false, "slots": [{"start":"09:00","end":"13:00"}]}`.
`break_name` / `break_start` / `break_end` are added to a slot **only** when `break_name` is set (note the
response keys are `break_start` / `break_end`, while the DB columns are `break_start_time` /
`break_end_time`). Off days and days whose slots are all empty emit `"slots": [{"start":"","end":""}]`.
Day ordering follows Python dict-insertion order over rows sorted by `start_time ASC` — i.e. **not**
Mon→Sun. The frontend does a `.find(d => d.day === …)` so order does not matter, but it also is not
stable; don't "fix" it.

### `/api/update-fees`

Accepts `doctor_id` **or** `user_id` as the id key. Ownership: `request.current_user['user_id'] != doctor_id`
⇒ 403 `Unauthorized to modify fees`. Note this is an `int != int` comparison against a raw JSON value, so a
string `"5"` fails the check with 403 rather than being coerced. On update, each field applies only when
present (`pkr`/`usd`: `is not None`; `duration`: truthy; `buffer_time`: `is not None`). On insert, falsy
values become `0.0` / `0.0` / `'30min'` / `0`.

### `/api/doctor-fees/<doctor_id>`

With a row: the stored `pkr`, `usd`, `duration` verbatim, `buffer_time or 0`.
Without a row: **200** with `{"pkr":0,"usd":0,"duration":"30min","buffer_time":0}` — integers `0`, not
floats `0.0`, and `success:true` (never a 404).

### `/api/slots/<doctor_id>`

Generated by `_generate_slots_for_date()` (2149-2234). Returns a **bare array** (see Gotchas):

```json
[{"time":"09:00","status":"available","duration":"30min"},
 {"time":"09:30","status":"booked","duration":"30min"}]
```

- Missing `date` ⇒ 400 envelope `Date query parameter is required`; unparseable ⇒ 400 envelope
  `Invalid date format, use YYYY-MM-DD`. **Errors use the envelope, success does not.**
- Past date ⇒ `[]`. No non-off `DoctorAvailability` rows for that weekday ⇒ `[]`.
- Interval = digits scraped out of `DoctorFees.duration` (`int(''.join(filter(str.isdigit, "30min")))`),
  default `'60min'` here when no fees row exists (note: **60**, while every other fallback in the codebase
  is `'30min'`). Unparseable ⇒ 60. `buffer_time` minutes are added after every slot.
- Today's already-passed slots are skipped using a **UTC** `%H:%M` string comparison.
- A slot is `"booked"` when an appointment exists on that date/time with status in
  `["Scheduled","Confirmed","Completed","Pending-Conflict"]`.

---

## 6. `appointments` — 6 routes

| Path | Methods | Decorator | Lines | Request | Success response |
|---|---|---|---|---|---|
| `/api/book-slot` | POST | `@patient_required` | 2283-2448 | JSON: `patient_id`\*, `doctor_id`\*, `slot_date`\*, `slot_time`\*, `scan_id`, `appointment_id` | **201** / **200** / **201** (three branches, below) |
| `/api/resolve-conflict/<int:appointment_id>` | PUT | `@doctor_required` | 2514-2564 | JSON: `reason` | **200** `{"success":true,"message":"Conflict resolved.","data":{…}}` |
| `/api/doctor-appointments/<int:doctor_id>` | GET | `@doctor_required` | 2673-2757 | — | **200** `{"success":true,"data":[…]}` |
| `/api/patient-appointments/<int:patient_id>` | GET | `@patient_required` | 2760-2857 | — | **200** `{"success":true,"data":[…]}` |
| `/api/update-appointment/<int:appt_id>` | PUT | `@doctor_required` | 2859-2931 | JSON: `status`\*, `reason` | **200** `{"success":true,"message":"Appointment status updated to <status>"}` |
| `/api/delete-appointment/<int:appt_id>` | DELETE | `@doctor_required` | 2937-2968 | — | **200** `{"success":true,"message":"Appointment removed from your dashboard"}` |

### `/api/book-slot` — three success shapes

Request keys are `slot_date` / `slot_time` (**not** `date`/`time`). `appointment_id` present ⇒ rebook flow.

1. **New booking → 201** `{"success":true,"message":"Appointment successfully booked."}`
2. **Rebook (reuses the existing Cancelled/Reassigned row) → 200**
   `{"success":true,"message":"Appointment successfully rebooked."}`
3. **Urgent override of an occupied slot → 201**
   ```json
   {"success": true,
    "message": "Slot was already booked, but your case was flagged urgent/critical - the doctor has been notified to confirm priority.",
    "data": {"status": "Pending-Conflict", "appointment_id": 91}}
   ```
   Only branch 3 returns `data`. Both the incoming and the existing appointment flip to
   `Pending-Conflict` and cross-link via `conflict_with_id`.

Guards: id mismatch vs JWT ⇒ 403 `Unauthorized ID mismatch`; `patient_id == doctor_id` ⇒ 400; past date ⇒
400 `Cannot book appointments in the past.`; unparseable date ⇒ 400 `Invalid date format.`; slot taken and
the incoming patient is not server-verified `CRITICAL`/`URGENT` ⇒ 400 `This slot is already booked.`; slot
already in an open conflict ⇒ 400 `This slot is already booked.` (a third patient can't pile on).
Severity is read from the patient's own `AIScan` row, never from the request body.
`duration` is snapshotted from the doctor's `DoctorFees.duration` at booking time (fallback `'30min'`).

Porting hazard at line 2336: the conflict query contains
`models.Appointment.id != rebook_appointment_id if rebook_appointment_id else True` — a **Python**
conditional expression producing a literal `True` as a SQLAlchemy filter criterion when no rebook id was
sent. Copy it verbatim; rewriting it as `or_`/`and_` changes the SQL.

### `/api/resolve-conflict/<appointment_id>`

The URL id is the **winner** (the appointment the doctor confirms). `reason` defaults to
`"Urgent patient requires immediate attention"`.

```json
{"success": true, "message": "Conflict resolved.",
 "data": {"confirmed_appointment_id": 91, "reassigned_appointment_id": 88,
          "suggested_slots_for_reassigned_patient": [{"date":"2026-08-04","time":"09:00","duration":"30min"}]}}
```

Winner → `Confirmed`, loser → `Reassigned` with `cancellation_reason = reason`; both get `resolved_by`,
`resolved_at`, `auto_resolved=False`. Not in `Pending-Conflict` or no `conflict_with_id` ⇒ 400
`This appointment has no active conflict to resolve.`; missing partner row ⇒ 404
`Linked conflicting appointment not found.`

The identical mutation runs unattended from `resolve_expired_conflicts()` (2597-2667), scheduled by
APScheduler every 15 minutes (`app.py:3290-3293`) with `CONFLICT_SLA_HOURS = 4`, `auto_resolved=True` and
`resolved_by=None`. That scheduler is module-level app state — decide explicitly where it lives after the
split; starting it twice would double-resolve conflicts.

### `/api/doctor-appointments/<doctor_id>` — array element (17 keys)

`id`, `patient_name`, `patient_email`, `slot_date`, `slot_time`, `disease`, `status`, `scan_id`,
`duration`, `patient_rating`, `patient_review`, `severity`, `triage_reasons`, `is_conflict`,
`conflict_with_id`, `auto_resolved`, `resolved_at`.

- Filtered by `hidden_from_doctor == False`. Fallbacks: `patient_name` `"Unknown Patient"`,
  `patient_email` `"No Email"`, `disease` `"Unknown"`, `severity` `"ROUTINE"` when no scan.
- `triage_reasons` is a parsed JSON **list**, `[]` on absence/parse failure.
- `is_conflict` is a derived boolean (`status == "Pending-Conflict"`), not a column.
- Ordering: `appointment_date DESC` from SQL, then re-sorted in Python by
  `sort_appointments_by_priority()` (65-88) with rank `Pending-Conflict(0) < Scheduled/Confirmed(1) <
  Completed/Reassigned(2) < Cancelled(3)`, ties broken by descending severity. Unknown statuses rank 2.
  The sort is stable, so date-desc survives inside each group. This ordering is visible to the user —
  preserve the two-stage sort exactly.

### `/api/patient-appointments/<patient_id>` — array element (22 keys)

`id`, `doctor_id`, `doctor_name`, `doctor_profile` (`{"specialty","profile_image"}`), `date`, `time`,
`slot_date`, `slot_time`, `disease`, `duration`, `fees` (`{"pkr","usd"}`), `status`,
`cancellation_reason`, `scan_id`, `scan_info`, `rating`, `review`, `patient_rating`, `patient_review`,
`is_conflict`, `conflict_with_id`, `suggested_slots`.

- Date/time are emitted **twice** under both `date`/`time` and `slot_date`/`slot_time`. Both are needed.
- Rating is emitted **twice** under `rating`/`review` and `patient_rating`/`patient_review`.
- `doctor_name` fallback `"Expert"`; `doctor_profile.specialty` fallback `""`.
- `fees` here has only `pkr`/`usd` (no `duration`/`buffer_time`) and falls back to `0.0`, **unlike**
  `/api/doctors/public` where the same concept falls back to `null`.
- `scan_info` is `null` when there's no scan, else
  `{"id","image_url","disease","confidence","doctor_comment","invite_to_clinic","severity"}`. Its
  `image_url` is the **raw DB value with no leading slash**, unlike the sibling scan listings.
- `suggested_slots` is `null` unless `status == "Reassigned"`, in which case it is recomputed live by
  `find_next_available_slots(..., limit=3, lookahead_days=21)` → `[{"date","time","duration"}]`.
- Ordering: `Appointment.id DESC` (no priority re-sort on the patient side).
- This route runs one `DoctorRating` query **per appointment** inside the loop (2811-2814) while the
  doctor route pre-fetches. Keep behavior identical; optimizing is a separate task.

### `/api/update-appointment/<appt_id>`

`status` must be one of `Scheduled`, `Confirmed`, `Completed`, `Cancelled` (400 `Invalid appointment
status` otherwise). `reason` is stored only when `status == 'Cancelled'`. Two short-circuits with
`success:false`: appointment in `Pending-Conflict` ⇒ 400 `This appointment has an active booking conflict.
Use /api/resolve-conflict to resolve it first.`; already in the requested status ⇒ 400
`This appointment is already {status}.` (idempotency guard that prevents duplicate emails).

### `/api/delete-appointment/<appt_id>`

**Soft delete.** Sets `hidden_from_doctor = True`; the row survives so the patient's history is intact.
The message says "removed from your dashboard" for that reason — do not reword it, and do not turn it
back into a hard delete.

---

## 7. `admin` — 4 routes

| Path | Methods | Decorator | Lines | Request | Success response |
|---|---|---|---|---|---|
| `/admin/stats` | GET | `@admin_required` | 1589-1607 | — | **200** `{"success":true,"data":{"total_users","total_scans","total_doctors","pending_doctor_verifications"}}` |
| `/admin/doctors` | GET | `@admin_required` | 1613-1661 | query: `status` | **200** `{"success":true,"data":[…]}` |
| `/admin/doctors/<int:doctor_id>/verify` | PUT | `@admin_required` | 1664-1708 | JSON: `action`\*, `note` | **200** `{"success":true,"message":"Doctor approved"}` / `"Doctor rejected"` |
| `/admin/doctors/<int:doctor_id>` | DELETE | `@admin_required` | 1711-1738 | — | **200** `{"success":true,"message":"Doctor account deleted"}` |

`/admin/doctors` element (13 keys): `id`, `name`, `email`, `created_at`, `is_email_verified`, `license`,
`specialty`, `hospital`, `city`, `phone`, `verification_status`, `verification_note`, `verified_at`.

- `created_at` and `verified_at` use `strftime("%Y-%m-%d %H:%M")` — **not** `isoformat()`, unlike the scan
  endpoints. `verification_status` defaults to `'pending'` when there is no profile row.
- `?status=` filtering happens **in Python after** loading every doctor, so the filter is applied to the
  computed `v_status` (profile-less doctors count as `pending`). An SQL-side filter would behave differently.
- `/verify`: `action` must be exactly `'approve'` or `'reject'` ⇒ otherwise 400
  `action must be 'approve' or 'reject'`. Message interpolates the resulting status
  (`approved`/`rejected`), so it is `"Doctor approved"` / `"Doctor rejected"`.
- DELETE relies on ORM cascades; FK violations are caught as `IntegrityError` ⇒ 400
  `Could not delete: doctor has linked records that block deletion.`
- **There is no admin registration route.** Admin rows must be seeded directly in the DB.

---

## 7b. `admin` — NEW additive console (phase 2A, **not** part of the frozen 39)

Everything in this section is **additive**. The four routes in §7 are unchanged: same paths, same
decorators, same bodies, same `data: [...]` bare array on `/admin/doctors`. Nothing here rewrites them.

**Why it exists.** The requirement is *"admin can perform all actions of doc and user"*. `app/core/rbac.py`
delivers the capability half (`ADMIN_PERMS ⊃ DOCTOR_PERMS ⊃ PATIENT_PERMS`, plus `X-Act-As-User-Id`).
This section is the visibility half: before it, an admin holding `user.read.any` / `scan.read.any` /
`appointment.read.any` / `admin.audit.read` had **no endpoint that returned those rows**.

Implementation: `app/api/admin/routes.py` (thin handlers) over `app/services/admin_service.py` (all query
and serialisation logic). Tests: `tests/test_admin_api.py`.

| Path | Methods | Permission (all ADMIN-only) | Request | Success response |
|---|---|---|---|---|
| `/admin/patients` | GET | `user.read.any` | query: `page`, `per_page`, `q`, `is_active` | **200** page envelope |
| `/admin/users` | GET | `user.read.any` | query: `page`, `per_page`, `q`, `role`, `is_active`, `is_root`, `is_verified` | **200** page envelope |
| `/admin/scans` | GET | `scan.read.any` | query: `page`, `per_page`, `severity`, `status`, `review_status`, `patient`, `doctor`, `date_from`, `date_to` | **200** page envelope |
| `/admin/appointments` | GET | `appointment.read.any` | query: `page`, `per_page`, `status`, `doctor`, `patient`, `date_field`, `date_from`, `date_to` | **200** page envelope |
| `/admin/audit-log` | GET | `admin.audit.read` | query: `page`, `per_page`, `actor`, `subject`, `action`, `action_prefix`, `target_type`, `date_from`, `date_to` | **200** page envelope |
| `/admin/users/<int:user_id>/status` | PATCH | `user.read.any` **+** `doctor.verify` | JSON: `is_active`\*, `reason` | **200** `{"success":true,"message":"User suspended"\|"User reactivated","data":{…user…}}` |

Failure responses are the usual envelope: **401** `Token is missing! Unauthorized access.` /
`Session expired! Please login again.` / `Invalid Token!`, **403** `Access denied! Only Admins allowed.`
A Doctor **and** a Patient token get 403 on all six; so does an admin who is delegating down via
`X-Act-As-User-Id` (effective permissions are an intersection, so the admin console is lost).

### 7c. Account CRUD (additive; `user.manage.any`)

The section above is read-only plus one flag flip. These four are the write surface: adding an account,
editing one, forcing a new password, and deleting a duplicate. Before them, "a clinic phoned in a new
doctor" or "this patient mistyped their email at signup" ended at a psql prompt.

| Path | Method | Request | Success |
|---|---|---|---|
| `/admin/users` | POST | JSON: `name`\*, `email`\*, `role` (`Doctor`\|`AI User`), `password`, `is_verified`, `doctor{…}` | **201** `data` = user element + `doctor` + `temporary_password` |
| `/admin/users/<int:user_id>` | PATCH | JSON: `name`, `email`, `is_verified`, `doctor{…}` | **200** `data` = user element + `doctor` + `changed[]` |
| `/admin/users/<int:user_id>/reset-password` | POST | JSON: `new_password` | **200** `data` = user element + `temporary_password` + `sessions_revoked` |
| `/admin/users/<int:user_id>` | DELETE | — | **200** `data` = `{id, name, email, role}` |

`doctor{}` accepts `license`, `specialty`, `hospital`, `city`, `phone`, `experience`, `latitude`,
`longitude`. On POST it also accepts `verification_status` (`pending` default, or `approved`) and
`verification_note`; on PATCH it does **not** — see below.

**The rules, all of them enforced server-side:**

- **No privilege escalation.** `role` is whitelisted to `Doctor` / `AI User` exactly as `/register` and
  `/auth/register` are: an Admin cannot be created over HTTP, and never could. On PATCH, `role` is
  **refused with a 400**, not ignored — an account's type is immutable, because changing one means a
  licence, a verification decision and an email.
- **The rank rule**, borrowed verbatim from `rbac._apply_delegation`: you may only manage an account
  **strictly below your own role**. One admin therefore cannot reset another admin's password or delete
  their account. PATCH is the one exception — editing *your own* row is allowed.
- **`is_root` is refused everywhere** (403 `Access denied! Root accounts are protected.`), the row left
  untouched, exactly as `PATCH …/status` refuses it.
- **Verification stays with `PUT /admin/doctors/<id>/verify`.** That route writes `verified_at` /
  `verified_by` / `verification_note` **and emails the doctor**. A second path that set
  `verification_status` without the email would be the same decision made two ways, one of them silent.
  Creation is the sole exception: the admin is entering the licence at that moment and there is no prior
  decision to overwrite.
- **`password` is optional on create, `new_password` optional on reset.** Omit it and the server generates
  one and returns it as `data.temporary_password` — **once, in that response only**. Only the hash is
  stored, so it is not retrievable afterwards. When the caller supplies the password,
  `temporary_password` is `null` (echoing back a value they already have just puts it on a second
  screen). The generated value is never logged, and `_user_public()` still cannot emit a password hash.
- **`is_verified` defaults to `true` on create and NO OTP is issued.** An admin entering someone else's
  details *is* the verification, and the usual reason for doing it is that the person cannot receive a
  code. Send `false` to put them back on the OTP screen.
- **Reset ends every session the target holds** — `token_version` is bumped (which invalidates their
  access tokens, since the version is baked into each one at mint time) and their refresh rows are
  revoked; `sessions_revoked` reports how many. It **does not** set `is_verified`: the self-service reset
  is right to, because receiving the code proves the inbox, and nothing here proves anything. Resetting
  **your own** password is a 400 — it would revoke the session making the request.
- **DELETE refuses an account with clinical history.** Every FK from a clinical table to `users.id` is
  `ON DELETE CASCADE`, so an unguarded delete would take third parties' rows with it. The links are
  counted first and any non-zero count is a **400** carrying them under `data`:
  `{scans, appointments_as_patient, appointments_as_doctor, requests_sent, requests_received,
  reviews_written, reviews_received, alternative}`. `requests_*` matter because an **open**
  consultation request has no `appointments` row yet, so counting appointments alone would report a
  patient mid-request as unlinked. Same promise `DELETE /admin/doctors/<id>` makes. Deleting
  **yourself** is a 400.
- **Every call writes an `audit_logs` row** naming the human who made it — `user.create`, `user.update`
  (with the field-level diff), `user.password.reset`, `user.delete` — visible in `/admin/audit-log`. Under
  `X-Act-As-User-Id` the actor is the **principal**, never the delegated identity.

Emails on create and reset are **best effort** and never fail the request, which is the opposite of
`/auth/register` (where a dead SMTP server rolls the whole signup back). There, the OTP *is* the flow and
the account is useless without it; here the account already works and the admin is holding the temporary
password on screen.

### Booking on someone's behalf — no new route

`POST /api/book-slot` (§6, contract #29) has always taken `patient_id` in the body and authorised it with
`resolve_actor(patient_id, own_perm=appointment.book, any_perm=appointment.manage.any)`. An admin holds
`appointment.manage.any`, so booking for a patient was already permitted — it simply had no UI. The
console now has one, using that same route, the same slot canonicalisation and the same
`uq_appt_doctor_slot` index.

**One additive change:** when the actor is not the patient, the successful booking also writes an
`audit_logs` row `appointment.book.on_behalf` (`target_type: "appointment"`, detail naming the doctor and
the slot). Request and response shapes are untouched — all three success branches are byte-identical. The
row is deliberately **not** written when the actor *is* the patient (nothing privileged happened) or when
the booking arrives under `X-Act-As-User-Id` (`rbac` already logged an `act_as` row for that request, and
a second would double-count).

### The page envelope (new; §7's `/admin/doctors` does **not** use it)

```json
{"success": true, "data": {"items": [...], "page": 1, "per_page": 20, "total": 137, "has_more": true}}
```

- `page` ≥ 1, `per_page` default **20**, max **100** (silently clamped; unparseable values fall back to the
  defaults rather than 400 — a paginator is not where a UI should fail).
- `total` is a real `SELECT count(...)` over the **whole filtered set**, and rows come back via SQL
  `LIMIT/OFFSET`. Nothing loads a table and slices it in Python. (`/admin/doctors` does exactly that, on
  purpose, and is the one place it is allowed.)
- `has_more` is computed as `page * per_page < total`, not inferred from `len(items)`.
- Every list has a **total order** (`created_at DESC NULLS LAST, id DESC`), because `LIMIT/OFFSET` over a
  non-unique sort key duplicates and drops rows between pages.

### Filter semantics (shared)

- `date_from` inclusive. `date_to` as `YYYY-MM-DD` covers the **whole** of that day (expanded to the next
  midnight, exclusive); as a full ISO-8601 timestamp it is exclusive. Aware inputs are converted to UTC and
  stripped, because every `DateTime` column in this schema is naive UTC.
- Bad filter values are **400**, not silently ignored: unknown `severity` / `status` / `role` / `date_field`,
  an unparseable date, a `date_to` ≤ `date_from`, a non-boolean `is_active`.
- `patient` / `doctor` / `actor` / `subject` accept **either** a numeric id **or** a free-text fragment
  matched `ILIKE '%term%'` against `users.name` and `users.email` (via an `IN (SELECT id FROM users …)`
  subquery, so the count and page statements stay structurally identical).
- `role` accepts the DB literal (`Admin`, `Doctor`, `AI User`) or any `ROLE_ALIASES` spelling (`patient`,
  `dr`, …). It is normalised to the literal before querying.

### `/admin/patients` element (7 keys)

`id`, `name`, `email`, `is_active`, `created_at`, `scan_count`, `appointment_count`.

Role `'AI User'` only — a Doctor who also books for themselves appears under `/admin/users?role=Doctor`.
`scan_count` / `appointment_count` come from two `GROUP BY` queries over the current page's ids, never
`len(user.scans)` per row. `created_at` is **isoformat** here (the scan-endpoint convention), *not* the
`strftime('%Y-%m-%d %H:%M')` that §7's `/admin/doctors` uses.

### `/admin/users` element (10 keys)

`id`, `name`, `email`, `role`, `is_root`, `is_active`, `is_verified`, `created_at`, `last_login_at`,
`verification_status`.

`verification_status` is `'approved' | 'pending' | 'rejected'` for Doctors (defaulting to `'pending'` when
there is no profile row, matching `/admin/doctors`) and `null` for every other role. `is_root` is what the
UI uses to mark and lock protected accounts.

### `/admin/scans` element (20 keys)

`id`, `user_id`, `patient_name`, `patient_email`, `doctor_id`, `doctor_name`, `prediction`, `confidence`,
`severity_level`, `triage_score`, `status`, `review_status`, `doctor_comment`, `invite_to_clinic`,
`is_sensitive`, `image_deleted_at`, **`image_url`**, **`image_endpoint`**, `created_at`, `updated_at`.

- `image_url` keeps the existing shape used by `/patient/scans` and `/doctor/scans`: the stored path with a
  leading `/`, or `""` when absent.
- **`image_endpoint` is the addition**: `/api/scans/<id>/image`, the future authenticated read. It is `null`
  once `image_deleted_at` is set, so a client never renders a 404 for a patient-deleted photo. Both keys
  ship together; `image_url` is not being removed here.
- `confidence` is `round(x, 2)` on the stored **0-100** value (see G5) with `0.0` as the fallback.

### `/admin/appointments` element (19 keys)

`id`, `patient_id`, `patient_name`, `patient_email`, `doctor_id`, `doctor_name`, `doctor_email`, `scan_id`,
`appointment_date`, `appointment_time`, `slot_start`, `duration`, `status`, `cancellation_reason`,
`hidden_from_doctor`, `conflict_with_id`, `auto_resolved`, `resolved_at`, `created_at`.

`date_field` selects which column the range applies to: `created` (default) → `appointments.created_at`,
always populated; `slot` → `appointments.slot_start`, the typed shadow column, which is `NULL` on legacy
rows and therefore excludes them. **`appointment_date` is not range-filterable** — it is free text holding
either `"2026-07-25"` or `"Mon, Jan 26"` (see G8), so `>=` on it compares strings, not dates.

### `/admin/audit-log` element (14 keys)

`id`, `actor_user_id`, `actor_name`, `actor_email`, `subject_user_id`, `subject_name`, `subject_email`,
`action`, `target_type`, `target_id`, `detail`, `ip`, `user_agent`, `created_at`.

Reads the same `audit_logs` table that `require_permission`'s act-as branch writes on **every**
`X-Act-As-User-Id` request — this is what makes admin impersonation accountable rather than invisible.
Names are resolved with one `IN (...)` query per page, never one per row. `action` matches exactly (the
vocabulary is controlled: `act_as`, `user.status.change`, …); use `action_prefix` for `ILIKE 'prefix%'`.
Ordered `created_at DESC, id DESC`.

### `PATCH /admin/users/<id>/status`

Body `{"is_active": bool, "reason": "optional"}`. `is_active` also accepts the strings `"true"`/`"false"`.
The soft alternative to `DELETE /admin/doctors/<id>` — a user with clinical history must never be hard-deleted
just to stop them logging in.

Refusals, in evaluation order:

| Condition | Status | `error` |
|---|---|---|
| `is_active` absent or not boolean-ish | 400 | `is_active is required and must be a boolean` |
| user does not exist | 404 | `User not found` |
| **target `is_root`** | **403** | **`Access denied! Root accounts are protected.`** |
| deactivating **your own** account | 400 | `You cannot deactivate your own account.` |

On success it writes an `audit_logs` row (`action='user.status.change'`, `target_type='user'`,
`detail="is_active True -> False; reason: …"`) attributed to the **principal** (`g.principal`), never to a
delegated identity. Deactivating also bumps `users.token_version`, the hook the refresh-token flow uses to
invalidate sessions already sitting in browsers; nothing reads it yet, so today that is forward-compatible
bookkeeping only. The response `data` is the `/admin/users` element plus `was_active` and `status_reason`.

### `is_root` is protected, everywhere

`is_root` accounts are **never** suspendable (403 above, and the DB row is left completely untouched — no
`is_active` change, no `token_version` bump, no audit row), **never** deletable, and **never** a valid
act-as target (`rbac.py` already refuses with `Access denied! Cannot act as a root account.`). They stay
fully visible in `/admin/users` with `is_root: true` so the UI can render them locked.

### Secrets never cross this boundary

`app/services/admin_service._user_public()` is the **only** place a user row becomes a dict in this module.
`password`, `otp_code`, `otp_created_at`, `otp_attempts`, `pending_email` and `token_version` are not in it,
and `tests/test_admin_api.py` asserts none of those strings appears anywhere in a response body.

---

## 8. `streams` — 2 routes (SSE)

| Path | Methods | Decorator | Lines | Request | Response |
|---|---|---|---|---|---|
| `/api/doctor-updates-stream/<int:doctor_id>` | GET | **none** | 1280-1411 | — | `text/event-stream`, infinite generator |
| `/api/patient-updates-stream/<int:patient_id>` | GET | **none** | 1421-1587 | — | `text/event-stream`, infinite generator |

Both return `Response(generate(), mimetype='text/event-stream', headers={'Cache-Control':'no-cache',
'X-Accel-Buffering':'no','Connection':'keep-alive'})`. The generator loops forever: open a fresh
`SessionLocal()`, build the payload, `json.dumps` it, emit `data: {json}\n\n` **only when the payload
changed** since the last tick, otherwise emit the comment line `: heartbeat\n\n`, then `time.sleep(5)`.
`GeneratorExit` is re-raised; every other exception is logged and the loop continues.

**Doctor stream payload:**
`{"scans":[…], "appointments":[…], "pending_count":int, "completed_count":int, "cancelled_count":int}`

- `scans`: last 20 by `id DESC`, 13 keys — `id`, `patient_name`, `patient_email`, `disease`, `confidence`,
  `status`, `doctor_comment`, `invite_to_clinic`, `questionnaire_answers`, `image_url` (`"/"`-prefixed),
  `created_at`, `patient_rating`, `patient_review`. **No** `scan_id`, `review_status` or `updated_at` —
  narrower than `/doctor/scans/<id>`.
- `appointments`: 9 keys — `id`, `patient_name`, `patient_email`, `slot_date`, `slot_time`, `duration`,
  `disease`, `status`, `scan_id`. **Much narrower** than `/api/doctor-appointments/<id>` (no `severity`,
  `triage_reasons`, `is_conflict`, `conflict_with_id`, `auto_resolved`, `resolved_at`, ratings). Filtered
  by `hidden_from_doctor == False` and priority-sorted, but **without** the severity map (the plain
  1-arg `sort_appointments_by_priority(appointments)` call).
- Counters: `Scheduled` **and** `Confirmed` both increment `pending_count`; `Completed` and `Cancelled`
  have their own counters; `Pending-Conflict` and `Reassigned` are counted in none of them.

**Patient stream payload:** `{"scans":[…], "appointments":[…]}` — no counters.

- `scans`: last 20 by `id DESC`, same 17 keys as `/patient/scans/<id>` **minus `updated_at`**.
- `appointments`: the full 22-key shape of `/api/patient-appointments/<id>`, `id DESC`, including live
  `suggested_slots` for `Reassigned` rows.

---

## 9. `chat` — 1 route

| Path | Methods | Decorator | Lines | Request | Success response |
|---|---|---|---|---|---|
| `/api/chat` | POST | `@token_optional` | 2974-3012 | JSON: `message`\* | **200** `{"success":true,"data":{"reply":"<text>"}}` |

Missing/empty `message` ⇒ 400 `Message cannot be empty`. Missing `GEMINI_API_KEY` ⇒ 500
`Service currently unavailable`. Any other exception ⇒ 500 `AI service error`.
Role from the optional token selects one of three system prompts (`Doctor` / `Admin` / everything else
including anonymous, where `user_role` is the literal `'Guest'`). Model `gemini-2.5-flash`,
`max_output_tokens=800`, `temperature=0.7`. `genai.configure()` is called **per request** — module-level
global state; if the port moves it to import time, behavior on a rotated key changes.

---

## 10. `media` — 1 route

| Path | Methods | Decorator | Lines | Request | Response |
|---|---|---|---|---|---|
| `/static/uploads/<path:filename>` | GET | none | 224-229 | — | raw file via `send_from_directory` |

`..` anywhere in the filename or a leading `/` ⇒ 400 envelope `Invalid filename`; otherwise the bytes of
`static/uploads/<filename>`. Not JSON. Public, no auth — every scan image is world-readable by URL.
This route **shadows Flask's built-in `/static/<path>` handler** for the `uploads/` subtree because
`UPLOAD_FOLDER = 'static/uploads'` is a *relative* path resolved against the process CWD. Do not touch the
295 files under it, and keep the folder path relative unless you verify the app is always started from the
backend directory.

---

# Gotchas

## G1. `/doctor/update_scan/<id>` returns a flat dict — envelope deliberately broken

`app.py:963-981`. On success this route bypasses `generate_response()` entirely and does
`return jsonify(scan_data), 200`:

```json
{
  "id": 42,
  "success": true,
  "message": "Scan updated successfully",
  "data": {},
  "created_at": "2026-07-20T10:11:12.131415",
  "updated_at": "2026-07-25T09:00:00.000001",
  "doctor_id": 5,
  "patient_id": 9,
  "scan_id": 42,
  "status": "Reviewed",
  "review_status": "Reviewed",
  "doctor_comment": "…",
  "invite_to_clinic": true,
  "doctor_name": null,
  "doctor_email": null
}
```

The scan fields sit at the **top level**, next to a decorative `"success": true`, `"message"` and an
**empty** `"data": {}`. It is not an envelope with the scan inside — it is a flat object that merely looks
like one. Error paths in the same function *do* use the envelope (400/403/404/500), so the shape is
inconsistent within the route. **Preserve exactly, including the useless `"data": {}`.**

Frontend behavior (`DoctorDashboard.jsx:312-355`): it checks only `res.ok`, then reads
`responseData.scan || responseData.data`. `scan` is absent and `data` is `{}` — which is **falsy-checked
as truthy in JS**, so `updatedScan = {}` and the spread `{...baseUpdate, ...{}}` is a no-op. The optimistic
local update is what actually paints the UI. If you ever populate `"data"` with real fields, they would
suddenly override the optimistic values. Leave it empty.

Also note the frontend's fallback path calls `GET /doctor/scan/<id>` (singular, line 327) — **that route
does not exist in app.py** and 404s silently inside a `try/catch`. Do not add it during the refactor; adding
it would change what the dashboard renders.

Request body: the frontend sends `{comment, invite_to_clinic, doctor_id}`. The backend reads
`data.get("comment") or data.get("doctor_comment") or scan.doctor_comment` and
`data.get('invite_to_clinic', scan.invite_to_clinic)`. **`doctor_id` in the body is ignored** — the doctor
identity comes from the JWT. Side effects: `status` and `review_status` are both forced to `"Reviewed"`,
`updated_at` set, a "reviewed" email is sent to the patient, and `is_notified = True` in a second commit.

## G2. `/api/slots/<id>` returns a bare JSON array — envelope deliberately broken

`app.py:2276`: `return jsonify(response_slots), 200  # Frontend expects raw list or generic JSON`.
The body is a top-level array, not an object:

```json
[{"time":"09:00","status":"available","duration":"30min"}]
```

Error paths in the same function **do** use the envelope (400 for missing/invalid `date`, 500 on
exception), so a caller sees an array on success and an object on failure. Preserve both.

Frontend (`PatientHistory.jsx:147`) defends with
`Array.isArray(resData) ? resData : (resData.slots || resData.data || [])`. That means wrapping the array
in an envelope would *technically* still work — **do it anyway not**: this contract is the go/no-go gate,
and `PatientHistory.jsx:211` performs the same call a second time after booking. Keep the bare array.

## G3. URL-id routes and how ownership is checked today

23 of the 39 routes take an id in the path. The auth model is inconsistent — document it, port it as-is,
and fix it only as a separate, explicitly-approved task.

| Route | Id means | Ownership check |
|---|---|---|
| `/api/scans/<scan_id>/report-status` | scan | `scan.user_id != jwt.user_id` ⇒ 403 |
| `/api/override-severity/<scan_id>` | scan | `scan.doctor_id != jwt.user_id` ⇒ 403 (strict) |
| `/doctor/update_scan/<scan_id>` | scan | `if scan.doctor_id and scan.doctor_id != jwt.user_id` ⇒ 403 — **unassigned scans (`doctor_id IS NULL`) are writable by ANY doctor** |
| `/doctor/delete_scan/<scan_id>` | scan | same weak pattern as above — **any doctor can delete an unassigned scan** |
| `/patient/scans/<user_id>` | patient | `jwt.user_id != user_id` ⇒ 403 |
| `/doctor/scans/<doctor_id>` | doctor | `jwt.user_id != doctor_id` ⇒ 403 |
| `/api/doctor-appointments/<doctor_id>` | doctor | `jwt.user_id != doctor_id` ⇒ 403 |
| `/api/patient-appointments/<patient_id>` | patient | `jwt.user_id != patient_id` ⇒ 403 |
| `/api/update-appointment/<appt_id>` | appointment | `appt.doctor_id != jwt.user_id` ⇒ 403 |
| `/api/delete-appointment/<appt_id>` | appointment | `appt.doctor_id != jwt.user_id` ⇒ 403 |
| `/api/resolve-conflict/<appointment_id>` | appointment | `appt.doctor_id != jwt.user_id` ⇒ 403 |
| `/admin/doctors/<doctor_id>[/verify]` | doctor | role gate only (`@admin_required`) |
| `/api/doctor-availability/<doctor_id>` | doctor | **none — fully public** |
| `/api/doctor-fees/<doctor_id>` | doctor | **none — fully public** |
| `/api/slots/<doctor_id>` | doctor | **none — fully public** |
| `/doctor/ratings/<doctor_id>` | doctor | **none — fully public** |
| `/api/doctor-updates-stream/<doctor_id>` | doctor | **none — see G4** |
| `/api/patient-updates-stream/<patient_id>` | patient | **none — see G4** |
| `/static/uploads/<filename>` | file | path-traversal check only |

Two routes take the owner id in the **body** instead of the URL and check it the same way:
`/api/update-availability` (`doctor_id`) and `/api/update-fees` (`doctor_id` or `user_id`).
`/api/book-slot` checks `patient_id` from the body against the JWT. `/api/rate-doctor`,
`/api/doctor/ratings` and `/api/doctor/profile` take the id **only** from the JWT — the safest pattern in
the codebase, and the one to converge on later.

## G4. Both SSE streams are unauthenticated by design

`/api/doctor-updates-stream/<doctor_id>` and `/api/patient-updates-stream/<patient_id>` carry **no
decorator**. The comment at 1417-1419 explains why: the browser `EventSource` API cannot attach an
`Authorization` header, so the endpoints are scoped only by the id in the URL. Anyone who guesses an
integer can stream another user's scans, patient emails and appointments. The frontend
(`DoctorDashboard.jsx:259`, `PatientHistory.jsx:535`) opens them with a plain `new EventSource(url)`.

Do **not** add `@token_required` during the refactor — it would break both dashboards instantly. The real
fix (a short-lived token in the query string, or fetch-based streaming) is a follow-up task with a
frontend change, which this project has explicitly excluded.

Related: each stream holds a DB session per 5-second tick for the life of the connection, forever. With
the Flask dev server (threaded) every open dashboard tab pins a worker thread. Under gunicorn this needs
`gevent`/`eventlet` or a worker count above the tab count. Not a contract issue, but it will bite on deploy.

## G5. Confidence: 0-100 in the DB, 0-1 in the triage engine

The single most confusing unit bug in the codebase. Three layers disagree.

| Layer | Scale | Evidence |
|---|---|---|
| `test_model.predict_skin_disease()` | **0-100** | `confidence = float(np.max(probs) * 100)` — `test_model.py:95` |
| `/predict` normalizer + `ai_scans.confidence` column | **0-100** | `app.py:622-630` clamps to `[0, 100]`, 2 dp |
| `TriageService.evaluate_urgency()` | **0-1** | `CONFIDENCE_THRESHOLD = 0.60`, default arg `ai_confidence=0.85`, formatting `f"{ai_confidence*100:.0f}%"` — `app.py:705-722` |

`/send_report` passes the DB value straight in: `ai_confidence = scan.confidence if scan.confidence is not
None else 0.85` (`app.py:788`). So a real scan hands `87.34` to a function that expects `0.8734`:

- The low-confidence safety guard `ai_confidence < 0.60` **can never fire** for a real scan, so a
  CRITICAL/URGENT disease is never de-escalated to ROUTINE for lack of confidence.
- The reason strings it emits read `"AI predicted X (8734% confidence)"`, and those strings are persisted
  to `ai_scans.triage_reasons` and surfaced verbatim in `/api/doctor-appointments/<id>.triage_reasons`.
- The `0.85` fallback (only used when `confidence IS NULL`) *is* on the 0-1 scale, so a null-confidence
  scan takes a completely different code path from a 87.34 one.

**Do not fix this during the blueprint port.** Both the `data.triage_reasons` strings and the stored
`severity_level` values would change, which is an observable response change. Log it, port it byte-for-byte,
fix it in a dedicated change with its own before/after check.

Second-order note: `TriageService.DISEASE_TIER` (`app.py:680-691`) is keyed on names like
`"Melanoma Skin Cancer Nevi and Moles"`, but `test_model.CLASS_NAMES` are `"1. Eczema"`, `"2. Melanoma"`,
`"4. Basal Cell Carcinoma (BCC)"`, … — **no key ever matches**. Every scan therefore gets
`disease_tier = 'ROUTINE'`, and only the patient questionnaire (capped at `URGENT`) can escalate anything.
The in-code comment claiming the map is a "direct lookup against main.py's CLASS_NAMES" is stale. Same
rule: preserve, don't fix, in this pass.

Frontend defense: `DoctorDashboard.jsx:504-513` and `PatientHistory.jsx:589-599` both run
`if (p > 0 && p <= 1) p = p * 100; else if (p > 100) p = p > 1000 ? p / 100 : p;` before display, and
`AiScanner.jsx:80-81` divides by 100 when `> 100`. The UI is unit-agnostic; the triage engine is not.

## G6. Other places the frontend parses responses unusually

- **`AiScanner.jsx:75-86`** — checks `!response.ok || !json.success` and then reads `json.data.confidence`,
  `json.data.disease`, `json.data.scan_id`. It will throw on a missing `data` key, so `/predict` must keep
  returning `data` even in edge cases.
- **`PatientHistory.jsx:147, 211`** — the `Array.isArray(resData) ? resData : (resData.slots ||
  resData.data || [])` triple-fallback for `/api/slots/<id>`. See G2.
- **`DoctorDashboard.jsx:316-334`** — reads the response with `await res.text()` then `JSON.parse` inside a
  try/catch (tolerates an empty body), then `responseData.scan || responseData.data`, then falls back to a
  **nonexistent** `GET /doctor/scan/<id>`. See G1.
- **`NearbyDoctors.jsx:304-307`** — hits `/api/scans/<id>/report-status` on mount because a `localStorage`
  flag keyed on `scan_id` went stale across DB resets. The backend is the source of truth for the
  "Report Already Sent" lock, so `data.report_sent` must keep its exact name and boolean type.
- **`FloatingChatbot.jsx:157`** — interpolates `scanData.confidence` into the prompt as `"…% confidence"`,
  assuming a 0-100 number.
- **Two SSE consumers** (`DoctorDashboard.jsx:262`, `PatientHistory.jsx:538`) `JSON.parse(event.data)` and
  read `payload.scans` / `payload.appointments` (+ the three `*_count` fields on the doctor side). Heartbeat
  lines start with `:` so `EventSource` never delivers them to `onmessage` — keep emitting the comment form,
  not `data: heartbeat`.
- **Image URLs** — `PatientHistory.getSafeImageUrl` strips a leading `/` and re-joins onto the API base, so
  it tolerates both forms; `DoctorDashboard.jsx:1413` does a raw `` `${API_BASE_URL}${selectedScan.image_url}` ``
  and therefore **requires** the leading slash that `/doctor/scans/<id>` and the doctor SSE stream add.
  Never drop the `"/" + scan.image_url` prefix in those two.

## G7. Duplicate / aliased keys that must all stay

The API emits the same value under multiple names in several places. Each duplicate has at least one
frontend reader; removing "redundancy" is a breaking change.

| Route | Duplicated as |
|---|---|
| `/api/doctors/public`, `/api/doctors` | `specialty` + `specialization`; `rating` + `average_rating` |
| `/patient/scans/<id>`, `/doctor/scans/<id>`, patient SSE | `id` + `scan_id` |
| `/api/patient-appointments/<id>`, patient SSE | `date`/`time` + `slot_date`/`slot_time`; `rating`/`review` + `patient_rating`/`patient_review` |
| `/api/doctor/ratings` vs `/doctor/ratings/<id>` | same list, different wrapper keys (`average`/`total` vs `average_rating`/`rating_count`) |

`models.py` also defines SQLAlchemy `synonym()`s (`specialization`→`specialty`, `image_path`→`image_url`,
`prediction`→`prediction_result`, `fees`→`pkr`, `consultation_duration`→`duration`, `date`→`appointment_date`,
`time`→`appointment_time`). Keep them; some route code reads through them.

## G8. Status / role / severity string literals — the full closed set

Never rename, never re-case, never translate.

- **Roles** (DB `users.role` + JWT `role`): `'Admin'`, `'Doctor'`, `'AI User'`. `patient_required` also
  accepts a legacy `'Patient'`.
- **Scan `status`**: `'Local'` (set by `/predict`), `'Pending'` (set by `/send_report`), `'Reviewed'`
  (set by `/doctor/update_scan`). Model default `'Pending'`.
- **Scan `review_status`**: `'Pending'` (default) → `'Reviewed'`.
- **Severity**: `'ROUTINE'`, `'URGENT'`, `'CRITICAL'` (uppercase). Ranked `{ROUTINE:0, URGENT:1, CRITICAL:2}`.
- **Appointment `status`**: `'Scheduled'`, `'Confirmed'`, `'Completed'`, `'Cancelled'`,
  `'Pending-Conflict'` (hyphen, mixed case), `'Reassigned'`. Only the first four are settable via
  `/api/update-appointment`; `Pending-Conflict` and `Reassigned` are produced by the booking/conflict engine.
- **Doctor `verification_status`**: `'pending'`, `'approved'`, `'rejected'` (lowercase).

## G9. Refactor-mechanics traps

- **No `url_prefix`.** The 39 paths do not share a prefix scheme. Register every blueprint with
  `url_prefix=None`, or the paths change and the frontend breaks.
- **`request.current_user`** is set as an attribute on the Flask request object by the decorators. That
  works because Flask's request proxy allows attribute assignment; if the port moves to `flask.g`, every
  view has to change in lockstep.
- **`generate_response` and the five decorators live in `app.py` and are imported by every route.** They
  need a shared module (e.g. `utils/responses.py`, `utils/auth.py`) that does **not** import `app`, or you
  get a circular import. The decorators read `app.config['SECRET_KEY']` — use `current_app.config` or a
  module-level constant sourced from the same env var + the same default string
  (`"AI_Derma_Super_Secret_Key_9988_Strong_And_Secure_2026"`), otherwise in-flight tokens stop decoding.
- **Session handling is per-view** (`db = SessionLocal()` … `finally: db.close()`), 30-odd times. If you
  centralize it into a teardown hook, watch the two SSE generators — they open and close a session **inside**
  the loop and must not be bound to the request lifecycle.
- **The APScheduler job** (`app.py:3290-3293`) starts at import time and `atexit`-registers its shutdown.
  Under a multi-worker WSGI server it starts once per worker and every worker races to auto-resolve the
  same conflicts. Currently masked by the single-process dev server. Decide deliberately where it lives.
- **`CORS(app)`** is applied with no arguments — all origins, all routes. Keep it as-is unless the
  frontend's `VITE_API_URL` origin is pinned.
- **`models.Base.metadata.create_all(bind=engine)`** runs at import (`app.py:30`).
- **`import test_model`** at line 4 loads TensorFlow and the `.h5` weights at import time — this is why
  app startup is slow, and why importing `app.py` from a test or a migration script is expensive. Keep the
  import at module scope in whatever module owns `/predict`, or startup timing changes.
- **`MAX_CONTENT_LENGTH = 10 MB`** — oversized uploads get Flask's HTML 413, never the envelope.

---

## Appendix — full route index by line number

| # | Line | Method(s) | Path | Decorator | Blueprint |
|---|---|---|---|---|---|
| 1 | 224 | GET | `/static/uploads/<path:filename>` | none | media |
| 2 | 263 | POST | `/register` | none | auth |
| 3 | 358 | POST | `/verify-otp-email` | none | auth |
| 4 | 398 | POST | `/resend-otp` | none | auth |
| 5 | 455 | POST | `/login` | none | auth |
| 6 | 508 | POST | `/forgot-password` | none | auth |
| 7 | 548 | POST | `/reset-password` | none | auth |
| 8 | 600 | POST | `/predict` | `@patient_required` | scans |
| 9 | 754 | POST | `/send_report` | `@patient_required` | scans |
| 10 | 857 | GET | `/api/scans/<int:scan_id>/report-status` | `@patient_required` | scans |
| 11 | 882 | POST | `/api/override-severity/<int:scan_id>` | `@doctor_required` | scans |
| 12 | 922 | PUT | `/doctor/update_scan/<int:scan_id>` | `@doctor_required` | scans |
| 13 | 993 | DELETE | `/doctor/delete_scan/<int:scan_id>` | `@doctor_required` | scans |
| 14 | 1036 | GET | `/patient/scans/<int:user_id>` | `@patient_required` | scans |
| 15 | 1096 | GET | `/doctor/scans/<int:doctor_id>` | `@doctor_required` | scans |
| 16 | 1181 | GET | `/api/doctors/public` | none | doctors |
| 17 | 1272 | GET | `/api/doctors` | none | doctors |
| 18 | 1280 | GET | `/api/doctor-updates-stream/<int:doctor_id>` | none | streams |
| 19 | 1421 | GET | `/api/patient-updates-stream/<int:patient_id>` | none | streams |
| 20 | 1589 | GET | `/admin/stats` | `@admin_required` | admin |
| 21 | 1613 | GET | `/admin/doctors` | `@admin_required` | admin |
| 22 | 1664 | PUT | `/admin/doctors/<int:doctor_id>/verify` | `@admin_required` | admin |
| 23 | 1711 | DELETE | `/admin/doctors/<int:doctor_id>` | `@admin_required` | admin |
| 24 | 1928 | POST | `/api/update-availability` | `@doctor_required` | schedule |
| 25 | 2034 | GET | `/api/doctor-availability/<int:doctor_id>` | none | schedule |
| 26 | 2076 | POST | `/api/update-fees` | `@doctor_required` | schedule |
| 27 | 2119 | GET | `/api/doctor-fees/<int:doctor_id>` | none | schedule |
| 28 | 2264 | GET | `/api/slots/<int:doctor_id>` | none | schedule |
| 29 | 2283 | POST | `/api/book-slot` | `@patient_required` | appointments |
| 30 | 2514 | PUT | `/api/resolve-conflict/<int:appointment_id>` | `@doctor_required` | appointments |
| 31 | 2673 | GET | `/api/doctor-appointments/<int:doctor_id>` | `@doctor_required` | appointments |
| 32 | 2760 | GET | `/api/patient-appointments/<int:patient_id>` | `@patient_required` | appointments |
| 33 | 2859 | PUT | `/api/update-appointment/<int:appt_id>` | `@doctor_required` | appointments |
| 34 | 2937 | DELETE | `/api/delete-appointment/<int:appt_id>` | `@doctor_required` | appointments |
| 35 | 2974 | POST | `/api/chat` | `@token_optional` | chat |
| 36 | 3018 | POST | `/api/rate-doctor` | `@patient_required` | ratings |
| 37 | 3079 | GET | `/api/doctor/ratings` | `@doctor_required` | ratings |
| 38 | 3120 | GET | `/doctor/ratings/<int:doctor_id>` | none | ratings |
| 39 | 3162 | GET, POST | `/api/doctor/profile` | `@doctor_required` | doctors |

Shared helpers that are **not** routes but are imported by them, and therefore need a home in the new
package layout: `allowed_file` (51), `generate_response` (54), `sort_appointments_by_priority` (65),
`get_token_data` (93) + the five decorators (99-192), `send_email` (198), `_is_otp_valid` (237),
`TriageService` (675), `expand_and_standardize_days` (1744), `validate_schedule_slots` (1792),
`_time_str_to_minutes` (1829), `find_appointments_orphaned_by_schedule_change` (1843),
`_generate_slots_for_date` (2149), `find_next_available_slots` (2237), `_resolve_conflict_pair` (2454),
`parse_appointment_datetime` (2580), `resolve_expired_conflicts` (2597).

---
---

# Part 2A-1 — the `/auth` session & consent layer (additive)

**Status: frozen.** Everything in this part is **new**. The 39 routes above keep their exact paths,
methods, status codes and JSON keys; nothing here replaces any of them. The unified `/auth` screen
(next phase) consumes this surface, and the existing React pages keep calling the legacy six untouched.

Owner blueprint: `app/api/auth/routes.py`. Services: `app/services/{auth_service,otp_service,consent_service}.py`.
Migration: `8a1c4b0d55e2` (data only).

| Path | Method | Auth | Purpose |
|---|---|---|---|
| `/auth/check-email` | POST | none | which of three doors to open |
| `/auth/register` | POST | none | account + doctor profile + consents, one call |
| `/auth/login` | POST | none | access **+ refresh** + canonical session |
| `/auth/verify-otp` | POST | none | purpose-scoped OTP redemption |
| `/auth/resend-otp` | POST | none | purpose-scoped reissue, 45 s cooldown |
| `/auth/forgot-password` | POST | none | purpose-scoped, non-enumerating |
| `/auth/reset-password` | POST | none | consumes a `reset` code, ends all sessions |
| `/auth/me` | GET | **required** | THE canonical identity payload |
| `/auth/refresh` | POST | none | rotate the refresh token |
| `/auth/logout` | POST | optional | revoke **this** refresh token |
| `/auth/logout-all` | POST | **required** | bump `users.token_version` |
| `/auth/consent-documents` | GET | none | what the signup form must render |
| `/auth/consents` | POST | **required** | record acceptance / re-consent |

All 13 use the standard envelope (`generate_response`). Neither envelope-breaker (`/doctor/update_scan/<id>`
flat dict, `/api/slots/<id>` bare array) is touched.

---

## Tokens

### Access token (JWT, HS256)

```json
{"user_id": 12, "role": "Doctor", "tv": 0, "jti": "…", "typ": "access", "iat": …, "exp": …}
```

`user_id` and `role` keep their **exact** legacy names and meanings — the frontend decodes `role`
client-side and every decorator reads `user_id`. `ACCESS_TOKEN_HOURS` stays **24**; the drop to 2 h happens
once the frontend has a refresh timer.

**BACK-COMPAT RULE (load-bearing, do not tighten):** tokens minted before this phase carry only
`{user_id, role, exp}`. Every reader treats a **missing `tv` as 0** and a **missing `typ` as `'access'`**
(`app/core/security.claim_token_version` / `claim_token_type`). Anything stricter signs out every person
currently logged in. A token is rejected when `typ` is present and is not `'access'`, when the account is
inactive, or when `tv` is behind `users.token_version`.

### Refresh token (opaque)

`secrets.token_urlsafe(64)`, **only its sha256 is stored** in `refresh_tokens.token_hash`, 30-day expiry
(`REFRESH_TOKEN_DAYS`), **rotated on every use**.

- Rotation records `replaced_by_id` on the old row.
- Presenting a row that already has `replaced_by_id` ⇒ two parties hold one token ⇒ **the whole family for
  that user is revoked** and the response is 401. That is the standard theft signal.
- Presenting a row that is merely `revoked_at` (a plain `/auth/logout`, or an earlier family revocation) is
  a plain 401 — it must **not** cascade, or logging out on a phone would sign you out on the laptop.

`/auth/logout-all` and a successful password reset bump `users.token_version`, which invalidates every
**access** token ever issued for that account with no blocklist and no shared cache.

---

## `POST /auth/check-email`

Request `{"email": "…"}` → **200**

```json
{"success": true, "data": {"status": "new", "next": "signup"}}
```

| `status` | `next` | meaning |
|---|---|---|
| `new` | `signup` | no account |
| `unverified` | `otp` | account exists, email never confirmed |
| `existing` | `password` | account exists and is usable |

`data` contains **exactly these two keys, always**. Never the name, never the role, never the doctor
verification state — the endpoint is unauthenticated, and anything richer makes it a directory scraper.
Lookup is case-insensitive. Missing `email` ⇒ 400. The handler pads every response to a **60 ms floor**
(`CHECK_EMAIL_MIN_SECONDS`) so the timing does not leak what the body deliberately rations.

## `POST /auth/register`

```json
{
  "name": "…", "email": "…", "password": "…",
  "role": "AI User" | "Doctor",
  "doctor": {"license": "…", "specialty": "…", "hospital": "…", "city": "…",
             "phone": "…", "experience": 7, "latitude": 31.5, "longitude": 74.3},
  "consents": [{"type": "terms_of_use", "version": "1", "granted": true}]
}
```

**201** `{"success":true,"message":"OTP sent to email","data":{"email","role","next":"otp","otp_purpose":"signup"}}`

- `role` is whitelisted to `('AI User','Doctor')`; **anything else — including `"Admin"` — is coerced to
  `'AI User'` and logged.** Admin remains impossible to self-register.
- Flat top-level `license` / `specialty` / … are still accepted as a fallback, so the legacy body shape works.
- Missing mandatory consents ⇒ **400** `{"error":"You must accept the required agreements to create an
  account.","data":{"missing_consents":["terms_of_use",…]}}`. `{"granted": false}` is an explicit refusal,
  not a shortcut.
- Password policy is **unconditional** here (no legacy escape hatch).
- Doctor rows are created `verification_status='pending'`; a missing licence ⇒ 400
  `PMDC license number is required for doctor registration`, a duplicate ⇒ 400
  `This license number is already registered.`
- One atomic transaction, committed **after** the OTP email succeeds; a failed send rolls everything back
  (no ghost user rows).
- Unknown consent types are **ignored, not rejected** — a client on a newer build must still be able to register.

## `POST /auth/login`

Request `{"email","password"}` (a `role` field is accepted and **always ignored**) → **200**

```json
{"success": true, "data": {
  "token": "<JWT>", "refresh_token": "<opaque>", "token_type": "Bearer", "expires_in": 86400,
  "user": {"id","name","email","role","joined_at"[,"verification_status"]},
  "session": { …the /auth/me payload… }
}}
```

`data.user` is byte-for-byte the shape legacy `/login` returns (including `verification_status` **only** for
Doctors), so a client can migrate one call at a time.

- 401 `Invalid credentials` — identical for a wrong password and an unknown email.
- 403 `This account has been deactivated.` when `is_active` is false.
- 403 `Please verify your email first` **plus** `data:{"next":"otp","otp_purpose":"signup","email":…}` so the
  unified screen jumps to the OTP step instead of dead-ending on a toast.
- Records `users.last_login_at` / `last_login_ip`.

## `GET /auth/me` — **THE CANONICAL SHAPE (frozen)**

```json
{"success": true, "data": {
  "user":   {"id": 12, "name": "…", "email": "…", "role": "Doctor",
             "joined_at": "Jul 2026", "is_active": true},
  "doctor": {"verification_status": "approved", "verification_note": null,
             "license": "PMDC-…", "specialty": "Dermatology", "profile_image": "/static/uploads/x.jpg"},
  "permissions": ["appointment.book", "scan.create", …],
  "workspaces": [{"key": "doctor", "label": "Doctor Dashboard", "route": "/doctor-dashboard"},
                 {"key": "patient", "label": "My Scans", "route": "/my-reports"}],
  "home_route": "/doctor-dashboard",
  "pending_consents": [{"type": "terms_of_use", "version": "2",
                        "title": "Terms of Use", "url_path": "/terms-of-use"}]
}}
```

Six keys, no more, no fewer. Sub-shapes:

- `user` — exactly 6 keys. `joined_at` reuses the `/login` formatter (`'%b %Y'`, literal `'Jan 2024'` fallback).
- `doctor` — exactly 5 keys **for a Doctor**, `null` for every other role. A Doctor with no profile row still
  gets the shape, with `verification_status: "pending"`.
- `permissions` — sorted `Permission.value` strings for the role. Client-side UI gating only; the server
  re-checks every one of them.
- `workspaces` — the surfaces this ONE account may open, **primary first**. Patient `[patient]`, Doctor
  `[doctor, patient]`, Admin `[admin]`. The Doctor pair is what removes the second-account workaround:
  because `ROLE_PERMISSIONS` is a real hierarchy, a Doctor genuinely holds every Patient permission and can
  scan and book on their own login.

  **An Admin gets one, not three** (changed). By permission an admin "has" the doctor and patient surfaces too,
  but no `doctor_profiles` row exists behind an admin account, so both listed nothing — no referrals, no
  schedule, no ratings, no scans — for ever. An admin reaches a *real* doctor or patient surface with
  `X-Act-As-User-Id`, where the data is the target's and every request writes an `audit_logs` row.
  `permissions` is **unchanged** and still contains `schedule.manage`, `scan.create` and the rest: capability
  is not what moved, only what the client offers as a destination.
- `home_route` — `workspaces[0].route`; `"/"` for an unmapped role (never a 500).
- `pending_consents` — **MANDATORY documents only**, and only those not granted at the *current* version. An
  unaccepted **optional** document is never listed: the user already answered, and re-asking forever is a
  dark pattern.

The same object is embedded as `data.session` by `/auth/login`, `/auth/verify-otp` (purpose `signup`) and
`/auth/refresh`, so the client has exactly one parser for "who am I".

Reads the **effective** actor, so `X-Act-As-User-Id` returns the impersonated user's session.

## `POST /auth/verify-otp`

Request `{"email","otp","purpose"}` — `purpose` defaults to `signup`; an unrecognised value is a **400**,
never a silent downgrade.

| purpose | consumes the code? | effect |
|---|---|---|
| `signup` | yes | `is_verified = true`, and the response carries `token` + `refresh_token` + `session` + `user` (verifying signs you in — the OTP proved the inbox and the password was already chosen) |
| `reset` | **no** | validates only, so `/auth/reset-password` can still consume it; response `data.next = "new_password"` |
| `email_change` | yes | moves `users.pending_email` into `users.email`; 400 when nothing is pending |

Failure ⇒ 400 with the OTP error string (see below). Wrong guesses count against the row either way.

## `POST /auth/resend-otp`

`{"email","purpose"}` → 200 `A new OTP has been sent to your email.` with `data.purpose`.
429 `Please wait {n}s before requesting another OTP.` inside the **per-purpose** cooldown.
`purpose=signup` on an already-verified account ⇒ 400 `This account is already verified. Please login.`

## `POST /auth/forgot-password`

`{"email"}` → **always 200**:

```json
{"success":true,"message":"If that email is registered, a password reset code has been sent.",
 "data":{"next":"otp","otp_purpose":"reset","email":"…"}}
```

Unlike legacy `/forgot-password` (which 404s with `This email is not registered with us.`) this never
confirms or denies existence — `/auth/check-email` is the single, rate-limited, timing-padded place that
answers that question. 429 inside the cooldown.

## `POST /auth/reset-password`

`{"email","otp","new_password"}` → 200 `Password updated successfully!`, `data.next = "password"`.
Consumes the `reset` code, applies the password policy **before** touching the code (so a rejected weak
password does not burn the OTP), sets `is_verified = true`, invalidates every outstanding OTP, and bumps
`token_version` + revokes all refresh rows (`REVOKE_SESSIONS_ON_PASSWORD_RESET`, default on) so a session
stolen *before* the reset cannot outlive it.

## `POST /auth/refresh`

`{"refresh_token"}` → 200 `{token, refresh_token, token_type, expires_in, session}` — a **new** pair; the
presented token is dead afterwards. 400 without a token, 401 for anything invalid, expired, revoked or
already rotated.

## `POST /auth/logout` / `POST /auth/logout-all`

- `/auth/logout` `{"refresh_token"}` → **always 200** `{"data":{"revoked":true|false}}`. Auth is optional so
  a client whose access token already expired can still hand the refresh token back; always-200 avoids a
  probe oracle.
- `/auth/logout-all` (authenticated, no body) → 200 `{"data":{"token_version":1,"sessions_revoked":2}}`.
  Kills every access **and** refresh token for the account.

## `GET /auth/consent-documents`

`?role=Doctor` optional → `{"data":{"documents":[{type,version,title,url_path,mandatory}],
"password_policy":{"min_length":8,"rules":[…]}}}`. Falls back to the code catalogue when
`consent_documents` has not been seeded, so a fresh database still produces a usable signup form rather than
an empty list that silently lets everyone past the mandatory gate.

## `POST /auth/consents`

Authenticated. `{"consents":[{type,version,granted}], "source":"stepper"}` (a single `{type,…}` object is
also accepted) → `{"data":{"recorded":1,"pending_consents":[…]}}`. Empty/missing array ⇒ 400.
**Append-only:** re-granting writes a NEW row and stamps the previous one `revoked_at`; nothing is ever
edited in place, because the point is reconstructing what was agreed on a given date.

---

## OTP mechanics (rewritten — `email_otps`, purpose-scoped)

`OTP_EXPIRY_MINUTES = 10`, `OTP_MAX_ATTEMPTS = 5` (**per row**), `OTP_RESEND_COOLDOWN_SECONDS = 45`
(**per purpose**), 6 digits from `secrets.randbelow(900000)+100000`.

- Purposes: `signup` | `reset` | `email_change` (CHECK-constrained). A code issued for one purpose can
  **never** be redeemed for another. Previously all three shared `users.otp_code`, so a "reset your password"
  code activated an account and each flow clobbered the other's code.
- Stored as `sha256(code + SECRET_KEY)`; compared with `hmac.compare_digest`. The plaintext exists only in
  the email.
- Error strings (unchanged wording): `No active OTP. Please request a new one.` /
  `Too many incorrect attempts. Please request a new OTP.` / `OTP has expired. Please request a new one.` /
  `Invalid OTP` / `Please wait {n}s before requesting another OTP.`
- **Legacy dual-write, ONE RELEASE ONLY:** every issue also writes `users.otp_code/otp_created_at/otp_attempts`,
  and `verify_otp` falls back to that column **only when the user has no `email_otps` row at all** — i.e. only
  for a code that was mailed before this deploy. Once any row exists the legacy column is treated as the
  dual-write shadow it is, so it cannot be used to cross purposes.

## Password policy (`auth_service.validate_password`)

Minimum 8 characters, not all digits, not in a ~50-entry common-password list (case-insensitive).
Applied where a password is **chosen** — `/auth/register`, `/auth/reset-password`, and (gated by
`ENFORCE_PASSWORD_POLICY_LEGACY`, default **on**) legacy `/register` and `/reset-password`.
**Never applied to an existing password**: weak passwords already in the database keep working, on both
login routes. Errors: `Password must be at least 8 characters.` / `Password cannot be all numbers.` /
`That password is too common. Please choose another.` / `Password is required.`

## Rate limits (Flask-Limiter)

Off unless `RATELIMIT_ENABLED` (**false** in dev and test, **true** in production). Two independent windows
per endpoint: per-IP (one machine) and per-email (one account, which is what survives a rotating IP pool).

| Endpoint | per IP | per email |
|---|---|---|
| `/login`, `/auth/login` | 30/min, 200/hour | 10/min, 50/hour |
| `/auth/check-email` | 60/min, 600/hour | — |
| `/register`, `/auth/register` | 10/min, 40/hour | 5/min, 20/hour |
| `/forgot-password`, `/auth/forgot-password` | 10/min, 40/hour | 3/min, 10/hour |
| `/resend-otp`, `/auth/resend-otp` | 10/min, 60/hour | 5/min, 20/hour |
| `/verify-otp-email`, `/auth/verify-otp` | 20/min, 120/hour | 10/min, 40/hour |
| `/reset-password`, `/auth/reset-password` | 10/min, 40/hour | 3/min, 10/hour |
| `/auth/refresh` | 60/min, 600/hour | — |

Budgets are **per endpoint**: spending the forgot-password budget never blocks a login. A demo (8 logins,
20 check-emails in a minute) never trips anything. 429 responses are the JSON envelope
(`{"success":false,"error":"Too many attempts. Please wait a moment and try again."}`) plus a `Retry-After`
header in seconds. `memory://` storage is **per process** — point `RATELIMIT_STORAGE_URI` at redis before
treating this as a real defence.

## Consent catalogue (v1)

Seeded by `scripts/seed_consent_docs.py` (idempotent). `mandatory` lives in **code**
(`consent_service.CONSENT_SPECS`), not in the table, so whether a consent is refusable is reviewable in a diff.

| type | v | mandatory | roles |
|---|---|---|---|
| `terms_of_use` | 1 | yes | all |
| `privacy_policy` | 1 | yes | all |
| `medical_data_processing` | 1 | yes | all |
| `license_attestation` | 1 | yes | **Doctor only** |
| `doctor_data_sharing` | 1 | no | all |
| `marketing_email` | 1 | no (opt-in) | all |

`marketing_email` is mirrored onto `users.marketing_opt_in` (a cache, not the record).
Publishing v2 of a mandatory document makes it appear in `pending_consents` for everyone who granted v1.

---

## Doctor verification

**User decision: auto-approve existing, enforce for new.** Migration `8a1c4b0d55e2` flips every
pre-existing `doctor_profiles` row that is neither `approved` nor `rejected` to `approved`, writes a
`verification_note` identifying itself, and prints the count. `rejected` rows are **left alone** — that
status is a human decision, not an absence of one. `ENFORCE_DOCTOR_VERIFICATION` defaults to **true**, so
only doctors who register from now on are gated. Read routes stay open (a pending doctor must be able to log
in, see `/auth/me`, and render the pending screen); `require_permission(require_doctor_approved=True)`
belongs on doctor **write** routes only.

## What changed inside the legacy six (nothing above changed shape)

1. OTP storage moved to `email_otps` (dual-written, fallback as described above).
2. **`/forgot-password` is now cooldown-gated** — the one visible change. It used to call `stamp_new_otp`,
   which resets `otp_attempts` to 0, with no cooldown, so the 5-attempt lockout could be cleared instantly
   and indefinitely for free. It now answers **429** `Please wait {n}s before requesting another OTP.` inside
   the 45 s window.
3. The password policy runs on `/register` and `/reset-password` (`ENFORCE_PASSWORD_POLICY_LEGACY`).
4. Rate limits attached (inert unless enabled).
5. Response-invisible: a successful `/login` records `last_login_at`/`last_login_ip`; a successful
   `/reset-password` bumps `token_version`.
6. `/login`'s access token now carries the user's live `tv` (it must, or a token minted there would be dead
   on arrival for anyone whose version was ever bumped).

Response bodies, status codes and error strings for all six are otherwise unchanged.

---

# Phase 3C — Image privacy (ADDITIVE)

Nothing in the frozen 39 changed shape. Every scan payload gained **four keys**; no key was renamed,
moved or removed, and `image_url` keeps its existing per-endpoint form in all three variations
(raw / `"/"`-prefixed / raw-inside-`scan_info`).

## The four added keys

Emitted by `/predict`, `/patient/scans/<id>`, `/doctor/scans/<id>`, `/admin/scans`, both SSE streams
(scan lists and `scan_info`), and every new endpoint below.

| key | type | meaning |
|---|---|---|
| `is_sensitive` | bool | patient marked this photo sensitive; render the placeholder, request `variant=blur` |
| `image_deleted_at` | ISO-8601 \| null | the patient deleted the pixels; the record is intact |
| `has_image` | bool | `image_url` is set **and** not deleted |
| `image_endpoint` | string \| null | `/api/scans/<id>/image`, or **null** when `has_image` is false |

`image_endpoint` is null rather than a dead URL so no client ever renders an `<img>` that is
guaranteed to 404.

## New endpoints

| method | path | auth | returns |
|---|---|---|---|
| GET | `/api/scans/<id>/image?variant=thumb\|blur\|full` | `can_view` | **raw bytes** |
| GET | `/api/scans/<id>/attachments` | `can_view` | `data: [attachment]` |
| GET | `/api/scans/<id>/attachments/<att_id>/image?variant=` | `can_view` | **raw bytes** |
| PATCH | `/api/scans/<id>/sensitivity` | owner or Admin | `data: {scan_id, is_sensitive, sensitivity_reason, default_variant, + 4 keys}` |
| DELETE | `/api/scans/<id>/image` | owner or `scan.delete.any` | `data: {scan_id, image_deleted_at, image_delete_reason, purged_files, attachments_deleted, retained[], + 4 keys}` |
| GET | `/api/scans/<id>/access-log` | owner or Admin | `data: [{id, viewer_id, viewer_name, viewer_role, variant, attachment_id, ip, viewed_at}]` |
| DELETE | `/api/admin/scans/<id>` | Admin (`scan.delete.any`) | `data: {scan_id, purged_files}` |

### `can_view` — the ONE predicate (`app/services/image_service.py`)

Union of: `scan.user_id == actor.id` **OR** `scan.doctor_id == actor.id` **OR** a row in
`appointment_request_doctors` JOIN `appointment_requests` where `request.scan_id == scan.id`,
`ard.doctor_id == actor.id` and `ard.response != 'Withdrawn'` **OR** `Permission.SCAN_READ_ANY`.
The third clause is mandatory: a patient may invite three doctors, but `ai_scans.doctor_id` holds one.

### Image response

Not JSON on success. Headers: `X-Image-Variant` (what was actually served, which may differ from what
was asked for), `X-Image-Sensitive` (`1`/`0`), `Cache-Control: private, no-store` on `full` and
`private, max-age=300` on `thumb`/`blur`.

Status codes: **403** = the scan exists and you may not see it. **404** = image deleted, file missing,
or (for a sensitive scan) no privacy-safe preview could be produced. **400** = unknown `variant`.
**401** = no token.

Variant selection: no `variant` param means `full`, except for a **sensitive** scan viewed by anyone
other than the owner, where it means `blur` — and `variant=thumb` is upgraded to `blur` for that
viewer too. `variant=full` on a sensitive scan is honoured only when asked for explicitly, and every
`full` view writes an `image_access_log` row (`thumb`/`blur` do not).

### Deletion semantics

`DELETE /api/scans/<id>/image` takes `{reason, consent_ack: true, confirm_text: "DELETE"}` and keeps the
`ai_scans` row plus `prediction_result`, `confidence`, `severity_level`, `triage_score`,
`triage_reasons`, `doctor_comment`, `patient_questionnaire` and all linked appointments/ratings. It
purges main + thumb + blur (and every attachment's files) from disk, writes
`user_consents(consent_type='image_deletion', target_ref='scan:<id>')` and
`audit_logs(action='scan.image_delete')`. It returns **409** while a `Scheduled` / `Pending-Conflict`
appointment still references the scan, and **409** if the image is already deleted.

### `/static/uploads/<file>` — deprecated, still serving

`create_app()` now sets `static_folder=None`, so Flask's built-in `/static/<path:filename>` rule is
gone. `/static/./uploads/<f>`, `/static/uPloads/<f>` and `/static/UPLOADS/<f>` returned full-resolution
patient photographs before that change; all three are 404 now. The canonical
`/static/uploads/<file>` still serves every byte to anyone (the current pages build raw `<img src>`
URLs and cannot send a bearer token) but responds with `Deprecation: true` and a `Link` header
pointing at `/api/scans/<id>/image`. Migrate reads to `image_endpoint`.
