"""
Admin console queries -- the read/manage surface behind /admin/*.

WHY THIS EXISTS
---------------
The user requirement is "admin can perform all actions of doc and user".
`app/core/rbac.py` already delivers the *capability* half of that (ADMIN_PERMS
is a strict superset of DOCTOR_PERMS which is a strict superset of
PATIENT_PERMS, plus X-Act-As-User-Id delegation). What was missing was the
*visibility* half: an admin holding `user.read.any` / `scan.read.any` /
`appointment.read.any` had no endpoint that actually returned those rows. Today
the admin blueprint can only list doctors. This module is the query layer for
the rest.

HARD RULES OBSERVED HERE
------------------------
* PAGINATION IS REAL SQL. Every list runs exactly two statements: a
  `SELECT count(...)` and a `SELECT ... LIMIT ... OFFSET ...` over the SAME
  condition list. Nothing ever loads a whole table and slices it in Python --
  `/admin/doctors` does that (deliberately, it is a preserved monolith quirk)
  and it is precisely what must not spread.
* NO SECRETS ON THE WIRE. `users.password`, `otp_code`, `otp_created_at`,
  `otp_attempts` and `pending_email` are never serialised by anything in this
  module. The `_user_public()` helper is the only place a user row becomes a
  dict, so that guarantee is auditable in one screenful.
* is_root IS SACRED. `set_user_status()` refuses a root target outright. Root
  is also unsuspendable, undeletable and (in rbac.py) an invalid act-as target.
  Every list surfaces the flag so the UI can grey the row out.
* ORDERING IS TOTAL. Every list orders by a timestamp AND by id, because
  LIMIT/OFFSET over a non-unique sort key silently duplicates and drops rows
  between pages.

FILTER SEMANTICS WORTH KNOWING
------------------------------
* `date_from` is inclusive. `date_to` given as YYYY-MM-DD covers the WHOLE of
  that day (it is expanded to the following midnight, exclusive); given as a
  full timestamp it is exclusive.
* Text filters (`q`, `patient`) use ILIKE with the term wrapped in `%`.
* Free-text search never joins -- it uses an `IN (SELECT id FROM users ...)`
  subquery so the count and page statements stay structurally identical.
* Appointments cannot be date-filtered on `appointment_date`: that column is
  free text ("YYYY-MM-DD" *or* "Mon, Jan 26"), so range comparison on it is
  meaningless. `date_field=created` (default) filters `created_at`;
  `date_field=slot` filters the typed shadow `slot_start`, which is NULL on
  legacy rows and therefore excludes them.
"""

import datetime
import logging
import re
import secrets

from sqlalchemy import func, or_, select

from app.core.errors import ValidationError
from app.core.validation import (
    APPOINTMENT_STATUSES,
    SCAN_STATUSES,
    SEVERITY_LEVELS,
    as_bool,
    as_float,
    as_int,
    is_email,
)
from app.core.rbac import Role, normalize_role, role_rank
from app.core.security import hash_password
from app.models import (
    AIScan,
    Appointment,
    AppointmentRequest,
    AppointmentRequestDoctor,
    AuditLog,
    DoctorProfile,
    DoctorRating,
    User,
)
from app.services.serializers import image_url_slashed, iso, iso_pk, round2

logger = logging.getLogger(__name__)

# ======================================================================
# PAGINATION
# ======================================================================
DEFAULT_PER_PAGE = 20
MAX_PER_PAGE = 100

# The authenticated image route the scans phase is adding. Emitted as
# `image_endpoint` ALONGSIDE the legacy `image_url` so the admin table can move
# to authenticated reads without a breaking response change.
SCAN_IMAGE_ENDPOINT = "/api/scans/{scan_id}/image"

ERR_ROOT_PROTECTED = "Access denied! Root accounts are protected."

_DATE_ONLY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def parse_pagination(args):
    """(page, per_page), clamped. Garbage input falls back to the defaults
    instead of 400-ing, because a paginator is not where a UI should fail."""
    page = as_int(args.get("page"), 1) or 1
    per_page = as_int(args.get("per_page"), DEFAULT_PER_PAGE) or DEFAULT_PER_PAGE
    return max(1, page), min(max(1, per_page), MAX_PER_PAGE)


def page_envelope(items, page, per_page, total):
    """The `data` payload every admin list returns.

    `has_more` is computed, not inferred from len(items): a page that comes back
    full is not evidence that another page exists.
    """
    return {
        "items": items,
        "page": page,
        "per_page": per_page,
        "total": int(total or 0),
        "has_more": (page * per_page) < int(total or 0),
    }


def _offset(page, per_page):
    return (page - 1) * per_page


def _count(db, id_column, conditions):
    """SELECT count(id) FROM ... WHERE <conditions>.

    Built as a bare column query so no `lazy="joined"` relationship (AIScan.owner,
    Appointment.patient, ...) drags its eager JOIN into the count.
    """
    return db.query(func.count(id_column)).filter(*conditions).scalar() or 0


# ======================================================================
# FILTER PARSING
# ======================================================================
def parse_datetime_param(raw, name, end_exclusive=False):
    """'2026-07-25' or a full ISO-8601 timestamp -> naive UTC datetime.

    Every DateTime column in this schema is naive and holds UTC, so an aware
    input is converted to UTC and stripped rather than compared across types
    (which Postgres would reject outright).
    """
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None

    if _DATE_ONLY_RE.match(text):
        try:
            value = datetime.datetime.strptime(text, "%Y-%m-%d")
        except ValueError:
            raise ValidationError(error=f"Invalid {name}. Use YYYY-MM-DD or an ISO-8601 timestamp.", status_code=400)
        # A bare date as the UPPER bound means "through the end of that day".
        return value + datetime.timedelta(days=1) if end_exclusive else value

    try:
        value = datetime.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        raise ValidationError(error=f"Invalid {name}. Use YYYY-MM-DD or an ISO-8601 timestamp.", status_code=400)

    if value.tzinfo is not None:
        value = value.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    return value


