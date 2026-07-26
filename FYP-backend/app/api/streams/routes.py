"""
Server-Sent Events for the live dashboards  --  PORTED

===========================================================================
ROUTES IN THIS BLUEPRINT (2 of the 39, + 1 additive security endpoint)
Reference implementation: legacy/app_monolith.py at the line ranges given.
Full request/response contract: docs/api-contract.md  (section 8, gotcha G4)
===========================================================================
  /api/doctor-updates-stream/<int:doctor_id>    GET   ticket-gated  doctor_updates_stream()   [monolith 1280-1411]
  /api/patient-updates-stream/<int:patient_id>  GET   ticket-gated  patient_updates_stream()  [monolith 1421-1587]
  /api/stream-ticket                            POST  @require_permission()  create_stream_ticket()   [NEW]

---------------------------------------------------------------------------
WHY /api/stream-ticket EXISTS  (the worst hole in the codebase)
---------------------------------------------------------------------------
Both streams carried NO decorator at all. `/api/patient-updates-stream/7`
returned patient 7's names, emails, diagnoses, severity levels and
questionnaire answers to anybody who incremented an integer. The monolith
comment at lines 1417-1419 justified it with "EventSource cannot send an
Authorization header", which is true -- and is an argument for a ticket in the
query string, not for no authentication at all.

The flow now is:
    POST /api/stream-ticket          (normal Bearer token, @require_permission)
      -> {"success":true,"data":{"ticket":"<jwt>","expires_in":60,"user_id":7}}
    new EventSource(`/api/patient-updates-stream/7?ticket=${ticket}`)

Ticket properties, all deliberate:
  * Signed with a DERIVED key (SECRET_KEY + "::sse-ticket-v1"), so a ticket can
    NEVER be replayed as an Authorization: Bearer access token -- it fails the
    signature check in app.core.rbac.decode_token. Query strings end up in
    proxy logs, browser history and Referer headers, so a leaked ticket must be
    worth as little as possible.
  * The role travels under the claim name "r", not "role", as a second,
    independent line of defence: even if the keys were ever unified,
    build_actor(claims['user_id'], claims['role']) would resolve None and
    require_permission would answer 401 'Invalid Token!'.
  * "typ": "sse" is asserted on the way in.
  * TTL 60 s (config STREAM_TICKET_TTL_SECONDS). The ticket only has to survive
    the EventSource handshake; the connection itself then lives for hours.
  * Bound to the requesting user id. Authorisation on the stream goes through
    the same resolve_actor() primitive every other route uses, so an Admin with
    SCAN_READ_ANY can still open a doctor's or a patient's stream for support.

*** TEMPORARY COMPROMISE -- HAS A REMOVAL DEADLINE ***
The React app still opens `new EventSource(url)` with no ticket
(DoctorDashboard.jsx:259, PatientHistory.jsx:535) and this phase is
backend-only, so rejecting those connections would break both dashboards --
the go/no-go gate of the whole refactor. Enforcement is therefore gated behind
config ALLOW_LEGACY_UNAUTH_SSE:

    True  (default in development/testing) -> serve, but log ONE loud
                                              deprecation WARNING per connection
    False (default in production)          -> 401/403 envelope

REMOVAL DEADLINE: the same release that teaches the frontend to call
POST /api/stream-ticket. At that point delete `_legacy_unauth_sse_allowed()`
and the two `if allowed:` branches below -- the authorisation code around them
is already final and needs no change. Until then, treat every WARNING line
tagged DEPRECATED-UNAUTH-SSE in the logs as an open data-leak event.

---------------------------------------------------------------------------
NON-NEGOTIABLES PRESERVED HERE
---------------------------------------------------------------------------
  * Both emitted payloads are BYTE-IDENTICAL to the monolith. DoctorDashboard.jsx
    and PatientHistory.jsx JSON.parse them directly.
      doctor  : {scans[13 keys], appointments[9 keys], pending_count,
                 completed_count, cancelled_count}
                Scheduled AND Confirmed BOTH increment pending_count.
      patient : {scans[17 keys], appointments[22 keys]} -- no counters, and the
                appointment shape includes live suggested_slots for Reassigned.
  * Framing: `data: {json}\n\n` only when the payload CHANGED, otherwise the
    comment line `: heartbeat\n\n` (EventSource never delivers comments to
    onmessage, which is exactly why it must stay a comment). Headers
    Cache-Control: no-cache, X-Accel-Buffering: no, Connection: keep-alive,
    mimetype text/event-stream -- all of it lives in app/services/stream_service.py.
  * The generator opens AND closes its own session INSIDE the polling loop. It
    must never be bound to the request lifecycle: by the time the generator
    runs, the request (and the app context) is long gone -- which is also why
    every config value it needs is read EAGERLY in the view, before the
    Response is returned.
  * image_url is "/"-prefixed in both streams (DoctorDashboard.jsx:1413
    concatenates it raw onto the API base and breaks without the slash).

---------------------------------------------------------------------------
AUTHORISATION MAPPING
---------------------------------------------------------------------------
  doctor stream  -> resolve_actor(doctor_id,  own=SCAN_REVIEW_ASSIGNED,
                                              any=SCAN_READ_ANY)
  patient stream -> resolve_actor(patient_id, own=SCAN_READ_OWN,
                                              any=SCAN_READ_ANY)
  Because the hierarchy is a real set union, a Doctor holds SCAN_READ_OWN and
  can open their OWN patient stream for their OWN scans -- the single-account
  goal of the refactor.
===========================================================================
"""

