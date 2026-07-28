"""
Runtime settings: /api/admin/settings and the toggles it controls.

WHAT THIS FILE PINS
-------------------
1. THE ROUNDTRIP. A PUT lands in the system_settings table and the very next
   GET (a different request, a different DB session) reads it back -- no
   restart, no cache to invalidate.
2. THE MASK. email_pass goes in and never comes out: every response carries
   only the boolean email_pass_set. If the literal secret ever appears in a
   response body this file goes red.
3. VALIDATION IS ATOMIC. One bad field fails the whole PUT with a 400 that
   names it, and nothing else in the batch is applied.
4. TEST-EMAIL SHOWS THE REAL ERROR. The 502 body carries the smtplib error
   text, because "false" is not something an admin can debug against.
5. THE OTP KILL SWITCH. With otp_verification_enabled false, BOTH register
   endpoints create the account already verified, send nothing, and (on
   /auth/register) hand back the same token bundle /auth/verify-otp would --
   and with the toggle on (the default) both behave exactly as before.

Every test needs a database; the module skips without TEST_DATABASE_URL, like
the rest of the suite (see tests/conftest.py).
"""

import smtplib

import pytest

from tests.authkit import (
    CONSENTS_PATIENT,
    DEFAULT_PASSWORD,
    data_of,
    error_of,
    install_mailbox,
    make_user,
    seed_consents,
)

SETTINGS_URL = "/api/admin/settings"
SETTINGS_URL_ALIAS = "/admin/settings"
TEST_EMAIL_URL = "/api/admin/settings/test-email"

SECRET = "super-secret-app-password-9911"


@pytest.fixture(autouse=True)
def mail(monkeypatch):
    """No test in this file may reach a real SMTP server through the auth
    routes. The /admin/settings/test-email path is exercised separately by
    monkeypatching smtplib itself."""
    return install_mailbox(monkeypatch)


@pytest.fixture()
def admin_headers(db, auth_headers):
    admin = make_user(db, "settings.admin@aiderma.local", role="Admin")
    return auth_headers(admin.id, "Admin")


def _get_settings(client, headers, url=SETTINGS_URL):
    response = client.get(url, headers=headers)
    assert response.status_code == 200, response.get_json()
    return data_of(response)


# ======================================================================
# AUTHORISATION
# ======================================================================
def test_settings_require_a_token(client, db):
    assert client.get(SETTINGS_URL).status_code == 401
    assert client.put(SETTINGS_URL, json={}).status_code == 401
    assert client.post(TEST_EMAIL_URL, json={"to": "x@y.co"}).status_code == 401


@pytest.mark.parametrize("role", ["Doctor", "AI User"])
def test_settings_are_admin_only(client, db, auth_headers, role):
    user = make_user(db, f"{role.replace(' ', '.').lower()}@aiderma.local", role=role)
    headers = auth_headers(user.id, role)

    assert client.get(SETTINGS_URL, headers=headers).status_code == 403
    assert client.put(SETTINGS_URL, headers=headers, json={}).status_code == 403
    assert client.post(TEST_EMAIL_URL, headers=headers, json={"to": "x@y.co"}).status_code == 403


# ======================================================================
# SHAPE AND ROUNDTRIP
# ======================================================================
def test_get_returns_the_frozen_shape(client, admin_headers):
    data = _get_settings(client, admin_headers)

    assert set(data.keys()) == {"email", "otp"}
    email = data["email"]
    otp = data["otp"]

    assert set(email.keys()) == {
        "smtp_host", "smtp_port", "smtp_use_ssl",
        "email_user", "email_pass_set", "email_enabled",
    }
    assert set(otp.keys()) == {
        "otp_expiry_minutes", "otp_max_attempts",
        "otp_resend_cooldown_seconds", "otp_length",
        "otp_verification_enabled",
    }

    assert isinstance(email["smtp_host"], str)
    assert isinstance(email["smtp_port"], int)
    assert isinstance(email["smtp_use_ssl"], bool)
    assert isinstance(email["email_pass_set"], bool)
    assert isinstance(email["email_enabled"], bool)
    for key in ("otp_expiry_minutes", "otp_max_attempts",
                "otp_resend_cooldown_seconds", "otp_length"):
        assert isinstance(otp[key], int), key
    assert isinstance(otp["otp_verification_enabled"], bool)


