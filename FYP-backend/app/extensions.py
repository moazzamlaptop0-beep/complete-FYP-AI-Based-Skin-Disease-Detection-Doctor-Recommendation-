"""
Extension singletons.

Created here, unbound, and wired to the app inside create_app(). Keeping them
module-level means blueprints can `from app.extensions import limiter` without
importing the application object.
"""

import logging

from apscheduler.schedulers.background import BackgroundScheduler
from flask_cors import CORS
from flask_limiter import Limiter
from sqlalchemy.orm import scoped_session

from app.core.db import SessionLocal

logger = logging.getLogger(__name__)

# ----------------------------------------------------------------------
# CORS -- the monolith called plain CORS(app), i.e. every origin allowed.
# init_extensions() reproduces that when CORS_ORIGINS == "*".
# ----------------------------------------------------------------------
cors = CORS()

# ----------------------------------------------------------------------
# Rate limiter -- inert unless RATELIMIT_ENABLED.
# ----------------------------------------------------------------------
limiter = Limiter(key_func=lambda: "global", default_limits=[])

# ----------------------------------------------------------------------
# Request-scoped session registry.
#
# NOT a replacement for SessionLocal. Ported handlers and BOTH SSE generators
# must keep calling SessionLocal() directly: the streams open and close a
# session inside their polling loop and depend on a fresh identity map each
# iteration. db_session exists for new, ordinary request handlers that want
# teardown-managed cleanup.
# ----------------------------------------------------------------------
db_session = scoped_session(SessionLocal)

# ----------------------------------------------------------------------
# APScheduler.
#
# The monolith started this at import (line 3292), so under gunicorn EVERY
# worker ran its own copy of the SLA job and the same conflict could be
# auto-resolved N times. Now it only starts when RUN_SCHEDULER is true, which
# should be exactly one process.
# ----------------------------------------------------------------------
scheduler = BackgroundScheduler()
_scheduler_started = False


def init_extensions(app):
    origins = app.config.get("CORS_ORIGINS", "*")
    if isinstance(origins, str) and origins.strip() != "*":
        origins = [o.strip() for o in origins.split(",") if o.strip()]
    cors.init_app(
        app,
        resources={r"/*": {"origins": origins}},
        supports_credentials=app.config.get("CORS_SUPPORTS_CREDENTIALS", False),
    )

    from app.core.rate_limit import init_rate_limit

    init_rate_limit(app)

    @app.teardown_appcontext
    def _remove_session(exc=None):  # pragma: no cover - trivial
        db_session.remove()

    return app


def start_scheduler(app):
    """Register and start the SLA auto-resolve job. Idempotent.

    The job definition itself now lives in app/jobs/scheduler.py (it owns the
    start guard, the atexit hook and the interval). This stays as the entry
    point create_app() already calls, and simply delegates, so there is exactly
    ONE place that can start the scheduler and exactly one BackgroundScheduler
    instance -- the singleton above, which app.jobs.scheduler imports.
    """
    global _scheduler_started

    from app.jobs.scheduler import start_scheduler as _start

    _start(app)
    _scheduler_started = scheduler.running
    return scheduler
