"""
Public doctor directory + doctor self-profile

===========================================================================
ROUTES IN THIS BLUEPRINT (3 of the 39) -- PORTED
Reference implementation: legacy/app_monolith.py at the line ranges given.
Full request/response contract: docs/api-contract.md
===========================================================================
  /api/doctors/public  GET        public                    get_public_doctors()      [monolith 1181-1270]
  /api/doctors         GET        public                    get_doctors_alias()       [monolith 1272-1274]
  /api/doctor/profile  GET, POST  DOCTOR_PROFILE_MANAGE     manage_doctor_profile()   [monolith 3162-3285]

---------------------------------------------------------------------------
NON-NEGOTIABLES PRESERVED HERE
---------------------------------------------------------------------------
  * /api/doctors is literally `return get_public_doctors()` -- a DIRECT PYTHON
    CALL, not a redirect and not a duplicated body, so the two responses can
    never drift apart.
  * Doctors with no DoctorProfile row are SKIPPED entirely; profiles with
    verification_status == 'rejected' are skipped too. 'pending' doctors ARE
    listed (the frontend shows a "Pending Verification" badge).
  * specialty AND specialization carry the SAME value; rating AND
    average_rating carry the SAME value. All four keys stay.
  * fees.pkr / fees.usd fall back to NULL here (they fall back to 0.0 in
    /api/patient-appointments -- deliberately NOT unified).
  * schedule is None (not []) when the doctor has no availability rows.
  * profile_image in the directory is an UNCONDITIONAL "/" + stored value,
    exactly as the monolith wrote it. The profile GET uses the
    startswith('/')-aware variant. Both forms are kept as they were.
  * POST /api/doctor/profile reads request.form (multipart, NOT JSON) and
    applies each field only when truthy -- you cannot blank a field here.
    PATCH /api/profile is the route that CAN blank a field; this one keeps its
    exact legacy semantics so the existing doctor settings form is unaffected.
  * A CHANGED license resets verification_status to 'pending' and clears
    verification_note / verified_at / verified_by.

---------------------------------------------------------------------------
ONE DELIBERATE BEHAVIOUR CHANGE (July 2026) -- THE EMAIL BYPASS
---------------------------------------------------------------------------
POST /api/doctor/profile used to set `user.email` directly, with no proof that
anybody could read the new inbox. It now REFUSES a changed address with a 400
that names the replacement flow (/auth/email-change/request, which mails an OTP
to the NEW address). An UNCHANGED email in the form body is still accepted
silently, so the existing settings page keeps saving normally.

---------------------------------------------------------------------------
AUTHORISATION MAPPING
---------------------------------------------------------------------------
  @doctor_required  ->  @require_permission(Permission.DOCTOR_PROFILE_MANAGE,
                                            denied_message=ERR_DOCTOR_ONLY)
  The 401/403 strings are byte-identical to the monolith. Because the role
  hierarchy is a genuine set union, an Admin now also holds
  DOCTOR_PROFILE_MANAGE and can reach /api/doctor/profile (the monolith 403'd
  them). That is the intended consequence of the hierarchy, not an accident.
===========================================================================
"""

import logging
import os
from datetime import datetime

from flask import Blueprint, request, send_file
from werkzeug.utils import secure_filename

from app import models
from app.core.db import session_scope
from app.core.rbac import ERR_DOCTOR_ONLY, Permission, require_permission
from app.core.responses import generate_response
from app.services import storage_service
from app.services.serializers import profile_image_url

logger = logging.getLogger(__name__)

doctors_bp = Blueprint("doctors", __name__)


