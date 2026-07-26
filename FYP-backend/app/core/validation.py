"""
Small request-validation helpers.

Kept deliberately thin: the ported routes must keep producing the monolith's
exact error strings and status codes, so these are convenience helpers a route
MAY use, not a schema layer that rewrites messages.
"""

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
