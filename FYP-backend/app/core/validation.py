"""
Small request-validation helpers.

Kept deliberately thin: the ported routes must keep producing the monolith's
exact error strings and status codes, so these are convenience helpers a route
MAY use, not a schema layer that rewrites messages.
"""

import math
import re

from flask import request

from app.core.errors import ValidationError

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
TIME_24H_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")

# Literal sets. NEVER re-case or rename these -- they are stored in the DB and
# compared with `==` in a dozen places.
SCAN_STATUSES = ("Local", "Pending", "Reviewed")
SEVERITY_LEVELS = ("ROUTINE", "URGENT", "CRITICAL")
APPOINTMENT_STATUSES = (
    "Scheduled", "Confirmed", "Completed", "Cancelled", "Pending-Conflict", "Reassigned",
)
# Only these four are settable through /api/update-appointment.
SETTABLE_APPOINTMENT_STATUSES = ("Scheduled", "Confirmed", "Completed", "Cancelled")
VERIFICATION_STATUSES = ("pending", "approved", "rejected")


def json_body(required=None, error="Invalid JSON payload"):
    """Return the parsed JSON body, raising ValidationError when absent or when
    a required key is missing."""
    data = request.get_json(silent=True)
    if not data:
        raise ValidationError(error=error, status_code=400)
    if required:
        missing = [k for k in required if k not in data or data.get(k) in (None, "")]
        if missing:
            raise ValidationError(error="Missing required fields", status_code=400)
    return data


def require_fields(data, *names, error="Missing required fields"):
    if not data or not all(n in data for n in names):
        raise ValidationError(error=error, status_code=400)
    return data


def as_int(value, default=None):
    """int() that never raises. Returns `default` on anything unparseable."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def as_float(value, default=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def as_bool(value, default=False):
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def blank_user_id(raw):
    """The monolith treats the STRINGS 'null', 'undefined' and '' from
    multipart form data as "no user id" (line 635). Preserved here."""
    return raw is None or str(raw).strip().lower() in ("null", "undefined", "")


def is_email(value):
    return bool(value and EMAIL_RE.match(str(value).strip()))


def is_iso_date(value):
    return bool(value and DATE_RE.match(str(value).strip()))


def is_24h_time(value):
    return bool(value and TIME_24H_RE.match(str(value).strip()))


def one_of(value, allowed, error=None):
    if value not in allowed:
        raise ValidationError(
            error=error or f"Invalid value. Allowed: {', '.join(map(str, allowed))}",
            status_code=400,
        )
    return value


# ======================================================================
# STRUCTURED LOCATION
# ======================================================================
# The registration form and the doctor profile now submit a GEOCODED place:
# city + state + country + latitude + longitude, all from one picked result.
# Before this, `/register` copied `data.get('latitude')` STRAIGHT into a Float
# column with no coercion and no bounds, so "31.5" (a string), "somewhere" and
# 4000 were all equally acceptable at signup while the same value sent to
# PATCH /api/profile was rejected. One writer, one rule, four call sites.
COORDINATE_LIMITS = {"latitude": 90.0, "longitude": 180.0}

# doctor_profiles column widths. Postgres does not truncate, it raises
# StringDataRightTruncation -- an over-long country name is a 500 unless the
# writer caps it here.
LOCATION_TEXT_LIMITS = {"city": 100, "state": 120, "country": 120}


def clean_text(value, limit=None):
    """Trim; '' and whitespace-only become None; cap at `limit` characters.

    None means "no value", which for every nullable column in this schema means
    NULL. A stored " " is the worst of both: truthy in Python, blank on screen.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:limit] if limit else text


def coerce_coordinate(value, kind):
    """(number|None, error|None). `kind` is 'latitude' or 'longitude'.

    None and '' clear the column -- a doctor removing their pin is a legitimate
    edit. Returns the error TEXT instead of raising because the three callers
    raise three different exception types (ProfileError with a field name,
    ValidationError, or a plain 400 envelope) and all want this exact wording.

    NaN and infinity are rejected explicitly: float('nan') parses happily and
    then passes BOTH bounds tests, because every comparison with NaN is false.
    """
    if value is None:
        return None, None
    raw = str(value).strip()
    if not raw:
        return None, None
    try:
        number = float(raw)
    except (TypeError, ValueError):
        return None, f"{kind.title()} must be a number."
    if not math.isfinite(number):
        return None, f"{kind.title()} must be a number."
    limit = COORDINATE_LIMITS[kind]
    if number < -limit or number > limit:
        return None, f"{kind.title()} must be between -{limit:g} and {limit:g}."
    return number, None


def location_fields(raw):
    """(fields, error) -- the five doctor_profiles location columns, coerced.

    Every key is present in the result, absent input included, because the
    callers CREATE the row: an omitted city means NULL, not "leave alone".
    Partial updates use their own field-by-field writers instead.
    """
    source = raw if isinstance(raw, dict) else {}
    fields = {
        name: clean_text(source.get(name), limit)
        for name, limit in LOCATION_TEXT_LIMITS.items()
    }
    for kind in COORDINATE_LIMITS:
        number, error = coerce_coordinate(source.get(kind), kind)
        if error is not None:
            return None, error
        fields[kind] = number
    return fields, None
