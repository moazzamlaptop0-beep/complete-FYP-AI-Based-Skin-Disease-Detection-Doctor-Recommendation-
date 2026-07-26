"""
The server-side password floor.

There was none. `"1"` was a valid password, and the only thing between an
account and a dictionary attack was whatever the React form happened to
validate that week -- which a curl one-liner skips entirely.

THREE RULES, DELIBERATELY BORING
--------------------------------
  length >= 8      everything shorter is brute-forceable offline
  not all digits   "12345678" passes a length check and is in every wordlist
  not on the list  the top few dozen passwords cover a startling share of reuse

NOT A STRENGTH METER, and NOT RETROACTIVE: it runs where a password is being
CHOSEN (register, reset), never where one is being CHECKED. An existing weak
password keeps working -- locking people out of their own medical records to
enforce a policy written after they signed up is not a security improvement.
"""

import pytest

from app.core.security import hash_password
from app.services.auth_service import (
    PASSWORD_ALL_NUMERIC,
    PASSWORD_REQUIRED,
    PASSWORD_TOO_COMMON,
    PASSWORD_TOO_SHORT,
    validate_password,
)
from tests.authkit import (
    CONSENTS_PATIENT,
    DEFAULT_PASSWORD,
    data_of,
    error_of,
    install_mailbox,
    make_user,
    seed_consents,
)


@pytest.fixture(autouse=True)
def mail(monkeypatch):
    """Autouse: no test in this file may reach a real SMTP server."""
    return install_mailbox(monkeypatch)


@pytest.fixture()
def catalogue(db):
    seed_consents(db)
    return db


# ======================================================================
# THE RULE TABLE
# ======================================================================
@pytest.mark.parametrize("password", [
    "SkinCare!2026",
    "correct horse battery",
    "aB3$aB3$",
    "не-латиница-пароль",
    "12345678a",
])
def test_acceptable_passwords(app, password):
    ok, why = validate_password(password)
    assert ok is True, f"{password!r} was rejected: {why}"
    assert why is None


@pytest.mark.parametrize("password,expected", [
    ("", PASSWORD_REQUIRED),
    (None, PASSWORD_REQUIRED),
    ("short7", PASSWORD_TOO_SHORT.format(n=8)),
    ("1234567", PASSWORD_TOO_SHORT.format(n=8)),
    ("12345678", PASSWORD_ALL_NUMERIC),
    ("000000000000", PASSWORD_ALL_NUMERIC),
    ("password", PASSWORD_TOO_COMMON),
    ("PASSWORD", PASSWORD_TOO_COMMON),
    ("Password123", PASSWORD_TOO_COMMON),
    ("qwertyuiop", PASSWORD_TOO_COMMON),
    ("doctor123", PASSWORD_TOO_COMMON),
])
def test_rejected_passwords(app, password, expected):
    ok, why = validate_password(password)
    assert ok is False, f"{password!r} was accepted"
    assert why == expected


def test_the_common_list_is_case_insensitive(app):
    """'Password123' is not meaningfully better than the spelling already in the
    attacker's wordlist."""
    for spelling in ("letmein!", "LetMeIn!", "LETMEIN!"):
        assert validate_password(spelling)[0] is True   # the '!' takes it off the list
    for spelling in ("letmein", "LetMeIn", "LETMEIN"):
        assert validate_password(spelling)[0] is False


def test_the_minimum_length_follows_config(app, monkeypatch):
    monkeypatch.setitem(app.config, "PASSWORD_MIN_LENGTH", 12)
    ok, why = validate_password("elevenchar!")
    assert ok is False
    assert why == PASSWORD_TOO_SHORT.format(n=12)


# ======================================================================
# /auth/register
# ======================================================================
@pytest.mark.parametrize("password", ["short", "12345678", "password123"])
def test_the_new_register_route_enforces_the_policy(client, catalogue, password):
    response = client.post("/auth/register", json={
        "name": "Weak", "email": f"weak.{len(password)}@aiderma.local",
        "password": password, "consents": CONSENTS_PATIENT,
    })
    assert response.status_code == 400
    assert error_of(response)


def test_a_weak_password_creates_nothing(client, catalogue, db):
    from app.models import User

    client.post("/auth/register", json={
        "name": "Weak", "email": "nothing.created@aiderma.local",
        "password": "1234567", "consents": CONSENTS_PATIENT,
    })

    db.expire_all()
    assert db.query(User).filter(User.email == "nothing.created@aiderma.local").first() is None


