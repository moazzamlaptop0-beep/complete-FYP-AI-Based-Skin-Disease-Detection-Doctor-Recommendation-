"""
Multi-doctor appointment requests: creation, fan-out, first-accept-wins matching.

WHY THIS EXISTS
---------------
Booking used to be reachable ONLY after /send_report had already pinned ONE
doctor onto the scan (ai_scans.doctor_id is a single FK), and /api/book-slot
took exactly one doctor + one date + one time. A patient therefore had to know
who they wanted and when, before they were allowed to ask for anything -- and
the "emergency" path was the only way to get a slot that was already taken.

Here the patient describes the problem ONCE and fans it out: 1-3 doctors, 1-5
preferred times, in preference order. The FIRST doctor to accept wins; everyone
else's invitation is withdrawn. Emergency is a LANE (it shortens the response
window and re-uses the urgent email + the existing Pending-Conflict machinery),
never a PREREQUISITE.

THE RACE, AND HOW IT IS CLOSED
------------------------------
Three doctors can hit /accept in the same millisecond. `_lock_request` does
SELECT ... FOR UPDATE on the appointment_requests row, so the second and third
transactions block until the first commits and then observe status='Matched'
and get a clean 409. The double-booking partial unique index
(uq_appt_doctor_slot) is the second line of defence and its IntegrityError is
also turned into a 409 rather than a 500.

SQLite has no FOR UPDATE; `_lock_request` degrades to a plain SELECT there. The
project runs Postgres in dev, test and production, so the lock is real
everywhere it matters.
"""

import datetime
import json
import logging

from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError, OperationalError

from app import models
from app.models.enums import (
    APPT_PENDING_CONFLICT,
    APPT_SCHEDULED,
    REQUEST_DECLINED,
    REQUEST_EXPIRED,
    REQUEST_MATCHED,
    REQUEST_OPEN,
    REQUEST_WITHDRAWN,
    RESPONSE_ACCEPTED,
    RESPONSE_DECLINED,
    RESPONSE_PENDING,
    RESPONSE_WITHDRAWN,
    SEVERITY_ROUTINE,
)
from app.services.conflict_service import parse_appointment_datetime
from app.services.scheduling_service import clinic_now
from app.services.email_service import send_email
from app.services.serializers import iso_pk, parse_json_field, profile_image_url
from app.services.triage_service import TriageService

logger = logging.getLogger(__name__)

# Statuses that make a doctor+slot occupied. Same list /api/book-slot and
# _generate_slots_for_date use -- deliberately shared so the three cannot drift.
SLOT_TAKEN_STATUSES = ("Scheduled", "Confirmed", "Completed", "Pending-Conflict")

SLOT_UNIQUE_INDEX = "uq_appt_doctor_slot"

MAX_DOCTORS_PER_REQUEST = 3
MAX_SLOTS_PER_REQUEST = 5

# Every failure mode this module can produce, as (code, http_status, message).
# Returned rather than raised so the route stays a thin translation layer.
ERR_NOT_FOUND = ("not_found", 404, "Appointment request not found.")
ERR_NOT_INVITED = ("not_invited", 403, "You were not invited to this request.")
ERR_ALREADY_CLOSED = ("already_closed", 409, "This request has already been answered by another doctor.")
ERR_ALREADY_RESPONDED = ("already_responded", 409, "You have already responded to this request.")
ERR_NO_SLOT = ("no_slot", 400, "No usable preferred slot on this request.")
ERR_SLOT_NOT_ON_REQUEST = ("slot_not_on_request", 400, "That slot does not belong to this request.")
ERR_SLOT_OTHER_DOCTOR = ("slot_other_doctor", 400, "That slot was requested for a different doctor.")
ERR_SLOT_PAST = ("slot_past", 400, "That slot is in the past.")
ERR_SLOT_TAKEN = ("slot_taken", 409, "This slot is already booked.")

# PATCH is PARTIAL: an absent key means "leave that column alone", which is a
# different instruction from "set it to null". `None` cannot carry that
# distinction (patient_note=None legitimately CLEARS the note), so update_request
# defaults every keyword to this sentinel instead.
UNSET = object()


def utcnow():
    """Naive UTC -- every datetime column in this codebase is naive."""
    return datetime.datetime.utcnow()


# ======================================================================
# LOCKING
# ======================================================================
def _lock_request(db, request_id):
    """SELECT ... FOR UPDATE the parent request row.

    This is what serialises concurrent /accept calls: whoever gets the row lock
    first decides the outcome, and the losers read the committed 'Matched'
    status instead of racing past a stale one.
    """
    query = db.query(models.AppointmentRequest).filter(
        models.AppointmentRequest.id == request_id
    )
    try:
        return query.with_for_update().first()
    except (OperationalError, NotImplementedError):  # pragma: no cover - sqlite
        logger.warning("SELECT FOR UPDATE unsupported on this backend; accept is not serialised.")
        db.rollback()
        return db.query(models.AppointmentRequest).filter(
            models.AppointmentRequest.id == request_id
        ).first()


