"""
OTP generation, validation and resend cooldown.

TWO IMPLEMENTATIONS LIVE IN THIS FILE, ON PURPOSE
-------------------------------------------------
PART 1 (legacy) -- `is_otp_valid` / `stamp_new_otp` /
`seconds_until_resend_allowed`, operating on the users.otp_code /
otp_created_at / otp_attempts triple. This is the monolith's `_is_otp_valid`
(lines 237-261) moved verbatim, error strings included, because the frontend
renders them.

PART 2 (current) -- `issue_otp` / `verify_otp` / `resend_wait_seconds`,
operating on the purpose-scoped `email_otps` table. This is what every route
should call.

WHY PART 1 STILL EXISTS: the legacy routes dual-write. `issue_otp` stamps the
users.otp_* columns as well as inserting an email_otps row, for ONE release, so
a client mid-flow (OTP already in their inbox, sent by the old code path) can
still redeem it. Delete Part 1 -- and the dual write -- one release later.

WHAT PART 2 FIXES
-----------------
1. PURPOSE SCOPING. One column triple meant a password-reset OTP overwrote a
   live signup OTP and vice versa; worse, a code mailed as "reset your
   password" could be redeemed at /verify-otp-email to activate an account.
   Purposes are now separate rows and `verify_otp(purpose=...)` will not cross
   the streams.
2. HASHED AT REST. The plaintext code was stored in users.otp_code. Now only
   sha256(code + SECRET_KEY) is stored, compared with hmac.compare_digest.
3. CSPRNG. random.randint -> secrets.randbelow (app.core.security).
4. THE UNBOUNDED-LOCKOUT BUG. /forgot-password called stamp_new_otp, which sets
   otp_attempts = 0, and had NO cooldown -- so five wrong guesses followed by
   another /forgot-password gave five more, forever. Issuing is now
   cooldown-gated per purpose, which puts a real cost on the reset loop.
"""

import datetime
import logging

from app.core.security import generate_numeric_code, hash_code, utcnow, verify_code

logger = logging.getLogger(__name__)

# Monolith lines 234-235 and 396.
OTP_EXPIRY_MINUTES = 10   # OTP is ke baad invalid ho jayega
OTP_MAX_ATTEMPTS = 5      # Itni galat tries ke baad OTP lock ho jata hai, naya OTP mangwana padega
OTP_RESEND_COOLDOWN_SECONDS = 45  # Spam-click / abuse se bachne ke liye minimum gap do resends ke beech


def _config(key, fallback):
    try:
        from flask import current_app

        if current_app:
            return current_app.config.get(key, fallback)
    except Exception:
        pass
    return fallback


def generate_otp():
    """6-digit code.

    The monolith used `random.randint(100000, 999999)`. Same output shape, but
    now from `secrets` -- the Mersenne Twister's internal state is recoverable
    from a short run of outputs, which for an OTP means a self-registered
    account can predict a stranger's next code. Identical contract, so the
    legacy callers are unaffected.
    """
    return generate_numeric_code(6)


def is_otp_valid(user, submitted_otp):
    """
    Shared OTP check: matching code, expiry, aur attempt-limit teeno verify
    karta hai. Returns (is_valid: bool, error_message: str|None).
    Caller khud attempts increment/reset aur commit karega.
    """
    expiry_minutes = _config("OTP_EXPIRY_MINUTES", OTP_EXPIRY_MINUTES)
    max_attempts = _config("OTP_MAX_ATTEMPTS", OTP_MAX_ATTEMPTS)

    if not user.otp_code:
        return False, "No active OTP. Please request a new one."

    if (user.otp_attempts or 0) >= max_attempts:
        return False, "Too many incorrect attempts. Please request a new OTP."

    if not user.otp_created_at:
        # Purane rows jinme otp_created_at set nahi - fail-safe treat as expired,
        # naya OTP mangwao
        return False, "OTP expired. Please request a new one."

    expires_at = user.otp_created_at + datetime.timedelta(minutes=expiry_minutes)
    if datetime.datetime.utcnow() > expires_at:
        return False, "OTP has expired. Please request a new one."

    if user.otp_code != str(submitted_otp):
        return False, "Invalid OTP"

    return True, None


