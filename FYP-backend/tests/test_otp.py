"""
OTP hardening: purpose scoping, expiry, the attempt lockout, and the cooldown.

THE BUG THIS FILE EXISTS FOR
----------------------------
The monolith kept ONE (otp_code, otp_created_at, otp_attempts) triple on the
users row and used it for signup, password reset AND email change. Two
consequences, both tested below:

  * a code mailed as "reset your password" could be redeemed at
    /verify-otp-email to activate an account, and vice versa; and
  * /forgot-password called stamp_new_otp, which sets otp_attempts = 0, and had
    NO cooldown -- so the "5 attempts then locked" rule could be cleared
    instantly, forever, for free. The lockout was decorative.

Both are fixed by the purpose-scoped `email_otps` table. The legacy columns are
still dual-written for one release, and that fallback has its own tests here so
nobody mid-flow at deploy time is stranded.
"""

import datetime

import pytest

from app.core.security import hash_code, verify_code
from app.services.otp_service import (
    ERR_EXPIRED,
    ERR_INVALID,
    ERR_NO_ACTIVE_OTP,
    ERR_TOO_MANY_ATTEMPTS,
    PURPOSE_RESET,
    PURPOSE_SIGNUP,
    issue_otp,
    resend_wait_seconds,
    verify_otp,
)
from tests.authkit import (
    DEFAULT_PASSWORD,
    data_of,
    error_of,
    install_mailbox,
    make_user,
    seed_consents,
    signup,
)


@pytest.fixture(autouse=True)
def mail(monkeypatch):
    """Autouse: no test in this file may reach a real SMTP server."""
    return install_mailbox(monkeypatch)


@pytest.fixture()
def catalogue(db):
    seed_consents(db)
    return db


def _rows(db, user_id, purpose=None):
    from app.models import EmailOtp

    query = db.query(EmailOtp).filter(EmailOtp.user_id == user_id)
    if purpose:
        query = query.filter(EmailOtp.purpose == purpose)
    return query.order_by(EmailOtp.id.asc()).all()


def _backdate(db, user_id, purpose, minutes):
    """Push a row's clock back so expiry/cooldown can be tested without sleeping."""
    from app.models import EmailOtp

    row = (
        db.query(EmailOtp)
        .filter(EmailOtp.user_id == user_id, EmailOtp.purpose == purpose)
        .order_by(EmailOtp.id.desc())
        .first()
    )
    shift = datetime.timedelta(minutes=minutes)
    row.created_at = row.created_at - shift
    row.expires_at = row.expires_at - shift
    db.commit()
    return row


# ======================================================================
# STORAGE
# ======================================================================
def test_the_code_is_never_stored_in_the_email_otps_row(db):
    user = make_user(db, "hashed.otp@aiderma.local")

    code, error = issue_otp(db, user, PURPOSE_SIGNUP, ignore_cooldown=True)
    db.commit()

    assert error is None
    assert code.isdigit() and len(code) == 6

    row = _rows(db, user.id, PURPOSE_SIGNUP)[-1]
    assert row.code_hash != code
    assert len(row.code_hash) == 64                 # sha256 hex
    assert row.code_hash == hash_code(code)         # peppered with SECRET_KEY
    assert verify_code(row.code_hash, code) is True


def test_codes_are_six_digits_and_do_not_repeat(db):
    user = make_user(db, "random.otp@aiderma.local")

    seen = set()
    for _ in range(25):
        code, _err = issue_otp(db, user, PURPOSE_SIGNUP, ignore_cooldown=True)
        assert len(code) == 6 and code.isdigit()
        assert 100000 <= int(code) <= 999999
        seen.add(code)
    db.commit()

    # 25 draws from 900k values: a collision means the generator is broken, not
    # unlucky (probability of a real collision here is ~3e-4).
    assert len(seen) >= 24


def test_issuing_a_new_code_retires_the_previous_one_for_that_purpose(db):
    user = make_user(db, "supersede@aiderma.local")

    first, _ = issue_otp(db, user, PURPOSE_SIGNUP, ignore_cooldown=True)
    second, _ = issue_otp(db, user, PURPOSE_SIGNUP, ignore_cooldown=True)
    db.commit()

    assert verify_otp(db, user, PURPOSE_SIGNUP, first) == (False, ERR_INVALID)
    assert verify_otp(db, user, PURPOSE_SIGNUP, second)[0] is True


