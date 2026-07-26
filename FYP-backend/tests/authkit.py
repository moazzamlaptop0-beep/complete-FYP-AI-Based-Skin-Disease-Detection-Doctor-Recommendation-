"""
Shared helpers for the auth test modules.

NOT a conftest: `tests/conftest.py` is shared with other agents working in
parallel, so everything specific to the auth phase lives here and is imported
explicitly by the modules that need it.

THE MAILBOX
-----------
Every OTP in this system exists in plaintext exactly once: in the body of the
email that carries it (only its sha256 reaches the database). So the tests read
codes the way a user does -- out of the message -- rather than reaching into
users.otp_code. That also means these tests would still pass after the legacy
dual-write is deleted.
"""

import re

from app.core.security import hash_password

OTP_RE = re.compile(r"\b(\d{6})\b")

DEFAULT_PASSWORD = "SkinCare!2026"
CONSENTS_PATIENT = [
    {"type": "terms_of_use", "version": "1", "granted": True},
    {"type": "privacy_policy", "version": "1", "granted": True},
    {"type": "medical_data_processing", "version": "1", "granted": True},
]
CONSENTS_DOCTOR = CONSENTS_PATIENT + [
    {"type": "license_attestation", "version": "1", "granted": True},
]


class Mailbox(list):
    """Every send_email call, newest last: (to, subject, body)."""

    @property
    def last(self):
        assert self, "no email was sent"
        return self[-1]

    def last_code(self, to=None):
        for entry in reversed(self):
            if to is not None and entry[0] != to:
                continue
            found = OTP_RE.search(entry[2])
            if found:
                return found.group(1)
        raise AssertionError(f"no 6-digit code in mailbox {self!r}")

    def to(self, address):
        return [e for e in self if e[0] == address]


def install_mailbox(monkeypatch, fail=False):
    """Replace app.api.auth.routes.send_email with a recorder.

    `fail=True` makes every send return False, which is how the "email failed =>
    nothing was written" rollback paths get exercised without an SMTP server.
    """
    box = Mailbox()

    def _send(to_email, subject, body):
        box.append((to_email, subject, body))
        return not fail

    monkeypatch.setattr("app.api.auth.routes.send_email", _send)
    return box


def data_of(response):
    payload = response.get_json() or {}
    return payload.get("data") or {}


def error_of(response):
    return (response.get_json() or {}).get("error")


def make_user(db, email, role="AI User", password=DEFAULT_PASSWORD, **kwargs):
    """A verified, active user row committed straight to the database.

    Used by tests that are about something OTHER than registration, so they do
    not pay for a four-request signup flow to get an account.
    """
    from app.models import User

    fields = {
        "name": kwargs.pop("name", email.split("@")[0]),
        "email": email,
        "password": hash_password(password),
        "role": role,
        "is_verified": True,
        "is_active": True,
        "is_root": False,
        "token_version": 0,
        "otp_attempts": 0,
        "marketing_opt_in": False,
    }
    fields.update(kwargs)
    user = User(**fields)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def make_doctor(db, email, license_no=None, verification_status="approved", **kwargs):
    from app.models import DoctorProfile

    user = make_user(db, email, role="Doctor", **kwargs)
    db.add(DoctorProfile(
        user_id=user.id,
        license=license_no or f"LIC-{user.id:05d}",
        specialty="Dermatology",
        city="Lahore",
        verification_status=verification_status,
    ))
    db.commit()
    return user


def login(client, email, password=DEFAULT_PASSWORD):
    """POST /auth/login -> the data block. Asserts success."""
    response = client.post("/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.get_json()
    return data_of(response)


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def signup(client, mail, email, role="AI User", password=DEFAULT_PASSWORD,
           consents=None, doctor=None, verify=True):
    """Full /auth/register -> /auth/verify-otp round trip.

    Returns the verify-otp data block (which carries the session when
    `verify=True`), or the register data block when verify=False.
    """
    body = {
        "name": email.split("@")[0],
        "email": email,
        "password": password,
        "role": role,
        "consents": consents if consents is not None else (
            CONSENTS_DOCTOR if role == "Doctor" else CONSENTS_PATIENT
        ),
    }
    if doctor is not None:
        body["doctor"] = doctor
    elif role == "Doctor":
        body["doctor"] = {"license": f"LIC-{abs(hash(email)) % 100000:05d}",
                          "specialty": "Dermatology", "city": "Lahore"}

    registered = client.post("/auth/register", json=body)
    assert registered.status_code == 201, registered.get_json()
    if not verify:
        return data_of(registered)

    code = mail.last_code(email)
    verified = client.post("/auth/verify-otp", json={
        "email": email, "otp": code, "purpose": "signup",
    })
    assert verified.status_code == 200, verified.get_json()
    return data_of(verified)


def seed_consents(db):
    """Seed the consent catalogue and COMMIT it.

    The commit matters: the request handlers run in their own session, so an
    uncommitted seed is invisible to them.
    """
    from scripts.seed_consent_docs import seed_consent_docs

    result = seed_consent_docs(db)
    db.commit()
    return result