def seconds_until_resend_allowed(user):
    """Monolith /resend-otp cooldown (lines 424-429).

    Returns the number of whole seconds the caller must still wait, or 0 when a
    resend is allowed right now. The error string the route emits is
    f"Please wait {n}s before requesting another OTP." -- keep it exact.
    """
    cooldown = _config("OTP_RESEND_COOLDOWN_SECONDS", OTP_RESEND_COOLDOWN_SECONDS)
    if not user.otp_created_at:
        return 0
    seconds_since_last = (datetime.datetime.utcnow() - user.otp_created_at).total_seconds()
    if seconds_since_last < cooldown:
        return int(cooldown - seconds_since_last)
    return 0


def stamp_new_otp(user, otp=None):
    """Write a fresh OTP onto the user row. Caller commits.

    Note the ordering rule the monolith established: only call this AFTER the
    email actually went out, otherwise a still-valid OTP gets invalidated
    without a replacement ever reaching the user.
    """
    code = otp or generate_otp()
    user.otp_code = code
    user.otp_created_at = datetime.datetime.utcnow()
    user.otp_attempts = 0
    return code


# ======================================================================
# PART 2 -- PURPOSE-SCOPED OTPs on the email_otps table.
# ======================================================================
PURPOSE_SIGNUP = "signup"
PURPOSE_RESET = "reset"
PURPOSE_EMAIL_CHANGE = "email_change"

# Mirrors the ck_email_otps_purpose CHECK constraint. Passing anything else is a
# programming error, not user input, so it raises rather than 400s.
VALID_PURPOSES = (PURPOSE_SIGNUP, PURPOSE_RESET, PURPOSE_EMAIL_CHANGE)

# User-facing strings. The first three are the monolith's wording verbatim so
# the two implementations say the same thing during the dual-write release.
ERR_NO_ACTIVE_OTP = "No active OTP. Please request a new one."
ERR_TOO_MANY_ATTEMPTS = "Too many incorrect attempts. Please request a new OTP."
ERR_EXPIRED = "OTP has expired. Please request a new one."
ERR_INVALID = "Invalid OTP"


def _assert_purpose(purpose):
    if purpose not in VALID_PURPOSES:
        raise ValueError(f"Unknown OTP purpose {purpose!r}; expected one of {VALID_PURPOSES}")
    return purpose


def _naive(value):
    """email_otps defaults are tz-aware; utcnow() is naive. Comparing the two
    raises TypeError, so everything is normalised to naive UTC here."""
    if value is None:
        return None
    if value.tzinfo is not None:
        return value.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return value


def _latest_otp(db, user_id, purpose):
    """Most recently created row for this (user, purpose), consumed or not."""
    from app.models import EmailOtp

    return (
        db.query(EmailOtp)
        .filter(EmailOtp.user_id == user_id, EmailOtp.purpose == purpose)
        .order_by(EmailOtp.id.desc())
        .first()
    )


def _any_otp_row(db, user_id):
    """Any email_otps row for this user, in ANY purpose, consumed or not.

    This is the guard on the legacy fallback below. Once a single row exists,
    the users.otp_* triple is nothing but the dual-write shadow of one of these
    rows -- and honouring it would re-open the exact hole purpose scoping
    closes (redeeming a signup code at /reset-password, and vice versa). Only a
    user who has NO rows at all can be mid-flow on a code minted before this
    deploy, and only they get the fallback.
    """
    from app.models import EmailOtp

    return db.query(EmailOtp).filter(EmailOtp.user_id == user_id).first()


