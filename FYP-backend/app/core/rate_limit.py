"""
Rate limiting for the auth surface.

DISABLED BY DEFAULT (config RATELIMIT_ENABLED: false in dev and test, true in
production). The monolith had none at all, so switching it on is a behaviour
change -- 429s appear where none existed. Test suites that need to exercise it
build their own app with the flag on; ordinary tests and local development are
never throttled.

TWO WINDOWS PER ENDPOINT, AND WHY BOTH ARE NEEDED
-------------------------------------------------
  per-IP     stops one machine hammering the endpoint.
  per-EMAIL  stops a botnet spread across a thousand IPs from grinding ONE
             account -- which per-IP limiting alone does nothing about, because
             every request comes from a different address.

They are separate `@limiter.limit(...)` decorators with different key functions
and are evaluated independently: whichever runs out first produces the 429.

CHOOSING THE NUMBERS
--------------------
The constraint was "must not throttle the demo/test flows into uselessness".
A human demoing the app logs in perhaps five times a minute at worst; a
credential-stuffing run wants thousands. The budgets below sit an order of
magnitude above the first and three below the second. The per-email budgets are
tighter than per-IP on purpose: a shared office NAT is many people behind one
address, but one email address is one person.

  endpoint          per IP                per email
  ----------------------------------------------------------------
  /login            30/min, 200/hour      10/min, 50/hour
  /auth/login       30/min, 200/hour      10/min, 50/hour
  /auth/check-email 60/min, 600/hour      -- (typing-ahead UI calls it often)
  /register         10/min,  40/hour       5/min, 20/hour
  /auth/register    10/min,  40/hour       5/min, 20/hour
  /forgot-password  10/min,  40/hour       3/min, 10/hour  (each = an email)
  /resend-otp       10/min,  60/hour       5/min, 20/hour  (each = an email)
  /auth/change-password       10/min, 40/hour    -- (authenticated)
  /auth/email-change/*        10/min, 40/hour    -- (authenticated)

The two OTP-mailing endpoints are the tightest per-email because every
successful call sends a real email to a real inbox; the 45s OTP cooldown in
otp_service already caps them at ~1.3/min anyway, so these limits only ever bite
on abuse.

STORAGE
-------
memory:// is PER PROCESS. Under gunicorn with N workers the real budget is N
times the numbers above, and a restart forgets every counter. Set
RATELIMIT_STORAGE_URI=redis://... before treating this as a defence rather than
a speed bump.
"""

import logging

from flask import request

from app.core.responses import generate_response
from app.extensions import limiter

logger = logging.getLogger(__name__)

# ----------------------------------------------------------------------
# The budgets. Strings are Flask-Limiter syntax; ';' separates windows that
# all apply.
# ----------------------------------------------------------------------
LIMITS = {
    # --- auth: per IP -------------------------------------------------
    "login_ip": "30 per minute;200 per hour",
    "check_email_ip": "60 per minute;600 per hour",
    "register_ip": "10 per minute;40 per hour",
    "forgot_password_ip": "10 per minute;40 per hour",
    "resend_otp_ip": "10 per minute;60 per hour",
    "verify_otp_ip": "20 per minute;120 per hour",
    "reset_password_ip": "10 per minute;40 per hour",
    "refresh_ip": "60 per minute;600 per hour",
    # Self-service account changes. Both are AUTHENTICATED, so the realistic
    # threat is a stolen access token being used to grind the current password
    # or to walk the account onto an attacker's inbox -- not anonymous volume.
    # Keyed per IP because there is no `email` in either body to key on.
    "change_password_ip": "10 per minute;40 per hour",
    "email_change_ip": "10 per minute;40 per hour",
    # --- auth: per EMAIL ----------------------------------------------
    "login_email": "10 per minute;50 per hour",
    "register_email": "5 per minute;20 per hour",
    "forgot_password_email": "3 per minute;10 per hour",
    "resend_otp_email": "5 per minute;20 per hour",
    "verify_otp_email": "10 per minute;40 per hour",
    # --- non-auth suggestions (not applied by this phase) --------------
    "predict": "20 per minute;200 per hour",
    "chat": "20 per minute;200 per hour",
}

