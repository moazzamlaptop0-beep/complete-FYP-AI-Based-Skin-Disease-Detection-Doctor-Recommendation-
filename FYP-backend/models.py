"""
COMPATIBILITY SHIM -- the real models live in app/models/.

`legacy/app_monolith.py` does `import models` and then `models.AIScan`,
`models.Base.metadata.create_all(...)` and so on. Rather than editing that
read-only reference file, this module re-exports everything from the new
package, so both import paths resolve to the SAME mapped classes and the SAME
MetaData object.

Do not add models here. Add them under app/models/ and re-export from
app/models/__init__.py; this file picks them up automatically via the star
import below.

DELETE THIS FILE when legacy/ is deleted at the end of the refactor.
"""

from app.models import *  # noqa: F401,F403
from app.models import Base  # noqa: F401
from app.models import (  # noqa: F401  -- explicit for `models.X` attribute access
    AIScan,
    Appointment,
    AppointmentRequest,
    AppointmentRequestDoctor,
    AppointmentRequestSlot,
    AuditLog,
    ConsentDocument,
    DoctorAvailability,
    DoctorFees,
    DoctorProfile,
    DoctorRating,
    EmailOtp,
    ImageAccessLog,
    RefreshToken,
    ScanAttachment,
    User,
    UserConsent,
)
