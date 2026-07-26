"""
Doctor availability, fees and generated slots -- 5 of the 39 contract routes.

===========================================================================
  /api/update-availability                  POST  update_availability()   [monolith 1928-2031]
  /api/doctor-availability/<int:doctor_id>  GET   get_availability()      [monolith 2034-2071]
  /api/update-fees                          POST  update_fees()           [monolith 2076-2117]
  /api/doctor-fees/<int:doctor_id>          GET   get_fees()              [monolith 2119-2143]
  /api/slots/<int:doctor_id>                GET   get_daily_slots()       [monolith 2264-2281]
===========================================================================

NON-NEGOTIABLES PRESERVED HERE
-----------------------------
* ENVELOPE BREAKER: /api/slots/<id> returns a BARE JSON ARRAY on success
  (monolith:2276) and the ENVELOPE on every error path. PatientHistory.jsx:147
  parses the array directly. Do not wrap it.
* /api/slots keeps the '60min' duration fallback (inside
  scheduling_service._generate_slots_for_date). Every OTHER fallback is '30min'.
* /api/update-availability's 409 is the ONLY success:false response in the whole
  API that carries `data`. The overlap validation string contains an EM-DASH.
* /api/doctor-availability emits break_start / break_end (DB columns are
  break_start_time / break_end_time) and only when break_name is set. Off/empty
  days emit slots:[{'start':'','end':''}]. Day order is dict-insertion over
  start_time ASC, NOT Mon-Sun -- deliberately not "fixed".
* /api/doctor-fees returns 200 with INTEGER zeros when there is no row, never 404.
* /api/update-fees accepts EITHER doctor_id OR user_id as the id key.
* /api/doctor-availability, /api/doctor-fees and /api/slots stay FULLY PUBLIC.

AUTHORISATION MAPPING (monolith decorator -> permission)
--------------------------------------------------------
@doctor_required  ->  @require_permission(Permission.SCHEDULE_MANAGE, ...)
The body-supplied `doctor_id`/`user_id` ownership check that the monolith wrote
by hand (`request.current_user.get('user_id') != doctor_id`) now goes through
resolve_actor(). `any_perm` is deliberately None on both write routes: there is
no SCHEDULE_MANAGE_ANY permission, so an Admin can still only edit their OWN
availability and fees -- exactly as the monolith behaved.
Because the role hierarchy is a genuine set union, an Admin (who inherits
SCHEDULE_MANAGE from DOCTOR_PERMS) now passes the decorator where the monolith's
`role == 'Doctor'` check rejected them; they are still stopped by the ownership
check unless they are editing their own row.
"""

import logging

from flask import Blueprint, jsonify, request

from app import models
from app.core.db import session_scope
from app.core.rbac import (
    ERR_DOCTOR_ONLY,
    Permission,
    require_permission,
    resolve_actor,
)
from app.core.responses import generate_response
from app.services.scheduling_service import (
    _generate_slots_for_date,
    expand_and_standardize_days,
    find_appointments_orphaned_by_schedule_change,
    validate_schedule_slots,
)

logger = logging.getLogger(__name__)

schedule_bp = Blueprint("schedule", __name__)


