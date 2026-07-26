"""
Model package.

Re-exports every mapped class so that BOTH of these keep working:

    from app.models import User, AIScan          # new style
    from app import models; models.AIScan        # ported monolith style

The import order matters only insofar as every module must be imported before
Base.metadata is handed to Alembic -- importing this package does that.
"""

from app.models.base import Base, utcnow  # noqa: F401
from app.models import enums  # noqa: F401

# --- 7 original tables -------------------------------------------------
from app.models.user import User, RefreshToken, EmailOtp  # noqa: F401
from app.models.doctor import (  # noqa: F401
    DoctorProfile,
    DoctorAvailability,
    DoctorFees,
    DoctorRating,
)
from app.models.scan import AIScan, ScanAttachment, ImageAccessLog, GuestScan  # noqa: F401
from app.models.appointment import (  # noqa: F401
    Appointment,
    AppointmentRequest,
    AppointmentRequestDoctor,
    AppointmentRequestSlot,
)

# --- new supporting tables --------------------------------------------
from app.models.consent import ConsentDocument, UserConsent  # noqa: F401
from app.models.audit import AuditLog  # noqa: F401

__all__ = [
    "Base",
    "utcnow",
    "enums",
    # original 7
    "User",
    "DoctorProfile",
    "AIScan",
    "DoctorAvailability",
    "DoctorFees",
    "Appointment",
    "DoctorRating",
    # new
    "RefreshToken",
    "EmailOtp",
    "AuditLog",
    "ConsentDocument",
    "UserConsent",
    "AppointmentRequest",
    "AppointmentRequestDoctor",
    "AppointmentRequestSlot",
    "ScanAttachment",
    "ImageAccessLog",
    "GuestScan",
]
