"""
Runtime-editable settings (the system_settings table).

RESOLUTION ORDER -- the whole contract of this module:

    system_settings row  ->  current_app.config  ->  os.environ  ->  default

The DB key IS the config key IS the env key (SMTP_HOST, OTP_LENGTH, ...), so
one name walks the whole cascade. A missing row means "keep whatever the
process booted with", which is why the table ships empty.

Storage is stringly typed on purpose (TEXT column): booleans as
"true"/"false", integers as their decimal string. The typed getters below do
the coercion, and a value that fails to coerce falls back to the default
rather than raising -- a mistyped setting must degrade, never take the API
down.

DESIGN RULES (match the codebase):
  * models are imported INSIDE functions -- this module is imported by
    email_service and otp_service, which are imported everywhere, and a
    top-level model import would recreate the circular-import problem the
    package layout exists to avoid.
  * every DB read that is not handed a session opens ONE short-lived session
    and closes it. No caching: an admin who saves a setting must see it take
    effect on the very next request, worker restarts included.
  * readers NEVER raise. No engine, no table, no app context -- all of that
    degrades to the config/env fallback, exactly like the old
    email_service._setting helper did.
"""

import logging
import os

logger = logging.getLogger(__name__)

_TRUE_STRINGS = ("1", "true", "yes", "on")
_FALSE_STRINGS = ("0", "false", "no", "off")


# ======================================================================
# READ SIDE
# ======================================================================
def get_db_value(key, db=None):
    """The raw string stored for `key`, or None. Never raises."""
    try:
        from app.models import SystemSetting

        if db is not None:
            row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
            return row.value if row is not None else None

        from app.core.db import SessionLocal

        session = SessionLocal()
        try:
            row = session.query(SystemSetting).filter(SystemSetting.key == key).first()
            return row.value if row is not None else None
        finally:
            session.close()
    except Exception:
        # No engine, no table yet (pre-migration), or no DB at all: the
        # cascade continues with config/env. Silence is deliberate.
        return None


def get_effective(key, default=None, db=None):
    """DB value if present, else Flask config, else os.environ, else default.

    Mirrors what email_service._setting and otp_service._config did before
    the table existed, with the DB layered on top.
    """
    value = get_db_value(key, db=db)
    if value is not None:
        return value

    try:
        from flask import current_app

        if current_app:
            config_value = current_app.config.get(key)
            if config_value is not None:
                return config_value
    except Exception:
        pass

    env_value = os.environ.get(key)
    if env_value is not None:
        return env_value

    return default


def get_int(key, default=0, db=None):
    value = get_effective(key, None, db=db)
    if value is None:
        return default
    try:
        return int(str(value).strip())
    except (TypeError, ValueError):
        logger.warning("Setting %s=%r is not an integer; using %r", key, value, default)
        return default


def get_bool(key, default=False, db=None):
    value = get_effective(key, None, db=db)
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in _TRUE_STRINGS:
        return True
    if text in _FALSE_STRINGS:
        return False
    logger.warning("Setting %s=%r is not a boolean; using %r", key, value, default)
    return default