# ======================================================================
# SERIALISATION -- one shape, every endpoint
# ======================================================================
def _iso(value):
    """VERBATIM isoformat -- for slot_start ONLY, which is clinic wall-clock
    already (see normalize_slots). Stored-UTC timestamps use iso_pk, which
    serves the same naive string shape but in Pakistan wall-clock."""
    return value.isoformat() if value else None


def serialize_slot(slot):
    return {
        "slot_id": slot.id,
        "doctor_id": slot.doctor_id,
        "slot_date": slot.slot_date,
        "slot_time": slot.slot_time,
        "slot_start": _iso(slot.slot_start),
        "rank": slot.rank,
    }


def serialize_invite(link, user=None, profile=None):
    return {
        "doctor_id": link.doctor_id,
        "doctor_name": user.name if user else None,
        "doctor_email": user.email if user else None,
        "specialty": (profile.specialty if profile else None),
        "profile_image": profile_image_url(profile.profile_image) if profile else None,
        "preference_rank": link.preference_rank,
        "response": link.response,
        "decline_reason": link.decline_reason,
        "responded_at": iso_pk(link.responded_at),
    }


def _scan_payload(scan, share_consented):
    """The scan block shown on a request.

    `image_url` is NULL unless the patient ticked consent_share_scan on THIS
    request. The clinical fields (prediction, severity, notes) are always
    present -- withholding the diagnosis would make the invitation useless --
    but the photograph itself is gated on an explicit, per-request grant.
    """
    if scan is None:
        return None
    return {
        "id": scan.id,
        "disease": scan.prediction_result,
        "confidence": scan.confidence,
        "severity": scan.severity_level or SEVERITY_ROUTINE,
        "status": scan.status,
        "patient_notes": scan.patient_notes,
        # The six symptom answers the patient actually gave. Without this key the
        # doctor's request card fell through to "Symptom questions were skipped
        # -- this is not the same as answering 'no'." on EVERY request, including
        # ones reporting bleeding and rapid growth. Never gated on photo consent:
        # these are clinical fields, like the diagnosis above.
        "questionnaire_answers": parse_json_field(scan.patient_questionnaire, None),
        "is_sensitive": bool(getattr(scan, "is_sensitive", False)),
        "image_shared": bool(share_consented),
        "image_url": (scan.image_url if share_consented else None),
        "created_at": iso_pk(scan.created_at),
    }


def serialize_request(db, req, viewer_doctor_id=None, include_patient=True):
    """The FULL request object every appointment-request endpoint returns.

    One builder so /create, /list, /detail, /accept, /decline and the doctor
    inbox cannot drift apart. `viewer_doctor_id` adds the my_* keys the inbox
    needs; it is None (and the keys are still present, as nulls) elsewhere, so
    the client never has to branch on key existence.
    """
    links = db.query(models.AppointmentRequestDoctor).filter(
        models.AppointmentRequestDoctor.request_id == req.id
    ).order_by(models.AppointmentRequestDoctor.preference_rank.asc(),
               models.AppointmentRequestDoctor.id.asc()).all()

    slots = db.query(models.AppointmentRequestSlot).filter(
        models.AppointmentRequestSlot.request_id == req.id
    ).order_by(models.AppointmentRequestSlot.rank.asc(),
               models.AppointmentRequestSlot.id.asc()).all()

    doctor_ids = [link.doctor_id for link in links]
    users = {u.id: u for u in db.query(models.User).filter(models.User.id.in_(doctor_ids)).all()} if doctor_ids else {}
    profiles = {
        p.user_id: p
        for p in db.query(models.DoctorProfile).filter(models.DoctorProfile.user_id.in_(doctor_ids)).all()
    } if doctor_ids else {}

    scan = None
    if req.scan_id:
        scan = db.query(models.AIScan).filter(models.AIScan.id == req.scan_id).first()

    patient = None
    if include_patient:
        patient = db.query(models.User).filter(models.User.id == req.patient_id).first()

    mine = next((l for l in links if l.doctor_id == viewer_doctor_id), None) if viewer_doctor_id else None

    payload = {
        "request_id": req.id,
        "patient_id": req.patient_id,
        "patient_name": patient.name if patient else None,
        "patient_email": patient.email if patient else None,
        "scan_id": req.scan_id,
        "scan": _scan_payload(scan, req.consent_share_scan),
        "status": req.status,
        "priority": req.priority,
        "express": bool(req.express),
        "patient_note": req.patient_note,
        "severity_level": req.severity_snapshot,
        "triage_score": req.triage_score,
        "triage_reasons": parse_json_field(req.triage_reasons, []),
        "consent_share_scan": bool(req.consent_share_scan),
        "matched_doctor_id": req.matched_doctor_id,
        "matched_appointment_id": req.matched_appointment_id,
        "expires_at": iso_pk(req.expires_at),
        "created_at": iso_pk(req.created_at),
        "doctors": [serialize_invite(l, users.get(l.doctor_id), profiles.get(l.doctor_id)) for l in links],
        "slots": [serialize_slot(s) for s in slots],
        "pending_doctor_count": sum(1 for l in links if l.response == RESPONSE_PENDING),
        "my_response": mine.response if mine else None,
        "my_preference_rank": mine.preference_rank if mine else None,
    }
    return payload