# ==========================================
# DOCTOR PROFILE PHOTO (dedicated route)
# ==========================================
@doctors_bp.route('/api/doctors/<int:doctor_id>/photo', methods=['GET'])
def get_doctor_photo(doctor_id):
    """Serve a doctor's profile photo by doctor id.

    WHY THIS EXISTS: doctor photos are written into the SAME static/uploads
    folder as patient scans, and /static/uploads/<file> is the only thing that
    has ever served them. That route has to be removed -- it hands out every
    patient's medical photograph to anyone who has the URL -- but removing it
    would also black out every doctor avatar in the directory. This gives the
    photos their own address so the raw folder can be closed independently.

    Deliberately UNAUTHENTICATED: the public doctor directory is public, the
    photo is a professional headshot the doctor chose to publish, and gating it
    would break the logged-out directory the scan stepper depends on. That is a
    different judgement from a scan image, which is medical data about a
    patient and is gated by image_service.can_view().

    404 (not 403) when there is no photo: absence is not a permission problem.
    """
    with session_scope() as db:
        profile = (
            db.query(models.DoctorProfile)
            .filter(models.DoctorProfile.user_id == doctor_id)
            .first()
        )
        stored = getattr(profile, 'profile_image', None) if profile else None
        if not stored:
            return generate_response(False, error="No profile photo", status_code=404)

        path = storage_service.absolute_path(stored)

    if not path or not os.path.isfile(path):
        # The DB row points somewhere the file no longer is. Log it -- this is
        # drift worth knowing about -- but the caller just gets a 404.
        logger.warning("Doctor %s profile_image missing on disk: %s", doctor_id, stored)
        return generate_response(False, error="No profile photo", status_code=404)

    return send_file(path, max_age=3600, conditional=True)


