"""
Doctor schedule parsing, validation and slot generation.

Everything here is MOVED VERBATIM from the monolith:
  * expand_and_standardize_days                      (app.py:1744-1789)
  * validate_schedule_slots                          (app.py:1792-1826)
  * _time_str_to_minutes                             (app.py:1829-1840)
  * find_appointments_orphaned_by_schedule_change    (app.py:1843-1925)
  * _generate_slots_for_date                         (app.py:2149-2234)
  * find_next_available_slots                        (app.py:2237-2261)

Do not tidy the string comparisons or the date guessing -- the exact error
messages (including the EM-DASH in the overlap message) are part of the API
contract, and the slot arithmetic decides who gets which appointment.
"""

import logging
from datetime import datetime, timedelta

from app import models

logger = logging.getLogger(__name__)

# Imported here (rather than from conflict_service) to avoid a circular import;
# both modules need the same literal list.
APPOINTMENT_TIME_FORMATS = ["%H:%M", "%I:%M %p"]

# Hard ceiling on GET /api/slots/multi. The stepper offers at most 3 doctors;
# this stops the endpoint from becoming a way to make the server do N days of
# slot arithmetic per request.
MAX_MULTI_DOCTORS = 10

CLINIC_TZ_DEFAULT = "Asia/Karachi"
_CLINIC_TZ_WARNED = set()


def clinic_now():
    """Naive "now" in the CLINIC's wall clock -- the ONLY correct `now` for
    slot arithmetic in this codebase.

    A DoctorAvailability row holds the literal strings the doctor typed
    ("09:00", "17:00"), and appointment_time / slot_start are stored in that
    same naive local frame. Comparing them against datetime.utcnow() compares
    two different clocks: at UTC+5, 14:00 local reads as 09:00, so
    _generate_slots_for_date happily emitted today's 10:00-13:00 as
    `status: "available"`, normalize_slots accepted them, and neither
    "Preferred slot is in the past" nor "Cannot book appointments in the past"
    could fire for the last five hours of every day.

    Returns naive local time so it drops straight into the existing comparisons
    (every datetime column here is naive). CLINIC_TZ=UTC restores the previous
    behaviour exactly; an unknown zone falls back to UTC and warns once.
    """
    name = CLINIC_TZ_DEFAULT
    try:
        from flask import current_app, has_app_context

        if has_app_context():
            name = current_app.config.get("CLINIC_TZ") or CLINIC_TZ_DEFAULT
    except Exception:  # pragma: no cover - defensive
        pass

    if not name or str(name).strip().upper() == "UTC":
        return datetime.utcnow()

    try:
        from zoneinfo import ZoneInfo

        return datetime.now(ZoneInfo(str(name).strip())).replace(tzinfo=None)
    except Exception as exc:  # pragma: no cover - bad zone name / no tzdata
        if name not in _CLINIC_TZ_WARNED:
            _CLINIC_TZ_WARNED.add(name)
            logger.warning("CLINIC_TZ=%r is unusable (%s); falling back to UTC.", name, exc)
        return datetime.utcnow()


def expand_and_standardize_days(day_string):

    full_days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    short_days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

    day_clean = day_string.strip().lower()

    # Case 1: Agar range format hai (e.g., "Mon - Fri" ya "Monday - Friday")
    if '-' in day_clean:
        parts = [p.strip() for p in day_clean.split('-')]
        if len(parts) == 2:
            start_day, end_day = parts[0], parts[1]

            start_idx = -1
            end_idx = -1

            # Find indices for start and end days
            for i, d in enumerate(full_days):
                if d.lower() == start_day: start_idx = i
                if d.lower() == end_day: end_idx = i

            if start_idx == -1 and start_day[:3] in short_days:
                start_idx = short_days.index(start_day[:3])
            if end_idx == -1 and end_day[:3] in short_days:
                end_idx = short_days.index(end_day[:3])

            if start_idx != -1 and end_idx != -1:
                result = []
                if start_idx <= end_idx:
                    for idx in range(start_idx, end_idx + 1):
                        result.append(full_days[idx])
                else:
                    # Over-weekend wrap (e.g., Fri - Sun)
                    for idx in range(start_idx, 7):
                        result.append(full_days[idx])
                    for idx in range(0, end_idx + 1):
                        result.append(full_days[idx])
                return result

    # Case 2: Single Day match (e.g., "Mon" -> "Monday")
    for d in full_days:
        if d.lower() == day_clean or d.lower()[:3] == day_clean[:3]:
            return [d]

    # Fallback: Agar kuch samajh na aaye to capitalized string return karein
    return [day_string.strip().capitalize()]


