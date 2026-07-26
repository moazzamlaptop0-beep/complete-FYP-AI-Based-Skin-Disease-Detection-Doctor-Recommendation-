"""
Doctor availability, fees and generated slots

Blueprint object only. The route functions live in routes.py.
Registered with NO url_prefix by app/api/__init__.py -- the 5 paths below are
absolute and share no common prefix.
"""

from app.api.schedule.routes import schedule_bp  # noqa: F401

__all__ = ["schedule_bp"]