# ======================================================================
# WRITE SIDE  (upsert; caller owns the transaction)
# ======================================================================
def _to_stored(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def set_value(db, key, value):
    """Upsert one setting. `value=None` DELETES the row, which restores the
    config/env fallback rather than storing the string "None"."""
    from app.models import SystemSetting
    from app.models.base import utcnow

    row = db.query(SystemSetting).filter(SystemSetting.key == key).first()
    if value is None:
        if row is not None:
            db.delete(row)
        db.flush()
        return None

    stored = _to_stored(value)
    if row is None:
        row = SystemSetting(key=key, value=stored, updated_at=utcnow())
        db.add(row)
    else:
        row.value = stored
        row.updated_at = utcnow()
    db.flush()
    return row


def set_many(db, mapping):
    for key, value in mapping.items():
        set_value(db, key, value)


# ======================================================================
# THE /admin/settings PAYLOAD AND ITS VALIDATION
# (shape frozen -- see docs/api-contract.md)
# ======================================================================
def settings_payload(db=None):
    """The GET/PUT response body. email_pass is WRITE-ONLY: only the boolean
    `email_pass_set` ever leaves the server."""
    email_user = get_effective("EMAIL_USER", None, db=db)
    return {
        "email": {
            "smtp_host": str(get_effective("SMTP_HOST", "smtp.gmail.com", db=db)),
            "smtp_port": get_int("SMTP_PORT", 465, db=db),
            "smtp_use_ssl": get_bool("SMTP_USE_SSL", True, db=db),
            "email_user": str(email_user) if email_user else None,
            "email_pass_set": bool(get_effective("EMAIL_PASS", None, db=db)),
            "email_enabled": get_bool("EMAIL_ENABLED", True, db=db),
        },
        "otp": {
            "otp_expiry_minutes": get_int("OTP_EXPIRY_MINUTES", 10, db=db),
            "otp_max_attempts": get_int("OTP_MAX_ATTEMPTS", 5, db=db),
            "otp_resend_cooldown_seconds": get_int("OTP_RESEND_COOLDOWN_SECONDS", 45, db=db),
            "otp_length": get_int("OTP_LENGTH", 6, db=db),
            "otp_verification_enabled": get_bool("OTP_VERIFICATION_ENABLED", True, db=db),
        },
    }


# field name in the JSON body -> (storage key, min, max)   [integers]
_INT_FIELDS = {
    "smtp_port": ("SMTP_PORT", 1, 65535),
    "otp_expiry_minutes": ("OTP_EXPIRY_MINUTES", 1, 120),
    "otp_max_attempts": ("OTP_MAX_ATTEMPTS", 1, 10),
    "otp_resend_cooldown_seconds": ("OTP_RESEND_COOLDOWN_SECONDS", 10, 600),
    "otp_length": ("OTP_LENGTH", 4, 8),
}

# field name -> storage key   [booleans]
_BOOL_FIELDS = {
    "smtp_use_ssl": "SMTP_USE_SSL",
    "email_enabled": "EMAIL_ENABLED",
    "otp_verification_enabled": "OTP_VERIFICATION_ENABLED",
}

# field name -> storage key   [strings; email_pass is the write-only one]
_STRING_FIELDS = {
    "smtp_host": "SMTP_HOST",
    "email_user": "EMAIL_USER",
    "email_pass": "EMAIL_PASS",
}

_SECTION_FIELDS = {
    "email": ("smtp_host", "smtp_port", "smtp_use_ssl",
              "email_user", "email_pass", "email_enabled"),
    "otp": ("otp_expiry_minutes", "otp_max_attempts",
            "otp_resend_cooldown_seconds", "otp_length",
            "otp_verification_enabled"),
}


def _coerce_int(value):
    if isinstance(value, bool):
        raise ValueError
    return int(str(value).strip())


def _coerce_bool(value):
    if isinstance(value, bool):
        return value
    text = str(value).strip().lower()
    if text in _TRUE_STRINGS:
        return True
    if text in _FALSE_STRINGS:
        return False
    raise ValueError


def apply_settings_update(db, body):
    """Validate a PUT /admin/settings body and upsert every present field.

    PARTIAL on purpose: an absent field is left alone; a JSON null for a
    STRING field deletes the DB override (config/env resumes). Returns
    (changed_storage_keys, error_message) -- exactly one of the two is set,
    and on an error NOTHING has been flushed that the caller should keep
    (roll back).
    """
    if not isinstance(body, dict):
        return None, "Request body must be a JSON object."

    updates = {}

    for section, allowed in _SECTION_FIELDS.items():
        block = body.get(section)
        if block is None:
            continue
        if not isinstance(block, dict):
            return None, f"'{section}' must be an object."

        for field, value in block.items():
            if field not in allowed:
                return None, f"Unknown setting '{section}.{field}'."

            if field in _INT_FIELDS:
                storage_key, low, high = _INT_FIELDS[field]
                try:
                    number = _coerce_int(value)
                except (TypeError, ValueError):
                    return None, f"{field} must be an integer between {low} and {high}."
                if not (low <= number <= high):
                    return None, f"{field} must be an integer between {low} and {high}."
                updates[storage_key] = number

            elif field in _BOOL_FIELDS:
                try:
                    updates[_BOOL_FIELDS[field]] = _coerce_bool(value)
                except (TypeError, ValueError):
                    return None, f"{field} must be true or false."

            else:  # string fields
                storage_key = _STRING_FIELDS[field]
                if value is None:
                    updates[storage_key] = None       # delete the override
                    continue
                if not isinstance(value, str):
                    return None, f"{field} must be a string."
                text = value.strip()
                if not text and field in ("smtp_host", "email_pass"):
                    return None, f"{field} must not be empty."
                updates[storage_key] = text

    for extra in body:
        if extra not in _SECTION_FIELDS:
            return None, f"Unknown section '{extra}'. Expected 'email' and/or 'otp'."

    set_many(db, updates)
    return sorted(updates.keys()), None


__all__ = [
    "get_db_value",
    "get_effective",
    "get_int",
    "get_bool",
    "set_value",
    "set_many",
    "settings_payload",
    "apply_settings_update",
]
