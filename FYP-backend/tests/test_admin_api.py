"""
Tests for the NEW admin console (phase 2A).

WHAT THESE PIN
--------------
1. The envelope. Every list returns
   `{"success": true, "data": {items, page, per_page, total, has_more}}`.
   This is a brand-new surface, so unlike /admin/doctors (bare array, frozen)
   it is allowed to be consistent -- and must stay that way.
2. Pagination is REAL. `total` counts the whole filtered set, not the page, and
   `has_more` is computed from total rather than from len(items).
3. Filters actually filter, including the date range and the free-text search.
4. is_root is untouchable. A root account cannot be suspended, and the refusal
   leaves the row exactly as it was -- checked against the database, not just
   against the status code.
5. NO SECRETS. password / otp_code / otp_created_at / otp_attempts /
   pending_email / token_version never appear in a response body.
6. Every one of the endpoints is above the hierarchy line: a DOCTOR token
   (which holds every PATIENT permission and six clinical ones) gets 403 on all
   of them, and so does a patient. That sweep now covers the account-CRUD
   mutations too -- see ADMIN_WRITE_ENDPOINTS for why they are a second list.

Every test here needs a database, so the whole module skips unless
TEST_DATABASE_URL is set -- see tests/conftest.py.
"""

import datetime
import json

import pytest

# The complete new surface. Kept as data so the "doctors get 403" test cannot
# silently miss an endpoint someone adds later.
ADMIN_ENDPOINTS = [
    ("GET", "/admin/patients"),
    ("GET", "/admin/users"),
    ("GET", "/admin/scans"),
    ("GET", "/admin/appointments"),
    ("GET", "/admin/audit-log"),
    ("PATCH", "/admin/users/1/status"),
]

# The account-CRUD surface. SEPARATE from the list above for one reason: those six
# all answer 200 to a bare authenticated call, so a single list can be swept for
# "an admin reaches all of it". These four are mutations -- POST /admin/users with
# no body is a 400 by design, and a reset-password sweep would change a real
# password -- so they join only the AUTHORISATION parametrisations below.
#
# Kept as data for exactly the same reason: the whole point of the 401/403 matrix
# is that adding a privileged endpoint cannot silently escape it.
ADMIN_WRITE_ENDPOINTS = [
    ("POST", "/admin/users"),
    ("PATCH", "/admin/users/1"),
    ("POST", "/admin/users/1/reset-password"),
    ("DELETE", "/admin/users/1"),
]

EVERY_ADMIN_ENDPOINT = ADMIN_ENDPOINTS + ADMIN_WRITE_ENDPOINTS

SECRET_KEYS = (
    "password",
    "otp_code",
    "otp_created_at",
    "otp_attempts",
    "pending_email",
    "token_version",
)

BASE_TIME = datetime.datetime(2026, 1, 1, 9, 0, 0)


def _call(client, method, path, headers=None, json_body=None):
    fn = getattr(client, method.lower())
    if method == "PATCH":
        return fn(path, headers=headers, json=json_body or {"is_active": False})
    if method == "POST":
        # A body is sent so the refusal under test is the AUTHORISATION one. With
        # no JSON at all, /admin/users would 400 on "Name is required" before the
        # decorator's 401/403 could be distinguished from a validation failure.
        return fn(path, headers=headers, json=json_body or {"name": "x", "email": "x@y.co"})
    return fn(path, headers=headers)


def _data(response):
    return response.get_json()["data"]


@pytest.fixture(autouse=True)
def _isolate_request_identity(app):
    """Scrub `g.actor` / `g.principal` after every test in this module.

    Flask's RequestContext.push() only creates a NEW app context when there
    isn't already one for the same app. The `app` fixture is session-scoped and
    pushes one, so every test-client request in the suite RE-USES it -- which
    means `flask.g` is shared for the whole session, and the actor that
    `require_permission` writes there survives into unrelated tests. This module
    is the first to drive real authenticated requests, so it is the first to
    leak; without this teardown it breaks
    tests/test_rbac.py::test_resolve_actor_without_an_actor_is_false, which
    correctly assumes no ambient actor.

    The right home for this is conftest.py, but that file is shared with other
    agents this phase -- see `issues`.
    """
    yield
    from flask import g

    for attr in ("actor", "principal"):
        if hasattr(g, attr):
            delattr(g, attr)


