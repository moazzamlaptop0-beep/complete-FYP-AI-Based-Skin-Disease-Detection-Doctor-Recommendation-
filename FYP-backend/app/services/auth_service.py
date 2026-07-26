"""
Session layer: password policy, refresh-token lifecycle, and the canonical
/auth/me payload.

WHAT LIVES HERE AND WHY
-----------------------
The six legacy auth routes each built their own ad-hoc response dict. The new
/auth surface has exactly ONE identity shape (`build_session_payload`) that the
unified auth screen consumes, so "what can this person do and where do they
land" is answered in one place instead of being re-derived in every React page
from a client-side JWT decode.

THE WORKSPACE IDEA -- the thing that unblocks the product
---------------------------------------------------------
`workspaces` is the list of surfaces one account may open. Because
ROLE_PERMISSIONS is a real hierarchy (PATIENT_PERMS < DOCTOR_PERMS <
ADMIN_PERMS), a Doctor genuinely holds every Patient permission -- so a
dermatologist gets BOTH the doctor dashboard AND the patient scan history on
the same login, instead of registering a second account with a second email to
get their own mole looked at. `home_route` is just which of those the UI opens
first.

REFRESH TOKENS
--------------
Opaque `secrets.token_urlsafe(64)`, stored ONLY as sha256, rotated on every
use, 30-day expiry. Rotation is recorded via `replaced_by_id`, so presenting an
already-rotated token is detectable -- that is the classic token-theft signal,
and the response is to kill the whole family (see `rotate_refresh_token`).
"""

import datetime
import logging

from flask import current_app, request

from app.core.rbac import Role, normalize_role, permissions_for
from app.core.security import (
    encode_access_token,
    generate_opaque_token,
    hash_opaque_token,
    utcnow,
)
from app.services.serializers import joined_at, profile_image_url

logger = logging.getLogger(__name__)


# ======================================================================
# PASSWORD POLICY
# ======================================================================
# The monolith had NO server-side policy at all: "1" was a valid password, and
# the only thing standing between an account and a dictionary attack was
# whatever the React form happened to validate that week.
#
# Deliberately small and boring. This is not a strength meter -- it is the
# floor. Three rules, each of which kills a real attack:
#   * length      -- everything shorter than 8 is brute-forceable offline
#   * all-numeric -- "12345678" passes a length check and is in every wordlist
#   * common list -- the top ~40 passwords cover a startling share of reuse
#
# NOT applied retroactively. Existing rows keep working; the policy runs on
# register and on reset, i.e. exactly when a password is being CHOSEN.
COMMON_PASSWORDS = frozenset({
    "password", "password1", "password123", "passw0rd", "p@ssword", "p@ssw0rd",
    "12345678", "123456789", "1234567890", "123123123", "111111111",
    "qwerty", "qwerty123", "qwertyuiop", "1q2w3e4r", "1qaz2wsx", "zaq12wsx",
    "iloveyou", "letmein", "welcome", "welcome1", "welcome123",
    "admin", "admin123", "administrator", "root1234", "toor1234",
    "abc12345", "abcd1234", "a1b2c3d4", "asdfghjkl", "football", "baseball",
    "sunshine", "princess", "dragon123", "monkey123", "trustno1", "starwars",
    "whatever", "superman", "pakistan", "pakistan123", "skincare", "aiderma",
    "dermatology", "doctor123", "patient123", "changeme", "secret123",
})

PASSWORD_TOO_SHORT = "Password must be at least {n} characters."
PASSWORD_ALL_NUMERIC = "Password cannot be all numbers."
PASSWORD_TOO_COMMON = "That password is too common. Please choose another."
PASSWORD_REQUIRED = "Password is required."


def validate_password(raw_password, min_length=None):
    """(ok, error_message). `error_message` is user-facing -- keep it plain."""
    if min_length is None:
        try:
            min_length = current_app.config.get("PASSWORD_MIN_LENGTH", 8)
        except RuntimeError:  # pragma: no cover - outside an app context
            min_length = 8

    if raw_password is None or str(raw_password) == "":
        return False, PASSWORD_REQUIRED

    candidate = str(raw_password)

    if len(candidate) < min_length:
        return False, PASSWORD_TOO_SHORT.format(n=min_length)

    if candidate.isdigit():
        return False, PASSWORD_ALL_NUMERIC

    # Case-insensitive: "Password123" is not meaningfully better than the
    # lowercase spelling an attacker's wordlist already contains.
    if candidate.lower() in COMMON_PASSWORDS:
        return False, PASSWORD_TOO_COMMON

    return True, None


