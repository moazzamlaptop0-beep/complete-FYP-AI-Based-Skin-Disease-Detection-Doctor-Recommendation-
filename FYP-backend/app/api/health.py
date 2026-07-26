"""
Liveness and readiness probes.

These are NEW endpoints, not part of the 39-route contract. They are additive
and on paths (/healthz, /readyz) that no existing client calls.

/healthz -- is the process up? Never touches the database, so a load balancer
            does not kill every worker when Postgres hiccups.
/readyz  -- should this instance receive traffic? Reports db_ok, model_loaded
            and triage_tiers_ok. Returns 503 when the database is unreachable.
            model_loaded being False is NOT fatal: the model loads lazily on
            the first /predict (see app/services/ml_service.py), so a cold
            instance is still ready to serve the other 38 routes.

TRIAGE TIER COVERAGE (triage_tiers_ok)
--------------------------------------
TriageService.DISEASE_TIER was once keyed on labels that matched NOTHING the
model returns, so every prediction silently fell through to ROUTINE and the
CRITICAL tier was unreachable -- a melanoma was triaged as routine and nothing
anywhere said so. The map is now keyed on the real class names, and this probe
asserts that EVERY entry of ml_service.CLASS_NAMES still resolves to an
explicit tier. If a dataset swap or a renumbering breaks that, the instance is
pulled out of rotation with a 503 and the unmapped labels are named in the body
-- loud failure instead of quiet mis-triage. Set TRIAGE_COVERAGE_FATAL=false to
downgrade it to a warning field without a code change.
"""

import datetime

from flask import Blueprint, current_app, jsonify

health_bp = Blueprint("health", __name__)


@health_bp.route("/healthz", methods=["GET"])
def healthz():
    return jsonify({
        "status": "ok",
        "env": current_app.config.get("ENV_NAME", "unknown"),
        "time": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }), 200


@health_bp.route("/readyz", methods=["GET"])
def readyz():
    from app.core.db import ping
    from app.services import ml_service
    from app.services.triage_service import TriageService

    db_ok = ping()
    model_loaded = ml_service.is_model_loaded()

    coverage = TriageService.tier_coverage()
    triage_fatal = current_app.config.get("TRIAGE_COVERAGE_FATAL", True)
    triage_blocks = triage_fatal and not coverage["ok"]

    ready = db_ok and not triage_blocks
    body = {
        "status": "ready" if ready else "degraded",
        "db_ok": db_ok,
        "model_loaded": model_loaded,
        "model_weights_present": ml_service.weights_present(),
        "model_error": ml_service.load_error(),
        # A False here means some model class has no explicit severity tier and
        # is therefore being triaged ROUTINE by default. See the module docstring.
        "triage_tiers_ok": coverage["ok"],
        "triage_tiers_covered": coverage["covered"],
        "triage_tiers_total": coverage["total"],
        "triage_tiers_missing": coverage["missing"],
        "env": current_app.config.get("ENV_NAME", "unknown"),
        "time": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    }
    return jsonify(body), (200 if ready else 503)


__all__ = ["health_bp"]