# ======================================================================
# FIXTURE -- one small but complete platform.
# ======================================================================
@pytest.fixture()
def platform(db):
    """root admin, admin, 2 doctors (1 approved / 1 pending), 25 patients,
    scans, appointments and a couple of audit rows.

    25 patients is deliberate: it is more than the default per_page of 20, so
    an off-by-one in the OFFSET arithmetic shows up as a wrong `total` or a
    duplicated row rather than passing by accident.
    """
    from app.models import AIScan, Appointment, AuditLog, DoctorProfile, User

    def user(name, email, role, **kw):
        fields = {"is_verified": True, "is_active": True, "is_root": False,
                  "token_version": 0}
        fields.update(kw)
        row = User(name=name, email=email, password="hashed-secret", role=role, **fields)
        db.add(row)
        return row

    root = user("Root Admin", "root@admin.local", "Admin", is_root=True)
    root.created_at = BASE_TIME
    admin = user("Ops Admin", "ops@admin.local", "Admin")
    admin.created_at = BASE_TIME
    doc_ok = user("Dr Approved", "approved@doc.local", "Doctor")
    doc_ok.created_at = BASE_TIME
    doc_pending = user("Dr Pending", "pending@doc.local", "Doctor")
    doc_pending.created_at = BASE_TIME

    patients = []
    for i in range(25):
        p = user(f"Patient {i:02d}", f"patient{i:02d}@mail.local", "AI User",
                 is_active=(i != 7))
        # Explicit, strictly increasing timestamps: LIMIT/OFFSET over rows that
        # share a sort key is exactly how pages start duplicating rows.
        p.created_at = BASE_TIME + datetime.timedelta(minutes=i)
        patients.append(p)

    # One patient with an obviously searchable name.
    patients[3].name = "Zainab Searchable"
    patients[3].email = "zainab.searchable@mail.local"

    db.commit()
    for row in [root, admin, doc_ok, doc_pending] + patients:
        db.refresh(row)

    db.add(DoctorProfile(user_id=doc_ok.id, license="PMDC-APPROVED-1",
                         specialty="Dermatology", city="Lahore",
                         verification_status="approved"))
    db.add(DoctorProfile(user_id=doc_pending.id, license="PMDC-PENDING-1",
                         specialty="Dermatology", city="Karachi",
                         verification_status="pending"))

    # --- scans: 3 for patients[0], 1 for patients[1] -------------------
    scans = []
    for i, (owner, severity, status) in enumerate([
        (patients[0], "CRITICAL", "Reviewed"),
        (patients[0], "URGENT", "Pending"),
        (patients[0], "ROUTINE", "Pending"),
        (patients[1], "ROUTINE", "Local"),
    ]):
        s = AIScan(
            image_url=f"static/uploads/scan{i}.jpg",
            prediction_result="Melanoma" if severity == "CRITICAL" else "Eczema",
            confidence=91.5,
            status=status,
            review_status=status,
            severity_level=severity,
            triage_score=10 * i,
            user_id=owner.id,
            doctor_id=doc_ok.id if status == "Reviewed" else None,
            created_at=BASE_TIME + datetime.timedelta(days=i),
        )
        db.add(s)
        scans.append(s)

    # --- appointments: 2 for patients[0], 1 for patients[1] ------------
    appts = []
    for i, (pat, status) in enumerate([
        (patients[0], "Scheduled"),
        (patients[0], "Completed"),
        (patients[1], "Cancelled"),
    ]):
        a = Appointment(
            patient_id=pat.id,
            doctor_id=doc_ok.id if i < 2 else doc_pending.id,
            appointment_date="2026-02-0%d" % (i + 1),
            appointment_time="09:00 AM",
            status=status,
            created_at=BASE_TIME + datetime.timedelta(days=i),
            slot_start=BASE_TIME + datetime.timedelta(days=30 + i),
        )
        db.add(a)
        appts.append(a)

    # --- audit rows the act-as path would have written -----------------
    db.add(AuditLog(actor_user_id=admin.id, subject_user_id=patients[0].id,
                    action="act_as", target_type="user", target_id=patients[0].id,
                    detail="GET /patient/scans/1",
                    created_at=BASE_TIME + datetime.timedelta(hours=1)))
    db.add(AuditLog(actor_user_id=admin.id, subject_user_id=doc_ok.id,
                    action="doctor.verify", target_type="user", target_id=doc_ok.id,
                    created_at=BASE_TIME + datetime.timedelta(hours=2)))
    db.commit()
    for row in scans + appts:
        db.refresh(row)

    return {
        "root": root.id,
        "admin": admin.id,
        "doctor": doc_ok.id,
        "doctor_pending": doc_pending.id,
        "patients": [p.id for p in patients],
        "scans": [s.id for s in scans],
        "appointments": [a.id for a in appts],
    }


