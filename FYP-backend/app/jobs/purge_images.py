"""
Image retention sweep.

TWO JOBS, ONE SCHEDULE
----------------------
1. PURGE SOFT-DELETED PIXELS.
   `DELETE /api/scans/<id>/image` unlinks the files inline and stamps
   `image_purged_at`. This sweep is the SAFETY NET for the rows where that did
   not happen: the disk was full, the file was locked by a virus scanner, the
   process died between the DB commit and the unlink, or an older code path
   (or a manual UPDATE) set `image_deleted_at` without touching the bytes. A
   photograph the patient believes is deleted must not survive on disk because
   one os.remove() failed six weeks ago.

2. PRUNE THE ACCESS LOG.
   `image_access_log` grows by one row for every full-resolution view, forever.
   It is evidence, so it is kept for a long time (IMAGE_ACCESS_LOG_RETENTION_DAYS,
   default 365) -- but not for all time, because an audit table nobody ever
   truncates eventually becomes the largest table in the database and then
   somebody truncates ALL of it in a hurry.

WHY THE GRACE PERIOD IS NOT ZERO
--------------------------------
`IMAGE_PURGE_GRACE_HOURS` (default 0) exists for deployments that want an
"undo" window after a patient deletes a photo. At 0 the sweep is purely a
retry of a purge that was already meant to happen, which is the safe default:
the delete endpoint promises the pixels are gone immediately, and a grace
period would quietly make that promise false.

RUNNING IT
----------
  * Automatically, in-process:  RUN_SCHEDULER=true and IMAGE_PURGE_JOB=true.
    create_app() calls start_purge_job(app) next to the SLA job, so exactly one
    process runs it (see run.py's WERKZEUG_RUN_MAIN guard).
  * By hand, from FYP-backend:
        .venv/Scripts/python.exe -m app.jobs.purge_images --dry-run
        .venv/Scripts/python.exe -m app.jobs.purge_images

IDEMPOTENT. Running it twice does nothing the second time: a purged row has
`image_purged_at` set and is filtered out of the query.
"""

import argparse
import datetime
import logging
import os

from app.services import image_service, storage_service

logger = logging.getLogger(__name__)

JOB_ID = "image_retention_job"

DEFAULT_INTERVAL_HOURS = 24
DEFAULT_GRACE_HOURS = 0
DEFAULT_ACCESS_LOG_RETENTION_DAYS = 365
DEFAULT_BATCH = 500

_started = False


def _cfg(app, key, default):
    if app is None:
        return default
    return app.config.get(key, default)


# ======================================================================
# 1. PURGE SOFT-DELETED IMAGES
# ======================================================================
def purge_soft_deleted(db, grace_hours=0, batch=DEFAULT_BATCH, dry_run=False):
    """Unlink files for scans whose image was deleted but never purged.

    Returns {'scans': n, 'attachments': m, 'files': k}.
    """
    from app.models import AIScan, ScanAttachment

    cutoff = datetime.datetime.utcnow() - datetime.timedelta(hours=max(0, grace_hours or 0))

    scans = (
        db.query(AIScan)
        .filter(
            AIScan.image_deleted_at.isnot(None),
            AIScan.image_purged_at.is_(None),
            AIScan.image_deleted_at <= cutoff,
        )
        .order_by(AIScan.id.asc())
        .limit(batch)
        .all()
    )

    files = 0
    for scan in scans:
        if dry_run:
            for stored in (scan.image_url, scan.thumb_url, scan.blur_url):
                path = storage_service.absolute_path(stored) if stored else None
                if path and os.path.exists(path):
                    files += 1
            continue
        removed = image_service.purge_files(scan)
        files += removed
        scan.image_purged_at = datetime.datetime.utcnow()
        logger.info("Purged %s file(s) for soft-deleted scan %s", removed, scan.id)

    # Attachments whose parent scan is gone from disk but which were marked
    # deleted on their own (e.g. one photo removed from a multi-angle upload).
    attachments = (
        db.query(ScanAttachment)
        .filter(ScanAttachment.image_deleted_at.isnot(None))
        .order_by(ScanAttachment.id.asc())
        .limit(batch)
        .all()
    )
    touched = 0
    for attachment in attachments:
        paths = [
            storage_service.absolute_path(v)
            for v in (attachment.image_url, attachment.thumb_url, attachment.blur_url)
            if v
        ]
        present = [p for p in paths if p and os.path.exists(p)]
        if not present:
            continue
        touched += 1
        if dry_run:
            files += len(present)
            continue
        files += image_service.purge_files(attachment)

    if not dry_run:
        db.flush()

    return {"scans": len(scans), "attachments": touched, "files": files}


# ======================================================================
# 2. PRUNE THE ACCESS LOG
# ======================================================================
def prune_access_log(db, retention_days=DEFAULT_ACCESS_LOG_RETENTION_DAYS, dry_run=False):
    """Delete image_access_log rows older than the retention window."""
    from app.models import ImageAccessLog

    if not retention_days or retention_days <= 0:
        return 0

    cutoff = datetime.datetime.utcnow() - datetime.timedelta(days=retention_days)
    query = db.query(ImageAccessLog).filter(ImageAccessLog.viewed_at < cutoff)

    if dry_run:
        return query.count()

    deleted = query.delete(synchronize_session=False)
    if deleted:
        logger.info("Pruned %s image_access_log rows older than %s days", deleted, retention_days)
    return deleted


