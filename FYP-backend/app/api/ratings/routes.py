"""
Doctor ratings and reviews

===========================================================================
ROUTES IN THIS BLUEPRINT (3 of the 39) -- PORTED
Reference implementation: legacy/app_monolith.py at the line ranges given.
Full request/response contract: docs/api-contract.md
===========================================================================
  /api/rate-doctor                 POST  RATING_CREATE                    submit_doctor_rating()      [monolith 3018-3077]
  /api/doctor/ratings              GET   RATING_READ+DOCTOR_PROFILE_MANAGE get_live_doctor_reviews()   [monolith 3079-3118]
  /doctor/ratings/<int:doctor_id>  GET   public                           get_doctor_reviews_by_id()  [monolith 3120-3156]

---------------------------------------------------------------------------
NON-NEGOTIABLES PRESERVED HERE
---------------------------------------------------------------------------
  * The two GETs return the SAME review list under DIFFERENT wrapper keys:
      /api/doctor/ratings   -> {'average': round(x,1), 'total': int, 'reviews': [...]}
      /doctor/ratings/<id>  -> {'average_rating': round(x,1), 'rating_count': int, 'reviews': [...]}
    THEY ARE NOT UNIFIED. Both averages are 0.0 when there are no ratings.
  * /doctor/ratings/<id> stays fully PUBLIC with no ownership check.
  * /api/rate-doctor takes patient_id ALWAYS from the JWT, never from the body.
  * Upsert key is (patient, doctor, scan_id) when scan_id is given, else
    (patient, doctor, appointment_id); when NEITHER is given a new row is
    always inserted. Messages differ: 'Rating successfully submitted.' vs
    'Rating successfully updated.'
  * `rating` is float()-cast and range-checked 1-5, then written to an Integer
    column -- 4.5 truncates to 4. Preserved.
  * Each review item's `date` is strftime('%b %d, %Y'); patient_name falls back
    to 'Verified Patient'.

---------------------------------------------------------------------------
THE RELATIONSHIP HOLE -- NOW CLOSED (this phase)
---------------------------------------------------------------------------
  /api/rate-doctor used to perform NO relationship validation: it never checked
  that the scan_id / appointment_id belonged to the calling patient, nor that
  the patient had ever been treated by that doctor. Any authenticated user could
  rate any doctor, repeatedly, by omitting both ids (no upsert key => a fresh
  row every time), and those ratings feed the public /api/doctors/public
  average. A loop of {"doctor_id": 7, "rating": 1} tanked a competitor in
  seconds.

  A rating now requires a COMPLETED appointment or a REVIEWED scan linking this
  patient to this doctor -- see app/services/rating_service.py for the full
  rule. When the caller supplies neither id, the resolved record is ATTACHED to
  the row, which finally gives it an upsert key so the partial unique indexes
  already in the schema (uq_rating_appt, uq_rating_scan) turn a repeat into an
  UPDATE instead of another row. Their IntegrityError becomes a clean 409.

  DELIBERATELY UNCHANGED: the success responses. A legitimate rater still gets
  "Rating successfully submitted." / "Rating successfully updated." with 200.
  Only submissions that were never legitimate now fail.

---------------------------------------------------------------------------
AUTHORISATION MAPPING
---------------------------------------------------------------------------
  @patient_required -> @require_permission(Permission.RATING_CREATE,
                                           denied_message=ERR_PATIENT_ONLY)
      Doctors and Admins now hold RATING_CREATE through the hierarchy, so a
      doctor can rate a colleague from their own account. That is the point of
      the refactor.
  @doctor_required  -> @require_permission(Permission.RATING_READ,
                                           Permission.DOCTOR_PROFILE_MANAGE,
                                           denied_message=ERR_DOCTOR_ONLY)
      Both permissions are required (AND), and DOCTOR_PROFILE_MANAGE is the
      doctor-tier capability, so a plain patient still gets the monolith's
      exact 403 instead of an empty review list.
===========================================================================
"""

import logging

from flask import Blueprint, request
from sqlalchemy.exc import IntegrityError

from app import models
from app.core.db import session_scope
from app.core.rbac import (
    ERR_DOCTOR_ONLY,
    ERR_PATIENT_ONLY,
    Permission,
    require_permission,
)
from app.core.responses import generate_response
from app.services.rating_service import ERR_DUPLICATE, validate_rating_target
from app.services.serializers import review_date

# Names of the partial unique indexes that stop a concurrent double-submit.
RATING_UNIQUE_INDEXES = ("uq_rating_appt", "uq_rating_scan")

logger = logging.getLogger(__name__)

ratings_bp = Blueprint("ratings", __name__)


def _build_reviews(db, ratings):
    """The review list + running star total, shared by both GET routes.

    Extracted ONLY because the monolith had two byte-identical copies of it
    (3090-3106 and 3129-3145). The wrapper keys around it stay different.
    """
    patient_ids = [r.patient_id for r in ratings]
    patients_map = {p.id: p for p in db.query(models.User).filter(models.User.id.in_(patient_ids)).all()}

    reviews_list = []
    total_stars = 0
    for r in ratings:
        patient = patients_map.get(r.patient_id)
        patient_name = patient.name if patient else "Verified Patient"
        total_stars += r.rating
        reviews_list.append({
            "id": r.id,
            "patient_name": patient_name,
            "rating": r.rating,
            "review": r.review,
            "appointment_id": r.appointment_id,
            "scan_id": r.scan_id,
            "date": review_date(r.created_at)
        })

    avg_rating = (total_stars / len(ratings)) if len(ratings) > 0 else 0.0
    return reviews_list, avg_rating