import datetime
import logging
import os

import jwt
from flask import Blueprint, current_app, request

from app import models
from app.core.db import session_scope
from app.core.rbac import (
    ERR_FORBIDDEN,
    ERR_TOKEN_EXPIRED,
    ERR_TOKEN_INVALID,
    ERR_TOKEN_MISSING,
    Permission,
    build_actor,
    current_actor,
    decode_token,
    get_token_data,
    require_permission,
    resolve_actor,
    session_is_current,
)
from app.core.responses import generate_response
from app.services import image_service
from app.services.conflict_service import sort_appointments_by_priority
from app.services.scheduling_service import find_next_available_slots
from app.services.serializers import image_url_slashed, iso, parse_json_field
from app.services.stream_service import (
    POLL_SECONDS,
    SCAN_LIMIT,
    poll_loop,
    sse_response,
)

logger = logging.getLogger(__name__)

streams_bp = Blueprint("streams", __name__)


# ==========================================================================
# STREAM TICKETS
# ==========================================================================
TICKET_TYPE = "sse"
TICKET_KEY_SUFFIX = "::sse-ticket-v1"
DEFAULT_TICKET_TTL_SECONDS = 60


def _ticket_secret():
    """Key derivation, NOT the raw SECRET_KEY -- see the module docstring."""
    return f"{current_app.config['SECRET_KEY']}{TICKET_KEY_SUFFIX}"


def _ticket_ttl():
    raw = current_app.config.get("STREAM_TICKET_TTL_SECONDS", DEFAULT_TICKET_TTL_SECONDS)
    try:
        return int(raw) or DEFAULT_TICKET_TTL_SECONDS
    except (TypeError, ValueError):
        return DEFAULT_TICKET_TTL_SECONDS


def issue_stream_ticket(actor, ttl_seconds=None):
    """Short-lived ticket bound to `actor.id`. Safe to put in a query string."""
    ttl = _ticket_ttl() if ttl_seconds is None else int(ttl_seconds)
    now = datetime.datetime.utcnow()
    payload = {
        "typ": TICKET_TYPE,
        "user_id": actor.id,
        # Claim name is "r", not "role", on purpose. See the module docstring.
        "r": actor.role.value,
        "iat": now,
        "exp": now + datetime.timedelta(seconds=ttl),
    }
    token = jwt.encode(
        payload,
        _ticket_secret(),
        algorithm=current_app.config.get("JWT_ALGORITHM", "HS256"),
    )
    return token.decode("utf-8") if isinstance(token, bytes) else token