RATE_LIMITED_MESSAGE = "Too many attempts. Please wait a moment and try again."


# ----------------------------------------------------------------------
# Key functions
# ----------------------------------------------------------------------
def client_ip():
    """Client address, honouring X-Forwarded-For.

    SECURITY: X-Forwarded-For is client-supplied unless a proxy overwrites it.
    Behind nginx/Cloudflare this is correct; exposed directly it is spoofable
    and the per-IP limit becomes decorative. The per-EMAIL limit is the one that
    still holds in that case, which is part of why both exist.
    """
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.remote_addr or "unknown"


def ip_key():
    return f"ip:{client_ip()}"


def email_key():
    """Key on the email in the request body, lowercased.

    Falls back to the IP when there is no email (a malformed body must not all
    collapse onto one shared bucket named 'anonymous', which would let one bad
    client lock out every other).
    """
    try:
        payload = request.get_json(silent=True) or {}
        email = payload.get("email")
        if email:
            return f"email:{str(email).strip().lower()}"
    except Exception:  # pragma: no cover - defensive
        pass
    return f"ip:{client_ip()}"


def client_key():
    """Authenticated user id when we have one, else client IP. Kept for the
    non-auth endpoints that will adopt limiting later."""
    current_user = getattr(request, "current_user", None)
    if current_user and current_user.get("user_id"):
        return f"user:{current_user['user_id']}"
    return ip_key()


# ----------------------------------------------------------------------
# Decorator shorthands used by the auth blueprint
# ----------------------------------------------------------------------
def limit_by_ip(name):
    return limiter.limit(LIMITS[name], key_func=ip_key)


def limit_by_email(name):
    return limiter.limit(LIMITS[name], key_func=email_key)


# ----------------------------------------------------------------------
# 429 handling
# ----------------------------------------------------------------------
def _retry_after_seconds(exc):
    """Seconds to put in Retry-After.

    Uses the window length of the limit that tripped -- an UPPER bound on the
    real wait, never an under-estimate, so a client that obeys it never gets a
    second 429. Falls back to 60 if the object shape ever changes under us; a
    missing header is worse than an imprecise one.
    """
    try:
        return int(exc.limit.limit.get_expiry())
    except Exception:  # pragma: no cover - defensive
        return 60


def init_rate_limit(app):
    """Attach Flask-Limiter and the JSON 429 handler.

    The handler is registered ALWAYS, even when limiting is disabled: it costs
    nothing, and it means turning the flag on in production cannot start
    emitting Werkzeug's HTML 429 page out of a JSON API.
    """
    limiter.init_app(app)
    if not app.config.get("RATELIMIT_ENABLED", False):
        limiter.enabled = False
    else:
        limiter.enabled = True
        storage = app.config.get("RATELIMIT_STORAGE_URI", "memory://")
        if str(storage).startswith("memory://"):
            logger.warning(
                "Rate limiting is ON with memory:// storage: counters are "
                "per-process and reset on restart. Set RATELIMIT_STORAGE_URI "
                "to redis:// for a real limit."
            )

    from flask_limiter.errors import RateLimitExceeded

    @app.errorhandler(RateLimitExceeded)
    def _handle_rate_limit(exc):
        # More specific than the HTTPException handler in app/core/errors.py,
        # so Flask picks this one and the envelope keeps its Retry-After.
        retry_after = _retry_after_seconds(exc)
        logger.warning(
            "Rate limit hit: %s %s from %s (%s)",
            request.method, request.path, client_ip(), getattr(exc, "description", ""),
        )
        body, status = generate_response(
            False, error=RATE_LIMITED_MESSAGE, status_code=429
        )
        response = app.make_response((body, status))
        response.headers["Retry-After"] = str(retry_after)
        return response

    return limiter


__all__ = [
    "LIMITS",
    "RATE_LIMITED_MESSAGE",
    "client_ip",
    "ip_key",
    "email_key",
    "client_key",
    "limit_by_ip",
    "limit_by_email",
    "init_rate_limit",
]
