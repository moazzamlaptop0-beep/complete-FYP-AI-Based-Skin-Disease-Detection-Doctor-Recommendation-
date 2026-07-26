"""
The /auth session layer end to end.

WHAT THIS FILE IS PROTECTING
----------------------------
1. /auth/check-email answers with three words and leaks nothing else -- it is
   what lets ONE screen replace "login or register?" plus "which role are you?".
2. A doctor gets a patient workspace on the SAME account. That is the product
   bug the whole RBAC refactor exists to fix, and it is asserted here on the
   real HTTP payload, not on a unit-tested dict.
3. Refresh rotation actually rotates, logout actually revokes, and a
   token_version bump actually kills live access tokens.
4. THE BACK-COMPAT RULE: an access token minted before this phase carries no
   `tv` and no `typ`. It must still work. If this file's
   test_a_legacy_token_without_tv_or_typ_still_authenticates ever goes red,
   every person currently logged in is about to be signed out.
"""

import datetime

import jwt
import pytest

from tests.authkit import (
    CONSENTS_DOCTOR,
    CONSENTS_PATIENT,
    DEFAULT_PASSWORD,
    bearer,
    data_of,
    error_of,
    install_mailbox,
    login,
    make_doctor,
    make_user,
    seed_consents,
    signup,
)


@pytest.fixture(autouse=True)
def mail(monkeypatch):
    """Autouse: no test in this file may reach a real SMTP server, whether or
    not it cares about the message. Requesting `mail` by name gets the same
    recorder so the OTP can be read out of the body."""
    return install_mailbox(monkeypatch)


@pytest.fixture()
def catalogue(db):
    seed_consents(db)
    return db


# ======================================================================
# /auth/check-email  -- the three doors
# ======================================================================
def test_check_email_says_new_for_an_address_nobody_owns(client, db):
    response = client.post("/auth/check-email", json={"email": "nobody@aiderma.local"})
    assert response.status_code == 200
    assert data_of(response) == {"status": "new", "next": "signup"}


def test_check_email_says_unverified_and_routes_to_the_otp_step(client, catalogue, mail):
    signup(client, mail, "unverified@aiderma.local", verify=False)

    response = client.post("/auth/check-email", json={"email": "unverified@aiderma.local"})
    assert data_of(response) == {"status": "unverified", "next": "otp"}


def test_check_email_says_existing_once_the_account_is_usable(client, db):
    make_user(db, "known@aiderma.local")

    response = client.post("/auth/check-email", json={"email": "known@aiderma.local"})
    assert data_of(response) == {"status": "existing", "next": "password"}


def test_check_email_never_leaks_the_name_or_the_role(client, db):
    make_doctor(db, "dr.secret@aiderma.local", name="Dr Highly Identifiable")

    body = client.post("/auth/check-email", json={"email": "dr.secret@aiderma.local"}).get_json()

    assert set(body["data"].keys()) == {"status", "next"}
    serialised = str(body)
    for leak in ("Doctor", "Highly Identifiable", "LIC-", "approved"):
        assert leak not in serialised


def test_check_email_is_case_insensitive(client, db):
    make_user(db, "MixedCase@Aiderma.local")

    response = client.post("/auth/check-email", json={"email": "mixedcase@aiderma.local"})
    assert data_of(response)["status"] == "existing"


def test_check_email_requires_an_email(client, db):
    response = client.post("/auth/check-email", json={})
    assert response.status_code == 400


# ======================================================================
# register -> otp -> login
# ======================================================================
def test_register_then_verify_then_login(client, catalogue, mail):
    email = "newpatient@aiderma.local"

    registered = client.post("/auth/register", json={
        "name": "New Patient", "email": email, "password": DEFAULT_PASSWORD,
        "role": "AI User", "consents": CONSENTS_PATIENT,
    })
    assert registered.status_code == 201
    assert data_of(registered)["next"] == "otp"

    # The account exists but cannot log in yet.
    blocked = client.post("/auth/login", json={"email": email, "password": DEFAULT_PASSWORD})
    assert blocked.status_code == 403
    assert data_of(blocked)["next"] == "otp"

    verified = client.post("/auth/verify-otp", json={
        "email": email, "otp": mail.last_code(email), "purpose": "signup",
    })
    assert verified.status_code == 200
    block = data_of(verified)
    # Verifying signs you in: the OTP proved the inbox and the password was
    # chosen at register, so a second round trip would be pure ceremony.
    assert block["token"] and block["refresh_token"]
    assert block["session"]["user"]["email"] == email

    session = login(client, email)
    assert session["user"]["role"] == "AI User"
    assert session["session"]["home_route"] == "/my-reports"