# ======================================================================
# CREATION HELPERS
# ======================================================================
def approved_doctor_ids(db, doctor_ids):
    """(approved, rejected) split for a list of candidate doctor ids.

    A request may only be fanned out to doctors whose licence an admin has
    actually approved -- otherwise "pick your doctor" quietly includes accounts
    nobody has verified.
    """
    ids = []
    for raw in doctor_ids or []:
        try:
            value = int(raw)
        except (TypeError, ValueError):
            continue
        if value not in ids:
            ids.append(value)

    if not ids:
        return [], []

    users = {
        u.id: u for u in db.query(models.User).filter(models.User.id.in_(ids)).all()
    }
    profiles = {
        p.user_id: p
        for p in db.query(models.DoctorProfile).filter(models.DoctorProfile.user_id.in_(ids)).all()
    }

    approved, rejected = [], []
    for value in ids:
        user = users.get(value)
        profile = profiles.get(value)
        if user is None or user.role != "Doctor" or getattr(user, "is_active", True) is False:
            rejected.append(value)
        elif profile is None or profile.verification_status != "approved":
            rejected.append(value)
        else:
            approved.append(value)
    return approved, rejected


def normalize_slots(raw_slots, allowed_doctor_ids, now=None):
    """Validate + normalise the preferred_slots array.

    Returns (slots, error). Each slot is a dict
    {slot_date, slot_time, doctor_id, rank, slot_start}. `slot_start` is the
    typed shadow; a slot whose free-text pair cannot be parsed is REJECTED here
    rather than stored unparseable (the request expiry job and the ordering both
    need it).
    """
    # clinic_now(), not utcnow(): slot_start is a naive CLINIC wall-clock value
    # parsed from the doctor's own schedule strings. Comparing it to UTC let a
    # five-hour window of already-passed slots through every day (UTC+5).
    now = now or clinic_now()
    if not isinstance(raw_slots, list) or not raw_slots:
        return None, "At least one preferred slot is required."
    if len(raw_slots) > MAX_SLOTS_PER_REQUEST:
        return None, f"At most {MAX_SLOTS_PER_REQUEST} preferred slots are allowed."

    out = []
    seen = set()
    for index, raw in enumerate(raw_slots):
        if not isinstance(raw, dict):
            return None, "Each preferred slot must be an object."
        slot_date = (raw.get("slot_date") or raw.get("date") or "").strip()
        slot_time = (raw.get("slot_time") or raw.get("time") or "").strip()
        if not slot_date or not slot_time:
            return None, "Each preferred slot needs slot_date and slot_time."

        slot_start = parse_appointment_datetime(slot_date, slot_time)
        if slot_start is None:
            return None, f"Could not read the date/time '{slot_date} {slot_time}'."
        if slot_start < now:
            return None, f"Preferred slot {slot_date} {slot_time} is in the past."

        # ONE SPELLING PER INSTANT. slot_date/slot_time are copied verbatim onto
        # the Appointment at accept time, and every "is this slot taken?" test in
        # the codebase is raw string equality -- so storing "9:00 AM" next to a
        # grid that generates "09:00" hides an occupied slot from the occupancy
        # check, the slot grid and the partial unique index alike. Rewrite to the
        # canonical form now that it has been parsed.
        slot_date = slot_start.strftime("%Y-%m-%d")
        slot_time = slot_start.strftime("%H:%M")

        doctor_id = raw.get("doctor_id")
        if doctor_id is not None:
            try:
                doctor_id = int(doctor_id)
            except (TypeError, ValueError):
                return None, "Invalid doctor_id on a preferred slot."
            if doctor_id not in allowed_doctor_ids:
                return None, "A preferred slot names a doctor who is not on this request."

        key = (slot_date, slot_time, doctor_id)
        if key in seen:
            continue
        seen.add(key)

        rank = raw.get("rank")
        try:
            rank = int(rank)
        except (TypeError, ValueError):
            rank = index

        out.append({
            "slot_date": slot_date,
            "slot_time": slot_time,
            "doctor_id": doctor_id,
            "rank": rank,
            "slot_start": slot_start,
        })

    if not out:
        return None, "At least one preferred slot is required."
    out.sort(key=lambda s: s["rank"])
    return out, None