def parse_date_range(args, from_key="date_from", to_key="date_to"):
    """(start_inclusive, end_exclusive)."""
    start = parse_datetime_param(args.get(from_key), from_key)
    end = parse_datetime_param(args.get(to_key), to_key, end_exclusive=True)
    if start and end and end <= start:
        raise ValidationError(error=f"{to_key} must be after {from_key}.", status_code=400)
    return start, end


def parse_bool_param(args, name):
    """Tri-state: True / False / None (absent). An unparseable value is a 400 --
    silently treating ?is_active=maybe as "all" would hide rows from an admin."""
    raw = args.get(name)
    if raw is None:
        return None
    text = str(raw).strip().lower()
    if text == "":
        return None
    if text in ("1", "true", "yes", "on"):
        return True
    if text in ("0", "false", "no", "off"):
        return False
    raise ValidationError(error=f"Invalid {name}. Use true or false.", status_code=400)


def _one_of(value, allowed, name):
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if text not in allowed:
        raise ValidationError(
            error=f"Invalid {name}. Allowed: {', '.join(allowed)}",
            status_code=400,
        )
    return text


def _like(term):
    return f"%{str(term).strip()}%"


def _user_text_subquery(term):
    """`IN (SELECT id FROM users WHERE name ILIKE .. OR email ILIKE ..)`.

    A subquery rather than a JOIN on purpose: the count statement and the page
    statement then differ only in their select list, so they can never disagree
    about how many rows match.
    """
    pattern = _like(term)
    return select(User.id).where(or_(User.name.ilike(pattern), User.email.ilike(pattern)))


def _user_ref_condition(column, raw):
    """?patient=12 -> exact id. ?patient=asma -> name/email search."""
    numeric = as_int(raw, None)
    if numeric is not None:
        return column == numeric
    return column.in_(_user_text_subquery(raw))


# ======================================================================
# SERIALISERS  -- the ONLY places a row becomes a dict.
# ======================================================================
def _user_public(user, verification_status=None, extra=None):
    """A user row minus every secret.

    Explicitly NOT included: password, otp_code, otp_created_at, otp_attempts,
    pending_email, token_version. Adding one of those here is the single change
    that would leak credentials through the admin console, so it is called out.
    """
    payload = {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "is_root": bool(user.is_root),
        "is_active": bool(user.is_active),
        "is_verified": bool(user.is_verified),
        "created_at": iso_pk(user.created_at),
        "last_login_at": iso_pk(user.last_login_at),
        "verification_status": verification_status,
    }
    if extra:
        payload.update(extra)
    return payload


def _scan_public(scan):
    owner = scan.owner
    reviewer = scan.reviewer
    return {
        "id": scan.id,
        "user_id": scan.user_id,
        "patient_name": owner.name if owner else None,
        "patient_email": owner.email if owner else None,
        "doctor_id": scan.doctor_id,
        "doctor_name": (reviewer.name if reviewer else None) or scan.doctor_name,
        "prediction": scan.prediction_result,
        "confidence": round2(scan.confidence),
        "severity_level": scan.severity_level,
        "triage_score": scan.triage_score,
        "status": scan.status,
        "review_status": scan.review_status,
        "doctor_comment": scan.doctor_comment,
        "invite_to_clinic": bool(scan.invite_to_clinic),
        "is_sensitive": bool(scan.is_sensitive),
        "image_deleted_at": iso_pk(scan.image_deleted_at),
        # Legacy shape, unchanged: '/'-prefixed static path, '' when absent.
        "image_url": image_url_slashed(scan.image_url),
        # ADDITIVE: the authenticated route. Null once the pixels are gone, so a
        # client never renders a 404 for a patient-deleted photo.
        "image_endpoint": None if scan.image_deleted_at else SCAN_IMAGE_ENDPOINT.format(scan_id=scan.id),
        "created_at": iso_pk(scan.created_at),
        "updated_at": iso_pk(scan.updated_at),
    }


def _appointment_public(appt):
    patient = appt.patient
    doctor = appt.doctor
    return {
        "id": appt.id,
        "patient_id": appt.patient_id,
        "patient_name": patient.name if patient else None,
        "patient_email": patient.email if patient else None,
        "doctor_id": appt.doctor_id,
        "doctor_name": doctor.name if doctor else None,
        "doctor_email": doctor.email if doctor else None,
        "scan_id": appt.scan_id,
        "appointment_date": appt.appointment_date,
        "appointment_time": appt.appointment_time,
        # slot_start is clinic wall-clock already -- iso(), NEVER iso_pk().
        "slot_start": iso(appt.slot_start),
        "duration": appt.duration,
        "status": appt.status,
        "cancellation_reason": appt.cancellation_reason,
        "hidden_from_doctor": bool(appt.hidden_from_doctor),
        "conflict_with_id": appt.conflict_with_id,
        "auto_resolved": bool(appt.auto_resolved),
        "resolved_at": iso_pk(appt.resolved_at),
        "created_at": iso_pk(appt.created_at),
    }


def _audit_public(row, names):
    actor = names.get(row.actor_user_id)
    subject = names.get(row.subject_user_id)
    return {
        "id": row.id,
        "actor_user_id": row.actor_user_id,
        "actor_name": actor.name if actor else None,
        "actor_email": actor.email if actor else None,
        "subject_user_id": row.subject_user_id,
        "subject_name": subject.name if subject else None,
        "subject_email": subject.email if subject else None,
        "action": row.action,
        "target_type": row.target_type,
        "target_id": row.target_id,
        "detail": row.detail,
        "ip": row.ip,
        "user_agent": row.user_agent,
        "created_at": iso_pk(row.created_at),
    }


def _name_lookup(db, ids):
    """{id: Row(id, name, email)} for a page's worth of user ids -- one query,
    never one per row."""
    wanted = {i for i in ids if i is not None}
    if not wanted:
        return {}
    rows = db.query(User.id, User.name, User.email).filter(User.id.in_(wanted)).all()
    return {row.id: row for row in rows}


