"""
Booking, conflicts and appointment lifecycle

Blueprint object only. The route functions live in routes.py.
Registered with NO url_prefix by app/api/__init__.py -- the 6 paths below are
absolute and share no common prefix.
"""

from app.api.appointments.routes import appointments_bp  # noqa: F401

__all__ = ["appointments_bp"]