def notify_invited_doctors(db, req, doctor_ids, patient_name, disease_name):
    """Email every invited doctor. Uses the EXISTING urgent template wording for
    the express lane so a doctor's mail filters keep working."""
    reasons = parse_json_field(req.triage_reasons, [])
    hours = TriageService.EXPRESS_TTL_HOURS if req.express else TriageService.ROUTINE_TTL_HOURS
    expected = "immediately (within 2-4 hours)" if req.express else "within 24-48 hours"

    users = db.query(models.User).filter(models.User.id.in_(doctor_ids)).all() if doctor_ids else []
    for doctor in users:
        if not doctor.email:
            continue
        try:
            if req.express:
                subject = "URGENT: Critical AI Scan Report - Action Required"
                body = (
                    f"Dear Dr. {doctor.name},\n\n"
                    f"CRITICAL PATIENT ALERT\n\n"
                    f"A patient has forwarded an AI scan report that requires your IMMEDIATE attention.\n"
                    f"Detected Condition: {str(disease_name).upper()}\n"
                    f"Severity: {req.severity_snapshot}\n"
                    f"Reasons: {'; '.join(reasons)}\n"
                    f"Patient Name: {patient_name}\n\n"
                    f"This request was also sent to other doctors -- the first to accept takes the case. "
                    f"It expires in {hours} hours.\n"
                    f"Please log in to your clinic dashboard to review this case {expected}.\n\n"
                    f"Regards,\nDerma AI Emergency System"
                )
            else:
                subject = f"New Appointment Request - Patient: {patient_name}"
                body = (
                    f"Dear Dr. {doctor.name},\n\n"
                    f"A patient has requested an appointment with you.\n"
                    f"AI Prediction: {disease_name}\n"
                    f"Severity: {req.severity_snapshot}\n"
                    f"Patient Name: {patient_name}\n\n"
                    f"This request was also sent to other doctors -- the first to accept takes the case. "
                    f"It expires in {hours} hours.\n"
                    f"Please log in to your dashboard to accept or decline {expected}.\n\n"
                    f"Regards,\nDerma AI System"
                )
            send_email(doctor.email, subject, body)
        except Exception as exc:  # never let a mail failure roll back a booking
            logger.warning("Appointment request invite email failed for doctor %s: %s", doctor.id, exc)


def notify_request_updated(db, req, doctor_ids, patient_name, disease_name, changed):
    """Tell the doctors who have NOT answered yet that the patient edited it.

    Only the still-Pending doctors are mailed. Someone who already declined has
    no decision left to make, and a doctor who accepted closed the request --
    which is why an edit is refused for anything but an Open request in the first
    place. `changed` is the plain-English list update_request built, so the mail
    says what moved rather than "something changed".
    """
    if not doctor_ids or not changed:
        return

    slots = db.query(models.AppointmentRequestSlot).filter(
        models.AppointmentRequestSlot.request_id == req.id
    ).order_by(models.AppointmentRequestSlot.rank.asc(),
               models.AppointmentRequestSlot.id.asc()).all()
    offered = "\n".join(
        f"  {index + 1}. {slot.slot_date} at {slot.slot_time}"
        for index, slot in enumerate(slots)
    ) or "  (no times are currently offered)"

    users = db.query(models.User).filter(models.User.id.in_(doctor_ids)).all()
    for doctor in users:
        if not doctor.email:
            continue
        try:
            send_email(
                doctor.email,
                f"Appointment request UPDATED - Patient: {patient_name}",
                f"Dear Dr. {doctor.name},\n\n"
                f"{patient_name} has changed an appointment request you were invited to "
                f"(#{req.id}) before anybody accepted it.\n"
                f"What changed: {', '.join(changed)}.\n\n"
                f"AI Prediction: {disease_name}\n"
                f"Severity: {req.severity_snapshot}\n"
                f"Times now on offer, best first:\n{offered}\n\n"
                f"The request is still open and still first-to-accept. Please review the "
                f"CURRENT times in your dashboard -- any earlier list is out of date.\n\n"
                f"Regards,\nDerma AI System",
            )
        except Exception as exc:  # a mail failure must never undo the edit
            logger.warning("Appointment request update email failed for doctor %s: %s", doctor.id, exc)