def purge_expired_guest_scans(db, dry_run=False):
    """Delete unclaimed guest scans past their TTL, and their files.

    A guest scan is a skin photograph with NO owner: nobody can list it, nobody
    consented to it being kept, and if it is never claimed nobody will ever ask
    for it. Leaving those on disk indefinitely is the kind of quiet data hoard
    that is impossible to justify later, so they expire.

    CLAIMED rows are never touched -- the file now belongs to a real ai_scans
    row, and deleting it would blank out the patient's own history. Their
    guest_scans row is bookkeeping and is left as the audit trail of where the
    scan came from.
    """
    from app.models import GuestScan

    now = datetime.datetime.utcnow()
    query = (
        db.query(GuestScan)
        .filter(GuestScan.claimed_scan_id.is_(None))
        .filter(GuestScan.expires_at.isnot(None))
        .filter(GuestScan.expires_at < now)
    )

    rows = query.all()
    if dry_run:
        return {"rows": len(rows), "files": 0}

    files = 0
    for row in rows:
        for stored in (row.image_url, row.thumb_url, row.blur_url):
            if not stored:
                continue
            try:
                if storage_service.delete_file(stored):
                    files += 1
            except OSError as exc:
                logger.warning("Could not delete guest file %s: %s", stored, exc)
        db.delete(row)

    if rows:
        logger.info("Purged %s expired guest scan(s), %s file(s)", len(rows), files)
    return {"rows": len(rows), "files": files}


# ======================================================================
# 3. THE SWEEP
# ======================================================================
def run_retention_sweep(app=None, dry_run=False):
    """One full pass. Safe to call with or without an application context."""
    from app.core.db import session_scope

    grace = int(_cfg(app, "IMAGE_PURGE_GRACE_HOURS", DEFAULT_GRACE_HOURS))
    retention = int(_cfg(app, "IMAGE_ACCESS_LOG_RETENTION_DAYS", DEFAULT_ACCESS_LOG_RETENTION_DAYS))
    batch = int(_cfg(app, "IMAGE_PURGE_BATCH", DEFAULT_BATCH))

    with session_scope() as db:
        purged = purge_soft_deleted(db, grace_hours=grace, batch=batch, dry_run=dry_run)
        pruned = prune_access_log(db, retention_days=retention, dry_run=dry_run)
        guests = purge_expired_guest_scans(db, dry_run=dry_run)

    summary = {
        "dry_run": bool(dry_run),
        "scans_purged": purged["scans"],
        "attachments_purged": purged["attachments"],
        "files_removed": purged["files"],
        "access_log_rows_pruned": pruned,
        "guest_scans_purged": guests["rows"],
        "guest_files_removed": guests["files"],
    }
    logger.info("Image retention sweep: %s", summary)
    return summary


def run_in_app_context(app):
    """APScheduler entry point: the worker thread has no app context."""
    with app.app_context():
        return run_retention_sweep(app)


# ======================================================================
# 4. SCHEDULING
# ======================================================================
def start_purge_job(app):
    """Register the sweep on the shared BackgroundScheduler. Idempotent.

    No-op unless IMAGE_PURGE_JOB is true. It shares app/jobs/scheduler.py's
    scheduler instance (and therefore its single-process guarantee) rather than
    starting a second one -- two schedulers in one process is how the monolith
    ended up emailing both patients twice per conflict.
    """
    global _started

    if not app.config.get("IMAGE_PURGE_JOB", False):
        logger.debug("IMAGE_PURGE_JOB is off; image retention sweep not scheduled.")
        return None

    from app.extensions import scheduler

    if _started:
        logger.debug("Image retention sweep already scheduled.")
        return scheduler

    hours = app.config.get("IMAGE_PURGE_INTERVAL_HOURS", DEFAULT_INTERVAL_HOURS)
    scheduler.add_job(
        func=lambda: run_in_app_context(app),
        trigger="interval",
        hours=hours,
        id=JOB_ID,
        replace_existing=True,
        max_instances=1,
        coalesce=True,
    )
    if not scheduler.running:
        scheduler.start()
    _started = True
    logger.info("Image retention sweep scheduled: %s every %s hours", JOB_ID, hours)
    return scheduler


def main(argv=None):  # pragma: no cover - CLI
    parser = argparse.ArgumentParser(description="Purge soft-deleted images and prune the access log.")
    parser.add_argument("--dry-run", action="store_true", help="Report what would happen, change nothing.")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
    )

    from app import create_app

    application = create_app()
    with application.app_context():
        summary = run_retention_sweep(application, dry_run=args.dry_run)
    for key, value in summary.items():
        print(f"{key}: {value}")
    return 0


__all__ = [
    "JOB_ID",
    "DEFAULT_INTERVAL_HOURS",
    "DEFAULT_GRACE_HOURS",
    "DEFAULT_ACCESS_LOG_RETENTION_DAYS",
    "purge_soft_deleted",
    "prune_access_log",
    "run_retention_sweep",
    "run_in_app_context",
    "start_purge_job",
    "main",
]


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
