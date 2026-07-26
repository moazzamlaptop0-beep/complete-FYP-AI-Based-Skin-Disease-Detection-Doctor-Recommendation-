"""
Database engine / session plumbing.

Replaces the old top-level `database.py` (which is now a thin shim re-exporting
from here so that legacy/app_monolith.py still imports).

Design notes
------------
* `SessionLocal` is a plain `sessionmaker`, NOT a `scoped_session`. Every call
  must return a BRAND NEW Session, because the two SSE generators
  (monolith lines 1280-1587) open and close a session inside their polling loop
  and rely on a cold identity map to see other transactions' writes. A
  scoped_session would hand the same Session back every iteration and the
  dashboards would silently stop updating.
* The engine is created lazily so that importing `app.*` never requires a live
  DATABASE_URL (tests, `--help`, alembic autogenerate).
* `pool_pre_ping=True` is new: it costs one `SELECT 1` per checkout and removes
  the "server closed the connection unexpectedly" class of 500s.
"""

import contextlib
import logging
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

load_dotenv()

logger = logging.getLogger(__name__)

__all__ = [
    "SessionLocal",
    "engine",
    "get_engine",
    "init_engine",
    "dispose_engine",
    "session_scope",
    "get_db",
    "ping",
]

# Reconfigurable factory. init_engine() binds it; until then calling it raises,
# which is exactly the signal we want.
SessionLocal = sessionmaker(autocommit=False, autoflush=False, future=True)

_engine = None


def _database_url(url=None):
    return url or os.environ.get("DATABASE_URL")


def init_engine(url=None, **engine_kwargs):
    """(Re)create the engine and rebind SessionLocal. Idempotent-ish: calling it
    again with a different URL swaps the binding for the whole process."""
    global _engine

    resolved = _database_url(url)
    if not resolved:
        raise RuntimeError(
            "DATABASE_URL is not set. Put it in FYP-backend/.env, e.g. "
            "DATABASE_URL=postgresql://user:pass@localhost:5432/ai_derma_db"
        )

    options = {
        "pool_pre_ping": True,
        "future": True,
    }
    # SQLite (used by nothing today, but keeps tests portable) rejects pool args.
    if not resolved.startswith("sqlite"):
        options["pool_size"] = int(os.environ.get("DB_POOL_SIZE", 5))
        options["max_overflow"] = int(os.environ.get("DB_MAX_OVERFLOW", 10))
    options.update(engine_kwargs)

    if _engine is not None:
        try:
            _engine.dispose()
        except Exception:  # pragma: no cover - best effort
            pass

    _engine = create_engine(resolved, **options)
    SessionLocal.configure(bind=_engine)
    return _engine


def get_engine():
    """Return the process engine, creating it from $DATABASE_URL on first use."""
    global _engine
    if _engine is None:
        init_engine()
    return _engine


def dispose_engine():
    global _engine
    if _engine is not None:
        _engine.dispose()
        _engine = None


def __getattr__(name):
    # PEP 562: `from app.core.db import engine` still works, but the engine is
    # only actually built at that moment, not at import time.
    if name == "engine":
        return get_engine()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


@contextlib.contextmanager
def session_scope():
    """Transactional scope: commits on success, rolls back on exception, always
    closes. Use for NEW code. Ported monolith handlers keep their explicit
    SessionLocal()/try/finally shape so their behaviour stays identical."""
    if _engine is None:
        get_engine()
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def get_db():
    """Legacy generator kept for compatibility with the old database.py."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def ping():
    """True when the database answers. Used by /readyz."""
    from sqlalchemy import text

    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception as exc:
        logger.warning("Database ping failed: %s", exc)
        return False
