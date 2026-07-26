"""
Typed API errors + the JSON error handlers.

BEHAVIOUR CHANGE, DELIBERATE AND CONFIGURABLE
---------------------------------------------
The monolith registered ZERO `@app.errorhandler`s. A 404 (unknown route), 405
(wrong method), 413 (file over the 10 MB MAX_CONTENT_LENGTH) or an unhandled
500 therefore returned Werkzeug's HTML error page out of a JSON API. Handlers
here convert those into the standard `{success:false, error:...}` envelope.

This is safe for the existing React app: every call site gates on `res.ok`
before parsing (including DoctorDashboard.jsx:327, which probes the
non-existent `GET /doctor/scan/<id>` and checks `singleRes.ok`). If a
regression ever shows up, set `JSON_ERROR_RESPONSES=false` in the environment
and the HTML pages come straight back with no code change.

NOTE: these handlers do not touch responses that a view returns normally, so
the two envelope-breaking endpoints are unaffected.
"""

import logging

from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from werkzeug.exceptions import HTTPException

from app.core.responses import generate_response

logger = logging.getLogger(__name__)


class ApiError(Exception):
    """Base class for errors a view raises on purpose."""

    status_code = 400
    error = "Request failed"

    def __init__(self, error=None, status_code=None, data=None, message=""):
        super().__init__(error or self.error)
        if error is not None:
            self.error = error
        if status_code is not None:
            self.status_code = status_code
        self.data = data
        self.message = message

    def to_response(self):
        return generate_response(
            False,
            message=self.message,
            error=self.error,
            data=self.data,
            status_code=self.status_code,
        )


class BadRequestError(ApiError):
    status_code = 400
    error = "Invalid request"


class ValidationError(BadRequestError):
    error = "Validation failed"


class UnauthorizedError(ApiError):
    status_code = 401
    error = "Token is missing! Unauthorized access."


class ForbiddenError(ApiError):
    status_code = 403
    error = "Access denied!"


class NotFoundError(ApiError):
    status_code = 404
    error = "Not found"


class ConflictError(ApiError):
    status_code = 409
    error = "Conflict"


class RateLimitedError(ApiError):
    status_code = 429
    error = "Too many requests. Please slow down."


class ServiceUnavailableError(ApiError):
    status_code = 503
    error = "Service currently unavailable"


# Werkzeug's default descriptions are wordy and leak framework detail; these are
# the strings we actually want on the wire.
_HTTP_MESSAGES = {
    400: "Invalid request",
    401: "Token is missing! Unauthorized access.",
    403: "Access denied!",
    404: "Resource not found",
    405: "Method not allowed for this endpoint",
    413: "Uploaded file is too large (max 10 MB)",
    415: "Unsupported media type",
    429: "Too many requests. Please slow down.",
    500: "Internal server error",
    503: "Service currently unavailable",
}


def register_error_handlers(app):
    """Attach every JSON error handler. Called from create_app()."""

    @app.errorhandler(ApiError)
    def _handle_api_error(exc):
        if exc.status_code >= 500:
            logger.error("ApiError: %s", exc.error, exc_info=True)
        return exc.to_response()

    @app.errorhandler(HTTPException)
    def _handle_http_exception(exc):
        if not app.config.get("JSON_ERROR_RESPONSES", True):
            return exc  # let Werkzeug render its HTML page, as the monolith did
        code = exc.code or 500
        return generate_response(
            False,
            error=_HTTP_MESSAGES.get(code, exc.description or "Request failed"),
            status_code=code,
        )

    @app.errorhandler(IntegrityError)
    def _handle_integrity_error(exc):
        logger.warning("IntegrityError: %s", exc)
        return generate_response(
            False,
            error="Could not complete: this would violate a database constraint.",
            status_code=400,
        )

    @app.errorhandler(SQLAlchemyError)
    def _handle_sqlalchemy_error(exc):
        logger.error("SQLAlchemyError: %s", exc, exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)

    @app.errorhandler(Exception)
    def _handle_unexpected(exc):
        if isinstance(exc, HTTPException):  # pragma: no cover - Flask routes these first
            return _handle_http_exception(exc)
        logger.error("Unhandled exception: %s", exc, exc_info=True)
        if not app.config.get("JSON_ERROR_RESPONSES", True):
            raise exc
        return generate_response(False, error="Internal server error", status_code=500)

    return app


__all__ = [
    "ApiError",
    "BadRequestError",
    "ValidationError",
    "UnauthorizedError",
    "ForbiddenError",
    "NotFoundError",
    "ConflictError",
    "RateLimitedError",
    "ServiceUnavailableError",
    "register_error_handlers",
]
