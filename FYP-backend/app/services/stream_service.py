"""
Server-Sent Events framing for the two dashboard streams.

BOTH STREAMS ARE DELIBERATELY UNAUTHENTICATED. `EventSource` cannot send an
Authorization header (comment at monolith lines 1417-1419), so
/api/doctor-updates-stream/<id> and /api/patient-updates-stream/<id> carry NO
decorator. Adding @require_permission or @token_required to either one kills
the doctor and patient dashboards instantly. If they ever need locking down,
the fix is a short-lived signed token in the query string, not a decorator.

Framing rules copied from the monolith:
  * poll every 5 seconds
  * emit `data: {json}\\n\\n` ONLY when the payload changed since last emit
  * otherwise emit `: heartbeat\\n\\n` to keep the connection warm
  * headers: Cache-Control: no-cache, X-Accel-Buffering: no, Connection: keep-alive

SESSION RULE: the generator must open AND close its own SessionLocal() INSIDE
the loop. It must not be bound to a request-scoped teardown -- the request
context is long gone by the time the generator runs, and a reused session would
serve a stale identity map forever, silently freezing the dashboard.
"""

import json
import logging
import time

logger = logging.getLogger(__name__)

SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
    "Connection": "keep-alive",
}

SSE_MIMETYPE = "text/event-stream"

POLL_SECONDS = 5
SCAN_LIMIT = 20

HEARTBEAT = ": heartbeat\n\n"


def format_event(payload):
    """`data: {json}\\n\\n` -- the exact framing the browser expects."""
    return f"data: {json.dumps(payload)}\n\n"


def changed(payload, last_serialized):
    """Return (should_emit, new_serialized). Comparison is on the SERIALISED
    form, matching the monolith, so key order changes count as a change."""
    serialized = json.dumps(payload)
    return serialized != last_serialized, serialized


def poll_loop(build_payload, poll_seconds=POLL_SECONDS):
    """Generic generator: call `build_payload()` every `poll_seconds`, emit only
    on change, heartbeat otherwise.

    `build_payload` is responsible for opening and closing its own DB session
    on every call.
    """
    last_serialized = None
    while True:
        try:
            payload = build_payload()
            should_emit, last_serialized_new = changed(payload, last_serialized)
            if should_emit:
                last_serialized = last_serialized_new
                yield format_event(payload)
            else:
                yield HEARTBEAT
        except GeneratorExit:
            raise
        except Exception as exc:
            logger.error("SSE stream error: %s", exc, exc_info=True)
            yield HEARTBEAT
        time.sleep(poll_seconds)


def sse_response(generator):
    """Wrap a generator in a Flask Response with the required headers."""
    from flask import Response

    return Response(generator, mimetype=SSE_MIMETYPE, headers=dict(SSE_HEADERS))


__all__ = [
    "SSE_HEADERS",
    "SSE_MIMETYPE",
    "POLL_SECONDS",
    "SCAN_LIMIT",
    "HEARTBEAT",
    "format_event",
    "changed",
    "poll_loop",
    "sse_response",
]
