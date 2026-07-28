"""
Booking, conflicts and appointment lifecycle -- 6 of the 39 contract routes.

===========================================================================
  /api/book-slot                              POST    book_appointment()          [monolith 2283-2448]
  /api/resolve-conflict/<int:appointment_id>  PUT     resolve_conflict()          [monolith 2514-2564]
  /api/doctor-appointments/<int:doctor_id>    GET     get_doctor_appointments()   [monolith 2673-2757]
  /api/patient-appointments/<int:patient_id>  GET     get_patient_appointments()  [monolith 2760-2857]
  /api/update-appointment/<int:appt_id>       PUT     update_appointment_status() [monolith 2859-2931]
  /api/delete-appointment/<int:appt_id>       DELETE  delete_appointment()        [monolith 2937-2968]
===========================================================================

NON-NEGOTIABLES PRESERVED HERE
-----------------------------
* /api/book-slot reads slot_date / slot_time -- NOT date / time -- and has THREE
  success branches; only the third carries `data`:
    (a) new    -> 201 'Appointment successfully booked.'
    (b) rebook -> 200 'Appointment successfully rebooked.'
    (c) urgent override -> 201 + data {'status':'Pending-Conflict','appointment_id':int}
* monolith:2336 contains a PYTHON conditional expression used as a SQLAlchemy
  filter criterion (`Appointment.id != rebook_id if rebook_id else True`, which
  evaluates to the literal True when no rebook id was sent). Copied VERBATIM --
  rewriting it as or_/and_ changes the generated SQL.
* /api/doctor-appointments: 17 keys, hidden_from_doctor == False, SQL
  appointment_date DESC then the Python two-stage sort_appointments_by_priority
  WITH the severity map.
* /api/patient-appointments: 22 keys, id DESC, no priority re-sort. date/time AND
  slot_date/slot_time are both emitted; rating/review AND patient_rating/
  patient_review are both emitted. fees fall back to 0.0 here (NULL in
  /api/doctors/public). scan_info.image_url is the RAW stored value with NO
  leading slash. suggested_slots is null unless status == 'Reassigned'. The
  per-appointment DoctorRating query inside the loop is kept as-is; optimising
  it is a separate task.
* /api/update-appointment 400 short-circuit strings are byte-exact.
* /api/delete-appointment is a SOFT delete: hidden_from_doctor = True.

AUTHORISATION MAPPING (monolith decorator -> permission)
--------------------------------------------------------
@patient_required -> APPOINTMENT_BOOK / APPOINTMENT_READ_OWN
@doctor_required  -> APPOINTMENT_RESOLVE_CONFLICT / APPOINTMENT_MANAGE_OWN /
                     APPOINTMENT_READ_OWN
Every hand-written `request.current_user.get('user_id') != <id>` check is now a
resolve_actor() call with an explicit own_perm/any_perm pair. Because the role
hierarchy is a real set union, a Doctor now holds every Patient permission and
can book and list appointments on their OWN account -- which is the whole point
of the refactor (no second account for a dermatologist who wants a consult).

SLOT_START (new typed shadow column)
------------------------------------
appointments.slot_start is populated on every write here whenever
parse_appointment_datetime() can read the free-text date+time pair, and left
NULL when it cannot. appointment_date / appointment_time keep their free-text
behaviour and stay authoritative for the API. The partial unique index
uq_appt_doctor_slot -- (doctor_id, slot_start) WHERE status IN
('Scheduled','Pending-Conflict') AND slot_start IS NOT NULL -- depends on it.

ONE DELIBERATE EXCEPTION: the urgent-override branch of /api/book-slot inserts a
SECOND appointment on an ALREADY-TAKEN doctor+slot on purpose (both rows go to
Pending-Conflict and cross-link). That row is the one case the double-booking
index exists to forbid, so it is written with slot_start = NULL; populating it
would make the unique index reject the insert and destroy branch (c) of the
contract. The row it conflicts with keeps its own slot_start, so the slot is
still covered by the index exactly once.

===========================================================================
 NEW, ADDITIVE ROUTES IN THIS FILE (the 6 above are untouched)
===========================================================================
  /api/appointments/<int:appt_id>/rebook            POST  rebook_appointment()
  /api/patient-appointments/<int:appt_id>/cancel    POST  patient_cancel_appointment()
  /api/patient-appointments/<int:appt_id>/reschedule POST patient_reschedule_appointment()

WHY THEY EXIST
--------------
* A PATIENT COULD NOT CANCEL ANYTHING. /api/update-appointment and
  /api/delete-appointment are both APPOINTMENT_MANAGE_OWN + a doctor ownership
  check, so the only way a patient got out of a booking was to phone the clinic.
* REBOOK/RESCHEDULE HERE ARE NON-DESTRUCTIVE. The `appointment_id` branch of
  /api/book-slot MUTATES the original row in place (doctor, date, time, status,
  duration and cancellation_reason are all overwritten), which silently destroys
  the record of what was originally booked and cancelled. Both new routes INSERT
  a new row carrying `rebooked_from_id`, so the chain stays readable forever.
  That legacy branch is left exactly as it is -- it is part of the frozen
  contract -- but nothing new calls it.

  CONSEQUENCE THE FRONTEND MUST HANDLE: /reschedule returns a NEW
  appointment_id and marks the old one Cancelled. It does not move a row.
===========================================================================
"""

import logging
from datetime import datetime

from flask import Blueprint, request
from sqlalchemy import and_, or_
from sqlalchemy.exc import IntegrityError

from app import models
from app.core.db import session_scope
from app.core.rbac import (
    ERR_DOCTOR_ONLY,
    ERR_PATIENT_ONLY,
    Permission,
    current_actor,
    current_principal,
    require_permission,
    resolve_actor,
)
from app.core.responses import generate_response
from app.services.conflict_service import (
    _resolve_conflict_pair,
    parse_appointment_datetime,
    sort_appointments_by_priority,
)
from app.services.auth_service import write_audit
from app.services.email_service import send_email
from app.services.scheduling_service import clinic_now, find_next_available_slots
from app.services.serializers import iso_pk, parse_json_field

logger = logging.getLogger(__name__)

# Statuses that make a doctor+slot occupied. Same list _generate_slots_for_date
# and request_matching use.
SLOT_TAKEN_STATUSES = ("Scheduled", "Confirmed", "Completed", "Pending-Conflict")

appointments_bp = Blueprint("appointments", __name__)

# Name of the partial unique index that now blocks the double-booking race. Used
# to turn the resulting IntegrityError back into the contract's existing 400
# instead of leaking a 500.
SLOT_UNIQUE_INDEX = "uq_appt_doctor_slot"


def _slot_start_for(appointment_date, appointment_time):
    """Typed shadow of the free-text pair, or None when it cannot be parsed.

    parse_appointment_datetime() is the monolith's own multi-format guesser
    (conflict_service, moved verbatim), so this never invents a value the SLA job
    would disagree with.
    """
    return parse_appointment_datetime(appointment_date, appointment_time)