def _actor_from_ticket(raw_ticket):
    """(actor, (error_string, status)) -- exactly one of the two is None."""
    try:
        claims = jwt.decode(
            raw_ticket,
            _ticket_secret(),
            algorithms=[current_app.config.get("JWT_ALGORITHM", "HS256")],
        )
    except jwt.ExpiredSignatureError:
        return None, (ERR_TOKEN_EXPIRED, 401)
    except jwt.InvalidTokenError:
        return None, (ERR_TOKEN_INVALID, 401)

    if claims.get("typ") != TICKET_TYPE:
        return None, (ERR_TOKEN_INVALID, 401)

    actor = build_actor(claims.get("user_id"), claims.get("r"))
    if actor is None:
        return None, (ERR_TOKEN_INVALID, 401)
    return actor, None


def _actor_from_bearer():
    """Fallback for non-EventSource clients (curl, fetch-based streaming, tests).
    EventSource cannot use this path -- that is the whole reason tickets exist."""
    token = get_token_data(request)
    if not token:
        return None, (ERR_TOKEN_MISSING, 401)
    try:
        claims = decode_token(token)
    except jwt.ExpiredSignatureError:
        return None, (ERR_TOKEN_EXPIRED, 401)
    except jwt.InvalidTokenError:
        return None, (ERR_TOKEN_INVALID, 401)

    actor = build_actor(claims.get("user_id"), claims.get("role"))
    if actor is None:
        return None, (ERR_TOKEN_INVALID, 401)

    # SAME REVOCATION GATE EVERY OTHER ROUTE RUNS (rbac.require_permission).
    # Without it an admin suspension or /auth/logout-all 401'd the whole REST
    # surface while these two streams -- the highest-PHI feed in the product --
    # kept pushing patient names, emails, diagnoses and questionnaire answers to
    # the revoked token for the rest of its 24h life.
    fresh, session_error = session_is_current(claims)
    if not fresh:
        return None, (session_error or ERR_TOKEN_INVALID, 401)
    return actor, None


def _legacy_unauth_sse_allowed():
    """The escape hatch -- NOW OFF BY DEFAULT IN EVERY ENVIRONMENT.

    It existed for one reason: the old dashboards opened `new EventSource(url)`
    with no ticket, and an EventSource cannot send an Authorization header, so
    enforcing tickets before those pages were replaced would have blanked out
    both dashboards. Meanwhile ANY anonymous caller could increment an integer
    and stream another user's patient names, emails, diagnoses and
    questionnaire answers.

    Those pages are gone -- no routed component opens a raw EventSource any
    more; RealtimeContext fetches a ticket from POST /api/stream-ticket first.
    So the default flips to CLOSED, and development now behaves like
    production, which is the only way a ticket bug gets caught before deploy
    rather than after.

    Still overridable (config first, then the env var) purely as a break-glass
    for someone bisecting a regression against an old frontend build. Setting
    it re-opens a PHI leak, so it logs loudly on every connection.
    """
    cfg = current_app.config
    if "ALLOW_LEGACY_UNAUTH_SSE" in cfg:
        return bool(cfg["ALLOW_LEGACY_UNAUTH_SSE"])
    raw = os.environ.get("ALLOW_LEGACY_UNAUTH_SSE")
    if raw is not None:
        return raw.strip().lower() in ("1", "true", "yes", "on")
    return False


