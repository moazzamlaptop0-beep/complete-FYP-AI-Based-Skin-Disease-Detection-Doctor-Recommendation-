"""
Medical image privacy: one authorization predicate, server-side variants, and
consent-based deletion.

WHY THIS MODULE EXISTS
----------------------
Until now every patient's skin photograph was world-readable at
`/static/uploads/<file>`: no token, no owner check, and Flask's BUILT-IN static
rule served the same bytes through three URL spellings that never even reached
the media blueprint. This module is the replacement -- an authenticated read
path where the authorization decision lives in exactly ONE function.

THE PREDICATE IS THE WHOLE POINT
--------------------------------
`can_view(scan, actor)` is the union of four clauses:

    1. actor IS the patient            (scan.user_id == actor.id)
    2. actor IS the assigned reviewer  (scan.doctor_id == actor.id)
    3. actor is an INVITED doctor on an appointment_request for this scan
       (appointment_request_doctors JOIN appointment_requests, response != 'Withdrawn')
    4. actor holds Permission.SCAN_READ_ANY   (Admin)

CLAUSE 3 IS NOT OPTIONAL AND IS NOT DECORATION. A patient may invite up to
three doctors to one request, but `ai_scans.doctor_id` holds exactly ONE id.
Without clause 3, two of the three invited doctors get a 403 on the very
thumbnail their own inbox card renders. Any other place that exposes a scan
image MUST call this function rather than re-deriving "is this my patient?".

SERVER-SIDE BLUR, NOT CSS BLUR
------------------------------
`filter: blur(20px)` in the browser is a decoration over the full-resolution
bytes -- the real photograph is in the network tab, in the disk cache, and one
devtools toggle away. The 'blur' variant here is produced by DOWNSCALING to 32
pixels, which physically destroys the information, then upscaling and applying
GaussianBlur so the result reads as a photo rather than as a broken image. It
is not recoverable because the pixels no longer exist, not because we asked the
client nicely.

Every variant is re-encoded as JPEG, which also drops EXIF -- including the GPS
coordinates phone cameras write into the medical photo of somebody's back.

WHAT DELETION MEANS HERE
------------------------
"Delete my photo" deletes the PHOTO, never the record. `ai_scans` keeps the row
and every clinical field (prediction_result, confidence, severity_level,
triage_score, triage_reasons, doctor_comment, patient_questionnaire) plus all
linked appointments and ratings; only the pixels are unlinked from disk and
`image_deleted_at` / `image_delete_reason` / `image_delete_consent_at` record
who asked and why. That is what "consent-based delete while retaining history"
means, and it is why this is not `DELETE /scan/<id>`.
"""

import datetime
import logging
import os

from app.core.rbac import Permission
from app.models import enums
from app.services import storage_service

logger = logging.getLogger(__name__)


# ======================================================================
# CONTRACT CONSTANTS
# ======================================================================
# The authenticated read path. app/services/admin_service.py holds an identical
# literal (it shipped first and must not import this module at request time);
# if this ever changes, change it there too.
SCAN_IMAGE_ENDPOINT = "/api/scans/{scan_id}/image"
ATTACHMENT_IMAGE_ENDPOINT = "/api/scans/{scan_id}/attachments/{attachment_id}/image"

VARIANT_FULL = "full"
VARIANT_BLUR = "blur"
VARIANT_THUMB = "thumb"
VARIANTS = (VARIANT_FULL, VARIANT_BLUR, VARIANT_THUMB)

# Only 'full' is logged. A doctor's inbox renders a dozen thumbnails per page
# load; logging those buries the one row that matters (someone opened the actual
# photograph) under noise nobody will ever read.
LOGGED_VARIANTS = (VARIANT_FULL,)

# Derived-file prefixes. Variants live in the SAME directory as the original so
# that storage_service.absolute_path() (which is basename-based) keeps working.
THUMB_PREFIX = "thumb_"
BLUR_PREFIX = "blur_"