# ======================================================================
# ACCEPT -- first doctor wins
# ======================================================================
def _pick_slot(db, req, doctor_id, slot_id=None):
    """Resolve which AppointmentRequestSlot this doctor is accepting.

    Explicit slot_id must belong to the request and must not be earmarked for a
    DIFFERENT doctor. With no slot_id we take the patient's highest-ranked slot
    that is still in the future and is either unassigned or assigned to us.
    """
    slots = db.query(models.AppointmentRequestSlot).filter(
        models.AppointmentRequestSlot.request_id == req.id
    ).order_by(models.AppointmentRequestSlot.rank.asc(),
               models.AppointmentRequestSlot.id.asc()).all()

    # slot_start is clinic wall-clock -- see normalize_slots.
    if slot_id is not None:
        chosen = next((s for s in slots if s.id == int(slot_id)), None)
        if chosen is None:
            return None, ERR_SLOT_NOT_ON_REQUEST
        if chosen.doctor_id is not None and chosen.doctor_id != doctor_id:
            return None, ERR_SLOT_OTHER_DOCTOR
        if chosen.slot_start and chosen.slot_start < clinic_now():
            return None, ERR_SLOT_PAST
        return chosen, None

    now = clinic_now()
    for slot in slots:
        if slot.doctor_id is not None and slot.doctor_id != doctor_id:
            continue
        if slot.slot_start and slot.slot_start < now:
            continue
        return slot, None
    return None, ERR_NO_SLOT


def _existing_booking(db, doctor_id, slot_date, slot_time):
    # "Same instant, however it was spelled" -- the raw string pair alone misses
    # a row stored in another date/time format, and slot_start alone misses a row
    # that never got one. See appointments/routes._same_slot_predicate.
    predicates = [
        and_(
            models.Appointment.appointment_date == slot_date,
            models.Appointment.appointment_time == slot_time,
        )
    ]
    parsed = parse_appointment_datetime(slot_date, slot_time)
    if parsed is not None:
        predicates.append(models.Appointment.slot_start == parsed)

    return db.query(models.Appointment).filter(
        models.Appointment.doctor_id == doctor_id,
        or_(*predicates),
        models.Appointment.status.in_(SLOT_TAKEN_STATUSES),
    ).first()


def _duration_for(db, doctor_id):
    fee = db.query(models.DoctorFees).filter_by(doctor_id=doctor_id).first()
    return fee.duration if fee and fee.duration else '30min'


# Only a SERVER-VERIFIED severity may bump another patient off a slot.
SLOT_OVERRIDE_SEVERITIES = ("CRITICAL", "URGENT")

# Statuses that occupy a slot but may never be rewritten into a conflict pair:
# the consultation already happened. See _may_override_slot().
TERMINAL_APPOINTMENT_STATUSES = ("Completed",)


def _verified_override_severity(db, req):
    """The severity that decides whether this request can take an occupied slot.

    Read from the request's OWN scan row, never from `req.express` and never
    from `req.severity_snapshot`: `express` is copied verbatim out of the client
    body (TriageService.is_express returns `bool(requested) or ...`), and for a
    scan-less request the snapshot is computed from a client-supplied `disease`
    and `confidence`. Either one lets an ordinary patient self-declare urgency
    and bump a stranger's Confirmed appointment into Pending-Conflict -- exactly
    the attack /api/book-slot refuses ("request body se NAHI").
    """
    if not req.scan_id:
        return SEVERITY_ROUTINE
    scan = db.query(models.AIScan).filter(
        models.AIScan.id == req.scan_id,
        models.AIScan.user_id == req.patient_id,
    ).first()
    if scan is None:
        return SEVERITY_ROUTINE
    return scan.severity_level or SEVERITY_ROUTINE


