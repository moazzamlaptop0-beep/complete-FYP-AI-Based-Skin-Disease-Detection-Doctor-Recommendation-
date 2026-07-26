"""
Versioned consent.

WHY A TABLE AND NOT A `terms_accepted` BOOLEAN
----------------------------------------------
"Did this user agree to share their skin photographs with a reviewing doctor?"
is a question a medical product has to be able to answer months later, about the
WORDING THAT WAS ON SCREEN AT THE TIME. A boolean answers none of that and goes
silently wrong the moment the text changes. So: versioned documents plus an
append-only grant log, and the re-prompt falls out of comparing the two.

The mandatory/optional split is asserted here as a behaviour, not as a config
value, because it is the part that has legal consequences: mandatory documents
block registration, optional ones must be genuinely refusable, and a refused
optional document must NOT be re-asked forever.
"""

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
    make_user,
    seed_consents,
    signup,
)

MANDATORY = {"terms_of_use", "privacy_policy", "medical_data_processing"}
OPTIONAL = {"doctor_data_sharing", "marketing_email"}
DOCTOR_ONLY = "license_attestation"


@pytest.fixture(autouse=True)
def mail(monkeypatch):
    """Autouse: no test in this file may reach a real SMTP server."""
    return install_mailbox(monkeypatch)


@pytest.fixture()
def catalogue(db):
    seed_consents(db)
    return db


# ======================================================================
# THE SEED
# ======================================================================
def test_the_seed_writes_one_current_row_per_document(db):
    from app.models import ConsentDocument

    result = seed_consents(db)

    assert result["created"] == 6
    rows = db.query(ConsentDocument).all()
    assert {r.consent_type for r in rows} == MANDATORY | OPTIONAL | {DOCTOR_ONLY}
    assert all(r.is_current for r in rows)
    assert all(r.version == "1" for r in rows)


def test_the_seed_is_idempotent(db):
    from app.models import ConsentDocument

    seed_consents(db)
    second = seed_consents(db)

    assert second["created"] == 0
    assert second["updated"] == 6
    assert db.query(ConsentDocument).count() == 6


# ======================================================================
# GET /auth/consent-documents
# ======================================================================
def test_the_signup_form_gets_every_general_document(client, catalogue):
    response = client.get("/auth/consent-documents")
    assert response.status_code == 200

    documents = data_of(response)["documents"]
    types = {d["type"] for d in documents}
    assert MANDATORY | OPTIONAL == types
    assert DOCTOR_ONLY not in types          # patients are not asked to attest a licence

    for document in documents:
        assert set(document.keys()) == {"type", "version", "title", "url_path", "mandatory"}
        assert document["mandatory"] is (document["type"] in MANDATORY)


def test_a_doctor_is_additionally_asked_to_attest_their_licence(client, catalogue):
    documents = data_of(client.get("/auth/consent-documents?role=Doctor"))["documents"]
    by_type = {d["type"]: d for d in documents}

    assert DOCTOR_ONLY in by_type
    assert by_type[DOCTOR_ONLY]["mandatory"] is True


def test_the_password_rules_ship_with_the_form(client, catalogue):
    policy = data_of(client.get("/auth/consent-documents"))["password_policy"]
    assert policy["min_length"] == 8
    assert len(policy["rules"]) == 3


def test_the_documents_endpoint_works_before_the_seed_has_run(client, db):
    """A fresh database must still produce a usable signup form. Falling back to
    an EMPTY list would silently let everyone through the mandatory gate."""
    documents = data_of(client.get("/auth/consent-documents"))["documents"]
    assert {d["type"] for d in documents} == MANDATORY | OPTIONAL


# ======================================================================
# REGISTRATION GATE
# ======================================================================
def test_registration_is_refused_without_the_mandatory_consents(client, catalogue):
    response = client.post("/auth/register", json={
        "name": "No Consent", "email": "noconsent@aiderma.local",
        "password": DEFAULT_PASSWORD, "consents": [],
    })
    assert response.status_code == 400
    assert set(data_of(response)["missing_consents"]) == MANDATORY