def _authorise_stream(stream_name, target_user_id, own_perm, any_perm):
    """None => serve the stream. Otherwise a ready-to-return error response.

    Runs ONCE per connection, in the request context, before the generator is
    handed to the WSGI server.
    """
    raw_ticket = request.args.get("ticket")
    if raw_ticket:
        actor, failure = _actor_from_ticket(raw_ticket)
    else:
        actor, failure = _actor_from_bearer()

    if actor is not None and resolve_actor(target_user_id, own_perm, any_perm, actor=actor):
        logger.info(
            "SSE %s stream opened for user_id=%s by actor=%s (%s)",
            stream_name, target_user_id, actor.id, actor.role.value,
        )
        return None

    if actor is None:
        reason = failure[0] if failure else ERR_TOKEN_MISSING
    else:
        reason = f"actor {actor.id} ({actor.role.value}) may not read user {target_user_id}"

    if _legacy_unauth_sse_allowed():
        logger.warning(
            "DEPRECATED-UNAUTH-SSE: served %s stream for user_id=%s WITHOUT a valid ticket "
            "(reason=%r, ip=%s, ua=%r). This response leaks patient names, emails, diagnoses "
            "and questionnaire answers to anyone who guesses an integer. It is allowed only "
            "because ALLOW_LEGACY_UNAUTH_SSE is on for the frontend-compatibility window. "
            "REMOVAL DEADLINE: the release that makes the frontend call POST /api/stream-ticket.",
            stream_name,
            target_user_id,
            reason,
            request.headers.get("X-Forwarded-For", request.remote_addr),
            (request.headers.get("User-Agent") or "")[:120],
        )
        return None

    logger.warning(
        "SSE %s stream refused for user_id=%s: %s", stream_name, target_user_id, reason
    )
    if actor is None:
        error, status = failure or (ERR_TOKEN_MISSING, 401)
        return generate_response(False, error=error, status_code=status)
    return generate_response(False, error=ERR_FORBIDDEN, status_code=403)


@streams_bp.route('/api/stream-ticket', methods=['POST'])
@require_permission()
def create_stream_ticket():
    """Mint a short-lived ticket for the caller's own EventSource connections.

    ADDITIVE ROUTE -- not one of the 39. Nothing in the current frontend calls
    it yet; it exists so the frontend CAN stop streaming unauthenticated.
    """
    actor = current_actor()
    ttl = _ticket_ttl()
    return generate_response(
        True,
        data={
            "ticket": issue_stream_ticket(actor, ttl_seconds=ttl),
            "expires_in": ttl,
            "user_id": actor.id,
        },
        status_code=200,
    )