# ==========================================
# 7. SCHEDULE / AVAILABILITY MANAGEMENT
# ==========================================
@schedule_bp.route('/api/update-availability', methods=['POST'])
@require_permission(Permission.SCHEDULE_MANAGE, denied_message=ERR_DOCTOR_ONLY)
def update_availability():
    data = request.get_json()
    if not data:
        return generate_response(False, error="Invalid JSON data", status_code=400)

    doctor_id = data.get('doctor_id')
    schedule = data.get('schedule')

    if not doctor_id or not schedule:
        return generate_response(False, error="Missing doctor_id or schedule data", status_code=400)

    # Was: `if request.current_user.get('user_id') != doctor_id`. any_perm is
    # None on purpose -- no permission grants "edit somebody else's schedule".
    if not resolve_actor(doctor_id, own_perm=Permission.SCHEDULE_MANAGE, any_perm=None):
        return generate_response(False, error="Unauthorized to modify this schedule", status_code=403)

    # BUG FIX: DB touch karne se pehle poora schedule validate karo — koi bhi
    # ek din invalid ho to poori request reject, partial-save nahi.
    validation_error = validate_schedule_slots(schedule)
    if validation_error:
        return generate_response(False, error=validation_error, status_code=400)

    try:
        with session_scope() as db:
            # ADD (missing safeguard): agar ye schedule change kisi existing
            # Scheduled/Confirmed/Pending-Conflict appointment ko orphan kar
            # dega (uska din off ho gaya ya uska time ab kisi shift mein cover
            # nahi hota), to doctor ko explicit warn karo aur confirm_override
            # flag ke bina overwrite mat karo. Frontend confirm dialog dikhane
            # ke baad confirm_override: true bhej kar dobara call karega.
            if not data.get('confirm_override'):
                orphaned = find_appointments_orphaned_by_schedule_change(db, doctor_id, schedule)
                if orphaned:
                    return generate_response(
                        False,
                        error="This change would leave existing booked appointments without matching availability.",
                        data={"requires_confirmation": True, "conflicts": orphaned},
                        status_code=409
                    )

            # Purane records delete karein taaki fresh setup overwrite ho sake
            db.query(models.DoctorAvailability).filter(models.DoctorAvailability.doctor_id == doctor_id).delete()

            for day_data in schedule:
                raw_day = day_data.get('day')
                if not raw_day:
                    continue

                # Range ya single day ko standard individual days array me convert karein
                expanded_days = expand_and_standardize_days(raw_day)

                is_off = day_data.get('off', False)

                # Multi-Slot support: frontend ab har din ke liye ek "slots" array
                # bhejta hai (multiple shifts). Har slot apni alag row me save hoti
                # hai, isliye ek din me jitne chahein utne gaps/breaks ban sakte hain.
                slots = day_data.get('slots') or []
                # Legacy fallback agar koi purana single start/end payload aa jaye
                if not slots and (day_data.get('start') or day_data.get('end')):
                    slots = [{"start": day_data.get('start'), "end": day_data.get('end')}]

                for standard_day in expanded_days:
                    if is_off or not slots:
                        # Off day ke liye ek hi placeholder row kaafi hai
                        db.add(models.DoctorAvailability(
                            doctor_id=doctor_id,
                            day=standard_day,
                            start_time=None,
                            end_time=None,
                            is_off=True))
                        continue

                    prev_slot_end = None  # Pichli shift ka end time - agla gap "break" banega
                    for slot in slots:
                        slot_start = slot.get('start')
                        slot_end = slot.get('end')
                        if not slot_start or not slot_end:
                            continue

                        # Sirf tab break record hoga jab ye pehli shift na ho (prev_slot_end maujood ho)
                        break_start = prev_slot_end
                        break_end = slot_start if prev_slot_end else None
                        break_name = (slot.get('break_name') or 'Break') if prev_slot_end else None

                        db.add(models.DoctorAvailability(
                            doctor_id=doctor_id,
                            day=standard_day,
                            start_time=slot_start,
                            end_time=slot_end,
                            is_off=False,
                            break_start_time=break_start,
                            break_end_time=break_end,
                            break_name=break_name))
                        prev_slot_end = slot_end

            db.commit()
            logger.info(f"Schedule updated for Doctor {doctor_id}")
            return generate_response(True, message="Schedule updated successfully", status_code=200)
    except Exception as e:
        logger.error(f"Update Schedule Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


@schedule_bp.route('/api/doctor-availability/<int:doctor_id>', methods=['GET'])
def get_availability(doctor_id):
    # PUBLIC by design (monolith had no decorator here) -- the patient booking
    # screen reads it before the user has any doctor-scoped token.
    try:
        with session_scope() as db:
            availabilities = db.query(models.DoctorAvailability).filter(
                models.DoctorAvailability.doctor_id == doctor_id
            ).order_by(models.DoctorAvailability.start_time.asc()).all()

            # Ek din ki multiple shift-rows ko wapis slots[] array me group karein
            grouped = {}
            for a in availabilities:
                grouped.setdefault(a.day, []).append(a)

            result = []
            for day, rows in grouped.items():
                if rows[0].is_off:
                    result.append({"day": day, "off": True, "slots": [{"start": "", "end": ""}]})
                    continue

                slots = []
                for r in rows:
                    if not r.start_time or not r.end_time:
                        continue
                    slot = {"start": r.start_time, "end": r.end_time}
                    if r.break_name:
                        slot["break_name"] = r.break_name
                        slot["break_start"] = r.break_start_time
                        slot["break_end"] = r.break_end_time
                    slots.append(slot)

                result.append({"day": day, "off": False, "slots": slots or [{"start": "", "end": ""}]})

            return generate_response(True, data=result, status_code=200)
    except Exception as e:
        logger.error(f"Get Availability Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ==========================================
# 8. FEES MANAGEMENT
# ==========================================
@schedule_bp.route('/api/update-fees', methods=['POST'])
@require_permission(Permission.SCHEDULE_MANAGE, denied_message=ERR_DOCTOR_ONLY)
def update_fees():
    data = request.get_json() or {}
    doctor_id = data.get('doctor_id') or data.get('user_id')
    pkr = data.get('pkr')
    usd = data.get('usd')
    duration = data.get('duration')
    buffer_time = data.get('buffer_time', 0)

    if not doctor_id:
        return generate_response(False, error="Doctor ID required", status_code=400)

    # Was: `if request.current_user.get('user_id') != doctor_id`.
    if not resolve_actor(doctor_id, own_perm=Permission.SCHEDULE_MANAGE, any_perm=None):
        return generate_response(False, error="Unauthorized to modify fees", status_code=403)

    try:
        with session_scope() as db:
            fee_record = db.query(models.DoctorFees).filter(models.DoctorFees.doctor_id == doctor_id).first()
            if fee_record:
                if pkr is not None: fee_record.pkr = float(pkr)
                if usd is not None: fee_record.usd = float(usd)
                if duration: fee_record.duration = str(duration)
                if buffer_time is not None: fee_record.buffer_time = int(buffer_time)
            else:
                fee_record = models.DoctorFees(
                    doctor_id=doctor_id,
                    pkr=float(pkr) if pkr else 0.0,
                    usd=float(usd) if usd else 0.0,
                    duration=str(duration) if duration else '30min',
                    buffer_time=int(buffer_time) if buffer_time else 0
                )
                db.add(fee_record)
            db.commit()
            logger.info(f"Fees updated for Doctor {doctor_id}")
            return generate_response(True, message="Fees and Gap updated successfully", status_code=200)
    except Exception as e:
        logger.error(f"Update Fees Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


@schedule_bp.route('/api/doctor-fees/<int:doctor_id>', methods=['GET'])
def get_fees(doctor_id):
    # PUBLIC by design (monolith had no decorator here).
    try:
        with session_scope() as db:
            fee_record = db.query(models.DoctorFees).filter(models.DoctorFees.doctor_id == doctor_id).first()
            if fee_record:
                data = {
                    "pkr": fee_record.pkr,
                    "usd": fee_record.usd,
                    "duration": fee_record.duration,
                    "buffer_time": fee_record.buffer_time if fee_record.buffer_time else 0
                }
                return generate_response(True, data=data, status_code=200)

            # NOTE: integer zeros, not 0.0, and success:true -- never a 404.
            return generate_response(True, data={
                "pkr": 0,
                "usd": 0,
                "duration": "30min",
                "buffer_time": 0
            }, status_code=200)
    except Exception as e:
        logger.error(f"Get Fees Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


# ==========================================
# 9. DYNAMIC SLOTS (TASK 15)
# ==========================================
@schedule_bp.route('/api/slots/<int:doctor_id>', methods=['GET'])
def get_daily_slots(doctor_id):
    # PUBLIC by design (monolith had no decorator here).
    try:
        with session_scope() as db:
            date_str = request.args.get('date')
            if not date_str:
                return generate_response(False, error="Date query parameter is required", status_code=400)

            response_slots = _generate_slots_for_date(db, doctor_id, date_str)
            if response_slots is None:
                return generate_response(False, error="Invalid date format, use YYYY-MM-DD", status_code=400)

            # =================================================================
            # ENVELOPE BREAKER -- monolith line 2276, preserved deliberately.
            # A BARE JSON ARRAY, not {success, data}. PatientHistory.jsx:147 and
            # :211 read this response directly. The error paths above DO use the
            # envelope, so success and failure have different top-level types.
            # =================================================================
            return jsonify(response_slots), 200  # Frontend expects raw list or generic JSON
    except Exception as e:
        logger.error(f"Get Slots Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