@pytest.fixture()
def admin_headers(auth_headers, platform):
    return auth_headers(platform["admin"], "Admin")


# ======================================================================
# ENVELOPE
# ======================================================================
@pytest.mark.parametrize("path", [
    "/admin/patients", "/admin/users", "/admin/scans",
    "/admin/appointments", "/admin/audit-log",
])
def test_every_list_returns_the_standard_page_envelope(client, admin_headers, path):
    res = client.get(path, headers=admin_headers)
    assert res.status_code == 200
    body = res.get_json()
    assert body["success"] is True
    data = body["data"]
    assert set(data) == {"items", "page", "per_page", "total", "has_more"}
    assert isinstance(data["items"], list)
    assert isinstance(data["total"], int)
    assert isinstance(data["has_more"], bool)


@pytest.mark.parametrize("path,keys", [
    ("/admin/patients", {
        "id", "name", "email", "is_active", "created_at",
        "scan_count", "appointment_count",
    }),
    ("/admin/users", {
        "id", "name", "email", "role", "is_root", "is_active", "is_verified",
        "created_at", "last_login_at", "verification_status",
    }),
    ("/admin/scans", {
        "id", "user_id", "patient_name", "patient_email", "doctor_id", "doctor_name",
        "prediction", "confidence", "severity_level", "triage_score", "status",
        "review_status", "doctor_comment", "invite_to_clinic", "is_sensitive",
        "image_deleted_at", "image_url", "image_endpoint", "created_at", "updated_at",
    }),
    ("/admin/appointments", {
        "id", "patient_id", "patient_name", "patient_email", "doctor_id", "doctor_name",
        "doctor_email", "scan_id", "appointment_date", "appointment_time", "slot_start",
        "duration", "status", "cancellation_reason", "hidden_from_doctor",
        "conflict_with_id", "auto_resolved", "resolved_at", "created_at",
    }),
    ("/admin/audit-log", {
        "id", "actor_user_id", "actor_name", "actor_email", "subject_user_id",
        "subject_name", "subject_email", "action", "target_type", "target_id",
        "detail", "ip", "user_agent", "created_at",
    }),
])
def test_item_shapes_match_the_documented_contract(client, admin_headers, path, keys):
    """docs/api-contract.md 7b lists these key sets and their counts. A silent
    key rename would break the admin UI without breaking any other test."""
    items = _data(client.get(path, headers=admin_headers))["items"]
    assert items, f"{path} returned nothing to check"
    assert set(items[0]) == keys