# ==========================================
# 6B. LIVE DASHBOARD UPDATES (SSE STREAM)
# ==========================================
def _doctor_payload(db, doctor_id, scan_limit):
    """Monolith lines 1287-1385, verbatim. Every key is a wire contract."""
    scans = db.query(models.AIScan).filter(
        models.AIScan.doctor_id == doctor_id
    ).order_by(models.AIScan.id.desc()).limit(scan_limit).all()  # Limit to prevent huge streams

    patient_ids = [s.user_id for s in scans]
    patients = {p.id: p for p in db.query(models.User).filter(models.User.id.in_(patient_ids)).all()}
    scan_ids = [s.id for s in scans]
    ratings_map = {r.scan_id: r for r in db.query(models.DoctorRating).filter(models.DoctorRating.scan_id.in_(scan_ids)).all()}

    scans_data = []
    for scan in scans:
        patient = patients.get(scan.user_id)
        rating_record = ratings_map.get(scan.id)

        questionnaire = parse_json_field(scan.patient_questionnaire, default=None)

        scans_data.append({
            "id": scan.id,
            "patient_name": patient.name if patient else "Unknown",
            "patient_email": patient.email if patient else None,
            "disease": scan.prediction_result,
            "confidence": scan.confidence,
            "status": scan.status,
            "doctor_comment": scan.doctor_comment,
            "invite_to_clinic": scan.invite_to_clinic,
            "questionnaire_answers": questionnaire,
            "image_url": image_url_slashed(scan.image_url),
            "created_at": iso(scan.created_at),
            "patient_rating": rating_record.rating if rating_record else None,
            "patient_review": rating_record.review if rating_record else None,
            # ADDITIVE (phase 3C): is_sensitive / image_deleted_at / has_image /
            # image_endpoint. `image_url` above keeps its exact '/'-prefixed
            # shape -- DoctorDashboard.jsx:1413 concatenates it unmodified.
            **image_service.privacy_fields(scan),
        })

    appointments = db.query(models.Appointment).filter(
        models.Appointment.doctor_id == doctor_id,
        # Doctor ne dashboard se "delete" kiya hua appointment SSE push
        # se dobara wapas nahi aana chahiye - patient side unaffected.
        models.Appointment.hidden_from_doctor == False
    ).order_by(models.Appointment.appointment_date.desc()).all()
    # NOTE: the 1-arg call (no severity map) is what the monolith used HERE,
    # unlike /api/doctor-appointments which passes one. Do not "unify" them.
    appointments = sort_appointments_by_priority(appointments)

    fee_setting = db.query(models.DoctorFees).filter_by(doctor_id=doctor_id).first()
    # Har appt apni saved duration use karti hai; doctor ki current live
    # fee-setting se recalculate nahi hota.
    default_duration_fallback = fee_setting.duration if fee_setting and fee_setting.duration else "30min"

    appt_patient_ids = [a.patient_id for a in appointments]
    appt_patients = {p.id: p for p in db.query(models.User).filter(models.User.id.in_(appt_patient_ids)).all()}

    appts_data = []
    pending_count = 0
    completed_count = 0
    cancelled_count = 0

    for appt in appointments:
        patient = appt_patients.get(appt.patient_id)
        disease_name = "Unknown"
        if appt.scan_id:
            scan = db.query(models.AIScan).filter(models.AIScan.id == appt.scan_id).first()
            if scan:
                disease_name = scan.prediction_result

        appts_data.append({
            "id": appt.id,
            "patient_name": patient.name if patient else "Unknown Patient",
            "patient_email": patient.email if patient else "No Email",
            "slot_date": appt.appointment_date,
            "slot_time": appt.appointment_time,
            "duration": appt.duration or default_duration_fallback,
            "disease": disease_name,
            "status": appt.status,
            "scan_id": appt.scan_id
        })
        # "Confirmed" counts as pending too -- a confirmed appointment has not
        # happened yet and must not vanish from the doctor's pending tile.
        if appt.status in ("Scheduled", "Confirmed"):
            pending_count += 1
        elif appt.status == "Completed":
            completed_count += 1
        elif appt.status == "Cancelled":
            cancelled_count += 1

    return {
        "scans": scans_data,
        "appointments": appts_data,
        "pending_count": pending_count,
        "completed_count": completed_count,
        "cancelled_count": cancelled_count
    }


@streams_bp.route('/api/doctor-updates-stream/<int:doctor_id>', methods=['GET'])
def doctor_updates_stream(doctor_id):
    denied = _authorise_stream(
        "doctor", doctor_id,
        Permission.SCAN_REVIEW_ASSIGNED, Permission.SCAN_READ_ANY,
    )
    if denied is not None:
        return denied

    # Read config EAGERLY: the generator below runs after the app context is
    # gone, so current_app is unavailable inside it.
    poll_seconds = current_app.config.get("STREAM_POLL_SECONDS", POLL_SECONDS)
    scan_limit = current_app.config.get("STREAM_SCAN_LIMIT", SCAN_LIMIT)

    def build_payload():
        # A FRESH session per tick, opened and closed inside the loop. A reused
        # session would keep serving a warm identity map and the dashboard
        # would silently freeze.
        with session_scope() as db:
            return _doctor_payload(db, doctor_id, scan_limit)

    return sse_response(poll_loop(build_payload, poll_seconds=poll_seconds))


