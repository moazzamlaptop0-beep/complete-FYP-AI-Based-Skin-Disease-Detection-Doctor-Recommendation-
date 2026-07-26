"""
ai_scans, scan_attachments, image_access_log.

`AIScan` keeps every original column verbatim (including the `synonym()`
aliases image_path / prediction). The new columns are appended in a marked
block and are all nullable / defaulted, so nothing that writes an AIScan today
has to change.
"""

import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text,
)
from sqlalchemy.orm import relationship, synonym

from app.models.base import Base


class AIScan(Base):
    __tablename__ = "ai_scans"

    id = Column(Integer, primary_key=True, index=True)
    image_url = Column(String(500), nullable=False)
    prediction_result = Column(String(255), index=True)
    # NOTE: stored 0-100 (test_model.py returns percent). TriageService reads it
    # as if it were 0-1. That mismatch is a KNOWN, DELIBERATELY UNFIXED bug --
    # fixing it changes stored severity_level values and the persisted
    # triage_reasons strings that /api/doctor-appointments serves verbatim.
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

    # ==================================================================
    # NEW COLUMNS (final schema) -- privacy + patient context
    # ==================================================================
    # Free-text the patient types in the booking stepper ("itchy for 3 weeks").
    patient_notes = Column(Text, nullable=True)

    # Intimate-area / face photos get gated: the doctor sees a blurred or
    # thumbnail variant until the patient consents to the full image, and every
    # view is written to image_access_log.
    is_sensitive = Column(Boolean, default=False, nullable=False, index=True)
    sensitivity_reason = Column(String(50), nullable=True)
    blur_url = Column(String(500), nullable=True)
    thumb_url = Column(String(500), nullable=True)

    # "Delete my photo" -- a soft, audited delete. The scan row (and therefore
    # the doctor's clinical record) survives; only the pixels go.
    image_deleted_at = Column(DateTime, nullable=True)
    image_deleted_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    image_delete_reason = Column(String(255), nullable=True)
    image_delete_consent_at = Column(DateTime, nullable=True)
    image_purged_at = Column(DateTime, nullable=True)   # bytes actually unlinked from disk

    # Synonyms for Alternate Naming Conventions
    image_path = synonym("image_url")
    prediction = synonym("prediction_result")


# ======================================================================
# NEW TABLE: scan_attachments
# ======================================================================
class ScanAttachment(Base):
    """Extra photos attached to one scan (the booking stepper lets a patient
    upload several angles). Same privacy gate as the primary image."""

    __tablename__ = "scan_attachments"

    id = Column(Integer, primary_key=True, index=True)
    scan_id = Column(Integer, ForeignKey("ai_scans.id", ondelete="CASCADE"), index=True, nullable=False)

    image_url = Column(String(500), nullable=False)
    thumb_url = Column(String(500), nullable=True)
    blur_url = Column(String(500), nullable=True)
    is_sensitive = Column(Boolean, default=False, nullable=False)
    image_deleted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), nullable=False)

    scan = relationship("AIScan", foreign_keys=[scan_id])


# ======================================================================
# NEW TABLE: image_access_log
# ======================================================================
class ImageAccessLog(Base):
    """Who looked at which medical image, when, and in which variant.

    This is the evidence trail that makes "only your doctor can see your photo"
    a claim we can actually prove rather than just assert.
    """

    __tablename__ = "image_access_log"

    id = Column(Integer, primary_key=True, index=True)
    scan_id = Column(Integer, ForeignKey("ai_scans.id", ondelete="CASCADE"), index=True, nullable=False)
    attachment_id = Column(Integer, ForeignKey("scan_attachments.id", ondelete="CASCADE"), nullable=True)
    viewer_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True)

    viewer_role = Column(String(20), nullable=True)
    variant = Column(String(10), nullable=True)     # full | blur | thumb
    ip = Column(String(45), nullable=True)
    viewed_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), index=True, nullable=False)


class GuestScan(Base):
    """A scan taken before the visitor had an account.

    WHY A SEPARATE TABLE INSTEAD OF ai_scans.user_id = NULL
    ------------------------------------------------------
    `ai_scans.user_id` is NOT NULL, and every query in the product assumes an
    owner: the patient's history, the doctor's queue, image authorization,
    consent records and deletion all key off it. Making it nullable would put an
    ownerless row in front of all of that.

    A guest row is also a genuinely different thing. It has no owner, nobody can
    list it, it carries no clinical history, and it EXPIRES. Keeping it in its
    own table means the guest path cannot accidentally leak into a clinical
    query, and the retention rule ("unclaimed guest scans are deleted") is one
    DELETE against one table.

    THE CLAIM
    ---------
    The client holds `guest_token` (one per browser session, not per scan). On
    sign-in it POSTs the token; every unclaimed, unexpired row for it is copied
    into `ai_scans` owned by the new user and marked claimed. The image file is
    reused as-is -- nothing is re-uploaded and nothing is re-analysed, so the
    verdict the guest was shown is the verdict that gets saved.
    """

    __tablename__ = "guest_scans"

    id = Column(Integer, primary_key=True, index=True)

    # Opaque per-browser secret. Indexed because the claim looks rows up by it.
    guest_token = Column(String(64), index=True, nullable=False)

    image_url = Column(String(500), nullable=False)
    thumb_url = Column(String(500), nullable=True)
    blur_url = Column(String(500), nullable=True)

    prediction_result = Column(String(255), nullable=True)
    confidence = Column(Float, nullable=True)
    is_sensitive = Column(Boolean, default=False, nullable=False)

    # Triage is computed on the fly for guests, but the answers are worth
    # carrying across the claim so the stepper does not ask twice.
    patient_questionnaire = Column(Text, nullable=True)
    severity_level = Column(String(50), nullable=True)
    triage_score = Column(Integer, default=0)
    triage_reasons = Column(Text, nullable=True)

    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), index=True, nullable=False)
    # Unclaimed rows are swept after this. A skin photograph with no owner is
    # not something to keep indefinitely on the chance somebody comes back.
    expires_at = Column(DateTime, index=True, nullable=True)

    claimed_at = Column(DateTime, nullable=True)
    claimed_by = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    # The ai_scans row this became, so a double-claim is a no-op rather than a
    # duplicate.
    claimed_scan_id = Column(Integer, ForeignKey("ai_scans.id", ondelete="SET NULL"), nullable=True)


__all__ = ["AIScan", "ScanAttachment", "ImageAccessLog", "GuestScan"]
