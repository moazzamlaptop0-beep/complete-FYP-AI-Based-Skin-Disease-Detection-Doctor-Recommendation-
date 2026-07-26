"""
users, refresh_tokens, email_otps.

The `User` class below keeps EVERY column, index, relationship and cascade from
the original models.py verbatim. New columns are appended in a clearly marked
block -- nothing above that block may be reordered or retyped.
"""

import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, Column, DateTime, ForeignKey, Index, Integer,
    String, Text,
)
from sqlalchemy.orm import relationship

from app.models.base import Base


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
    # Indexed: every /admin/* list orders by created_at DESC, id DESC.
    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), index=True)

    # ==================================================================
    # NEW COLUMNS (final schema)
    # ==================================================================
    # The single unkillable superuser. NEVER settable over HTTP -- only the
    # `flask seed-root` CLI writes it, and act-as delegation refuses any target
    # whose is_root is true.
    is_root = Column(Boolean, default=False, nullable=False, index=True)
    # Soft disable instead of deleting a user with clinical history attached.
    is_active = Column(Boolean, default=True, nullable=False, index=True)
    # Bumped on password reset / forced logout; a future refresh-token flow
    # rejects any token whose version is stale.
    token_version = Column(Integer, default=0, nullable=False)
    last_login_at = Column(DateTime, nullable=True)
    last_login_ip = Column(String(45), nullable=True)   # 45 = max IPv6 text length
    marketing_opt_in = Column(Boolean, default=False, nullable=False)
    # Holds the new address during an email-change flow until its OTP is
    # consumed, so the account is never left pointing at an unverified inbox.
    pending_email = Column(String(255), nullable=True)

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


# ======================================================================
# NEW TABLE: refresh_tokens
# ======================================================================
class RefreshToken(Base):
    """Opaque rotating refresh tokens.

    The value handed to the client is `secrets.token_urlsafe(64)`; only its
    sha256 is stored, so a database dump cannot be replayed as a session.
    Rotation is recorded via `replaced_by_id`, which makes reuse of an already
    rotated token detectable (the classic refresh-token-theft signal).
    """

    __tablename__ = "refresh_tokens"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)

    token_hash = Column(String(128), unique=True, nullable=False)
    issued_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), nullable=False)
    expires_at = Column(DateTime, index=True, nullable=False)
    revoked_at = Column(DateTime, nullable=True)
    replaced_by_id = Column(Integer, ForeignKey("refresh_tokens.id", ondelete="SET NULL"), nullable=True)

    user_agent = Column(String(255), nullable=True)
    ip = Column(String(45), nullable=True)

    user = relationship("User", foreign_keys=[user_id])


# ======================================================================
# NEW TABLE: email_otps
# ======================================================================
class EmailOtp(Base):
    """Purpose-scoped OTPs.

    The monolith kept ONE otp_code/otp_created_at/otp_attempts triple on the
    users row, so requesting a password reset while a signup OTP was still
    live silently destroyed the signup OTP (and vice versa). Splitting by
    `purpose` fixes that. Only the hash is stored.

    users.otp_* stays in place and is still what the ported auth routes use --
    this table is the destination for the auth phase, not a live dual-write.
    """

    __tablename__ = "email_otps"
    __table_args__ = (
        CheckConstraint(
            "purpose IN ('signup','reset','email_change')",
            name="ck_email_otps_purpose",
        ),
        Index("ix_email_otps_user_purpose", "user_id", "purpose"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)

    purpose = Column(String(20), index=True, nullable=False)
    code_hash = Column(String(128), nullable=False)

    created_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), nullable=False)
    expires_at = Column(DateTime, nullable=False)
    attempts = Column(Integer, default=0, nullable=False)
    consumed_at = Column(DateTime, nullable=True)
    request_ip = Column(String(45), nullable=True)

    user = relationship("User", foreign_keys=[user_id])


__all__ = ["User", "RefreshToken", "EmailOtp"]
