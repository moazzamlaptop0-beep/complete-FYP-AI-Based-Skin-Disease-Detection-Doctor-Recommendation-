import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship, synonym
from database import Base

class User(Base):
    __tablename__ = "users"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    password = Column(String(255), nullable=False)
    role = Column(String(50), index=True, nullable=False)  # Admin, Doctor, ya AI User
    
    # --- Columns for Email Verification ---
    is_verified = Column(Boolean, default=False, index=True)  # Verification check
    otp_code = Column(String(10), nullable=True)      # Temporary OTP store
    otp_created_at = Column(DateTime, nullable=True)  # OTP kab issue hui - expiry check ke liye
    otp_attempts = Column(Integer, default=0, nullable=True)  # Galat verify tries ka counter - brute-force lockout ke liye

    # Modern UTC timezone-aware default datetime
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc)) 
    
    # --- Relationships ---
    # Scans uploaded by user (Patient/AI User)
    scans = relationship("AIScan", back_populates="owner", foreign_keys="AIScan.user_id", cascade="all, delete-orphan")
    
    # Doctor Profile linkage (One-to-One)
    doctor_profile = relationship("DoctorProfile", back_populates="user", uselist=False, cascade="all, delete-orphan", lazy="joined", foreign_keys="DoctorProfile.user_id")
    
    # Scans assigned to Doctor for review
    assigned_scans = relationship("AIScan", back_populates="reviewer", foreign_keys="AIScan.doctor_id")
    
    # Doctor's schedule (One-to-Many)
    availability = relationship("DoctorAvailability", back_populates="doctor", cascade="all, delete-orphan")
    
    # Doctor's fees (One-to-One)
    fees = relationship("DoctorFees", back_populates="doctor", uselist=False, cascade="all, delete-orphan", lazy="joined")


class DoctorProfile(Base):
    __tablename__ = "doctor_profiles"
    
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True, nullable=False)
    
    license = Column(String(100), unique=True, index=True, nullable=False) 
    specialty = Column(String(255), index=True)
    specialization = synonym("specialty")  # Support both specialty and specialization
    
    hospital = Column(String(255))
    city = Column(String(100), index=True)
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


class AIScan(Base):
    __tablename__ = "ai_scans"
    
    id = Column(Integer, primary_key=True, index=True)
    image_url = Column(String(500), nullable=False)
    prediction_result = Column(String(255), index=True)
    confidence = Column(Float)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), index=True)
    # BUG FIX: app.py update_scan() ye field set karta tha (scan.updated_at =
    # datetime.utcnow()) aur kai jagah .isoformat() bhi call karta tha, lekin
    # ye column yahan define hi nahi tha - isliye ek temporary Python attribute
    # ban kar reh jata tha, DB mein kabhi save nahi hota tha aur "Reviewed on"
    # jaisi timestamps hamesha null rehti thin. Ab actual column hai.
    updated_at = Column(DateTime, nullable=True, onupdate=lambda: datetime.datetime.now(datetime.timezone.utc))
    
    status = Column(String(50), default="Pending", index=True)
    doctor_comment = Column(Text, nullable=True)
    invite_to_clinic = Column(Boolean, default=False)
    
    # Pre-Report Questionnaire (Patient's MCQ Answers as JSON String)
    # JSON string keys (must match PreReportQuestionnaireModal.jsx + TriageService.SYMPTOM_WEIGHTS):
    # {is_bleeding, growing_fast, has_severe_pain, irregular_border, color_change, diameter_over_6mm}
    patient_questionnaire = Column(Text, nullable=True)
    
    # Columns for Triage System
    severity_level = Column(String(50), default='ROUTINE', index=True)  # CRITICAL, URGENT, ROUTINE
    triage_score = Column(Integer, default=0, index=True)
    triage_reasons = Column(Text, nullable=True)  # JSON list: why this severity was assigned

    # Doctor override audit trail
    overridden_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    override_reason = Column(Text, nullable=True)
    overridden_at = Column(DateTime, nullable=True)

    # Notification tracking
    is_notified = Column(Boolean, default=False)  # True when email notification is sent

    # --- Linkages ---
    # Patient linkage
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    owner = relationship("User", back_populates="scans", foreign_keys=[user_id], lazy="joined")
    
    # Doctor linkage (who reviews the scan)
    doctor_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True)
    reviewer = relationship("User", back_populates="assigned_scans", foreign_keys=[doctor_id], lazy="joined")

    # Additional Fields for Compatibility
    doctor_name = Column(String(255), nullable=True)
    doctor_email = Column(String(255), nullable=True)
    review_status = Column(String(50), default="Pending", index=True)

    # Synonyms for Alternate Naming Conventions
    image_path = synonym("image_url")
    prediction = synonym("prediction_result")


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
# APPOINTMENTS MANAGEMENT TABLE
# ==========================================
class Appointment(Base):
    __tablename__ = "appointments"
    
    id = Column(Integer, primary_key=True, index=True)
    
    patient_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    doctor_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    scan_id = Column(Integer, ForeignKey("ai_scans.id", ondelete="SET NULL"), index=True, nullable=True)
    
    appointment_date = Column(String(50), index=True, nullable=False)  # "YYYY-MM-DD" ya "Mon, Jan 26"
    appointment_time = Column(String(20), nullable=False)  # "09:00 AM"
    duration = Column(String(20), nullable=True, default='30min')
    
    status = Column(String(20), default="Scheduled", index=True)
    cancellation_reason = Column(Text, nullable=True)  # Doctor's reason when status = Cancelled/Reassigned

    hidden_from_doctor = Column(Boolean, default=False, index=True)

    conflict_with_id = Column(Integer, ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True, index=True)
    conflict_with = relationship("Appointment", remote_side=[id], foreign_keys=[conflict_with_id], uselist=False, post_update=True)

    # Conflict kis ne resolve kiya (doctor manually, ya system SLA timeout se) - audit trail
    resolved_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    auto_resolved = Column(Boolean, default=False)  # True agar SLA timeout ne khud resolve kiya, doctor ne nahi

    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc))

    # Relationships to access data directly
    patient = relationship("User", foreign_keys=[patient_id], lazy="joined")
    doctor = relationship("User", foreign_keys=[doctor_id], lazy="joined")

    # Synonyms for Alternate Naming Conventions
    date = synonym("appointment_date")
    time = synonym("appointment_time")


# ==========================================
# REAL DOCTOR RATINGS TABLE (NEW)
# ==========================================
class DoctorRating(Base):
    __tablename__ = "doctor_ratings"
    
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