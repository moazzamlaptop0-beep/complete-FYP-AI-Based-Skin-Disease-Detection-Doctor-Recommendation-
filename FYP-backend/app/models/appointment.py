"""
appointments + the "request a slot" tables.

`Appointment` keeps every original column verbatim (including the `date` /
`time` synonyms and the self-referential conflict link with post_update=True).
New columns are appended in a marked block.

THE CIRCULAR FOREIGN KEY
------------------------
`appointments.request_id -> appointment_requests.id` and
`appointment_requests.matched_appointment_id -> appointments.id` point at each
other. `use_alter=True` on the appointments side tells SQLAlchemy to emit that
constraint as a separate ALTER after both tables exist, which is what keeps
create_all() and the Alembic migration from deadlocking on table order.
"""

import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer,
    String, Text, UniqueConstraint, text,
)
from sqlalchemy.orm import relationship, synonym

from app.models.base import Base


# ==========================================
# APPOINTMENTS MANAGEMENT TABLE
# ==========================================
class Appointment(Base):
    __tablename__ = "appointments"
    __table_args__ = (
        # NEW: kills the double-booking race. Two patients hitting /api/book-slot
        # for the same doctor+time in the same instant both passed the "is it
        # taken?" SELECT before either INSERT landed. Partial, so it only
        # constrains rows that actually hold a slot, and rows still using the
        # legacy free-text date/time (slot_start IS NULL) are simply excluded.
        Index(
            "uq_appt_doctor_slot", "doctor_id", "slot_start",
            unique=True,
            postgresql_where=text(
                "status IN ('Scheduled','Pending-Conflict') AND slot_start IS NOT NULL"
            ),
        ),
    )

    id = Column(Integer, primary_key=True, index=True)

    patient_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    doctor_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    scan_id = Column(Integer, ForeignKey("ai_scans.id", ondelete="SET NULL"), index=True, nullable=True)

    appointment_date = Column(String(50), index=True, nullable=False)  # "YYYY-MM-DD" ya "Mon, Jan 26"
    appointment_time = Column(String(20), nullable=False)  # "09:00 AM"
    duration = Column(String(20), nullable=True, default='30min')

    status = Column(String(20), default="Scheduled", index=True)
    cancellation_reason = Column(Text, nullable=True)  # Doctor's reason when status = Cancelled/Reassigned

    # Patient's free-text note supplied when booking, rebooking or rescheduling
    # ("the rash spread to my other arm"). Previously accepted by /rebook and
    # /reschedule, echoed back, emailed to the doctor -- and then dropped,
    # because there was no column to hold it.
    note = Column(Text, nullable=True)

    hidden_from_doctor = Column(Boolean, default=False, index=True)

    conflict_with_id = Column(Integer, ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True, index=True)
    conflict_with = relationship("Appointment", remote_side=[id], foreign_keys=[conflict_with_id], uselist=False, post_update=True)

    # Conflict kis ne resolve kiya (doctor manually, ya system SLA timeout se) - audit trail
    resolved_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    resolved_at = Column(DateTime, nullable=True)
    auto_resolved = Column(Boolean, default=False)  # True agar SLA timeout ne khud resolve kiya, doctor ne nahi

    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), index=True)

    # ==================================================================
    # NEW COLUMNS (final schema)
    # ==================================================================
    # Which "find me a doctor" request produced this appointment.
    request_id = Column(
        Integer,
        ForeignKey(
            "appointment_requests.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_appointments_request_id",
        ),
        nullable=True,
        index=True,
    )
    # Rebooking chain: the appointment this one replaced.
    rebooked_from_id = Column(Integer, ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True)

    # TYPED SHADOW of appointment_date + appointment_time.
    # The free-text pair stays authoritative for the API (the contract serves
    # those exact strings), but sorting "Mon, Jan 26" alphabetically is
    # nonsense and the SLA job has to guess between four date formats. This
    # column is what the double-booking unique index and any correct ordering
    # use. Nullable so legacy rows are simply not covered.
    slot_start = Column(DateTime, nullable=True, index=True)

    # Relationships to access data directly
    patient = relationship("User", foreign_keys=[patient_id], lazy="joined")
    doctor = relationship("User", foreign_keys=[doctor_id], lazy="joined")

    # Synonyms for Alternate Naming Conventions
    date = synonym("appointment_date")
    time = synonym("appointment_time")


# ======================================================================
# NEW TABLE: appointment_requests
# ======================================================================
class AppointmentRequest(Base):
    """A patient asking for care without picking a specific slot.

    Instead of "browse doctors -> pick a time -> hope", the patient describes
    the problem once (optionally attaching a scan and its triage severity) and
    fans it out to several doctors, who accept or decline. `matched_*` records
    which doctor and appointment ultimately satisfied it.
    """

    __tablename__ = "appointment_requests"
    __table_args__ = (
        CheckConstraint(
            "status IN ('Open','Matched','Withdrawn','Expired','Declined')",
            name="ck_appointment_requests_status",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    patient_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    scan_id = Column(Integer, ForeignKey("ai_scans.id", ondelete="SET NULL"), index=True, nullable=True)

    status = Column(String(20), default="Open", index=True, nullable=False)
    priority = Column(String(20), default="ROUTINE", nullable=False)
    express = Column(Boolean, default=False, nullable=False)
    patient_note = Column(Text, nullable=True)

    # Frozen at request time so a later doctor override does not rewrite history.
    severity_snapshot = Column(String(20), nullable=True)
    triage_score = Column(Integer, default=0, nullable=False)
    triage_reasons = Column(Text, nullable=True)   # JSON list

    # Explicit per-request consent to show the doctor the attached scan image.
    consent_share_scan = Column(Boolean, default=False, nullable=False)

    matched_appointment_id = Column(Integer, ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True)
    matched_doctor_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    expires_at = Column(DateTime, index=True, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), index=True, nullable=False)


# ======================================================================
# NEW TABLE: appointment_request_doctors
# ======================================================================
class AppointmentRequestDoctor(Base):
    """Fan-out row: one candidate doctor for one request, plus their answer."""

    __tablename__ = "appointment_request_doctors"
    __table_args__ = (
        UniqueConstraint("request_id", "doctor_id", name="uq_request_doctor"),
        CheckConstraint(
            "response IN ('Pending','Accepted','Declined','Withdrawn')",
            name="ck_request_doctor_response",
        ),
    )

    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(Integer, ForeignKey("appointment_requests.id", ondelete="CASCADE"), index=True, nullable=False)
    doctor_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)

    preference_rank = Column(Integer, default=0, nullable=False)
    response = Column(String(20), default="Pending", nullable=False)
    decline_reason = Column(Text, nullable=True)
    responded_at = Column(DateTime, nullable=True)


# ======================================================================
# NEW TABLE: appointment_request_slots
# ======================================================================
class AppointmentRequestSlot(Base):
    """Times the patient said they could make, in preference order."""

    __tablename__ = "appointment_request_slots"

    id = Column(Integer, primary_key=True, index=True)
    request_id = Column(Integer, ForeignKey("appointment_requests.id", ondelete="CASCADE"), index=True, nullable=False)
    doctor_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    slot_date = Column(String(20), nullable=True)   # keeps the API's free-text shape
    slot_time = Column(String(20), nullable=True)
    slot_start = Column(DateTime, index=True, nullable=True)   # typed shadow
    rank = Column(Integer, default=0, nullable=False)


__all__ = [
    "Appointment",
    "AppointmentRequest",
    "AppointmentRequestDoctor",
    "AppointmentRequestSlot",
]