def accept_request(db, request_id, doctor_id, slot_id=None):
    """FIRST DOCTOR TO ACCEPT WINS. Returns (payload, error_tuple).

    Steps, in this order and inside one transaction:
      1. lock the parent request FOR UPDATE          (serialises the race)
      2. require status == 'Open' and my link == 'Pending'
      3. resolve the slot
      4. insert the Appointment (or, on the EXPRESS lane only, a cross-linked
         Pending-Conflict pair -- the existing SLA resolver then owns it)
      5. mark the request Matched, withdraw everyone else, re-point the scan

    The caller commits. Nothing here emails on the hot path except the express
    conflict notice, which mirrors /api/book-slot's own behaviour.
    """
    req = _lock_request(db, request_id)
    if req is None:
        return None, ERR_NOT_FOUND
    if req.status != REQUEST_OPEN:
        return None, ERR_ALREADY_CLOSED

    link = db.query(models.AppointmentRequestDoctor).filter(
        models.AppointmentRequestDoctor.request_id == req.id,
        models.AppointmentRequestDoctor.doctor_id == doctor_id,
    ).first()
    if link is None:
        return None, ERR_NOT_INVITED
    if link.response != RESPONSE_PENDING:
        return None, ERR_ALREADY_RESPONDED

    slot, slot_error = _pick_slot(db, req, doctor_id, slot_id)
    if slot_error is not None:
        return None, slot_error

    now = utcnow()
    slot_start = slot.slot_start or parse_appointment_datetime(slot.slot_date, slot.slot_time)
    duration = _duration_for(db, doctor_id)

    taken = _existing_booking(db, doctor_id, slot.slot_date, slot.slot_time)
    conflict_partner = None
    appointment_status = APPT_SCHEDULED
    persisted_slot_start = slot_start

    if taken is not None:
        # A slot already in an unresolved conflict never takes a third patient --
        # same rule /api/book-slot enforces. A consultation that already happened
        # ("Completed") is likewise untouchable: rewriting it to Pending-Conflict
        # lets the SLA resolver mark a visit the patient attended as
        # "Reassigned", which erases it from their history and from
        # rating_service. And the override itself is gated on the scan's
        # SERVER-verified severity, not on the client-declared express flag.
        if (
            taken.status == APPT_PENDING_CONFLICT
            or taken.status in TERMINAL_APPOINTMENT_STATUSES
            or not req.express
            or _verified_override_severity(db, req) not in SLOT_OVERRIDE_SEVERITIES
        ):
            return None, ERR_SLOT_TAKEN
        # EXPRESS LANE: hand the case to the EXISTING Pending-Conflict machinery
        # instead of inventing a second resolver. slot_start stays NULL on this
        # row exactly as /api/book-slot's urgent branch does -- it is the one
        # deliberate double-booking uq_appt_doctor_slot must not reject, and the
        # row it conflicts with still carries the typed value.
        conflict_partner = taken
        appointment_status = APPT_PENDING_CONFLICT
        persisted_slot_start = None

    appointment = models.Appointment(
        patient_id=req.patient_id,
        doctor_id=doctor_id,
        scan_id=req.scan_id,
        appointment_date=slot.slot_date,
        appointment_time=slot.slot_time,
        status=appointment_status,
        duration=duration,
        slot_start=persisted_slot_start,
        request_id=req.id,
    )
    db.add(appointment)

    try:
        db.flush()
    except IntegrityError as exc:
        # Two doctors raced past the availability SELECT. The partial unique
        # index caught the loser; hand back the same clean 409 the sequential
        # path returns rather than leaking a 500.
        db.rollback()
        if SLOT_UNIQUE_INDEX in str(getattr(exc, "orig", "")) or SLOT_UNIQUE_INDEX in str(exc):
            return None, ERR_SLOT_TAKEN
        raise

    if conflict_partner is not None:
        conflict_partner.status = APPT_PENDING_CONFLICT
        conflict_partner.conflict_with_id = appointment.id
        appointment.conflict_with_id = conflict_partner.id

    req.status = REQUEST_MATCHED
    req.matched_doctor_id = doctor_id
    req.matched_appointment_id = appointment.id

    link.response = RESPONSE_ACCEPTED
    link.responded_at = now

    withdrawn = []
    others = db.query(models.AppointmentRequestDoctor).filter(
        models.AppointmentRequestDoctor.request_id == req.id,
        models.AppointmentRequestDoctor.doctor_id != doctor_id,
    ).all()
    for other in others:
        if other.response == RESPONSE_PENDING:
            other.response = RESPONSE_WITHDRAWN
            other.responded_at = now
            withdrawn.append(other.doctor_id)

    # The scan finally gets its reviewing doctor -- at ACCEPT time, not at
    # send-report time. That inversion is the whole redesign.
    if req.scan_id:
        scan = db.query(models.AIScan).filter(models.AIScan.id == req.scan_id).first()
        if scan is not None:
            doctor_user = db.query(models.User).filter(models.User.id == doctor_id).first()
            scan.doctor_id = doctor_id
            if doctor_user is not None:
                scan.doctor_name = doctor_user.name
                scan.doctor_email = doctor_user.email
            if scan.status == "Local":
                scan.status = "Pending"

    db.flush()

    return {
        "appointment": appointment,
        "slot": slot,
        "withdrawn_doctor_ids": withdrawn,
        "conflict_with_id": conflict_partner.id if conflict_partner else None,
        "appointment_status": appointment_status,
    }, None


def decline_request(db, request_id, doctor_id, reason=None):
    """One doctor says no. The request stays Open while anyone else may answer."""
    req = _lock_request(db, request_id)
    if req is None:
        return None, ERR_NOT_FOUND
    if req.status != REQUEST_OPEN:
        return None, ERR_ALREADY_CLOSED

    link = db.query(models.AppointmentRequestDoctor).filter(
        models.AppointmentRequestDoctor.request_id == req.id,
        models.AppointmentRequestDoctor.doctor_id == doctor_id,
    ).first()
    if link is None:
        return None, ERR_NOT_INVITED
    if link.response != RESPONSE_PENDING:
        return None, ERR_ALREADY_RESPONDED

    link.response = RESPONSE_DECLINED
    link.decline_reason = (reason or "").strip() or None
    link.responded_at = utcnow()

    # SessionLocal is built with autoflush=False (see app/core/db.py -- the SSE
    # generators depend on it), so this UPDATE is still sitting in the unit of
    # work. Without an explicit flush the count below reads the PRE-decline row
    # and reports this doctor as still pending.
    db.flush()

    remaining = db.query(models.AppointmentRequestDoctor).filter(
        models.AppointmentRequestDoctor.request_id == req.id,
        models.AppointmentRequestDoctor.response == RESPONSE_PENDING,
    ).count()

    if remaining == 0:
        req.status = REQUEST_DECLINED

    db.flush()
    return {"remaining_pending": remaining}, None


