"""
RBAC tests.

These prove the property the whole refactor exists for: the role hierarchy is
REAL, built by set union, so a Doctor genuinely holds every Patient permission
and can scan and book on their own account instead of needing a second one.

They also pin the delegation rules, because "admin can act as a user" is a
privilege-escalation primitive and its edges are the interesting part.

None of these tests need a database except the delegation ones, which are
explicit about it.
"""

import pytest

from app.core.rbac import (
    ADMIN_PERMS,
    DOCTOR_PERMS,
    PATIENT_PERMS,
    ROLE_ALIASES,
    ROLE_PERMISSIONS,
    ROLE_RANK,
    Actor,
    Permission,
    Role,
    build_actor,
    normalize_role,
    resolve_actor,
)


# =====================================================================
# Role literals -- these strings are in the database and in live JWTs.
# =====================================================================
def test_role_values_are_the_exact_db_literals():
    assert Role.ADMIN.value == "Admin"
    assert Role.DOCTOR.value == "Doctor"
    assert Role.PATIENT.value == "AI User"


def test_legacy_patient_alias_is_absorbed():
    # monolith line 182 accepted 'Patient' alongside 'AI User'.
    assert normalize_role("Patient") is Role.PATIENT
    assert normalize_role("patient") is Role.PATIENT
    assert normalize_role("ai_derma") is Role.PATIENT
    assert normalize_role("AI user") is Role.PATIENT
    assert normalize_role("AI User") is Role.PATIENT


def test_unknown_role_is_none_not_a_default():
    assert normalize_role("Superuser") is None
    assert normalize_role("") is None
    assert normalize_role(None) is None


def test_every_alias_maps_to_a_real_role():
    for alias, role in ROLE_ALIASES.items():
        assert isinstance(role, Role), alias


# =====================================================================
# THE HIERARCHY -- the headline requirement.
# =====================================================================
def test_doctor_holds_every_patient_permission():
    """A dermatologist must be able to scan their own mole and book their own
    appointment WITHOUT creating a second account."""
    missing = PATIENT_PERMS - DOCTOR_PERMS
    assert missing == set(), f"Doctor is missing patient permissions: {missing}"


def test_admin_holds_every_doctor_permission():
    missing = DOCTOR_PERMS - ADMIN_PERMS
    assert missing == set(), f"Admin is missing doctor permissions: {missing}"


def test_admin_transitively_holds_every_patient_permission():
    assert PATIENT_PERMS <= ADMIN_PERMS


def test_hierarchy_is_strict_not_merely_equal():
    assert DOCTOR_PERMS > PATIENT_PERMS
    assert ADMIN_PERMS > DOCTOR_PERMS


def test_doctor_can_actually_do_patient_things():
    doctor = build_actor(7, "Doctor")
    assert doctor.can(Permission.SCAN_CREATE)
    assert doctor.can(Permission.SCAN_READ_OWN)
    assert doctor.can(Permission.APPOINTMENT_BOOK)
    assert doctor.can(Permission.RATING_CREATE)


def test_patient_cannot_do_doctor_things():
    patient = build_actor(9, "AI User")
    assert not patient.can(Permission.SCAN_REVIEW_ASSIGNED)
    assert not patient.can(Permission.SCHEDULE_MANAGE)
    assert not patient.can(Permission.DOCTOR_VERIFY)
    assert not patient.can(Permission.ACTOR_ACT_AS)


def test_doctor_cannot_do_admin_things():
    doctor = build_actor(7, "Doctor")
    assert not doctor.can(Permission.DOCTOR_VERIFY)
    assert not doctor.can(Permission.ADMIN_STATS)
    assert not doctor.can(Permission.ACTOR_ACT_AS)
    assert not doctor.can(Permission.SCAN_READ_ANY)


def test_only_admin_may_delegate():
    assert Permission.ACTOR_ACT_AS in ADMIN_PERMS
    assert Permission.ACTOR_ACT_AS not in DOCTOR_PERMS
    assert Permission.ACTOR_ACT_AS not in PATIENT_PERMS


def test_role_permissions_map_covers_every_role():
    assert set(ROLE_PERMISSIONS) == set(Role)


def test_role_rank_is_strictly_ordered():
    assert ROLE_RANK[Role.PATIENT] < ROLE_RANK[Role.DOCTOR] < ROLE_RANK[Role.ADMIN]


# =====================================================================
# resolve_actor -- the single ownership primitive.
# =====================================================================
def test_resolve_actor_allows_self_with_own_permission():
    patient = build_actor(42, "AI User")
    assert resolve_actor(42, Permission.SCAN_READ_OWN, Permission.SCAN_READ_ANY, actor=patient)


def test_resolve_actor_refuses_other_users_data():
    patient = build_actor(42, "AI User")
    assert not resolve_actor(99, Permission.SCAN_READ_OWN, Permission.SCAN_READ_ANY, actor=patient)


def test_resolve_actor_allows_any_permission_holder_on_someone_elses_data():
    admin = build_actor(1, "Admin")
    assert resolve_actor(99, Permission.SCAN_READ_OWN, Permission.SCAN_READ_ANY, actor=admin)


def test_resolve_actor_refuses_self_without_the_own_permission():
    """Holding neither the own- nor the any-permission is a refusal even for
    your own row -- ownership is not a bypass."""
    stripped = Actor(id=42, role=Role.PATIENT, permissions=frozenset())
    assert not resolve_actor(42, Permission.SCAN_READ_OWN, Permission.SCAN_READ_ANY, actor=stripped)


