"""
Who is actually allowed to rate a doctor.

THE HOLE THIS CLOSES
--------------------
/api/rate-doctor performed ZERO relationship validation. It never checked that
the scan_id or appointment_id belonged to the calling patient, nor that the
patient had ever been treated by that doctor. And when BOTH ids were omitted
there was no upsert key at all, so every POST inserted a FRESH row -- meaning
any authenticated user could loop

    POST /api/rate-doctor {"doctor_id": 7, "rating": 1}

and drive a competitor's public average (served by /api/doctors/public and
/doctor/ratings/<id>) to 1.0 in seconds. There is no rate limit on that route
and nothing to clean up afterwards.

THE RULE
--------
A rating requires a real, finished clinical relationship:
  * a COMPLETED appointment between this patient and this doctor, or
  * a scan owned by this patient, assigned to this doctor, and REVIEWED.

When the caller supplies an id, that specific record must satisfy the rule and
must belong to them. When the caller supplies NEITHER, we look one up and ATTACH
it -- which is what finally gives the row an upsert key, so the partial unique
indexes already in the schema (uq_rating_appt, uq_rating_scan) turn a repeat
submission into an UPDATE instead of another row.

WHAT DELIBERATELY DOES NOT CHANGE
---------------------------------
The success responses. A legitimate rater still gets exactly
"Rating successfully submitted." / "Rating successfully updated." with the same
200. Only submissions that were never legitimate now fail.
"""

import logging

from app import models

logger = logging.getLogger(__name__)

# The one appointment status that means "this consultation actually happened".
# 'Confirmed' is not enough -- it only means the doctor agreed to show up.
RATEABLE_APPOINTMENT_STATUS = "Completed"
REVIEWED_SCAN_STATUSES = ("Reviewed",)

ERR_NO_RELATIONSHIP = (
    "You can only rate a doctor after a completed appointment or a reviewed scan."
)
ERR_APPOINTMENT_NOT_YOURS = "That appointment does not belong to you."
ERR_APPOINTMENT_WRONG_DOCTOR = "That appointment is not with this doctor."
ERR_APPOINTMENT_NOT_COMPLETED = "You can only rate an appointment once it is completed."
ERR_SCAN_NOT_YOURS = "That scan does not belong to you."
ERR_SCAN_WRONG_DOCTOR = "That scan was not reviewed by this doctor."
ERR_SCAN_NOT_REVIEWED = "That scan has not been reviewed yet."
ERR_DUPLICATE = "You have already rated this consultation."


def _scan_is_reviewed(scan):
    return (scan.status in REVIEWED_SCAN_STATUSES) or (scan.review_status in REVIEWED_SCAN_STATUSES)


def find_completed_appointment(db, patient_id, doctor_id):
    return db.query(models.Appointment).filter(
        models.Appointment.patient_id == patient_id,
        models.Appointment.doctor_id == doctor_id,
        models.Appointment.status == RATEABLE_APPOINTMENT_STATUS,
    ).order_by(models.Appointment.id.desc()).first()


def find_reviewed_scan(db, patient_id, doctor_id):
    return db.query(models.AIScan).filter(
        models.AIScan.user_id == patient_id,
        models.AIScan.doctor_id == doctor_id,
        (models.AIScan.status.in_(REVIEWED_SCAN_STATUSES))
        | (models.AIScan.review_status.in_(REVIEWED_SCAN_STATUSES)),
    ).order_by(models.AIScan.id.desc()).first()


def validate_rating_target(db, patient_id, doctor_id, scan_id=None, appointment_id=None):
    """May this patient rate this doctor, and against which record?

    Returns (ok, error_message, status_code, resolved_scan_id, resolved_appointment_id).

    `resolved_*` may be POPULATED even when the caller sent neither id -- that is
    the point: it gives an otherwise key-less rating an upsert key so the partial
    unique indexes can stop the spam loop.
    """
    try:
        doctor_id = int(doctor_id)
    except (TypeError, ValueError):
        return False, "Invalid doctor id.", 400, None, None

    # Nobody rates themselves.
    if int(patient_id) == doctor_id:
        return False, "You cannot rate yourself.", 400, None, None

    if appointment_id:
        appointment = db.query(models.Appointment).filter(
            models.Appointment.id == appointment_id
        ).first()
        if appointment is None:
            return False, "Appointment not found.", 404, None, None
        if appointment.patient_id != int(patient_id):
            return False, ERR_APPOINTMENT_NOT_YOURS, 403, None, None
        if appointment.doctor_id != doctor_id:
            return False, ERR_APPOINTMENT_WRONG_DOCTOR, 400, None, None
        if appointment.status != RATEABLE_APPOINTMENT_STATUS:
            return False, ERR_APPOINTMENT_NOT_COMPLETED, 400, None, None
        # scan_id, when also sent, must belong to the same patient; it is only
        # carried so the doctor dashboard can join the review back to the case.
        resolved_scan_id = None
        if scan_id:
            scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
            if scan is None or scan.user_id != int(patient_id):
                return False, ERR_SCAN_NOT_YOURS, 403, None, None
            resolved_scan_id = scan.id
        return True, None, 200, resolved_scan_id, appointment.id

    if scan_id:
        scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
        if scan is None:
            return False, "Scan not found.", 404, None, None
        if scan.user_id != int(patient_id):
            return False, ERR_SCAN_NOT_YOURS, 403, None, None
        if scan.doctor_id != doctor_id:
            return False, ERR_SCAN_WRONG_DOCTOR, 400, None, None
        if not _scan_is_reviewed(scan):
            return False, ERR_SCAN_NOT_REVIEWED, 400, None, None
        return True, None, 200, scan.id, None

    # Neither id supplied: find the relationship ourselves and ATTACH it.
    appointment = find_completed_appointment(db, patient_id, doctor_id)
    if appointment is not None:
        return True, None, 200, appointment.scan_id, appointment.id

    scan = find_reviewed_scan(db, patient_id, doctor_id)
    if scan is not None:
        return True, None, 200, scan.id, None

    return False, ERR_NO_RELATIONSHIP, 403, None, None


__all__ = [
    "RATEABLE_APPOINTMENT_STATUS",
    "REVIEWED_SCAN_STATUSES",
    "ERR_NO_RELATIONSHIP",
    "ERR_DUPLICATE",
    "find_completed_appointment",
    "find_reviewed_scan",
    "validate_rating_target",
]