def validate_schedule_slots(schedule):
    """
    BUG FIX: pehle na frontend na backend kahin check karta tha ke (1) shift ka
    start time end se pehle ho, (2) same din ke do slots overlap na karein.
    Doctor start:17:00, end:09:00 jaisa ulta slot bhi save kar sakta tha, koi
    warning nahi aati thi. Time strings 'HH:MM' (24hr, zero-padded) hain,
    isliye seedha lexicographic compare kaafi hai.
    Return: error message (string) agar invalid ho, warna None.
    """
    for day_data in schedule:
        raw_day = day_data.get('day')
        if not raw_day or day_data.get('off', False):
            continue

        slots = day_data.get('slots') or []
        if not slots and (day_data.get('start') or day_data.get('end')):
            slots = [{"start": day_data.get('start'), "end": day_data.get('end')}]

        active_slots = []
        for slot in slots:
            start = slot.get('start')
            end = slot.get('end')
            if not start or not end:
                continue
            if start >= end:
                return f"{raw_day}: shift start time ({start}) must be before end time ({end})."
            active_slots.append((start, end))

        active_slots.sort(key=lambda s: s[0])
        for i in range(1, len(active_slots)):
            if active_slots[i][0] < active_slots[i - 1][1]:
                return (f"{raw_day}: shifts overlap — "
                        f"{active_slots[i-1][0]}-{active_slots[i-1][1]} and "
                        f"{active_slots[i][0]}-{active_slots[i][1]} clash.")
    return None


def _time_str_to_minutes(time_str, formats):
    """Parse a time string using a list of candidate strptime formats, return
    minutes-since-midnight, or None if it can't be parsed with any of them."""
    if not time_str:
        return None
    for fmt in formats:
        try:
            t = datetime.strptime(time_str.strip(), fmt)
            return t.hour * 60 + t.minute
        except (ValueError, AttributeError):
            continue
    return None


def find_appointments_orphaned_by_schedule_change(db, doctor_id, incoming_schedule):
    """
    ADD (missing safeguard): pehle jab doctor apna weekly schedule save karta
    tha, purani availability delete karke naye se replace ho jati thi - bina ye
    check kiye ke us din/time pe pehle se koi Scheduled/Confirmed/Pending-Conflict
    appointment maujood hai ya nahi. Agar doctor Monday hata de aur kisi
    patient ki Monday appointment already booked ho, wo appointment orphaned
    reh jati thi, koi warning nahi milti thi.

    Ye function future ki active appointments check karta hai aur batata hai
    ke naye schedule mein unke din/time ko cover kiya gaya hai ya nahi. Jo
    cover nahi hoti, unki list return hoti hai taake caller doctor ko warn kar
    sake, delete se pehle.
    """
    today_str = datetime.utcnow().strftime("%Y-%m-%d")

    active_appts = db.query(models.Appointment).filter(
        models.Appointment.doctor_id == doctor_id,
        models.Appointment.status.in_(["Scheduled", "Confirmed", "Pending-Conflict"]),
        models.Appointment.appointment_date >= today_str
    ).all()

    if not active_appts:
        return []

    # Naye schedule se weekday -> covered (start,end) minute-ranges banayein.
    # Off days ya empty-slot days deliberately empty list rakhte hain (matlab
    # "explicitly not covered"), taake unhe missing days se distinguish kar sakein.
    coverage = {}
    for day_data in incoming_schedule:
        raw_day = day_data.get('day')
        if not raw_day:
            continue
        expanded_days = expand_and_standardize_days(raw_day)
        is_off = day_data.get('off', False)

        slots = day_data.get('slots') or []
        if not slots and (day_data.get('start') or day_data.get('end')):
            slots = [{"start": day_data.get('start'), "end": day_data.get('end')}]

        for standard_day in expanded_days:
            coverage.setdefault(standard_day, [])
            if is_off or not slots:
                continue
            for slot in slots:
                s_min = _time_str_to_minutes(slot.get('start'), ["%H:%M"])
                e_min = _time_str_to_minutes(slot.get('end'), ["%H:%M"])
                if s_min is not None and e_min is not None:
                    coverage[standard_day].append((s_min, e_min))

    orphaned = []
    for appt in active_appts:
        try:
            appt_date_obj = datetime.strptime(appt.appointment_date, "%Y-%m-%d")
        except ValueError:
            # Legacy/non-standard date format - can't safely verify, skip rather
            # than false-alarm the doctor.
            continue

        weekday_name = appt_date_obj.strftime("%A")  # "Monday", "Tuesday", ...
        slots_for_day = coverage.get(weekday_name)

        is_covered = False
        if slots_for_day:
            appt_minutes = _time_str_to_minutes(appt.appointment_time, APPOINTMENT_TIME_FORMATS)
            if appt_minutes is None:
                # Time format couldn't be parsed - day itself has slots, so
                # treat as covered rather than false-alarming.
                is_covered = True
            else:
                is_covered = any(start <= appt_minutes < end for start, end in slots_for_day)

        if not is_covered:
            patient = db.query(models.User).filter_by(id=appt.patient_id).first()
            orphaned.append({
                "appointment_id": appt.id,
                "date": appt.appointment_date,
                "time": appt.appointment_time,
                "status": appt.status,
                "patient_name": patient.name if patient else "Unknown Patient"
            })

    return orphaned


