"""
Admin dashboard: stats and doctor verification

Blueprint object only. The route functions live in routes.py.
Registered with NO url_prefix by app/api/__init__.py -- the 4 paths below are
absolute and share no common prefix.
"""

from app.api.admin.routes import admin_bp  # noqa: F401

__all__ = ["admin_bp"]