# The ONE spelling a stored slot may have. Everything else is a synonym.
CANONICAL_DATE_FORMAT = "%Y-%m-%d"
CANONICAL_TIME_FORMAT = "%H:%M"


def _canonical_slot(appointment_date, appointment_time):
    """(date, time, slot_start) with the free-text pair rewritten canonically.

    WHY: `appointment_time` was only .strip()-ed and stored verbatim, while every
    "is this slot taken?" test is raw string equality. So "9:00 AM" and "09:00"
    are the SAME INSTANT that no check can see as equal: the slot grid renders
    the occupied slot as free, _existing_booking/_slot_taken find nothing, and
    the partial unique index does not cover a Confirmed/Completed row -- two
    patients end up holding one doctor at one time with no Pending-Conflict row,
    no conflict email and no SLA resolution. Normalising on write kills the whole
    class. Unparseable input is left exactly as it came in (the free-text columns
    stay free-text, and slot_start stays NULL, as before).
    """
    parsed = parse_appointment_datetime(appointment_date, appointment_time)
    if parsed is None:
        return appointment_date, appointment_time, None
    return (
        parsed.strftime(CANONICAL_DATE_FORMAT),
        parsed.strftime(CANONICAL_TIME_FORMAT),
        parsed,
    )


def _audit_booking_on_behalf(db, patient_id, doctor_id, date_str, time_str,
                             appointment_id=None, outcome="booked"):
    """Record that somebody booked a slot for SOMEONE ELSE.

    ADDITIVE, and it changes no response. /api/book-slot has always accepted a
    `patient_id` in the body and authorised it via
    `resolve_actor(..., any_perm=APPOINTMENT_MANAGE_ANY)`, which means an ADMIN
    can book on any patient's behalf -- and until now that left no trace
    anywhere. Every other privileged cross-account action in this codebase writes
    an `audit_logs` row (suspensions, verifications, act-as); a booking that
    appears in a patient's history without their involvement has to as well, or
    "who put this appointment here" has no answer.

    Silent in the two ordinary cases:
      * the actor IS the patient -- nothing privileged happened
      * the actor is delegating (X-Act-As-User-Id) -- rbac already wrote an
        `act_as` row for this exact request, and a second row would double-count
    """
    actor = current_actor()
    principal = current_principal()
    if actor is None or principal is None:
        return
    try:
        if int(actor.id) == int(patient_id):
            return
    except (TypeError, ValueError):
        return

    write_audit(
        db,
        "appointment.book.on_behalf",
        actor_user_id=principal.id,
        subject_user_id=int(patient_id),
        target_type="appointment",
        target_id=appointment_id,
        detail=f"{outcome}: doctor={doctor_id} slot={date_str} {time_str}",
    )


def _same_slot_predicate(date_str, time_str):
    """Match a stored row against this slot by string pair OR by typed instant.

    The string pair alone misses a legacy row written in another format; the
    typed instant alone misses a row whose slot_start was never populated. The
    union is what makes the occupancy checks whole.
    """
    predicates = [
        and_(
            models.Appointment.appointment_date == date_str,
            models.Appointment.appointment_time == time_str,
        )
    ]
    parsed = parse_appointment_datetime(date_str, time_str)
    if parsed is not None:
        predicates.append(models.Appointment.slot_start == parsed)
    return or_(*predicates)


