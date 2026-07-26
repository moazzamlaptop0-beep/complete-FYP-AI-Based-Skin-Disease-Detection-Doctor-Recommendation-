"""
Multi-doctor, multi-slot appointment requests -- the core of the scan redesign.

===========================================================================
ROUTES (ALL NEW / ADDITIVE -- none of the 39 contract URLs is touched)
===========================================================================
  POST   /api/appointment-requests                  create_appointment_request()
  GET    /api/appointment-requests                  list_my_appointment_requests()
  GET    /api/appointment-requests/<id>             get_appointment_request()
  PATCH  /api/appointment-requests/<id>             update_appointment_request()
  POST   /api/appointment-requests/<id>/cancel      cancel_appointment_request()
  GET    /api/doctor/appointment-requests           doctor_request_inbox()
  POST   /api/appointment-requests/<id>/accept      accept_appointment_request()
  POST   /api/appointment-requests/<id>/decline     decline_appointment_request()
  POST   /api/triage-preview                        triage_preview()
  GET    /api/slots/multi                           multi_doctor_slots()
===========================================================================

WHAT THIS REPLACES
------------------
Today a patient can only reach booking AFTER /send_report has pinned exactly ONE
doctor onto the scan, and /api/book-slot then takes one doctor + one date + one
time. If the slot is taken, the ONLY way through is to have a server-verified
CRITICAL/URGENT scan -- i.e. you must have an emergency before you are allowed
to book. That ordering is inverted here:

  * a request carries 1-3 doctors and 1-5 preferred times, chosen UP FRONT;
  * the questionnaire is optional and only ever escalates;
  * severity is computed but is NOT a gate -- any patient can request any slot;
  * express (emergency) is a LANE: it shortens expires_at to 4h, uses the
    existing urgent email template, and, only if the chosen slot is already
    taken, falls through to the EXISTING Pending-Conflict machinery so the
    existing SLA resolver keeps owning it.

ENVELOPE
--------
Every route here returns the standard {success, message?, error?, data?}
envelope, INCLUDING /api/slots/multi. The bare-array quirk of /api/slots/<id>
is a legacy contract obligation, not a pattern -- it is deliberately NOT copied
into a new endpoint.

SESSION DISCIPLINE
------------------
Each handler commits EXPLICITLY before sending any email, mirroring
/send_report. session_scope()'s own commit on exit is then a no-op. SMTP has a
20 s timeout and there can be three recipients; holding a write transaction (and
on /accept, a SELECT ... FOR UPDATE row lock) open across that would serialise
every other doctor's accept behind a mail server.
"""

import datetime
import json
import logging

from flask import Blueprint, request

from app import models
from app.core.db import session_scope
from app.core.rbac import (
    ERR_DOCTOR_ONLY,
    ERR_PATIENT_ONLY,
    Permission,
    current_actor,
    require_permission,
    resolve_actor,
)
from app.core.responses import generate_response
from app.models import enums
from app.models.enums import REQUEST_OPEN, RESPONSE_PENDING
from app.services import request_matching as matching
from app.services.email_service import send_email
from app.services.scheduling_service import MAX_MULTI_DOCTORS, slots_for_doctors
from app.services.triage_service import TriageService

logger = logging.getLogger(__name__)

appointment_requests_bp = Blueprint("appointment_requests", __name__)

# user_consents.consent_type written when consent_share_scan is true. The row is
# per-object: target_ref = 'scan:<id>', so "yes, show THIS photo to THESE
# doctors" is an auditable grant rather than a boolean nobody can date.
# The literal lives in app/models/enums.py so a query by constant and a query by
# string can never disagree.
CONSENT_TYPE_SCAN_SHARE = enums.CONSENT_SHARE_SCAN
CONSENT_SOURCE_STEPPER = "stepper"

DEFAULT_PAGE_SIZE = 10
MAX_PAGE_SIZE = 50


# ======================================================================
# SMALL HELPERS
# ======================================================================
def _as_int(value, default=None):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _pagination():
    page = max(1, _as_int(request.args.get("page"), 1) or 1)
    limit = _as_int(request.args.get("limit"), DEFAULT_PAGE_SIZE) or DEFAULT_PAGE_SIZE
    limit = max(1, min(limit, MAX_PAGE_SIZE))
    return page, limit