def test_a_consumed_code_cannot_be_redeemed_twice(db):
    user = make_user(db, "replay.otp@aiderma.local")
    code, _ = issue_otp(db, user, PURPOSE_SIGNUP, ignore_cooldown=True)
    db.commit()

    assert verify_otp(db, user, PURPOSE_SIGNUP, code)[0] is True
    db.commit()
    assert verify_otp(db, user, PURPOSE_SIGNUP, code) == (False, ERR_NO_ACTIVE_OTP)


# ======================================================================
# PURPOSE SCOPING
# ======================================================================
def test_a_signup_code_does_not_open_the_reset_door(db):
    user = make_user(db, "scoped1@aiderma.local")
    signup_code, _ = issue_otp(db, user, PURPOSE_SIGNUP, ignore_cooldown=True)
    db.commit()

    assert verify_otp(db, user, PURPOSE_RESET, signup_code)[0] is False
    assert verify_otp(db, user, PURPOSE_SIGNUP, signup_code)[0] is True


def test_a_reset_code_does_not_activate_an_account(db):
    user = make_user(db, "scoped2@aiderma.local", is_verified=False)
    reset_code, _ = issue_otp(db, user, PURPOSE_RESET, ignore_cooldown=True)
    db.commit()

    assert verify_otp(db, user, PURPOSE_SIGNUP, reset_code)[0] is False
    assert verify_otp(db, user, PURPOSE_RESET, reset_code)[0] is True


def test_two_purposes_hold_two_live_codes_at_once(db):
    """The old single-column design made this impossible: requesting a reset
    while a signup code was outstanding destroyed the signup code."""
    user = make_user(db, "both.purposes@aiderma.local", is_verified=False)

    signup_code, _ = issue_otp(db, user, PURPOSE_SIGNUP, ignore_cooldown=True)
    reset_code, _ = issue_otp(db, user, PURPOSE_RESET, ignore_cooldown=True)
    db.commit()

    assert verify_otp(db, user, PURPOSE_RESET, reset_code)[0] is True
    db.commit()
    assert verify_otp(db, user, PURPOSE_SIGNUP, signup_code)[0] is True


def test_the_endpoints_enforce_the_same_scoping(client, catalogue, mail, db):
    """End to end: the reset code mailed to a real inbox cannot verify a signup,
    and the signup code cannot reset a password."""
    email = "endtoend.scope@aiderma.local"
    signup(client, mail, email, verify=False)
    signup_code = mail.last_code(email)

    assert client.post("/auth/forgot-password", json={"email": email}).status_code == 200
    reset_code = mail.last_code(email)
    assert reset_code != signup_code

    crossed = client.post("/auth/reset-password", json={
        "email": email, "otp": signup_code, "new_password": "BrandNewPass!9"})
    assert crossed.status_code == 400

    crossed_back = client.post("/verify-otp-email", json={"email": email, "otp": reset_code})
    assert crossed_back.status_code == 400

    # each still works in its own lane
    assert client.post("/verify-otp-email", json={"email": email, "otp": signup_code}).status_code == 200
    assert client.post("/auth/reset-password", json={
        "email": email, "otp": reset_code, "new_password": "BrandNewPass!9"}).status_code == 200


def test_an_unknown_purpose_is_a_400_not_a_silent_signup(client, catalogue, db):
    make_user(db, "badpurpose@aiderma.local")
    response = client.post("/auth/resend-otp", json={
        "email": "badpurpose@aiderma.local", "purpose": "whatever"})
    assert response.status_code == 400
    assert "purpose" in error_of(response).lower()


# ======================================================================
# EXPIRY
# ======================================================================
def test_a_code_expires_after_ten_minutes(db):
    user = make_user(db, "expiring@aiderma.local")
    code, _ = issue_otp(db, user, PURPOSE_SIGNUP, ignore_cooldown=True)
    db.commit()

    _backdate(db, user.id, PURPOSE_SIGNUP, minutes=11)

    assert verify_otp(db, user, PURPOSE_SIGNUP, code) == (False, ERR_EXPIRED)


def test_a_code_is_still_good_at_nine_minutes(db):
    user = make_user(db, "notyet@aiderma.local")
    code, _ = issue_otp(db, user, PURPOSE_SIGNUP, ignore_cooldown=True)
    db.commit()

    _backdate(db, user.id, PURPOSE_SIGNUP, minutes=9)

    assert verify_otp(db, user, PURPOSE_SIGNUP, code)[0] is True


def test_an_expired_code_is_reported_through_the_endpoint_too(client, catalogue, mail, db):
    email = "expired.endpoint@aiderma.local"
    signup(client, mail, email, verify=False)

    from app.models import User

    db.expire_all()
    user = db.query(User).filter(User.email == email).one()
    _backdate(db, user.id, PURPOSE_SIGNUP, minutes=11)

    response = client.post("/verify-otp-email", json={"email": email, "otp": mail.last_code(email)})
    assert response.status_code == 400
    assert response.get_json()["error"] == ERR_EXPIRED


