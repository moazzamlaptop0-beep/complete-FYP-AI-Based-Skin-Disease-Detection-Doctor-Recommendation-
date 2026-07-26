"""
Admin dashboard: stats, doctor verification, and the platform console.

===========================================================================
ROUTES IN THIS BLUEPRINT
Reference implementation: legacy/app_monolith.py at the line ranges given.
Full request/response contract: docs/api-contract.md
===========================================================================
ORIGINAL 4 (part of the frozen 39) -- PORTED, BEHAVIOUR UNCHANGED
  /admin/stats                           GET     ADMIN_STATS                get_admin_stats()        [monolith 1589-1607]
  /admin/doctors                         GET     USER_READ_ANY              list_doctors_for_admin() [monolith 1613-1661]
  /admin/doctors/<int:doctor_id>/verify  PUT     DOCTOR_VERIFY              verify_doctor()          [monolith 1664-1708]
  /admin/doctors/<int:doctor_id>         DELETE  DOCTOR_VERIFY+USER_READ_ANY delete_fake_doctor()    [monolith 1711-1738]

NEW, ADDITIVE (phase 2A -- nothing above this line changes)
  /admin/patients                        GET     USER_READ_ANY              list_patients_for_admin()
  /admin/users                           GET     USER_READ_ANY              list_users_for_admin()
  /admin/scans                           GET     SCAN_READ_ANY              list_scans_for_admin()
  /admin/appointments                    GET     APPOINTMENT_READ_ANY       list_appointments_for_admin()
  /admin/audit-log                       GET     ADMIN_AUDIT_READ           list_audit_log_for_admin()
  /admin/users/<int:user_id>/status      PATCH   USER_MANAGE_ANY            update_user_status()

NEW, ADDITIVE (account CRUD -- nothing above this line changes)
  /admin/users                           POST    USER_MANAGE_ANY            create_user_for_admin()
  /admin/users/<int:user_id>             PATCH   USER_MANAGE_ANY            update_user_for_admin()
  /admin/users/<int:user_id>/reset-password POST USER_MANAGE_ANY            reset_user_password_for_admin()
  /admin/users/<int:user_id>             DELETE  USER_MANAGE_ANY            delete_user_for_admin()

WHY THE CRUD BLOCK EXISTS
-------------------------
The console could see every account and suspend one, and that was the whole of
its write surface. Anything else -- a clinic phoning in a new doctor, a patient
who mistyped their email at signup, a doctor locked out because the OTP never
arrived -- required a psql prompt. The four routes above are that missing
surface, and every one of them writes an audit_logs row naming the admin.

They are deliberately NOT a generic user API:
  * `role` is Doctor or patient only, and is IMMUTABLE after creation. An Admin
    can never be minted over HTTP (unchanged from before -- admins are seeded).
  * the RANK RULE from rbac._apply_delegation applies: you may only manage an
    account strictly below your own role, so one admin cannot reset another
    admin's password.
  * is_root is refused everywhere, exactly as PATCH .../status refuses it.
  * DELETE refuses an account with clinical history and names the counts, the
    same promise DELETE /admin/doctors/<id> makes.
  * verification stays with PUT /admin/doctors/<id>/verify (which emails the
    doctor). Creation may set 'approved' inline because the admin is entering
    the licence at that moment; editing may not.
See app/services/admin_service.py for the rules in full.

---------------------------------------------------------------------------
THE NEW SURFACE -- RULES IT FOLLOWS (and the old 4 deliberately do not)
---------------------------------------------------------------------------
  * Every list returns the standard envelope with
        data: {items: [...], page, per_page, total, has_more}
    The old /admin/doctors returns a BARE ARRAY under `data`. That is frozen
    contract; do not "make it consistent".
  * Pagination is real SQL LIMIT/OFFSET plus a SELECT count(...). See
    app/services/admin_service.py -- all query logic lives there, the handlers
    below are thin.
  * is_root accounts are protected: PATCH .../status refuses them with 403, and
    every list emits the flag so the UI can lock the row. (rbac.py already
    refuses them as an act-as target.)
  * All six are ADMIN-only: each required permission lives solely in
    ADMIN_PERMS, so a Doctor token gets 403 on every one of them.

---------------------------------------------------------------------------
NON-NEGOTIABLES PRESERVED HERE
---------------------------------------------------------------------------
  * /admin/doctors filters by ?status IN PYTHON after loading every doctor,
    never in SQL -- so a doctor with no profile row counts as 'pending' and is
    matched by ?status=pending. An SQL-side filter would silently drop them.
  * /admin/doctors dates use strftime('%Y-%m-%d %H:%M'), NOT isoformat().
    13 keys, exactly as listed in the contract.
  * /admin/doctors/<id>/verify: `action` must be exactly 'approve' or 'reject'
    (400 otherwise). The success message interpolates the RESULTING status, so
    it reads 'Doctor approved' / 'Doctor rejected'. verified_at / verified_by /
    verification_note are all written, and verification_note takes
    data.get('note') VERBATIM -- including None, which clears a previous note.
  * DELETE /admin/doctors/<id> is a HARD delete relying on ORM cascades, and
    maps IntegrityError to 400 'Could not delete: doctor has linked records
    that block deletion.'
  * /admin/stats returns four INTEGER counters under the exact key names
    total_users / total_scans / total_doctors / pending_doctor_verifications.
  * There is still NO admin registration route. Admin rows are seeded directly.

---------------------------------------------------------------------------
AUTHORISATION MAPPING
---------------------------------------------------------------------------
  @admin_required -> @require_permission(<the admin-tier permission for that
                     action>, denied_message=ERR_ADMIN_ONLY)
  ADMIN_STATS, USER_READ_ANY and DOCTOR_VERIFY live ONLY in ADMIN_PERMS, so
  the effective audience is unchanged (Admin only) and the 401/403 strings are
  byte-identical to the monolith's.
===========================================================================
"""