def test_a_doctor_registers_with_a_nested_doctor_block(client, catalogue, mail, db):
    from app.models import DoctorProfile

    email = "dr.new@aiderma.local"
    response = client.post("/auth/register", json={
        "name": "Dr New", "email": email, "password": DEFAULT_PASSWORD, "role": "Doctor",
        "doctor": {
            "license": "PMDC-77-A", "specialty": "Dermatology", "hospital": "Mayo",
            "city": "Lahore", "phone": "+92-300-1111111", "experience": 7,
            "latitude": 31.5, "longitude": 74.3,
        },
        "consents": CONSENTS_DOCTOR,
    })
    assert response.status_code == 201

    db.expire_all()
    profile = db.query(DoctorProfile).filter(DoctorProfile.license == "PMDC-77-A").one()
    assert profile.specialty == "Dermatology"
    assert profile.experience == 7
    # USER DECISION: existing doctors were auto-approved by migration; every NEW
    # one starts pending.
    assert profile.verification_status == "pending"


def test_a_doctor_registration_still_requires_a_licence(client, catalogue):
    response = client.post("/auth/register", json={
        "name": "Dr NoLicence", "email": "dr.nolicence@aiderma.local",
        "password": DEFAULT_PASSWORD, "role": "Doctor", "consents": CONSENTS_DOCTOR,
    })
    assert response.status_code == 400
    assert "license" in error_of(response).lower()


def test_a_duplicate_licence_is_refused(client, catalogue, mail, db):
    make_doctor(db, "dr.first@aiderma.local", license_no="PMDC-DUP")

    response = client.post("/auth/register", json={
        "name": "Dr Copy", "email": "dr.copy@aiderma.local", "password": DEFAULT_PASSWORD,
        "role": "Doctor", "doctor": {"license": "PMDC-DUP"}, "consents": CONSENTS_DOCTOR,
    })
    assert response.status_code == 400
    assert "already registered" in error_of(response)


def test_admin_can_never_be_self_registered(client, catalogue, mail, db):
    from app.models import User

    email = "wannabe.admin@aiderma.local"
    response = client.post("/auth/register", json={
        "name": "Wannabe", "email": email, "password": DEFAULT_PASSWORD,
        "role": "Admin", "consents": CONSENTS_PATIENT,
    })
    assert response.status_code == 201

    db.expire_all()
    created = db.query(User).filter(User.email == email).one()
    assert created.role == "AI User"
    assert created.is_root is False


def test_a_duplicate_email_is_refused(client, catalogue, db):
    make_user(db, "taken@aiderma.local")

    response = client.post("/auth/register", json={
        "name": "Second", "email": "taken@aiderma.local", "password": DEFAULT_PASSWORD,
        "consents": CONSENTS_PATIENT,
    })
    assert response.status_code == 400
    assert error_of(response) == "Email already exists"


def test_nothing_is_written_when_the_otp_email_fails(client, catalogue, monkeypatch, db):
    from app.models import User

    install_mailbox(monkeypatch, fail=True)

    response = client.post("/auth/register", json={
        "name": "Ghost", "email": "ghost@aiderma.local", "password": DEFAULT_PASSWORD,
        "consents": CONSENTS_PATIENT,
    })
    assert response.status_code == 500

    db.expire_all()
    assert db.query(User).filter(User.email == "ghost@aiderma.local").first() is None


# ======================================================================
# login
# ======================================================================
def test_login_ignores_the_role_field_completely(client, db):
    """The monolith compared the submitted role to the stored one and 401'd on a
    mismatch, which is why the UI needed a role picker before a password."""
    make_doctor(db, "dr.roleless@aiderma.local")

    for submitted in ("AI User", "Admin", "Doctor", None, "nonsense"):
        response = client.post("/auth/login", json={
            "email": "dr.roleless@aiderma.local",
            "password": DEFAULT_PASSWORD,
            "role": submitted,
        })
        assert response.status_code == 200, submitted
        assert data_of(response)["user"]["role"] == "Doctor"


def test_login_rejects_a_wrong_password_without_saying_which_half_was_wrong(client, db):
    make_user(db, "real@aiderma.local")

    wrong_password = client.post("/auth/login", json={
        "email": "real@aiderma.local", "password": "not-the-password"})
    no_such_user = client.post("/auth/login", json={
        "email": "fake@aiderma.local", "password": DEFAULT_PASSWORD})

    assert wrong_password.status_code == no_such_user.status_code == 401
    assert error_of(wrong_password) == error_of(no_such_user) == "Invalid credentials"