# ==========================================
# 6. STATS & DOCTORS LIST
# ==========================================
@doctors_bp.route('/api/doctors/public', methods=['GET'])
def get_public_doctors():
    try:
        with session_scope() as db:
            doctors = db.query(models.User).filter(models.User.role == 'Doctor').all()
            doc_ids = [d.id for d in doctors]

            # Optimize N+1 queries
            profiles = {p.user_id: p for p in db.query(models.DoctorProfile).filter(models.DoctorProfile.user_id.in_(doc_ids)).all()}
            fees_map = {f.doctor_id: f for f in db.query(models.DoctorFees).filter(models.DoctorFees.doctor_id.in_(doc_ids)).all()}

            # Fetch all ratings for these doctors
            all_ratings = db.query(models.DoctorRating).filter(
                models.DoctorRating.doctor_id.in_(doc_ids),
                models.DoctorRating.rating.isnot(None)
            ).all()

            ratings_dict = {did: [] for did in doc_ids}
            for r in all_ratings:
                ratings_dict[r.doctor_id].append(r)

            all_avail = db.query(models.DoctorAvailability).filter(models.DoctorAvailability.doctor_id.in_(doc_ids)).all()
            avail_dict = {did: [] for did in doc_ids}
            for a in all_avail:
                avail_dict[a.doctor_id].append(a)

            doctors_list = []
            for doc in doctors:
                profile = profiles.get(doc.id)
                if not profile:
                    continue

                # Rejected doctors ko patient-facing directory se hide rakhte hain
                # (admin ne already fake/invalid mark kiya hai) - pending doctors abhi bhi
                # dikhte hain, sirf "Pending Verification" badge ke saath.
                if getattr(profile, 'verification_status', 'pending') == 'rejected':
                    continue

                doc_ratings = ratings_dict.get(doc.id, [])
                # BUG FIX: pehle koi rating na hone par 5.0 (fake perfect score) return
                # hota tha - patient ko lagta "5 star rated" jabke doctor ko koi review
                # mila hi nahi. Ab None bhejte hain, frontend "New" badge dikhata hai.
                avg_rating = round(sum(r.rating for r in doc_ratings) / len(doc_ratings), 1) if doc_ratings else None

                fee_record = fees_map.get(doc.id)
                # BUG FIX: fee_record na hone par pehle 1500/10 (fake fees) return hota
                # tha - patient ko specific-lagne wali cost dikhti thi jo doctor ne kabhi
                # set hi nahi ki thi. Ab None - frontend "Fee not set" dikhayega.
                fees = {
                    "pkr": fee_record.pkr if fee_record else None,
                    "usd": fee_record.usd if fee_record else None,
                    "duration": fee_record.duration if fee_record and fee_record.duration else "30min",
                    "buffer_time": fee_record.buffer_time if fee_record and fee_record.buffer_time else 0
                }

                availabilities = avail_dict.get(doc.id, [])
                schedule = [{"day": a.day, "start": a.start_time, "end": a.end_time, "available": not a.is_off} for a in availabilities]

                doctors_list.append({
                    "id": doc.id,
                    "name": doc.name,
                    "email": doc.email,
                    "specialty": profile.specialty or "Skin Specialist",
                    "specialization": profile.specialty or "Skin Specialist",
                    # BUG FIX: pehle missing hospital/phone ki jagah specific-lagne wale
                    # fake fallbacks ("General Hospital", "N/A" jo tel: link mein reproduce
                    # ho sakta tha) return hote the. Ab honest None - frontend clearly
                    # "not available" dikhata hai aur CRITICAL patient ko fake number pe
                    # call try karne se bachata hai.
                    "hospital": profile.hospital or None,
                    "city": profile.city or "N/A",
                    "latitude": float(profile.latitude) if profile.latitude else None,
                    "longitude": float(profile.longitude) if profile.longitude else None,
                    "phone": profile.phone or None,
                    "rating": avg_rating,
                    "average_rating": avg_rating,
                    "total_reviews": len(doc_ratings),
                    "fees": fees,
                    "schedule": schedule if schedule else None,
                    "experience": getattr(profile, 'experience', 0),
                    "profile_image": "/" + profile.profile_image if getattr(profile, 'profile_image', None) else None,
                    # Additive: the stable address that survives removing
                    # /static/uploads. profile_image above keeps its exact
                    # current form so nothing that reads it today breaks.
                    "photo_endpoint": f"/api/doctors/{doc.id}/photo" if getattr(profile, 'profile_image', None) else None,
                    "verification_status": getattr(profile, 'verification_status', 'pending') or 'pending'
                })

            return generate_response(True, data=doctors_list, status_code=200)
    except Exception as e:
        logger.error(f"Public Doctors Fetch Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)


@doctors_bp.route('/api/doctors', methods=['GET'])
def get_doctors_alias():
    # Direct python call, NOT a redirect and NOT a second query -- the two
    # responses are physically incapable of diverging.
    return get_public_doctors()


# ==========================================
# DOCTOR PROFILE GET & UPDATE API
# ==========================================
@doctors_bp.route('/api/doctor/profile', methods=['GET', 'POST'])
@require_permission(Permission.DOCTOR_PROFILE_MANAGE, denied_message=ERR_DOCTOR_ONLY)
def manage_doctor_profile():
    try:
        with session_scope() as db:
            doctor_id = request.current_user.get('user_id')

            user = db.query(models.User).filter_by(id=doctor_id).first()
            profile = db.query(models.DoctorProfile).filter_by(user_id=doctor_id).first()
            fees = db.query(models.DoctorFees).filter_by(doctor_id=doctor_id).first()

            if request.method == 'GET':
                if not user:
                    return generate_response(False, error="User not found", status_code=404)

                img_path = profile_image_url(profile.profile_image if profile and profile.profile_image else None)

                data = {
                    "name": user.name,
                    "email": user.email,
                    "specialty": profile.specialty if profile and profile.specialty else '',
                    "hospital": profile.hospital if profile and profile.hospital else '',
                    "city": profile.city if profile and profile.city else '',
                    "phone": profile.phone if profile and profile.phone else '',
                    "experience": profile.experience if profile and profile.experience else 0,
                    "license": profile.license if profile and profile.license else '',
                    "profile_image": img_path,
                    "fees_pkr": fees.pkr if fees else 0,
                    "verification_status": profile.verification_status if profile else 'pending',
                    "verification_note": profile.verification_note if profile else None
                }
                return generate_response(True, data=data, status_code=200)

            if request.method == 'POST':
                name = request.form.get('name')
                email = request.form.get('email')
                specialty = request.form.get('specialty') or request.form.get('specialization')
                hospital = request.form.get('hospital')
                city = request.form.get('city')
                phone = request.form.get('phone')
                experience = request.form.get('experience')
                license_number = request.form.get('license')

                if user:
                    if name:
                        user.name = name

                    # ==================================================
                    # THE EMAIL BYPASS IS CLOSED HERE.
                    # ==================================================
                    # This route used to write `user.email` outright. A doctor
                    # (or an admin, who also holds DOCTOR_PROFILE_MANAGE) could
                    # therefore move an account onto any address they liked with
                    # NO proof they could read that inbox -- one multipart POST
                    # and the account's identity, its password-reset
                    # destination and every notification moved with it. Adding
                    # a duplicate check made the 500 into a 400; it did not make
                    # the change verified.
                    #
                    # The address now changes ONLY through
                    # /auth/email-change/request -> /auth/email-change/verify,
                    # which parks the candidate in users.pending_email and
                    # mails a code to the NEW address.
                    #
                    # An IDENTICAL value is accepted silently, because the
                    # existing doctor settings form posts every field it
                    # rendered including the unchanged email, and 400ing that
                    # would break saving a phone number.
                    if email and email.strip() and email.strip() != user.email:
                        # session_scope() commits on a normal return, so the
                        # partially-applied `user.name` must be discarded
                        # explicitly. The monolith got this for free from
                        # `finally: db.close()` (close rolls back).
                        db.rollback()
                        return generate_response(
                            False,
                            error=(
                                "Email cannot be changed here. Request a confirmation "
                                "code with /auth/email-change/request instead."
                            ),
                            status_code=400,
                        )

                if not profile:
                    profile = models.DoctorProfile(user_id=doctor_id)
                    db.add(profile)

                if specialty:
                    profile.specialty = specialty

                if hospital:
                    profile.hospital = hospital
                if city:
                    profile.city = city
                if phone:
                    profile.phone = phone

                # License add/update: agar naya license diya gaya hai aur wo current se
                # different hai, to verification_status wapis 'pending' pe daal dete hain -
                # kyunki naya license number admin ne abhi dekha hi nahi, purani approval
                # is naye number pe apply nahi hoti.
                if license_number and license_number.strip():
                    license_number = license_number.strip()
                    if license_number != (profile.license or ''):
                        try:
                            existing = db.query(models.DoctorProfile).filter(
                                models.DoctorProfile.license == license_number,
                                models.DoctorProfile.user_id != doctor_id
                            ).first()
                        except Exception:
                            existing = None
                        if existing:
                            # Same reason as the email branch above.
                            db.rollback()
                            return generate_response(False, error="This license number is already registered with another account.", status_code=400)
                        profile.license = license_number
                        profile.verification_status = 'pending'
                        profile.verification_note = None
                        profile.verified_at = None
                        profile.verified_by = None

                if experience and str(experience).strip():
                    try:
                        profile.experience = int(experience)
                    except ValueError:
                        pass

                if 'profile_image' in request.files:
                    file = request.files['profile_image']
                    if file and file.filename != '' and storage_service.allowed_file(file.filename):
                        upload_folder = storage_service.upload_folder()
                        os.makedirs(upload_folder, exist_ok=True)

                        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                        secure_name = secure_filename(file.filename)
                        filename = f"doc_{doctor_id}_{timestamp}_{secure_name}"
                        full_path = os.path.join(upload_folder, filename)
                        file.save(full_path)

                        profile.profile_image = f"{storage_service.URL_PREFIX}/{filename}"

                db.commit()
                logger.info(f"Doctor Profile Updated: {doctor_id}")
                return generate_response(True, message="Profile updated successfully!", status_code=200)

    except Exception as e:
        logger.error(f"Doctor Profile Update Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