def password_policy_summary():
    """Shown on the signup form so the rules are not a guessing game."""
    try:
        min_length = current_app.config.get("PASSWORD_MIN_LENGTH", 8)
    except RuntimeError:  # pragma: no cover
        min_length = 8
    return {
        "min_length": min_length,
        "rules": [
            f"At least {min_length} characters",
            "Not all numbers",
            "Not a commonly used password",
        ],
    }


# ======================================================================
# WORKSPACES  -- one account, several surfaces
# ======================================================================
WORKSPACE_PATIENT = {"key": "patient", "label": "My Scans", "route": "/my-reports"}
WORKSPACE_DOCTOR = {"key": "doctor", "label": "Doctor Dashboard", "route": "/doctor-dashboard"}
WORKSPACE_ADMIN = {"key": "admin", "label": "Admin Console", "route": "/admin-dashboard"}

# Order matters: workspaces[0] is the primary surface, and home_route follows it.
#
# A DOCTOR GETS TWO, AN ADMIN GETS ONE. The doctor pair is the whole point of the
# hierarchy: a dermatologist has their own skin, their own scans and their own
# appointments, so the patient surface is genuinely theirs and they need no second
# account for it.
#
# An admin used to get all three by the same logic, and that was wrong in a way
# permissions cannot express. ADMIN_PERMS is a superset of DOCTOR_PERMS, but an
# admin has no `doctor_profiles` row -- so their "doctor workspace" listed no
# referrals, no schedule and no ratings, for ever, and their "patient workspace"
# listed scans they never ran. Three empty pages behind a switcher that implied
# otherwise. The way an admin sees a doctor's or a patient's surface is to ACT AS
# one (X-Act-As-User-Id -- real data, real writes, an audit_logs row per request),
# which rbac.py already implements.
#
# Capability is UNCHANGED: ADMIN_PERMS still contains every doctor and patient
# permission and every route still authorises on those. This list only decides
# what the client offers as a place to go.
_WORKSPACES_BY_ROLE = {
    Role.PATIENT: (WORKSPACE_PATIENT,),
    Role.DOCTOR: (WORKSPACE_DOCTOR, WORKSPACE_PATIENT),
    Role.ADMIN: (WORKSPACE_ADMIN,),
}

# Where an UNAUTHENTICATED or unrecognised-role client goes. Never 500 the
# login response over a role literal nobody remembered to map.
FALLBACK_HOME_ROUTE = "/"


def workspaces_for(role):
    """The surfaces this role may open, primary first. Fresh dicts every call --
    callers jsonify these and Flask would otherwise share mutable state."""
    resolved = normalize_role(role)
    return [dict(w) for w in _WORKSPACES_BY_ROLE.get(resolved, ())]


def home_route_for(role):
    spaces = _WORKSPACES_BY_ROLE.get(normalize_role(role))
    return spaces[0]["route"] if spaces else FALLBACK_HOME_ROUTE


def permission_names(role):
    """Sorted permission strings ('scan.create', ...) for the client to gate UI
    on. Sorted so the payload is stable and diffable."""
    return sorted(p.value for p in permissions_for(role))


# ======================================================================
# EMAIL STATUS  -- what /auth/check-email answers
# ======================================================================
STATUS_NEW = "new"
STATUS_UNVERIFIED = "unverified"
STATUS_EXISTING = "existing"

NEXT_BY_STATUS = {
    STATUS_NEW: "signup",
    STATUS_UNVERIFIED: "otp",
    STATUS_EXISTING: "password",
}


def email_status(db, email):
    """'new' | 'unverified' | 'existing'.

    PRIVACY: the caller may only ever see these three words plus the matching
    `next` step. Never the name, never the role, never whether the account is a
    doctor -- /auth/check-email is unauthenticated, so anything richer turns it
    into a directory-scraping endpoint.
    """
    if not email:
        return STATUS_NEW
    user = find_user_by_email(db, email)
    if user is None:
        return STATUS_NEW
    if not user.is_verified:
        return STATUS_UNVERIFIED
    return STATUS_EXISTING


def find_user_by_email(db, email):
    """Case-insensitive lookup.

    Exact match FIRST so the unique index on users.email is used for the normal
    case; the `lower()` query is only reached when that misses. Emails are
    stored with whatever case the user typed (the monolith did, and /login still
    matches exactly) -- so lowercasing on write would strand every existing row.
    """
    from sqlalchemy import func

    from app.models import User

    if not email:
        return None
    cleaned = str(email).strip()
    if not cleaned:
        return None

    user = db.query(User).filter(User.email == cleaned).first()
    if user is None:
        user = db.query(User).filter(func.lower(User.email) == cleaned.lower()).first()
    return user