# ======================================================================
# ATTEMPT LOCKOUT
# ======================================================================
def test_five_wrong_guesses_lock_the_code(db):
    user = make_user(db, "bruteforce@aiderma.local")
    code, _ = issue_otp(db, user, PURPOSE_SIGNUP, ignore_cooldown=True)
    db.commit()

    wrong = "000000" if code != "000000" else "111111"

    for attempt in range(1, 5):
        ok, err = verify_otp(db, user, PURPOSE_SIGNUP, wrong)
        assert ok is False
        assert err == ERR_INVALID, f"attempt {attempt}"

    ok, err = verify_otp(db, user, PURPOSE_SIGNUP, wrong)
    assert (ok, err) == (False, ERR_TOO_MANY_ATTEMPTS)
    db.commit()

    # Even the RIGHT code is refused once the row is locked.
    assert verify_otp(db, user, PURPOSE_SIGNUP, code) == (False, ERR_TOO_MANY_ATTEMPTS)


def test_attempts_are_counted_per_row_not_per_user(db):
    """A wrong guess against the signup code must not consume the reset code's
    budget -- they are different rows now."""
    user = make_user(db, "perrow@aiderma.local")
    signup_code, _ = issue_otp(db, user, PURPOSE_SIGNUP, ignore_cooldown=True)
    reset_code, _ = issue_otp(db, user, PURPOSE_RESET, ignore_cooldown=True)
    db.commit()

    for _ in range(5):
        verify_otp(db, user, PURPOSE_SIGNUP, "000001")
    db.commit()

    assert verify_otp(db, user, PURPOSE_SIGNUP, signup_code)[0] is False
    assert verify_otp(db, user, PURPOSE_RESET, reset_code)[0] is True


def test_the_lockout_can_no_longer_be_reset_for_free(client, catalogue, db):
    """THE REGRESSION TEST for the unbounded-lockout bug.

    Old behaviour: five wrong guesses, then POST /forgot-password, and
    otp_attempts went back to 0 with no cooldown -- five more guesses, forever.
    Now the reissue is cooldown-gated, so the attacker pays 45 seconds per five
    guesses instead of nothing.
    """
    email = "lockout@aiderma.local"
    make_user(db, email)

    assert client.post("/auth/forgot-password", json={"email": email}).status_code == 200

    for _ in range(5):
        client.post("/auth/reset-password", json={
            "email": email, "otp": "000000", "new_password": "WhateverPass!1"})

    retry = client.post("/auth/forgot-password", json={"email": email})
    assert retry.status_code == 429
    assert "Please wait" in error_of(retry)


# ======================================================================
# RESEND COOLDOWN
# ======================================================================
def test_a_second_code_inside_the_cooldown_is_refused(db):
    user = make_user(db, "cooldown@aiderma.local")

    first, err = issue_otp(db, user, PURPOSE_SIGNUP)
    assert err is None and first

    second, err = issue_otp(db, user, PURPOSE_SIGNUP)
    assert second is None
    assert err.startswith("Please wait ") and err.endswith("s before requesting another OTP.")


def test_the_cooldown_lifts_after_45_seconds(db):
    user = make_user(db, "cooldown2@aiderma.local")
    issue_otp(db, user, PURPOSE_SIGNUP)
    db.commit()

    assert resend_wait_seconds(db, user, PURPOSE_SIGNUP) > 0
    _backdate(db, user.id, PURPOSE_SIGNUP, minutes=1)
    assert resend_wait_seconds(db, user, PURPOSE_SIGNUP) == 0

    code, err = issue_otp(db, user, PURPOSE_SIGNUP)
    assert err is None and code


def test_the_cooldown_is_per_purpose(db):
    """Asking for a password reset must not be blocked by a signup code sent
    five seconds ago."""
    user = make_user(db, "cooldown3@aiderma.local")

    issue_otp(db, user, PURPOSE_SIGNUP)
    db.commit()

    assert resend_wait_seconds(db, user, PURPOSE_SIGNUP) > 0
    assert resend_wait_seconds(db, user, PURPOSE_RESET) == 0
    code, err = issue_otp(db, user, PURPOSE_RESET)
    assert err is None and code