def test_a_deactivated_account_cannot_log_in(client, db):
    make_user(db, "suspended@aiderma.local", is_active=False)

    response = client.post("/auth/login", json={
        "email": "suspended@aiderma.local", "password": DEFAULT_PASSWORD})
    assert response.status_code == 403
    assert "deactivated" in error_of(response)


def test_login_records_last_login_metadata(client, db):
    user = make_user(db, "tracked@aiderma.local")
    assert user.last_login_at is None

    login(client, "tracked@aiderma.local")

    db.expire_all()
    db.refresh(user)
    assert user.last_login_at is not None


# ======================================================================
# /auth/me -- the canonical shape
# ======================================================================
ME_KEYS = {"user", "doctor", "permissions", "workspaces", "home_route", "pending_consents"}
USER_KEYS = {"id", "name", "email", "role", "joined_at", "is_active"}
DOCTOR_KEYS = {"verification_status", "verification_note", "license", "specialty", "profile_image"}


def test_me_returns_exactly_the_frozen_keys(client, catalogue, db):
    make_user(db, "shape@aiderma.local")
    token = login(client, "shape@aiderma.local")["token"]

    response = client.get("/auth/me", headers=bearer(token))
    assert response.status_code == 200
    me = data_of(response)

    assert set(me.keys()) == ME_KEYS
    assert set(me["user"].keys()) == USER_KEYS
    assert me["doctor"] is None
    assert isinstance(me["permissions"], list) and me["permissions"]
    # This account was created straight in the database with no consent rows, so
    # the three mandatory documents are pending -- which is what the UI needs in
    # order to show the consent step instead of assuming agreement.
    assert {p["type"] for p in me["pending_consents"]} == {
        "terms_of_use", "privacy_policy", "medical_data_processing"}


def test_me_needs_a_token(client, db):
    assert client.get("/auth/me").status_code == 401


def test_a_patient_gets_one_workspace(client, catalogue, db):
    make_user(db, "solo@aiderma.local")
    me = data_of(client.get("/auth/me", headers=bearer(login(client, "solo@aiderma.local")["token"])))

    assert [w["key"] for w in me["workspaces"]] == ["patient"]
    assert me["home_route"] == "/my-reports"


def test_a_doctor_gets_the_patient_workspace_too(client, catalogue, db):
    """THE product fix. A dermatologist who wants their own mole scanned used to
    need a SECOND account with a SECOND email, because @patient_required
    rejected role == 'Doctor' outright."""
    make_doctor(db, "dr.both@aiderma.local")
    me = data_of(client.get("/auth/me", headers=bearer(login(client, "dr.both@aiderma.local")["token"])))

    keys = [w["key"] for w in me["workspaces"]]
    assert keys == ["doctor", "patient"]
    assert me["home_route"] == "/doctor-dashboard"
    assert "scan.create" in me["permissions"]        # the patient power
    assert "schedule.manage" in me["permissions"]    # the doctor power
    assert set(me["doctor"].keys()) == DOCTOR_KEYS
    assert me["doctor"]["verification_status"] == "approved"


def test_an_admin_gets_only_the_console_workspace(client, catalogue, db):
    """An admin is offered ONE surface, and it is deliberately not three.

    ADMIN_PERMS is a superset of DOCTOR_PERMS, so by permission alone an admin
    "has" a doctor workspace and a patient workspace -- but there is no
    `doctor_profiles` row behind an admin account, so those two listed no
    referrals, no schedule, no ratings and no scans, permanently. The switcher was
    a door into six empty pages.

    The CAPABILITY is untouched, and that is what the two assertions below pin
    together: `schedule.manage` and `scan.create` are still in `permissions` (so
    every doctor and patient route still authorises an admin, and X-Act-As-User-Id
    delegation still intersects down to a real target's powers) while
    `workspaces` no longer advertises a surface with nothing on it.
    """
    make_user(db, "boss@aiderma.local", role="Admin")
    me = data_of(client.get("/auth/me", headers=bearer(login(client, "boss@aiderma.local")["token"])))

    assert [w["key"] for w in me["workspaces"]] == ["admin"]
    assert me["home_route"] == "/admin-dashboard"
    assert "schedule.manage" in me["permissions"]
    assert "scan.create" in me["permissions"]


def test_a_pending_doctor_still_gets_a_session_and_a_status_to_render(client, catalogue, db):
    """A doctor awaiting approval must be able to log in and SEE the pending
    screen. Locking them out of /auth/me would leave the UI with nothing to
    explain why nothing works."""
    make_doctor(db, "dr.pending@aiderma.local", verification_status="pending")
    me = data_of(client.get("/auth/me", headers=bearer(login(client, "dr.pending@aiderma.local")["token"])))

    assert me["doctor"]["verification_status"] == "pending"
    assert [w["key"] for w in me["workspaces"]] == ["doctor", "patient"]


