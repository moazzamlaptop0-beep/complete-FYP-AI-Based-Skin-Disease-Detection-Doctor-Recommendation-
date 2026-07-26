"""
Uploaded image serving

Blueprint object only. The route functions live in routes.py.
Registered with NO url_prefix by app/api/__init__.py -- the 1 paths below are
absolute and share no common prefix.
"""

from app.api.media.routes import media_bp  # noqa: F401

__all__ = ["media_bp"]
