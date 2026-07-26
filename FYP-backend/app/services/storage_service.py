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


def build_filename(original_name):
    """`scan_<uuid4hex>_<secure_name>` -- exactly the monolith's shape (line 615).
    The uuid prefix is what stops two patients uploading `mole.jpg` from
    overwriting each other."""
    secure_name = secure_filename(original_name)
    return f"scan_{uuid.uuid4().hex}_{secure_name}"


def save_upload(file_storage):
    """Persist an uploaded file.

    Returns (absolute_path, db_image_url) where db_image_url is the
    NO-LEADING-SLASH form that goes into the database.
    """
    folder = upload_folder()
    os.makedirs(folder, exist_ok=True)
    unique_filename = build_filename(file_storage.filename)
    full_path = os.path.join(folder, unique_filename)
    file_storage.save(full_path)
    return full_path, f"{URL_PREFIX}/{unique_filename}"


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
    "allowed_file",
    "upload_folder",
    "build_filename",
    "save_upload",
    "public_url",
    "slashed_url",
    "absolute_path",
    "delete_file",
]