def test_both_url_spellings_answer_identically(client, admin_headers):
    assert _get_settings(client, admin_headers) == _get_settings(
        client, admin_headers, url=SETTINGS_URL_ALIAS
    )


def test_settings_roundtrip_through_the_api(client, db, admin_headers):
    put = client.put(SETTINGS_URL, headers=admin_headers, json={
        "email": {
            "smtp_host": "mail.example.com",
            "smtp_port": 2525,
            "smtp_use_ssl": False,
            "email_user": "ops@example.com",
            "email_pass": SECRET,
            "email_enabled": True,
        },
        "otp": {
            "otp_expiry_minutes": 5,
            "otp_max_attempts": 3,
            "otp_resend_cooldown_seconds": 60,
            "otp_length": 6,
            "otp_verification_enabled": True,
        },
    })
    assert put.status_code == 200, put.get_json()

    # The PUT response and a fresh GET agree, field for field.
    expected_email = {
        "smtp_host": "mail.example.com", "smtp_port": 2525, "smtp_use_ssl": False,
        "email_user": "ops@example.com", "email_pass_set": True, "email_enabled": True,
    }
    expected_otp = {
        "otp_expiry_minutes": 5, "otp_max_attempts": 3,
        "otp_resend_cooldown_seconds": 60, "otp_length": 6,
        "otp_verification_enabled": True,
    }
    assert data_of(put) == {"email": expected_email, "otp": expected_otp}
    assert _get_settings(client, admin_headers) == {
        "email": expected_email, "otp": expected_otp,
    }

    # The services read the same values -- this is what makes a save take
    # effect on the next request with no restart.
    from app.services.otp_service import _config
    from app.services import settings_service

    assert _config("OTP_MAX_ATTEMPTS", 5) == 3
    assert _config("OTP_EXPIRY_MINUTES", 10) == 5
    assert settings_service.get_effective("SMTP_HOST") == "mail.example.com"
    assert settings_service.get_bool("SMTP_USE_SSL", True) is False


def test_put_is_partial_an_absent_field_is_left_alone(client, admin_headers):
    assert client.put(SETTINGS_URL, headers=admin_headers, json={
        "otp": {"otp_max_attempts": 4},
    }).status_code == 200

    before = _get_settings(client, admin_headers)
    assert client.put(SETTINGS_URL, headers=admin_headers, json={
        "email": {"smtp_host": "relay.example.com"},
    }).status_code == 200

    after = _get_settings(client, admin_headers)
    assert after["email"]["smtp_host"] == "relay.example.com"
    assert after["otp"] == before["otp"]                    # untouched
    assert after["otp"]["otp_max_attempts"] == 4


def test_every_put_writes_an_audit_row_naming_keys_not_values(client, db, admin_headers):
    client.put(SETTINGS_URL, headers=admin_headers, json={
        "email": {"email_pass": SECRET},
    })

    from app.models import AuditLog

    db.expire_all()
    row = (
        db.query(AuditLog)
        .filter(AuditLog.action == "settings.update")
        .order_by(AuditLog.id.desc())
        .first()
    )
    assert row is not None
    assert "EMAIL_PASS" in (row.detail or "")
    assert SECRET not in (row.detail or "")


# ======================================================================
# THE MASK
# ======================================================================
def test_email_pass_is_write_only(client, admin_headers):
    put = client.put(SETTINGS_URL, headers=admin_headers, json={
        "email": {"email_pass": SECRET},
    })
    assert put.status_code == 200

    for response in (put, client.get(SETTINGS_URL, headers=admin_headers)):
        body = response.get_json()
        assert SECRET not in str(body)
        email = body["data"]["email"]
        assert "email_pass" not in email
        assert email["email_pass_set"] is True


