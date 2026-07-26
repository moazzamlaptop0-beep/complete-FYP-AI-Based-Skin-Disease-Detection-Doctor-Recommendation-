"""
AI prediction, reports and scan review

===========================================================================
ROUTES IN THIS BLUEPRINT (8 of the 39) -- PORTED
Reference implementation: legacy/app_monolith.py at the line ranges given.
Full request/response contract: docs/api-contract.md
===========================================================================
  /predict                                POST    predict()                 [monolith 600-669]
  /send_report                            POST    send_report()             [monolith 754-842]
  /api/scans/<int:scan_id>/report-status  GET     get_scan_report_status()  [monolith 857-876]
  /api/override-severity/<int:scan_id>    POST    override_severity()       [monolith 882-916]
  /doctor/update_scan/<int:scan_id>       PUT     update_scan()             [monolith 922-987]
  /doctor/delete_scan/<int:scan_id>       DELETE  delete_scan()             [monolith 993-1030]
  /patient/scans/<int:user_id>            GET     get_patient_history()     [monolith 1036-1094]
  /doctor/scans/<int:doctor_id>           GET     get_doctor_scans()        [monolith 1096-1175]

NEW, ADDITIVE -- IMAGE PRIVACY (phase 3C). Nothing above this line changes
shape except for four ADDED keys per scan (is_sensitive, image_deleted_at,
has_image, image_endpoint); no existing key is renamed, moved or removed.
===========================================================================
  /api/scans/<int:scan_id>/image                              GET     get_scan_image()
  /api/scans/<int:scan_id>/attachments                        GET     list_scan_attachments()
  /api/scans/<int:scan_id>/attachments/<int:att_id>/image     GET     get_attachment_image()
  /api/scans/<int:scan_id>/sensitivity                        PATCH   set_scan_sensitivity()
  /api/scans/<int:scan_id>/image                              DELETE  delete_scan_image()
  /api/scans/<int:scan_id>/access-log                         GET     get_scan_access_log()
  /api/admin/scans/<int:scan_id>                              DELETE  admin_hard_delete_scan()

  ALL authorization for image reads goes through the ONE predicate
  app.services.image_service.can_view(). Do not re-derive it anywhere else.
  `/api/admin/scans/<id>` lives in THIS blueprint rather than app/api/admin so
  that the scan-deletion logic (file purge + FK detach) has exactly one home;
  the admin blueprint's own `/admin/scans` listing is untouched.

GUARD MAPPING (old decorator -> permission)
------------------------------------------
  @patient_required -> SCAN_CREATE / SCAN_SEND_REPORT / SCAN_READ_OWN
  @doctor_required  -> SCAN_OVERRIDE_SEVERITY / SCAN_REVIEW_ASSIGNED /
                       SCAN_DELETE_ASSIGNED
Because ROLE_PERMISSIONS is built by set union, a Doctor and an Admin now also
hold every patient permission -- which is the entire point of the refactor: a
dermatologist can finally scan their own mole without a second account. The
`denied_message=` on each decorator reproduces the monolith's exact 403 string
("Access denied! Only Doctors allowed." etc.) for the actors that still fail.

---------------------------------------------------------------------------
NON-NEGOTIABLES FOR THIS BLUEPRINT
---------------------------------------------------------------------------
  * ENVELOPE BREAKER: /doctor/update_scan/<id> returns a FLAT dict (monolith:981)
     with scan fields at TOP LEVEL beside 'success', 'message' and an EMPTY
     'data': {}. KEEP the empty data -- DoctorDashboard.jsx:322 reads
     `responseData.scan || responseData.data` and {} is truthy in JS, so filling
     it in would override the optimistic UI update. Error paths in the SAME
     function DO use the envelope.
  * /predict image_url has NO leading slash; /patient/scans and /doctor/scans add one.
  * /predict writes the upload and runs the model BEFORE validating user_id --
     ordering preserved on purpose (docs/api-contract.md pins it).
  * /patient/scans and /doctor/scans both return 18 keys per item, id DESC.
  * /doctor/scans pagination applies ONLY when BOTH page and limit parse as int.
  * DO NOT ADD `GET /doctor/scan/<id>` (singular). DoctorDashboard.jsx:327 fetches
     it as a fallback and relies on it 404-ing so the optimistic update paints.
  * The confidence unit mismatch (0-100 in the DB, 0-1 in TriageService) and the
     dead DISEASE_TIER map are KNOWN BUGS, deliberately carried over unfixed --
     fixing them changes stored severity_level values and the persisted
     triage_reasons strings. Separate phase, separate verification.

---------------------------------------------------------------------------
DELIBERATE BEHAVIOUR CHANGES IN THIS FILE -- (b), (c) and (d)
---------------------------------------------------------------------------
(b) OWNERSHIP GAP CLOSED (monolith lines 937 and 1004). Both update_scan and
    delete_scan guarded with

        if scan.doctor_id and scan.doctor_id != current_doctor_id: 403

    -- a FALSY check, so every scan whose doctor_id IS NULL (i.e. every scan the
    patient has not yet sent to anyone) was reviewable AND hard-deletable by ANY
    authenticated doctor. Both now go through resolve_actor(), so an unassigned
    scan fails for an ordinary doctor and succeeds only for a holder of
    scan.review.any / scan.delete.any (Admin). The 403 strings are unchanged.
    This file's earlier "OWNERSHIP GAP TO PRESERVE" note is superseded.

(c) /doctor/scans/<doctor_id> now excludes AIScan.user_id == doctor_id. A doctor
    holds patient permissions now, so their own personal scans would otherwise
    turn up inside their own review queue.

(d) /predict returned 500 (or, before ai_scans.user_id became NOT NULL, silently
    stored an orphan row) when `user_id` was omitted from the form. It now
    returns a clean 400 at the same point in the flow.
===========================================================================
"""

import datetime
import json
import logging
import secrets
import os

from flask import Blueprint, current_app, jsonify, request, send_file

from app import models
from app.core.db import session_scope
from app.core.rbac import (
    ERR_ADMIN_ONLY,
    ERR_DOCTOR_ONLY,
    ERR_PATIENT_ONLY,
    Permission,
    current_actor,
    current_principal,
    require_permission,
    resolve_actor,
)
from app.core.responses import generate_response
from app.core.validation import as_bool
from app.services import image_service, ml_service
from app.services.email_service import send_email
from app.services.storage_service import allowed_file, save_upload
from app.services.triage_service import TriageService

logger = logging.getLogger(__name__)

scans_bp = Blueprint("scans", __name__)


def _confidence_percent(raw):
    """Normalise whatever the model returned into a 0-100 percentage."""
    try:
        value = float(raw)
        if value > 100:
            value = value / 100
        elif 0 < value <= 1.0:
            value = value * 100
        return round(max(0.0, min(100.0, value)), 2)
    except (ValueError, TypeError):
        return 0.0


# How long an unclaimed guest scan survives. Long enough to sign up and come
# back with an email confirmation; short enough that an ownerless skin
# photograph is not kept indefinitely.
GUEST_SCAN_TTL_HOURS = 48


def _new_guest_token():
    return secrets.token_urlsafe(32)[:64]


