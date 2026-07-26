"""
Server-Sent Events for the live dashboards

Blueprint object only. The route functions live in routes.py.
Registered with NO url_prefix by app/api/__init__.py -- the 2 paths below are
absolute and share no common prefix.
"""

from app.api.streams.routes import streams_bp  # noqa: F401

__all__ = ["streams_bp"]