def _verification_lookup(db, user_ids):
    """{user_id: verification_status} for the doctors on this page.

    `User.doctor_profile` is `lazy="joined"`, so `row.doctor_profile` would be
    free right now -- but that makes the N+1 behaviour of this module depend on
    a loader setting in models/user.py that nobody would think to check before
    changing. One explicit query per page is immune to that.
    """
    if not user_ids:
        return {}
    rows = db.query(DoctorProfile.user_id, DoctorProfile.verification_status).filter(
        DoctorProfile.user_id.in_(user_ids)
    ).all()
    return {row.user_id: row.verification_status for row in rows}


def _grouped_counts(db, group_column, id_column, owner_ids):
    """{owner_id: n} via a single GROUP BY. The alternative -- len(user.scans)
    per row -- is an N+1 that gets slower as the platform succeeds."""
    if not owner_ids:
        return {}
    rows = db.query(group_column, func.count(id_column)).filter(
        group_column.in_(owner_ids)
    ).group_by(group_column).all()
    return {row[0]: row[1] for row in rows}


# ======================================================================
# LISTS
# ======================================================================
def list_patients(db, args):
    """GET /admin/patients -- role='AI User' only.

    A Doctor who also books their own appointments is NOT listed here (they are
    in /admin/users?role=Doctor); this endpoint answers "who are the patients",
    which is a roster question, not a capability question.
    """
    page, per_page = parse_pagination(args)
    conditions = [User.role == Role.PATIENT.value]

    q = (args.get("q") or "").strip()
    if q:
        pattern = _like(q)
        conditions.append(or_(User.name.ilike(pattern), User.email.ilike(pattern)))

    is_active = parse_bool_param(args, "is_active")
    if is_active is not None:
        conditions.append(User.is_active.is_(is_active))

    total = _count(db, User.id, conditions)
    rows = (
        db.query(User)
        .filter(*conditions)
        .order_by(User.created_at.desc().nulls_last(), User.id.desc())
        .limit(per_page)
        .offset(_offset(page, per_page))
        .all()
    )

    ids = [r.id for r in rows]
    scan_counts = _grouped_counts(db, AIScan.user_id, AIScan.id, ids)
    appt_counts = _grouped_counts(db, Appointment.patient_id, Appointment.id, ids)

    items = [
        {
            "id": r.id,
            "name": r.name,
            "email": r.email,
            "is_active": bool(r.is_active),
            "created_at": iso_pk(r.created_at),
            "scan_count": int(scan_counts.get(r.id, 0)),
            "appointment_count": int(appt_counts.get(r.id, 0)),
        }
        for r in rows
    ]
    return page_envelope(items, page, per_page, total)


def list_users(db, args):
    """GET /admin/users -- every role, with is_root so the UI can lock the row."""
    page, per_page = parse_pagination(args)
    conditions = []

    role_raw = (args.get("role") or "").strip()
    if role_raw:
        role = normalize_role(role_raw)
        if role is None:
            raise ValidationError(
                error="Invalid role. Allowed: Admin, Doctor, AI User",
                status_code=400,
            )
        conditions.append(User.role == role.value)

    q = (args.get("q") or "").strip()
    if q:
        pattern = _like(q)
        conditions.append(or_(User.name.ilike(pattern), User.email.ilike(pattern)))

    is_active = parse_bool_param(args, "is_active")
    if is_active is not None:
        conditions.append(User.is_active.is_(is_active))

    is_root = parse_bool_param(args, "is_root")
    if is_root is not None:
        conditions.append(User.is_root.is_(is_root))

    is_verified = parse_bool_param(args, "is_verified")
    if is_verified is not None:
        conditions.append(User.is_verified.is_(is_verified))

    total = _count(db, User.id, conditions)
    rows = (
        db.query(User)
        .filter(*conditions)
        .order_by(User.created_at.desc().nulls_last(), User.id.desc())
        .limit(per_page)
        .offset(_offset(page, per_page))
        .all()
    )

    doctor_ids = [r.id for r in rows if r.role == Role.DOCTOR.value]
    verification = _verification_lookup(db, doctor_ids)

    items = [
        _user_public(
            r,
            verification_status=(
                verification.get(r.id, "pending") if r.role == Role.DOCTOR.value else None
            ),
        )
        for r in rows
    ]
    return page_envelope(items, page, per_page, total)


def list_scans(db, args):
    """GET /admin/scans -- every scan on the platform."""
    page, per_page = parse_pagination(args)
    conditions = []

    severity = _one_of(args.get("severity"), SEVERITY_LEVELS, "severity")
    if severity:
        conditions.append(AIScan.severity_level == severity)

    status = _one_of(args.get("status"), SCAN_STATUSES, "status")
    if status:
        conditions.append(AIScan.status == status)

    review_status = _one_of(args.get("review_status"), SCAN_STATUSES, "review_status")
    if review_status:
        conditions.append(AIScan.review_status == review_status)

    patient = (args.get("patient") or args.get("patient_id") or "").strip()
    if patient:
        conditions.append(_user_ref_condition(AIScan.user_id, patient))

    doctor = (args.get("doctor") or args.get("doctor_id") or "").strip()
    if doctor:
        conditions.append(_user_ref_condition(AIScan.doctor_id, doctor))

    start, end = parse_date_range(args)
    if start:
        conditions.append(AIScan.created_at >= start)
    if end:
        conditions.append(AIScan.created_at < end)

    total = _count(db, AIScan.id, conditions)
    rows = (
        db.query(AIScan)
        .filter(*conditions)
        .order_by(AIScan.created_at.desc().nulls_last(), AIScan.id.desc())
        .limit(per_page)
        .offset(_offset(page, per_page))
        .all()
    )
    return page_envelope([_scan_public(r) for r in rows], page, per_page, total)