def test_resolve_actor_handles_string_ids_from_url_params():
    patient = build_actor(42, "AI User")
    assert resolve_actor("42", Permission.SCAN_READ_OWN, Permission.SCAN_READ_ANY, actor=patient)


def test_resolve_actor_refuses_garbage_ids():
    admin = build_actor(1, "Admin")
    assert not resolve_actor("not-a-number", Permission.SCAN_READ_OWN, None, actor=admin)


def test_resolve_actor_without_an_actor_is_false():
    assert not resolve_actor(1, Permission.SCAN_READ_OWN, Permission.SCAN_READ_ANY, actor=None)


# =====================================================================
# Actor
# =====================================================================
def test_actor_current_user_shape_matches_the_jwt_claims():
    """Ported handler bodies read request.current_user['user_id'] and ['role'].
    The claim NAMES must not change or in-flight tokens stop working."""
    actor = build_actor(5, "Doctor")
    assert actor.to_current_user() == {"user_id": 5, "role": "Doctor"}


def test_delegated_actor_remembers_the_principal():
    delegated = Actor(
        id=42, role=Role.PATIENT,
        permissions=PATIENT_PERMS, principal_id=1,
    )
    assert delegated.is_delegated
    assert delegated.principal_id == 1
    assert not build_actor(42, "AI User").is_delegated


def test_effective_permissions_are_an_intersection_never_a_union():
    """The delegation rule: effective = ROLE_PERMISSIONS[target] & principal.
    An admin acting as a patient must LOSE admin powers, not keep them."""
    principal = build_actor(1, "Admin")
    effective = frozenset(ROLE_PERMISSIONS[Role.PATIENT]) & frozenset(principal.permissions)
    assert effective == PATIENT_PERMS
    assert Permission.DOCTOR_VERIFY not in effective
    assert Permission.ACTOR_ACT_AS not in effective


# =====================================================================
# Delegation via the HTTP header. These need a database (the target user
# must exist and the audit row is written), so they skip without one.
# =====================================================================
@pytest.fixture()
def users(db):
    """root admin, plain admin, doctor, patient."""
    from app.models import User

    rows = {
        "root": User(name="Root", email="root@t.local", password="x", role="Admin",
                     is_root=True, is_active=True, is_verified=True),
        "admin": User(name="Admin", email="admin@t.local", password="x", role="Admin",
                      is_root=False, is_active=True, is_verified=True),
        "doctor": User(name="Doc", email="doc@t.local", password="x", role="Doctor",
                       is_root=False, is_active=True, is_verified=True),
        "patient": User(name="Pat", email="pat@t.local", password="x", role="AI User",
                        is_root=False, is_active=True, is_verified=True),
    }
    for row in rows.values():
        db.add(row)
    db.commit()
    for row in rows.values():
        db.refresh(row)
    return {k: v.id for k, v in rows.items()}


def _act_as(app, actor_id, actor_role, target_id):
    """Run the delegation path and return (actor, error_response)."""
    from app.core.rbac import _apply_delegation, build_actor

    with app.test_request_context(headers={"X-Act-As-User-Id": str(target_id)}):
        return _apply_delegation(build_actor(actor_id, actor_role))


def test_act_as_requires_the_act_as_permission(app, users):
    _, err = _act_as(app, users["doctor"], "Doctor", users["patient"])
    assert err is not None
    body, status = err
    assert status == 403


def test_act_as_requires_strictly_higher_rank(app, users):
    """Admin -> Admin is refused: equal rank is not enough."""
    _, err = _act_as(app, users["admin"], "Admin", users["root"])
    assert err is not None
    assert err[1] == 403


def test_act_as_against_a_root_user_is_refused(app, users):
    actor, err = _act_as(app, users["admin"], "Admin", users["root"])
    assert actor is None
    assert err is not None
    assert err[1] == 403


def test_admin_can_act_as_a_patient_and_gets_only_patient_powers(app, users):
    actor, err = _act_as(app, users["admin"], "Admin", users["patient"])
    assert err is None
    assert actor.id == users["patient"]
    assert actor.role is Role.PATIENT
    assert actor.principal_id == users["admin"]
    assert actor.is_delegated
    assert actor.permissions == PATIENT_PERMS
    assert not actor.can(Permission.DOCTOR_VERIFY)
    assert not actor.can(Permission.ACTOR_ACT_AS)


def test_admin_can_act_as_a_doctor(app, users):
    actor, err = _act_as(app, users["admin"], "Admin", users["doctor"])
    assert err is None
    assert actor.role is Role.DOCTOR
    assert actor.can(Permission.SCAN_REVIEW_ASSIGNED)
    assert not actor.can(Permission.ACTOR_ACT_AS)


def test_act_as_writes_an_audit_row(app, db, users):
    from app.models import AuditLog

    before = db.query(AuditLog).filter(AuditLog.action == "act_as").count()
    actor, err = _act_as(app, users["admin"], "Admin", users["patient"])
    assert err is None and actor is not None
    db.expire_all()
    rows = db.query(AuditLog).filter(AuditLog.action == "act_as").all()
    assert len(rows) == before + 1
    latest = rows[-1]
    assert latest.actor_user_id == users["admin"]
    assert latest.subject_user_id == users["patient"]


def test_act_as_unknown_target_is_404(app, users):
    actor, err = _act_as(app, users["admin"], "Admin", 999999)
    assert actor is None
    assert err is not None
    assert err[1] == 404


def test_no_header_means_no_delegation(app, users):
    from app.core.rbac import _apply_delegation, build_actor

    with app.test_request_context():
        principal = build_actor(users["admin"], "Admin")
        actor, err = _apply_delegation(principal)
    assert err is None
    assert actor is principal
    assert not actor.is_delegated
