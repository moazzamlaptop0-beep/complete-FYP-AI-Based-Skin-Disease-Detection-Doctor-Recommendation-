"""
consent_documents, user_consents.

A medical app has to be able to answer "what exactly did this user agree to,
which version of it, and when?" months later. A boolean column on `users`
cannot do that, so consents are versioned documents plus an append-only grant
log.

`user_consents.target_ref` ('scan:1234') is what lets PER-OBJECT consents --
"yes, share THIS photo with THIS doctor", "yes, delete THIS image" -- live in
the same audit-grade store as the global terms acceptance, instead of being
scattered as booleans across five tables.
"""

import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, ForeignKey, Index, Integer, String,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.models.base import Base


class ConsentDocument(Base):
    __tablename__ = "consent_documents"
    __table_args__ = (
        UniqueConstraint("consent_type", "version", name="uq_consent_type_version"),
    )

    id = Column(Integer, primary_key=True, index=True)
    consent_type = Column(String(40), index=True, nullable=False)   # terms | privacy | ai_disclaimer | ...
    version = Column(String(20), nullable=False)                    # "1.0", "2026-07-01"
    title = Column(String(200), nullable=False)
    body_url = Column(String(300), nullable=True)                   # where the full text lives

    is_current = Column(Boolean, default=False, index=True, nullable=False)
    effective_from = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), nullable=False)


class UserConsent(Base):
    __tablename__ = "user_consents"
    __table_args__ = (
        Index("ix_user_consents_user_type", "user_id", "consent_type"),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)

    consent_type = Column(String(40), index=True, nullable=False)
    version = Column(String(20), nullable=True)

    granted = Column(Boolean, default=False, nullable=False)
    granted_at = Column(DateTime, default=lambda: datetime.datetime.now(datetime.timezone.utc), nullable=False)
    revoked_at = Column(DateTime, nullable=True)

    # Evidence, not decoration: these are what make a grant defensible later.
    ip = Column(String(45), nullable=True)
    user_agent = Column(String(255), nullable=True)
    source = Column(String(30), nullable=True)          # signup | stepper | settings | admin

    # 'scan:1234', 'appointment:88' -- NULL for account-wide consents.
    target_ref = Column(String(64), index=True, nullable=True)

    user = relationship("User", foreign_keys=[user_id])


__all__ = ["ConsentDocument", "UserConsent"]