# ======================================================================
# refresh rotation
# ======================================================================
def test_refresh_returns_a_new_pair_and_burns_the_old_one(client, catalogue, db):
    make_user(db, "rotate@aiderma.local")
    first = login(client, "rotate@aiderma.local")

    second = client.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert second.status_code == 200
    rotated = data_of(second)
    assert rotated["refresh_token"] != first["refresh_token"]
    assert rotated["session"]["user"]["email"] == "rotate@aiderma.local"

    # The consumed token is dead.
    replayed = client.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert replayed.status_code == 401


def test_replaying_a_rotated_token_kills_the_whole_family(client, catalogue, db):
    """Two parties holding one refresh token is theft until proven otherwise, so
    the answer is to end every session rather than let the thief keep
    refreshing."""
    make_user(db, "stolen@aiderma.local")
    first = login(client, "stolen@aiderma.local")
    second = data_of(client.post("/auth/refresh", json={"refresh_token": first["refresh_token"]}))

    replay = client.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert replay.status_code == 401

    # ...and the token the honest client is holding is gone too.
    honest = client.post("/auth/refresh", json={"refresh_token": second["refresh_token"]})
    assert honest.status_code == 401


def test_refresh_needs_a_token(client, db):
    assert client.post("/auth/refresh", json={}).status_code == 400
    assert client.post("/auth/refresh", json={"refresh_token": "garbage"}).status_code == 401


def test_the_refresh_token_is_never_stored_in_the_clear(client, catalogue, db):
    from app.models import RefreshToken

    make_user(db, "hashed@aiderma.local")
    plaintext = login(client, "hashed@aiderma.local")["refresh_token"]

    db.expire_all()
    stored = [row.token_hash for row in db.query(RefreshToken).all()]
    assert stored and plaintext not in stored
    assert all(len(h) == 64 for h in stored)   # sha256 hex


# ======================================================================
# logout / logout-all
# ======================================================================
def test_logout_revokes_only_that_refresh_token(client, catalogue, db):
    make_user(db, "onedevice@aiderma.local")
    phone = login(client, "onedevice@aiderma.local")
    laptop = login(client, "onedevice@aiderma.local")

    assert client.post("/auth/logout", json={"refresh_token": phone["refresh_token"]},
                       headers=bearer(phone["token"])).status_code == 200

    assert client.post("/auth/refresh", json={"refresh_token": phone["refresh_token"]}).status_code == 401
    # The other device is untouched.
    assert client.post("/auth/refresh", json={"refresh_token": laptop["refresh_token"]}).status_code == 200


def test_logout_works_without_a_valid_access_token(client, catalogue, db):
    """The access token expires first by design; a client must still be able to
    hand back the refresh token it is holding."""
    make_user(db, "expired@aiderma.local")
    tokens = login(client, "expired@aiderma.local")

    response = client.post("/auth/logout", json={"refresh_token": tokens["refresh_token"]})
    assert response.status_code == 200
    assert client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]}).status_code == 401


def test_logout_is_200_even_for_a_token_that_never_existed(client, db):
    response = client.post("/auth/logout", json={"refresh_token": "not-a-real-token"})
    assert response.status_code == 200
    assert data_of(response)["revoked"] is False


def test_logout_all_bumps_the_token_version_and_kills_live_access_tokens(client, catalogue, db):
    from app.models import User

    make_user(db, "everywhere@aiderma.local")
    phone = login(client, "everywhere@aiderma.local")
    laptop = login(client, "everywhere@aiderma.local")

    assert client.get("/auth/me", headers=bearer(laptop["token"])).status_code == 200

    response = client.post("/auth/logout-all", headers=bearer(phone["token"]))
    assert response.status_code == 200
    assert data_of(response)["token_version"] == 1
    assert data_of(response)["sessions_revoked"] == 2

    db.expire_all()
    assert db.query(User).filter(User.email == "everywhere@aiderma.local").one().token_version == 1

    # Both ACCESS tokens die, not just the refresh rows -- `tv` is baked in at
    # mint time, so nothing has to be looked up in a blocklist.
    assert client.get("/auth/me", headers=bearer(phone["token"])).status_code == 401
    assert client.get("/auth/me", headers=bearer(laptop["token"])).status_code == 401
    assert client.post("/auth/refresh", json={"refresh_token": laptop["refresh_token"]}).status_code == 401