# ======================================================================
# REQUEST METADATA
# ======================================================================
def request_ip():
    try:
        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()[:45]
        return (request.remote_addr or "")[:45] or None
    except RuntimeError:  # pragma: no cover - outside a request
        return None


def request_user_agent():
    try:
        return (request.headers.get("User-Agent") or "")[:255] or None
    except RuntimeError:  # pragma: no cover
        return None


# ======================================================================
# ACCESS TOKENS
# ======================================================================
def mint_access_token(user, hours=None):
    """Access token carrying the user's CURRENT token_version.

    Always minted from the live row, never from an incoming claim: that is what
    makes a logout-all bump take effect on the very next refresh.
    """
    return encode_access_token(
        user.id,
        user.role,
        hours=hours,
        token_version=int(getattr(user, "token_version", 0) or 0),
    )


# ======================================================================
# REFRESH TOKENS
# ======================================================================
def _refresh_lifetime_days():
    try:
        return current_app.config.get("REFRESH_TOKEN_DAYS", 30)
    except RuntimeError:  # pragma: no cover
        return 30


def issue_refresh_token(db, user):
    """Create a refresh token row and return the PLAINTEXT value.

    The plaintext is returned exactly once, here. Only its sha256 is persisted,
    so a database dump cannot be replayed as a live session.
    """
    from app.models import RefreshToken

    plaintext = generate_opaque_token(64)
    row = RefreshToken(
        user_id=user.id,
        token_hash=hash_opaque_token(plaintext),
        issued_at=utcnow(),
        expires_at=utcnow() + datetime.timedelta(days=_refresh_lifetime_days()),
        user_agent=request_user_agent(),
        ip=request_ip(),
    )
    db.add(row)
    db.flush()
    return plaintext, row


def _find_refresh_row(db, plaintext):
    from app.models import RefreshToken

    if not plaintext:
        return None
    return db.query(RefreshToken).filter(
        RefreshToken.token_hash == hash_opaque_token(plaintext)
    ).first()


ERR_REFRESH_INVALID = "Invalid or expired session. Please login again."


def rotate_refresh_token(db, plaintext):
    """(user, new_plaintext, error_message).

    Rotation on EVERY use, plus reuse detection: a token that already has a
    `replaced_by_id` has been redeemed once. Seeing it a second time means two
    parties hold the same value, which is theft until proven otherwise -- so the
    whole family for that user is revoked and they must log in again. Losing one
    session beats letting an attacker keep refreshing forever.
    """
    row = _find_refresh_row(db, plaintext)
    if row is None:
        return None, None, ERR_REFRESH_INVALID

    # ORDER MATTERS. Rotation sets BOTH replaced_by_id and revoked_at, so the
    # rotated case has to be tested first -- and the two cases deserve very
    # different answers:
    #
    #   replaced_by_id set  -> this token was already exchanged for another one.
    #       Seeing it again means two parties hold the same value. That is theft
    #       until proven otherwise, so the whole family dies.
    #
    #   revoked_at only     -> a plain /auth/logout, or a family revocation that
    #       already happened. Refuse it and stop there. Treating this as theft
    #       would mean that logging out on a phone, and the phone retrying one
    #       in-flight refresh, silently signs the user out of their laptop too.
    if row.replaced_by_id is not None:
        logger.warning(
            "Refresh token reuse detected for user %s (token row %s) -- revoking all sessions",
            row.user_id, row.id,
        )
        revoke_all_refresh_tokens(db, row.user_id)
        return None, None, ERR_REFRESH_INVALID

    if row.revoked_at is not None:
        return None, None, ERR_REFRESH_INVALID

    if row.expires_at is not None and _as_naive(row.expires_at) <= utcnow():
        return None, None, ERR_REFRESH_INVALID

    from app.models import User

    user = db.query(User).filter(User.id == row.user_id).first()
    if user is None or getattr(user, "is_active", True) is False:
        return None, None, ERR_REFRESH_INVALID

    new_plaintext, new_row = issue_refresh_token(db, user)
    row.revoked_at = utcnow()
    row.replaced_by_id = new_row.id
    return user, new_plaintext, None


def revoke_refresh_token(db, plaintext):
    """Revoke exactly one session (this device). True when a row was hit."""
    row = _find_refresh_row(db, plaintext)
    if row is None:
        return False
    if row.revoked_at is None:
        row.revoked_at = utcnow()
    return True


def revoke_all_refresh_tokens(db, user_id):
    """Revoke every outstanding refresh row for a user. Returns the count."""
    from app.models import RefreshToken

    rows = db.query(RefreshToken).filter(
        RefreshToken.user_id == user_id,
        RefreshToken.revoked_at.is_(None),
    ).all()
    now = utcnow()
    for row in rows:
        row.revoked_at = now
    return len(rows)


