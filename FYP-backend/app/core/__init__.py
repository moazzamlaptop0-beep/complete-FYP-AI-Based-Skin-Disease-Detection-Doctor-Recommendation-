"""
Cross-cutting infrastructure: response envelope, errors, DB, security, RBAC.

IMPORTANT: nothing in `app.core` may import the Flask application object. Use
`flask.current_app` instead. The monolith's decorators read
`app.config['SECRET_KEY']` directly, which is exactly the circular import that
made splitting app.py impossible.

This __init__ intentionally re-exports only the two things almost every module
needs, so that importing `app.core` never drags in SQLAlchemy or PyJWT.
"""

from app.core.responses import generate_response  # noqa: F401

__all__ = ["generate_response"]
