"""
doctor_profiles, doctor_availability, doctor_fees, doctor_ratings.

Copied verbatim from the original models.py, including the `synonym()` aliases.
Those synonyms look dead but cost nothing and removing them risks breaking a
handler that reads `profile.specialization` or `fee.fees`.
"""

import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, Float, ForeignKey, Index,
    Integer, String, Text, text,
)
from sqlalchemy.orm import relationship, synonym

from app.models.base import Base


class DoctorProfile(Base):
    __tablename__ = "doctor_profiles"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True, nullable=False)

    license = Column(String(100), unique=True, index=True, nullable=False)
    specialty = Column(String(255), index=True)
    specialization = synonym("specialty")  # Support both specialty and specialization

    hospital = Column(String(255))
    city = Column(String(100), index=True)
    # The rest of the picked place. The registration form and the doctor profile
    # submit a geocoded result, so city alone stopped being enough: "Hyderabad"
    # is two different cities in two countries, and the directory has to be able
    # to say which. Wider than `city` because these are printed in full
    # ("Khyber Pakhtunkhwa"), never abbreviated.
    state = Column(String(120), nullable=True)
    country = Column(String(120), nullable=True)
    phone = Column(String(20))

    latitude = Column(Float, nullable=True)
    longitude = Column(Float, nullable=True)

    # Profile Picture & Experience
    profile_image = Column(String(500), nullable=True)  # Image relative path or URL
    experience = Column(Integer, default=0, nullable=True)  # Years of experience

    # --- Admin License Verification ---
    # pending  = newly registered doctor, admin ne abhi review nahi kiya
    # approved = admin ne license check karke doctor ko verified kar diya
    # rejected = admin ne fake/invalid samajh kar reject kiya (account baad me delete bhi ho sakta hai)
    verification_status = Column(String(20), default='pending', index=True, nullable=False)
    verification_note = Column(Text, nullable=True)  # Admin ka reason (especially reject ke waqt)
    verified_at = Column(DateTime, nullable=True)
    verified_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    user = relationship("User", back_populates="doctor_profile", foreign_keys=[user_id])


# ==========================================
# SCHEDULE MANAGEMENT TABLE
# ==========================================
class DoctorAvailability(Base):
    __tablename__ = "doctor_availability"

    id = Column(Integer, primary_key=True, index=True)
    doctor_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)

    day = Column(String(20), index=True, nullable=False)
    start_time = Column(String(20), nullable=True)
    end_time = Column(String(20), nullable=True)
    is_off = Column(Boolean, default=False, index=True)

    # Lunch/Meal Break columns
    # NOTE: the API response keys are break_start / break_end, NOT these column
    # names. /api/doctor-availability renames them on the way out.
    break_start_time = Column(String(20), nullable=True)
    break_end_time = Column(String(20), nullable=True)
    break_name = Column(String(100), nullable=True)  # Doctor-defined gap label e.g. "Lunch Break", "Breakfast"

    doctor = relationship("User", back_populates="availability")


# ==========================================
# FEES & BUFFER MANAGEMENT TABLE
# ==========================================
class DoctorFees(Base):
    __tablename__ = "doctor_fees"

    id = Column(Integer, primary_key=True, index=True)
    doctor_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True, nullable=False)

    pkr = Column(Float, nullable=True, default=0.0)
    usd = Column(Float, nullable=True, default=0.0)
    duration = Column(String(20), nullable=False, default='30min')

    # Patient buffer gap (minutes me)
    buffer_time = Column(Integer, default=0)  # e.g., 5, 10, 15 minutes

    # Synonyms for Alternate Naming Conventions
    fees = synonym("pkr")
    consultation_duration = synonym("duration")

    doctor = relationship("User", back_populates="fees")


# ==========================================
# REAL DOCTOR RATINGS TABLE
# ==========================================
class DoctorRating(Base):
    __tablename__ = "doctor_ratings"
    __table_args__ = (
        # NEW: the rating column was a bare Integer, so a review of 47 or -3
        # was perfectly storable and then averaged into the public listing.
        CheckConstraint("rating >= 1 AND rating <= 5", name="ck_doctor_ratings_rating_range"),
        # NEW: /api/rate-doctor upserts on (patient, doctor, scan_id) else
        # (patient, doctor, appointment_id). Concurrent submits could still
        # create duplicates. These PARTIAL uniques make that impossible while
        # leaving rows where the id is NULL unconstrained.
        Index(
            "uq_rating_appt", "patient_id", "appointment_id",
            unique=True, postgresql_where=text("appointment_id IS NOT NULL"),
        ),
        Index(
            "uq_rating_scan", "patient_id", "scan_id",
            unique=True, postgresql_where=text("scan_id IS NOT NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)

    doctor_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    patient_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    appointment_id = Column(Integer, ForeignKey("appointments.id", ondelete="SET NULL"), index=True, nullable=True)
    scan_id = Column(Integer, ForeignKey("ai_scans.id", ondelete="SET NULL"), index=True, nullable=True)

    rating = Column(Integer, nullable=False, index=True)  # Scale: 1 to 5
    review = Column(Text, nullable=True)      # Description textual review
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), index=True)

    # Relationships (direct lookups)
    doctor = relationship("User", foreign_keys=[doctor_id])
    patient = relationship("User", foreign_keys=[patient_id])
    appointment = relationship("Appointment", foreign_keys=[appointment_id])
    scan = relationship("AIScan", foreign_keys=[scan_id])


__all__ = ["DoctorProfile", "DoctorAvailability", "DoctorFees", "DoctorRating"]
