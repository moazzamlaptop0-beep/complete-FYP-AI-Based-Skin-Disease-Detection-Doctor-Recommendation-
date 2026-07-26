"""
=============================================================================
 THIS FILE IS FROZEN.  DO NOT EDIT IT.
=============================================================================
Multiple agents are filling in the blueprint stubs in parallel. Every one of
them imports from here, so a concurrent edit is a guaranteed merge conflict and
a guaranteed lost route. Add your handlers to
`app/api/<blueprint>/routes.py` -- the blueprint object is already created,
already imported, and already registered.

If you genuinely believe this file must change, stop and escalate instead.
=============================================================================

WHY NO url_prefix
-----------------
The 39 existing paths share no common scheme: /api/..., /doctor/..., /admin/...,
/static/uploads/..., and bare /predict, /login, /register, /send_report. A
url_prefix on any blueprint would rewrite its paths and break the React client,
which is the go/no-go gate for the whole refactor. Every blueprint is therefore
registered with the full absolute path baked into its own @route decorator.

ROUTE COUNT BY BLUEPRINT (39 total)
-----------------------------------
  auth            6    /register /verify-otp-email /resend-otp /login
                       /forgot-password /reset-password
  scans           8    /predict /send_report /api/scans/<id>/report-status
                       /api/override-severity/<id> /doctor/update_scan/<id>
                       /doctor/delete_scan/<id> /patient/scans/<id>
                       /doctor/scans/<id>
  doctors         3    /api/doctors/public /api/doctors /api/doctor/profile
  ratings         3    /api/rate-doctor /api/doctor/ratings /doctor/ratings/<id>
  schedule        5    /api/update-availability /api/doctor-availability/<id>
                       /api/update-fees /api/doctor-fees/<id> /api/slots/<id>
  appointments    6    /api/book-slot /api/resolve-conflict/<id>
                       /api/doctor-appointments/<id> /api/patient-appointments/<id>
                       /api/update-appointment/<id> /api/delete-appointment/<id>
  admin           4    /admin/stats /admin/doctors /admin/doctors/<id>/verify
                       /admin/doctors/<id>
  streams         2    /api/doctor-updates-stream/<id>
                       /api/patient-updates-stream/<id>
  chat            1    /api/chat
  media           1    /static/uploads/<path:filename>

Plus the additive, non-contract health blueprint: /healthz and /readyz.
"""

from app.api.admin import admin_bp
from app.api.appointments import appointments_bp
from app.api.auth import auth_bp
from app.api.chat import chat_bp
from app.api.doctors import doctors_bp
from app.api.health import health_bp
from app.api.media import media_bp
from app.api.ratings import ratings_bp
from app.api.scans import scans_bp
from app.api.schedule import schedule_bp
from app.api.streams import streams_bp

# Order is irrelevant to routing (Werkzeug sorts rules by specificity), but it
# is kept stable so `flask routes` output stays diffable.
BLUEPRINTS = (
    auth_bp,
    scans_bp,
    doctors_bp,
    ratings_bp,
    schedule_bp,
    appointments_bp,
    admin_bp,
    streams_bp,
    chat_bp,
    media_bp,
    health_bp,
)

EXPECTED_CONTRACT_ROUTES = 39


def register_blueprints(app):
    """Register all ten contract blueprints (plus health) with NO url_prefix."""
    for blueprint in BLUEPRINTS:
        app.register_blueprint(blueprint)
    return app


__all__ = ["register_blueprints", "BLUEPRINTS", "EXPECTED_CONTRACT_ROUTES"]