def _active_otp(db, user_id, purpose):
    """Most recent UNCONSUMED row. Consumed rows can never be redeemed twice."""
    from app.models import EmailOtp

    return (
        db.query(EmailOtp)
        .filter(
            EmailOtp.user_id == user_id,
            EmailOtp.purpose == purpose,
            EmailOtp.consumed_at.is_(None),
        )
        .order_by(EmailOtp.id.desc())
        .first()
    )


def resend_wait_seconds(db, user, purpose):
    """Seconds still to wait before another code may be issued for THIS purpose.

    Per-purpose is the point: asking for a password reset must not be blocked by
    a signup code sent 5 seconds ago, and vice versa.
    """
    _assert_purpose(purpose)
    cooldown = _config("OTP_RESEND_COOLDOWN_SECONDS", OTP_RESEND_COOLDOWN_SECONDS)
    latest = _latest_otp(db, user.id, purpose)
    if latest is None:
        return 0
    created = _naive(latest.created_at)
    if created is None:
        return 0
    elapsed = (utcnow() - created).total_seconds()
    if elapsed < cooldown:
        return max(1, int(cooldown - elapsed))
    return 0


def issue_otp(db, user, purpose, dual_write_legacy=True, ignore_cooldown=False):
    """Create a fresh code for (user, purpose). Returns (code, error_message).

    On success `error_message` is None and `code` is the PLAINTEXT to email --
    the only moment it exists outside the sender's inbox. Only its hash is
    stored.

    Any still-active code for the same purpose is consumed first, so exactly one
    code per purpose is redeemable at a time. Other purposes are untouched.

    CALL ORDER RULE (inherited from the monolith's bug fix): call this AFTER the
    email has actually been sent, or a valid code gets invalidated with no
    replacement ever reaching the user.
    """
    _assert_purpose(purpose)

    if not ignore_cooldown:
        wait = resend_wait_seconds(db, user, purpose)
        if wait:
            return None, f"Please wait {wait}s before requesting another OTP."

    from app.models import EmailOtp

    # Retire whatever was outstanding for this purpose.
    stale = (
        db.query(EmailOtp)
        .filter(
            EmailOtp.user_id == user.id,
            EmailOtp.purpose == purpose,
            EmailOtp.consumed_at.is_(None),
        )
        .all()
    )
    now = utcnow()
    for row in stale:
        row.consumed_at = now

    expiry_minutes = _config("OTP_EXPIRY_MINUTES", OTP_EXPIRY_MINUTES)
    length = _config("OTP_LENGTH", 6)
    code = generate_numeric_code(length)

    from app.services.auth_service import request_ip

    db.add(EmailOtp(
        user_id=user.id,
        purpose=purpose,
        code_hash=hash_code(code),
        created_at=now,
        expires_at=now + datetime.timedelta(minutes=expiry_minutes),
        attempts=0,
        consumed_at=None,
        request_ip=request_ip(),
    ))

    if dual_write_legacy:
        # ONE RELEASE ONLY. Keeps /verify-otp-email and /reset-password (which
        # read users.otp_code) working while clients are still on the old flow.
        # Remove together with Part 1 of this module.
        user.otp_code = code
        user.otp_created_at = now
        user.otp_attempts = 0

    db.flush()
    return code, None


