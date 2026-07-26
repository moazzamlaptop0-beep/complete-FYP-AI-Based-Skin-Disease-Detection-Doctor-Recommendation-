"""
Demo data seed -- a doctor (licence APPROVED) and a patient, for manual testing.

    flask seed-demo

Idempotent. Passwords come from DEMO_PASSWORD (default "DemoPass123!") so the
credentials are predictable in a dev environment.

DO NOT RUN THIS IN PRODUCTION. It creates accounts with a known password and an
auto-approved medical licence.

Everything here uses the exact role literals the rest of the system compares
against: 'Doctor' and 'AI User'. Never 'doctor', never 'Patient'.
"""

import datetime
import os
import sys

DEFAULT_PASSWORD = os.environ.get("DEMO_PASSWORD", "DemoPass123!")

DEMO_DOCTOR_EMAIL = os.environ.get("DEMO_DOCTOR_EMAIL", "demo.doctor@aiderma.local")
DEMO_PATIENT_EMAIL = os.environ.get("DEMO_PATIENT_EMAIL", "demo.patient@aiderma.local")


def _get_or_create_user(db, email, name, role, password_hash, log):
    from app.models import User

    user = db.query(User).filter(User.email == email).first()
    if user:
        log.append(f"  exists : {role:<8} {email} (id={user.id})")
        return user, False

    user = User(
        name=name,
        email=email,
        password=password_hash,
        role=role,
        is_verified=True,
        is_active=True,
        is_root=False,
        token_version=0,
        marketing_opt_in=False,
        otp_attempts=0,
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(user)
    db.flush()
    log.append(f"  created: {role:<8} {email} (id={user.id})")
    return user, True


def seed_demo(db=None):
    """Returns {"log": [str], "doctor_id": int, "patient_id": int}."""
    from app.core.db import SessionLocal
    from app.core.security import hash_password
    from app.models import DoctorAvailability, DoctorFees, DoctorProfile

    log = ["Seeding demo accounts..."]
    owns_session = db is None
    db = db or SessionLocal()
    password_hash = hash_password(DEFAULT_PASSWORD)

    try:
        doctor, _ = _get_or_create_user(
            db, DEMO_DOCTOR_EMAIL, "Dr. Demo Dermatologist", "Doctor", password_hash, log
        )
        patient, _ = _get_or_create_user(
            db, DEMO_PATIENT_EMAIL, "Demo Patient", "AI User", password_hash, log
        )

        # --- doctor profile, pre-approved ------------------------------
        profile = db.query(DoctorProfile).filter(DoctorProfile.user_id == doctor.id).first()
        if not profile:
            profile = DoctorProfile(
                user_id=doctor.id,
                license=f"DEMO-LIC-{doctor.id:04d}",
                specialty="Dermatology",
                hospital="Demo General Hospital",
                city="Lahore",
                phone="+92-300-0000000",
                latitude=31.5204,
                longitude=74.3587,
                experience=8,
                verification_status="approved",     # lowercase literal
                verification_note="Auto-approved by seed_demo.",
                verified_at=datetime.datetime.now(datetime.timezone.utc),
            )
            db.add(profile)
            log.append("  created: doctor profile (verification_status='approved')")
        else:
            profile.verification_status = "approved"
            log.append("  exists : doctor profile (forced to 'approved')")

        # --- fees -------------------------------------------------------
        fees = db.query(DoctorFees).filter(DoctorFees.doctor_id == doctor.id).first()
        if not fees:
            db.add(DoctorFees(doctor_id=doctor.id, pkr=2000.0, usd=15.0,
                              duration="30min", buffer_time=5))
            log.append("  created: doctor fees (2000 PKR / 15 USD, 30min, 5min buffer)")
        else:
            log.append("  exists : doctor fees")

        # --- weekly availability ----------------------------------------
        existing_days = {
            a.day for a in db.query(DoctorAvailability).filter(
                DoctorAvailability.doctor_id == doctor.id
            ).all()
        }
        # Full day names -- _generate_slots_for_date matches on
        # date_obj.strftime("%A"), so "Mon" would never match anything.
        for day in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]:
            if day in existing_days:
                continue
            db.add(DoctorAvailability(
                doctor_id=doctor.id,
                day=day,
                start_time="09:00",     # 24h zero-padded; slot generation parses "%H:%M"
                end_time="17:00",
                is_off=False,
                break_start_time="13:00",
                break_end_time="14:00",
                break_name="Lunch Break",
            ))
        if existing_days:
            log.append(f"  exists : availability for {len(existing_days)} day(s)")
        else:
            log.append("  created: availability Mon-Fri 09:00-17:00 (lunch 13:00-14:00)")

        db.commit()
        log.append("")
        log.append(f"  Doctor  login: {DEMO_DOCTOR_EMAIL}  / {DEFAULT_PASSWORD}  (role 'Doctor')")
        log.append(f"  Patient login: {DEMO_PATIENT_EMAIL} / {DEFAULT_PASSWORD}  (role 'AI User')")
        # /login no longer compares a client-supplied `role` against the stored
        # one (the monolith's equality at app.py:468 was deleted for the
        # single-entry-login unblock). The body may still carry `role`; it is
        # read into a discarded local and ignored. users.role is the sole
        # authority for both the JWT and the response.
        log.append("  Note: /login takes email + password only -- no role field. The stored")
        log.append("        users.role decides the JWT role and the dashboard the frontend shows.")

        return {"log": log, "doctor_id": doctor.id, "patient_id": patient.id}
    except Exception:
        db.rollback()
        raise
    finally:
        if owns_session:
            db.close()


def main():
    from dotenv import load_dotenv

    load_dotenv()

    from app import create_app

    app = create_app()
    with app.app_context():
        try:
            result = seed_demo()
        except Exception as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 1
        for line in result["log"]:
            print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
