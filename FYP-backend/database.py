"""
COMPATIBILITY SHIM -- the real engine/session plumbing lives in app/core/db.py.

`legacy/app_monolith.py` does `from database import engine, SessionLocal`, and
the original `models.py` did `from database import Base`. Both keep working
through this module, and both resolve to the SAME objects the new package uses
-- there is exactly one engine and one MetaData in the process.

DELETE THIS FILE when legacy/ is deleted at the end of the refactor.
"""

from app.core.db import (  # noqa: F401
    SessionLocal,
    dispose_engine,
    get_db,
    get_engine,
    init_engine,
    session_scope,
)
from app.models.base import Base  # noqa: F401


def __getattr__(name):
    # `from database import engine` still works; the engine is built on first
    # access rather than at import, so importing this module never requires a
    # live DATABASE_URL.
    if name == "engine":
        return get_engine()
    if name == "SQLALCHEMY_DATABASE_URL":
        import os

        return os.getenv("DATABASE_URL")
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


__all__ = [
    "Base",
    "SessionLocal",
    "engine",
    "get_db",
    "get_engine",
    "init_engine",
    "dispose_engine",
    "session_scope",
]