def bump_token_version(db, user):
    """The nuclear logout: invalidates every ACCESS token too, not just refresh
    rows, because `tv` is baked into each one at mint time."""
    user.token_version = int(getattr(user, "token_version", 0) or 0) + 1
    revoked = revoke_all_refresh_tokens(db, user.id)
    return user.token_version, revoked


def _as_naive(value):
    """Compare-safe datetime. The schema mixes tz-aware defaults (created_at) with
    naive utcnow() writes, and Python raises on comparing the two."""
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return value


def record_login(user):
    """last_login_at / last_login_ip. Best-effort telemetry, never a failure."""
    user.last_login_at = utcnow()
    user.last_login_ip = request_ip()


# ======================================================================
# AUDIT
# ======================================================================
def write_audit(db, action, actor_user_id=None, subject_user_id=None, detail=None,
                target_type=None, target_id=None):
    """Append an audit row. Auth events are exactly the ones you wish you had
    logged when someone asks 'who reset that password?' six weeks later."""
    from app.models import AuditLog

    entry = AuditLog(
        actor_user_id=actor_user_id,
        subject_user_id=subject_user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        detail=detail,
        ip=request_ip(),
        user_agent=request_user_agent(),
        created_at=utcnow(),
    )
    db.add(entry)
    return entry


# ======================================================================
# THE CANONICAL IDENTITY PAYLOAD
# ======================================================================
def doctor_block(db, user):
    """The `doctor` key of /auth/me: a dict for a Doctor, None for anyone else.

    Deliberately NOT the whole DoctorProfile row. Five fields, all of which the
    auth screen or the pending-verification screen actually renders.
    """
    if normalize_role(user.role) is not Role.DOCTOR:
        return None

    from app.models import DoctorProfile

    profile = db.query(DoctorProfile).filter(DoctorProfile.user_id == user.id).first()
    if profile is None:
        # A Doctor row with no profile should be impossible (registration makes
        # both in one transaction) but the UI still needs a shape to render.
        return {
            "verification_status": "pending",
            "verification_note": None,
            "license": None,
            "specialty": None,
            "profile_image": None,
        }

    return {
        "verification_status": profile.verification_status or "pending",
        "verification_note": profile.verification_note,
        "license": profile.license,
        "specialty": profile.specialty,
        "profile_image": profile_image_url(profile.profile_image),
    }


def user_block(user):
    """The `user` key of /auth/me.

    `joined_at` reuses the /login formatter -- '%b %Y' with the literal 'Jan
    2024' fallback -- so the two endpoints never disagree about a join date.
    """
    return {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "joined_at": joined_at(user.created_at),
        "is_active": bool(getattr(user, "is_active", True)),
    }


def build_session_payload(db, user):
    """THE canonical identity shape. Frozen in docs/api-contract.md.

        {user, doctor, permissions, workspaces, home_route, pending_consents}

    Returned verbatim by GET /auth/me and embedded under `session` by
    /auth/login, /auth/register and /auth/refresh, so the client has exactly one
    parser for "who am I".
    """
    from app.services.consent_service import pending_consents

    return {
        "user": user_block(user),
        "doctor": doctor_block(db, user),
        "permissions": permission_names(user.role),
        "workspaces": workspaces_for(user.role),
        "home_route": home_route_for(user.role),
        "pending_consents": pending_consents(db, user),
    }


__all__ = [
    "COMMON_PASSWORDS",
    "validate_password",
    "password_policy_summary",
    "PASSWORD_TOO_SHORT",
    "PASSWORD_ALL_NUMERIC",
    "PASSWORD_TOO_COMMON",
    "PASSWORD_REQUIRED",
    "workspaces_for",
    "home_route_for",
    "permission_names",
    "WORKSPACE_PATIENT",
    "WORKSPACE_DOCTOR",
    "WORKSPACE_ADMIN",
    "STATUS_NEW",
    "STATUS_UNVERIFIED",
    "STATUS_EXISTING",
    "NEXT_BY_STATUS",
    "email_status",
    "find_user_by_email",
    "mint_access_token",
    "issue_refresh_token",
    "rotate_refresh_token",
    "revoke_refresh_token",
    "revoke_all_refresh_tokens",
    "bump_token_version",
    "record_login",
    "write_audit",
    "request_ip",
    "request_user_agent",
    "build_session_payload",
    "user_block",
    "doctor_block",
    "ERR_REFRESH_INVALID",
]