# ======================================================================
# VALIDATION -- atomic, field-naming 400s
# ======================================================================
@pytest.mark.parametrize("payload, named_field", [
    ({"email": {"smtp_port": 0}}, "smtp_port"),
    ({"email": {"smtp_port": 70000}}, "smtp_port"),
    ({"email": {"smtp_port": "not-a-port"}}, "smtp_port"),
    ({"email": {"smtp_use_ssl": "maybe"}}, "smtp_use_ssl"),
    ({"email": {"smtp_host": ""}}, "smtp_host"),
    ({"otp": {"otp_expiry_minutes": 0}}, "otp_expiry_minutes"),
    ({"otp": {"otp_expiry_minutes": 121}}, "otp_expiry_minutes"),
    ({"otp": {"otp_max_attempts": 11}}, "otp_max_attempts"),
    ({"otp": {"otp_resend_cooldown_seconds": 5}}, "otp_resend_cooldown_seconds"),
    ({"otp": {"otp_resend_cooldown_seconds": 601}}, "otp_resend_cooldown_seconds"),
    ({"otp": {"otp_length": 3}}, "otp_length"),
    ({"otp": {"otp_length": 9}}, "otp_length"),
    ({"email": {"totally_unknown": 1}}, "totally_unknown"),
    ({"pizza": {"anything": 1}}, "pizza"),
])
def test_a_bad_field_is_a_400_naming_it(client, admin_headers, payload, named_field):
    before = _get_settings(client, admin_headers)

    response = client.put(SETTINGS_URL, headers=admin_headers, json=payload)
    assert response.status_code == 400, response.get_json()
    assert named_field in error_of(response)

    # ...and NOTHING changed.
    assert _get_settings(client, admin_headers) == before


def test_a_batch_with_one_bad_field_applies_none_of_it(client, admin_headers):
    before = _get_settings(client, admin_headers)

    response = client.put(SETTINGS_URL, headers=admin_headers, json={
        "email": {"smtp_host": "would-be-saved.example.com"},
        "otp": {"otp_length": 99},
    })
    assert response.status_code == 400

    after = _get_settings(client, admin_headers)
    assert after == before
    assert after["email"]["smtp_host"] != "would-be-saved.example.com"


# ======================================================================
# TEST-EMAIL -- the real smtplib error, or nothing
# ======================================================================
class _RecordingSMTP:
    """Stands in for smtplib.SMTP / SMTP_SSL. Records, sends nothing."""

    instances = []

    def __init__(self, host, port, timeout=None):
        self.host, self.port = host, port
        type(self).instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def login(self, user, password):
        self.login_args = (user, password)

    def starttls(self):
        self.tls_started = True

    def sendmail(self, sender, recipients, message):
        self.sent = (sender, recipients, message)


@pytest.fixture()
def smtp_recorder(monkeypatch):
    _RecordingSMTP.instances = []
    monkeypatch.setattr(smtplib, "SMTP_SSL", _RecordingSMTP)
    monkeypatch.setattr(smtplib, "SMTP", _RecordingSMTP)
    return _RecordingSMTP


def _save_working_smtp(client, admin_headers, use_ssl=True):
    assert client.put(SETTINGS_URL, headers=admin_headers, json={
        "email": {
            "smtp_host": "mail.example.com", "smtp_port": 465,
            "smtp_use_ssl": use_ssl,
            "email_user": "ops@example.com", "email_pass": SECRET,
            "email_enabled": True,
        },
    }).status_code == 200


def test_test_email_sends_with_the_saved_settings(client, db, admin_headers, smtp_recorder):
    _save_working_smtp(client, admin_headers)

    response = client.post(TEST_EMAIL_URL, headers=admin_headers,
                           json={"to": "inbox.check@aiderma.local"})
    assert response.status_code == 200, response.get_json()
    assert data_of(response) == {"to": "inbox.check@aiderma.local"}

    server = smtp_recorder.instances[-1]
    assert server.host == "mail.example.com"
    assert server.login_args == ("ops@example.com", SECRET)
    assert server.sent[1] == ["inbox.check@aiderma.local"]


def test_test_email_failure_returns_the_real_smtplib_error_with_502(
        client, db, admin_headers, monkeypatch):
    _save_working_smtp(client, admin_headers)

    def _explode(*args, **kwargs):
        raise smtplib.SMTPAuthenticationError(
            535, b"5.7.8 Username and Password not accepted"
        )

    monkeypatch.setattr(smtplib, "SMTP_SSL", _explode)
    monkeypatch.setattr(smtplib, "SMTP", _explode)

    response = client.post(TEST_EMAIL_URL, headers=admin_headers,
                           json={"to": "inbox.check@aiderma.local"})
    assert response.status_code == 502
    message = error_of(response)
    assert "535" in message
    assert "not accepted" in message