def _predict_as_guest(file, guest_token):
    """Run the model for a signed-out visitor and HOLD the result.

    The earlier version deliberately kept nothing, which meant signing up
    afterwards threw the scan away and told the user to photograph themselves
    again -- after they had already done the work. The row lives in `guest_scans`
    (never `ai_scans`, whose user_id is NOT NULL and whose rows every clinical
    query assumes are owned), keyed by an opaque per-browser token, and is
    claimed on sign-in.
    """
    token = guest_token or _new_guest_token()
    full_path, db_image_url = save_upload(file)

    try:
        result, raw_confidence = ml_service.predict_skin_disease(full_path)
    except Exception:
        # Never leave the upload behind if the model could not read it.
        try:
            os.remove(full_path)
        except OSError:
            pass
        raise

    confidence = _confidence_percent(raw_confidence)
    is_sensitive = as_bool(request.form.get('is_sensitive'), False)

    # Same server-side variants a signed-in scan gets, so a sensitive guest photo
    # is already blurred before anyone can ask for it.
    variants = image_service.generate_variants(db_image_url) or {}

    now = datetime.datetime.now(datetime.timezone.utc)
    with session_scope() as db:
        guest_scan = models.GuestScan(
            guest_token=token,
            image_url=db_image_url,
            thumb_url=variants.get("thumb_url"),
            blur_url=variants.get("blur_url"),
            prediction_result=result,
            confidence=confidence,
            is_sensitive=is_sensitive,
            created_at=now,
            expires_at=now + datetime.timedelta(hours=GUEST_SCAN_TTL_HOURS),
        )
        db.add(guest_scan)
        db.flush()
        guest_scan_id = guest_scan.id

    logger.info("Guest prediction stored as guest_scan %s", guest_scan_id)
    return generate_response(
        True,
        data={
            # Still null: there is no ai_scans row yet, and nothing downstream
            # should treat a guest scan as a clinical record.
            "scan_id": None,
            "guest": True,
            "guest_scan_id": guest_scan_id,
            "guest_token": token,
            "disease": result,
            "confidence": confidence,
            "image_url": None,
            "expires_in_hours": GUEST_SCAN_TTL_HOURS,
        },
        status_code=200,
    )