# ======================================================================
# PAGINATION -- real LIMIT/OFFSET with a real count.
# ======================================================================
def test_patients_pagination_pages_do_not_overlap(client, admin_headers):
    first = _data(client.get("/admin/patients?per_page=10&page=1", headers=admin_headers))
    second = _data(client.get("/admin/patients?per_page=10&page=2", headers=admin_headers))
    third = _data(client.get("/admin/patients?per_page=10&page=3", headers=admin_headers))

    assert first["total"] == 25 and second["total"] == 25 and third["total"] == 25
    assert len(first["items"]) == 10
    assert len(second["items"]) == 10
    assert len(third["items"]) == 5

    assert first["has_more"] is True
    assert second["has_more"] is True
    assert third["has_more"] is False

    seen = [i["id"] for i in first["items"] + second["items"] + third["items"]]
    assert len(seen) == len(set(seen)) == 25


def test_total_counts_the_whole_filtered_set_not_the_page(client, admin_headers):
    data = _data(client.get("/admin/patients?per_page=1", headers=admin_headers))
    assert len(data["items"]) == 1
    assert data["total"] == 25          # <- the tell-tale of Python slicing
    assert data["has_more"] is True


def test_per_page_is_clamped_and_garbage_falls_back(client, admin_headers):
    huge = _data(client.get("/admin/patients?per_page=100000", headers=admin_headers))
    assert huge["per_page"] == 100      # MAX_PER_PAGE

    junk = _data(client.get("/admin/patients?page=abc&per_page=-4", headers=admin_headers))
    assert junk["page"] == 1
    assert junk["per_page"] >= 1


def test_page_past_the_end_is_empty_not_an_error(client, admin_headers):
    data = _data(client.get("/admin/patients?page=99&per_page=10", headers=admin_headers))
    assert data["items"] == []
    assert data["total"] == 25
    assert data["has_more"] is False


# ======================================================================
# /admin/patients
# ======================================================================
def test_patients_item_shape_and_counts(client, admin_headers, platform):
    data = _data(client.get("/admin/patients?q=Patient 00", headers=admin_headers))
    assert data["total"] == 1
    item = data["items"][0]
    assert set(item) == {
        "id", "name", "email", "is_active", "created_at",
        "scan_count", "appointment_count",
    }
    assert item["id"] == platform["patients"][0]
    assert item["scan_count"] == 3
    assert item["appointment_count"] == 2


def test_patients_never_leak_credentials_or_otp_columns(client, admin_headers):
    raw = client.get("/admin/patients?per_page=100", headers=admin_headers).get_data(as_text=True)
    for key in SECRET_KEYS:
        assert key not in raw
    assert "hashed-secret" not in raw


def test_patients_free_text_search_matches_name_and_email(client, admin_headers, platform):
    by_name = _data(client.get("/admin/patients?q=Zainab", headers=admin_headers))
    assert by_name["total"] == 1
    assert by_name["items"][0]["id"] == platform["patients"][3]

    by_email = _data(client.get("/admin/patients?q=zainab.searchable", headers=admin_headers))
    assert by_email["total"] == 1


def test_patients_is_active_filter(client, admin_headers, platform):
    inactive = _data(client.get("/admin/patients?is_active=false", headers=admin_headers))
    assert inactive["total"] == 1
    assert inactive["items"][0]["id"] == platform["patients"][7]

    active = _data(client.get("/admin/patients?is_active=true&per_page=100", headers=admin_headers))
    assert active["total"] == 24


def test_patients_excludes_doctors_and_admins(client, admin_headers, platform):
    data = _data(client.get("/admin/patients?per_page=100", headers=admin_headers))
    ids = {i["id"] for i in data["items"]}
    assert platform["doctor"] not in ids
    assert platform["admin"] not in ids
    assert platform["root"] not in ids


# ======================================================================
# /admin/users
# ======================================================================
def test_users_lists_every_role_and_flags_root(client, admin_headers, platform):
    data = _data(client.get("/admin/users?per_page=100", headers=admin_headers))
    assert data["total"] == 29          # 2 admins + 2 doctors + 25 patients
    by_id = {i["id"]: i for i in data["items"]}

    assert by_id[platform["root"]]["is_root"] is True
    assert by_id[platform["admin"]]["is_root"] is False
    assert by_id[platform["root"]]["role"] == "Admin"
    assert by_id[platform["patients"][0]]["role"] == "AI User"