# ==========================================
# 13. REAL RATING SYSTEM ENDPOINTS
# ==========================================
@ratings_bp.route('/api/rate-doctor', methods=['POST'])
@require_permission(Permission.RATING_CREATE, denied_message=ERR_PATIENT_ONLY)
def submit_doctor_rating():
    try:
        with session_scope() as db:
            data = request.get_json()
            if not data:
                return generate_response(False, error="Invalid JSON payload", status_code=400)

            patient_id = request.current_user.get('user_id')
            doctor_id = data.get('doctor_id')
            scan_id = data.get('scan_id')
            appointment_id = data.get('appointment_id')
            rating_val = data.get('rating')
            review_text = data.get('review', '')

            if not doctor_id or not rating_val:
                return generate_response(False, error="Doctor ID and rating are required.", status_code=400)

            try:
                rating_val = float(rating_val)
                if rating_val < 1 or rating_val > 5:
                    return generate_response(False, error="Rating must be between 1 and 5", status_code=400)
            except ValueError:
                return generate_response(False, error="Invalid rating value", status_code=400)

            # ---- RELATIONSHIP GATE (new) ---------------------------------
            # Returns the record the rating is anchored to. When the caller sent
            # neither id, that record is FOUND here and attached below -- which
            # is what gives the row an upsert key and kills the spam loop.
            ok, gate_error, gate_status, scan_id, appointment_id = validate_rating_target(
                db, patient_id, doctor_id, scan_id=scan_id, appointment_id=appointment_id
            )
            if not ok:
                logger.info(
                    "Rating refused: patient=%s doctor=%s reason=%s",
                    patient_id, doctor_id, gate_error,
                )
                return generate_response(False, error=gate_error, status_code=gate_status)

            existing_rating = None
            if scan_id:
                existing_rating = db.query(models.DoctorRating).filter_by(
                    patient_id=patient_id, doctor_id=doctor_id, scan_id=scan_id
                ).first()
            elif appointment_id:
                existing_rating = db.query(models.DoctorRating).filter_by(
                    patient_id=patient_id, doctor_id=doctor_id, appointment_id=appointment_id
                ).first()

            if existing_rating:
                existing_rating.rating = rating_val
                existing_rating.review = review_text
                msg = "Rating successfully updated."
            else:
                new_rating = models.DoctorRating(
                    doctor_id=doctor_id,
                    patient_id=patient_id,
                    scan_id=scan_id,
                    appointment_id=appointment_id,
                    rating=rating_val,
                    review=review_text
                )
                db.add(new_rating)
                msg = "Rating successfully submitted."

            db.commit()
            return generate_response(True, message=msg, status_code=200)
    except IntegrityError as e:
        # Two submits raced past the SELECT above. uq_rating_appt / uq_rating_scan
        # stopped the loser; that is a duplicate, not a server fault.
        blob = f"{getattr(e, 'orig', '')}{e}"
        if any(name in blob for name in RATING_UNIQUE_INDEXES):
            logger.info(f"Duplicate rating blocked by partial unique index: {e}")
            return generate_response(False, error=ERR_DUPLICATE, status_code=409)
        logger.error(f"Rate Doctor Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    except Exception as e:
        logger.error(f"Rate Doctor Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


@ratings_bp.route('/api/doctor/ratings', methods=['GET'])
@require_permission(
    Permission.RATING_READ,
    Permission.DOCTOR_PROFILE_MANAGE,
    denied_message=ERR_DOCTOR_ONLY,
)
def get_live_doctor_reviews():
    try:
        with session_scope() as db:
            doctor_id = request.current_user.get('user_id')
            ratings = db.query(models.DoctorRating).filter_by(doctor_id=doctor_id).order_by(models.DoctorRating.created_at.desc()).all()

            reviews_list, avg_rating = _build_reviews(db, ratings)

            data = {
                "average": round(avg_rating, 1),
                "total": len(ratings),
                "reviews": reviews_list
            }
            return generate_response(True, data=data, status_code=200)
    except Exception as e:
        logger.error(f"Doctor Ratings Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


@ratings_bp.route('/doctor/ratings/<int:doctor_id>', methods=['GET'])
def get_doctor_reviews_by_id(doctor_id):
    try:
        with session_scope() as db:
            ratings = db.query(models.DoctorRating).filter_by(doctor_id=doctor_id).order_by(models.DoctorRating.created_at.desc()).all()

            reviews_list, avg_rating = _build_reviews(db, ratings)

            return generate_response(True, data={
                "average_rating": round(avg_rating, 1),
                "rating_count": len(ratings),
                "reviews": reviews_list
            }, status_code=200)
    except Exception as e:
        logger.error(f"Fetch Doctor Ratings Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
