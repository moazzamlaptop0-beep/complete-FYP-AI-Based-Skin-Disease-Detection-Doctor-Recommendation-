"""
The string literal sets stored in the database.

These are plain Python constants, NOT SQL ENUM types: every column involved is
a String and the values are compared with `==` all over the ported code. Making
them real Postgres enums would require a migration on every value change and
would break the free-text legacy rows.

NEVER rename or re-case anything in this file. The React frontend compares
against these exact strings.
"""

# users.role -- also the JWT `role` claim.
ROLE_ADMIN = "Admin"
ROLE_DOCTOR = "Doctor"
ROLE_PATIENT = "AI User"
ROLE_LEGACY_PATIENT = "Patient"          # dead branch preserved (monolith:182)
ROLES = (ROLE_ADMIN, ROLE_DOCTOR, ROLE_PATIENT)

# Roles /register will accept from the public. Anything else is coerced to
# 'AI User' (monolith register()).
REGISTERABLE_ROLES = (ROLE_PATIENT, ROLE_DOCTOR)

# ai_scans.status / ai_scans.review_status
SCAN_STATUS_LOCAL = "Local"              # created by /predict, not yet sent
SCAN_STATUS_PENDING = "Pending"          # sent to a doctor, awaiting review
SCAN_STATUS_REVIEWED = "Reviewed"
SCAN_STATUSES = (SCAN_STATUS_LOCAL, SCAN_STATUS_PENDING, SCAN_STATUS_REVIEWED)

# ai_scans.severity_level (TriageService tiers)
SEVERITY_ROUTINE = "ROUTINE"
SEVERITY_URGENT = "URGENT"
SEVERITY_CRITICAL = "CRITICAL"
SEVERITY_LEVELS = (SEVERITY_ROUTINE, SEVERITY_URGENT, SEVERITY_CRITICAL)
SEVERITY_RANK = {SEVERITY_ROUTINE: 0, SEVERITY_URGENT: 1, SEVERITY_CRITICAL: 2}

# appointments.status
APPT_SCHEDULED = "Scheduled"
APPT_CONFIRMED = "Confirmed"
APPT_COMPLETED = "Completed"
APPT_CANCELLED = "Cancelled"
APPT_PENDING_CONFLICT = "Pending-Conflict"
APPT_REASSIGNED = "Reassigned"
APPOINTMENT_STATUSES = (
    APPT_SCHEDULED, APPT_CONFIRMED, APPT_COMPLETED,
    APPT_CANCELLED, APPT_PENDING_CONFLICT, APPT_REASSIGNED,
)
# Only these four can be set through /api/update-appointment.
SETTABLE_APPOINTMENT_STATUSES = (APPT_SCHEDULED, APPT_CONFIRMED, APPT_COMPLETED, APPT_CANCELLED)
# Statuses that occupy a slot for the double-booking unique index.
SLOT_BLOCKING_STATUSES = (APPT_SCHEDULED, APPT_PENDING_CONFLICT)

# doctor_profiles.verification_status -- lowercase, always.
VERIFICATION_PENDING = "pending"
VERIFICATION_APPROVED = "approved"
VERIFICATION_REJECTED = "rejected"
VERIFICATION_STATUSES = (VERIFICATION_PENDING, VERIFICATION_APPROVED, VERIFICATION_REJECTED)

# email_otps.purpose -- purpose-scoped so a signup OTP and a password-reset OTP
# can coexist instead of clobbering the single users.otp_code column.
OTP_PURPOSE_SIGNUP = "signup"
OTP_PURPOSE_RESET = "reset"
OTP_PURPOSE_EMAIL_CHANGE = "email_change"
OTP_PURPOSES = (OTP_PURPOSE_SIGNUP, OTP_PURPOSE_RESET, OTP_PURPOSE_EMAIL_CHANGE)

# appointment_requests.status
REQUEST_OPEN = "Open"
REQUEST_MATCHED = "Matched"
REQUEST_WITHDRAWN = "Withdrawn"
REQUEST_EXPIRED = "Expired"
REQUEST_DECLINED = "Declined"
REQUEST_STATUSES = (REQUEST_OPEN, REQUEST_MATCHED, REQUEST_WITHDRAWN, REQUEST_EXPIRED, REQUEST_DECLINED)

# appointment_request_doctors.response
RESPONSE_PENDING = "Pending"
RESPONSE_ACCEPTED = "Accepted"
RESPONSE_DECLINED = "Declined"
RESPONSE_WITHDRAWN = "Withdrawn"
REQUEST_DOCTOR_RESPONSES = (RESPONSE_PENDING, RESPONSE_ACCEPTED, RESPONSE_DECLINED, RESPONSE_WITHDRAWN)

# user_consents.consent_type -- THE single source of truth for these literals.
#
# These values are persisted in user_consents.consent_type and, for the policy
# documents, in consent_documents.consent_type (seeded by
# scripts/seed_consent_docs.py). Changing a string here orphans every existing
# row, so treat them as data, not as names.
#
# This block previously held placeholder values invented before the consent
# work landed ("terms", "share_scan", "image_delete"). None of them matched
# what the code actually wrote ("terms_of_use", "scan_share", "image_deletion"),
# so a lookup by constant silently returned nothing while a lookup by literal
# worked -- the worst kind of mismatch, because both sides looked correct.

# Policy documents: versioned, presented at signup, re-prompted on version bump.
CONSENT_TERMS = "terms_of_use"
CONSENT_PRIVACY = "privacy_policy"
CONSENT_MEDICAL_DATA = "medical_data_processing"
CONSENT_LICENSE_ATTESTATION = "license_attestation"
CONSENT_DOCTOR_DATA_SHARING = "doctor_data_sharing"
CONSENT_MARKETING = "marketing_email"

POLICY_CONSENT_TYPES = (
    CONSENT_TERMS,
    CONSENT_PRIVACY,
    CONSENT_MEDICAL_DATA,
    CONSENT_LICENSE_ATTESTATION,
    CONSENT_DOCTOR_DATA_SHARING,
    CONSENT_MARKETING,
)

# Per-object consents: recorded against a specific row via
# user_consents.target_ref (e.g. "scan:1234"), not versioned policy documents.
CONSENT_SHARE_SCAN = "scan_share"
CONSENT_IMAGE_DELETE = "image_deletion"

OBJECT_CONSENT_TYPES = (CONSENT_SHARE_SCAN, CONSENT_IMAGE_DELETE)

CONSENT_TYPES = POLICY_CONSENT_TYPES + OBJECT_CONSENT_TYPES

# image_access_log.variant
IMAGE_VARIANT_FULL = "full"
IMAGE_VARIANT_BLUR = "blur"
IMAGE_VARIANT_THUMB = "thumb"