def test_resend_endpoint_returns_the_exact_429_message(client, catalogue, mail, db):
    email = "resend.spam@aiderma.local"
    signup(client, mail, email, verify=False)

    response = client.post("/resend-otp", json={"email": email})
    assert response.status_code == 429
    message = response.get_json()["error"]
    assert message.startswith("Please wait ")
    assert message.endswith("s before requesting another OTP.")


def test_resend_is_refused_once_the_account_is_verified(client, catalogue, mail, db):
    email = "already.verified@aiderma.local"
    signup(client, mail, email)

    response = client.post("/resend-otp", json={"email": email})
    assert response.status_code == 400
    assert "already verified" in error_of(response)


# ======================================================================
# THE LEGACY DUAL-WRITE  (delete these with Part 1 of otp_service)
# ======================================================================
def test_a_code_minted_before_this_deploy_is_still_redeemable(client, db):
    """A user whose OTP is sitting in their inbox from the OLD implementation
    has users.otp_code set and NO email_otps row. They must not be stranded."""
    from app.core.security import utcnow

    user = make_user(db, "inflight@aiderma.local", is_verified=False)
    user.otp_code = "424242"
    user.otp_created_at = utcnow()
    user.otp_attempts = 0
    db.commit()

    response = client.post("/verify-otp-email", json={"email": user.email, "otp": "424242"})
    assert response.status_code == 200

    db.expire_all()
    db.refresh(user)
    assert user.is_verified is True
    assert user.otp_code is None            # the legacy column is cleared on use


def test_the_legacy_column_cannot_be_used_to_cross_purposes(client, catalogue, mail, db):
    """The dual write puts the SIGNUP code in users.otp_code. If the legacy
    fallback honoured it blindly, /auth/reset-password would accept a signup
    code and purpose scoping would be theatre."""
    from app.models import User

    email = "shadow@aiderma.local"
    signup(client, mail, email, verify=False)
    code = mail.last_code(email)

    db.expire_all()
    user = db.query(User).filter(User.email == email).one()
    assert user.otp_code == code            # the dual write really is there

    response = client.post("/auth/reset-password", json={
        "email": email, "otp": code, "new_password": "NotThisWay!7"})
    assert response.status_code == 400

    # ...and the stored password really was left alone.
    from app.core.security import verify_password

    db.expire_all()
    user = db.query(User).filter(User.email == email).one()
    assert verify_password(user.password, "NotThisWay!7") is False


def test_new_codes_are_dual_written_so_the_old_routes_keep_working(db):
    user = make_user(db, "dualwrite@aiderma.local", is_verified=False)
    code, _ = issue_otp(db, user, PURPOSE_SIGNUP, ignore_cooldown=True)
    db.commit()

    db.refresh(user)
    assert user.otp_code == code
    assert user.otp_attempts == 0


def test_redeeming_a_code_clears_the_legacy_columns(db):
    user = make_user(db, "cleanup@aiderma.local", is_verified=False)
    code, _ = issue_otp(db, user, PURPOSE_SIGNUP, ignore_cooldown=True)
    db.commit()

    verify_otp(db, user, PURPOSE_SIGNUP, code)
    db.commit()

    db.refresh(user)
    assert user.otp_code is None
    assert user.otp_created_at is None


# ======================================================================
# OTPs and password changes
# ======================================================================
def test_a_password_reset_invalidates_every_outstanding_code(client, catalogue, mail, db):
    from app.models import User

    email = "otp.wipe@aiderma.local"
    make_user(db, email)
    user = db.query(User).filter(User.email == email).one()

    signup_code, _ = issue_otp(db, user, PURPOSE_SIGNUP, ignore_cooldown=True)
    db.commit()

    client.post("/auth/forgot-password", json={"email": email})
    reset_code = mail.last_code(email)

    assert client.post("/auth/reset-password", json={
        "email": email, "otp": reset_code, "new_password": "FreshPass!2026"}).status_code == 200

    db.expire_all()
    user = db.query(User).filter(User.email == email).one()
    assert verify_otp(db, user, PURPOSE_SIGNUP, signup_code)[0] is False


def test_login_works_with_the_new_password_after_a_reset(client, catalogue, mail, db):
    email = "afterreset@aiderma.local"
    make_user(db, email)

    client.post("/auth/forgot-password", json={"email": email})
    assert client.post("/auth/reset-password", json={
        "email": email, "otp": mail.last_code(email), "new_password": "FreshPass!2026",
    }).status_code == 200

    assert client.post("/auth/login", json={
        "email": email, "password": DEFAULT_PASSWORD}).status_code == 401
    new_login = client.post("/auth/login", json={"email": email, "password": "FreshPass!2026"})
    assert new_login.status_code == 200
    assert data_of(new_login)["token"]
