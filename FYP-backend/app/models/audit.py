"""
audit_logs.

Written by `app.core.rbac` on every act-as delegation, and by privileged
handlers (doctor verification, account deletion, severity override, image
deletion) as they get ported.

`actor_user_id` is the human who really did it; `subject_user_id` is who it was
done to or on behalf of. During an act-as request those differ, which is
exactly the case a plain "user_id" column cannot express.

Both FKs are SET NULL so deleting a user never destroys the record of what they
did.
"""

import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text

from app.models.base import Base


class AuditLog(Base):
    __tablename__ = "audit_logs"
    __table_args__ = (
        Index("ix_audit_logs_action_created", "action", "created_at"),
    )

    id = Column(Integer, primary_key=True, index=True)

    actor_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True)
    # Indexed: "show me everything done TO this user" is the query that matters
    # when reviewing an impersonation, and it was a sequential scan.
    subject_user_id = Column(Integer, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)

    action = Column(String(64), index=True, nullable=False)     # act_as | doctor.verify | scan.image_delete | ...
    target_type = Column(String(40), nullable=True)             # user | scan | appointment
    target_id = Column(Integer, nullable=True)

    detail = Column(Text, nullable=True)                        # free text or JSON
    ip = Column(String(45), nullable=True)
    user_agent = Column(String(255), nullable=True)

    created_at = Column(
        DateTime,
        default=lambda: datetime.datetime.now(datetime.timezone.utc),
        index=True,
        nullable=False,
    )


__all__ = ["AuditLog"]