# ==========================================================================
# 1. AI PREDICTION & SCAN SAVING                       [monolith 600-669]
# ==========================================================================
@scans_bp.route('/predict', methods=['POST'])
@require_permission(Permission.SCAN_CREATE, optional=True, denied_message=ERR_PATIENT_ONLY)
def predict():
    """Classify a lesion photo. Works signed-in AND as a guest.

    GUEST MODE (no token): the model runs, the result comes back, and NOTHING is
    persisted -- no ai_scans row, and the uploaded file is deleted before the
    response. The product invites people to "try it without an account", so
    demanding a token here meant a visitor uploaded a photo and got
    "token not found"; and a guest scan cannot be stored anyway, because
    ai_scans.user_id is NOT NULL and an ownerless scan is one nobody could ever
    list, delete or consent for.

    The client keeps the photo in memory and re-POSTs it after signing in, which
    is when the row is created and the file is kept. That also means a guest's
    photograph never touches the disk for longer than the request.
    """
    if 'image' not in request.files:
        return generate_response(False, error="No image uploaded", status_code=400)

    file = request.files['image']
    if file.filename == '' or not allowed_file(file.filename):
        return generate_response(False, error="Invalid file type or no file selected", status_code=400)

    actor = current_actor()
    if actor is None:
        return _predict_as_guest(file, request.form.get("guest_token"))

    user_id_raw = request.form.get('user_id')

    # ORDERING IS CONTRACT: the file is written to disk and the model runs BEFORE
    # the user_id checks below, so a rejected request still leaves an upload on
    # disk. The monolith did exactly this; do not "fix" it here.
    # save_upload() = os.makedirs + secure_filename + scan_<uuid4hex>_ prefix,
    # and returns the NO-LEADING-SLASH db value ("static/uploads/<file>").
    full_path, db_image_url = save_upload(file)

    result, raw_confidence = ml_service.predict_skin_disease(full_path)

    try:
        conf_val = float(raw_confidence)
        if conf_val > 100:
            conf_val = conf_val / 100
        elif conf_val <= 1.0 and conf_val > 0:
            conf_val = conf_val * 100
        final_confidence = round(max(0.0, min(100.0, conf_val)), 2)
    except (ValueError, TypeError):
        final_confidence = 0.0

    with session_scope() as db:
        try:
            final_user_id = None
            if user_id_raw and str(user_id_raw).lower() not in ["null", "undefined", ""]:
                try:
                    final_user_id = int(user_id_raw)
                except ValueError:
                    return generate_response(False, error="Invalid user ID format", status_code=400)

            # BEHAVIOUR CHANGE (d): the monolith fell through with
            # final_user_id = None and inserted NULL into ai_scans.user_id, which
            # is NOT NULL -> IntegrityError -> opaque 500 "Internal server error".
            # A scan with no owner is meaningless anyway (nobody could ever list
            # it), so refuse it up front with a readable 400.
            if final_user_id is None:
                return generate_response(False, error="User ID is required", status_code=400)

            # Validate IDOR (User can only upload for themselves)
            if final_user_id and request.current_user.get('user_id') != final_user_id:
                return generate_response(False, error="Unauthorized user ID mismatch", status_code=403)

            # ADDITIVE (phase 3C): the stepper can mark a photo sensitive at
            # upload time, so an intimate-area image is never served in full to
            # a doctor even once. Absent field => False, i.e. today's behaviour.
            is_sensitive = as_bool(request.form.get('is_sensitive'), False)
            sensitivity_reason = (request.form.get('sensitivity_reason') or '').strip()[:50] or None

            new_scan = models.AIScan(
                image_url=db_image_url,
                prediction_result=result,
                confidence=final_confidence,
                user_id=final_user_id,
                status="Local",
                doctor_id=None,
                is_sensitive=is_sensitive,
                sensitivity_reason=sensitivity_reason if is_sensitive else None,
            )

            # Server-side variants, built ONCE at upload rather than on every
            # read. generate_variants() swallows its own errors, so a file
            # Pillow cannot decode still produces a saved scan -- the read path
            # just falls back (and refuses to fall back to 'full' for a
            # sensitive scan; see image_service.resolve_file).
            variants = image_service.generate_variants(db_image_url)
            new_scan.thumb_url = variants["thumb_url"]
            new_scan.blur_url = variants["blur_url"]

            db.add(new_scan)
            db.commit()
            db.refresh(new_scan)

            logger.info(f"New prediction generated for user {final_user_id}: {result}")
            payload = {
                "scan_id": new_scan.id,
                "disease": result,
                "confidence": final_confidence,
                "image_url": db_image_url
            }
            # image_url above keeps its exact legacy shape (NO leading slash).
            payload.update(image_service.privacy_fields(new_scan))
            return generate_response(True, data=payload, status_code=201)
        except Exception as e:
            db.rollback()
            logger.error(f"Predict Error: {e}", exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# 1b. CLAIMING A GUEST SCAN                                        [ADDITIVE]
# ==========================================================================
@scans_bp.route('/api/scans/claim', methods=['POST'])
@require_permission(Permission.SCAN_CREATE, denied_message=ERR_PATIENT_ONLY)
def claim_guest_scans():
    """Adopt the scans this browser took before signing in.

    Body: {"guest_token": "<token>"}

    Copies every unclaimed, unexpired `guest_scans` row for that token into
    `ai_scans` owned by the caller, REUSING the stored file and the verdict the
    guest was already shown. Nothing is re-uploaded and the model does not run
    again, so the diagnosis cannot change between what they saw and what they
    keep.

    Idempotent: a row that is already claimed returns its existing scan id
    rather than making a second copy, so a double-submit or a retried request is
    harmless.
    """
    data = request.get_json(silent=True) or {}
    token = (data.get('guest_token') or '').strip()
    if not token:
        return generate_response(False, error="guest_token is required", status_code=400)

    actor = current_actor()
    now = datetime.datetime.now(datetime.timezone.utc)
    claimed = []

    with session_scope() as db:
        rows = (
            db.query(models.GuestScan)
            .filter(models.GuestScan.guest_token == token)
            .order_by(models.GuestScan.id.asc())
            .all()
        )
        if not rows:
            return generate_response(
                False,
                error="That scan has expired or was already claimed. Please scan again.",
                status_code=404,
            )

        for row in rows:
            # Already adopted (a retry, or two tabs racing) -- hand back the id.
            if row.claimed_scan_id:
                claimed.append({"guest_scan_id": row.id, "scan_id": row.claimed_scan_id})
                continue

            if row.expires_at and row.expires_at < now.replace(tzinfo=None):
                continue

            scan = models.AIScan(
                image_url=row.image_url,
                thumb_url=row.thumb_url,
                blur_url=row.blur_url,
                prediction_result=row.prediction_result,
                confidence=row.confidence,
                user_id=actor.id,
                status="Local",
                doctor_id=None,
                is_sensitive=bool(row.is_sensitive),
                patient_questionnaire=row.patient_questionnaire,
                severity_level=row.severity_level or 'ROUTINE',
                triage_score=row.triage_score or 0,
                triage_reasons=row.triage_reasons,
            )
            db.add(scan)
            db.flush()

            row.claimed_at = now
            row.claimed_by = actor.id
            row.claimed_scan_id = scan.id

            claimed.append({"guest_scan_id": row.id, "scan_id": scan.id})

    if not claimed:
        return generate_response(
            False,
            error="That scan has expired. Please scan again.",
            status_code=410,
        )

    logger.info("User %s claimed %d guest scan(s)", actor.id, len(claimed))
    return generate_response(
        True,
        message=f"{len(claimed)} scan(s) added to your history.",
        data={
            "claimed": claimed,
            # The most recent one is what the stepper was working on.
            "scan_id": claimed[-1]["scan_id"],
        },
        status_code=200,
    )


# ==========================================================================
# 2. REPORT SENDING                                    [monolith 754-842]
# ==========================================================================
@scans_bp.route('/send_report', methods=['POST'])
@require_permission(Permission.SCAN_SEND_REPORT, denied_message=ERR_PATIENT_ONLY)
def send_report():
    data = request.get_json()
    if not data:
        return generate_response(False, error="Invalid JSON payload", status_code=400)

    scan_id = data.get('scan_id')
    doctor_id = data.get('doctor_id')
    answers = data.get('answers')

    if not scan_id or not doctor_id:
        return generate_response(False, error="Scan ID or Doctor ID missing", status_code=400)

    with session_scope() as db:
        try:
            scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
            if not scan:
                return generate_response(False, error="Scan not found", status_code=404)

            # Security: Patient can only send their own scans.
            # own-scope ONLY (any_perm=None): sending a report is an action taken
            # ON BEHALF of a patient, so no staff override exists for it -- an
            # admin who needs to do this uses X-Act-As-User-Id, which is audited.
            if not resolve_actor(scan.user_id, Permission.SCAN_SEND_REPORT, None):
                return generate_response(False, error="Unauthorized to send this report", status_code=403)

            doctor = db.query(models.User).filter(models.User.id == doctor_id, models.User.role == 'Doctor').first()
            if not doctor:
                return generate_response(False, error="Doctor not found", status_code=404)

            # LICENCE GATE. Assigning ai_scans.doctor_id is what unlocks
            # /doctor/update_scan, /api/override-severity and /doctor/delete_scan
            # for that account, so an unvetted (pending) or admin-REJECTED doctor
            # must not be assignable here -- /api/appointment-requests already
            # refuses them (matching.approved_doctor_ids).
            if current_app.config.get("ENFORCE_DOCTOR_VERIFICATION", False):
                profile = db.query(models.DoctorProfile).filter(
                    models.DoctorProfile.user_id == doctor.id
                ).first()
                if profile is None or profile.verification_status != 'approved':
                    return generate_response(
                        False,
                        error="That doctor is not available for booking (licence not approved).",
                        status_code=400,
                    )

            patient = db.query(models.User).filter(models.User.id == scan.user_id).first()
            patient_name = patient.name if patient else "Guest Patient"

            # Trust the DB, not the request body -- these were set at scan time,
            # so a patient's browser can't manipulate its own confidence/disease name.
            disease_name = scan.prediction_result or 'Skin Condition'
            # CONFIDENCE UNIT BUG -- FIXED. scan.confidence is stored 0-100;
            # evaluate_urgency's threshold and formatting are 0-1. Passing the
            # raw value here meant the low-confidence de-escalation guard could
            # never fire (87.34 is always >= 0.60) and the persisted
            # triage_reasons read "8734% confidence". triage_for_scan normalises
            # first, so a low-confidence melanoma call is now flagged for human
            # review instead of auto-escalating. Response keys are unchanged.
            triage_result = TriageService.triage_for_scan(scan, answers)

            scan.doctor_id = int(doctor_id)
            if answers:
                scan.patient_questionnaire = json.dumps(answers)

            scan.severity_level = triage_result['severity']
            scan.triage_score = triage_result['triage_score']
            scan.triage_reasons = json.dumps(triage_result['triage_reasons'])
            scan.status = "Pending"
            db.commit()

            expected_duration = "immediately (within 2-4 hours)" if triage_result['is_emergency'] else "within 24-48 hours"

            if triage_result['is_emergency']:
                subject = "URGENT: Critical AI Scan Report - Action Required"
                body = (
                    f"Dear Dr. {doctor.name},\n\n"
                    f"CRITICAL PATIENT ALERT\n\n"
                    f"A patient has forwarded an AI scan report that requires your IMMEDIATE attention.\n"
                    f"Detected Condition: {disease_name.upper()}\n"
                    f"Severity: {triage_result['severity']}\n"
                    f"Reasons: {'; '.join(triage_result['triage_reasons'])}\n"
                    f"Patient Name: {patient_name}\n\n"
                    f"Please log in to your clinic dashboard to review this case {expected_duration}.\n\n"
                    f"Regards,\nDerma AI Emergency System"
                )
            else:
                subject = f"New AI Diagnostic Report - Patient: {patient_name}"
                body = (
                    f"Dear Dr. {doctor.name},\n\n"
                    f"A new AI scan report has been assigned to you by patient '{patient_name}'.\n"
                    f"AI Prediction: {scan.prediction_result}\n\n"
                    f"Please log in to your dashboard to review this case {expected_duration}.\n\n"
                    f"Regards,\nDerma AI System"
                )

            send_email(doctor.email, subject, body)
            logger.info(f"Report {scan_id} sent to Doctor {doctor_id}")

            return generate_response(True, message="Report evaluated and sent.", data={
                "is_urgent": triage_result['is_emergency'],
                "severity_level": triage_result['severity'],
                "triage_score": triage_result['triage_score'],
                "triage_reasons": triage_result['triage_reasons'],
                "duration": expected_duration
            }, status_code=200)
        except Exception as e:
            db.rollback()
            logger.error(f"Send Report Error: {e}", exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# 3. SCAN REPORT STATUS                                [monolith 857-876]
# (source of truth for the frontend's "Report Already Sent" lock -- see
#  NearbyDoctors.jsx:304, which used to trust a stale localStorage flag)
# ==========================================================================
@scans_bp.route('/api/scans/<int:scan_id>/report-status', methods=['GET'])
@require_permission(Permission.SCAN_READ_OWN, denied_message=ERR_PATIENT_ONLY)
def get_scan_report_status(scan_id):
    with session_scope() as db:
        try:
            scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
            if not scan:
                return generate_response(False, error="Scan not found", status_code=404)

            if not resolve_actor(scan.user_id, Permission.SCAN_READ_OWN, Permission.SCAN_READ_ANY):
                return generate_response(False, error="Unauthorized access to this scan", status_code=403)

            return generate_response(True, data={
                "report_sent": scan.doctor_id is not None
            }, status_code=200)
        except Exception as e:
            logger.error(f"Get Scan Report Status Error: {e}", exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# 4. DOCTOR SEVERITY OVERRIDE (audited)                [monolith 882-916]
# ==========================================================================
@scans_bp.route('/api/override-severity/<int:scan_id>', methods=['POST'])
@require_permission(Permission.SCAN_OVERRIDE_SEVERITY, denied_message=ERR_DOCTOR_ONLY,
                    require_doctor_approved=True)
def override_severity(scan_id):
    data = request.get_json()
    if not data or not data.get('severity') or not data.get('reason'):
        return generate_response(False, error="Severity and reason are required", status_code=400)

    if data['severity'] not in ('ROUTINE', 'URGENT', 'CRITICAL'):
        return generate_response(False, error="Invalid severity value", status_code=400)

    with session_scope() as db:
        try:
            scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
            if not scan:
                return generate_response(False, error="Scan not found", status_code=404)

            # The monolith was already STRICT here (`scan.doctor_id != jwt.user_id`),
            # so a NULL doctor_id failed for everyone. resolve_actor() reproduces
            # that: int(None) is unparseable -> False for an ordinary doctor.
            if not resolve_actor(scan.doctor_id, Permission.SCAN_OVERRIDE_SEVERITY,
                                 Permission.SCAN_REVIEW_ANY):
                return generate_response(False, error="Unauthorized", status_code=403)

            scan.severity_level = data['severity']
            scan.overridden_by = request.current_user.get('user_id')
            scan.override_reason = data['reason']
            scan.overridden_at = datetime.datetime.utcnow()
            db.commit()

            logger.info(f"Scan {scan_id} severity overridden to {data['severity']} by doctor {scan.overridden_by}")
            return generate_response(True, message="Severity updated.", data={
                "severity_level": scan.severity_level,
                "override_reason": scan.override_reason
            }, status_code=200)
        except Exception as e:
            db.rollback()
            logger.error(f"Override Severity Error: {e}", exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# 5. DOCTOR UPDATE SCAN                                [monolith 922-987]
#    *** RETURNS A FLAT DICT ON SUCCESS -- ENVELOPE BROKEN ON PURPOSE ***
# ==========================================================================
@scans_bp.route('/doctor/update_scan/<int:scan_id>', methods=['PUT'])
@require_permission(Permission.SCAN_REVIEW_ASSIGNED, denied_message=ERR_DOCTOR_ONLY,
                    require_doctor_approved=True)
def update_scan(scan_id):
    data = request.get_json()
    if not data:
        return generate_response(False, error="Invalid JSON data", status_code=400)

    with session_scope() as db:
        try:
            scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
            if not scan:
                return generate_response(False, error="Scan not found", status_code=404)

            # Security: Doctor can only update scans assigned to them.
            # BEHAVIOUR CHANGE (b): monolith line 937 was
            #     if scan.doctor_id and scan.doctor_id != current_doctor_id
            # -- the leading truthiness test meant doctor_id IS NULL passed the
            # guard, so any doctor could review a scan that had never been sent
            # to them. resolve_actor() denies that; only a scan.review.any holder
            # can touch an unassigned scan.
            actor = current_actor()
            may_update = (
                resolve_actor(scan.doctor_id, Permission.SCAN_REVIEW_ASSIGNED,
                              Permission.SCAN_REVIEW_ANY, actor=actor)
                # resolve_actor() bails out on an unparseable target id (NULL
                # doctor_id) BEFORE it reaches the any-scope branch, so the staff
                # override has to be spelled out for that one case.
                or bool(actor and actor.can(Permission.SCAN_REVIEW_ANY))
            )
            if not may_update:
                return generate_response(False, error="Unauthorized to update this scan", status_code=403)

            current_doctor_id = request.current_user.get('user_id')

            scan.doctor_comment = (
                data.get("comment")
                or data.get("doctor_comment")
                or scan.doctor_comment
            )
            scan.status = "Reviewed"
            scan.review_status = "Reviewed"
            scan.invite_to_clinic = data.get('invite_to_clinic', scan.invite_to_clinic)

            # Update timestamps/status info mapping
            scan.updated_at = datetime.datetime.utcnow()

            db.commit()
            db.refresh(scan)

            patient = db.query(models.User).filter(models.User.id == scan.user_id).first()
            if patient and patient.email:
                subject = "Your Skin Report has been Reviewed"
                body = f"Hi {patient.name},\n\nYour doctor has reviewed your scan for '{scan.prediction_result}'.\n\nDoctor's Comment: {scan.doctor_comment}\n\nPlease login to the portal to see full details."
                send_email(patient.email, subject, body)
                scan.is_notified = True
                db.commit()

            scan_data = {
                "id": scan.id,
                "success": True,
                "message": "Scan updated successfully",
                "data": {},
                "created_at": scan.created_at.isoformat() if scan.created_at else None,
                "updated_at": scan.updated_at.isoformat() if scan.updated_at else None,
                "doctor_id": scan.doctor_id,
                "patient_id": scan.user_id,
                "scan_id": scan.id,
                "status": scan.status,
                "review_status": scan.review_status,
                "doctor_comment": scan.doctor_comment,
                "invite_to_clinic": scan.invite_to_clinic,
                "doctor_name": scan.doctor_name,
                "doctor_email": scan.doctor_email
            }
            logger.info(f"Scan {scan_id} updated by Doctor {current_doctor_id}")
            return jsonify(scan_data), 200  # Returning specific dict structure as per frontend requirements
        except Exception as e:
            db.rollback()
            logger.error(f"Update Scan Error: {e}", exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# 6. DOCTOR DELETE SCAN                                [monolith 993-1030]
# ==========================================================================
@scans_bp.route('/doctor/delete_scan/<int:scan_id>', methods=['DELETE'])
@require_permission(Permission.SCAN_DELETE_ASSIGNED, denied_message=ERR_DOCTOR_ONLY,
                    require_doctor_approved=True)
def delete_scan(scan_id):
    with session_scope() as db:
        try:
            current_doctor_id = request.current_user.get('user_id')

            scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
            if not scan:
                return generate_response(False, error="Scan not found", status_code=404)

            # BEHAVIOUR CHANGE (b): monolith line 1004 had the same falsy guard as
            # update_scan, so ANY doctor could HARD-DELETE a patient's unassigned
            # scan (row + image file, irreversibly). Now only the assigned doctor
            # or a scan.delete.any holder gets through.
            actor = current_actor()
            may_delete = (
                resolve_actor(scan.doctor_id, Permission.SCAN_DELETE_ASSIGNED,
                              Permission.SCAN_DELETE_ANY, actor=actor)
                or bool(actor and actor.can(Permission.SCAN_DELETE_ANY))
            )
            if not may_delete:
                return generate_response(False, error="Unauthorized to delete this scan", status_code=403)

            db.query(models.DoctorRating).filter(
                models.DoctorRating.scan_id == scan_id
            ).update({"scan_id": None})
            db.query(models.Appointment).filter(
                models.Appointment.scan_id == scan_id
            ).update({"scan_id": None})

            # image_service.purge_files() unlinks image_url AND the derived
            # thumb_/blur_ files, resolving each against the configured
            # (absolute) UPLOAD_FOLDER and swallowing OSError. delete_file() only
            # removed the original, so a 400px full-colour copy of the lesion
            # survived "Scan deleted from history" with the row that named it
            # gone -- unreachable by purge_files(), the retention sweep, or any
            # other code path, i.e. undeletable forever. Mirrors
            # admin_hard_delete_scan.
            image_service.purge_files(scan)
            for attachment in db.query(models.ScanAttachment).filter(
                models.ScanAttachment.scan_id == scan.id
            ).all():
                image_service.purge_files(attachment)

            db.delete(scan)
            db.commit()
            logger.info(f"Scan {scan_id} deleted by Doctor {current_doctor_id}")
            return generate_response(True, message="Scan deleted from history", status_code=200)
        except Exception as e:
            db.rollback()
            logger.error(f"Delete Scan Error: {e}", exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# 7. PATIENT HISTORY                                   [monolith 1036-1094]
# ==========================================================================
@scans_bp.route('/patient/scans/<int:user_id>', methods=['GET'])
@require_permission(Permission.SCAN_READ_OWN, denied_message=ERR_PATIENT_ONLY)
def get_patient_history(user_id):
    # Security: Patient can only view their own history
    if not resolve_actor(user_id, Permission.SCAN_READ_OWN, Permission.SCAN_READ_ANY):
        return generate_response(False, error="Unauthorized access to patient data", status_code=403)

    with session_scope() as db:
        try:
            scans = db.query(models.AIScan).filter(models.AIScan.user_id == user_id).order_by(models.AIScan.id.desc()).all()

            # Optimize N+1 Query Problem for doctors
            doc_ids = [s.doctor_id for s in scans if s.doctor_id]
            doctors = {d.id: d for d in db.query(models.User).filter(models.User.id.in_(doc_ids)).all()}

            # Optimize N+1 Query Problem for ratings
            scan_ids = [s.id for s in scans]
            ratings = {r.scan_id: r for r in db.query(models.DoctorRating).filter(
                models.DoctorRating.scan_id.in_(scan_ids),
                models.DoctorRating.patient_id == user_id
            ).all()}

            scan_list = []
            for scan in scans:
                doc_name = scan.doctor_name or "N/A"
                doc_email = scan.doctor_email or ""

                if scan.doctor_id and scan.doctor_id in doctors:
                    doc_name = doctors[scan.doctor_id].name
                    doc_email = doctors[scan.doctor_id].email

                rating_record = ratings.get(scan.id)

                item = {
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
                    "image_url": "/" + scan.image_url if scan.image_url else "",
                    "created_at": scan.created_at.isoformat() if scan.created_at else None,
                    "updated_at": scan.updated_at.isoformat() if hasattr(scan, 'updated_at') and scan.updated_at else None,
                    "patient_rating": rating_record.rating if rating_record else None,
                    "patient_review": rating_record.review if rating_record else None
                }
                # ADDITIVE: is_sensitive / image_deleted_at / has_image /
                # image_endpoint. `image_url` above is untouched -- it is still
                # the '/'-prefixed static path PatientHistory renders today.
                item.update(image_service.privacy_fields(scan))
                scan_list.append(item)
            return generate_response(True, data=scan_list, status_code=200)
        except Exception as e:
            logger.error(f"Get Patient History Error: {e}", exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# 8. DOCTOR REVIEW QUEUE                               [monolith 1096-1175]
# ==========================================================================
@scans_bp.route('/doctor/scans/<int:doctor_id>', methods=['GET'])
@require_permission(Permission.SCAN_REVIEW_ASSIGNED, denied_message=ERR_DOCTOR_ONLY)
def get_doctor_scans(doctor_id):
    # Security check
    if not resolve_actor(doctor_id, Permission.SCAN_REVIEW_ASSIGNED, Permission.SCAN_READ_ANY):
        return generate_response(False, error="Unauthorized to access these scans", status_code=403)

    with session_scope() as db:
        try:
            query = db.query(models.AIScan).filter(models.AIScan.doctor_id == doctor_id)

            # BEHAVIOUR CHANGE (c): a Doctor now also holds the patient
            # permissions, so they can run scans on their own account. Without
            # this filter a doctor's personal scan (user_id == doctor_id) would
            # appear in their own review queue as if it were a patient case.
            query = query.filter(models.AIScan.user_id != doctor_id)

            # Filtering & Search (TASK 16)
            search = request.args.get('search')
            status_filter = request.args.get('status')
            sort_by = request.args.get('sort', 'desc')

            if search:
                query = query.filter(models.AIScan.prediction_result.ilike(f"%{search}%"))
            if status_filter:
                query = query.filter(models.AIScan.status == status_filter)

            if sort_by == 'asc':
                query = query.order_by(models.AIScan.id.asc())
            else:
                query = query.order_by(models.AIScan.id.desc())

            # Pagination (TASK 16)
            page = request.args.get('page', type=int)
            limit = request.args.get('limit', type=int)

            if page and limit:
                scans = query.offset((page - 1) * limit).limit(limit).all()
            else:
                scans = query.all()

            # N+1 Optimization
            patient_ids = [s.user_id for s in scans if s.user_id]
            patients_map = {p.id: p for p in db.query(models.User).filter(models.User.id.in_(patient_ids)).all()}

            scan_ids = [s.id for s in scans]
            ratings_map = {r.scan_id: r for r in db.query(models.DoctorRating).filter(models.DoctorRating.scan_id.in_(scan_ids)).all()}

            scan_list = []
            for scan in scans:
                patient = patients_map.get(scan.user_id)
                rating_record = ratings_map.get(scan.id)

                questionnaire = None
                if scan.patient_questionnaire:
                    try:
                        questionnaire = json.loads(scan.patient_questionnaire)
                    except Exception:
                        pass

                item = {
                    "id": scan.id,
                    "scan_id": scan.id,
                    "doctor_id": scan.doctor_id,
                    "patient_id": scan.user_id,
                    "patient_name": patient.name if patient else "Unknown",
                    "patient_email": patient.email if patient else None,
                    "disease": scan.prediction_result,
                    "confidence": scan.confidence,
                    "status": scan.status,
                    "review_status": scan.review_status if hasattr(scan, 'review_status') else scan.status,
                    "doctor_comment": scan.doctor_comment,
                    "questionnaire_answers": questionnaire,
                    # ADDITIVE, and load-bearing: without it the doctor's whole
                    # triage surface (severity bands, the CRITICAL/URGENT filter,
                    # clinical-priority sort and the "Currently ..." line in the
                    # override dialog) silently fell back to ROUTINE for every
                    # row. Same key /patient/scans and /api/doctor-appointments
                    # already emit.
                    "severity": scan.severity_level or "ROUTINE",
                    "invite_to_clinic": scan.invite_to_clinic,
                    "image_url": "/" + scan.image_url if scan.image_url else "",
                    "created_at": scan.created_at.isoformat() if scan.created_at else None,
                    "updated_at": scan.updated_at.isoformat() if hasattr(scan, 'updated_at') and scan.updated_at else None,
                    "patient_rating": rating_record.rating if rating_record else None,
                    "patient_review": rating_record.review if rating_record else None
                }
                # ADDITIVE: the doctor's queue card needs to know it must render
                # the sensitive placeholder and read through image_endpoint
                # rather than <img src="/static/uploads/...">.
                item.update(image_service.privacy_fields(scan))
                scan_list.append(item)
            return generate_response(True, data=scan_list, status_code=200)
        except Exception as e:
            logger.error(f"Get Doctor Scans Error: {e}", exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ##########################################################################
#
#   IMAGE PRIVACY (phase 3C) -- everything below this line is ADDITIVE.
#
#   Read the module docstring of app/services/image_service.py first. In
#   particular: can_view() is the ONLY authorization predicate for a scan
#   image, and it deliberately includes doctors invited through an
#   appointment_request, not just ai_scans.doctor_id.
#
# ##########################################################################

def _image_response(path, variant, sensitive):
    """Send the bytes with headers that say what was served and forbid shared
    caching. `private, no-store` on 'full' keeps a patient's photograph out of
    every proxy between here and the browser; the derived variants are already
    privacy-safe, so they get a short private cache to stop a doctor's inbox
    re-fetching twenty thumbnails on every render."""
    response = send_file(path, conditional=True, max_age=0)
    if variant == image_service.VARIANT_FULL:
        response.headers["Cache-Control"] = "private, no-store, max-age=0"
    else:
        response.headers["Cache-Control"] = "private, max-age=300"
    response.headers["X-Image-Variant"] = variant
    response.headers["X-Image-Sensitive"] = "1" if sensitive else "0"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


# ==========================================================================
# 9. AUTHENTICATED SCAN IMAGE
# ==========================================================================
@scans_bp.route('/api/scans/<int:scan_id>/image', methods=['GET'])
@require_permission(Permission.SCAN_READ_OWN)
def get_scan_image(scan_id):
    """GET /api/scans/<id>/image?variant=thumb|blur|full

    403 vs 404 IS DELIBERATE
    ------------------------
      * 403 -- the scan exists and you are simply not allowed to see it. Hiding
        that behind a 404 buys nothing here: scan ids are sequential and the
        listing endpoints already tell every actor which ids exist.
      * 404 -- the pixels are gone (patient-deleted) or the file is missing.
        A client can then render "photo removed by the patient" instead of a
        broken image icon.
    """
    try:
        requested = image_service.normalise_variant(request.args.get('variant'))
    except ValueError as exc:
        return generate_response(False, error=str(exc), status_code=400)

    actor = current_actor()
    with session_scope() as db:
        scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
        if not scan:
            return generate_response(False, error="Scan not found", status_code=404)

        if not image_service.can_view(scan, actor, db=db):
            logger.warning(
                "Image access denied: user=%s role=%s scan=%s",
                actor.id, actor.role.value, scan_id,
            )
            return generate_response(False, error=image_service.ERR_IMAGE_FORBIDDEN, status_code=403)

        if scan.image_deleted_at is not None or not scan.image_url:
            return generate_response(False, error=image_service.ERR_IMAGE_DELETED, status_code=404)

        variant = image_service.effective_variant(scan, actor, requested)
        path, served = image_service.resolve_file(scan, variant, db=db)
        if not path:
            error = (
                image_service.ERR_PREVIEW_UNAVAILABLE
                if variant == image_service.VARIANT_BLUR
                else image_service.ERR_IMAGE_MISSING
            )
            return generate_response(False, error=error, status_code=404)

        # 'full' ONLY. See image_service.LOGGED_VARIANTS.
        image_service.log_access(db, scan.id, actor, served)

        return _image_response(path, served, bool(scan.is_sensitive))


# ==========================================================================
# 10. SCAN ATTACHMENTS (the stepper's extra angles)
# ==========================================================================
@scans_bp.route('/api/scans/<int:scan_id>/attachments', methods=['GET'])
@require_permission(Permission.SCAN_READ_OWN)
def list_scan_attachments(scan_id):
    """The ids a client needs before it can build an attachment image URL.
    Same predicate as the image itself -- if you may not see the photos, you may
    not enumerate them either."""
    actor = current_actor()
    with session_scope() as db:
        scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
        if not scan:
            return generate_response(False, error="Scan not found", status_code=404)
        if not image_service.can_view(scan, actor, db=db):
            return generate_response(False, error=image_service.ERR_IMAGE_FORBIDDEN, status_code=403)

        rows = (
            db.query(models.ScanAttachment)
            .filter(models.ScanAttachment.scan_id == scan_id)
            .order_by(models.ScanAttachment.id.asc())
            .all()
        )
        return generate_response(
            True,
            data=[image_service.attachment_public(row) for row in rows],
            status_code=200,
        )


@scans_bp.route('/api/scans/<int:scan_id>/attachments/<int:attachment_id>/image', methods=['GET'])
@require_permission(Permission.SCAN_READ_OWN)
def get_attachment_image(scan_id, attachment_id):
    """Identical contract to /api/scans/<id>/image, for the extra photos.

    Authorization is the PARENT SCAN's -- an attachment has no independent
    audience, and giving it one would be a second predicate to keep in sync.
    Sensitivity, however, is per-row: an attachment may be marked sensitive
    while the primary image is not (or the reverse), and whichever is set wins
    for that file.
    """
    try:
        requested = image_service.normalise_variant(request.args.get('variant'))
    except ValueError as exc:
        return generate_response(False, error=str(exc), status_code=400)

    actor = current_actor()
    with session_scope() as db:
        scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
        if not scan:
            return generate_response(False, error="Scan not found", status_code=404)

        if not image_service.can_view(scan, actor, db=db):
            return generate_response(False, error=image_service.ERR_IMAGE_FORBIDDEN, status_code=403)

        attachment = (
            db.query(models.ScanAttachment)
            .filter(
                models.ScanAttachment.id == attachment_id,
                models.ScanAttachment.scan_id == scan_id,
            )
            .first()
        )
        if not attachment:
            return generate_response(False, error="Attachment not found", status_code=404)
        if attachment.image_deleted_at is not None or not attachment.image_url:
            return generate_response(False, error=image_service.ERR_IMAGE_DELETED, status_code=404)

        # The attachment row has no user_id, so ownership for the sensitivity
        # rule comes from the parent scan.
        sensitive = bool(attachment.is_sensitive or scan.is_sensitive)
        owner = image_service.is_owner(scan, actor)
        if not sensitive or owner:
            variant = requested or image_service.VARIANT_FULL
        elif requested is None or requested == image_service.VARIANT_THUMB:
            variant = image_service.VARIANT_BLUR
        else:
            variant = requested

        path, served = image_service.resolve_file(attachment, variant, db=db)
        if not path:
            error = (
                image_service.ERR_PREVIEW_UNAVAILABLE
                if variant == image_service.VARIANT_BLUR
                else image_service.ERR_IMAGE_MISSING
            )
            return generate_response(False, error=error, status_code=404)

        image_service.log_access(db, scan.id, actor, served, attachment_id=attachment.id)

        return _image_response(path, served, sensitive)


# ==========================================================================
# 11. SENSITIVITY FLAG
# ==========================================================================
@scans_bp.route('/api/scans/<int:scan_id>/sensitivity', methods=['PATCH'])
@require_permission(Permission.SCAN_READ_OWN)
def set_scan_sensitivity(scan_id):
    """PATCH {is_sensitive: bool, reason?: str} -- owner or admin ONLY.

    A DOCTOR CANNOT UNSET THIS, and that is the point: the flag exists to
    protect the patient from the reviewer, so `SCAN_READ_ANY` (Admin-only) is
    the staff override rather than `SCAN_REVIEW_ASSIGNED`.

    Turning the flag ON builds the blur variant immediately -- otherwise the
    first doctor to open the case races the lazy generator and can be served the
    'full' fallback.
    """
    data = request.get_json(silent=True)
    if data is None or 'is_sensitive' not in data:
        return generate_response(False, error="is_sensitive is required", status_code=400)

    is_sensitive = as_bool(data.get('is_sensitive'), False)
    reason = (data.get('reason') or '').strip()[:50] or None

    with session_scope() as db:
        scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
        if not scan:
            return generate_response(False, error="Scan not found", status_code=404)

        if not resolve_actor(scan.user_id, Permission.SCAN_READ_OWN, Permission.SCAN_READ_ANY):
            return generate_response(False, error="Unauthorized access to this scan", status_code=403)

        scan.is_sensitive = is_sensitive
        scan.sensitivity_reason = reason if is_sensitive else None

        if is_sensitive and scan.image_deleted_at is None:
            image_service.ensure_variants(scan, db=db)

        db.flush()
        logger.info(
            "Scan %s sensitivity set to %s by user %s",
            scan_id, is_sensitive, (current_actor().id if current_actor() else None),
        )

        payload = {
            "scan_id": scan.id,
            "is_sensitive": bool(scan.is_sensitive),
            "sensitivity_reason": scan.sensitivity_reason,
            "default_variant": (
                image_service.VARIANT_BLUR if scan.is_sensitive else image_service.VARIANT_FULL
            ),
        }
        payload.update(image_service.privacy_fields(scan))
        return generate_response(True, message="Sensitivity updated.", data=payload, status_code=200)


# ==========================================================================
# 12. CONSENT-BASED IMAGE DELETION -- THE ROW SURVIVES
# ==========================================================================
@scans_bp.route('/api/scans/<int:scan_id>/image', methods=['DELETE'])
@require_permission(Permission.SCAN_READ_OWN)
def delete_scan_image(scan_id):
    """DELETE {reason, consent_ack: true, confirm_text: "DELETE"}

    WHAT SURVIVES (all of it, on purpose)
    -------------------------------------
    The ai_scans ROW and every clinical field -- prediction_result, confidence,
    severity_level, triage_score, triage_reasons, doctor_comment,
    patient_questionnaire -- plus every linked appointment and rating. A patient
    withdrawing a photograph must not silently erase the diagnosis a doctor
    wrote about it; that is destroying a medical record, not exercising a
    privacy right. Contrast /doctor/delete_scan, which really does drop the row
    and which this endpoint exists to replace for patients.

    WHAT GOES
    ---------
    The pixels: main + thumb + blur, and every attachment's three files, all
    unlinked through an ABSOLUTE path derived from config UPLOAD_FOLDER.

    WHAT IS WRITTEN
    ---------------
    user_consents(consent_type='image_deletion', target_ref='scan:<id>') as the
    evidence the patient asked, and audit_logs(action='scan.image_delete') as
    the evidence of who executed it (the two differ during an act-as session).
    """
    data = request.get_json(silent=True) or {}

    reason = (data.get('reason') or '').strip()
    confirm_text = str(data.get('confirm_text') or '').strip()

    if not reason:
        return generate_response(False, error="A reason is required to delete this photo.", status_code=400)
    if data.get('consent_ack') is not True:
        return generate_response(
            False,
            error="You must acknowledge that deleting the photo is permanent (consent_ack).",
            status_code=400,
        )
    if confirm_text.upper() != image_service.DELETE_CONFIRM_TEXT:
        return generate_response(
            False,
            error=f"Type {image_service.DELETE_CONFIRM_TEXT} to confirm.",
            status_code=400,
        )

    actor = current_actor()
    principal = current_principal()

    with session_scope() as db:
        scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
        if not scan:
            return generate_response(False, error="Scan not found", status_code=404)

        # Owner, or an admin holding scan.delete.any. A reviewing doctor is NOT
        # allowed to delete a patient's photograph.
        if not resolve_actor(scan.user_id, Permission.SCAN_READ_OWN, Permission.SCAN_DELETE_ANY):
            return generate_response(False, error="Unauthorized to delete this image", status_code=403)

        if scan.image_deleted_at is not None:
            return generate_response(
                False, error="This photo has already been deleted.", status_code=409
            )

        blocking = image_service.blocking_appointments(db, scan.id)
        if blocking:
            appointment = blocking[0]
            return generate_response(
                False,
                error=(
                    "This photo is attached to an active appointment on "
                    f"{appointment.appointment_date} at {appointment.appointment_time}. "
                    "Cancel or complete the appointment first, then delete the photo."
                ),
                data={"blocking_appointment_ids": [a.id for a in blocking]},
                status_code=409,
            )

        result = image_service.soft_delete_image(db, scan, actor, reason)

        # Evidence #1: the patient's consent, per object.
        db.add(models.UserConsent(
            user_id=scan.user_id,
            consent_type=image_service.CONSENT_IMAGE_DELETION,
            version=None,
            granted=True,
            granted_at=scan.image_delete_consent_at,
            revoked_at=None,
            ip=(request.headers.get("X-Forwarded-For") or request.remote_addr or "")[:45] or None,
            user_agent=(request.headers.get("User-Agent") or "")[:255] or None,
            source="image_delete",
            target_ref=f"scan:{scan.id}",
        ))

        # Evidence #2: who actually executed it. During an act-as session the
        # actor is the patient and the principal is the admin driving.
        db.add(models.AuditLog(
            actor_user_id=principal.id if principal else (actor.id if actor else None),
            subject_user_id=scan.user_id,
            action="scan.image_delete",
            target_type="scan",
            target_id=scan.id,
            detail=json.dumps({
                "reason": reason,
                "purged_files": result["purged_files"],
                "attachments_deleted": result["attachments"],
            }),
            ip=(request.headers.get("X-Forwarded-For") or request.remote_addr or "")[:45] or None,
            user_agent=(request.headers.get("User-Agent") or "")[:255] or None,
            created_at=datetime.datetime.utcnow(),
        ))

        db.flush()
        logger.info(
            "Scan %s image deleted by user %s (%s files purged, %s attachments)",
            scan_id, actor.id if actor else None, result["purged_files"], result["attachments"],
        )

        payload = {
            "scan_id": scan.id,
            "image_deleted_at": scan.image_deleted_at.isoformat(),
            "image_delete_reason": scan.image_delete_reason,
            "purged_files": result["purged_files"],
            "attachments_deleted": result["attachments"],
            "retained": [
                "prediction_result", "confidence", "severity_level", "triage_score",
                "triage_reasons", "doctor_comment", "patient_questionnaire",
                "appointments", "ratings",
            ],
        }
        payload.update(image_service.privacy_fields(scan))
        return generate_response(
            True,
            message="Photo deleted. Your medical history and doctor's notes have been kept.",
            data=payload,
            status_code=200,
        )


# ==========================================================================
# 13. WHO LOOKED AT MY PHOTO
# ==========================================================================
@scans_bp.route('/api/scans/<int:scan_id>/access-log', methods=['GET'])
@require_permission(Permission.SCAN_READ_OWN)
def get_scan_access_log(scan_id):
    """The image_access_log for one scan -- owner or admin.

    An audit trail nobody can read is a database table, not accountability. This
    is what lets a patient answer "who opened my photograph?" for themselves.
    """
    with session_scope() as db:
        scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
        if not scan:
            return generate_response(False, error="Scan not found", status_code=404)

        if not resolve_actor(scan.user_id, Permission.SCAN_READ_OWN, Permission.SCAN_READ_ANY):
            return generate_response(False, error="Unauthorized access to this scan", status_code=403)

        rows = (
            db.query(models.ImageAccessLog)
            .filter(models.ImageAccessLog.scan_id == scan_id)
            .order_by(models.ImageAccessLog.id.desc())
            .limit(200)
            .all()
        )
        viewer_ids = {row.viewer_id for row in rows if row.viewer_id}
        viewers = {}
        if viewer_ids:
            viewers = {
                user.id: user
                for user in db.query(models.User).filter(models.User.id.in_(viewer_ids)).all()
            }

        return generate_response(True, data=[{
            "id": row.id,
            "viewer_id": row.viewer_id,
            "viewer_name": viewers[row.viewer_id].name if row.viewer_id in viewers else None,
            "viewer_role": row.viewer_role,
            "variant": row.variant,
            "attachment_id": row.attachment_id,
            "ip": row.ip,
            "viewed_at": row.viewed_at.isoformat() if row.viewed_at else None,
        } for row in rows], status_code=200)


# ==========================================================================
# 14. ADMIN HARD DELETE
# ==========================================================================
@scans_bp.route('/api/admin/scans/<int:scan_id>', methods=['DELETE'])
@require_permission(Permission.SCAN_DELETE_ANY, denied_message=ERR_ADMIN_ONLY)
def admin_hard_delete_scan(scan_id):
    """The real delete: row AND files. Admins only, root-owned scans protected.

    Distinct from DELETE /api/scans/<id>/image (which keeps the record) and from
    /doctor/delete_scan (which is scoped to the assigned doctor and writes no
    audit row). Use this one for spam, test data and legal erasure requests.
    """
    actor = current_actor()
    principal = current_principal()

    # The admin dialog makes a free-text reason MANDATORY and tells the operator
    # it is "recorded before the row disappears" -- but the handler never read
    # the body, so the one field explaining why a medical record was destroyed
    # was dropped on the floor. Read it and put it in the audit detail.
    # Deliberately NOT turned into a 400: authorization here is server-side and
    # complete (SCAN_DELETE_ANY + root protection), confirm_text is only an
    # accidental-click guard the UI already enforces, and existing callers
    # (including the test suite) send no body at all.
    _body = request.get_json(silent=True) or {}
    delete_reason = (str(_body.get("reason") or "").strip() or None)
    if delete_reason:
        delete_reason = delete_reason[:500]

    with session_scope() as db:
        scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
        if not scan:
            return generate_response(False, error="Scan not found", status_code=404)

        owner = db.query(models.User).filter(models.User.id == scan.user_id).first()
        if owner is not None and getattr(owner, "is_root", False):
            return generate_response(
                False, error="Access denied! Root accounts are protected.", status_code=403
            )

        removed = image_service.purge_files(scan)
        for attachment in db.query(models.ScanAttachment).filter(
            models.ScanAttachment.scan_id == scan.id
        ).all():
            removed += image_service.purge_files(attachment)

        # Detach rather than cascade: a rating and an appointment are records of
        # events that really happened, and they outlive the image they cite.
        db.query(models.DoctorRating).filter(
            models.DoctorRating.scan_id == scan_id
        ).update({"scan_id": None}, synchronize_session=False)
        db.query(models.Appointment).filter(
            models.Appointment.scan_id == scan_id
        ).update({"scan_id": None}, synchronize_session=False)

        db.add(models.AuditLog(
            actor_user_id=principal.id if principal else (actor.id if actor else None),
            subject_user_id=scan.user_id,
            action="scan.hard_delete",
            target_type="scan",
            target_id=scan.id,
            detail=json.dumps({
                "prediction_result": scan.prediction_result,
                "purged_files": removed,
                "created_at": scan.created_at.isoformat() if scan.created_at else None,
                "reason": delete_reason,
            }),
            ip=(request.headers.get("X-Forwarded-For") or request.remote_addr or "")[:45] or None,
            user_agent=(request.headers.get("User-Agent") or "")[:255] or None,
            created_at=datetime.datetime.utcnow(),
        ))

        db.delete(scan)
        db.flush()
        logger.warning(
            "Scan %s HARD DELETED by admin %s (%s files purged)",
            scan_id, principal.id if principal else None, removed,
        )
        return generate_response(
            True,
            message="Scan permanently deleted.",
            data={"scan_id": scan_id, "purged_files": removed},
            status_code=200,
        )