def _minutes_of(value):
    """Minutes-since-midnight from a 'HH:MM'/'hh:MM AM' string, a datetime.time,
    or a datetime. None when it cannot be read."""
    if value is None:
        return None
    hour = getattr(value, "hour", None)
    if hour is not None:
        return hour * 60 + getattr(value, "minute", 0)
    return _time_str_to_minutes(value, APPOINTMENT_TIME_FORMATS)


def _break_windows_for(shifts):
    """Every declared break window for one doctor-day, as (start_min, end_min).

    BUG FIX: _generate_slots_for_date read start_time/end_time but IGNORED
    break_start_time/break_end_time entirely, even though DoctorAvailability has
    carried them since the multi-shift feature landed. Today's writer
    (/api/update-availability) only ever records the GAP BETWEEN two shifts as
    the break, and no slot is generated inside a gap anyway -- so the bug was
    invisible. The moment a break is declared INSIDE a shift (a seed, an admin
    edit, or any future UI that lets a doctor mark 13:00-14:00 as lunch without
    splitting the shift), the generator happily offered someone's lunch break
    as a bookable slot. The new stepper books straight off this list, so it is
    fixed here rather than in each caller.

    Zero-length and reversed windows are dropped rather than trusted.
    """
    windows = []
    for shift in shifts:
        start = _minutes_of(getattr(shift, "break_start_time", None))
        end = _minutes_of(getattr(shift, "break_end_time", None))
        if start is None or end is None or end <= start:
            continue
        windows.append((start, end))
    return windows


def _overlaps_break(slot_start_min, slot_end_min, break_windows):
    """Half-open overlap: a slot ENDING exactly when the break starts is fine."""
    for break_start, break_end in break_windows:
        if slot_start_min < break_end and break_start < slot_end_min:
            return True
    return False


def _generate_slots_for_date(db, doctor_id, date_str):
    """
    Core slot-generation logic, reused by /api/slots (raw display) aur
    find_next_available_slots() (auto-compensation suggestions). Returns a
    list of {"time", "status", "duration"} dicts, ya None agar date invalid ho.
    Conflict wale slots ("Pending-Conflict") ko bhi "booked" treat karte hain -
    naya (3rd) patient us slot pe conflict add nahi kar sakta.

    NOTE the '60min' default below. Every OTHER fallback in the codebase is
    '30min'; this one is genuinely different and the contract depends on it.

    Slots overlapping a declared break window are now skipped entirely (they are
    not emitted as "booked" -- they are not slots at all). See _break_windows_for.
    """
    try:
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return None

    # clinic_now(), not utcnow(): the shift times below are clinic wall-clock.
    now_local = clinic_now()
    if date_obj.date() < now_local.date():
        return []

    day_name = date_obj.strftime("%A")

    shifts = db.query(models.DoctorAvailability).filter(
        models.DoctorAvailability.doctor_id == doctor_id,
        models.DoctorAvailability.day == day_name,
        models.DoctorAvailability.is_off == False
    ).order_by(models.DoctorAvailability.start_time.asc()).all()

    if not shifts:
        return []

    fee_setting = db.query(models.DoctorFees).filter_by(doctor_id=doctor_id).first()
    duration_str = fee_setting.duration if fee_setting and fee_setting.duration else '60min'
    buffer_time = fee_setting.buffer_time if fee_setting and fee_setting.buffer_time else 0

    try:
        interval_minutes = int(''.join(filter(str.isdigit, duration_str)))
    except ValueError:
        interval_minutes = 60

    generated_slots = []
    break_windows = _break_windows_for(shifts)

    for shift in shifts:
        if not shift.start_time or not shift.end_time:
            continue
        try:
            if isinstance(shift.start_time, str):
                start_time = datetime.strptime(shift.start_time, "%H:%M")
                end_time = datetime.strptime(shift.end_time, "%H:%M")
            else:
                start_time = datetime.combine(date_obj, shift.start_time)
                end_time = datetime.combine(date_obj, shift.end_time)
        except ValueError:
            continue

        current_time = start_time
        while current_time + timedelta(minutes=interval_minutes) <= end_time:
            slot_end_time = current_time + timedelta(minutes=interval_minutes)

            if date_obj.date() == now_local.date():
                current_hm = now_local.strftime("%H:%M")
                if current_time.strftime("%H:%M") < current_hm:
                    current_time = slot_end_time + timedelta(minutes=buffer_time)
                    continue

            # BUG FIX: a slot overlapping the doctor's declared break is not a
            # slot. Advance exactly as the past-time branch above does, so the
            # buffer arithmetic stays identical.
            slot_start_min = current_time.hour * 60 + current_time.minute
            if _overlaps_break(slot_start_min, slot_start_min + interval_minutes, break_windows):
                current_time = slot_end_time + timedelta(minutes=buffer_time)
                continue

            generated_slots.append(current_time.strftime("%H:%M"))
            current_time = slot_end_time + timedelta(minutes=buffer_time)

    booked_appointments = db.query(models.Appointment).filter(
        models.Appointment.doctor_id == doctor_id,
        models.Appointment.appointment_date == date_str,
        # BUG FIX: "Confirmed" missing yahan tha - jab doctor kisi Scheduled
        # appointment ko Confirmed karta hai (/api/update-appointment), wo slot
        # dobara "available" dikhne lagta tha, kyunke ye filter usko booked hi
        # nahi maanta tha. Isi wajah se ek hi slot pe 2 alag patients Confirmed
        # ho jate the, bina kabhi Pending-Conflict bane ya doctor ko notify kiye.
        models.Appointment.status.in_(["Scheduled", "Confirmed", "Completed", "Pending-Conflict"])
    ).all()
    booked_times = {appt.appointment_time for appt in booked_appointments}

    response_slots = []
    for slot in generated_slots:
        status = "booked" if slot in booked_times else "available"
        response_slots.append({
            "time": slot,
            "status": status,
            "duration": duration_str
        })

    return response_slots