THUMB_MAX_PX = 400          # longest side of the thumbnail
BLUR_DOWNSCALE_PX = 32      # <-- the irreversible step
BLUR_OUTPUT_PX = 400        # what the destroyed image is stretched back to
BLUR_RADIUS = 24
JPEG_QUALITY = 82

# The literal a client must echo back to delete a photo.
DELETE_CONFIRM_TEXT = "DELETE"

# An appointment in one of these states still needs the picture.
# "Confirmed" was missing: it is the status a doctor's own "Confirm" button and
# every conflict resolution produce, i.e. the MOST committed upcoming
# consultation in the system. Without it the 409 guard silently did not fire and
# the pixels were unlinked before the visit happened. Mirrors
# request_matching.SLOT_TAKEN_STATUSES minus the terminal "Completed", which no
# longer needs the picture.
ACTIVE_APPOINTMENT_STATUSES = ("Scheduled", "Confirmed", "Pending-Conflict")

# Literal lives in app/models/enums.py -- see the note there on why these are
# data rather than names.
CONSENT_IMAGE_DELETION = enums.CONSENT_IMAGE_DELETE

ERR_IMAGE_FORBIDDEN = "Access denied! You are not permitted to view this image."
ERR_IMAGE_DELETED = "This image has been deleted."
ERR_IMAGE_MISSING = "Image file not found."
ERR_PREVIEW_UNAVAILABLE = "A privacy-safe preview of this image could not be produced."


def _config(key, default):
    try:
        from flask import current_app, has_app_context

        if has_app_context():
            return current_app.config.get(key, default)
    except Exception:  # pragma: no cover - defensive
        pass
    return default


# ======================================================================
# 1. AUTHORIZATION -- THE SINGLE PREDICATE
# ======================================================================
def invited_doctor_ids(db, scan_id):
    """Doctor ids invited to any appointment_request that carries this scan.

    Withdrawn invitations do not count; a Declined one still does, because a
    doctor who declined has already seen the case and may legitimately re-open
    it while writing their note.

    CONSENT IS PART OF THE PREDICATE, NOT JUST THE SERIALIZER. An invitation
    created with consent_share_scan = False grants the clinical fields (the
    request payload still carries the diagnosis, severity and notes) but NOT the
    photograph. Filtering it out here is what makes that promise true on the
    image routes as well -- withholding `image_url` in the JSON was never
    enforcement, because the doctor also receives the scan id.
    """
    from app.models import AppointmentRequest, AppointmentRequestDoctor

    try:
        rows = (
            db.query(AppointmentRequestDoctor.doctor_id)
            .join(AppointmentRequest, AppointmentRequest.id == AppointmentRequestDoctor.request_id)
            .filter(
                AppointmentRequest.scan_id == scan_id,
                AppointmentRequest.consent_share_scan.is_(True),
                AppointmentRequestDoctor.response != "Withdrawn",
            )
            .all()
        )
        return {row[0] for row in rows if row[0] is not None}
    except Exception as exc:  # pragma: no cover - table absent on an old DB
        logger.warning("invited_doctor lookup failed for scan %s: %s", scan_id, exc)
        return set()


def is_invited_doctor(db, scan_id, doctor_id):
    if not scan_id or not doctor_id:
        return False
    from app.models import AppointmentRequest, AppointmentRequestDoctor

    try:
        return (
            db.query(AppointmentRequestDoctor.id)
            .join(AppointmentRequest, AppointmentRequest.id == AppointmentRequestDoctor.request_id)
            .filter(
                AppointmentRequest.scan_id == int(scan_id),
                # See invited_doctor_ids(): no per-request photo consent, no
                # photograph. The doctor keeps the clinical fields either way.
                AppointmentRequest.consent_share_scan.is_(True),
                AppointmentRequestDoctor.doctor_id == int(doctor_id),
                AppointmentRequestDoctor.response != "Withdrawn",
            )
            .first()
            is not None
        )
    except Exception as exc:  # pragma: no cover - table absent on an old DB
        logger.warning("invited_doctor check failed (scan=%s doctor=%s): %s", scan_id, doctor_id, exc)
        return False


