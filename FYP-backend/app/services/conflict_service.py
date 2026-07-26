"""
Booking-conflict resolution + the SLA background job.

Moved VERBATIM from the monolith:
  * sort_appointments_by_priority   (app.py:65-88)
  * CONFLICT_SLA_HOURS              (app.py:2570)
  * APPOINTMENT_DATE/TIME_FORMATS   (app.py:2577-2578)
  * parse_appointment_datetime      (app.py:2580-2595)
  * _resolve_conflict_pair          (app.py:2454-2511)
  * resolve_expired_conflicts       (app.py:2597-2667)

`resolve_expired_conflicts` is what APScheduler runs. In the monolith the
scheduler started at import, so every gunicorn worker ran its own copy and the
same conflict could be auto-resolved (and both patients emailed) N times. It is
now started explicitly by app.extensions.start_scheduler(), gated on
config RUN_SCHEDULER, which should be true in exactly one process.
"""

import logging
from datetime import datetime

from app import models
from app.core.db import SessionLocal
from app.services.email_service import send_email
from app.services.scheduling_service import find_next_available_slots
from app.services.triage_service import TriageService

logger = logging.getLogger(__name__)

CONFLICT_SLA_HOURS = 4  # agar slot time se itne ghante pehle tak doctor decide na kare, system khud resolve kare

# appointment_date/appointment_time free-format strings hain (models.py dekho:
# "YYYY-MM-DD" ya "Mon, Jan 26" dono possible) - isliye yahan multiple known
# formats try karte hain. NOTE: ye ek stop-gap hai; asli fix appointment_date
# aur appointment_time ko proper Date/Time columns me migrate karna hai taake
# ye guessing hi khatam ho jaye.
# (That fix is now half-landed: appointments.slot_start is the typed shadow
# column. Populating it is a later phase; until then this guessing stays.)
APPOINTMENT_DATE_FORMATS = ["%Y-%m-%d", "%a, %b %d, %Y", "%A, %b %d, %Y", "%b %d, %Y"]
APPOINTMENT_TIME_FORMATS = ["%H:%M", "%I:%M %p"]


def sort_appointments_by_priority(appointments, severity_by_scan_id=None):
    """
    Doctor Dashboard me actionable appointments (Scheduled/Confirmed) hamesha
    upar rahein, phir Completed, phir Cancelled sabse neeche - date kitni bhi
    purani/nayi ho. Input list already date-desc order me honi chahiye
    (sorted() stable hai, isliye har status-group ke andar wo order preserve
    rehta hai).

    Pending-Conflict wale appointments sabse upar aate hain (doctor ka action
    chahiye) - unke andar bhi zyada severe scan wala pehle. severity_by_scan_id
    optional hai (scan_id -> severity_level dict) taake conflict group ke andar
    CRITICAL/URGENT pehle dikhein.
    """
    priority = {"Pending-Conflict": 0, "Scheduled": 1, "Confirmed": 1, "Completed": 2, "Reassigned": 2, "Cancelled": 3}
    severity_by_scan_id = severity_by_scan_id or {}

    def sort_key(a):
        status_rank = priority.get(a.status, 2)
        severity = severity_by_scan_id.get(a.scan_id, "ROUTINE")
        severity_rank = TriageService.TIER_RANK.get(severity, 0)
        # severity_rank ulta karo (CRITICAL=2 pehle aana chahiye, isliye negative)
        return (status_rank, -severity_rank)

    return sorted(appointments, key=sort_key)


def parse_appointment_datetime(date_str, time_str):
    """
    appointment_date + appointment_time ko multiple known format combinations
    ke against try karta hai. Match milne par datetime, warna None return karta
    hai - caller ko is None case ko log karke skip karna chahiye (silently
    ignore NAHI, warna woh conflict kabhi SLA se resolve hi nahi hoga).
    """
    if not date_str or not time_str:
        return None
    for date_fmt in APPOINTMENT_DATE_FORMATS:
        for time_fmt in APPOINTMENT_TIME_FORMATS:
            try:
                return datetime.strptime(f"{date_str} {time_str}", f"{date_fmt} {time_fmt}")
            except ValueError:
                continue
    return None


def _resolve_conflict_pair(db, winner_appt, loser_appt, resolved_by_id, reason, auto_resolved=False):
    """
    Shared resolution logic - dono manual doctor-resolve aur SLA auto-resolve
    isi function ko use karte hain, taake behavior consistent rahe.
    Loser ke liye agle available slots suggest karta hai (auto-compensation).
    """
    now = datetime.utcnow()

    # BUG FIX: pehle yahan "Scheduled" set hota tha jabke doctor ne actually
    # "Confirm" kiya hota hai (button/email dono "Confirm" kehte hain), aur
    # agar winner appointment pehle se Confirmed thi to yahan wapis Scheduled
    # pe girr jati thi. Ab status doctor ke action se match karta hai.
    winner_appt.status = "Confirmed"
    winner_appt.conflict_with_id = None
    winner_appt.resolved_by = resolved_by_id
    winner_appt.resolved_at = now
    winner_appt.auto_resolved = auto_resolved

    loser_appt.status = "Reassigned"
    loser_appt.conflict_with_id = None
    loser_appt.cancellation_reason = reason
    loser_appt.resolved_by = resolved_by_id
    loser_appt.resolved_at = now
    loser_appt.auto_resolved = auto_resolved

    db.commit()

    suggested_slots = find_next_available_slots(db, loser_appt.doctor_id, loser_appt.appointment_date, limit=3)

    # Notify both patients
    try:
        winner_patient = db.query(models.User).filter_by(id=winner_appt.patient_id).first()
        doctor_user = db.query(models.User).filter_by(id=winner_appt.doctor_id).first()
        doctor_name = doctor_user.name if doctor_user else "Doctor"

        if winner_patient and winner_patient.email:
            send_email(
                winner_patient.email,
                "Appointment Confirmed",
                f"Dear {winner_patient.name},\n\nYour appointment with Dr. {doctor_name} on "
                f"{winner_appt.appointment_date} at {winner_appt.appointment_time} is confirmed.\n\nThank you."
            )

        loser_patient = db.query(models.User).filter_by(id=loser_appt.patient_id).first()
        if loser_patient and loser_patient.email:
            slots_text = "\n".join([f"- {s['date']} at {s['time']}" for s in suggested_slots]) or "Please check available slots on the app."
            send_email(
                loser_patient.email,
                "Appointment Needs Rescheduling",
                f"Dear {loser_patient.name},\n\nYour appointment with Dr. {doctor_name} on "
                f"{loser_appt.appointment_date} at {loser_appt.appointment_time} could not be kept because: "
                f"{reason}\n\nHere are the next available slots:\n{slots_text}\n\n"
                f"We're sorry for the inconvenience."
            )
    except Exception as email_err:
        logger.warning(f"Conflict Resolution Email Failure: {str(email_err)}")

    return suggested_slots