def test_the_policy_runs_before_the_consent_gate_is_satisfied(client, catalogue):
    """Order matters only in that BOTH have to pass; neither may be bypassed by
    failing the other first."""
    response = client.post("/auth/register", json={
        "name": "Weak", "email": "weak.noconsent@aiderma.local",
        "password": "1234567", "consents": [],
    })
    assert response.status_code == 400


# ======================================================================
# THE LEGACY ROUTES  (a policy the old endpoint can bypass is not a policy)
# ======================================================================
def test_legacy_register_enforces_the_policy_too(client, db):
    response = client.post("/register", json={
        "name": "Legacy Weak", "email": "legacy.weak@aiderma.local", "password": "12345678",
    })
    assert response.status_code == 400
    assert error_of(response) == PASSWORD_ALL_NUMERIC


def test_legacy_reset_password_enforces_the_policy_too(client, db):
    make_user(db, "legacy.reset@aiderma.local")
    response = client.post("/reset-password", json={
        "email": "legacy.reset@aiderma.local", "otp": "000000", "new_password": "abc",
    })
    assert response.status_code == 400
    assert response.get_json()["error"] == PASSWORD_TOO_SHORT.format(n=8)


def test_the_legacy_enforcement_has_an_off_switch(client, app, monkeypatch, mail, db):
    """ENFORCE_PASSWORD_POLICY_LEGACY=false restores the monolith's
    anything-goes behaviour on the two legacy routes without a code change --
    the escape hatch if it ever rejects something a real user is mid-flow on."""
    monkeypatch.setitem(app.config, "ENFORCE_PASSWORD_POLICY_LEGACY", False)

    response = client.post("/register", json={
        "name": "Grandfathered", "email": "grandfathered@aiderma.local", "password": "12345678",
    })
    assert response.status_code == 201


# ======================================================================
# NOT RETROACTIVE
# ======================================================================
@pytest.mark.parametrize("weak", ["1", "12345678", "password"])
def test_an_existing_weak_password_still_logs_in(client, catalogue, db, weak):
    """The rule applies to CHOOSING a password, never to checking one. Anything
    else locks people out of their own medical history."""
    from app.models import User

    email = f"old.{len(weak)}@aiderma.local"
    db.add(User(name="Old Timer", email=email, password=hash_password(weak),
                role="AI User", is_verified=True, is_active=True, is_root=False,
                token_version=0, otp_attempts=0, marketing_opt_in=False))
    db.commit()

    new_style = client.post("/auth/login", json={"email": email, "password": weak})
    assert new_style.status_code == 200
    assert data_of(new_style)["token"]

    legacy_style = client.post("/login", json={"email": email, "password": weak})
    assert legacy_style.status_code == 200


# ======================================================================
# RESET
# ======================================================================
def test_a_reset_cannot_downgrade_to_a_weak_password(client, catalogue, mail, db):
    email = "downgrade@aiderma.local"
    make_user(db, email)

    client.post("/auth/forgot-password", json={"email": email})
    code = mail.last_code(email)

    weak = client.post("/auth/reset-password", json={
        "email": email, "otp": code, "new_password": "1234567"})
    assert weak.status_code == 400

    # The code was NOT consumed by the rejected attempt, so the user can retry.
    strong = client.post("/auth/reset-password", json={
        "email": email, "otp": code, "new_password": "PerfectlyFine!42"})
    assert strong.status_code == 200

    assert client.post("/auth/login", json={
        "email": email, "password": "PerfectlyFine!42"}).status_code == 200


def test_the_error_message_tells_the_user_what_to_fix(client, catalogue):
    response = client.post("/auth/register", json={
        "name": "Curious", "email": "curious@aiderma.local",
        "password": "1234", "consents": CONSENTS_PATIENT,
    })
    assert error_of(response) == PASSWORD_TOO_SHORT.format(n=8)
    assert "8" in error_of(response)


def test_the_rules_are_published_so_they_are_not_a_guessing_game(client, catalogue):
    policy = data_of(client.get("/auth/consent-documents"))["password_policy"]
    assert policy["min_length"] == 8
    assert any("8 characters" in rule for rule in policy["rules"])
    assert any("numbers" in rule for rule in policy["rules"])
    assert any("common" in rule.lower() for rule in policy["rules"])


def test_the_default_test_password_passes_the_policy(app):
    assert validate_password(DEFAULT_PASSWORD)[0] is True
