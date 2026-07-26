"""
Backfill thumb_url / blur_url for images uploaded before phase 3C.

WHY THIS EXISTS
---------------
295 files were already on disk when the privacy work landed, and every
`ai_scans` row pointing at them has `thumb_url` and `blur_url` NULL. The read
path (app/services/image_service.resolve_file -> ensure_variants) builds a
missing variant lazily on first request, so nothing is BROKEN without this
script -- but lazy generation happens inside a request, so the first doctor to
open a case waits on Pillow, and a scan marked sensitive with no blur file yet
serves a 404 preview rather than a blurred one. Running this once removes both.

WHAT IT DOES *NOT* DO
---------------------
It never touches the original file, never writes to any column other than
`thumb_url` / `blur_url`, and skips any row whose image was deleted. A run that
crashes halfway is resumable: rows already carrying both paths are filtered out
of the query.

USAGE (from FYP-backend)
------------------------
    .venv/Scripts/python.exe -m scripts.backfill_image_variants --dry-run
    .venv/Scripts/python.exe -m scripts.backfill_image_variants
    .venv/Scripts/python.exe -m scripts.backfill_image_variants --limit 50 --force

--force regenerates variants that already exist (use after changing
BLUR_DOWNSCALE_PX or BLUR_RADIUS in image_service.py -- the old blurs are NOT
retroactively re-blurred by a constant change alone).
"""

import argparse
import logging
import os
import sys

logger = logging.getLogger("backfill_image_variants")


def _ensure_path():
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if base not in sys.path:
        sys.path.insert(0, base)
    return base


def backfill_scans(db, limit=None, force=False, dry_run=False):
    from app.models import AIScan
    from app.services import image_service, storage_service

    query = db.query(AIScan).filter(
        AIScan.image_url.isnot(None),
        AIScan.image_deleted_at.is_(None),
    )
    if not force:
        query = query.filter((AIScan.thumb_url.is_(None)) | (AIScan.blur_url.is_(None)))
    query = query.order_by(AIScan.id.asc())
    if limit:
        query = query.limit(limit)

    rows = query.all()
    done = skipped = failed = 0

    for scan in rows:
        source = storage_service.absolute_path(scan.image_url)
        if not source or not os.path.exists(source):
            logger.warning("scan %s: source file missing (%s)", scan.id, scan.image_url)
            skipped += 1
            continue

        if dry_run:
            logger.info("scan %s: would build variants for %s", scan.id, scan.image_url)
            done += 1
            continue

        built = image_service.generate_variants(scan.image_url, force=force)
        if not built["thumb_url"] and not built["blur_url"]:
            logger.error("scan %s: BOTH variants failed for %s", scan.id, scan.image_url)
            failed += 1
            continue
        if built["thumb_url"]:
            scan.thumb_url = built["thumb_url"]
        if built["blur_url"]:
            scan.blur_url = built["blur_url"]
        done += 1
        logger.info("scan %s: thumb=%s blur=%s", scan.id, bool(built["thumb_url"]), bool(built["blur_url"]))

    return {"total": len(rows), "done": done, "skipped": skipped, "failed": failed}


def backfill_attachments(db, limit=None, force=False, dry_run=False):
    from app.models import ScanAttachment
    from app.services import image_service, storage_service

    query = db.query(ScanAttachment).filter(
        ScanAttachment.image_url.isnot(None),
        ScanAttachment.image_deleted_at.is_(None),
    )
    if not force:
        query = query.filter(
            (ScanAttachment.thumb_url.is_(None)) | (ScanAttachment.blur_url.is_(None))
        )
    query = query.order_by(ScanAttachment.id.asc())
    if limit:
        query = query.limit(limit)

    rows = query.all()
    done = skipped = 0
    for attachment in rows:
        source = storage_service.absolute_path(attachment.image_url)
        if not source or not os.path.exists(source):
            skipped += 1
            continue
        if dry_run:
            done += 1
            continue
        built = image_service.generate_variants(attachment.image_url, force=force)
        if built["thumb_url"]:
            attachment.thumb_url = built["thumb_url"]
        if built["blur_url"]:
            attachment.blur_url = built["blur_url"]
        done += 1

    return {"total": len(rows), "done": done, "skipped": skipped}


def main(argv=None):  # pragma: no cover - CLI
    _ensure_path()

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--force", action="store_true", help="Rebuild variants that already exist.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
    )

    from app import create_app
    from app.core.db import session_scope

    application = create_app()
    with application.app_context():
        with session_scope() as db:
            scans = backfill_scans(db, limit=args.limit, force=args.force, dry_run=args.dry_run)
            attachments = backfill_attachments(
                db, limit=args.limit, force=args.force, dry_run=args.dry_run
            )

    print("scans:      ", scans)
    print("attachments:", attachments)
    if scans["failed"]:
        print(f"WARNING: {scans['failed']} scan(s) produced no variant at all.")
    return 0


__all__ = ["backfill_scans", "backfill_attachments", "main"]


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
