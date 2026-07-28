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
from datetime import timedelta, timezone

# ----------------------------------------------------------------------
# Timestamps -- three different formats are in use, all load-bearing.
#
# WALL-CLOCK RULE (July 2026): every DateTime column in this schema stores
# naive UTC, but the strings we serve carry NO offset and the frontend parses
# them as local Pakistan time -- so a just-created row used to read as
# "5 hours ago". User-facing STORED timestamps are therefore converted to
# Pakistan wall-clock (UTC+5, no DST) at serialization time, and ONLY there:
#   * convert:  created_at / updated_at / resolved_at / responded_at /
#               expires_at / verified_at / last_login_at / viewed_at /
#               image_deleted_at, admin strftime dates, review dates, joined_at
#   * NEVER convert: slot_date / slot_time / slot_start and availability shift
#     times (already clinic wall-clock), anything WRITTEN to the DB, and any
#     datetime used in comparisons or logic (OTP expiry, conflict SLA, purges).
# The output string SHAPE is unchanged: still a naive isoformat/strftime with
# no offset suffix, only the wall-clock moves.
# ----------------------------------------------------------------------
JOINED_AT_FORMAT = "%b %Y"          # /login user.joined_at  -> "Jul 2026"
ADMIN_DATE_FORMAT = "%Y-%m-%d %H:%M"  # /admin/doctors created_at & verified_at
REVIEW_DATE_FORMAT = "%b %d, %Y"    # rating list `date`

# Pakistan Standard Time. A fixed offset, not zoneinfo: Pakistan observes no
# DST, and a fixed offset cannot fail on a machine with no tzdata.
PK_TZ = timezone(timedelta(hours=5))


def to_pk(dt):
    """A stored UTC datetime -> aware datetime in Pakistan time. None-safe.

    Naive input is ASSUMED to be UTC (every DateTime column in this codebase
    is naive UTC); aware input is converted properly. Display-only: never
    compare the result against stored values.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(PK_TZ)


def iso(dt):
    """ISO-8601 or None, VERBATIM -- no timezone conversion.

    For wall-clock values only (slot_start and friends, which are already
    clinic-local). Stored-UTC timestamps go through iso_pk instead."""
    return dt.isoformat() if dt else None


def iso_pk(dt):
    """Stored-UTC datetime -> naive Pakistan-wall-clock ISO string, or None.

    Same string shape as iso() (no offset suffix), so the frontend's existing
    parseDate keeps working -- the wall-clock is simply correct now."""
    converted = to_pk(dt)
    return converted.replace(tzinfo=None).isoformat() if converted else None


def joined_at(dt):
    """/login only. The monolith falls back to the LITERAL string 'Jan 2024'
    when created_at is null -- not to null, not to today."""
    try:
        return to_pk(dt).strftime(JOINED_AT_FORMAT) if dt else "Jan 2024"
    except (AttributeError, ValueError):
        return "Jan 2024"


def admin_datetime(dt):
    """/admin/doctors uses strftime('%Y-%m-%d %H:%M'), NOT isoformat().
    Pakistan wall-clock, like every other stored-UTC timestamp we serve."""
    return to_pk(dt).strftime(ADMIN_DATE_FORMAT) if dt else None


def review_date(dt):
    return to_pk(dt).strftime(REVIEW_DATE_FORMAT) if dt else None


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
    "PK_TZ",
    "to_pk",
    "iso",
    "iso_pk",
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