# ==========================================
# 9. BOOKING (TASK 15)
# ==========================================
@appointments_bp.route('/api/book-slot', methods=['POST'])
@require_permission(Permission.APPOINTMENT_BOOK, denied_message=ERR_PATIENT_ONLY)
def book_appointment():
    try:
        with session_scope() as db:
            data = request.get_json()
            if not data:
                return generate_response(False, error="Invalid JSON body", status_code=400)

            patient_id = data.get('patient_id')
            doctor_id = data.get('doctor_id')
            scan_id = data.get('scan_id')
            appointment_date = data.get('slot_date')
            appointment_time = data.get('slot_time')
            rebook_appointment_id = data.get('appointment_id')  # Set when "Book Again" on a Cancelled appointment

            if not all([patient_id, doctor_id, appointment_date, appointment_time]):
                return generate_response(False, error="Missing required fields for booking.", status_code=400)

            # Was: `if request.current_user.get('user_id') != patient_id`.
            if not resolve_actor(patient_id,
                                 own_perm=Permission.APPOINTMENT_BOOK,
                                 any_perm=Permission.APPOINTMENT_MANAGE_ANY):
                return generate_response(False, error="Unauthorized ID mismatch", status_code=403)

            # Prevent doctor booking himself (TASK 15)
            if patient_id == doctor_id:
                return generate_response(False, error="Doctor cannot book appointment with themselves.", status_code=400)

            # SECURITY (IDOR): scan_id is attacker-controlled. Without this check
            # any logged-in account could attach ANOTHER patient's scan to its own
            # appointment, and /api/patient-appointments (plus the SSE stream)
            # would then echo that scan's disease, confidence, severity,
            # doctor_comment and image_url straight back to the attacker -- the
            # conflict branch below already validates ownership, but the plain
            # insert and the rebook branch did not. Same rule
            # create_appointment_request enforces (appointment_requests/routes.py).
            if scan_id:
                owned_scan = db.query(models.AIScan).filter(
                    models.AIScan.id == scan_id,
                    models.AIScan.user_id == patient_id
                ).first()
                if owned_scan is None:
                    return generate_response(
                        False, error="That scan belongs to a different patient.", status_code=403
                    )

            # Future date validation (Task 15)
            try:
                appt_date_obj = datetime.strptime(appointment_date, "%Y-%m-%d").date()
                # clinic_now(), not utcnow(): appointment_date is a clinic-local
                # calendar date, so between 00:00 and 05:00 PKT utcnow() was still
                # on YESTERDAY and accepted a past date.
                if appt_date_obj < clinic_now().date():
                    return generate_response(False, error="Cannot book appointments in the past.", status_code=400)
            except ValueError:
                return generate_response(False, error="Invalid date format.", status_code=400)

            # Canonicalise BEFORE the occupancy check below and before either
            # INSERT, so the stored pair is the same spelling the slot grid
            # generates and every string comparison in this file can see it.
            appointment_date, appointment_time, slot_start = _canonical_slot(
                appointment_date, appointment_time
            )

            # BUG FIX: duration pehle yahan kabhi set nahi hoti thi - appointment
            # hamesha model default pe reh jati thi, aur baad mein listing endpoints
            # doctor ki *current* live fee-settings se duration recalculate karte
            # the (galat, kyunki doctor duration badal sakta hai). Ab booking ke
            # waqt doctor ki us-waqt ki duration snapshot karke appointment par
            # save karte hain, taake ye badge kabhi na badle.
            fee_setting_at_booking = db.query(models.DoctorFees).filter_by(doctor_id=doctor_id).first()
            duration_at_booking = fee_setting_at_booking.duration if fee_setting_at_booking and fee_setting_at_booking.duration else '30min'

            existing_booking = db.query(models.Appointment).filter(
                models.Appointment.doctor_id == doctor_id,
                # Was two raw string equalities; now "same instant, however it
                # was spelled". See _same_slot_predicate().
                _same_slot_predicate(appointment_date, appointment_time),
                # BUG FIX: same missing "Confirmed" issue as _generate_slots_for_date -
                # without it, a Confirmed appointment was invisible to this check, so a
                # second (even non-urgent) booking on the same slot sailed straight
                # through to the plain "new_appointment" branch below instead of ever
                # hitting the Pending-Conflict path.
                models.Appointment.status.in_(["Scheduled", "Confirmed", "Completed", "Pending-Conflict"]),
                models.Appointment.id != rebook_appointment_id if rebook_appointment_id else True
            ).first()

            if existing_booking:
                # Slot pe already ek open conflict chal raha hai - teesra patient
                # add nahi hone dena, warna doctor ke liye unmanageable ho jayega.
                if existing_booking.status == "Pending-Conflict":
                    return generate_response(False, error="This slot is already booked.", status_code=400)

                # A CONSULTATION THAT ALREADY HAPPENED IS NOT OVERRIDABLE.
                # "Completed" is in the slot-taken list so the slot reads as busy,
                # but the urgent-override branch below would rewrite that row to
                # Pending-Conflict and the SLA resolver could then mark a visit the
                # patient actually attended as "Reassigned" -- destroying the
                # completed record and its rateability. Terminal states only ever
                # produce the plain "already booked" refusal.
                if existing_booking.status == "Completed":
                    return generate_response(False, error="This slot is already booked.", status_code=400)

                # Naye booking wale patient ki severity DB se check karo (scan record
                # se) - request body se NAHI, warna koi bhi "urgent" bol kar
                # kisi ka slot le sakta hai. Sirf server-verified CRITICAL/URGENT
                # ko override power milti hai.
                incoming_severity = "ROUTINE"
                if scan_id:
                    incoming_scan = db.query(models.AIScan).filter(
                        models.AIScan.id == scan_id,
                        models.AIScan.user_id == patient_id
                    ).first()
                    if incoming_scan:
                        incoming_severity = incoming_scan.severity_level or "ROUTINE"

                if incoming_severity not in ("CRITICAL", "URGENT"):
                    return generate_response(False, error="This slot is already booked.", status_code=400)

                # Server-verified urgent/critical patient -> dono appointments ko
                # Pending-Conflict banao. Koi bhi "Confirmed" nahi hota jab tak
                # doctor (ya SLA timeout) resolve na kare - single source of truth.
                #
                # slot_start stays NULL on THIS row only: it is a deliberate
                # second booking of an occupied doctor+slot, i.e. precisely what
                # uq_appt_doctor_slot forbids. The row it conflicts with already
                # carries the typed slot_start, so the slot remains indexed once.
                new_conflict_appointment = models.Appointment(
                    patient_id=patient_id,
                    doctor_id=doctor_id,
                    scan_id=scan_id,
                    appointment_date=appointment_date,
                    appointment_time=appointment_time,
                    status="Pending-Conflict",
                    duration=duration_at_booking,
                    slot_start=None
                )
                db.add(new_conflict_appointment)
                db.flush()  # id chahiye conflict_with_id set karne ke liye

                existing_booking.status = "Pending-Conflict"
                existing_booking.conflict_with_id = new_conflict_appointment.id
                new_conflict_appointment.conflict_with_id = existing_booking.id
                _audit_booking_on_behalf(
                    db, patient_id, doctor_id, appointment_date, appointment_time,
                    appointment_id=new_conflict_appointment.id,
                    outcome="urgent override (Pending-Conflict)",
                )
                db.commit()

                try:
                    doctor_user = db.query(models.User).filter_by(id=doctor_id).first()
                    if doctor_user and doctor_user.email:
                        send_email(
                            doctor_user.email,
                            "Action Required: Urgent Booking Conflict",
                            f"Dear Dr. {doctor_user.name},\n\n"
                            f"Ek {incoming_severity} priority patient ne {appointment_date} {appointment_time} "
                            f"ka slot select kiya hai jo pehle se book hai. Dono appointments abhi 'Pending-Conflict' "
                            f"status mein hain - kisi ek ko confirm karne ke liye dashboard par jayen.\n\n"
                            f"Agar aap time par decide nahi karte, system SLA timeout ke baad severity ke hisaab se "
                            f"khud resolve kar dega.\n\nThank you."
                        )
                except Exception as email_err:
                    logger.warning(f"Conflict Notification Email Failure: {str(email_err)}")

                logger.info(
                    f"Booking conflict created: slot {appointment_date} {appointment_time} doctor {doctor_id} - "
                    f"appointments {existing_booking.id} vs {new_conflict_appointment.id}"
                )
                return generate_response(
                    True,
                    message="Slot was already booked, but your case was flagged urgent/critical - the doctor has been notified to confirm priority.",
                    data={"status": "Pending-Conflict", "appointment_id": new_conflict_appointment.id},
                    status_code=201
                )

            # Rebook flow: reuse the same (Cancelled) appointment row instead of inserting a duplicate
            if rebook_appointment_id:
                appt = db.query(models.Appointment).filter(
                    models.Appointment.id == rebook_appointment_id,
                    models.Appointment.patient_id == patient_id
                ).first()
                if not appt:
                    return generate_response(False, error="Original appointment not found.", status_code=404)
                if appt.status not in ('Cancelled', 'Reassigned'):
                    return generate_response(False, error="Only cancelled or reassigned appointments can be rebooked.", status_code=400)

                appt.doctor_id = doctor_id
                appt.scan_id = scan_id
                appt.appointment_date = appointment_date
                appt.appointment_time = appointment_time
                appt.status = "Scheduled"
                appt.duration = duration_at_booking
                appt.cancellation_reason = None
                appt.slot_start = slot_start
                _audit_booking_on_behalf(
                    db, patient_id, doctor_id, appointment_date, appointment_time,
                    appointment_id=appt.id, outcome="rebooked",
                )
                db.commit()
                logger.info(f"Appointment {rebook_appointment_id} rebooked by patient {patient_id}")
                return generate_response(True, message="Appointment successfully rebooked.", status_code=200)

            new_appointment = models.Appointment(
                patient_id=patient_id,
                doctor_id=doctor_id,
                scan_id=scan_id,
                appointment_date=appointment_date,
                appointment_time=appointment_time,
                status="Scheduled",
                duration=duration_at_booking,
                slot_start=slot_start
            )
            db.add(new_appointment)
            db.flush()  # need the id for the audit row's target_id
            _audit_booking_on_behalf(
                db, patient_id, doctor_id, appointment_date, appointment_time,
                appointment_id=new_appointment.id,
            )
            db.commit()
            logger.info(f"New appointment booked: Patient {patient_id} with Doctor {doctor_id}")
            return generate_response(True, message="Appointment successfully booked.", status_code=201)
    except IntegrityError as e:
        # Two patients raced past the "is this slot taken?" SELECT above and both
        # tried to INSERT. The monolith double-booked silently; uq_appt_doctor_slot
        # now stops the loser, and we hand back the SAME 400 the sequential path
        # already returns so the API surface is unchanged.
        if SLOT_UNIQUE_INDEX in str(getattr(e, "orig", "")) or SLOT_UNIQUE_INDEX in str(e):
            logger.warning(f"Double-booking race blocked by {SLOT_UNIQUE_INDEX}: {e}")
            return generate_response(False, error="This slot is already booked.", status_code=400)
        logger.error(f"Book Appointment Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    except Exception as e:
        logger.error(f"Book Appointment Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ==========================================
# 9B. URGENT BOOKING CONFLICT RESOLUTION
# ==========================================
@appointments_bp.route('/api/resolve-conflict/<int:appointment_id>', methods=['PUT'])
@require_permission(Permission.APPOINTMENT_RESOLVE_CONFLICT, denied_message=ERR_DOCTOR_ONLY)
def resolve_conflict(appointment_id):
    """
    Doctor conflict ke dono mein se jis appointment ko confirm karna chahta
    hai, uska id yahan bhejta hai - dusra automatically 'Reassigned' ho jata
    hai. Reason optional hai (default preset use hota hai).
    """
    try:
        with session_scope() as db:
            data = request.get_json() or {}
            reason = data.get('reason') or "Urgent patient requires immediate attention"

            winner_appt = db.query(models.Appointment).filter(models.Appointment.id == appointment_id).first()
            if not winner_appt:
                return generate_response(False, error="Appointment not found", status_code=404)

            # Was: `if winner_appt.doctor_id != request.current_user.get('user_id')`.
            if not resolve_actor(winner_appt.doctor_id,
                                 own_perm=Permission.APPOINTMENT_RESOLVE_CONFLICT,
                                 any_perm=Permission.APPOINTMENT_MANAGE_ANY):
                return generate_response(False, error="Unauthorized", status_code=403)

            if winner_appt.status != "Pending-Conflict" or not winner_appt.conflict_with_id:
                return generate_response(False, error="This appointment has no active conflict to resolve.", status_code=400)

            loser_appt = db.query(models.Appointment).filter(models.Appointment.id == winner_appt.conflict_with_id).first()
            if not loser_appt:
                return generate_response(False, error="Linked conflicting appointment not found.", status_code=404)

            # BOTH SIDES MUST STILL BE IN THE CONFLICT. When two writers raced
            # onto one slot the links can end up asymmetric (A<->C linked, B->A),
            # and the doctor's card renders "give the slot to..." on the dangling
            # row too -- one click then flipped an ALREADY-CONFIRMED, already
            # resolved appointment to "Reassigned" and emailed that patient "could
            # not be kept". Refuse instead; the SLA sweep releases the stale row.
            if loser_appt.status != "Pending-Conflict":
                return generate_response(
                    False,
                    error="This appointment has no active conflict to resolve.",
                    status_code=400,
                )

            suggested_slots = _resolve_conflict_pair(
                db, winner_appt, loser_appt,
                resolved_by_id=request.current_user.get('user_id'),
                reason=reason,
                auto_resolved=False
            )

            logger.info(f"Conflict resolved by doctor: winner={winner_appt.id}, reassigned={loser_appt.id}")
            return generate_response(
                True,
                message="Conflict resolved.",
                data={
                    "confirmed_appointment_id": winner_appt.id,
                    "reassigned_appointment_id": loser_appt.id,
                    "suggested_slots_for_reassigned_patient": suggested_slots
                },
                status_code=200
            )
    except Exception as e:
        logger.error(f"Resolve Conflict Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ==========================================
# 10. APPOINTMENTS LISTING & UPDATES
# ==========================================
@appointments_bp.route('/api/doctor-appointments/<int:doctor_id>', methods=['GET'])
@require_permission(Permission.APPOINTMENT_READ_OWN, denied_message=ERR_DOCTOR_ONLY)
def get_doctor_appointments(doctor_id):
    # Was: `if request.current_user.get('user_id') != doctor_id`.
    if not resolve_actor(doctor_id,
                         own_perm=Permission.APPOINTMENT_READ_OWN,
                         any_perm=Permission.APPOINTMENT_READ_ANY):
        return generate_response(False, error="Unauthorized", status_code=403)

    try:
        with session_scope() as db:
            appointments = db.query(models.Appointment).filter(
                models.Appointment.doctor_id == doctor_id,
                # Doctor ne apni dashboard se "delete" kiya hua appointment yahan
                # dobara nahi dikhna chahiye - patient side is filter se unaffected hai.
                models.Appointment.hidden_from_doctor == False
            ).order_by(models.Appointment.appointment_date.desc()).all()

            fee_setting = db.query(models.DoctorFees).filter_by(doctor_id=doctor_id).first()
            # BUG FIX: appt ki apni saved duration use karo, doctor ki current
            # live fee-setting se recalculate mat karo (warna doctor duration
            # badalte hi purani sab appointments bhi badal jayengi).
            default_duration_fallback = fee_setting.duration if fee_setting and fee_setting.duration else "30min"

            # N+1 Optimization
            patient_ids = [a.patient_id for a in appointments]
            patients_map = {p.id: p for p in db.query(models.User).filter(models.User.id.in_(patient_ids)).all()}

            scan_ids = [a.scan_id for a in appointments if a.scan_id]
            scans_map = {s.id: s for s in db.query(models.AIScan).filter(models.AIScan.id.in_(scan_ids)).all()}

            # Severity map scans_map se pehle banao taake conflict groups severity
            # ke hisaab se sort ho sakein (CRITICAL/URGENT pehle)
            severity_by_scan_id = {sid: scan.severity_level or "ROUTINE" for sid, scan in scans_map.items()}
            appointments = sort_appointments_by_priority(appointments, severity_by_scan_id)

            appt_ids = [a.id for a in appointments]
            ratings = db.query(models.DoctorRating).filter(
                (models.DoctorRating.scan_id.in_(scan_ids)) | (models.DoctorRating.appointment_id.in_(appt_ids))
            ).all()

            rating_by_scan = {r.scan_id: r for r in ratings if r.scan_id}
            rating_by_appt = {r.appointment_id: r for r in ratings if r.appointment_id}

            results = []
            for appt in appointments:
                disease_name = "Unknown"
                scan = scans_map.get(appt.scan_id)
                if scan:
                    disease_name = scan.prediction_result

                rating_record = rating_by_scan.get(appt.scan_id) or rating_by_appt.get(appt.id)
                patient = patients_map.get(appt.patient_id)

                triage_reasons = []
                if scan and scan.triage_reasons:
                    triage_reasons = parse_json_field(scan.triage_reasons, [])

                results.append({
                    "id": appt.id,
                    "patient_name": patient.name if patient else "Unknown Patient",
                    "patient_email": patient.email if patient else "No Email",
                    "slot_date": appt.appointment_date,
                    "slot_time": appt.appointment_time,
                    "disease": disease_name,
                    "status": appt.status,
                    "scan_id": appt.scan_id,
                    "duration": appt.duration or default_duration_fallback,
                    "patient_rating": rating_record.rating if rating_record else None,
                    "patient_review": rating_record.review if rating_record else None,
                    # --- Triage & conflict info (doctor dashboard badge/grouping ke liye) ---
                    "severity": scan.severity_level if scan else "ROUTINE",
                    "triage_reasons": triage_reasons,
                    "is_conflict": appt.status == "Pending-Conflict",
                    "conflict_with_id": appt.conflict_with_id,
                    "auto_resolved": appt.auto_resolved,
                    "resolved_at": iso_pk(appt.resolved_at),
                    # ADDITIVE (July 2026): when the row was booked, Pakistan
                    # wall-clock. Same key the patient list and the admin
                    # console emit.
                    "created_at": iso_pk(appt.created_at)
                })

            return generate_response(True, data=results, status_code=200)
    except Exception as e:
        logger.error(f"Doctor Appointments Fetch Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# TASK 6: ENHANCED PATIENT APPOINTMENTS
@appointments_bp.route('/api/patient-appointments/<int:patient_id>', methods=['GET'])
@require_permission(Permission.APPOINTMENT_READ_OWN, denied_message=ERR_PATIENT_ONLY)
def get_patient_appointments(patient_id):
    # Was: `if request.current_user.get('user_id') != patient_id`. A Doctor now
    # holds APPOINTMENT_READ_OWN, so they can read their OWN patient-side
    # appointments without a second account.
    if not resolve_actor(patient_id,
                         own_perm=Permission.APPOINTMENT_READ_OWN,
                         any_perm=Permission.APPOINTMENT_READ_ANY):
        return generate_response(False, error="Unauthorized", status_code=403)

    try:
        with session_scope() as db:
            appointments = db.query(models.Appointment).filter(
                models.Appointment.patient_id == patient_id
            ).order_by(models.Appointment.id.desc()).all()

            # N+1 Optimization
            doctor_ids = [a.doctor_id for a in appointments]
            doctors_map = {d.id: d for d in db.query(models.User).filter(models.User.id.in_(doctor_ids)).all()}
            profiles_map = {p.user_id: p for p in db.query(models.DoctorProfile).filter(models.DoctorProfile.user_id.in_(doctor_ids)).all()}
            fees_map = {f.doctor_id: f for f in db.query(models.DoctorFees).filter(models.DoctorFees.doctor_id.in_(doctor_ids)).all()}

            scan_ids = [a.scan_id for a in appointments if a.scan_id]
            scans_map = {s.id: s for s in db.query(models.AIScan).filter(models.AIScan.id.in_(scan_ids)).all()}

            results = []
            for appt in appointments:
                doctor_user = doctors_map.get(appt.doctor_id)
                doctor_profile = profiles_map.get(appt.doctor_id)

                disease_name = None
                scan_info = None
                scan = scans_map.get(appt.scan_id)
                if scan:
                    disease_name = scan.prediction_result
                    scan_info = {
                        "id": scan.id,
                        # RAW stored value: no leading slash here, unlike the
                        # sibling scan listings. Deliberate.
                        "image_url": scan.image_url,
                        "disease": scan.prediction_result,
                        "confidence": scan.confidence,
                        "doctor_comment": scan.doctor_comment,
                        "invite_to_clinic": scan.invite_to_clinic,
                        "severity": scan.severity_level or "ROUTINE"
                    }

                fee_setting = fees_map.get(appt.doctor_id)
                # BUG FIX: appt ki apni saved duration use karo, doctor ki current
                # live fee-setting se recalculate mat karo (warna doctor duration
                # badalte hi purani sab appointments bhi badal jayengi).
                default_duration_fallback = fee_setting.duration if fee_setting and fee_setting.duration else "30min"
                fees_obj = {
                    "pkr": fee_setting.pkr if fee_setting else 0.0,
                    "usd": fee_setting.usd if fee_setting else 0.0
                }

                # One query per appointment, exactly as the monolith did. The
                # doctor-side route pre-fetches; this one does not. Optimising it
                # would change nothing observable but is out of scope for a move.
                rating_record = db.query(models.DoctorRating).filter(
                    models.DoctorRating.patient_id == patient_id,
                    (models.DoctorRating.scan_id == appt.scan_id) | (models.DoctorRating.appointment_id == appt.id)
                ).first()

                # Reassigned (bumped) patient ke liye live suggested slots -
                # doctor availability change ho sakti hai, isliye har fetch pe
                # taaza compute karte hain instead of storing stale data.
                suggested_slots = None
                if appt.status == "Reassigned":
                    suggested_slots = find_next_available_slots(db, appt.doctor_id, appt.appointment_date, limit=3)

                results.append({
                    "id": appt.id,
                    "doctor_id": appt.doctor_id,
                    "doctor_name": doctor_user.name if doctor_user else "Expert",
                    "doctor_profile": {
                        "specialty": doctor_profile.specialty if doctor_profile else "",
                        "profile_image": doctor_profile.profile_image if doctor_profile else None
                    },
                    "date": appt.appointment_date,
                    "time": appt.appointment_time,
                    "slot_date": appt.appointment_date,
                    "slot_time": appt.appointment_time,
                    "disease": disease_name,
                    "duration": appt.duration or default_duration_fallback,
                    "fees": fees_obj,
                    "status": appt.status,
                    "cancellation_reason": appt.cancellation_reason,
                    "scan_id": appt.scan_id,
                    "scan_info": scan_info,
                    "rating": rating_record.rating if rating_record else None,
                    "review": rating_record.review if rating_record else None,
                    "patient_rating": rating_record.rating if rating_record else None,
                    "patient_review": rating_record.review if rating_record else None,
                    # --- Conflict info ---
                    "is_conflict": appt.status == "Pending-Conflict",
                    "conflict_with_id": appt.conflict_with_id,
                    "suggested_slots": suggested_slots,
                    # ADDITIVE (July 2026): when the row was booked, Pakistan
                    # wall-clock. Same key the doctor list and the admin
                    # console emit.
                    "created_at": iso_pk(appt.created_at)
                })

            return generate_response(True, data=results, status_code=200)
    except Exception as e:
        logger.error(f"Patient Appointments Fetch Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


@appointments_bp.route('/api/update-appointment/<int:appt_id>', methods=['PUT'])
@require_permission(Permission.APPOINTMENT_MANAGE_OWN, denied_message=ERR_DOCTOR_ONLY)
def update_appointment_status(appt_id):
    try:
        with session_scope() as db:
            data = request.get_json()
            if not data or 'status' not in data:
                return generate_response(False, error="Status parameter is required", status_code=400)

            valid_statuses = ['Scheduled', 'Confirmed', 'Completed', 'Cancelled']
            new_status = data.get('status')
            cancellation_reason = data.get('reason')
            if new_status not in valid_statuses:
                return generate_response(False, error="Invalid appointment status", status_code=400)

            appt = db.query(models.Appointment).filter(models.Appointment.id == appt_id).first()
            if not appt:
                return generate_response(False, error="Appointment not found", status_code=404)

            # Was: `if appt.doctor_id != request.current_user.get('user_id')`.
            if not resolve_actor(appt.doctor_id,
                                 own_perm=Permission.APPOINTMENT_MANAGE_OWN,
                                 any_perm=Permission.APPOINTMENT_MANAGE_ANY):
                return generate_response(False, error="Unauthorized", status_code=403)

            if appt.status == "Pending-Conflict":
                return generate_response(
                    False,
                    error="This appointment has an active booking conflict. Use /api/resolve-conflict to resolve it first.",
                    status_code=400
                )

            # BUG FIX: pehle yahan koi check nahi tha ke appointment already isi
            # status pe hai ya nahi - agar frontend se (ya double-click/race se)
            # same status dobara bheja jata, ye silently reprocess ho kar patient
            # ko dobara wahi "Status Updated" email bhi bhej deta tha. Ab clear
            # message ke sath short-circuit karte hain, koi duplicate email nahi.
            if appt.status == new_status:
                return generate_response(
                    False,
                    error=f"This appointment is already {new_status}.",
                    status_code=400
                )

            appt.status = new_status
            if new_status == 'Cancelled':
                appt.cancellation_reason = cancellation_reason
            db.commit()

            try:
                patient = db.query(models.User).filter_by(id=appt.patient_id).first()
                if patient and patient.email:
                    doctor = db.query(models.User).filter_by(id=appt.doctor_id).first()
                    doctor_name = doctor.name if doctor else "Doctor"

                    subject = f"Appointment Update - SkinCare Status: {new_status}"
                    body = (
                        f"Dear {patient.name},\n\n"
                        f"Your appointment with Dr. {doctor_name} scheduled on {appt.appointment_date} "
                        f"has been updated.\n\n"
                        f"New Status: {new_status}\n"
                        + (f"Reason: {cancellation_reason}\n\n" if new_status == 'Cancelled' and cancellation_reason else "\n")
                        + f"Thank you for using SkinCare App."
                    )
                    send_email(patient.email, subject, body)
            except Exception as email_err:
                logger.warning(f"Notification Email Failure: {str(email_err)}")

            logger.info(f"Appointment {appt_id} status updated to {new_status}")
            return generate_response(True, message=f"Appointment status updated to {new_status}", status_code=200)
    except Exception as e:
        logger.error(f"Update Appointment Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ==========================================
# 11. DELETE APPOINTMENT (TASK 3, 11)
# ==========================================
@appointments_bp.route('/api/delete-appointment/<int:appt_id>', methods=['DELETE'])
@require_permission(Permission.APPOINTMENT_MANAGE_OWN, denied_message=ERR_DOCTOR_ONLY)
def delete_appointment(appt_id):
    try:
        with session_scope() as db:
            current_doctor_id = request.current_user.get('user_id')
            appt = db.query(models.Appointment).filter(models.Appointment.id == appt_id).first()
            if not appt:
                return generate_response(False, error="Appointment not found", status_code=404)

            # Was: `if appt.doctor_id != current_doctor_id`.
            if not resolve_actor(appt.doctor_id,
                                 own_perm=Permission.APPOINTMENT_MANAGE_OWN,
                                 any_perm=Permission.APPOINTMENT_MANAGE_ANY):
                return generate_response(False, error="Unauthorized to delete this appointment", status_code=403)

            # BUG FIX: pehle yahan appointment row hard-delete hoti thi - lekin
            # ye wahi row hai jo patient ki "My Appointments" history bhi use
            # karti hai (shared table, do alag listing endpoints). Doctor jab
            # apni dashboard se ek appointment "delete" karta tha, row hi DB se
            # gayab ho jati thi, isliye patient ki taraf se bhi wo booking record
            # permanently ghayab ho jati thi - bina unhe kuch pata chale, bina
            # koi notification. Ab hard-delete nahi karte - sirf doctor ki apni
            # dashboard-listing se hide karte hain (hidden_from_doctor = True).
            # Patient ka record, rating linkage, sab kuch safe/unchanged rehta hai.
            appt.hidden_from_doctor = True
            db.commit()
            logger.info(f"Appointment {appt_id} hidden from Doctor {current_doctor_id} dashboard (patient record preserved)")
            return generate_response(True, message="Appointment removed from your dashboard", status_code=200)
    except Exception as e:
        logger.error(f"Delete Appointment Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ======================================================================
#  NEW, ADDITIVE ROUTES BELOW THIS LINE
#  Nothing above is modified. See the module docstring for the rationale.
# ======================================================================
def _validated_future_date(date_str):
    """(date_obj, error_message). Same wording /api/book-slot uses."""
    try:
        parsed = datetime.strptime(date_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None, "Invalid date format."
    if parsed < clinic_now().date():
        return None, "Cannot book appointments in the past."
    return parsed, None


def _slot_taken(db, doctor_id, date_str, time_str, exclude_id=None):
    query = db.query(models.Appointment).filter(
        models.Appointment.doctor_id == doctor_id,
        _same_slot_predicate(date_str, time_str),
        models.Appointment.status.in_(SLOT_TAKEN_STATUSES),
    )
    if exclude_id is not None:
        query = query.filter(models.Appointment.id != exclude_id)
    return query.first()


def _duration_snapshot(db, doctor_id):
    """Freeze the doctor's CURRENT consultation length onto the new row.

    The listing endpoints used to recompute duration from the doctor's live fee
    settings, so changing your slot length silently rewrote every appointment
    you had ever had. Snapshotting is the fix; new rows must keep doing it.
    """
    fee = db.query(models.DoctorFees).filter_by(doctor_id=doctor_id).first()
    return fee.duration if fee and fee.duration else '30min'


def _appointment_payload(appt, extra=None):
    payload = {
        "appointment_id": appt.id,
        "patient_id": appt.patient_id,
        "doctor_id": appt.doctor_id,
        "scan_id": appt.scan_id,
        "slot_date": appt.appointment_date,
        "slot_time": appt.appointment_time,
        "date": appt.appointment_date,
        "time": appt.appointment_time,
        # slot_start is clinic wall-clock already -- serialized VERBATIM.
        "slot_start": appt.slot_start.isoformat() if appt.slot_start else None,
        # created_at is stored UTC -- served as Pakistan wall-clock.
        "created_at": iso_pk(appt.created_at),
        "status": appt.status,
        "duration": appt.duration,
        "cancellation_reason": appt.cancellation_reason,
        "note": appt.note,
        "rebooked_from_id": appt.rebooked_from_id,
        "request_id": appt.request_id,
        "conflict_with_id": appt.conflict_with_id,
    }
    if extra:
        payload.update(extra)
    return payload


def _insert_rebooking(db, source_appt, doctor_id, date_str, time_str, note=None):
    """The shared INSERT behind /rebook and /reschedule.

    NON-DESTRUCTIVE BY CONSTRUCTION: `source_appt` is read, never written, and
    the new row records where it came from via rebooked_from_id.
    """
    date_str, time_str, slot_start = _canonical_slot(date_str, time_str)
    new_appt = models.Appointment(
        patient_id=source_appt.patient_id,
        doctor_id=doctor_id,
        scan_id=source_appt.scan_id,
        appointment_date=date_str,
        appointment_time=time_str,
        status="Scheduled",
        duration=_duration_snapshot(db, doctor_id),
        slot_start=slot_start,
        rebooked_from_id=source_appt.id,
        request_id=source_appt.request_id,
        note=note,
    )
    db.add(new_appt)
    db.flush()
    return new_appt


def _notify_appointment_change(db, appt, subject, body_for_patient=None, body_for_doctor=None):
    try:
        if body_for_patient:
            patient = db.query(models.User).filter_by(id=appt.patient_id).first()
            if patient and patient.email:
                send_email(patient.email, subject, body_for_patient.format(name=patient.name))
        if body_for_doctor:
            doctor = db.query(models.User).filter_by(id=appt.doctor_id).first()
            if doctor and doctor.email:
                send_email(doctor.email, subject, body_for_doctor.format(name=doctor.name))
    except Exception as email_err:
        logger.warning(f"Appointment change notification failure: {email_err}")


# ==========================================
# 12. RE-APPOINTMENT AN OLD RECORD (NEW)
# ==========================================
@appointments_bp.route('/api/appointments/<int:appt_id>/rebook', methods=['POST'])
@require_permission(Permission.APPOINTMENT_BOOK, denied_message=ERR_PATIENT_ONLY)
def rebook_appointment(appt_id):
    """"Book again" against a past appointment, WITHOUT destroying it.

    Body: {slot_date, slot_time, note?}. Inserts a NEW appointment whose
    rebooked_from_id points at `appt_id`; the original row is never written to,
    so the patient's history keeps showing what was actually booked and what
    happened to it.

    `note` is persisted on the new row (appointments.note), echoed back, and
    included in the doctor's email.
    """
    data = request.get_json(silent=True) or {}
    slot_date = (data.get('slot_date') or '').strip()
    slot_time = (data.get('slot_time') or '').strip()
    note = (data.get('note') or '').strip() or None

    if not slot_date or not slot_time:
        return generate_response(False, error="Missing required fields for booking.", status_code=400)

    _parsed, date_error = _validated_future_date(slot_date)
    if date_error:
        return generate_response(False, error=date_error, status_code=400)

    try:
        with session_scope() as db:
            source = db.query(models.Appointment).filter(models.Appointment.id == appt_id).first()
            if not source:
                return generate_response(False, error="Appointment not found", status_code=404)

            if not resolve_actor(source.patient_id,
                                 own_perm=Permission.APPOINTMENT_BOOK,
                                 any_perm=Permission.APPOINTMENT_MANAGE_ANY):
                return generate_response(False, error="Unauthorized", status_code=403)

            if _slot_taken(db, source.doctor_id, slot_date, slot_time):
                return generate_response(False, error="This slot is already booked.", status_code=409)

            new_appt = _insert_rebooking(db, source, source.doctor_id, slot_date, slot_time, note=note)
            new_id = new_appt.id
            db.commit()

            _notify_appointment_change(
                db, new_appt,
                subject="Appointment booked again",
                body_for_doctor=(
                    "Dear Dr. {name},\n\n"
                    f"A returning patient re-booked with you for {slot_date} at {slot_time}.\n"
                    + (f"Patient note: {note}\n" if note else "")
                    + "\nRegards,\nDerma AI"
                ),
            )

            logger.info(f"Appointment {appt_id} re-booked as {new_id} (original preserved)")
            return generate_response(
                True,
                message="Appointment successfully re-booked.",
                data=_appointment_payload(new_appt, {"note": note, "rebooked_from_id": appt_id}),
                status_code=201,
            )
    except IntegrityError as e:
        if SLOT_UNIQUE_INDEX in str(getattr(e, "orig", "")) or SLOT_UNIQUE_INDEX in str(e):
            logger.warning(f"Rebook blocked by {SLOT_UNIQUE_INDEX}: {e}")
            return generate_response(False, error="This slot is already booked.", status_code=409)
        logger.error(f"Rebook Appointment Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    except Exception as e:
        logger.error(f"Rebook Appointment Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ==========================================
# 13. PATIENT-SIDE CANCEL (NEW)
# ==========================================
@appointments_bp.route('/api/patient-appointments/<int:appt_id>/cancel', methods=['POST'])
@require_permission(Permission.APPOINTMENT_MANAGE_OWN, denied_message=ERR_PATIENT_ONLY)
def patient_cancel_appointment(appt_id):
    """The patient cancels their OWN appointment. Body: {reason?}.

    Ownership is on Appointment.patient_id (the two existing mutation routes
    check doctor_id, which is why a patient could not cancel anything).

    CANCELLING ONE HALF OF A CONFLICT RELEASES THE OTHER. If this row is in
    Pending-Conflict, the surviving row goes back to 'Scheduled' and both
    conflict links are cleared, so the doctor is not left staring at a
    half-conflict the SLA job can never resolve.
    """
    data = request.get_json(silent=True) or {}
    reason = (data.get('reason') or '').strip() or "Cancelled by the patient."

    try:
        with session_scope() as db:
            appt = db.query(models.Appointment).filter(models.Appointment.id == appt_id).first()
            if not appt:
                return generate_response(False, error="Appointment not found", status_code=404)

            if not resolve_actor(appt.patient_id,
                                 own_perm=Permission.APPOINTMENT_MANAGE_OWN,
                                 any_perm=Permission.APPOINTMENT_MANAGE_ANY):
                return generate_response(False, error="Unauthorized", status_code=403)

            if appt.status == "Cancelled":
                return generate_response(False, error="This appointment is already Cancelled.", status_code=400)
            if appt.status == "Completed":
                return generate_response(False, error="A completed appointment cannot be cancelled.", status_code=400)

            released_id = None
            if appt.status == "Pending-Conflict" and appt.conflict_with_id:
                other = db.query(models.Appointment).filter(
                    models.Appointment.id == appt.conflict_with_id
                ).first()
                if other is not None:
                    # Only a row that is ITSELF still in the conflict gets reset.
                    # Hard-coding "Scheduled" demoted an already-Confirmed
                    # survivor (and could resurrect a "Reassigned" loser into an
                    # unflagged live double-booking) whenever the conflict graph
                    # was not a clean pair -- which happens whenever two writers
                    # raced onto the same slot. Anything else keeps its status;
                    # only the dangling link is cleared.
                    if other.status == "Pending-Conflict":
                        other.status = "Scheduled"
                        released_id = other.id
                    other.conflict_with_id = None
                appt.conflict_with_id = None

            appt.status = "Cancelled"
            appt.cancellation_reason = reason
            # A cancelled row is outside uq_appt_doctor_slot's predicate, so the
            # slot is freed for everyone else the moment this commits.
            appt.slot_start = None
            db.flush()

            if released_id is not None:
                other = db.query(models.Appointment).filter(models.Appointment.id == released_id).first()
                if other is not None and other.slot_start is None:
                    # The survivor may be the urgent-override row, which was
                    # written with slot_start NULL on purpose. Now that it holds
                    # the slot alone, give it the typed value back so the unique
                    # index covers it again.
                    other.slot_start = _slot_start_for(other.appointment_date, other.appointment_time)

            db.commit()

            _notify_appointment_change(
                db, appt,
                subject="Appointment cancelled by the patient",
                body_for_doctor=(
                    "Dear Dr. {name},\n\n"
                    f"A patient cancelled their appointment on {appt.appointment_date} "
                    f"at {appt.appointment_time}.\nReason: {reason}\n\nRegards,\nDerma AI"
                ),
            )

            logger.info(f"Appointment {appt_id} cancelled by patient {appt.patient_id}")
            return generate_response(
                True,
                message="Appointment cancelled.",
                data=_appointment_payload(appt, {"conflict_released_appointment_id": released_id}),
                status_code=200,
            )
    except Exception as e:
        logger.error(f"Patient Cancel Appointment Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ==========================================
# 14. PATIENT-SIDE RESCHEDULE (NEW)
# ==========================================
@appointments_bp.route('/api/patient-appointments/<int:appt_id>/reschedule', methods=['POST'])
@require_permission(Permission.APPOINTMENT_MANAGE_OWN, denied_message=ERR_PATIENT_ONLY)
def patient_reschedule_appointment(appt_id):
    """Move an ACTIVE appointment to a new time. Body: {slot_date, slot_time, note?}.

    NON-DESTRUCTIVE, and this is the part the frontend must not get wrong: the
    original row is set to 'Cancelled' with the reason "Rescheduled by the
    patient." and a NEW row is inserted with rebooked_from_id pointing at it.
    THE RESPONSE THEREFORE CARRIES A NEW appointment_id -- the old id keeps
    existing and keeps showing in history.

    Doing it this way rather than mutating date/time in place is what keeps the
    audit trail of "you promised me Tuesday" intact.
    """
    data = request.get_json(silent=True) or {}
    slot_date = (data.get('slot_date') or '').strip()
    slot_time = (data.get('slot_time') or '').strip()
    note = (data.get('note') or '').strip() or None

    if not slot_date or not slot_time:
        return generate_response(False, error="Missing required fields for booking.", status_code=400)

    _parsed, date_error = _validated_future_date(slot_date)
    if date_error:
        return generate_response(False, error=date_error, status_code=400)

    try:
        with session_scope() as db:
            appt = db.query(models.Appointment).filter(models.Appointment.id == appt_id).first()
            if not appt:
                return generate_response(False, error="Appointment not found", status_code=404)

            if not resolve_actor(appt.patient_id,
                                 own_perm=Permission.APPOINTMENT_MANAGE_OWN,
                                 any_perm=Permission.APPOINTMENT_MANAGE_ANY):
                return generate_response(False, error="Unauthorized", status_code=403)

            if appt.status not in ("Scheduled", "Confirmed", "Cancelled", "Reassigned"):
                return generate_response(
                    False,
                    error=f"An appointment with status {appt.status} cannot be rescheduled.",
                    status_code=400,
                )
            if appt.appointment_date == slot_date and appt.appointment_time == slot_time:
                return generate_response(
                    False, error="That is the same slot the appointment already holds.", status_code=400
                )

            if _slot_taken(db, appt.doctor_id, slot_date, slot_time, exclude_id=appt.id):
                return generate_response(False, error="This slot is already booked.", status_code=409)

            previous_status = appt.status
            # Free the old slot FIRST so the new INSERT cannot trip
            # uq_appt_doctor_slot against this same appointment's own row.
            if previous_status != "Cancelled":
                appt.status = "Cancelled"
                appt.cancellation_reason = "Rescheduled by the patient."
            appt.slot_start = None
            db.flush()

            new_appt = _insert_rebooking(db, appt, appt.doctor_id, slot_date, slot_time, note=note)
            new_id = new_appt.id
            db.commit()

            _notify_appointment_change(
                db, new_appt,
                subject="Appointment rescheduled by the patient",
                body_for_doctor=(
                    "Dear Dr. {name},\n\n"
                    f"A patient moved their appointment to {slot_date} at {slot_time}.\n"
                    + (f"Patient note: {note}\n" if note else "")
                    + "\nRegards,\nDerma AI"
                ),
            )

            logger.info(f"Appointment {appt_id} rescheduled as {new_id} (original preserved as Cancelled)")
            return generate_response(
                True,
                message="Appointment rescheduled.",
                data=_appointment_payload(new_appt, {
                    "previous_appointment_id": appt_id,
                    "previous_status": "Cancelled",
                    "note": note,
                }),
                status_code=200,
            )
    except IntegrityError as e:
        if SLOT_UNIQUE_INDEX in str(getattr(e, "orig", "")) or SLOT_UNIQUE_INDEX in str(e):
            logger.warning(f"Reschedule blocked by {SLOT_UNIQUE_INDEX}: {e}")
            return generate_response(False, error="This slot is already booked.", status_code=409)
        logger.error(f"Patient Reschedule Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    except Exception as e:
        logger.error(f"Patient Reschedule Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ======================================================================
# NESTED BLUEPRINT: the multi-doctor appointment-request routes.
#
# app/api/__init__.py is FROZEN (many agents import it concurrently), so the new
# blueprint cannot join its BLUEPRINTS tuple. Registering it as a CHILD of this
# already-registered blueprint is equivalent for routing: `appointments_bp`
# carries no url_prefix, so every child path stays absolute and unprefixed. Only
# the Flask endpoint NAME gains a prefix, and nothing in the contract uses it.
#
# The import is at the BOTTOM on purpose -- app.api.appointment_requests.routes
# imports nothing from this module, but keeping the import after every route
# definition here means a future cycle degrades into an obvious ImportError
# instead of a half-registered blueprint.
# ======================================================================
from app.api.appointment_requests.routes import appointment_requests_bp  # noqa: E402

appointments_bp.register_blueprint(appointment_requests_bp)