def test_users_role_filter_accepts_the_db_literal_and_aliases(client, admin_headers):
    exact = _data(client.get("/admin/users?role=Doctor&per_page=100", headers=admin_headers))
    assert exact["total"] == 2
    assert {i["role"] for i in exact["items"]} == {"Doctor"}

    alias = _data(client.get("/admin/users?role=patient&per_page=100", headers=admin_headers))
    assert alias["total"] == 25
    assert {i["role"] for i in alias["items"]} == {"AI User"}


def test_users_unknown_role_is_a_400_not_an_empty_page(client, admin_headers):
    res = client.get("/admin/users?role=Superuser", headers=admin_headers)
    assert res.status_code == 400
    assert res.get_json()["success"] is False


def test_users_is_root_filter_isolates_protected_accounts(client, admin_headers, platform):
    data = _data(client.get("/admin/users?is_root=true", headers=admin_headers))
    assert data["total"] == 1
    assert data["items"][0]["id"] == platform["root"]


def test_users_surface_doctor_verification_status(client, admin_headers, platform):
    data = _data(client.get("/admin/users?role=Doctor", headers=admin_headers))
    by_id = {i["id"]: i for i in data["items"]}
    assert by_id[platform["doctor"]]["verification_status"] == "approved"
    assert by_id[platform["doctor_pending"]]["verification_status"] == "pending"


def test_users_never_leak_credentials_or_otp_columns(client, admin_headers):
    raw = client.get("/admin/users?per_page=100", headers=admin_headers).get_data(as_text=True)
    for key in SECRET_KEYS:
        assert key not in raw
    assert "hashed-secret" not in raw


# ======================================================================
# /admin/scans
# ======================================================================
def test_scans_carry_image_endpoint_alongside_image_url(client, admin_headers, platform):
    data = _data(client.get("/admin/scans?per_page=100", headers=admin_headers))
    assert data["total"] == 4
    item = next(i for i in data["items"] if i["id"] == platform["scans"][0])

    # The legacy '/'-prefixed static path is UNCHANGED ...
    assert item["image_url"] == "/static/uploads/scan0.jpg"
    # ... and the authenticated route is ADDED next to it.
    assert item["image_endpoint"] == f"/api/scans/{platform['scans'][0]}/image"


def test_scans_severity_and_status_filters(client, admin_headers):
    critical = _data(client.get("/admin/scans?severity=CRITICAL", headers=admin_headers))
    assert critical["total"] == 1
    assert critical["items"][0]["severity_level"] == "CRITICAL"

    pending = _data(client.get("/admin/scans?status=Pending", headers=admin_headers))
    assert pending["total"] == 2
    assert {i["status"] for i in pending["items"]} == {"Pending"}


def test_scans_patient_filter_accepts_an_id_or_a_name(client, admin_headers, platform):
    by_id = _data(client.get(f"/admin/scans?patient={platform['patients'][0]}", headers=admin_headers))
    assert by_id["total"] == 3

    by_name = _data(client.get("/admin/scans?patient=Patient 01", headers=admin_headers))
    assert by_name["total"] == 1
    assert by_name["items"][0]["user_id"] == platform["patients"][1]


def test_scans_date_range_is_inclusive_of_the_whole_end_day(client, admin_headers):
    # Scans sit on 2026-01-01, -02, -03 and -04 at 09:00.
    window = _data(client.get(
        "/admin/scans?date_from=2026-01-02&date_to=2026-01-03", headers=admin_headers))
    assert window["total"] == 2

    single = _data(client.get(
        "/admin/scans?date_from=2026-01-01&date_to=2026-01-01", headers=admin_headers))
    assert single["total"] == 1