def test_test_email_requires_a_recipient(client, admin_headers):
    assert client.post(TEST_EMAIL_URL, headers=admin_headers, json={}).status_code == 400
    assert client.post(TEST_EMAIL_URL, headers=admin_headers,
                       json={"to": "not-an-address"}).status_code == 400


def test_email_disabled_never_touches_the_network(client, db, admin_headers, smtp_recorder):
    _save_working_smtp(client, admin_headers)
    assert client.put(SETTINGS_URL, headers=admin_headers, json={
        "email": {"email_enabled": False},
    }).status_code == 200

    from app.services.email_service import send_email

    assert send_email("anyone@aiderma.local", "s", "b") is False
    assert smtp_recorder.instances == []          # nothing was even constructed

    # ...and test-email says so instead of pretending.
    response = client.post(TEST_EMAIL_URL, headers=admin_headers,
                           json={"to": "anyone@aiderma.local"})
    assert response.status_code == 502
    assert "disabled" in error_of(response).lower()


# ======================================================================
# THE OTP KILL SWITCH
# ======================================================================
@pytest.fixture()
def otp_disabled(client, db, admin_headers):
    seed_consents(db)
    assert client.put(SETTINGS_URL, headers=admin_headers, json={
        "otp": {"otp_verification_enabled": False},
    }).status_code == 200
    return db


def test_auth_register_with_otp_disabled_creates_a_verified_account(
        client, otp_disabled, mail, db):
    email = "no.otp@aiderma.local"
    response = client.post("/auth/register", json={
        "name": "No Otp", "email": email, "password": DEFAULT_PASSWORD,
        "role": "AI User", "consents": CONSENTS_PATIENT,
    })
    assert response.status_code == 201, response.get_json()

    data = data_of(response)
    assert data["verified"] is True
    assert data["email"] == email
    # The same token bundle /auth/verify-otp hands back for a signup code, so
    # the client can seat the session without a second round trip.
    assert data["token"]
    assert data["refresh_token"]
    assert data["user"]["email"] == email
    assert data["next"] == "password"

    # No OTP email (or any email) went out for this address.
    assert mail.to(email) == []

    from app.models import User

    db.expire_all()
    user = db.query(User).filter(User.email == email).one()
    assert user.is_verified is True
    assert user.otp_code is None

    # The account is immediately usable.
    login = client.post("/auth/login", json={"email": email, "password": DEFAULT_PASSWORD})
    assert login.status_code == 200


def test_legacy_register_with_otp_disabled_creates_a_verified_account(
        client, otp_disabled, mail, db):
    email = "no.otp.legacy@aiderma.local"
    response = client.post("/register", json={
        "name": "No Otp Legacy", "email": email, "password": DEFAULT_PASSWORD,
    })
    assert response.status_code == 201, response.get_json()
    assert data_of(response)["verified"] is True
    assert mail.to(email) == []

    from app.models import User

    db.expire_all()
    assert db.query(User).filter(User.email == email).one().is_verified is True

    login = client.post("/login", json={"email": email, "password": DEFAULT_PASSWORD})
    assert login.status_code == 200


def test_with_the_toggle_on_registration_still_requires_the_otp(client, db, mail):
    """The default. Byte-compatible with the pre-settings behaviour: the OTP
    email goes out, the account is unverified, login is refused until the code
    is redeemed."""
    seed_consents(db)
    email = "otp.still.on@aiderma.local"

    response = client.post("/register", json={
        "name": "Still Gated", "email": email, "password": DEFAULT_PASSWORD,
    })
    assert response.status_code == 201
    assert response.get_json()["message"] == "OTP sent to email"
    assert mail.last_code(email)                 # a code really was mailed

    from app.models import User

    db.expire_all()
    assert db.query(User).filter(User.email == email).one().is_verified is False

    login = client.post("/login", json={"email": email, "password": DEFAULT_PASSWORD})
    assert login.status_code == 403