def list_appointments(db, args):
    """GET /admin/appointments.

    `date_field` picks WHICH date the range applies to:
      created (default) -> appointments.created_at, always populated
      slot              -> appointments.slot_start, the typed shadow column;
                           NULL on legacy rows, which are then excluded.
    `appointments.appointment_date` is deliberately not range-filterable: it is
    a free-text column that holds either "2026-07-25" or "Mon, Jan 26", so
    `>=` on it compares strings, not dates.
    """
    page, per_page = parse_pagination(args)
    conditions = []

    status = _one_of(args.get("status"), APPOINTMENT_STATUSES, "status")
    if status:
        conditions.append(Appointment.status == status)

    doctor = (args.get("doctor") or args.get("doctor_id") or "").strip()
    if doctor:
        conditions.append(_user_ref_condition(Appointment.doctor_id, doctor))

    patient = (args.get("patient") or args.get("patient_id") or "").strip()
    if patient:
        conditions.append(_user_ref_condition(Appointment.patient_id, patient))

    date_field = (args.get("date_field") or "created").strip().lower()
    if date_field not in ("created", "slot"):
        raise ValidationError(error="Invalid date_field. Allowed: created, slot", status_code=400)
    date_column = Appointment.created_at if date_field == "created" else Appointment.slot_start

    start, end = parse_date_range(args)
    if start:
        conditions.append(date_column >= start)
    if end:
        conditions.append(date_column < end)

    total = _count(db, Appointment.id, conditions)
    rows = (
        db.query(Appointment)
        .filter(*conditions)
        .order_by(Appointment.created_at.desc().nulls_last(), Appointment.id.desc())
        .limit(per_page)
        .offset(_offset(page, per_page))
        .all()
    )
    return page_envelope([_appointment_public(r) for r in rows], page, per_page, total)


def list_audit_log(db, args):
    """GET /admin/audit-log.

    This is the table `require_permission`'s act-as branch writes to on every
    delegation, so it is what makes "admin can do everything a user can" an
    accountable power rather than an invisible one.
    """
    page, per_page = parse_pagination(args)
    conditions = []

    actor = (args.get("actor") or args.get("actor_id") or "").strip()
    if actor:
        conditions.append(_user_ref_condition(AuditLog.actor_user_id, actor))

    subject = (args.get("subject") or args.get("subject_id") or "").strip()
    if subject:
        conditions.append(_user_ref_condition(AuditLog.subject_user_id, subject))

    action = (args.get("action") or "").strip()
    if action:
        # Exact match, because actions are a controlled vocabulary
        # ('act_as', 'user.status.change', ...) and an admin auditing a
        # specific action wants that action, not everything containing it.
        conditions.append(AuditLog.action == action)

    action_prefix = (args.get("action_prefix") or "").strip()
    if action_prefix:
        conditions.append(AuditLog.action.ilike(f"{action_prefix}%"))

    target_type = (args.get("target_type") or "").strip()
    if target_type:
        conditions.append(AuditLog.target_type == target_type)

    start, end = parse_date_range(args)
    if start:
        conditions.append(AuditLog.created_at >= start)
    if end:
        conditions.append(AuditLog.created_at < end)

    total = _count(db, AuditLog.id, conditions)
    rows = (
        db.query(AuditLog)
        .filter(*conditions)
        .order_by(AuditLog.created_at.desc(), AuditLog.id.desc())
        .limit(per_page)
        .offset(_offset(page, per_page))
        .all()
    )

    names = _name_lookup(db, [r.actor_user_id for r in rows] + [r.subject_user_id for r in rows])
    return page_envelope([_audit_public(r, names) for r in rows], page, per_page, total)