def test_scans_reject_an_unknown_severity_and_a_broken_date(client, admin_headers):
    bad_severity = client.get("/admin/scans?severity=SUPER-URGENT", headers=admin_headers)
    assert bad_severity.status_code == 400
    assert bad_severity.get_json()["success"] is False

    bad_date = client.get("/admin/scans?date_from=last-tuesday", headers=admin_headers)
    assert bad_date.status_code == 400

    backwards = client.get(
        "/admin/scans?date_from=2026-03-01&date_to=2026-01-01", headers=admin_headers)
    assert backwards.status_code == 400


# ======================================================================
# /admin/appointments
# ======================================================================
def test_appointments_status_and_doctor_filters(client, admin_headers, platform):
    completed = _data(client.get("/admin/appointments?status=Completed", headers=admin_headers))
    assert completed["total"] == 1
    assert completed["items"][0]["status"] == "Completed"

    by_doctor = _data(client.get(
        f"/admin/appointments?doctor={platform['doctor']}", headers=admin_headers))
    assert by_doctor["total"] == 2
    assert {i["doctor_id"] for i in by_doctor["items"]} == {platform["doctor"]}


def test_appointments_date_field_switches_between_created_and_slot(client, admin_headers):
    # created_at is 2026-01-01..03; slot_start is 2026-01-31..02-02.
    by_created = _data(client.get(
        "/admin/appointments?date_from=2026-01-01&date_to=2026-01-03", headers=admin_headers))
    assert by_created["total"] == 3

    by_slot = _data(client.get(
        "/admin/appointments?date_field=slot&date_from=2026-01-01&date_to=2026-01-03",
        headers=admin_headers))
    assert by_slot["total"] == 0

    by_slot_real = _data(client.get(
        "/admin/appointments?date_field=slot&date_from=2026-01-31&date_to=2026-02-02",
        headers=admin_headers))
    assert by_slot_real["total"] == 3


def test_appointments_reject_an_unknown_status_or_date_field(client, admin_headers):
    assert client.get("/admin/appointments?status=Maybe", headers=admin_headers).status_code == 400
    assert client.get("/admin/appointments?date_field=birthday", headers=admin_headers).status_code == 400


# ======================================================================
# /admin/audit-log
# ======================================================================
def test_audit_log_reads_the_rows_act_as_writes(client, admin_headers, platform):
    data = _data(client.get("/admin/audit-log?action=act_as", headers=admin_headers))
    assert data["total"] == 1
    row = data["items"][0]
    assert row["actor_user_id"] == platform["admin"]
    assert row["subject_user_id"] == platform["patients"][0]
    assert row["actor_name"] == "Ops Admin"       # names resolved, not just ids
    assert row["subject_name"] == "Patient 00"


def test_audit_log_actor_and_prefix_filters(client, admin_headers, platform):
    by_actor = _data(client.get(
        f"/admin/audit-log?actor={platform['admin']}", headers=admin_headers))
    assert by_actor["total"] == 2

    by_prefix = _data(client.get("/admin/audit-log?action_prefix=doctor.", headers=admin_headers))
    assert by_prefix["total"] == 1
    assert by_prefix["items"][0]["action"] == "doctor.verify"

    by_name = _data(client.get("/admin/audit-log?actor=Ops Admin", headers=admin_headers))
    assert by_name["total"] == 2


def test_audit_log_is_newest_first(client, admin_headers):
    data = _data(client.get("/admin/audit-log", headers=admin_headers))
    actions = [i["action"] for i in data["items"]]
    assert actions == ["doctor.verify", "act_as"]


# ======================================================================
# PATCH /admin/users/<id>/status
# ======================================================================
def test_suspend_sets_is_active_false_and_writes_an_audit_row(client, db, admin_headers, platform):
    from app.models import AuditLog, User

    target = platform["patients"][1]
    res = client.patch(f"/admin/users/{target}/status", headers=admin_headers,
                       json={"is_active": False, "reason": "spam uploads"})
    assert res.status_code == 200
    body = res.get_json()
    assert body["success"] is True
    assert body["message"] == "User suspended"
    assert body["data"]["is_active"] is False
    assert body["data"]["was_active"] is True

    db.expire_all()
    assert db.query(User).filter(User.id == target).first().is_active is False

    entry = (db.query(AuditLog)
             .filter(AuditLog.action == "user.status.change", AuditLog.target_id == target)
             .one())
    assert entry.actor_user_id == platform["admin"]
    assert entry.subject_user_id == target
    assert entry.target_type == "user"
    assert "spam uploads" in entry.detail