import logging

from flask import Blueprint, request
from sqlalchemy.exc import IntegrityError

from app import models
from app.core.db import session_scope
from app.core.errors import ApiError
from app.core.rbac import ERR_ADMIN_ONLY, Permission, current_principal, require_permission
from app.core.responses import generate_response
from app.core.security import utcnow
from app.services import admin_service
from app.services.email_service import send_email
from app.services.serializers import admin_datetime

logger = logging.getLogger(__name__)

admin_bp = Blueprint("admin", __name__)


@admin_bp.route('/admin/stats', methods=['GET'])
@require_permission(Permission.ADMIN_STATS, denied_message=ERR_ADMIN_ONLY)
def get_admin_stats():
    try:
        with session_scope() as db:
            data = {
                "total_users": db.query(models.User).count(),
                "total_scans": db.query(models.AIScan).count(),
                "total_doctors": db.query(models.User).filter(models.User.role == 'Doctor').count(),
                "pending_doctor_verifications": db.query(models.DoctorProfile).filter(
                    models.DoctorProfile.verification_status == 'pending'
                ).count()
            }
            return generate_response(True, data=data, status_code=200)
    except Exception as e:
        logger.error(f"Admin Stats Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ==========================================
# 6C. ADMIN: DOCTOR LICENSE VERIFICATION
# ==========================================
@admin_bp.route('/admin/doctors', methods=['GET'])
@require_permission(Permission.USER_READ_ANY, denied_message=ERR_ADMIN_ONLY)
def list_doctors_for_admin():
    """
    Admin ke liye doctor list, license verify karne ke liye.
    Optional query param: ?status=pending / approved / rejected (default: sab doctors)
    """
    try:
        with session_scope() as db:
            status_filter = request.args.get('status')

            query = db.query(models.User).filter(models.User.role == 'Doctor')
            doctors = query.all()
            doc_ids = [d.id for d in doctors]

            profiles = {p.user_id: p for p in db.query(models.DoctorProfile).filter(
                models.DoctorProfile.user_id.in_(doc_ids)
            ).all()}

            result = []
            for doc in doctors:
                profile = profiles.get(doc.id)
                v_status = profile.verification_status if profile else 'pending'

                # Filter happens HERE, in Python, against the computed status --
                # profile-less doctors are 'pending' and must survive ?status=pending.
                if status_filter and v_status != status_filter:
                    continue

                result.append({
                    "id": doc.id,
                    "name": doc.name,
                    "email": doc.email,
                    "created_at": admin_datetime(doc.created_at),
                    "is_email_verified": doc.is_verified,
                    "license": profile.license if profile else None,
                    "specialty": profile.specialty if profile else None,
                    "hospital": profile.hospital if profile else None,
                    "city": profile.city if profile else None,
                    "phone": profile.phone if profile else None,
                    "verification_status": v_status,
                    "verification_note": profile.verification_note if profile else None,
                    "verified_at": admin_datetime(profile.verified_at) if profile else None
                })

            return generate_response(True, data=result, status_code=200)
    except Exception as e:
        logger.error(f"Admin List Doctors Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


@admin_bp.route('/admin/doctors/<int:doctor_id>/verify', methods=['PUT'])
@require_permission(Permission.DOCTOR_VERIFY, denied_message=ERR_ADMIN_ONLY)
def verify_doctor(doctor_id):
    """
    Admin license check karne ke baad doctor ko approve ya reject karta hai.
    Body: { "action": "approve" | "reject", "note": "optional reason" }
    """
    try:
        with session_scope() as db:
            data = request.get_json() or {}
            action = data.get('action')

            if action not in ('approve', 'reject'):
                return generate_response(False, error="action must be 'approve' or 'reject'", status_code=400)

            doctor = db.query(models.User).filter_by(id=doctor_id, role='Doctor').first()
            if not doctor:
                return generate_response(False, error="Doctor not found", status_code=404)

            profile = db.query(models.DoctorProfile).filter_by(user_id=doctor_id).first()
            if not profile:
                return generate_response(False, error="Doctor profile not found", status_code=404)

            profile.verification_status = 'approved' if action == 'approve' else 'rejected'
            profile.verification_note = data.get('note')
            profile.verified_at = utcnow()
            profile.verified_by = request.current_user.get('user_id')
            db.commit()

            if action == 'approve':
                send_email(doctor.email, "Account Verified - SkinCare",
                           f"Hi {doctor.name},\n\nYour PMDC license has been reviewed and approved. Your doctor account is now fully verified on SkinCare.")
            else:
                reason_text = f"\n\nReason: {data.get('note')}" if data.get('note') else ""
                send_email(doctor.email, "Account Verification Update - SkinCare",
                           f"Hi {doctor.name},\n\nWe were unable to verify your license details.{reason_text}\n\nPlease contact support if you believe this is a mistake.")

            logger.info(f"Doctor {doctor_id} verification set to '{profile.verification_status}' by admin {request.current_user.get('user_id')}")
            return generate_response(True, message=f"Doctor {profile.verification_status}", status_code=200)
    except Exception as e:
        logger.error(f"Verify Doctor Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


@admin_bp.route('/admin/doctors/<int:doctor_id>', methods=['DELETE'])
@require_permission(
    Permission.DOCTOR_VERIFY,
    Permission.USER_READ_ANY,
    denied_message=ERR_ADMIN_ONLY,
)
def delete_fake_doctor(doctor_id):
    """
    Admin ko fake/rejected doctor ka account permanently remove karne deta hai.
    """
    try:
        with session_scope() as db:
            doctor = db.query(models.User).filter_by(id=doctor_id, role='Doctor').first()
            if not doctor:
                return generate_response(False, error="Doctor not found", status_code=404)

            # THE `except IntegrityError` BELOW CAN NEVER FIRE FOR THE LINKAGE
            # THAT MATTERS. appointments.doctor_id and doctor_ratings.doctor_id
            # are both ON DELETE CASCADE, so `db.delete(doctor)` silently
            # destroys OTHER patients' booking history and their reviews -- rows
            # that belong to third parties, with no notification and no audit
            # trail -- while the admin UI promises "the server will refuse and
            # tell you so". Count first and make that promise true; suspending
            # the account (PATCH /admin/users/<id>/status) is the documented,
            # non-destructive alternative.
            linked_appointments = db.query(models.Appointment).filter(
                models.Appointment.doctor_id == doctor_id
            ).count()
            linked_ratings = db.query(models.DoctorRating).filter(
                models.DoctorRating.doctor_id == doctor_id
            ).count()
            if linked_appointments or linked_ratings:
                return generate_response(
                    False,
                    error="Could not delete: doctor has linked records that block deletion.",
                    data={
                        "appointments": linked_appointments,
                        "ratings": linked_ratings,
                        "alternative": "Suspend the account instead (Patients & users -> status).",
                    },
                    status_code=400,
                )

            doctor_email = doctor.email
            db.delete(doctor)
            db.commit()

            logger.info(f"Doctor account {doctor_id} ({doctor_email}) deleted by admin {request.current_user.get('user_id')}")
            return generate_response(True, message="Doctor account deleted", status_code=200)
    except IntegrityError as e:
        # session_scope() already rolled back before re-raising.
        logger.error(f"Delete Doctor Integrity Error: {e}")
        return generate_response(False, error="Could not delete: doctor has linked records that block deletion.", status_code=400)
    except Exception as e:
        logger.error(f"Delete Doctor Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ======================================================================
# ======================================================================
#  NEW, ADDITIVE ADMIN CONSOLE  --  nothing above this line changed.
# ======================================================================
# ======================================================================
#
# The four routes above are the whole admin surface the monolith shipped: an
# admin could count things and vet doctors, and that was it. They could not see
# a patient, a scan, an appointment, or their own delegation history. This block
# is the read/manage surface that makes "admin can perform all actions of doc
# and user" true in practice rather than only in the permission table.
#
# All query and serialisation logic is in app/services/admin_service.py, so the
# handlers here stay diffable at a glance: authorise, parse, delegate, envelope.
# ======================================================================


def _paged_response(loader, label):
    """Shared body for the five list endpoints.

    `ApiError` (raised by the service for a bad filter) is converted to its own
    400 envelope; anything else becomes the same opaque 500 the ported routes
    return, so a stack trace never reaches the client.
    """
    try:
        with session_scope() as db:
            data = loader(db, request.args)
            return generate_response(True, data=data, status_code=200)
    except ApiError as exc:
        return exc.to_response()
    except Exception as e:
        logger.error(f"Admin {label} Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


def _acting_user_id():
    """The HUMAN behind the request, not the delegated identity.

    Under X-Act-As-User-Id, `g.actor` is the target user while `g.principal` is
    the admin who is really driving. An audit row that named the target would be
    worse than useless. (Act-as cannot actually reach these routes -- the
    delegated permission set is an intersection and loses every admin
    permission -- but the audit row must be right by construction, not by luck.)
    """
    principal = current_principal()
    if principal is not None:
        return principal.id
    return (getattr(request, "current_user", None) or {}).get("user_id")


# ----------------------------------------------------------------------
# GET /admin/patients
# ----------------------------------------------------------------------
@admin_bp.route('/admin/patients', methods=['GET'])
@require_permission(Permission.USER_READ_ANY, denied_message=ERR_ADMIN_ONLY)
def list_patients_for_admin():
    """Paginated patient roster.

    Query: page, per_page, q (name/email), is_active
    Item:  id, name, email, is_active, created_at, scan_count, appointment_count

    scan_count / appointment_count come from two GROUP BY queries over the
    CURRENT PAGE's ids -- never `len(user.scans)` per row.
    """
    return _paged_response(admin_service.list_patients, "Patients")


# ----------------------------------------------------------------------
# GET /admin/users
# ----------------------------------------------------------------------
@admin_bp.route('/admin/users', methods=['GET'])
@require_permission(Permission.USER_READ_ANY, denied_message=ERR_ADMIN_ONLY)
def list_users_for_admin():
    """Every account, every role, with `is_root` so the UI can mark and lock
    protected rows.

    Query: page, per_page, q, role (Admin|Doctor|AI User, aliases accepted),
           is_active, is_root, is_verified
    """
    return _paged_response(admin_service.list_users, "Users")


# ----------------------------------------------------------------------
# GET /admin/scans
# ----------------------------------------------------------------------
@admin_bp.route('/admin/scans', methods=['GET'])
@require_permission(Permission.SCAN_READ_ANY, denied_message=ERR_ADMIN_ONLY)
def list_scans_for_admin():
    """Every scan on the platform.

    Query: page, per_page, severity, status, review_status, patient (id or
           name/email), doctor (id or name/email), date_from, date_to

    Each item carries BOTH `image_url` (the legacy '/'-prefixed static path,
    unchanged) AND `image_endpoint` (`/api/scans/<id>/image`, the authenticated
    route). image_endpoint is null once the patient has deleted the photo.
    """
    return _paged_response(admin_service.list_scans, "Scans")


# ----------------------------------------------------------------------
# GET /admin/appointments
# ----------------------------------------------------------------------
@admin_bp.route('/admin/appointments', methods=['GET'])
@require_permission(Permission.APPOINTMENT_READ_ANY, denied_message=ERR_ADMIN_ONLY)
def list_appointments_for_admin():
    """Every appointment.

    Query: page, per_page, status, doctor, patient, date_from, date_to,
           date_field (created|slot, default created)

    `appointment_date` is free text ("2026-07-25" OR "Mon, Jan 26") so it is not
    range-filterable; date_field=slot uses the typed `slot_start` shadow column.
    """
    return _paged_response(admin_service.list_appointments, "Appointments")


# ----------------------------------------------------------------------
# GET /admin/audit-log
# ----------------------------------------------------------------------
@admin_bp.route('/admin/audit-log', methods=['GET'])
@require_permission(Permission.ADMIN_AUDIT_READ, denied_message=ERR_ADMIN_ONLY)
def list_audit_log_for_admin():
    """The accountability record for privileged action.

    Reads the same `audit_logs` table that require_permission's act-as branch
    writes on every X-Act-As-User-Id request, so every impersonation an admin
    performs is visible here alongside the suspensions they issue.

    Query: page, per_page, actor (id or name/email), subject, action (exact),
           action_prefix, target_type, date_from, date_to
    """
    return _paged_response(admin_service.list_audit_log, "Audit Log")


# ----------------------------------------------------------------------
# PATCH /admin/users/<id>/status
# ----------------------------------------------------------------------
@admin_bp.route('/admin/users/<int:user_id>/status', methods=['PATCH'])
@require_permission(
    Permission.USER_MANAGE_ANY,
    denied_message=ERR_ADMIN_ONLY,
)
def update_user_status(user_id):
    """Suspend / reactivate an account.

    Body: {"is_active": bool, "reason": "optional free text"}

    This is the soft alternative to DELETE /admin/doctors/<id>: a user with
    clinical history attached must never be hard-deleted just to stop them
    logging in.

    REFUSALS
      * target is_root      -> 403 (root is unkillable, by design)
      * deactivating self   -> 400 (an admin cannot lock themselves out)
      * unknown user        -> 404
      * is_active missing   -> 400

    Both permissions required here are ADMIN-only; the pair mirrors
    DELETE /admin/doctors/<id>, which is the closest existing precedent for a
    destructive account action. See `issues` -- a dedicated `user.manage.any`
    permission belongs in rbac.py, but that file is owned elsewhere this phase.

    Always writes an `audit_logs` row (action `user.status.change`).
    """
    try:
        payload = request.get_json(silent=True) or {}

        if 'is_active' not in payload:
            return generate_response(False, error="is_active is required and must be a boolean", status_code=400)

        raw = payload.get('is_active')
        if isinstance(raw, bool):
            is_active = raw
        elif str(raw).strip().lower() in ("true", "1", "yes"):
            is_active = True
        elif str(raw).strip().lower() in ("false", "0", "no"):
            is_active = False
        else:
            return generate_response(False, error="is_active is required and must be a boolean", status_code=400)

        with session_scope() as db:
            data, err = admin_service.set_user_status(
                db,
                target_id=user_id,
                is_active=is_active,
                reason=payload.get('reason'),
                actor_user_id=_acting_user_id(),
                ip=request.headers.get("X-Forwarded-For", request.remote_addr),
                user_agent=request.headers.get("User-Agent"),
            )
            if err is not None:
                error_text, status_code = err
                return generate_response(False, error=error_text, status_code=status_code)

            logger.info(
                "User %s set is_active=%s by admin %s", user_id, is_active, _acting_user_id()
            )
            return generate_response(
                True,
                message="User reactivated" if is_active else "User suspended",
                data=data,
                status_code=200,
            )
    except ApiError as exc:
        return exc.to_response()
    except Exception as e:
        logger.error(f"Admin Set User Status Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ======================================================================
# ======================================================================
#  ACCOUNT CRUD  --  create / edit / reset a password / delete.
# ======================================================================
# ======================================================================


def _acting_role():
    """The role of the HUMAN behind the request, for the rank rule.

    Same reasoning as _acting_user_id(): under X-Act-As-User-Id `g.actor` wears
    the target's role, and using that here would let a delegated request claim a
    rank it does not have. (It cannot reach these routes -- the delegated
    permission set is an intersection and loses USER_MANAGE_ANY -- but the check
    must be right by construction.)
    """
    principal = current_principal()
    if principal is not None:
        return principal.role.value
    return (getattr(request, "current_user", None) or {}).get("role")


def _request_meta():
    return (
        request.headers.get("X-Forwarded-For", request.remote_addr),
        request.headers.get("User-Agent"),
    )


def _service_error(err):
    """Turn a service `(message, status[, data])` tuple into a response.

    The optional third element is the extra payload a refusal needs to be
    actionable -- the linked-record counts behind a blocked delete, which the UI
    shows instead of a bare "could not delete".
    """
    if len(err) == 3:
        error_text, status_code, extra = err
        return generate_response(False, error=error_text, data=extra, status_code=status_code)
    error_text, status_code = err
    return generate_response(False, error=error_text, status_code=status_code)


def _mutation(label, run, success_message, success_status=200, after_commit=None):
    """Shared body for the four CRUD handlers: run inside one transaction, map a
    service refusal to its own envelope, and never leak a stack trace.

    `run(db)` returns the same `(data, err)` pair every admin_service mutator
    does. IntegrityError is caught separately because a UNIQUE race (two admins
    adding the same email at once) is a 400 the caller can act on, not a 500.

    `after_commit(data)` runs OUTSIDE the transaction, once the write is durable.
    That is where the emails go: sending "here is your new password" and then
    failing to commit would hand someone a credential for an account that does
    not exist. `data` is a plain dict of primitives, so it outlives the session.
    """
    try:
        with session_scope() as db:
            data, err = run(db)
            if err is not None:
                # session_scope() commits on a clean exit, so a refusal must not
                # leave a half-applied write behind. Explicit rollback here; the
                # subsequent commit is then a no-op.
                db.rollback()
                return _service_error(err)

        if after_commit is not None:
            after_commit(data)
        return generate_response(True, message=success_message, data=data,
                                 status_code=success_status)
    except IntegrityError as e:
        logger.warning("Admin %s integrity error: %s", label, e)
        return generate_response(
            False,
            error="That email address or licence number is already in use.",
            status_code=400,
        )
    except ApiError as exc:
        return exc.to_response()
    except Exception as e:
        logger.error(f"Admin {label} Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ----------------------------------------------------------------------
# POST /admin/users
# ----------------------------------------------------------------------
@admin_bp.route('/admin/users', methods=['POST'])
@require_permission(Permission.USER_MANAGE_ANY, denied_message=ERR_ADMIN_ONLY)
def create_user_for_admin():
    """Provision a doctor or a patient account.

    Body:
      {name, email, role: 'Doctor'|'AI User', password?, is_verified?,
       doctor: {license, specialty, hospital, city, phone, experience,
                latitude, longitude, verification_status?, verification_note?}}

    `password` is OPTIONAL. Omit it and the server generates a temporary one and
    returns it as `data.temporary_password` -- once, in this response only. It is
    never stored in plaintext and never logged, so an admin who loses it has to
    reset rather than look it up, which is the correct trade.

    `is_verified` defaults to TRUE and no OTP is sent: an admin entering someone
    else's details IS the verification, and the usual reason for doing it is that
    the person cannot receive a code. Send `false` to make them prove the inbox.

    201 on success. 400 on a bad field or a duplicate email/licence, 403 on an
    Admin role request or a target that is not below your rank.
    """
    payload = request.get_json(silent=True) or {}
    ip, user_agent = _request_meta()
    actor_id = _acting_user_id()
    actor_role = _acting_role()

    return _mutation(
        "Create User",
        lambda db: admin_service.create_user(
            db, payload,
            actor_user_id=actor_id, actor_role=actor_role,
            ip=ip, user_agent=user_agent,
        ),
        "Account created",
        success_status=201,
        after_commit=_notify_new_account,
    )


def _notify_new_account(data):
    """Best-effort welcome email. NEVER fails the request.

    Deliberately different from /auth/register, which rolls the whole signup back
    when the OTP email cannot be sent. There, the email IS the flow -- without
    the code the account is unusable. Here the account is already usable and the
    admin is holding the temporary password on screen, so a dead SMTP server must
    not throw away a record they just typed in.
    """
    temporary = (data or {}).get("temporary_password")
    email = (data or {}).get("email")
    if not email:
        return
    try:
        lines = [
            f"Hi {(data.get('name') or 'there')},",
            "",
            "An administrator has created a SkinCare account for you.",
            f"Sign in with: {email}",
        ]
        if temporary:
            lines += [
                f"Temporary password: {temporary}",
                "",
                "Please change it after your first sign-in.",
            ]
        else:
            lines += ["", "Use the password the administrator gave you."]
        send_email(email, "Your SkinCare account", "\n".join(lines))
    except Exception as exc:  # pragma: no cover - transport failure
        logger.warning("Welcome email failed for admin-created account %s: %s", email, exc)


# ----------------------------------------------------------------------
# PATCH /admin/users/<id>
# ----------------------------------------------------------------------
@admin_bp.route('/admin/users/<int:user_id>', methods=['PATCH'])
@require_permission(Permission.USER_MANAGE_ANY, denied_message=ERR_ADMIN_ONLY)
def update_user_for_admin(user_id):
    """Edit an account. PARTIAL -- an absent key is left alone.

    Body: {name?, email?, is_verified?, doctor?: {...}}

    `role` is refused with a 400 rather than ignored: an edit form that silently
    drops the field an admin filled in is worse than one that says no. Changing a
    Doctor's licence details is done here; approving that licence is still
    PUT /admin/doctors/<id>/verify, which is the route that emails them.

    REFUSALS
      unknown user            -> 404
      target is_root          -> 403
      target not below you    -> 403  (editing YOURSELF is allowed)
      duplicate email/licence -> 400
    """
    payload = request.get_json(silent=True) or {}
    ip, user_agent = _request_meta()
    actor_id = _acting_user_id()
    actor_role = _acting_role()

    return _mutation(
        "Update User",
        lambda db: admin_service.update_user(
            db, user_id, payload,
            actor_user_id=actor_id, actor_role=actor_role,
            ip=ip, user_agent=user_agent,
        ),
        "Account updated",
    )


# ----------------------------------------------------------------------
# POST /admin/users/<id>/reset-password
# ----------------------------------------------------------------------
@admin_bp.route('/admin/users/<int:user_id>/reset-password', methods=['POST'])
@require_permission(Permission.USER_MANAGE_ANY, denied_message=ERR_ADMIN_ONLY)
def reset_user_password_for_admin(user_id):
    """Force a new password onto an account.

    Body: {new_password?}  -- omit it to have one generated and returned as
    `data.temporary_password`.

    EVERY SESSION THE TARGET HOLDS DIES: token_version is bumped (which
    invalidates their access tokens) and their refresh rows are revoked. An admin
    resetting a password because an account is compromised has to actually evict
    whoever is in it, or the reset is theatre.

    Does NOT mark the email verified -- see the service docstring for why.

    REFUSALS
      unknown user         -> 404
      target is_root       -> 403
      target is YOU        -> 400  (use /auth/change-password; this would revoke
                                    the session you are holding)
      target not below you -> 403
      weak password        -> 400  (the same policy /auth/register applies)
    """
    payload = request.get_json(silent=True) or {}
    ip, user_agent = _request_meta()
    actor_id = _acting_user_id()
    actor_role = _acting_role()

    return _mutation(
        "Reset Password",
        lambda db: admin_service.reset_user_password(
            db, user_id, payload.get("new_password"),
            actor_user_id=actor_id, actor_role=actor_role,
            ip=ip, user_agent=user_agent,
        ),
        "Password reset",
        after_commit=_notify_password_reset,
    )


def _notify_password_reset(data):
    """Best-effort "an admin reset your password" email. Never fails the request.

    Sent even when the admin typed the password themselves (and so has to pass it
    on out of band), because the security-relevant fact for the account holder is
    that every one of their sessions was just ended by somebody else.
    """
    email = (data or {}).get("email")
    if not email:
        return
    temporary = (data or {}).get("temporary_password")
    try:
        lines = [
            f"Hi {(data.get('name') or 'there')},",
            "",
            "An administrator has reset the password on your SkinCare account.",
            "You have been signed out everywhere.",
        ]
        if temporary:
            lines += ["", f"Temporary password: {temporary}",
                      "Please change it after your next sign-in."]
        else:
            lines += ["", "The administrator will give you the new password."]
        lines += ["", "If you did not expect this, contact support immediately."]
        send_email(email, "Your SkinCare password was reset", "\n".join(lines))
    except Exception as exc:  # pragma: no cover - transport failure
        logger.warning("Password-reset notice failed for %s: %s", email, exc)


# ----------------------------------------------------------------------
# DELETE /admin/users/<id>
# ----------------------------------------------------------------------
@admin_bp.route('/admin/users/<int:user_id>', methods=['DELETE'])
@require_permission(Permission.USER_MANAGE_ANY, denied_message=ERR_ADMIN_ONLY)
def delete_user_for_admin(user_id):
    """Hard-delete an account that has NO clinical history.

    Every FK pointing at `users.id` from a clinical table is ON DELETE CASCADE,
    so an unguarded delete would take third parties' records with it -- the
    appointments this doctor's patients booked, the reviews they wrote. The links
    are counted first and any non-zero count is a 400 carrying those counts under
    `data`, plus the non-destructive alternative.

    REFUSALS
      unknown user         -> 404
      target is_root       -> 403
      target is YOU        -> 400
      target not below you -> 403
      has linked records   -> 400 + data{scans, appointments_*, reviews_*}
    """
    ip, user_agent = _request_meta()
    actor_id = _acting_user_id()
    actor_role = _acting_role()

    return _mutation(
        "Delete User",
        lambda db: admin_service.delete_user(
            db, user_id,
            actor_user_id=actor_id, actor_role=actor_role,
            ip=ip, user_agent=user_agent,
        ),
        "Account deleted",
    )
