"""
Response shaping helpers.

Every dict this module builds is a WIRE CONTRACT. The frontend indexes these
keys directly, so a key may be added only by adding a new endpoint, never by
"cleaning up" an existing one.

DUPLICATED KEYS THAT MUST ALL STAY
----------------------------------
  * /api/doctors/public       : specialty AND specialization (same value)
                                rating   AND average_rating  (same value)
  * scan listings             : id AND scan_id (same value)
  * /api/patient-appointments : date/time AND slot_date/slot_time
                                rating/review AND patient_rating/patient_review
  * the two ratings GETs      : {average,total} vs {average_rating,rating_count}
                                wrapping the IDENTICAL review list

FALLBACK VALUES DIFFER BY ENDPOINT ON PURPOSE
---------------------------------------------
  * fees:  null in /api/doctors/public, 0.0 in /api/patient-appointments
  * duration: '30min' everywhere EXCEPT /api/slots, which uses '60min'
  * patient_name: 'Unknown' in /doctor/scans, 'Unknown Patient' in
    /api/doctor-appointments
Do not unify them.

This module intentionally ships only the helpers that are provably shared. The
per-route dict literals stay inside their routes.py, where they can be diffed
line-by-line against legacy/app_monolith.py.
"""

import json

# ----------------------------------------------------------------------
# Timestamps -- three different formats are in use, all load-bearing.
# ----------------------------------------------------------------------
JOINED_AT_FORMAT = "%b %Y"          # /login user.joined_at  -> "Jul 2026"
ADMIN_DATE_FORMAT = "%Y-%m-%d %H:%M"  # /admin/doctors created_at & verified_at
REVIEW_DATE_FORMAT = "%b %d, %Y"    # rating list `date`


def iso(dt):
    """ISO-8601 or None. The default for created_at/updated_at in scan lists."""
    return dt.isoformat() if dt else None


def joined_at(dt):
    """/login only. The monolith falls back to the LITERAL string 'Jan 2024'
    when created_at is null -- not to null, not to today."""
    try:
        return dt.strftime(JOINED_AT_FORMAT) if dt else "Jan 2024"
    except (AttributeError, ValueError):
        return "Jan 2024"


def admin_datetime(dt):
    """/admin/doctors uses strftime('%Y-%m-%d %H:%M'), NOT isoformat()."""
    return dt.strftime(ADMIN_DATE_FORMAT) if dt else None


def review_date(dt):
    return dt.strftime(REVIEW_DATE_FORMAT) if dt else None


# ----------------------------------------------------------------------
# Image URLs -- see storage_service for the full explanation.
# ----------------------------------------------------------------------
def image_url_raw(stored):
    """/predict and /api/patient-appointments scan_info: NO leading slash."""
    return stored or ""


def image_url_slashed(stored):
    """/patient/scans, /doctor/scans and both SSE streams: WITH leading slash.
    The monolith writes `'/' + scan.image_url if scan.image_url else ''`."""
    if not stored:
        return ""
    return "/" + stored if not stored.startswith("/") else stored


def profile_image_url(stored):
    """/api/doctors/public and /api/doctor/profile: '/'-prefixed or NULL --
    note this one falls back to None, not to ''."""
    if not stored:
        return None
    return "/" + stored if not stored.startswith("/") else stored


# ----------------------------------------------------------------------
# JSON text columns
# ----------------------------------------------------------------------
def parse_json_field(raw, default=None):
    """questionnaire_answers / triage_reasons are TEXT columns holding JSON.

    Failure behaviour differs by endpoint and is preserved by the caller
    passing the right `default`:
      * /doctor/scans          questionnaire_answers -> None on failure
      * /api/doctor-appointments triage_reasons      -> []  on failure
    """
    if not raw:
        return default
    try:
        return json.loads(raw)
    except (ValueError, TypeError):
        return default


def dumps_json_field(value):
    return json.dumps(value) if value is not None else None


# ----------------------------------------------------------------------
# Misc
# ----------------------------------------------------------------------
def duration_minutes(duration_str, default=60):
    """'30min' -> 30. Mirrors the monolith's
    int(''.join(filter(str.isdigit, duration_str)))."""
    if not duration_str:
        return default
    try:
        digits = ''.join(filter(str.isdigit, str(duration_str)))
        return int(digits) if digits else default
    except (TypeError, ValueError):
        return default


def round2(value):
    """Confidence is stored and served 0-100 with 2 decimals."""
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return 0.0


__all__ = [
    "JOINED_AT_FORMAT",
    "ADMIN_DATE_FORMAT",
    "REVIEW_DATE_FORMAT",
    "iso",
    "joined_at",
    "admin_datetime",
    "review_date",
    "image_url_raw",
    "image_url_slashed",
    "profile_image_url",
    "parse_json_field",
    "dumps_json_field",
    "duration_minutes",
    "round2",
]