# ======================================================================
# MANAGE
# ======================================================================
def write_audit(db, actor_user_id, subject_user_id, action, target_type=None,
                target_id=None, detail=None, ip=None, user_agent=None):
    """Same table and column meanings rbac._write_audit uses.

    Duplicated rather than imported because that one reads `flask.request`
    directly, and a service must stay callable from the CLI and the scheduler.
    """
    entry = AuditLog(
        actor_user_id=actor_user_id,
        subject_user_id=subject_user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        detail=detail,
        ip=ip,
        user_agent=(user_agent or "")[:255] or None,
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(entry)
    return entry


def set_user_status(db, target_id, is_active, reason, actor_user_id,
                    ip=None, user_agent=None):
    """PATCH /admin/users/<id>/status. Returns (payload, error) -- exactly one
    is not None; `error` is an (message, status_code) pair.

    REFUSALS, in order:
      * unknown user                      -> 404
      * target.is_root                    -> 403   (root is unsuspendable)
      * deactivating yourself             -> 400   (an admin locking themselves
                                                    out of the console is not a
                                                    recoverable state over HTTP)

    Deactivating also bumps `token_version`, which is the hook the refresh-token
    flow uses to invalidate sessions already sitting in browsers. Nothing reads
    it yet, so today this is purely forward-compatible bookkeeping.
    """
    if is_active is None:
        return None, ("is_active is required and must be a boolean", 400)

    user = db.query(User).filter(User.id == int(target_id)).first()
    if user is None:
        return None, ("User not found", 404)

    if bool(user.is_root):
        logger.warning("Refused status change on root user %s by actor %s", user.id, actor_user_id)
        return None, (ERR_ROOT_PROTECTED, 403)

    is_active = bool(is_active)

    if not is_active and actor_user_id is not None and int(actor_user_id) == user.id:
        return None, ("You cannot deactivate your own account.", 400)

    previous = bool(user.is_active)
    user.is_active = is_active
    if not is_active:
        user.token_version = int(user.token_version or 0) + 1

    reason_text = (str(reason).strip() if reason is not None else "") or None
    write_audit(
        db,
        actor_user_id=actor_user_id,
        subject_user_id=user.id,
        action="user.status.change",
        target_type="user",
        target_id=user.id,
        detail=f"is_active {previous} -> {is_active}" + (f"; reason: {reason_text}" if reason_text else ""),
        ip=ip,
        user_agent=user_agent,
    )

    verification = None
    if user.role == Role.DOCTOR.value:
        verification = _verification_lookup(db, [user.id]).get(user.id, "pending")

    payload = _user_public(user, verification_status=verification, extra={
        "was_active": previous,
        "status_reason": reason_text,
    })
    return payload, None


# ======================================================================
# CRUD  --  create / edit / reset a password / delete an account
# ======================================================================
#
# WHY THESE EXIST
# ---------------
# Everything above is READ plus one flag flip. In practice an admin also has to
# be able to put a real account into the system (a clinic phones up, a doctor
# cannot get past the OTP screen, a patient mistyped their email at signup), and
# the only tool for that used to be a psql prompt. These four close that gap.
#
# THE FOUR RULES ALL OF THEM SHARE
# --------------------------------
# 1. is_root IS SACRED. Same refusal as set_user_status(): 403, row untouched.
# 2. NO PRIVILEGE ESCALATION. `create` cannot mint an Admin (the role whitelist
#    is Doctor / AI User, exactly as /register and /auth/register), and `role` is
#    IMMUTABLE on update -- turning a patient into a doctor means a licence, a
#    verification decision and an email, so it belongs to a deliberate flow and
#    not to a text field on an edit form.
# 3. ONE RANK RULE, borrowed verbatim from rbac._apply_delegation: you may only
#    manage an account STRICTLY BELOW your own rank. An admin therefore cannot
#    reset another admin's password or delete their account, which is what stops
#    a single compromised admin session from owning the whole console.
# 4. EVERY CALL WRITES AN audit_logs ROW naming the human who made it. That is
#    the same table /admin/audit-log reads, so an account that appeared out of
#    nowhere always has an author.
#
# WHAT IS DELIBERATELY *NOT* HERE
# -------------------------------
# * Verification. `PUT /admin/doctors/<id>/verify` owns approve/reject: it writes
#   verified_at / verified_by / verification_note AND emails the doctor. Letting
#   an edit form set verification_status too would give the same decision two
#   code paths, one of which forgets to tell the doctor. The ONE exception is at
#   creation time (see `create_user`), where the admin is entering the licence
#   themselves and there is no prior state to overwrite.
# * A password anywhere in a response except the freshly generated temporary one,
#   returned exactly once by create/reset so the admin can hand it over. It is
#   never stored in plaintext, never logged, and `_user_public()` still cannot
#   emit a password hash.

# Mirrors ALLOWED_SIGNUP_ROLES in app/api/auth/routes.py. 'Admin' is absent on
# purpose: admin rows are seeded by `flask seed-root`, never created over HTTP.
ALLOWED_MANAGED_ROLES = (Role.DOCTOR.value, Role.PATIENT.value)

ERR_ROLE_NOT_ALLOWED = (
    "Only Doctor and patient accounts can be created here. "
    "Admin accounts are seeded by the CLI."
)
ERR_ROLE_IMMUTABLE = (
    "An account's role cannot be changed here. Create the correct account type "
    "and suspend the old one."
)
ERR_RANK_TOO_LOW = "Access denied! You can only manage an account with a lower role than your own."
ERR_EMAIL_TAKEN = "Email already exists"
ERR_LICENSE_TAKEN = "This license number is already registered."

# Unambiguous alphabet: no I/l/1, no O/0. A temporary password gets read down a
# phone line and typed by hand, and "was that a one or an ell" is a support
# ticket.
_TEMP_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
_TEMP_DIGITS = "23456789"

# The columns an admin may write on a doctor's profile. `verification_*` is
# absent by design -- see the note above.
DOCTOR_PROFILE_FIELDS = (
    "license", "specialty", "hospital", "city", "phone",
    "experience", "latitude", "longitude",
)


def generate_temp_password(length=14):
    """A random password that ALWAYS satisfies auth_service.validate_password().

    Guaranteed by construction rather than by luck: at least one letter (so
    `.isdigit()` can never be true), at least 12 characters, and drawn from
    `secrets` so it is not predictable from the creation time.
    """
    length = max(12, int(length or 14))
    pool = _TEMP_LETTERS + _TEMP_DIGITS
    chars = [secrets.choice(_TEMP_LETTERS), secrets.choice(_TEMP_DIGITS)]
    chars += [secrets.choice(pool) for _ in range(length - 2)]
    secrets.SystemRandom().shuffle(chars)
    return "".join(chars)


def _doctor_profile_public(profile):
    """The profile block returned alongside a doctor's user row.

    Same key names `/admin/doctors` uses, so the console has one shape for a
    doctor's licence details regardless of which endpoint produced it.
    """
    if profile is None:
        return None
    return {
        "license": profile.license,
        "specialty": profile.specialty,
        "hospital": profile.hospital,
        "city": profile.city,
        "phone": profile.phone,
        "experience": profile.experience,
        "latitude": profile.latitude,
        "longitude": profile.longitude,
        "verification_status": profile.verification_status or "pending",
        "verification_note": profile.verification_note,
        "verified_at": iso_pk(profile.verified_at),
    }


def _clean_text(value, limit=None):
    """'' and whitespace-only both become None, so a blank form field CLEARS a
    column instead of storing a space that every `if profile.city:` then treats
    as a real value."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:limit] if limit else text


def _email_available(db, email, exclude_user_id=None):
    """Case-insensitive uniqueness check.

    Uses the same `lower()` comparison auth_service.find_user_by_email does, so
    "Asma@x.com" cannot be added next to an existing "asma@x.com" and then fail
    to log in because /login matches exactly.
    """
    query = db.query(User.id).filter(func.lower(User.email) == str(email).strip().lower())
    if exclude_user_id is not None:
        query = query.filter(User.id != int(exclude_user_id))
    return query.first() is None


def _license_available(db, license_number, exclude_user_id=None):
    query = db.query(DoctorProfile.id).filter(DoctorProfile.license == license_number)
    if exclude_user_id is not None:
        query = query.filter(DoctorProfile.user_id != int(exclude_user_id))
    return query.first() is None


def _manage_guard(db, target_id, actor_user_id, actor_role, allow_self=False):
    """(user, error) -- the shared front door for update / reset / delete.

    Refusal order matters and mirrors set_user_status():
      unknown        -> 404
      is_root        -> 403  (root is untouchable, always)
      self           -> 400 unless the caller opted in
      not senior     -> 403  (the rbac.py delegation rule, reused)
    """
    user = db.query(User).filter(User.id == int(target_id)).first()
    if user is None:
        return None, ("User not found", 404)

    if bool(user.is_root):
        logger.warning("Refused admin management of root user %s by actor %s", user.id, actor_user_id)
        return None, (ERR_ROOT_PROTECTED, 403)

    is_self = actor_user_id is not None and int(actor_user_id) == user.id
    if is_self and not allow_self:
        return None, ("You cannot perform this action on your own account.", 400)

    if not is_self and role_rank(actor_role) <= role_rank(user.role):
        logger.warning(
            "Refused admin management: actor %s (%s) is not senior to user %s (%s)",
            actor_user_id, actor_role, user.id, user.role,
        )
        return None, (ERR_RANK_TOO_LOW, 403)

    return user, None


def _password_or_generated(raw_password):
    """(plaintext, temporary, error).

    `temporary` is the value to SHOW the admin -- None when they typed the
    password themselves, because echoing back something they already know only
    puts it on a second screen.
    """
    from app.services.auth_service import validate_password

    if raw_password is None or str(raw_password) == "":
        generated = generate_temp_password()
        return generated, generated, None

    ok, why = validate_password(raw_password)
    if not ok:
        return None, None, (why, 400)
    return str(raw_password), None, None


def _apply_doctor_fields(profile, doctor_payload, provided_only=True):
    """Copy the writable licence fields onto `profile`. Returns changed keys.

    `provided_only` is what makes PATCH a partial update: a key the admin did
    not send is left alone, while a key sent as '' clears the column. Without
    that distinction an edit form that only touches `phone` would wipe the
    hospital and the city.
    """
    changed = []
    for key in DOCTOR_PROFILE_FIELDS:
        if provided_only and key not in doctor_payload:
            continue
        raw = doctor_payload.get(key)
        if key == "experience":
            value = as_int(raw, 0) or 0
        elif key in ("latitude", "longitude"):
            value = None if raw in (None, "") else as_float(raw, None)
        elif key == "license":
            value = _clean_text(raw, 100)
        elif key == "phone":
            value = _clean_text(raw, 20)
        else:
            value = _clean_text(raw, 255)

        if getattr(profile, key) != value:
            setattr(profile, key, value)
            changed.append(key)
    return changed


def create_user(db, payload, actor_user_id, actor_role, ip=None, user_agent=None):
    """POST /admin/users -- provision a doctor or a patient. Returns (data, err).

    An admin-created account is `is_verified=True` by default and NO OTP is
    issued. That is the point: the person on the phone cannot receive a code
    (that is usually why they called), and an admin typing their details IS the
    verification. Pass `is_verified: false` to make them prove the inbox anyway.

    Verification of a DOCTOR is the one place this function touches
    `verification_status`, and only to accept 'approved' at creation --
    'rejected' is refused because creating an account that is born blocked is
    not a thing anyone means to do. Everything afterwards belongs to
    `PUT /admin/doctors/<id>/verify`, which also emails the doctor.
    """
    payload = payload or {}
    name = _clean_text((payload or {}).get("name"), 255)
    email = _clean_text((payload or {}).get("email"), 255)

    if not name:
        return None, ("Name is required", 400)
    if not email:
        return None, ("Email is required", 400)
    if not is_email(email):
        return None, ("That email address does not look valid.", 400)

    role = normalize_role((payload or {}).get("role") or Role.PATIENT.value)
    if role is None or role.value not in ALLOWED_MANAGED_ROLES:
        return None, (ERR_ROLE_NOT_ALLOWED, 403)

    if role_rank(actor_role) <= role_rank(role.value):
        return None, (ERR_RANK_TOO_LOW, 403)

    if not _email_available(db, email):
        return None, (ERR_EMAIL_TAKEN, 400)

    doctor_payload = payload.get("doctor") if isinstance(payload.get("doctor"), dict) else {}

    license_number = None
    if role is Role.DOCTOR:
        license_number = _clean_text(doctor_payload.get("license"), 100)
        if not license_number:
            return None, ("PMDC license number is required for doctor registration", 400)
        if not _license_available(db, license_number):
            return None, (ERR_LICENSE_TAKEN, 400)

    verification_status = "pending"
    if role is Role.DOCTOR:
        requested = _clean_text(doctor_payload.get("verification_status"))
        if requested is not None:
            if requested not in ("pending", "approved"):
                return None, ("verification_status must be 'pending' or 'approved'", 400)
            verification_status = requested

    plaintext, temporary, password_error = _password_or_generated((payload or {}).get("password"))
    if password_error is not None:
        return None, password_error

    is_verified = (payload or {}).get("is_verified")
    is_verified = True if is_verified is None else bool(as_bool(is_verified, True))

    user = User(
        name=name,
        email=email,
        password=hash_password(plaintext),
        role=role.value,
        is_verified=is_verified,
        is_active=True,
        is_root=False,
        otp_attempts=0,
        token_version=0,
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(user)
    db.flush()  # need user.id for the profile row and the audit row

    profile = None
    if role is Role.DOCTOR:
        profile = DoctorProfile(user_id=user.id, license=license_number,
                                verification_status=verification_status)
        # provided_only=False: on a CREATE an omitted key means "no value", which
        # is the correct column state. `license` is re-supplied explicitly
        # because it is NOT NULL and was validated above.
        _apply_doctor_fields(profile, {**doctor_payload, "license": license_number},
                             provided_only=False)
        if verification_status != "pending":
            profile.verified_at = datetime.datetime.now(datetime.timezone.utc)
            profile.verified_by = actor_user_id
            profile.verification_note = _clean_text(doctor_payload.get("verification_note"))
        db.add(profile)
        db.flush()

    write_audit(
        db,
        actor_user_id=actor_user_id,
        subject_user_id=user.id,
        action="user.create",
        target_type="user",
        target_id=user.id,
        detail=(
            f"role={role.value}; is_verified={is_verified}; "
            f"password={'generated' if temporary else 'set by admin'}"
            + (f"; verification={verification_status}" if role is Role.DOCTOR else "")
        ),
        ip=ip,
        user_agent=user_agent,
    )

    data = _user_public(
        user,
        verification_status=verification_status if role is Role.DOCTOR else None,
        extra={
            "doctor": _doctor_profile_public(profile),
            # Returned EXACTLY ONCE, and only when we generated it.
            "temporary_password": temporary,
        },
    )
    return data, None


def update_user(db, target_id, payload, actor_user_id, actor_role, ip=None, user_agent=None):
    """PATCH /admin/users/<id> -- edit an account. Returns (data, err).

    PARTIAL by contract: a key that is absent is not touched. `role` is refused
    outright rather than ignored, because an edit form that silently drops a
    field the admin filled in is worse than one that says no.

    Changing the email CLEARS `pending_email`: an email-change OTP that was in
    flight now points at an address nobody is waiting on. `is_verified` is left
    exactly as it was unless the caller sends it -- an admin correcting a typo
    in someone's address should not accidentally lock them out of login, and
    should not accidentally vouch for an inbox either. It is their call, sent
    explicitly.
    """
    payload = payload or {}
    user, err = _manage_guard(db, target_id, actor_user_id, actor_role, allow_self=True)
    if err is not None:
        return None, err

    if "role" in payload:
        requested = normalize_role(payload.get("role"))
        if requested is None or requested.value != user.role:
            return None, (ERR_ROLE_IMMUTABLE, 400)

    changes = []

    if "name" in payload:
        name = _clean_text(payload.get("name"), 255)
        if not name:
            return None, ("Name is required", 400)
        if name != user.name:
            changes.append(f"name {user.name!r} -> {name!r}")
            user.name = name

    if "email" in payload:
        email = _clean_text(payload.get("email"), 255)
        if not email:
            return None, ("Email is required", 400)
        if not is_email(email):
            return None, ("That email address does not look valid.", 400)
        if email.lower() != str(user.email or "").lower():
            if not _email_available(db, email, exclude_user_id=user.id):
                return None, (ERR_EMAIL_TAKEN, 400)
            changes.append(f"email {user.email!r} -> {email!r}")
            user.email = email
            user.pending_email = None

    if "is_verified" in payload:
        is_verified = bool(as_bool(payload.get("is_verified"), bool(user.is_verified)))
        if is_verified != bool(user.is_verified):
            changes.append(f"is_verified {bool(user.is_verified)} -> {is_verified}")
            user.is_verified = is_verified

    doctor_payload = payload.get("doctor") if isinstance(payload.get("doctor"), dict) else None
    profile = None
    if user.role == Role.DOCTOR.value:
        profile = db.query(DoctorProfile).filter(DoctorProfile.user_id == user.id).first()

    if doctor_payload is not None:
        if user.role != Role.DOCTOR.value:
            return None, ("Only a Doctor account has a licence profile.", 400)

        license_number = (
            _clean_text(doctor_payload.get("license"), 100)
            if "license" in doctor_payload
            else (profile.license if profile else None)
        )
        # doctor_profiles.license is NOT NULL and UNIQUE, and a Doctor row with
        # no profile at all is a real state in this database (/admin/doctors
        # reports those as 'pending'). Creating the missing row therefore needs
        # a licence number, and clearing an existing one is impossible.
        if not license_number:
            return None, ("PMDC license number is required for doctor registration", 400)
        if not _license_available(db, license_number, exclude_user_id=user.id):
            return None, (ERR_LICENSE_TAKEN, 400)

        if profile is None:
            profile = DoctorProfile(
                user_id=user.id, license=license_number, verification_status="pending",
            )
            db.add(profile)
            changes.append("doctor profile created")
        payload_with_license = {**doctor_payload, "license": license_number}
        touched = _apply_doctor_fields(profile, payload_with_license)
        if touched:
            changes.append("doctor: " + ", ".join(sorted(touched)))
        db.flush()

    if not changes:
        # Nothing to record. An audit log full of "changed nothing" rows is an
        # audit log nobody reads.
        return _user_public(
            user,
            verification_status=(profile.verification_status if profile else None),
            extra={"doctor": _doctor_profile_public(profile), "changed": []},
        ), None

    write_audit(
        db,
        actor_user_id=actor_user_id,
        subject_user_id=user.id,
        action="user.update",
        target_type="user",
        target_id=user.id,
        detail="; ".join(changes),
        ip=ip,
        user_agent=user_agent,
    )

    return _user_public(
        user,
        verification_status=(profile.verification_status if profile else None),
        extra={"doctor": _doctor_profile_public(profile), "changed": changes},
    ), None


def reset_user_password(db, target_id, new_password, actor_user_id, actor_role,
                        ip=None, user_agent=None):
    """POST /admin/users/<id>/reset-password. Returns (data, err).

    ENDS EVERY SESSION THE TARGET HAS. `bump_token_version` invalidates their
    access tokens (the version is baked into each one) and revokes their refresh
    rows, so an admin resetting a password because an account is compromised
    actually evicts whoever is holding it. That is the whole reason to reset.

    DOES NOT SET is_verified. The self-service reset does
    (auth/routes.py::_apply_new_password) and is right to: receiving the code
    proves the inbox. Nothing is proved here -- an admin typing a new password
    says nothing about who reads that mailbox -- so an unverified account stays
    unverified.

    Refuses on SELF (400). An admin resetting their own password through this
    route would revoke the very session they are using and be logged out
    mid-action; /auth/change-password is the door for that.
    """
    user, err = _manage_guard(db, target_id, actor_user_id, actor_role, allow_self=False)
    if err is not None:
        return None, err

    plaintext, temporary, password_error = _password_or_generated(new_password)
    if password_error is not None:
        return None, password_error

    from app.services.auth_service import bump_token_version
    from app.services.otp_service import invalidate_otps

    user.password = hash_password(plaintext)
    # A live signup/reset code must not outlive the password it was going to
    # change. Same reasoning as _apply_new_password.
    invalidate_otps(db, user.id)
    user.otp_code = None
    user.otp_created_at = None
    user.otp_attempts = 0

    token_version, revoked = bump_token_version(db, user)

    write_audit(
        db,
        actor_user_id=actor_user_id,
        subject_user_id=user.id,
        action="user.password.reset",
        target_type="user",
        target_id=user.id,
        detail=(
            f"password={'generated' if temporary else 'set by admin'}; "
            f"sessions_revoked={revoked}; token_version={token_version}"
        ),
        ip=ip,
        user_agent=user_agent,
    )

    logger.info(
        "Admin %s reset the password for user %s (%s sessions revoked)",
        actor_user_id, user.id, revoked,
    )

    data = _user_public(user, extra={
        "temporary_password": temporary,
        "sessions_revoked": int(revoked),
    })
    return data, None


def account_links(db, user_id):
    """Everything that would be destroyed with this account.

    Counted per relationship rather than summed, because the counts are shown to
    the admin and "3 appointments" is actionable where "3 linked records" is not.

    THE LIST IS EVERY `ON DELETE CASCADE` FK POINTING AT users.id THAT CARRIES
    CLINICAL MEANING. `grep 'ForeignKey("users.id"' app/models/` is the way to
    check it is still complete after a schema change: a cascade that is not
    counted here is a cascade this guard silently permits. Deliberately NOT
    counted, because they are the account's own settings and nobody else's:
    doctor_profiles, doctor_availability, doctor_fees, user_consents,
    refresh_tokens, email_otps.
    """
    user_id = int(user_id)
    return {
        "scans": db.query(func.count(AIScan.id)).filter(AIScan.user_id == user_id).scalar() or 0,
        "appointments_as_patient": db.query(func.count(Appointment.id)).filter(
            Appointment.patient_id == user_id
        ).scalar() or 0,
        "appointments_as_doctor": db.query(func.count(Appointment.id)).filter(
            Appointment.doctor_id == user_id
        ).scalar() or 0,
        # An OPEN consultation request has no appointment row yet, so without
        # these two a patient mid-request looks unlinked -- and deleting them
        # would take the request and every candidate doctor's inbox entry with it.
        "requests_sent": db.query(func.count(AppointmentRequest.id)).filter(
            AppointmentRequest.patient_id == user_id
        ).scalar() or 0,
        "requests_received": db.query(func.count(AppointmentRequestDoctor.id)).filter(
            AppointmentRequestDoctor.doctor_id == user_id
        ).scalar() or 0,
        "reviews_written": db.query(func.count(DoctorRating.id)).filter(
            DoctorRating.patient_id == user_id
        ).scalar() or 0,
        "reviews_received": db.query(func.count(DoctorRating.id)).filter(
            DoctorRating.doctor_id == user_id
        ).scalar() or 0,
    }


def delete_user(db, target_id, actor_user_id, actor_role, ip=None, user_agent=None):
    """DELETE /admin/users/<id>. Returns (data, err).

    ONLY for an account with NO clinical history -- a duplicate signup, a typo,
    a test row. Every FK that matters here is `ON DELETE CASCADE`, so a bare
    `db.delete(user)` would silently take OTHER people's records with it: the
    appointments a doctor's patients booked, the reviews they wrote, the scans a
    doctor commented on. So the links are COUNTED first and a non-empty count is
    a 400 that names them and points at suspension.

    This is the same guarantee DELETE /admin/doctors/<id> makes; that route
    stays where it is (frozen path, and the doctor console links to it) and this
    one is its equivalent for every other role.
    """
    user, err = _manage_guard(db, target_id, actor_user_id, actor_role, allow_self=False)
    if err is not None:
        return None, err

    links = account_links(db, user.id)
    if any(links.values()):
        return None, (
            "Could not delete: this account has linked records that block deletion.",
            400,
            {
                **links,
                "alternative": "Suspend the account instead (Patients & accounts -> Suspend).",
            },
        )

    snapshot = {"id": user.id, "name": user.name, "email": user.email, "role": user.role}

    # The audit row must survive the delete, so it is written BEFORE it and
    # names the account in `detail` -- audit_logs.subject_user_id is
    # ON DELETE SET NULL, which is exactly why the identity is spelled out here.
    write_audit(
        db,
        actor_user_id=actor_user_id,
        subject_user_id=user.id,
        action="user.delete",
        target_type="user",
        target_id=user.id,
        detail=f"deleted {snapshot['role']} {snapshot['name']!r} <{snapshot['email']}>",
        ip=ip,
        user_agent=user_agent,
    )
    db.flush()

    db.delete(user)
    db.flush()

    logger.info("Admin %s deleted user %s (%s)", actor_user_id, snapshot["id"], snapshot["email"])
    return snapshot, None


__all__ = [
    "DEFAULT_PER_PAGE",
    "MAX_PER_PAGE",
    "ERR_ROOT_PROTECTED",
    "ERR_ROLE_NOT_ALLOWED",
    "ERR_ROLE_IMMUTABLE",
    "ERR_RANK_TOO_LOW",
    "ERR_EMAIL_TAKEN",
    "ERR_LICENSE_TAKEN",
    "ALLOWED_MANAGED_ROLES",
    "DOCTOR_PROFILE_FIELDS",
    "SCAN_IMAGE_ENDPOINT",
    "parse_pagination",
    "page_envelope",
    "parse_datetime_param",
    "parse_date_range",
    "parse_bool_param",
    "list_patients",
    "list_users",
    "list_scans",
    "list_appointments",
    "list_audit_log",
    "set_user_status",
    "write_audit",
    "generate_temp_password",
    "account_links",
    "create_user",
    "update_user",
    "reset_user_password",
    "delete_user",
]