def test_a_fresh_login_after_logout_all_works_immediately(client, catalogue, db):
    make_user(db, "again@aiderma.local")
    old = login(client, "again@aiderma.local")
    client.post("/auth/logout-all", headers=bearer(old["token"]))

    new = login(client, "again@aiderma.local")
    assert client.get("/auth/me", headers=bearer(new["token"])).status_code == 200


# ======================================================================
# BACK-COMPAT: tokens minted before this phase
# ======================================================================
def _legacy_token(app, user_id, role, hours=24):
    """A token in the EXACT pre-refactor shape: user_id, role, exp. No tv, no
    typ, no jti, no iat."""
    return jwt.encode(
        {
            "user_id": user_id,
            "role": role,
            "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=hours),
        },
        app.config["SECRET_KEY"],
        algorithm=app.config.get("JWT_ALGORITHM", "HS256"),
    )


def test_a_legacy_token_without_tv_or_typ_still_authenticates(app, client, catalogue, db):
    """THE non-negotiable of this phase. A missing `tv` reads as 0 and a missing
    `typ` reads as 'access'; anything stricter signs out every person who is
    logged in right now."""
    user = make_user(db, "stillhere@aiderma.local")

    response = client.get("/auth/me", headers=bearer(_legacy_token(app, user.id, user.role)))
    assert response.status_code == 200
    assert data_of(response)["user"]["email"] == "stillhere@aiderma.local"


def test_a_legacy_token_dies_only_once_its_owner_bumps_the_version(app, client, catalogue, db):
    user = make_user(db, "eventually@aiderma.local")
    legacy = _legacy_token(app, user.id, user.role)
    assert client.get("/auth/me", headers=bearer(legacy)).status_code == 200

    client.post("/auth/logout-all", headers=bearer(login(client, "eventually@aiderma.local")["token"]))

    # tv=0 (implied) < stored 1
    assert client.get("/auth/me", headers=bearer(legacy)).status_code == 401


def test_a_token_of_the_wrong_type_is_not_a_session(app, client, db):
    user = make_user(db, "wrongtype@aiderma.local")
    token = jwt.encode(
        {
            "user_id": user.id, "role": user.role, "tv": 0, "typ": "refresh",
            "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=1),
        },
        app.config["SECRET_KEY"], algorithm="HS256",
    )
    assert client.get("/auth/me", headers=bearer(token)).status_code == 401


# ======================================================================
# The legacy six are still the legacy six
# ======================================================================
def test_legacy_login_response_shape_is_unchanged(client, db):
    make_doctor(db, "dr.legacy@aiderma.local")

    response = client.post("/login", json={
        "email": "dr.legacy@aiderma.local", "password": DEFAULT_PASSWORD, "role": "Doctor"})
    assert response.status_code == 200

    block = data_of(response)
    assert set(block.keys()) == {"token", "user"}
    assert set(block["user"].keys()) == {"id", "name", "email", "role", "joined_at", "verification_status"}
    # No refresh token here: that is the /auth/login surface, and adding it to
    # the legacy route would change a frozen shape.
    assert "refresh_token" not in block


def test_legacy_login_still_omits_verification_status_for_patients(client, db):
    make_user(db, "patient.legacy@aiderma.local")

    block = data_of(client.post("/login", json={
        "email": "patient.legacy@aiderma.local", "password": DEFAULT_PASSWORD}))
    assert "verification_status" not in block["user"]


def test_a_token_from_legacy_login_works_on_the_new_surface(client, catalogue, db):
    """Both login endpoints mint the same kind of access token, so a client can
    migrate one call at a time instead of all at once."""
    make_user(db, "mixed@aiderma.local")

    token = data_of(client.post("/login", json={
        "email": "mixed@aiderma.local", "password": DEFAULT_PASSWORD}))["token"]

    assert client.get("/auth/me", headers=bearer(token)).status_code == 200


def test_legacy_register_and_verify_still_work_together(client, catalogue, mail, db):
    from app.models import User

    assert client.post("/register", json={
        "name": "Legacy Path", "email": "legacy.path@aiderma.local",
        "password": DEFAULT_PASSWORD, "role": "AI User",
    }).status_code == 201

    verified = client.post("/verify-otp-email", json={
        "email": "legacy.path@aiderma.local", "otp": mail.last_code("legacy.path@aiderma.local")})
    assert verified.status_code == 200
    assert verified.get_json()["message"] == "Email verified successfully"

    db.expire_all()
    assert db.query(User).filter(User.email == "legacy.path@aiderma.local").one().is_verified is True