def cancel_request(db, request_id, reason=None):
    """Patient withdraws while the request is still Open."""
    req = _lock_request(db, request_id)
    if req is None:
        return None, ERR_NOT_FOUND
    if req.status != REQUEST_OPEN:
        return None, ("not_open", 409, f"Only an Open request can be withdrawn (this one is {req.status}).")

    now = utcnow()
    req.status = REQUEST_WITHDRAWN
    if reason:
        note = str(reason).strip()[:500]
        req.patient_note = f"{req.patient_note}\n\n[Withdrawn] {note}" if req.patient_note else f"[Withdrawn] {note}"

    links = db.query(models.AppointmentRequestDoctor).filter(
        models.AppointmentRequestDoctor.request_id == req.id,
        models.AppointmentRequestDoctor.response == RESPONSE_PENDING,
    ).all()
    for link in links:
        link.response = RESPONSE_WITHDRAWN
        link.responded_at = now

    db.flush()
    return {"withdrawn_doctor_ids": [l.doctor_id for l in links]}, None


def update_request(
    db,
    request_id,
    slots=UNSET,
    patient_note=UNSET,
    express=UNSET,
    consent_share_scan=UNSET,
    triage=UNSET,
):
    """Patient edits their OWN still-Open request. Returns (result, error).

    WHY THIS EXISTS AT ALL
    ---------------------
    Withdraw-and-resend was the only way to change a request, and it is not the
    same operation: it emails every invited doctor that the case is closed, drops
    the request out of their inbox, and produces a SECOND request row for one
    consultation -- so "I can also do Thursday" cost the patient their place in
    three inboxes. Everything editable here is something the doctors have not
    acted on yet, which is why the edit is refused the moment the request stops
    being Open.

    WHAT IS DELIBERATELY NOT EDITABLE
    ---------------------------------
    The invited DOCTORS. Adding one is a new invitation and removing one is a
    withdrawal aimed at a single doctor; both need their own notification rules
    and neither is what "edit my request" means to a patient. Changing who you
    ask is a new request -- and now that a withdrawn request can be re-sent from
    the requests page, that is one click, not a re-scan.

    `slots` must already have been through normalize_slots (the caller owns
    validation, exactly as create does), and `triage` is a TriageService verdict
    dict or UNSET when the answers were not touched.
    """
    req = _lock_request(db, request_id)
    if req is None:
        return None, ERR_NOT_FOUND
    if req.status != REQUEST_OPEN:
        return None, ("not_open", 409, f"Only an Open request can be edited (this one is {req.status}).")

    now = utcnow()
    if req.expires_at is not None and req.expires_at < now:
        # The expiry job has not swept it yet, but it is over: editing would show
        # the patient a live request that the next sweep closes underneath them.
        return None, ("expired", 409, "This request has already expired. Send a new one instead.")

    # Plain-English, patient-facing, and reused verbatim in the doctors' email.
    # It is a DESCRIPTION, never a control signal -- anything the caller has to
    # branch on comes back as its own key (see consent_granted).
    changed = []
    consent_granted = False

    if slots is not UNSET and slots is not None:
        # REPLACE, never merge: rank is the patient's ordering of the WHOLE list,
        # so a merge would leave two slots claiming the same rank and a doctor's
        # inbox showing a preference order nobody expressed.
        existing = db.query(models.AppointmentRequestSlot).filter(
            models.AppointmentRequestSlot.request_id == req.id
        ).all()
        before = {(s.slot_date, s.slot_time, s.doctor_id, s.rank) for s in existing}
        after = {(s["slot_date"], s["slot_time"], s["doctor_id"], s["rank"]) for s in slots}
        if before != after:
            for row in existing:
                db.delete(row)
            db.flush()
            for slot in slots:
                db.add(models.AppointmentRequestSlot(
                    request_id=req.id,
                    doctor_id=slot["doctor_id"],
                    slot_date=slot["slot_date"],
                    slot_time=slot["slot_time"],
                    slot_start=slot["slot_start"],
                    rank=slot["rank"],
                ))
            changed.append("the times on offer")

    if patient_note is not UNSET:
        text = (patient_note or "").strip() or None
        if text != req.patient_note:
            req.patient_note = text
            changed.append("their note")

    if consent_share_scan is not UNSET:
        value = bool(consent_share_scan)
        if value != bool(req.consent_share_scan):
            req.consent_share_scan = value
            consent_granted = value
            changed.append("permission to see the photograph")

    triage_applied = triage is not UNSET and triage is not None
    if triage_applied:
        req.priority = triage["severity"]
        req.severity_snapshot = triage["severity"]
        req.triage_score = triage["triage_score"]
        req.triage_reasons = json.dumps(triage["triage_reasons"])
        changed.append("the symptom answers")

    if express is not UNSET or triage_applied:
        # Severity may have just moved, and is_express()/ttl_hours() both read it,
        # so the lane and the window are decided together.
        requested = bool(express) if express is not UNSET else bool(req.express)
        value = TriageService.is_express(req.severity_snapshot, requested)
        lane_moved = value != bool(req.express)
        if lane_moved:
            req.express = value
            changed.append("the express lane")
        # Only re-clock the window when the LANE or the SEVERITY actually moved.
        # The client sends `express` on every edit (it is a switch on the form), so
        # recomputing unconditionally would quietly extend the doctors' deadline on
        # an edit that changed nothing -- and would report "nothing changed" while
        # having moved expires_at.
        #
        # And measured from NOW, not from created_at: created_at + a shortened
        # express TTL can already be in the past on a request that has been open a
        # while, which would hand the patient a live request the next expiry sweep
        # kills seconds later.
        if lane_moved or triage_applied:
            req.expires_at = now + datetime.timedelta(
                hours=TriageService.ttl_hours(req.severity_snapshot, requested)
            )

    # Everyone still deciding -- read AFTER the mutations so the caller emails the
    # doctors who can actually act on the new version.
    pending = db.query(models.AppointmentRequestDoctor).filter(
        models.AppointmentRequestDoctor.request_id == req.id,
        models.AppointmentRequestDoctor.response == RESPONSE_PENDING,
    ).all()

    db.flush()
    return {
        "changed": changed,
        "consent_granted": consent_granted,
        "notified_doctor_ids": [link.doctor_id for link in pending] if changed else [],
    }, None