def verify_otp(db, user, purpose, submitted_code, consume=True):
    """(ok, error_message) for a purpose-scoped code.

    Increments `attempts` on the row itself on every wrong guess -- 5 per row,
    and issuing a new code is cooldown-gated, so the lockout can no longer be
    reset for free the way /forgot-password used to allow.

    LEGACY FALLBACK: when no email_otps row exists for this purpose, the
    users.otp_code column is checked instead, so a code mailed by the old
    implementation before this deploy is still redeemable. Drop the fallback
    with the rest of Part 1.
    """
    _assert_purpose(purpose)

    if submitted_code in (None, ""):
        return False, ERR_INVALID

    max_attempts = _config("OTP_MAX_ATTEMPTS", OTP_MAX_ATTEMPTS)
    row = _active_otp(db, user.id, purpose)

    if row is None:
        latest = _latest_otp(db, user.id, purpose)
        if latest is None and _any_otp_row(db, user.id) is None:
            # No row for this purpose AND no row for any other purpose: the only
            # state in which users.otp_code can still be a genuine pre-deploy
            # code rather than the dual-write shadow of another purpose.
            ok, err = _verify_legacy_column(user, submitted_code, max_attempts)
            if ok and consume:
                clear_legacy_otp(user)
            return ok, err
        # A consumed row exists (used or superseded), or the live legacy column
        # belongs to a DIFFERENT purpose. Either way there is nothing to redeem.
        return False, ERR_NO_ACTIVE_OTP

    if (row.attempts or 0) >= max_attempts:
        return False, ERR_TOO_MANY_ATTEMPTS

    expires_at = _naive(row.expires_at)
    if expires_at is not None and utcnow() > expires_at:
        return False, ERR_EXPIRED

    if not verify_code(row.code_hash, str(submitted_code).strip()):
        row.attempts = (row.attempts or 0) + 1
        db.flush()
        if row.attempts >= max_attempts:
            return False, ERR_TOO_MANY_ATTEMPTS
        return False, ERR_INVALID

    if consume:
        row.consumed_at = utcnow()
        clear_legacy_otp(user)
        db.flush()
    return True, None


def _verify_legacy_column(user, submitted_code, max_attempts):
    """The users.otp_* path, used only when email_otps has nothing for this
    purpose. Purpose-blind by construction -- that is exactly the bug being
    retired, which is why it is the LAST resort and not the first."""
    if not user.otp_code:
        return False, ERR_NO_ACTIVE_OTP
    if (user.otp_attempts or 0) >= max_attempts:
        return False, ERR_TOO_MANY_ATTEMPTS
    if not user.otp_created_at:
        return False, ERR_EXPIRED

    expiry_minutes = _config("OTP_EXPIRY_MINUTES", OTP_EXPIRY_MINUTES)
    if utcnow() > _naive(user.otp_created_at) + datetime.timedelta(minutes=expiry_minutes):
        return False, ERR_EXPIRED

    if str(user.otp_code) != str(submitted_code).strip():
        user.otp_attempts = (user.otp_attempts or 0) + 1
        return False, ERR_INVALID

    return True, None


def clear_legacy_otp(user):
    """Wipe the users.otp_* triple. Called whenever a code is redeemed, so the
    legacy columns cannot outlive the row that replaced them."""
    user.otp_code = None
    user.otp_created_at = None
    user.otp_attempts = 0


def invalidate_otps(db, user_id, purpose=None):
    """Consume every outstanding code for a user, optionally for one purpose.
    Used on password change and on account deactivation."""
    from app.models import EmailOtp

    query = db.query(EmailOtp).filter(
        EmailOtp.user_id == user_id,
        EmailOtp.consumed_at.is_(None),
    )
    if purpose is not None:
        query = query.filter(EmailOtp.purpose == _assert_purpose(purpose))
    now = utcnow()
    rows = query.all()
    for row in rows:
        row.consumed_at = now
    return len(rows)


__all__ = [
    "OTP_EXPIRY_MINUTES",
    "OTP_MAX_ATTEMPTS",
    "OTP_RESEND_COOLDOWN_SECONDS",
    "generate_otp",
    "is_otp_valid",
    "seconds_until_resend_allowed",
    "stamp_new_otp",
    # purpose-scoped
    "PURPOSE_SIGNUP",
    "PURPOSE_RESET",
    "PURPOSE_EMAIL_CHANGE",
    "VALID_PURPOSES",
    "issue_otp",
    "verify_otp",
    "resend_wait_seconds",
    "invalidate_otps",
    "clear_legacy_otp",
    "ERR_NO_ACTIVE_OTP",
    "ERR_TOO_MANY_ATTEMPTS",
    "ERR_EXPIRED",
    "ERR_INVALID",
]
