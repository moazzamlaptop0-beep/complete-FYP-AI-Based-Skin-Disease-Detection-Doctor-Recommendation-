"""
Skin-disease model wrapper with LAZY loading.

WHY THIS EXISTS
---------------
`app.py` line 4 was a bare `import test_model`, and test_model.py builds a
MobileNetV2 and loads a 25 MB .h5 at MODULE IMPORT time -- then does

    raise SystemExit("Model bina sahi weights ke use nahi ho sakta...")

if the weights are missing. That single line made the ENTIRE application
unimportable when the weights file was absent: no migrations, no CLI, no unit
tests, no `--help`. It also meant every import of anything paid a multi-second
TensorFlow startup.

Here the import is deferred until the first prediction. `SystemExit` derives
from BaseException, not Exception, so it is caught explicitly below --
otherwise it would sail straight through the route's `except Exception` and
kill the worker.

The prediction CONTRACT is unchanged: returns `(disease_name: str,
confidence: float)` where confidence is 0-100 with 2 decimals.
"""

import contextlib
import logging
import os
import sys
import threading

logger = logging.getLogger(__name__)


@contextlib.contextmanager
def _tolerant_stdio():
    """Survive test_model.py's emoji banner.

    test_model.py prints "--- 🩺 SKIN DISEASE AI TESTER ---" at import. On a
    Windows console running the cp1252 code page (or with stdout piped) that
    raises UnicodeEncodeError, the import dies, and the model silently never
    loads -- a genuine failure mode, not theoretical. Temporarily make the
    streams replace unencodable characters instead of raising, then restore.
    """
    changed = []
    for name in ("stdout", "stderr"):
        stream = getattr(sys, name, None)
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is None:
            continue
        try:
            previous = stream.errors
            if previous != "replace":
                reconfigure(errors="replace")
                changed.append((stream, previous))
        except (ValueError, OSError):  # pragma: no cover - detached streams
            continue
    try:
        yield
    finally:
        for stream, previous in changed:
            try:
                stream.reconfigure(errors=previous)
            except (ValueError, OSError):  # pragma: no cover
                pass

_lock = threading.Lock()
_module = None
_load_error = None

# Mirrors test_model.CLASS_NAMES; exposed without importing TensorFlow so
# /readyz and admin screens can list them cheaply.
CLASS_NAMES = [
    "1. Eczema",
    "10. Healthy Skin",
    "2. Melanoma",
    "3. Atopic Dermatitis",
    "4. Basal Cell Carcinoma (BCC)",
    "5. Melanocytic Nevi (NV)",
    "6. Benign Keratosis Lesion(BKL)",
    "7. Psoriasis pictures Lichen Planus and related diseases",
    "8. Seborrheic Keratoses and other Benign Tumors",
    "9. Tinea Ringworm Candidiasis and other Fungal Infections",
]


def weights_path():
    try:
        from flask import current_app

        if current_app:
            return current_app.config.get("MODEL_WEIGHTS_PATH")
    except Exception:
        pass
    base = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(base, "skindisease_best_model.weights.h5")


def weights_present():
    path = weights_path()
    return bool(path and os.path.exists(path))


def load_model(force=False):
    """Import test_model (which builds the network and loads the weights).

    Returns the module on success, None on failure. Never raises -- including
    for SystemExit.
    """
    global _module, _load_error

    if _module is not None and not force:
        return _module

    with _lock:
        if _module is not None and not force:
            return _module
        try:
            with _tolerant_stdio():
                import test_model  # noqa: PLC0415 - deliberately deferred

            _module = test_model
            _load_error = None
            logger.info("Skin disease model loaded.")
        except SystemExit as exc:
            # test_model.py raises SystemExit when the .h5 is missing/corrupt.
            _load_error = f"Model weights unavailable: {exc}"
            logger.error(_load_error)
            _module = None
        except Exception as exc:
            _load_error = f"Model load failed: {exc}"
            logger.error(_load_error, exc_info=True)
            _module = None
    return _module


def is_model_loaded():
    return _module is not None


def load_error():
    return _load_error


def predict_skin_disease(img_path, debug=False):
    """Drop-in replacement for `test_model.predict_skin_disease`.

    Same return contract: (disease_name, confidence_0_to_100).
    The two "Error: ..." strings below match the shapes test_model itself
    returns for its own failure modes, so callers need no new branches.
    """
    module = load_model()
    if module is None:
        logger.error("Prediction requested but model is not available: %s", _load_error)
        return "Error: Model unavailable", 0.0
    try:
        return module.predict_skin_disease(img_path, debug=debug)
    except Exception as exc:
        logger.error("Prediction Error: %s", exc, exc_info=True)
        return "Error: Prediction failed", 0.0


def warm_up():
    """Optional eager load, used when config EAGER_MODEL_LOAD is true."""
    return load_model() is not None


__all__ = [
    "CLASS_NAMES",
    "predict_skin_disease",
    "load_model",
    "is_model_loaded",
    "load_error",
    "weights_present",
    "weights_path",
    "warm_up",
]