def can_view(scan, actor, db=None):
    """THE authorization decision for a scan image. See the module docstring.

    Deliberately cheap-first: the three in-memory clauses are evaluated before
    the one that costs a query, and the query only runs for an actor who is
    neither the patient, nor the reviewer, nor staff.
    """
    if scan is None or actor is None:
        return False

    if actor.can(Permission.SCAN_READ_ANY):
        return True
    if scan.user_id is not None and int(scan.user_id) == int(actor.id):
        return True
    if scan.doctor_id is not None and int(scan.doctor_id) == int(actor.id):
        return True

    if db is None:
        from app.core.db import SessionLocal

        session = SessionLocal()
        try:
            return is_invited_doctor(session, scan.id, actor.id)
        finally:
            session.close()
    return is_invited_doctor(db, scan.id, actor.id)


def is_owner(scan, actor):
    return bool(
        scan is not None
        and actor is not None
        and scan.user_id is not None
        and int(scan.user_id) == int(actor.id)
    )


# ======================================================================
# 2. VARIANT GENERATION (Pillow)
# ======================================================================
def _derived_name(stored_value, prefix):
    """`static/uploads/scan_ab12_mole.png` -> `static/uploads/thumb_scan_ab12_mole.jpg`."""
    base = os.path.basename(stored_value or "")
    if not base:
        return None
    stem, _ = os.path.splitext(base)
    return f"{storage_service.URL_PREFIX}/{prefix}{stem}.jpg"


def _open_normalised(path):
    """Open, apply the EXIF orientation, and flatten to RGB.

    exif_transpose matters: a phone photo carries "rotate 90" as metadata, and
    re-encoding without applying it produces a sideways thumbnail of a lesion.
    """
    from PIL import Image, ImageOps

    img = Image.open(path)
    img = ImageOps.exif_transpose(img) or img
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    return img


def make_thumbnail(source_path, target_path, max_px=None):
    """Downscaled copy, longest side <= max_px. Returns True on success."""
    max_px = max_px or _config("IMAGE_THUMB_MAX_PX", THUMB_MAX_PX)
    try:
        from PIL import Image

        with _open_normalised(source_path) as img:
            img.thumbnail((max_px, max_px), Image.LANCZOS)
            img.convert("RGB").save(target_path, "JPEG", quality=JPEG_QUALITY, optimize=True)
        return True
    except Exception as exc:
        logger.warning("Thumbnail generation failed for %s: %s", source_path, exc)
        return False


def make_blur(source_path, target_path, downscale_px=None, radius=None, output_px=None):
    """IRREVERSIBLY destroy the image, then make the wreckage look like a photo.

    Step 1 -- resize to 32px on the longest side. THIS is the privacy control:
             a 6-megapixel photograph is reduced to ~1000 samples, and no amount
             of processing brings back what was thrown away.
    Step 2 -- stretch back up to 400px so the <img> lays out like the real one.
    Step 3 -- GaussianBlur(24) to hide the blocky resample edges.

    Doing step 3 ALONE (a blur over the full-resolution image) would be
    reversible-ish by deconvolution and is exactly the mistake this avoids.
    """
    downscale_px = downscale_px or _config("IMAGE_BLUR_DOWNSCALE_PX", BLUR_DOWNSCALE_PX)
    radius = radius if radius is not None else _config("IMAGE_BLUR_RADIUS", BLUR_RADIUS)
    output_px = output_px or _config("IMAGE_BLUR_OUTPUT_PX", BLUR_OUTPUT_PX)

    try:
        from PIL import Image, ImageFilter

        with _open_normalised(source_path) as img:
            img = img.convert("RGB")
            width, height = img.size
            if width < 1 or height < 1:
                return False

            scale = float(downscale_px) / float(max(width, height))
            tiny = (max(1, int(round(width * scale))), max(1, int(round(height * scale))))
            destroyed = img.resize(tiny, Image.BILINEAR)

            up_scale = float(output_px) / float(max(tiny))
            stretched = destroyed.resize(
                (max(1, int(round(tiny[0] * up_scale))), max(1, int(round(tiny[1] * up_scale)))),
                Image.BICUBIC,
            )
            stretched.filter(ImageFilter.GaussianBlur(radius)).save(
                target_path, "JPEG", quality=JPEG_QUALITY, optimize=True
            )
        return True
    except Exception as exc:
        logger.warning("Blur generation failed for %s: %s", source_path, exc)
        return False