def test_reactivate_flips_it_back(client, db, admin_headers, platform):
    from app.models import User

    target = platform["patients"][7]     # seeded inactive
    res = client.patch(f"/admin/users/{target}/status", headers=admin_headers,
                       json={"is_active": True})
    assert res.status_code == 200
    assert res.get_json()["message"] == "User reactivated"

    db.expire_all()
    assert db.query(User).filter(User.id == target).first().is_active is True


def test_suspending_bumps_token_version_so_live_sessions_can_be_killed(client, db, admin_headers, platform):
    from app.models import User

    target = platform["patients"][2]
    before = db.query(User).filter(User.id == target).first().token_version or 0
    client.patch(f"/admin/users/{target}/status", headers=admin_headers,
                 json={"is_active": False})
    db.expire_all()
    assert db.query(User).filter(User.id == target).first().token_version == before + 1


def test_status_response_never_leaks_credentials(client, admin_headers, platform):
    raw = client.patch(f"/admin/users/{platform['patients'][4]}/status",
                       headers=admin_headers,
                       json={"is_active": False}).get_data(as_text=True)
    for key in SECRET_KEYS:
        assert key not in raw
    assert "hashed-secret" not in raw


def test_missing_is_active_is_a_400(client, admin_headers, platform):
    res = client.patch(f"/admin/users/{platform['patients'][0]}/status",
                       headers=admin_headers, json={"reason": "no flag given"})
    assert res.status_code == 400
    assert res.get_json()["success"] is False


def test_non_boolean_is_active_is_a_400(client, admin_headers, platform):
    res = client.patch(f"/admin/users/{platform['patients'][0]}/status",
                       headers=admin_headers, json={"is_active": "sometimes"})
    assert res.status_code == 400


def test_unknown_user_is_a_404(client, admin_headers):
    res = client.patch("/admin/users/999999/status", headers=admin_headers,
                       json={"is_active": False})
    assert res.status_code == 404


def test_admin_cannot_deactivate_their_own_account(client, db, admin_headers, platform):
    from app.models import User

    res = client.patch(f"/admin/users/{platform['admin']}/status", headers=admin_headers,
                       json={"is_active": False})
    assert res.status_code == 400
    db.expire_all()
    assert db.query(User).filter(User.id == platform["admin"]).first().is_active is True


# ======================================================================
# is_root IS PROTECTED -- the headline safety property.
# ======================================================================
def test_root_account_cannot_be_suspended(client, db, admin_headers, platform):
    from app.models import AuditLog, User

    res = client.patch(f"/admin/users/{platform['root']}/status", headers=admin_headers,
                       json={"is_active": False, "reason": "hostile takeover"})
    assert res.status_code == 403
    assert res.get_json()["success"] is False

    # The refusal must leave the DATABASE untouched, not merely return 403.
    db.expire_all()
    root = db.query(User).filter(User.id == platform["root"]).first()
    assert root.is_active is True
    assert root.is_root is True
    assert (root.token_version or 0) == 0

    assert db.query(AuditLog).filter(
        AuditLog.action == "user.status.change",
        AuditLog.target_id == platform["root"],
    ).count() == 0


def test_root_account_cannot_be_reactivated_either(client, admin_headers, platform):
    """The guard is on the TARGET, not on the direction of the change -- an
    'is_active: true' payload must not be a way to touch a root row."""
    res = client.patch(f"/admin/users/{platform['root']}/status", headers=admin_headers,
                       json={"is_active": True})
    assert res.status_code == 403


