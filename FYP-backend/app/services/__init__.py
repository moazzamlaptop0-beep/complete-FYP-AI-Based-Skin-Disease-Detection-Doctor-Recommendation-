"""
Business logic, lifted out of the monolith with ZERO behaviour change.

Rule for this package during the port: code arrives here VERBATIM. Bugs come
with it (see triage_service.py's header for the two that are deliberately
preserved). Fixing anything is a separate, named phase with its own
verification, never a drive-by edit during a move.

Nothing here imports a blueprint or the Flask app. Services may use
`flask.current_app.config` for settings and must degrade to environment
variables when no app context exists, because the APScheduler job and the CLI
commands call into them from outside a request.

Submodules are NOT eagerly imported here: `ml_service` pulls in TensorFlow on
first use and `gemini_service` pulls in google.generativeai, and paying that
cost just to import `app.services` is what made the monolith slow to start.
"""

__all__ = [
    "email_service",
    "otp_service",
    "triage_service",
    "ml_service",
    "scheduling_service",
    "conflict_service",
    "storage_service",
    "gemini_service",
    "stream_service",
    "serializers",
]