def generate_variants(stored_image_url, force=False):
    """Build both derived files for one stored image_url.

    Returns {'thumb_url': ..., 'blur_url': ...} with a None value for whichever
    could not be produced. NEVER raises: a broken JPEG must not take down the
    upload that carries it.
    """
    out = {"thumb_url": None, "blur_url": None}
    if not stored_image_url:
        return out

    source = storage_service.absolute_path(stored_image_url)
    if not source or not os.path.exists(source):
        logger.warning("Cannot build variants, source missing: %s", stored_image_url)
        return out

    folder = storage_service.upload_folder()
    os.makedirs(folder, exist_ok=True)

    thumb_url = _derived_name(stored_image_url, THUMB_PREFIX)
    blur_url = _derived_name(stored_image_url, BLUR_PREFIX)

    thumb_path = os.path.join(folder, os.path.basename(thumb_url))
    blur_path = os.path.join(folder, os.path.basename(blur_url))

    if force or not os.path.exists(thumb_path):
        if make_thumbnail(source, thumb_path):
            out["thumb_url"] = thumb_url
    else:
        out["thumb_url"] = thumb_url

    if force or not os.path.exists(blur_path):
        if make_blur(source, blur_path):
            out["blur_url"] = blur_url
    else:
        out["blur_url"] = blur_url

    return out


def ensure_variants(record, db=None, force=False):
    """Backfill thumb_url / blur_url on an AIScan or ScanAttachment in place.

    The 295 images that predate this phase have neither column set. Rather than
    make the read path depend on a migration script having been run, the first
    request that needs a variant builds it and persists the path. Returns True
    when the record was modified.
    """
    if record is None or not getattr(record, "image_url", None):
        return False
    if getattr(record, "image_deleted_at", None) is not None:
        return False
    if not force and record.thumb_url and record.blur_url:
        return False

    built = generate_variants(record.image_url, force=force)
    changed = False
    if built["thumb_url"] and record.thumb_url != built["thumb_url"]:
        record.thumb_url = built["thumb_url"]
        changed = True
    if built["blur_url"] and record.blur_url != built["blur_url"]:
        record.blur_url = built["blur_url"]
        changed = True

    if changed and db is not None:
        try:
            db.flush()
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("Could not persist variant paths for record %s: %s", record.id, exc)
    return changed


# ======================================================================
# 3. VARIANT SELECTION + RESOLUTION
# ======================================================================
def normalise_variant(raw):
    """'' / None -> None (meaning "server decides"). Unknown -> ValueError."""
    if raw is None:
        return None
    text = str(raw).strip().lower()
    if text == "":
        return None
    if text not in VARIANTS:
        raise ValueError(f"Invalid variant. Allowed: {', '.join(VARIANTS)}")
    return text


def effective_variant(record, actor, requested):
    """Which variant this actor actually gets.

    * Not sensitive              -> whatever was asked for, 'full' by default.
    * Sensitive, viewer is owner -> unchanged; it is their own photograph.
    * Sensitive, anyone else     -> 'blur' by default AND for a 'thumb' request
                                    (a 400px thumbnail of an intimate photo is
                                    still that photo). 'full' is honoured only
                                    when asked for EXPLICITLY, and is logged.
    """
    sensitive = bool(getattr(record, "is_sensitive", False))
    owner = is_owner(record, actor) if hasattr(record, "user_id") else False

    if not sensitive or owner:
        return requested or VARIANT_FULL
    if requested is None:
        return VARIANT_BLUR
    if requested == VARIANT_THUMB:
        return VARIANT_BLUR
    return requested