def test_root_is_still_visible_and_flagged_so_the_ui_can_lock_it(client, admin_headers, platform):
    data = _data(client.get("/admin/users?per_page=100", headers=admin_headers))
    root = next(i for i in data["items"] if i["id"] == platform["root"])
    assert root["is_root"] is True


def test_root_is_refused_as_an_act_as_target(app, platform):
    """Belt-and-braces: rbac.py owns this rule, but the admin console is the
    surface that would expose it, so it is asserted here too."""
    from app.core.rbac import _apply_delegation, build_actor

    with app.test_request_context(headers={"X-Act-As-User-Id": str(platform["root"])}):
        actor, err = _apply_delegation(build_actor(platform["admin"], "Admin"))
    assert actor is None
    assert err is not None and err[1] == 403


# ======================================================================
# AUTHORISATION -- the whole surface is above the hierarchy line.
# ======================================================================
@pytest.mark.parametrize("method,path", EVERY_ADMIN_ENDPOINT)
def test_a_doctor_token_is_403_on_every_admin_endpoint(client, auth_headers, platform, method, path):
    """A Doctor holds every PATIENT permission plus six clinical ones, and none
    of them is user.read.any / scan.read.any / appointment.read.any /
    admin.audit.read. This is the test that keeps the hierarchy from leaking
    upwards."""
    headers = auth_headers(platform["doctor"], "Doctor")
    res = _call(client, method, path, headers=headers)
    assert res.status_code == 403, f"{method} {path} returned {res.status_code}"
    assert res.get_json()["success"] is False
    assert res.get_json()["error"] == "Access denied! Only Admins allowed."


@pytest.mark.parametrize("method,path", EVERY_ADMIN_ENDPOINT)
def test_a_patient_token_is_403_on_every_admin_endpoint(client, auth_headers, platform, method, path):
    headers = auth_headers(platform["patients"][0], "AI User")
    res = _call(client, method, path, headers=headers)
    assert res.status_code == 403


@pytest.mark.parametrize("method,path", EVERY_ADMIN_ENDPOINT)
def test_no_token_is_401_on_every_admin_endpoint(client, method, path):
    res = _call(client, method, path)
    assert res.status_code == 401
    assert res.get_json()["error"] == "Token is missing! Unauthorized access."


@pytest.mark.parametrize("method,path", EVERY_ADMIN_ENDPOINT)
def test_an_admin_delegating_down_to_a_doctor_loses_the_admin_console(
    client, auth_headers, platform, method, path
):
    """Act-as computes effective = ROLE_PERMISSIONS[target] & principal, so an
    admin acting as a doctor is a doctor -- including here."""
    headers = auth_headers(platform["admin"], "Admin", act_as=platform["doctor"])
    res = _call(client, method, path, headers=headers)
    assert res.status_code == 403


def test_an_admin_token_reaches_all_of_it(client, admin_headers, platform):
    for method, path in ADMIN_ENDPOINTS:
        if method == "PATCH":
            path = f"/admin/users/{platform['patients'][5]}/status"
        res = _call(client, method, path, headers=admin_headers)
        assert res.status_code == 200, f"{method} {path} returned {res.status_code}"


# ======================================================================
# The original four must be untouched.
# ======================================================================
def test_the_original_admin_routes_still_behave_exactly_as_before(client, admin_headers, platform):
    stats = client.get("/admin/stats", headers=admin_headers)
    assert stats.status_code == 200
    assert set(stats.get_json()["data"]) == {
        "total_users", "total_scans", "total_doctors", "pending_doctor_verifications",
    }
    assert stats.get_json()["data"]["total_doctors"] == 2
    assert stats.get_json()["data"]["pending_doctor_verifications"] == 1

    doctors = client.get("/admin/doctors", headers=admin_headers)
    assert doctors.status_code == 200
    # STILL a bare array under `data` -- NOT the new page envelope.
    payload = doctors.get_json()["data"]
    assert isinstance(payload, list)
    assert len(payload) == 2
    assert len(payload[0]) == 13
    # ... and still the strftime format, not isoformat.
    assert "T" not in payload[0]["created_at"]