def test_an_explicit_refusal_is_not_a_shortcut_past_the_gate(client, catalogue):
    """{granted:false} is an answer, not an acceptance."""
    refused = [dict(item, granted=False) for item in CONSENTS_PATIENT]
    response = client.post("/auth/register", json={
        "name": "Refuser", "email": "refuser@aiderma.local",
        "password": DEFAULT_PASSWORD, "consents": refused,
    })
    assert response.status_code == 400
    assert set(data_of(response)["missing_consents"]) == MANDATORY


def test_a_doctor_must_also_attest_the_licence(client, catalogue):
    response = client.post("/auth/register", json={
        "name": "Dr NoAttest", "email": "dr.noattest@aiderma.local",
        "password": DEFAULT_PASSWORD, "role": "Doctor",
        "doctor": {"license": "PMDC-NOATTEST"},
        "consents": CONSENTS_PATIENT,
    })
    assert response.status_code == 400
    assert data_of(response)["missing_consents"] == [DOCTOR_ONLY]


def test_a_patient_is_never_asked_for_the_licence_attestation(client, catalogue, mail):
    session = signup(client, mail, "nolicence.needed@aiderma.local")
    assert session["session"]["pending_consents"] == []


def test_the_grants_are_written_with_evidence(client, catalogue, mail, db):
    from app.models import User, UserConsent

    email = "evidence@aiderma.local"
    signup(client, mail, email, verify=False)

    db.expire_all()
    user = db.query(User).filter(User.email == email).one()
    rows = db.query(UserConsent).filter(UserConsent.user_id == user.id).all()

    assert {r.consent_type for r in rows} == MANDATORY
    for row in rows:
        assert row.granted is True
        assert row.version == "1"
        assert row.source == "signup"
        assert row.granted_at is not None
        assert row.revoked_at is None


def test_an_unknown_consent_type_is_ignored_not_rejected(client, catalogue, mail, db):
    """A client on a newer build must not be unable to register just because it
    knows about a document this server has not deployed yet."""
    response = client.post("/auth/register", json={
        "name": "Future Client", "email": "future@aiderma.local",
        "password": DEFAULT_PASSWORD,
        "consents": CONSENTS_PATIENT + [{"type": "cookie_policy_v9", "granted": True}],
    })
    assert response.status_code == 201


# ======================================================================
# OPTIONAL DOCUMENTS
# ======================================================================
def test_marketing_opt_in_is_mirrored_onto_the_user_row(client, catalogue, mail, db):
    from app.models import User

    email = "marketing.yes@aiderma.local"
    signup(client, mail, email, consents=CONSENTS_PATIENT + [
        {"type": "marketing_email", "version": "1", "granted": True}])

    db.expire_all()
    assert db.query(User).filter(User.email == email).one().marketing_opt_in is True


def test_refusing_marketing_leaves_the_mirror_false(client, catalogue, mail, db):
    from app.models import User

    email = "marketing.no@aiderma.local"
    signup(client, mail, email, consents=CONSENTS_PATIENT + [
        {"type": "marketing_email", "version": "1", "granted": False}])

    db.expire_all()
    assert db.query(User).filter(User.email == email).one().marketing_opt_in is False


def test_a_refused_optional_document_is_never_listed_as_pending(client, catalogue, mail, db):
    """Re-asking forever is a dark pattern: the user already answered."""
    email = "answered@aiderma.local"
    session = signup(client, mail, email, consents=CONSENTS_PATIENT + [
        {"type": "doctor_data_sharing", "version": "1", "granted": False}])

    assert session["session"]["pending_consents"] == []

    me = data_of(client.get("/auth/me", headers=bearer(session["token"])))
    assert me["pending_consents"] == []