# ==========================================
# 6C. LIVE PATIENT DASHBOARD UPDATES (SSE STREAM)
# Doctor stream jaisa hi pattern: har 5 sec DB poll karke, agar kuch
# badla ho tabhi push karta hai (warna sirf heartbeat).
# ==========================================
def _patient_payload(db, patient_id, scan_limit):
    """Monolith lines 1429-1561, verbatim. Every key is a wire contract."""
    # ---- Scans (patient/scans/<id> jaisa shape) ----
    scans = db.query(models.AIScan).filter(
        models.AIScan.user_id == patient_id
    ).order_by(models.AIScan.id.desc()).limit(scan_limit).all()

    doc_ids = [s.doctor_id for s in scans if s.doctor_id]
    doctors = {d.id: d for d in db.query(models.User).filter(models.User.id.in_(doc_ids)).all()}
    scan_ids = [s.id for s in scans]
    scan_ratings = {r.scan_id: r for r in db.query(models.DoctorRating).filter(
        models.DoctorRating.scan_id.in_(scan_ids),
        models.DoctorRating.patient_id == patient_id
    ).all()}

    scans_data = []
    for scan in scans:
        doc_name = scan.doctor_name or "N/A"
        doc_email = scan.doctor_email or ""
        if scan.doctor_id and scan.doctor_id in doctors:
            doc_name = doctors[scan.doctor_id].name
            doc_email = doctors[scan.doctor_id].email
        rating_record = scan_ratings.get(scan.id)

        scans_data.append({
            "id": scan.id,
            "scan_id": scan.id,
            "patient_id": scan.user_id,
            "disease": scan.prediction_result,
            "confidence": scan.confidence,
            "status": scan.status,
            "review_status": scan.review_status if hasattr(scan, 'review_status') else scan.status,
            "doctor_comment": scan.doctor_comment,
            "invite_to_clinic": scan.invite_to_clinic,
            "severity": scan.severity_level or "ROUTINE",
            "doctor_id": scan.doctor_id,
            "doctor_name": doc_name,
            "doctor_email": doc_email,
            "image_url": image_url_slashed(scan.image_url),
            "created_at": iso(scan.created_at),
            "patient_rating": rating_record.rating if rating_record else None,
            "patient_review": rating_record.review if rating_record else None,
            # ADDITIVE (phase 3C) -- see the doctor stream above.
            **image_service.privacy_fields(scan),
        })

    # ---- Appointments (api/patient-appointments/<id> jaisa shape) ----
    appointments = db.query(models.Appointment).filter(
        models.Appointment.patient_id == patient_id
    ).order_by(models.Appointment.id.desc()).all()

    appt_doctor_ids = [a.doctor_id for a in appointments]
    doctors_map = {d.id: d for d in db.query(models.User).filter(models.User.id.in_(appt_doctor_ids)).all()}
    profiles_map = {p.user_id: p for p in db.query(models.DoctorProfile).filter(models.DoctorProfile.user_id.in_(appt_doctor_ids)).all()}
    fees_map = {f.doctor_id: f for f in db.query(models.DoctorFees).filter(models.DoctorFees.doctor_id.in_(appt_doctor_ids)).all()}

    appt_scan_ids = [a.scan_id for a in appointments if a.scan_id]
    scans_map = {s.id: s for s in db.query(models.AIScan).filter(models.AIScan.id.in_(appt_scan_ids)).all()}

    appt_ids = [a.id for a in appointments]
    appt_ratings = db.query(models.DoctorRating).filter(
        models.DoctorRating.patient_id == patient_id,
        (models.DoctorRating.scan_id.in_(appt_scan_ids)) | (models.DoctorRating.appointment_id.in_(appt_ids))
    ).all()
    rating_by_scan = {r.scan_id: r for r in appt_ratings if r.scan_id}
    rating_by_appt = {r.appointment_id: r for r in appt_ratings if r.appointment_id}

    appts_data = []
    for appt in appointments:
        doctor_user = doctors_map.get(appt.doctor_id)
        doctor_profile = profiles_map.get(appt.doctor_id)

        disease_name = None
        scan_info = None
        scan = scans_map.get(appt.scan_id)
        if scan:
            disease_name = scan.prediction_result
            scan_info = {
                "id": scan.id,
                # RAW stored value here -- no leading slash, unlike the scan
                # list above. Both forms are load-bearing.
                "image_url": scan.image_url,
                "disease": scan.prediction_result,
                "confidence": scan.confidence,
                "doctor_comment": scan.doctor_comment,
                "invite_to_clinic": scan.invite_to_clinic,
                "severity": scan.severity_level or "ROUTINE",
                # ADDITIVE (phase 3C). `image_url` above stays RAW (no leading
                # slash) because that is what this nested shape has always sent.
                **image_service.privacy_fields(scan),
            }

        fee_setting = fees_map.get(appt.doctor_id)
        # appt ki apni saved duration use karo, doctor ki current live
        # fee-setting se recalculate mat karo.
        default_duration_fallback = fee_setting.duration if fee_setting and fee_setting.duration else "30min"
        fees_obj = {
            "pkr": fee_setting.pkr if fee_setting else 0.0,
            "usd": fee_setting.usd if fee_setting else 0.0
        }

        rating_record = rating_by_scan.get(appt.scan_id) or rating_by_appt.get(appt.id)

        # Reassigned patient ke liye suggested slots yahan bhi chahiye - warna
        # SSE push aane par ye field gayab ho jati aur bumped patient ko
        # suggestion dikhna band ho jata.
        suggested_slots = None
        if appt.status == "Reassigned":
            suggested_slots = find_next_available_slots(db, appt.doctor_id, appt.appointment_date, limit=3)

        appts_data.append({
            "id": appt.id,
            "doctor_id": appt.doctor_id,
            "doctor_name": doctor_user.name if doctor_user else "Expert",
            "doctor_profile": {
                "specialty": doctor_profile.specialty if doctor_profile else "",
                "profile_image": doctor_profile.profile_image if doctor_profile else None
            },
            "date": appt.appointment_date,
            "time": appt.appointment_time,
            "slot_date": appt.appointment_date,
            "slot_time": appt.appointment_time,
            "disease": disease_name,
            "duration": appt.duration or default_duration_fallback,
            "fees": fees_obj,
            "status": appt.status,
            "cancellation_reason": appt.cancellation_reason,
            "scan_id": appt.scan_id,
            "scan_info": scan_info,
            "rating": rating_record.rating if rating_record else None,
            "review": rating_record.review if rating_record else None,
            "patient_rating": rating_record.rating if rating_record else None,
            "patient_review": rating_record.review if rating_record else None,
            "is_conflict": appt.status == "Pending-Conflict",
            "conflict_with_id": appt.conflict_with_id,
            "suggested_slots": suggested_slots
        })

    return {
        "scans": scans_data,
        "appointments": appts_data
    }


@streams_bp.route('/api/patient-updates-stream/<int:patient_id>', methods=['GET'])
def patient_updates_stream(patient_id):
    denied = _authorise_stream(
        "patient", patient_id,
        Permission.SCAN_READ_OWN, Permission.SCAN_READ_ANY,
    )
    if denied is not None:
        return denied

    poll_seconds = current_app.config.get("STREAM_POLL_SECONDS", POLL_SECONDS)
    scan_limit = current_app.config.get("STREAM_SCAN_LIMIT", SCAN_LIMIT)

    def build_payload():
        with session_scope() as db:
            return _patient_payload(db, patient_id, scan_limit)

    return sse_response(poll_loop(build_payload, poll_seconds=poll_seconds))


__all__ = [
    "streams_bp",
    "issue_stream_ticket",
    "create_stream_ticket",
    "doctor_updates_stream",
    "patient_updates_stream",
]
