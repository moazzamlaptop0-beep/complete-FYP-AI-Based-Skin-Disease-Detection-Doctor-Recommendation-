"""
Password hashing, JWT encoding/decoding and opaque token helpers.

CONTRACT NOTES
--------------
* Passwords keep using werkzeug's `generate_password_hash` /
  `check_password_hash` exactly as the monolith did, so every existing row in
  `users.password` still verifies.
* Access tokens keep the claim names `user_id` and `role` and the HS256
  algorithm, so tokens already sitting in browsers keep decoding.
* `exp` stays 24 hours (config ACCESS_TOKEN_HOURS) until the frontend grows a
  refresh timer; the drop to 2h is a later, deliberate change.

THE BACK-COMPAT RULE FOR THE NEW CLAIMS  (do not "tidy" this away)
------------------------------------------------------------------
Access tokens minted from this phase onward carry
    {user_id, role, tv, jti, typ:'access', iat, exp}
Tokens minted BEFORE it carry only {user_id, role, exp}. Every reader must
therefore treat

    a MISSING `tv`  as 0            -> claim_token_version()
    a MISSING `typ` as 'access'     -> claim_token_type()

Anything stricter signs out every person currently logged in, which is the one
outcome this refactor is not allowed to produce.
"""

import datetime
import hashlib
import hmac
import secrets

import jwt
from flask import current_app, has_app_context
from werkzeug.security import check_password_hash, generate_password_hash

# Re-exported so a porting agent only needs one import for auth concerns.
from app.core.rbac import (  # noqa: F401
    admin_required,
    doctor_required,
    get_token_data,
    patient_required,
    require_permission,
    token_optional,
    token_required,
)

__all__ = [
    "hash_password",
    "verify_password",
    "encode_access_token",
    "decode_access_token",
    "claim_token_version",
    "claim_token_type",
    "TOKEN_TYPE_ACCESS",
    "generate_opaque_token",
    "hash_opaque_token",
    "generate_numeric_code",
    "hash_code",
    "verify_code",
    "utcnow",
    "require_permission",
    "token_required",
    "token_optional",
    "admin_required",
    "doctor_required",
    "patient_required",
    "get_token_data",
]

# The only value `typ` ever takes on a token that may authenticate an API call.
# Refresh tokens are OPAQUE (secrets.token_urlsafe), never JWTs, so there is no
# 'refresh' JWT type to confuse with this one -- but a future signed token of a
# different type must not be silently accepted as a session.
TOKEN_TYPE_ACCESS = "access"


def utcnow():
    """Naive UTC. The whole codebase compares against datetime.utcnow(), so we
    stay naive here on purpose -- mixing aware and naive datetimes raises."""
    return datetime.datetime.utcnow()


# ----------------------------------------------------------------------
# Passwords
# ----------------------------------------------------------------------
def hash_password(raw_password):
    return generate_password_hash(raw_password)


def verify_password(stored_hash, raw_password):
    if not stored_hash or raw_password is None:
        return False
    try:
        return check_password_hash(stored_hash, raw_password)
    except (ValueError, TypeError):
        return False


# ----------------------------------------------------------------------
# Access tokens (JWT)
# ----------------------------------------------------------------------
def encode_access_token(user_id, role, hours=None, extra_claims=None, token_version=0):
    """Build the access token.

    `user_id` and `role` keep their exact names -- the frontend decodes `role`
    client-side and every decorator reads `user_id`. The four claims added here
    are all OPTIONAL on the reading side (see the module docstring):

        tv   users.token_version at mint time. `logout-all` bumps the column,
             which instantly invalidates every access token ever issued for
             that account without needing a blocklist.
        jti  a random id, so a single token can be named in an audit log.
        typ  always 'access' today.
        iat  issued-at, for "sessions since" style reporting.
    """
    hours = current_app.config.get("ACCESS_TOKEN_HOURS", 24) if hours is None else hours
    issued = utcnow()
    payload = {
        "user_id": user_id,
        "role": role,
        "tv": int(token_version or 0),
        "jti": secrets.token_urlsafe(12),
        "typ": TOKEN_TYPE_ACCESS,
        "iat": issued,
        "exp": issued + datetime.timedelta(hours=hours),
    }
    if extra_claims:
        payload.update(extra_claims)
    token = jwt.encode(
        payload,
        current_app.config["SECRET_KEY"],
        algorithm=current_app.config.get("JWT_ALGORITHM", "HS256"),
    )
    # PyJWT >= 2 returns str already; the isinstance guard keeps PyJWT 1 safe.
    return token.decode("utf-8") if isinstance(token, bytes) else token


def decode_access_token(token):
    return jwt.decode(
        token,
        current_app.config["SECRET_KEY"],
        algorithms=[current_app.config.get("JWT_ALGORITHM", "HS256")],
    )


def claim_token_version(claims):
    """`tv` from a claim dict, with the mandatory MISSING -> 0 fallback."""
    try:
        return int((claims or {}).get("tv") or 0)
    except (TypeError, ValueError):
        return 0


def claim_token_type(claims):
    """`typ` from a claim dict, with the mandatory MISSING -> 'access' fallback."""
    value = (claims or {}).get("typ")
    return TOKEN_TYPE_ACCESS if value in (None, "") else str(value)


# ----------------------------------------------------------------------
# Opaque tokens (refresh tokens) and OTP codes
# ----------------------------------------------------------------------
def generate_opaque_token(nbytes=64):
    """The refresh token value handed to the client. Only its sha256 is stored,
    so a database leak does not hand out sessions."""
    return secrets.token_urlsafe(nbytes)


def hash_opaque_token(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def generate_numeric_code(length=6):
    """Cryptographically-random OTP.

    The monolith used `random.randint(100000, 999999)` -- the Mersenne Twister,
    whose state is recoverable from a handful of outputs. For a 6-digit code
    this reduces to `secrets.randbelow(900000) + 100000`.
    """
    upper = 10 ** length
    lower = 10 ** (length - 1)
    return str(secrets.randbelow(upper - lower) + lower)


def _code_pepper():
    """Server-side secret mixed into every OTP hash.

    Without it, `sha256('483920')` is a 900k-entry rainbow table -- a database
    dump would hand over every live code. With it, the attacker also needs
    SECRET_KEY, which never leaves the process.
    """
    if has_app_context():
        return current_app.config.get("SECRET_KEY", "") or ""
    return ""


def hash_code(code, secret=None):
    """sha256(code + pepper), hex. `secret` is injectable for tests only."""
    pepper = _code_pepper() if secret is None else secret
    return hashlib.sha256(f"{code}{pepper}".encode("utf-8")).hexdigest()


def verify_code(stored_hash, code, secret=None):
    """Constant-time compare. NEVER use `==` here: string equality short-circuits
    on the first differing byte and leaks the code one character at a time."""
    if not stored_hash or code in (None, ""):
        return False
    return hmac.compare_digest(str(stored_hash), hash_code(code, secret))
