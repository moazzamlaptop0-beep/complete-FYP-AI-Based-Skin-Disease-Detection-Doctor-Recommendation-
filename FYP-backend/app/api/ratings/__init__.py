"""
Doctor ratings and reviews

Blueprint object only. The route functions live in routes.py.
Registered with NO url_prefix by app/api/__init__.py -- the 3 paths below are
absolute and share no common prefix.
"""

from app.api.ratings.routes import ratings_bp  # noqa: F401

__all__ = ["ratings_bp"]