def find_next_available_slots(db, doctor_id, start_date_str, limit=3, lookahead_days=21):
    """
    Auto-compensation ke liye: bumped (Reassigned) patient ko dikhane wale
    agle 'limit' free slots dhoondta hai, start_date_str se lookahead_days
    tak aage dekh kar (aaj ka din bhi included agar abhi tak slots bache hon).
    """
    suggestions = []
    try:
        start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
    except ValueError:
        start_date = datetime.utcnow().date()

    for day_offset in range(0, lookahead_days):
        if len(suggestions) >= limit:
            break
        check_date = start_date + timedelta(days=day_offset)
        check_date_str = check_date.strftime("%Y-%m-%d")
        day_slots = _generate_slots_for_date(db, doctor_id, check_date_str) or []
        for slot in day_slots:
            if slot["status"] == "available":
                suggestions.append({"date": check_date_str, "time": slot["time"], "duration": slot["duration"]})
                if len(suggestions) >= limit:
                    break

    return suggestions


def slots_for_doctors(db, doctor_ids, date_str, limit=MAX_MULTI_DOCTORS):
    """Slots for SEVERAL doctors on one date, in ONE call.

    Backs GET /api/slots/multi. The booking stepper shows 1-3 candidate doctors
    side by side; without this it would fan out one /api/slots request per
    doctor per date change, which is N round trips for one screen paint.

    Returns (by_doctor, invalid_date):
      by_doctor    {"<doctor_id>": [{time, status, duration}, ...]}  -- string
                   keys, because that is what they become in JSON anyway, so
                   the caller and the client agree.
      invalid_date True when date_str is not YYYY-MM-DD (the caller 400s).

    An unknown doctor id simply maps to [] -- the same thing /api/slots returns
    for a doctor with no availability, so the stepper needs no extra branch.
    """
    ordered = []
    for raw in doctor_ids or []:
        try:
            doctor_id = int(raw)
        except (TypeError, ValueError):
            continue
        if doctor_id not in ordered:
            ordered.append(doctor_id)
    ordered = ordered[:limit]

    by_doctor = {}
    invalid_date = False
    for doctor_id in ordered:
        slots = _generate_slots_for_date(db, doctor_id, date_str)
        if slots is None:
            invalid_date = True
            break
        by_doctor[str(doctor_id)] = slots

    return by_doctor, invalid_date


__all__ = [
    "expand_and_standardize_days",
    "validate_schedule_slots",
    "_time_str_to_minutes",
    "_minutes_of",
    "_break_windows_for",
    "_overlaps_break",
    "find_appointments_orphaned_by_schedule_change",
    "_generate_slots_for_date",
    "find_next_available_slots",
    "slots_for_doctors",
    "MAX_MULTI_DOCTORS",
    "APPOINTMENT_TIME_FORMATS",
]