# ======================================================================
# EXPIRY JOB
# ======================================================================
def expire_stale_requests(now=None, notify=True):
    """Close Open requests nobody answered before expires_at.

    Runs next to the existing conflict-SLA job. Without it an express request
    that no doctor opened sits "Open" forever and the patient is left believing
    someone is coming. Returns the number of requests expired.
    """
    from app.core.db import SessionLocal

    db = SessionLocal()
    expired = 0
    try:
        cutoff = now or utcnow()
        stale = db.query(models.AppointmentRequest).filter(
            models.AppointmentRequest.status == REQUEST_OPEN,
            models.AppointmentRequest.expires_at.isnot(None),
            models.AppointmentRequest.expires_at < cutoff,
        ).all()

        for req in stale:
            req.status = REQUEST_EXPIRED
            links = db.query(models.AppointmentRequestDoctor).filter(
                models.AppointmentRequestDoctor.request_id == req.id,
                models.AppointmentRequestDoctor.response == RESPONSE_PENDING,
            ).all()
            for link in links:
                link.response = RESPONSE_WITHDRAWN
                link.responded_at = cutoff
            expired += 1

        db.commit()

        if notify:
            for req in stale:
                try:
                    patient = db.query(models.User).filter(models.User.id == req.patient_id).first()
                    if patient and patient.email:
                        send_email(
                            patient.email,
                            "Your appointment request expired",
                            f"Dear {patient.name},\n\n"
                            f"None of the doctors you invited responded to your appointment request "
                            f"(#{req.id}) in time, so it has been closed.\n\n"
                            f"Please open the app and send a new request -- you can pick different "
                            f"doctors or different times.\n\nRegards,\nDerma AI",
                        )
                except Exception as exc:
                    logger.warning("Expiry notice failed for request %s: %s", req.id, exc)

        if expired:
            logger.info("Expired %s stale appointment request(s).", expired)
    except Exception as exc:
        db.rollback()
        logger.error("Appointment request expiry job failed: %s", exc, exc_info=True)
    finally:
        db.close()
    return expired


__all__ = [
    "MAX_DOCTORS_PER_REQUEST",
    "MAX_SLOTS_PER_REQUEST",
    "SLOT_TAKEN_STATUSES",
    "SLOT_UNIQUE_INDEX",
    "UNSET",
    "utcnow",
    "approved_doctor_ids",
    "normalize_slots",
    "notify_invited_doctors",
    "notify_request_updated",
    "serialize_request",
    "serialize_slot",
    "serialize_invite",
    "accept_request",
    "decline_request",
    "cancel_request",
    "update_request",
    "expire_stale_requests",
    "ERR_NOT_FOUND",
    "ERR_NOT_INVITED",
    "ERR_ALREADY_CLOSED",
    "ERR_ALREADY_RESPONDED",
    "ERR_NO_SLOT",
    "ERR_SLOT_TAKEN",
]
