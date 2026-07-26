"""
Uploaded image serving  --  DEPRECATED, STILL LOAD-BEARING

===========================================================================
ROUTES IN THIS BLUEPRINT (1 of the 39)
Reference implementation: legacy/app_monolith.py at the line ranges given.
Full request/response contract: docs/api-contract.md  (section 10)
===========================================================================
  /static/uploads/<path:filename>  GET  @require_permission(optional=True)  serve_uploaded_file()  [monolith 224-229]

---------------------------------------------------------------------------
NON-NEGOTIABLES PRESERVED HERE
---------------------------------------------------------------------------
  * NOT JSON on success: raw file bytes via send_from_directory. ONLY the 400
    path uses the envelope -> {'success': False, 'error': 'Invalid filename'}.
  * Path traversal guard exactly as written: '..' anywhere in the filename, or
    a leading '/', is rejected. (send_from_directory's own safe_join is a
    second layer, not a replacement -- it 404s where this 400s.)
  * The files are served from config UPLOAD_FOLDER, which is now the ABSOLUTE
    path to FYP-backend/static/uploads. The monolith used the relative string
    'static/uploads', which only resolved when the process CWD happened to be
    the backend directory. Same 295 files, same bytes, one less footgun.
  * STILL SERVES EVERYTHING. `optional=True` means an anonymous request is not
    rejected -- it is authenticated when it can be, logged when it cannot, and
    served either way, because the React app builds raw <img src> URLs and
    <img> tags cannot send an Authorization header.

---------------------------------------------------------------------------
STATUS AFTER PHASE 3C  --  READ BEFORE CHANGING ANYTHING HERE
---------------------------------------------------------------------------
HALF of the hole is closed. The half that is closed:

  create_app() now builds the app with `static_folder=None`, so Flask's
  BUILT-IN `/static/<path:filename>` rule NO LONGER EXISTS. Before that change,
  three spellings verified against this very app returned full-resolution
  patient photographs from the built-in 'static' endpoint WITHOUT entering this
  view -- meaning the guard below, and any authentication ever added above it,
  were bypassable:

      GET /static/./uploads/<file>      -> endpoint 'static', 200
      GET /static/uPloads/<file>        -> endpoint 'static', 200  (Windows/macOS
                                           case-insensitive filesystem)
      GET /static/uploads%2F<file>      -> endpoint 'static', 200

  All three are now 404 (see tests/test_image_privacy.py, which asserts it, and
  the note in app/__init__.py, which explains it). This view is finally the ONLY
  way bytes leave static/uploads over HTTP.

The half that WAS not closed -- NOW CLOSED FOR PATIENT SCANS:

  Once the rebuilt pages landed, every scan photograph in the product started
  going through <SensitiveImage>, which fetches /api/scans/<id>/image with the
  session's Authorization header. No routed page renders a scan `image_url` in
  an <img src> any more, so criterion 1 below is satisfied FOR SCANS and this
  route now REFUSES them outright (404, deliberately not 403 -- a stranger
  probing for medical images learns nothing about whether the file exists).

  Doctor headshots (`doc_*`) are still served here. They are a different kind
  of data: professional photographs on a PUBLIC directory that logged-out
  visitors browse, not medical data about a patient. They have their own route
  now -- GET /api/doctors/<id>/photo -- and the payload carries
  `photo_endpoint`; this path stays only as the fallback for any client still
  reading the legacy `profile_image` value, and goes when that is gone.

  Files on disk when this landed: 287 `scan_*` (now refused), 9 `doc_*` (still
  served), plus `thumb_scan_*` / `blur_scan_*` variants (refused, same rule).

THE REPLACEMENT ALREADY EXISTS -- USE IT IN NEW CODE:

      GET /api/scans/<id>/image?variant=thumb|blur|full
      GET /api/scans/<id>/attachments/<att_id>/image?variant=...

  Authenticated, authorised by image_service.can_view(), blurred server-side
  for sensitive scans, and every full-resolution view is written to
  image_access_log. Each scan payload now carries `image_endpoint` pointing at
  it, alongside the legacy `image_url` this route serves.

REMOVAL CRITERIA (all three, then delete this file and its blueprint):
  1. No frontend page renders `image_url` in an <img src> any more.
  2. `DEPRECATED-UNAUTH-MEDIA` stops appearing in production logs.
  3. Profile images (`doc_*.jpg`, also under static/uploads) have their own
     authenticated route -- they are the OTHER consumer of this path.
===========================================================================
"""

import logging

from flask import Blueprint, current_app, send_from_directory

from app.core.rbac import current_actor, require_permission
from app.core.responses import generate_response

logger = logging.getLogger(__name__)

media_bp = Blueprint("media", __name__)


# ==========================================
# 0. STATIC IMAGE SERVING  (DEPRECATED)
# ==========================================
@media_bp.route('/static/uploads/<path:filename>')
@require_permission(optional=True)
def serve_uploaded_file(filename):
    # Prevent path traversal. Backslash and a drive-letter prefix are rejected
    # too: this app runs on Windows in development, where 'a\..\..\b' is a
    # traversal that '..' alone would catch but ntpath would resolve
    # differently, and safe_join's behaviour is not worth relying on twice.
    if '..' in filename or filename.startswith('/') or '\\' in filename or ':' in filename:
        return generate_response(False, error="Invalid filename", status_code=400)

    # ------------------------------------------------------------------
    # PATIENT SCANS ARE NO LONGER SERVED HERE.
    # ------------------------------------------------------------------
    # This route has no owner check and never did: anyone holding the URL got
    # the full-resolution photograph, and the URLs leak through browser
    # history, referrers and shared links. It stayed open only because the old
    # pages rendered image_url in an <img src> and an <img> cannot send a
    # bearer token. Those pages are gone; <SensitiveImage> now fetches
    # /api/scans/<id>/image, which checks image_service.can_view(), serves a
    # server-side blur for sensitive scans, and audit-logs full-resolution
    # views.
    #
    # Matching on the basename covers the variants too (thumb_scan_*,
    # blur_scan_*) without a second rule.
    basename = filename.rsplit('/', 1)[-1].lower()
    if 'scan_' in basename:
        logger.warning(
            "BLOCKED-LEGACY-SCAN-MEDIA: refused %r on the unauthenticated media route. "
            "Patient scans are served only by GET /api/scans/<id>/image. If this fired for a "
            "real user, a page is still rendering image_url instead of image_endpoint.",
            filename,
        )
        # 404, not 403: a prober must not learn whether the file exists.
        return generate_response(False, error="Not found", status_code=404)

    actor = current_actor()
    if actor is None:
        logger.info(
            "DEPRECATED-UNAUTH-MEDIA: served %r (non-scan) to an UNAUTHENTICATED caller. "
            "Doctor headshots are public by design; use GET /api/doctors/<id>/photo instead. "
            "REMOVAL DEADLINE: when no client reads the legacy profile_image value.",
            filename,
        )
    else:
        logger.info(
            "DEPRECATED-MEDIA: served %r (non-scan) to user_id=%s (%s).",
            filename, actor.id, actor.role.value,
        )

    response = send_from_directory(current_app.config['UPLOAD_FOLDER'], filename)
    # Machine-readable deprecation, so the migration can be tracked from the
    # network tab rather than by grepping server logs.
    response.headers["Deprecation"] = "true"
    response.headers["Link"] = '</api/scans/{id}/image>; rel="successor-version"'
    response.headers["Cache-Control"] = "private, max-age=300"
    return response


__all__ = ["media_bp", "serve_uploaded_file"]
