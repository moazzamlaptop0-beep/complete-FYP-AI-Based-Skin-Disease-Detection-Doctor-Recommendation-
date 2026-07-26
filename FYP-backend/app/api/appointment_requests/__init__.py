"""
Multi-doctor appointment requests + the triage/slot helpers the stepper needs.

BLUEPRINT REGISTRATION -- READ THIS BEFORE MOVING ANYTHING
----------------------------------------------------------
`app/api/__init__.py` is FROZEN (multiple agents import it in parallel), so this
blueprint cannot be added to its BLUEPRINTS tuple. It is instead registered as a
NESTED blueprint on `appointments_bp` at the bottom of
`app/api/appointments/routes.py`:

    appointments_bp.register_blueprint(appointment_requests_bp)

The parent carries NO url_prefix, so every path in routes.py stays absolute and
unprefixed -- exactly as if it had been registered at the top level. The only
observable difference is the endpoint NAME
("appointments.appointment_requests.create_appointment_request"), which nothing
in the contract references.

All routes here are ADDITIVE. None of the 39 original URLs is touched.
"""

from app.api.appointment_requests.routes import appointment_requests_bp  # noqa: F401

__all__ = ["appointment_requests_bp"]