def variant_stored_url(record, variant):
    """The stored (no-leading-slash) path backing a variant, or None."""
    if variant == VARIANT_FULL:
        return record.image_url
    if variant == VARIANT_THUMB:
        return record.thumb_url
    if variant == VARIANT_BLUR:
        return record.blur_url
    return None


def resolve_file(record, variant, db=None):
    """(absolute_path, served_variant) for a variant request, or (None, variant).

    Falls back DOWNWARDS in privacy only:
      thumb missing -> full  (a thumbnail is a smaller copy of a photo the
                              viewer is already allowed to see)
      blur missing  -> NOTHING. A sensitive image never degrades into its
                       full-resolution self because a derived file is absent.
    """
    ensure_variants(record, db=db)

    stored = variant_stored_url(record, variant)
    path = storage_service.absolute_path(stored) if stored else None
    if path and os.path.exists(path):
        return path, variant

    if variant == VARIANT_BLUR:
        # Fail closed. See the docstring.
        return None, variant

    if variant == VARIANT_THUMB:
        full = storage_service.absolute_path(record.image_url) if record.image_url else None
        if full and os.path.exists(full):
            return full, VARIANT_FULL
        return None, variant

    return None, variant


# ======================================================================
# 4. ACCESS LOG
# ======================================================================
def _client_ip():
    try:
        from flask import request

        forwarded = request.headers.get("X-Forwarded-For")
        if forwarded:
            return forwarded.split(",")[0].strip()[:45]
        return (request.remote_addr or "")[:45] or None
    except Exception:  # pragma: no cover - outside a request
        return None


def log_access(db, scan_id, actor, variant, attachment_id=None):
    """Write one image_access_log row -- 'full' views only.

    Never raises: an audit write that can 500 the read it audits would train
    everyone to turn auditing off.
    """
    if variant not in LOGGED_VARIANTS:
        return None
    from app.models import ImageAccessLog

    try:
        row = ImageAccessLog(
            scan_id=int(scan_id),
            attachment_id=int(attachment_id) if attachment_id else None,
            viewer_id=int(actor.id) if actor else None,
            viewer_role=actor.role.value if actor else None,
            variant=variant,
            ip=_client_ip(),
            viewed_at=datetime.datetime.utcnow(),
        )
        db.add(row)
        db.flush()
        return row
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("image_access_log write failed (scan=%s): %s", scan_id, exc)
        return None


# ======================================================================
# 5. SERIALIZER FIELDS
# ======================================================================
def has_image(scan):
    return bool(getattr(scan, "image_url", None)) and getattr(scan, "image_deleted_at", None) is None


def privacy_fields(scan):
    """The four keys EVERY scan payload gained this phase.

    Emitted ALONGSIDE the endpoint's existing `image_url`, which keeps its exact
    current shape (three inconsistent shapes exist across the API -- raw,
    '/'-prefixed, and raw-inside-scan_info -- and the current frontend depends on
    each one, so none of them is being "fixed" here).

    `image_endpoint` is null once the pixels are gone so a client never renders
    an <img> that is guaranteed to 404. Matches app/services/admin_service.py.
    """
    present = has_image(scan)
    deleted_at = getattr(scan, "image_deleted_at", None)
    return {
        "is_sensitive": bool(getattr(scan, "is_sensitive", False)),
        "image_deleted_at": deleted_at.isoformat() if deleted_at else None,
        "has_image": present,
        "image_endpoint": SCAN_IMAGE_ENDPOINT.format(scan_id=scan.id) if present else None,
    }


