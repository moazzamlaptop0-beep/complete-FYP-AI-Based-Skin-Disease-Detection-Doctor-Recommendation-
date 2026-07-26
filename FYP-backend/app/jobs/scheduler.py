"""
APScheduler wiring for the booking-conflict SLA job.

WHAT MOVED HERE
---------------
Monolith lines 3290-3293:

    scheduler = BackgroundScheduler()
    scheduler.add_job(func=resolve_expired_conflicts, trigger="interval", minutes=15)
    scheduler.start()
    atexit.register(lambda: scheduler.shutdown())

...which ran at IMPORT TIME. Under any multi-worker WSGI server that meant one
scheduler per worker, all of them racing to auto-resolve the same
Pending-Conflict pair -- and `_resolve_conflict_pair` emails BOTH patients every
time it runs. It was masked only by the single-process dev server.

Now:
  * nothing starts on import;
  * `start_scheduler(app)` is called by create_app() and immediately returns
    unless `app.config['RUN_SCHEDULER']` is true (run.py turns it on for exactly
    one process -- see its WERKZEUG_RUN_MAIN guard);
  * it is guarded THREE ways against a second start: a module-level flag, the
    APScheduler `running` flag, and `replace_existing=True` on a fixed job id.

WHAT DID *NOT* MOVE
-------------------
The job's actual logic. `resolve_expired_conflicts`, `_resolve_conflict_pair`
and `parse_appointment_datetime` live in app/services/conflict_service.py, moved
there VERBATIM from monolith lines 2597-2667 / 2454-2511 / 2580-2595. The manual
route `/api/resolve-conflict/<id>` and this unattended job MUST perform the
identical mutation, so they share one implementation rather than owning two
copies that can drift. This module only decides WHEN it runs.

Behaviour of the job itself is therefore unchanged: CONFLICT_SLA_HOURS = 4,
winner picked by TriageService.TIER_RANK (CRITICAL > URGENT > ROUTINE) with the
earlier `created_at` winning a tie, `auto_resolved=True`, `resolved_by=None`,
and an unparseable date/time is logged and skipped rather than silently dropped.
"""

import atexit
import logging

from app.extensions import scheduler

logger = logging.getLogger(__name__)

# Fixed ids so a second add_job() replaces rather than duplicates.
JOB_ID = "conflict_sla_job"
REQUEST_EXPIRY_JOB_ID = "appointment_request_expiry_job"
DEFAULT_INTERVAL_MINUTES = 15  # monolith: minutes=15
DEFAULT_REQUEST_EXPIRY_MINUTES = 15

_started = False


def run_conflict_sla_job(app):
    """Execute one SLA sweep inside an application context.

    The service reads config (SMTP creds via email_service) and touches the DB,
    and APScheduler runs it on a worker thread with no request and no app
    context, so one is pushed here.
    """
    from app.services.conflict_service import resolve_expired_conflicts

    with app.app_context():
        resolve_expired_conflicts()


def run_request_expiry_job(app):
    """Close Open appointment_requests whose expires_at has passed.

    Sibling of the SLA job and started by the same guard. Without it an express
    request nobody opened stays "Open" forever and the patient keeps believing a
    doctor is coming -- which is the same class of silent failure the SLA job
    exists to prevent on the booking side.
    """
    from app.services.request_matching import expire_stale_requests

    with app.app_context():
        expire_stale_requests()


def start_scheduler(app):
    """Register and start the SLA auto-resolve job. Idempotent.

    Returns the shared BackgroundScheduler either way, so callers can inspect
    it without caring whether this call was the one that started it.
    """
    global _started

    if not app.config.get("RUN_SCHEDULER", False):
        logger.debug("RUN_SCHEDULER is off; SLA conflict job not started.")
        return scheduler

    if _started or scheduler.running:
        logger.debug("Scheduler already running; skipping duplicate start.")
        return scheduler

    minutes = app.config.get("CONFLICT_SLA_JOB_MINUTES", DEFAULT_INTERVAL_MINUTES)

    expiry_minutes = app.config.get("REQUEST_EXPIRY_JOB_MINUTES", DEFAULT_REQUEST_EXPIRY_MINUTES)

    scheduler.add_job(
        func=lambda: run_conflict_sla_job(app),
        trigger="interval",
        minutes=minutes,
        id=JOB_ID,
        replace_existing=True,
        max_instances=1,       # a slow sweep must never overlap itself
        coalesce=True,         # missed runs collapse into one, not a burst
    )
    scheduler.add_job(
        func=lambda: run_request_expiry_job(app),
        trigger="interval",
        minutes=expiry_minutes,
        id=REQUEST_EXPIRY_JOB_ID,
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    scheduler.start()
    _started = True
    atexit.register(shutdown_scheduler)
    logger.info(
        "APScheduler started: %s every %s minutes, %s every %s minutes",
        JOB_ID, minutes, REQUEST_EXPIRY_JOB_ID, expiry_minutes,
    )
    return scheduler


def shutdown_scheduler(wait=False):
    global _started

    if not scheduler.running:
        _started = False
        return
    try:
        scheduler.shutdown(wait=wait)
    except Exception as exc:  # pragma: no cover - best effort at interpreter exit
        logger.warning("Scheduler shutdown failed: %s", exc)
    finally:
        _started = False


def is_running():
    return bool(_started and scheduler.running)


__all__ = [
    "JOB_ID",
    "REQUEST_EXPIRY_JOB_ID",
    "DEFAULT_INTERVAL_MINUTES",
    "DEFAULT_REQUEST_EXPIRY_MINUTES",
    "run_conflict_sla_job",
    "run_request_expiry_job",
    "start_scheduler",
    "shutdown_scheduler",
    "is_running",
]