def _paged(items, page, limit, total):
    return {
        "items": items,
        "page": page,
        "limit": limit,
        "total": total,
        "pages": (total + limit - 1) // limit if limit else 0,
    }


def _error(error_tuple):
    _code, status, message = error_tuple
    return generate_response(False, error=message, status_code=status)


def _record_scan_share_consent(db, patient_id, scan_id, doctor_ids):
    """Append the per-scan sharing grant.

    Deliberately APPEND-ONLY and target-scoped, matching
    app/services/consent_service.py's model: a grant is evidence about a moment
    in time, so a second request for the same scan writes a SECOND row rather
    than editing the first.
    """
    from app.services.auth_service import request_ip, request_user_agent

    db.add(models.UserConsent(
        user_id=patient_id,
        consent_type=CONSENT_TYPE_SCAN_SHARE,
        version="1",
        granted=True,
        granted_at=matching.utcnow(),
        revoked_at=None,
        ip=request_ip(),
        user_agent=request_user_agent(),
        source=CONSENT_SOURCE_STEPPER,
        target_ref=f"scan:{scan_id}",
    ))
    logger.info(
        "scan_share consent recorded: patient=%s scan=%s doctors=%s",
        patient_id, scan_id, doctor_ids,
    )


# ======================================================================
# 1. CREATE  -- POST /api/appointment-requests
# ======================================================================
@appointment_requests_bp.route('/api/appointment-requests', methods=['POST'])
@require_permission(Permission.APPOINTMENT_BOOK, denied_message=ERR_PATIENT_ONLY)
def create_appointment_request():
    data = request.get_json(silent=True)
    if not data:
        return generate_response(False, error="Invalid JSON payload", status_code=400)

    actor = current_actor()
    patient_id = _as_int(data.get("patient_id"), actor.id if actor else None)
    if patient_id is None:
        return generate_response(False, error="Patient ID required", status_code=400)

    # An admin acting for a patient goes through resolve_actor exactly like every
    # other ownership check in this codebase -- no bespoke role test here.
    if not resolve_actor(patient_id,
                         own_perm=Permission.APPOINTMENT_BOOK,
                         any_perm=Permission.APPOINTMENT_MANAGE_ANY):
        return generate_response(False, error="Unauthorized ID mismatch", status_code=403)

    raw_doctor_ids = data.get("doctor_ids")
    if not isinstance(raw_doctor_ids, list) or not raw_doctor_ids:
        return generate_response(False, error="Select at least one doctor.", status_code=400)
    if len(raw_doctor_ids) > matching.MAX_DOCTORS_PER_REQUEST:
        return generate_response(
            False,
            error=f"You can invite at most {matching.MAX_DOCTORS_PER_REQUEST} doctors.",
            status_code=400,
        )

    answers = data.get("answers")
    if answers is not None and not isinstance(answers, dict):
        return generate_response(False, error="answers must be an object or null.", status_code=400)

    patient_note = (data.get("patient_note") or "").strip() or None
    express_requested = bool(data.get("express"))
    consent_share_scan = bool(data.get("consent_share_scan"))
    scan_id = _as_int(data.get("scan_id"))

    try:
        with session_scope() as db:
            # ---- doctors must be APPROVED --------------------------------
            approved, rejected = matching.approved_doctor_ids(db, raw_doctor_ids)
            if rejected:
                return generate_response(
                    False,
                    error="One or more selected doctors are not available for booking "
                          "(unknown, inactive, or licence not approved).",
                    data={"rejected_doctor_ids": rejected},
                    status_code=400,
                )
            if not approved:
                return generate_response(False, error="Select at least one doctor.", status_code=400)
            if patient_id in approved:
                return generate_response(
                    False, error="You cannot request an appointment with yourself.", status_code=400
                )

            # ---- preferred slots -----------------------------------------
            slots, slot_error = matching.normalize_slots(data.get("preferred_slots"), set(approved))
            if slot_error:
                return generate_response(False, error=slot_error, status_code=400)

            # ---- the scan (optional) -------------------------------------
            scan = None
            if scan_id:
                scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
                if scan is None:
                    return generate_response(False, error="Scan not found", status_code=404)
                if not resolve_actor(scan.user_id,
                                     own_perm=Permission.SCAN_SEND_REPORT,
                                     any_perm=Permission.SCAN_READ_ANY):
                    return generate_response(
                        False, error="Unauthorized to attach this scan", status_code=403
                    )
                if scan.user_id != patient_id:
                    return generate_response(
                        False, error="That scan belongs to a different patient.", status_code=400
                    )

            # ---- triage ---------------------------------------------------
            # Confidence is normalised INSIDE triage_for_scan, which is the fix
            # for the 0-100 vs 0-1 mismatch that made the de-escalation guard
            # unreachable and persisted "8734% confidence" strings.
            if scan is not None:
                triage = TriageService.triage_for_scan(scan, answers)
                disease_name = scan.prediction_result or "Skin Condition"
            else:
                disease_name = (data.get("disease") or "Skin Condition")
                triage = TriageService.triage(disease_name, data.get("confidence"), answers)

            severity = triage["severity"]
            express = TriageService.is_express(severity, express_requested)
            ttl_hours = TriageService.ttl_hours(severity, express_requested)
            now = matching.utcnow()

            req = models.AppointmentRequest(
                patient_id=patient_id,
                scan_id=scan.id if scan is not None else None,
                status=REQUEST_OPEN,
                priority=severity,
                express=express,
                patient_note=patient_note,
                severity_snapshot=severity,
                triage_score=triage["triage_score"],
                triage_reasons=json.dumps(triage["triage_reasons"]),
                consent_share_scan=consent_share_scan,
                expires_at=now + datetime.timedelta(hours=ttl_hours),
                created_at=now,
            )
            db.add(req)
            db.flush()

            for rank, doctor_id in enumerate(approved):
                db.add(models.AppointmentRequestDoctor(
                    request_id=req.id,
                    doctor_id=doctor_id,
                    preference_rank=rank,
                    response=RESPONSE_PENDING,
                ))

            for slot in slots:
                db.add(models.AppointmentRequestSlot(
                    request_id=req.id,
                    doctor_id=slot["doctor_id"],
                    slot_date=slot["slot_date"],
                    slot_time=slot["slot_time"],
                    slot_start=slot["slot_start"],
                    rank=slot["rank"],
                ))

            # ---- persist onto the scan, the same way /send_report does -----
            # ...EXCEPT scan.doctor_id, which stays NULL until a doctor accepts.
            # That single change is what makes multi-doctor possible at all:
            # ai_scans.doctor_id is a single FK, so assigning it at request time
            # is precisely the constraint the redesign removes.
            if scan is not None:
                if answers:
                    scan.patient_questionnaire = json.dumps(answers)
                if patient_note:
                    scan.patient_notes = patient_note

                # A SECOND REQUEST ON THE SAME SCAN MUST NOT REWRITE CLINICAL
                # STATE A HUMAN ALREADY SET. Re-running triage over a scan a
                # doctor has escalated by hand silently reverts that escalation
                # (TriageService returns ROUTINE for e.g. eczema@88% or a
                # low-confidence melanoma) while overridden_by/override_reason
                # keep claiming an override that no longer matches the stored
                # value -- and severity_level is what the urgent-booking gate and
                # the SLA winner-picker read. Likewise a Reviewed scan must not
                # drop back to "Pending" and re-enter review queues.
                if scan.overridden_by is None:
                    scan.severity_level = severity
                    scan.triage_score = triage["triage_score"]
                    scan.triage_reasons = json.dumps(triage["triage_reasons"])
                if scan.status != "Reviewed":
                    scan.status = "Pending"

                if consent_share_scan:
                    _record_scan_share_consent(db, patient_id, scan.id, approved)

            db.commit()

            patient = db.query(models.User).filter(models.User.id == patient_id).first()
            patient_name = patient.name if patient else "Guest Patient"
            matching.notify_invited_doctors(db, req, approved, patient_name, disease_name)

            payload = matching.serialize_request(db, req)
            logger.info(
                "Appointment request %s created: patient=%s doctors=%s slots=%s severity=%s express=%s",
                req.id, patient_id, approved, len(slots), severity, express,
            )
            return generate_response(
                True, message="Appointment request sent.", data=payload, status_code=201
            )
    except Exception as exc:
        logger.error("Create Appointment Request Error: %s", exc, exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ======================================================================
# 2. LIST (patient's own)  -- GET /api/appointment-requests
# ======================================================================
@appointment_requests_bp.route('/api/appointment-requests', methods=['GET'])
@require_permission(Permission.APPOINTMENT_READ_OWN, denied_message=ERR_PATIENT_ONLY)
def list_my_appointment_requests():
    actor = current_actor()
    patient_id = _as_int(request.args.get("patient_id"), actor.id if actor else None)
    if patient_id is None:
        return generate_response(False, error="Patient ID required", status_code=400)

    if not resolve_actor(patient_id,
                         own_perm=Permission.APPOINTMENT_READ_OWN,
                         any_perm=Permission.APPOINTMENT_READ_ANY):
        return generate_response(False, error="Unauthorized", status_code=403)

    page, limit = _pagination()
    status_filter = request.args.get("status")

    try:
        with session_scope() as db:
            query = db.query(models.AppointmentRequest).filter(
                models.AppointmentRequest.patient_id == patient_id
            )
            if status_filter:
                query = query.filter(models.AppointmentRequest.status == status_filter)

            total = query.count()
            rows = query.order_by(models.AppointmentRequest.id.desc()) \
                        .offset((page - 1) * limit).limit(limit).all()

            items = [matching.serialize_request(db, row) for row in rows]
            return generate_response(True, data=_paged(items, page, limit, total), status_code=200)
    except Exception as exc:
        logger.error("List Appointment Requests Error: %s", exc, exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ======================================================================
# 3. DETAIL  -- GET /api/appointment-requests/<id>
# ======================================================================
@appointment_requests_bp.route('/api/appointment-requests/<int:request_id>', methods=['GET'])
@require_permission(Permission.APPOINTMENT_READ_OWN)
def get_appointment_request(request_id):
    actor = current_actor()
    try:
        with session_scope() as db:
            req = db.query(models.AppointmentRequest).filter(
                models.AppointmentRequest.id == request_id
            ).first()
            if req is None:
                return _error(matching.ERR_NOT_FOUND)

            # Readable by the patient who created it, by any doctor who was
            # actually invited, or by a holder of appointment.read.any.
            allowed = resolve_actor(req.patient_id,
                                    own_perm=Permission.APPOINTMENT_READ_OWN,
                                    any_perm=Permission.APPOINTMENT_READ_ANY)
            viewer_doctor_id = None
            if not allowed and actor is not None:
                invited = db.query(models.AppointmentRequestDoctor).filter(
                    models.AppointmentRequestDoctor.request_id == req.id,
                    models.AppointmentRequestDoctor.doctor_id == actor.id,
                ).first()
                if invited is not None:
                    allowed = True
                    viewer_doctor_id = actor.id
            elif actor is not None:
                viewer_doctor_id = actor.id

            if not allowed:
                return generate_response(False, error="Unauthorized", status_code=403)

            payload = matching.serialize_request(db, req, viewer_doctor_id=viewer_doctor_id)
            return generate_response(True, data=payload, status_code=200)
    except Exception as exc:
        logger.error("Get Appointment Request Error: %s", exc, exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ======================================================================
# 4. PATIENT WITHDRAWS  -- POST /api/appointment-requests/<id>/cancel
# ======================================================================
@appointment_requests_bp.route('/api/appointment-requests/<int:request_id>/cancel', methods=['POST'])
@require_permission(Permission.APPOINTMENT_MANAGE_OWN, denied_message=ERR_PATIENT_ONLY)
def cancel_appointment_request(request_id):
    data = request.get_json(silent=True) or {}
    reason = (data.get("reason") or "").strip() or None

    try:
        with session_scope() as db:
            req = db.query(models.AppointmentRequest).filter(
                models.AppointmentRequest.id == request_id
            ).first()
            if req is None:
                return _error(matching.ERR_NOT_FOUND)

            if not resolve_actor(req.patient_id,
                                 own_perm=Permission.APPOINTMENT_MANAGE_OWN,
                                 any_perm=Permission.APPOINTMENT_MANAGE_ANY):
                return generate_response(False, error="Unauthorized", status_code=403)

            result, error = matching.cancel_request(db, request_id, reason=reason)
            if error is not None:
                return _error(error)

            db.commit()
            payload = matching.serialize_request(db, req)
            logger.info("Appointment request %s withdrawn by patient %s", request_id, req.patient_id)
            return generate_response(
                True,
                message="Appointment request withdrawn.",
                data={**payload, "withdrawn_doctor_ids": result["withdrawn_doctor_ids"]},
                status_code=200,
            )
    except Exception as exc:
        logger.error("Cancel Appointment Request Error: %s", exc, exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ======================================================================
# 4b. PATIENT EDITS  -- PATCH /api/appointment-requests/<id>
# ======================================================================
@appointment_requests_bp.route('/api/appointment-requests/<int:request_id>', methods=['PATCH'])
@require_permission(Permission.APPOINTMENT_MANAGE_OWN, denied_message=ERR_PATIENT_ONLY)
def update_appointment_request(request_id):
    """Change a request that nobody has answered yet.

    PARTIAL, like PATCH /admin/users/<id>: a key you do not send is left alone,
    and only the keys that actually differ count as a change. `preferred_slots`
    REPLACES the whole list (rank is an ordering of the entire list, not of one
    row). The invited doctors are deliberately NOT editable -- see
    request_matching.update_request for why.

    Body `{preferred_slots?[1..5], patient_note?, express?, consent_share_scan?,
    answers?|null}`. 409 unless the request is still Open and unexpired.
    """
    data = request.get_json(silent=True)
    if data is None:
        return generate_response(False, error="Invalid JSON payload", status_code=400)

    answers = data.get("answers")
    if "answers" in data and answers is not None and not isinstance(answers, dict):
        return generate_response(False, error="answers must be an object or null.", status_code=400)

    try:
        with session_scope() as db:
            req = db.query(models.AppointmentRequest).filter(
                models.AppointmentRequest.id == request_id
            ).first()
            if req is None:
                return _error(matching.ERR_NOT_FOUND)

            if not resolve_actor(req.patient_id,
                                 own_perm=Permission.APPOINTMENT_MANAGE_OWN,
                                 any_perm=Permission.APPOINTMENT_MANAGE_ANY):
                return generate_response(False, error="Unauthorized", status_code=403)

            invited = [
                link.doctor_id
                for link in db.query(models.AppointmentRequestDoctor).filter(
                    models.AppointmentRequestDoctor.request_id == req.id
                ).all()
            ]

            # Validated HERE, before anything is mutated, exactly as create does --
            # normalize_slots also re-checks that no offered time has since passed.
            slots = matching.UNSET
            if "preferred_slots" in data:
                slots, slot_error = matching.normalize_slots(
                    data.get("preferred_slots"), set(invited)
                )
                if slot_error:
                    return generate_response(False, error=slot_error, status_code=400)

            scan = None
            if req.scan_id:
                scan = db.query(models.AIScan).filter(models.AIScan.id == req.scan_id).first()

            triage = matching.UNSET
            if "answers" in data:
                if scan is not None:
                    triage = TriageService.triage_for_scan(scan, answers)
                else:
                    triage = TriageService.triage(
                        data.get("disease") or "Skin Condition", data.get("confidence"), answers
                    )

            result, error = matching.update_request(
                db,
                req.id,
                slots=slots,
                patient_note=data.get("patient_note") if "patient_note" in data else matching.UNSET,
                express=data.get("express") if "express" in data else matching.UNSET,
                consent_share_scan=(
                    data.get("consent_share_scan") if "consent_share_scan" in data else matching.UNSET
                ),
                triage=triage,
            )
            if error is not None:
                return _error(error)

            # ---- the same scan-side rules create applies -------------------
            if scan is not None:
                if "answers" in data:
                    scan.patient_questionnaire = json.dumps(answers) if answers else None
                    # A doctor's manual override still outranks a re-run of triage.
                    if scan.overridden_by is None and triage is not matching.UNSET:
                        scan.severity_level = triage["severity"]
                        scan.triage_score = triage["triage_score"]
                        scan.triage_reasons = json.dumps(triage["triage_reasons"])
                if "patient_note" in data:
                    scan.patient_notes = req.patient_note
                # APPEND-ONLY consent: granting it again after a revoke is a new
                # grant, so it gets a new row rather than editing the old one.
                if result["consent_granted"]:
                    _record_scan_share_consent(db, req.patient_id, scan.id, invited)

            db.commit()

            payload = matching.serialize_request(db, req)
            if result["notified_doctor_ids"]:
                patient = db.query(models.User).filter(models.User.id == req.patient_id).first()
                disease_name = (scan.prediction_result if scan is not None else None) or "Skin Condition"
                matching.notify_request_updated(
                    db, req, result["notified_doctor_ids"],
                    patient.name if patient else "Guest Patient",
                    disease_name, result["changed"],
                )

            logger.info(
                "Appointment request %s edited by patient %s: %s",
                req.id, req.patient_id, result["changed"] or "no change",
            )
            return generate_response(
                True,
                message="Appointment request updated." if result["changed"] else "Nothing changed.",
                data={**payload, "changed": result["changed"]},
                status_code=200,
            )
    except Exception as exc:
        logger.error("Update Appointment Request Error: %s", exc, exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ======================================================================
# 5. DOCTOR INBOX  -- GET /api/doctor/appointment-requests
# ======================================================================
@appointment_requests_bp.route('/api/doctor/appointment-requests', methods=['GET'])
@require_permission(Permission.SCAN_REVIEW_ASSIGNED, denied_message=ERR_DOCTOR_ONLY)
def doctor_request_inbox():
    """Requests this doctor was invited to.

    Default view is the ACTIONABLE one: request still Open AND my own link row
    still Pending. `?include=all` returns every invitation I have ever had,
    which is what the "history" tab needs.
    """
    actor = current_actor()
    if actor is None:
        return generate_response(False, error="Unauthorized", status_code=403)

    page, limit = _pagination()
    include_all = (request.args.get("include") or "").lower() == "all"
    status_filter = request.args.get("status")

    try:
        with session_scope() as db:
            query = (
                db.query(models.AppointmentRequest)
                .join(
                    models.AppointmentRequestDoctor,
                    models.AppointmentRequestDoctor.request_id == models.AppointmentRequest.id,
                )
                .filter(models.AppointmentRequestDoctor.doctor_id == actor.id)
            )

            if status_filter:
                query = query.filter(models.AppointmentRequest.status == status_filter)
            elif not include_all:
                query = query.filter(
                    models.AppointmentRequest.status == REQUEST_OPEN,
                    models.AppointmentRequestDoctor.response == RESPONSE_PENDING,
                )

            total = query.count()
            # CRITICAL/URGENT first, then oldest-waiting first -- a doctor's
            # queue must not be ordered by whoever happened to submit last.
            rows = (
                query.order_by(
                    models.AppointmentRequest.express.desc(),
                    models.AppointmentRequest.created_at.asc(),
                )
                .offset((page - 1) * limit)
                .limit(limit)
                .all()
            )

            items = [matching.serialize_request(db, row, viewer_doctor_id=actor.id) for row in rows]
            return generate_response(True, data=_paged(items, page, limit, total), status_code=200)
    except Exception as exc:
        logger.error("Doctor Request Inbox Error: %s", exc, exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ======================================================================
# 6. ACCEPT  -- POST /api/appointment-requests/<id>/accept
# ======================================================================
@appointment_requests_bp.route('/api/appointment-requests/<int:request_id>/accept', methods=['POST'])
@require_permission(
    Permission.SCAN_REVIEW_ASSIGNED,
    denied_message=ERR_DOCTOR_ONLY,
    require_doctor_approved=True,
)
def accept_appointment_request(request_id):
    """FIRST DOCTOR TO ACCEPT WINS.

    The serialisation is a SELECT ... FOR UPDATE on the parent request row
    (app/services/request_matching._lock_request), so two doctors clicking in
    the same instant produce one appointment and one clean 409 -- not two
    appointments, and not a 500 from the double-booking unique index.
    """
    data = request.get_json(silent=True) or {}
    slot_id = _as_int(data.get("slot_id"))

    actor = current_actor()
    if actor is None:
        return generate_response(False, error="Unauthorized", status_code=403)

    try:
        with session_scope() as db:
            result, error = matching.accept_request(db, request_id, actor.id, slot_id=slot_id)
            if error is not None:
                return _error(error)

            appointment = result["appointment"]
            slot = result["slot"]
            appointment_id = appointment.id
            db.commit()

            req = db.query(models.AppointmentRequest).filter(
                models.AppointmentRequest.id == request_id
            ).first()

            _notify_accept(db, req, appointment, result)

            payload = {
                "request_id": request_id,
                "status": req.status,
                "appointment_id": appointment_id,
                "appointment_status": result["appointment_status"],
                "conflict_with_id": result["conflict_with_id"],
                "doctor_id": actor.id,
                "patient_id": req.patient_id,
                "scan_id": req.scan_id,
                "slot": matching.serialize_slot(slot),
                "withdrawn_doctor_ids": result["withdrawn_doctor_ids"],
                "request": matching.serialize_request(db, req, viewer_doctor_id=actor.id),
            }
            logger.info(
                "Appointment request %s accepted by doctor %s -> appointment %s (%s)",
                request_id, actor.id, appointment_id, result["appointment_status"],
            )
            return generate_response(
                True, message="Appointment request accepted.", data=payload, status_code=200
            )
    except Exception as exc:
        logger.error("Accept Appointment Request Error: %s", exc, exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


def _notify_accept(db, req, appointment, result):
    """Tell the patient they have a doctor; tell the doctor if it landed in a
    conflict. Never fatal -- a mail outage must not undo a booking."""
    try:
        patient = db.query(models.User).filter(models.User.id == req.patient_id).first()
        doctor = db.query(models.User).filter(models.User.id == appointment.doctor_id).first()
        doctor_name = doctor.name if doctor else "your doctor"

        if patient and patient.email:
            if result["conflict_with_id"]:
                send_email(
                    patient.email,
                    "Urgent request accepted - awaiting slot confirmation",
                    f"Dear {patient.name},\n\n"
                    f"Dr. {doctor_name} accepted your urgent request for "
                    f"{appointment.appointment_date} at {appointment.appointment_time}. "
                    f"That slot was already held by another patient, so both bookings are "
                    f"currently 'Pending-Conflict' and the doctor will confirm priority.\n\n"
                    f"Regards,\nDerma AI",
                )
            else:
                send_email(
                    patient.email,
                    "Appointment confirmed",
                    f"Dear {patient.name},\n\n"
                    f"Dr. {doctor_name} accepted your appointment request for "
                    f"{appointment.appointment_date} at {appointment.appointment_time}.\n\n"
                    f"Regards,\nDerma AI",
                )

        if result["conflict_with_id"] and doctor and doctor.email:
            send_email(
                doctor.email,
                "Action Required: Urgent Booking Conflict",
                f"Dear Dr. {doctor.name},\n\n"
                f"You accepted an urgent request for {appointment.appointment_date} "
                f"{appointment.appointment_time}, which was already booked. Both appointments "
                f"are now 'Pending-Conflict' - open your dashboard to confirm one.\n\n"
                f"If you do not decide in time, the system will resolve it by severity after "
                f"the SLA timeout.\n\nThank you.",
            )
    except Exception as exc:
        logger.warning("Accept notification email failure: %s", exc)


# ======================================================================
# 7. DECLINE  -- POST /api/appointment-requests/<id>/decline
# ======================================================================
@appointment_requests_bp.route('/api/appointment-requests/<int:request_id>/decline', methods=['POST'])
@require_permission(
    Permission.SCAN_REVIEW_ASSIGNED,
    denied_message=ERR_DOCTOR_ONLY,
    require_doctor_approved=True,
)
def decline_appointment_request(request_id):
    data = request.get_json(silent=True) or {}
    reason = (data.get("reason") or "").strip() or None

    actor = current_actor()
    if actor is None:
        return generate_response(False, error="Unauthorized", status_code=403)

    try:
        with session_scope() as db:
            result, error = matching.decline_request(db, request_id, actor.id, reason=reason)
            if error is not None:
                return _error(error)

            db.commit()
            req = db.query(models.AppointmentRequest).filter(
                models.AppointmentRequest.id == request_id
            ).first()

            # Everyone said no: the patient has to know now, not in 72 hours.
            if result["remaining_pending"] == 0:
                try:
                    patient = db.query(models.User).filter(models.User.id == req.patient_id).first()
                    if patient and patient.email:
                        send_email(
                            patient.email,
                            "No doctor was available for your request",
                            f"Dear {patient.name},\n\n"
                            f"All of the doctors you invited have declined request #{req.id}.\n"
                            f"Please open the app and send a new request -- you can pick different "
                            f"doctors or different times.\n\nRegards,\nDerma AI",
                        )
                except Exception as exc:
                    logger.warning("Decline notification email failure: %s", exc)

            payload = {
                "request_id": request_id,
                "status": req.status,
                "doctor_id": actor.id,
                "response": "Declined",
                "decline_reason": reason,
                "remaining_pending": result["remaining_pending"],
                "request": matching.serialize_request(db, req, viewer_doctor_id=actor.id),
            }
            logger.info("Appointment request %s declined by doctor %s", request_id, actor.id)
            return generate_response(
                True, message="Appointment request declined.", data=payload, status_code=200
            )
    except Exception as exc:
        logger.error("Decline Appointment Request Error: %s", exc, exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ======================================================================
# 8. TRIAGE PREVIEW  -- POST /api/triage-preview
# ======================================================================
@appointment_requests_bp.route('/api/triage-preview', methods=['POST'])
# Anonymous-friendly on purpose: a guest can scan, so a guest must be able to
# see how urgent the result is. This scores what the caller sends and writes
# nothing -- there is no stored record to leak and no id to enumerate. Telling a
# signed-out visitor with a suspected melanoma "sign in to find out whether this
# is urgent" would be the wrong call clinically as well as commercially.
@require_permission(optional=True)
def triage_preview():
    """Severity BEFORE submitting, so the stepper can explain itself.

    READ-ONLY: it writes nothing and reads nothing from the database. It exists
    so the questionnaire step can show "this looks urgent, and here is why"
    while the patient is still filling the form, instead of the severity being
    a surprise that appears after the request is already sent.
    """
    data = request.get_json(silent=True) or {}
    disease = data.get("disease") or "Skin Condition"
    answers = data.get("answers")
    if answers is not None and not isinstance(answers, dict):
        return generate_response(False, error="answers must be an object or null.", status_code=400)

    triage = TriageService.triage(disease, data.get("confidence"), answers)
    express_requested = bool(data.get("express"))
    severity = triage["severity"]

    return generate_response(True, data={
        "disease": disease,
        "confidence": triage["normalized_confidence"],
        "severity": severity,
        "disease_tier": triage["disease_tier"],
        "disease_tier_known": triage["disease_tier_known"],
        "triage_score": triage["triage_score"],
        "triage_reasons": triage["triage_reasons"],
        "is_emergency": triage["is_emergency"],
        "express_recommended": TriageService.is_express(severity, False),
        "express": TriageService.is_express(severity, express_requested),
        "expires_in_hours": TriageService.ttl_hours(severity, express_requested),
    }, status_code=200)


# ======================================================================
# 9. BATCHED SLOTS  -- GET /api/slots/multi
# ======================================================================
@appointment_requests_bp.route('/api/slots/multi', methods=['GET'])
def multi_doctor_slots():
    """Slots for up to 10 doctors on one date, in ONE request.

    PUBLIC, like /api/slots/<id> and /api/doctor-availability -- the booking
    screen reads it before any doctor-scoped token exists.

    NOTE the shape: this returns the standard ENVELOPE, with the map under
    data.by_doctor. /api/slots/<id>'s bare array is a legacy obligation and is
    deliberately not reproduced here.

    Werkzeug matches this static rule ahead of /api/slots/<int:doctor_id>, and
    'multi' is not an int, so the two cannot collide.
    """
    raw_ids = request.args.get("doctor_ids") or ""
    date_str = request.args.get("date")
    if not date_str:
        return generate_response(False, error="Date query parameter is required", status_code=400)

    doctor_ids = [part.strip() for part in raw_ids.split(",") if part.strip()]
    if not doctor_ids:
        return generate_response(False, error="doctor_ids query parameter is required", status_code=400)

    try:
        with session_scope() as db:
            by_doctor, invalid_date = slots_for_doctors(db, doctor_ids, date_str)
            if invalid_date:
                return generate_response(
                    False, error="Invalid date format, use YYYY-MM-DD", status_code=400
                )
            return generate_response(True, data={
                "date": date_str,
                "by_doctor": by_doctor,
                "doctor_ids": [int(k) for k in by_doctor.keys()],
                "max_doctors": MAX_MULTI_DOCTORS,
            }, status_code=200)
    except Exception as exc:
        logger.error("Multi Slots Error: %s", exc, exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


__all__ = ["appointment_requests_bp"]
