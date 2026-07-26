"""
AI prediction, reports and scan review

Blueprint object only. The route functions live in routes.py.
Registered with NO url_prefix by app/api/__init__.py -- the 8 paths below are
absolute and share no common prefix.
"""

from app.api.scans.routes import scans_bp  # noqa: F401

__all__ = ["scans_bp"]