def attachment_public(attachment):
    """One scan_attachments row as the API emits it."""
    present = has_image(attachment)
    deleted_at = getattr(attachment, "image_deleted_at", None)
    return {
        "id": attachment.id,
        "scan_id": attachment.scan_id,
        "is_sensitive": bool(attachment.is_sensitive),
        "image_deleted_at": deleted_at.isoformat() if deleted_at else None,
        "has_image": present,
        "image_endpoint": (
            ATTACHMENT_IMAGE_ENDPOINT.format(scan_id=attachment.scan_id, attachment_id=attachment.id)
            if present else None
        ),
        "created_at": attachment.created_at.isoformat() if attachment.created_at else None,
    }


# ======================================================================
# 6. FILE PURGE
# ======================================================================
def purge_files(record):
    """Unlink main + thumb + blur for one record. Returns how many vanished.

    Uses storage_service.absolute_path(), i.e. the configured (ABSOLUTE)
    UPLOAD_FOLDER. The monolith's `os.remove(scan.image_url)` was relative to
    the process CWD, so under any launcher that did not happen to start in
    FYP-backend it deleted nothing, reported success, and left the patient's
    photograph on disk forever.
    """
    removed = 0
    for stored in (record.image_url, record.thumb_url, record.blur_url):
        if not stored:
            continue
        path = storage_service.absolute_path(stored)
        if not path:
            continue
        try:
            if os.path.exists(path):
                os.remove(path)
                removed += 1
        except OSError as exc:
            logger.warning("Could not purge %s: %s", path, exc)
    return removed


def blocking_appointments(db, scan_id):
    """Appointments that still need this photograph.

    Deleting the image out from under a booked consultation turns a doctor's
    upcoming appointment into a blank card, so the delete is refused (409) with
    the appointment listed rather than silently allowed.
    """
    from app.models import Appointment

    return (
        db.query(Appointment)
        .filter(
            Appointment.scan_id == int(scan_id),
            Appointment.status.in_(ACTIVE_APPOINTMENT_STATUSES),
        )
        .all()
    )


def soft_delete_image(db, scan, actor, reason, purge=True):
    """Mark the pixels deleted, keep every clinical field, unlink the files.

    Returns {'purged_files': n, 'attachments': m}. The caller owns the consent
    row, the audit row and the transaction.
    """
    now = datetime.datetime.utcnow()
    removed = purge_files(scan) if purge else 0

    attachments = 0
    from app.models import ScanAttachment

    for att in db.query(ScanAttachment).filter(ScanAttachment.scan_id == scan.id).all():
        if att.image_deleted_at is None:
            if purge:
                removed += purge_files(att)
            att.image_deleted_at = now
            attachments += 1

    scan.image_deleted_at = now
    scan.image_deleted_by = int(actor.id) if actor else None
    scan.image_delete_reason = (reason or "")[:255] or None
    scan.image_delete_consent_at = now
    if purge:
        scan.image_purged_at = now

    return {"purged_files": removed, "attachments": attachments}


__all__ = [
    "SCAN_IMAGE_ENDPOINT",
    "ATTACHMENT_IMAGE_ENDPOINT",
    "VARIANT_FULL",
    "VARIANT_BLUR",
    "VARIANT_THUMB",
    "VARIANTS",
    "LOGGED_VARIANTS",
    "DELETE_CONFIRM_TEXT",
    "ACTIVE_APPOINTMENT_STATUSES",
    "CONSENT_IMAGE_DELETION",
    "ERR_IMAGE_FORBIDDEN",
    "ERR_IMAGE_DELETED",
    "ERR_IMAGE_MISSING",
    "ERR_PREVIEW_UNAVAILABLE",
    "invited_doctor_ids",
    "is_invited_doctor",
    "can_view",
    "is_owner",
    "make_thumbnail",
    "make_blur",
    "generate_variants",
    "ensure_variants",
    "normalise_variant",
    "effective_variant",
    "variant_stored_url",
    "resolve_file",
    "log_access",
    "has_image",
    "privacy_fields",
    "attachment_public",
    "purge_files",
    "blocking_appointments",
    "soft_delete_image",
]