# ======================================================================
# POST /auth/consents  +  THE RE-PROMPT
# ======================================================================
def test_a_new_version_of_a_mandatory_document_becomes_pending(client, catalogue, mail, db):
    from app.models import ConsentDocument

    email = "reconsent@aiderma.local"
    session = signup(client, mail, email)
    token = session["token"]
    assert data_of(client.get("/auth/me", headers=bearer(token)))["pending_consents"] == []

    # Publish v2 of the terms.
    db.query(ConsentDocument).filter(
        ConsentDocument.consent_type == "terms_of_use"
    ).update({"is_current": False}, synchronize_session=False)
    db.add(ConsentDocument(
        consent_type="terms_of_use", version="2",
        title="Terms of Use", body_url="/terms-of-use", is_current=True,
    ))
    db.commit()

    pending = data_of(client.get("/auth/me", headers=bearer(token)))["pending_consents"]
    assert [p["type"] for p in pending] == ["terms_of_use"]
    assert pending[0]["version"] == "2"
    assert set(pending[0].keys()) == {"type", "version", "title", "url_path"}

    accepted = client.post("/auth/consents", headers=bearer(token), json={
        "consents": [{"type": "terms_of_use", "version": "2", "granted": True}],
        "source": "stepper",
    })
    assert accepted.status_code == 200
    assert data_of(accepted)["recorded"] == 1
    assert data_of(accepted)["pending_consents"] == []

    assert data_of(client.get("/auth/me", headers=bearer(token)))["pending_consents"] == []


def test_re_granting_supersedes_instead_of_editing(client, catalogue, mail, db):
    """The old row is stamped revoked, never mutated -- the whole point is being
    able to reconstruct what was agreed on a given date."""
    from app.models import User, UserConsent

    email = "history@aiderma.local"
    session = signup(client, mail, email)

    client.post("/auth/consents", headers=bearer(session["token"]), json={
        "consents": [{"type": "terms_of_use", "version": "2", "granted": True}]})

    db.expire_all()
    user = db.query(User).filter(User.email == email).one()
    rows = (
        db.query(UserConsent)
        .filter(UserConsent.user_id == user.id, UserConsent.consent_type == "terms_of_use")
        .order_by(UserConsent.id.asc())
        .all()
    )
    assert len(rows) == 2
    assert rows[0].version == "1" and rows[0].revoked_at is not None
    assert rows[1].version == "2" and rows[1].revoked_at is None


def test_recording_consents_needs_a_token(client, catalogue):
    response = client.post("/auth/consents", json={
        "consents": [{"type": "terms_of_use", "granted": True}]})
    assert response.status_code == 401


def test_an_empty_consent_body_is_a_400(client, catalogue, db):
    make_user(db, "emptybody@aiderma.local")
    token = login(client, "emptybody@aiderma.local")["token"]

    assert client.post("/auth/consents", headers=bearer(token), json={}).status_code == 400
    assert client.post("/auth/consents", headers=bearer(token),
                       json={"consents": []}).status_code == 400


def test_a_user_created_before_consent_existed_is_prompted_at_login(client, catalogue, db):
    """Every account that predates the consent catalogue has zero grants, so the
    UI must show the consent step rather than pretending they agreed."""
    make_user(db, "legacy.user@aiderma.local")

    session = login(client, "legacy.user@aiderma.local")
    pending = {p["type"] for p in session["session"]["pending_consents"]}
    assert pending == MANDATORY


def test_a_doctors_pending_list_includes_the_attestation(client, catalogue, db):
    from tests.authkit import make_doctor

    make_doctor(db, "dr.consentless@aiderma.local")
    session = login(client, "dr.consentless@aiderma.local")

    pending = {p["type"] for p in session["session"]["pending_consents"]}
    assert pending == MANDATORY | {DOCTOR_ONLY}


def test_a_doctor_who_attested_at_signup_has_nothing_pending(client, catalogue, mail):
    session = signup(client, mail, "dr.clean@aiderma.local", role="Doctor",
                     consents=CONSENTS_DOCTOR)
    assert session["session"]["pending_consents"] == []
    assert error_of(client.get("/auth/consent-documents")) is None
