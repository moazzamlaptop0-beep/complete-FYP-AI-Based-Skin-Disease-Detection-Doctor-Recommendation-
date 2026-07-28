"""
Upload storage.

THE IMAGE_URL VARIANTS ARE LOAD-BEARING -- READ THIS BEFORE TOUCHING ANYTHING
---------------------------------------------------------------------------
The same stored value is served three different ways and the frontend depends
on all three:

  * /predict                       -> "static/uploads/x.jpg"   NO leading slash
  * /patient/scans, /doctor/scans,
    both SSE streams                -> "/static/uploads/x.jpg"  WITH slash
  * /api/patient-appointments
    scan_info.image_url             -> RAW stored value, no slash

DoctorDashboard.jsx:1413 concatenates `${API_BASE_URL}${image_url}` with no
normalisation and REQUIRES the leading slash; PatientHistory's
getSafeImageUrl() copes with either. Use `public_url()` / `slashed_url()`
below rather than hand-rolling the prefix at each call site.
"""

import logging
import os
import uuid

from werkzeug.utils import secure_filename

logger = logging.getLogger(__name__)

# Monolith line 40.
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}

# The literal prefix written into ai_scans.image_url. NEVER add a slash here.
URL_PREFIX = "static/uploads"

# Filename prefixes. `scan_` is the monolith's and is LOAD-BEARING in a place
# that is easy to miss: app/api/media/routes.py refuses any basename containing
# "scan_" outright, so anything that is NOT a patient photograph must not be
# named with it or it 404s on the only route that serves raw files.
SCAN_PREFIX = "scan_"
AVATAR_PREFIX = "avatar_"


def _config(key, default):
    try:
        from flask import current_app

        if current_app:
            return current_app.config.get(key, default)
    except Exception:
        pass
    return default


def allowed_file(filename):
    """Verbatim from monolith line 51."""
    extensions = _config("ALLOWED_EXTENSIONS", ALLOWED_EXTENSIONS)
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in extensions


def upload_folder():
    base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return _config("UPLOAD_FOLDER", os.path.join(base, "static", "uploads"))


def build_filename(original_name, prefix=SCAN_PREFIX):
    """`scan_<uuid4hex>_<secure_name>` -- exactly the monolith's shape (line 615).
    The uuid prefix is what stops two patients uploading `mole.jpg` from
    overwriting each other. `prefix` exists so non-scan uploads can opt out of
    the substring the media route blocks; the default is unchanged."""
    secure_name = secure_filename(original_name)
    return f"{prefix}{uuid.uuid4().hex}_{secure_name}"


def build_avatar_filename(user_id, extension="jpg"):
    """`avatar_u<id>_<uuid4hex>.jpg` -- the account avatar, NO user-supplied text.

    The caller's original filename is deliberately thrown away rather than run
    through secure_filename(). Someone who uploads `scan_me.png` would otherwise
    produce `avatar_<uuid>_scan_me.png`, and app/api/media/routes.py refuses any
    basename CONTAINING "scan_" -- so their avatar would 404 forever on the only
    route that serves the file. A generated name cannot collide with that rule.
    """
    clean_ext = str(extension or "jpg").lower().lstrip(".") or "jpg"
    return f"{AVATAR_PREFIX}u{int(user_id)}_{uuid.uuid4().hex}.{clean_ext}"


def save_upload(file_storage, prefix=SCAN_PREFIX):
    """Persist an uploaded file.

    Returns (absolute_path, db_image_url) where db_image_url is the
    NO-LEADING-SLASH form that goes into the database.
    """
    folder = upload_folder()
    os.makedirs(folder, exist_ok=True)
    unique_filename = build_filename(file_storage.filename, prefix=prefix)
    full_path = os.path.join(folder, unique_filename)
    file_storage.save(full_path)
    return full_path, f"{URL_PREFIX}/{unique_filename}"


def stored_url(filename):
    """A bare filename -> the NO-LEADING-SLASH stored form."""
    return f"{URL_PREFIX}/{filename}"


def file_size(file_storage):
    """Bytes in an uploaded stream, leaving the cursor back at the start.

    `request.content_length` counts the whole multipart envelope, so it cannot
    answer "is THIS part over 5 MB". Seeking the stream can.
    """
    stream = getattr(file_storage, "stream", None) or file_storage
    try:
        current = stream.tell()
        stream.seek(0, os.SEEK_END)
        size = stream.tell()
        stream.seek(current)
        return int(size)
    except (AttributeError, OSError, ValueError):  # pragma: no cover - defensive
        return -1


def extension_of(filename):
    """'photo.JPG' -> 'jpg'. '' when there is no extension."""
    name = str(filename or "")
    if "." not in name:
        return ""
    return name.rsplit(".", 1)[1].lower()


def public_url(stored_value):
    """The raw stored form: "static/uploads/x.jpg", no leading slash."""
    return stored_value or ""


def slashed_url(stored_value):
    """The "/"-prefixed form the scan listings and SSE streams emit."""
    if not stored_value:
        return ""
    return stored_value if stored_value.startswith("/") else "/" + stored_value


def absolute_path(stored_value):
    """Map a stored image_url back onto disk."""
    if not stored_value:
        return None
    name = os.path.basename(stored_value)
    return os.path.join(upload_folder(), name)


def delete_file(stored_value):
    """Best-effort unlink. Returns True when the file is gone afterwards.

    /doctor/delete_scan removes the image alongside the row; never let a
    filesystem error abort the database work.
    """
    path = absolute_path(stored_value)
    if not path:
        return False
    try:
        if os.path.exists(path):
            os.remove(path)
            return True
    except OSError as exc:
        logger.warning("Could not delete upload %s: %s", path, exc)
        return False
    return True


__all__ = [
    "ALLOWED_EXTENSIONS",
    "URL_PREFIX",
    "SCAN_PREFIX",
    "AVATAR_PREFIX",
    "allowed_file",
    "upload_folder",
    "build_filename",
    "build_avatar_filename",
    "save_upload",
    "stored_url",
    "file_size",
    "extension_of",
    "public_url",
    "slashed_url",
    "absolute_path",
    "delete_file",
]