def resolve_expired_conflicts():
    """
    Background job (APScheduler se periodically chalta hai). Har Pending-Conflict
    pair check karta hai - agar slot time CONFLICT_SLA_HOURS ke andar aa gaya
    aur doctor ne abhi tak resolve nahi kiya, to severity-rank (CRITICAL > URGENT
    > ROUTINE) se khud winner decide kar deta hai. Tie hone par pehle book hui
    appointment ko priority milti hai (first-come-first-served).
    """
    db = SessionLocal()
    try:
        pending = db.query(models.Appointment).filter(
            models.Appointment.status == "Pending-Conflict",
            models.Appointment.conflict_with_id.isnot(None)
        ).all()

        processed_ids = set()
        now = datetime.utcnow()

        for appt in pending:
            if appt.id in processed_ids or appt.conflict_with_id in processed_ids:
                continue

            other = db.query(models.Appointment).filter(models.Appointment.id == appt.conflict_with_id).first()
            if not other or other.status != "Pending-Conflict":
                # SELF-HEAL A DANGLING HALF-CONFLICT. `continue` alone meant this
                # row was skipped on EVERY future sweep: its partner is already
                # resolved (or gone), so no pair can ever form, and the patient
                # sat in Pending-Conflict forever while /api/update-appointment
                # refused to touch it ("active booking conflict") and the doctor's
                # one-click "give the slot to..." would have flipped an
                # already-Confirmed appointment to Reassigned. Nobody else is
                # contesting this slot, so drop the stale link and let the row be
                # an ordinary booking again.
                partner_id = appt.conflict_with_id
                appt.status = "Scheduled"
                appt.conflict_with_id = None
                try:
                    db.commit()
                    logger.info(
                        "SLA: released dangling Pending-Conflict appointment %s "
                        "(partner %s is no longer in conflict)",
                        appt.id, partner_id,
                    )
                except Exception as heal_error:  # pragma: no cover - defensive
                    # slot_start is deliberately NOT repopulated here: the row may
                    # be the urgent-override half, and re-indexing it could
                    # collide with the survivor. Leaving it NULL keeps the row
                    # usable without risking the unique index.
                    db.rollback()
                    logger.warning(
                        "SLA: could not release dangling conflict %s: %s",
                        appt.id, heal_error,
                    )
                processed_ids.add(appt.id)
                continue

            slot_dt = parse_appointment_datetime(appt.appointment_date, appt.appointment_time)
            if slot_dt is None:
                logger.warning(
                    f"SLA auto-resolve: could not parse date/time for appointment {appt.id} "
                    f"(date={appt.appointment_date!r}, time={appt.appointment_time!r}). "
                    f"Skipping - needs manual doctor resolution."
                )
                continue

            hours_until_slot = (slot_dt - now).total_seconds() / 3600.0
            if hours_until_slot > CONFLICT_SLA_HOURS:
                continue  # abhi time hai, doctor ko decide karne do

            # Severity fetch karo dono ke scans se
            def _severity_for(a):
                if not a.scan_id:
                    return "ROUTINE"
                scan = db.query(models.AIScan).filter(models.AIScan.id == a.scan_id).first()
                return scan.severity_level if scan and scan.severity_level else "ROUTINE"

            appt_rank = TriageService.TIER_RANK.get(_severity_for(appt), 0)
            other_rank = TriageService.TIER_RANK.get(_severity_for(other), 0)

            if appt_rank > other_rank:
                winner, loser = appt, other
            elif other_rank > appt_rank:
                winner, loser = other, appt
            else:
                # tie -> jo pehle book hua wahi rahay ga
                winner, loser = (appt, other) if appt.created_at <= other.created_at else (other, appt)

            _resolve_conflict_pair(
                db, winner, loser,
                resolved_by_id=None,
                reason="Auto-resolved by system after doctor response timeout - higher priority patient retained the slot.",
                auto_resolved=True
            )
            processed_ids.add(winner.id)
            processed_ids.add(loser.id)
            logger.info(f"SLA auto-resolved conflict: winner={winner.id}, reassigned={loser.id}")

    except Exception as e:
        logger.error(f"SLA Conflict Auto-Resolve Error: {e}", exc_info=True)
    finally:
        db.close()


__all__ = [
    "CONFLICT_SLA_HOURS",
    "APPOINTMENT_DATE_FORMATS",
    "APPOINTMENT_TIME_FORMATS",
    "sort_appointments_by_priority",
    "parse_appointment_datetime",
    "_resolve_conflict_pair",
    "resolve_expired_conflicts",
]
