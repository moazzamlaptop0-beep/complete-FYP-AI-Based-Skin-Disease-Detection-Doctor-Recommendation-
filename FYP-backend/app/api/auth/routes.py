"""
Authentication & account lifecycle

===========================================================================
PART A -- THE 6 LEGACY ROUTES (of the 39) -- PORTED, STILL PUBLIC CONTRACT
Reference implementation: legacy/app_monolith.py at the line ranges given.
Full request/response contract: docs/api-contract.md
===========================================================================
  /register          POST  none  register()        [monolith 263-356]
  /verify-otp-email  POST  none  verify_otp()      [monolith 358-394]
  /resend-otp        POST  none  resend_otp()      [monolith 398-453]
  /login             POST  none  login()           [monolith 455-506]
  /forgot-password   POST  none  forgot_password() [monolith 508-546]
  /reset-password    POST  none  reset_password()  [monolith 548-594]

===========================================================================
PART B -- THE NEW /auth SURFACE (additive; nothing above changes shape)
===========================================================================
  /auth/check-email       POST  none        which of three doors to open
  /auth/register          POST  none        signup + consents, one call
  /auth/login             POST  none        access + refresh + session
  /auth/verify-otp        POST  none        purpose-scoped
  /auth/resend-otp        POST  none        purpose-scoped
  /auth/forgot-password   POST  none        purpose-scoped, non-enumerating
  /auth/reset-password    POST  none        purpose-scoped
  /auth/me                GET   authed      THE canonical identity payload
  /auth/refresh           POST  none        rotate the refresh token
  /auth/logout            POST  optional    revoke THIS refresh token
  /auth/logout-all        POST  authed      bump users.token_version
  /auth/consent-documents GET   none        what the signup form must render
  /auth/consents          POST  authed      record acceptance / re-consent

===========================================================================
PART C -- SELF-SERVICE ACCOUNT (additive; see the section banner below)
===========================================================================
  /api/profile                 GET,PATCH         authed  read / partial edit
  /api/profile/avatar          GET,POST,DELETE   authed  the account picture
  /auth/change-password        POST              authed  keeps you signed in
  /auth/email-change/request   POST              authed  code to the NEW inbox
  /auth/email-change/verify    POST              authed  swap it in
  /auth/email-change/cancel    POST              authed  forget it

---------------------------------------------------------------------------
NON-NEGOTIABLES FOR THE LEGACY SIX
---------------------------------------------------------------------------
  * /login returns data.user.verification_status ONLY when role == 'Doctor'.
  * /login joined_at is strftime('%b %Y') with the LITERAL fallback 'Jan 2024'.
  * /register: role whitelist ('AI User','Doctor'); anything else is coerced to
    'AI User'. 'Admin' can never be created through this route.
  * /register: single atomic commit AFTER the OTP email succeeds; email failure
    => rollback + 500.
  * /reset-password has the side effect of setting is_verified=True.
  * /resend-otp 429 message: 'Please wait {n}s before requesting another OTP.'

---------------------------------------------------------------------------
THE ONE DELIBERATE BEHAVIOUR CHANGE FROM PHASE 1 -- (a)
---------------------------------------------------------------------------
monolith line 468 read:

    if user and password_ok and user.role == data.get('role'):

so a correct email+password pair was rejected with 401 "Invalid credentials"
whenever the role the user picked on the login form did not match the stored
role. That is what forced separate login entry points in the UI. The `role`
field is still ACCEPTED in the request body (the existing frontend keeps
sending it) but is now DELIBERATELY IGNORED -- the stored `user.role` is the
only authority and is what goes into the JWT. /auth/login does the same.

---------------------------------------------------------------------------
WHAT THIS PHASE CHANGED *INSIDE* THE LEGACY SIX  (all of it invisible on the
wire except where stated, and every one of them explicitly requested)
---------------------------------------------------------------------------
1. OTP STORAGE moved to the purpose-scoped `email_otps` table. The
   users.otp_code / otp_created_at / otp_attempts triple is still DUAL-WRITTEN
   for one release, and `otp_service.verify_otp` still falls back to it when a
   user has no email_otps row at all -- so a code that was mailed by the old
   implementation before this deploy is still redeemable. Nobody mid-flow is
   stranded.

2. /forgot-password IS NOW COOLDOWN-GATED (the one visible change). The bug:
   it called `stamp_new_otp`, which sets otp_attempts = 0, and had NO cooldown
   of its own -- so five wrong guesses followed by another /forgot-password
   bought five more guesses, forever, at zero cost. The 5-attempt lockout was
   therefore not a lockout at all. It now shares /resend-otp's 45s per-purpose
   cooldown and answers 429 with the same
   'Please wait {n}s before requesting another OTP.' string.

3. PASSWORD POLICY (min 8, not all-numeric, not a common password) now runs on
   /register and /reset-password as well as on the new routes. A policy the old
   endpoint can bypass is not a policy. Existing passwords are NOT invalidated
   -- the check only runs where a password is being CHOSEN. Set
   ENFORCE_PASSWORD_POLICY_LEGACY=false to restore 'anything goes' on the two
   legacy routes without a code change.

4. RATE LIMITS are attached to /login, /register, /forgot-password and
   /resend-otp. Inert unless RATELIMIT_ENABLED (false in dev and test, true in
   production).

5. SUCCESSFUL LOGIN records users.last_login_at / last_login_ip, and a
   successful password reset bumps users.token_version (config
   REVOKE_SESSIONS_ON_PASSWORD_RESET, default on) so a stolen session cannot
   outlive the reset that was meant to end it. Neither is visible in the
   response body.
===========================================================================
"""

import logging
import time

from flask import Blueprint, current_app, request, send_file
from sqlalchemy.exc import IntegrityError

from app import models
from app.core.db import session_scope
from app.core.rate_limit import limit_by_email, limit_by_ip
from app.core.responses import generate_response
from app.core.security import (
    encode_access_token,
    hash_password,
    require_permission,
    verify_password,
)
from app.core.validation import location_fields
from app.services.auth_service import (
    NEXT_BY_STATUS,
    build_session_payload,
    bump_token_version,
    email_status,
    find_user_by_email,
    issue_refresh_token,
    mint_access_token,
    password_policy_summary,
    record_login,
    revoke_refresh_token,
    rotate_refresh_token,
    validate_password,
    write_audit,
)
from app.services.consent_service import (
    current_documents,
    missing_mandatory,
    pending_consents,
    record_consents,
)
from app.services import profile_service, settings_service
from app.services.email_service import send_email
from app.services.otp_service import (
    PURPOSE_EMAIL_CHANGE,
    PURPOSE_RESET,
    PURPOSE_SIGNUP,
    VALID_PURPOSES,
    invalidate_otps,
    issue_otp,
    resend_wait_seconds,
)
from app.services.otp_service import verify_otp as verify_purpose_otp
from app.services.serializers import joined_at

logger = logging.getLogger(__name__)

auth_bp = Blueprint("auth", __name__)

# Roles a human may ever give themselves. 'Admin' is not on it and never will
# be: the only way to create one is `flask seed-root` or an existing admin.
ALLOWED_SIGNUP_ROLES = ('AI User', 'Doctor')


# ==========================================================================
# 1. REGISTER                                         [monolith 263-356]
# ==========================================================================
@auth_bp.route('/register', methods=['POST'])
@limit_by_ip("register_ip")
@limit_by_email("register_email")
def register():
    data = request.get_json()
    if not data or not all(k in data for k in ('name', 'email', 'password')):
        return generate_response(False, error="Missing required fields", status_code=400)

    # NEW: the server-side password floor. Gated so it can be switched off
    # without touching code if it ever rejects something it should not.
    if current_app.config.get("ENFORCE_PASSWORD_POLICY_LEGACY", True):
        ok, why = validate_password(data.get('password'))
        if not ok:
            return generate_response(False, error=why, status_code=400)

    with session_scope() as db:
        try:
            user_exists = db.query(models.User).filter(models.User.email == data['email']).first()
            if user_exists:
                return generate_response(False, error="Email already exists", status_code=400)

            # SECURITY: role kabhi bhi client se blindly accept nahi karte.
            # Sirf ye do roles hi public /register se banwaye ja sakte hain.
            # 'Admin' is route se kabhi nahi banega, chahe request body me kuch bhi bheja jaye.
            requested_role = data.get('role', 'AI User')
            final_role = requested_role if requested_role in ALLOWED_SIGNUP_ROLES else 'AI User'
            if requested_role not in ALLOWED_SIGNUP_ROLES:
                logger.warning(f"Blocked registration attempt with disallowed role '{requested_role}' for email {data.get('email')}")

            license_number = str(data.get('license') or '').strip()

            # Doctor validation UPFRONT -- koi bhi DB row banane se PEHLE. Isse license
            # missing/duplicate hone par ghost User row nahi banti (BUG FIX: pehle
            # user commit ho jata tha, phir license duplicate error aane par sirf
            # profile ka rollback hota tha, User row permanently reh jati thi aur
            # agla attempt "Email already exists" deta tha).
            location = None
            if final_role == 'Doctor':
                if not license_number:
                    return generate_response(False, error="PMDC license number is required for doctor registration", status_code=400)

                license_exists = db.query(models.DoctorProfile).filter(
                    models.DoctorProfile.license == license_number
                ).first()
                if license_exists:
                    return generate_response(False, error="This license number is already registered.", status_code=400)

                # The signup form posts a GEOCODED place: city + state + country
                # + coordinates from one picked result. Coerced and bounded HERE,
                # upfront like the licence checks, because the pair used to go
                # into two Float columns verbatim -- a string latitude, or 4000,
                # was stored exactly as sent and every distance calculation that
                # read it afterwards was quietly wrong.
                location, location_error = location_fields(
                    {key: data.get(key) for key in ("city", "state", "country",
                                                    "latitude", "longitude")}
                )
                if location_error is not None:
                    return generate_response(False, error=location_error, status_code=400)

            # User + (agar Doctor hai to) Profile banao -- sirf flush(), commit NAHI.
            # Jab tak OTP email successfully nahi chali jati, kuch bhi DB mein
            # permanently nahi jayega. Poori registration ek hi atomic transaction hai.
            new_user = models.User(
                name=data['name'],
                email=data['email'],
                password=hash_password(data['password']),
                role=final_role,
                is_verified=False,
                otp_attempts=0
            )
            db.add(new_user)
            db.flush()  # id chahiye DoctorProfile ke FK ke liye -- DB commit abhi nahi hua

            if final_role == 'Doctor':
                profile = models.DoctorProfile(
                    user_id=new_user.id,
                    specialty=data.get('specialty'),
                    hospital=data.get('hospital'),
                    phone=data.get('phone'),
                    license=license_number,
                    **location,  # city, state, country, latitude, longitude
                    verification_status='pending'  # Admin license check hone tak pending
                )
                db.add(profile)
                db.flush()

            # RUNTIME TOGGLE (admin console): with otp_verification_enabled
            # OFF, the account is born verified -- no code is issued and no
            # email is sent, so signup keeps working while SMTP is down
            # (which is the usual reason an admin flips this switch).
            if not settings_service.get_bool("OTP_VERIFICATION_ENABLED", True):
                new_user.is_verified = True
                db.commit()

                logger.info(f"New user registered (OTP verification disabled): {new_user.email}")
                return generate_response(
                    True,
                    message="Account created successfully. You can log in now.",
                    data={"verified": True, "next": "password", "email": new_user.email},
                    status_code=201,
                )

            # OTP: purpose-scoped row + the legacy users.otp_* dual write. First
            # code for a brand-new account, so the cooldown cannot apply.
            otp, otp_error = issue_otp(db, new_user, PURPOSE_SIGNUP, ignore_cooldown=True)
            if otp_error:  # pragma: no cover - unreachable with ignore_cooldown
                db.rollback()
                return generate_response(False, error=otp_error, status_code=429)

            # OTP email -- ye fail ho to poora rollback, koi row nahi bachni chahiye
            email_body = f"Hi {new_user.name},\n\nWelcome to SkinCare! Your verification code is: {otp}\n\nPlease verify your account to continue."
            email_sent = send_email(new_user.email, "Verify Your Account - SkinCare", email_body)

            if not email_sent:
                db.rollback()
                return generate_response(False, error="Failed to send OTP email. Please check server settings.", status_code=500)

            # Sab theek -- ab sirf ek hi commit, sab kuch atomic
            db.commit()

            logger.info(f"New user registered: {new_user.email}")
            return generate_response(True, message="OTP sent to email", status_code=201)
        except IntegrityError as e:
            db.rollback()
            logger.error(f"Integrity error during registration: {e}")
            return generate_response(False, error="Database integrity error or duplicate license number.", status_code=400)
        except Exception as e:
            db.rollback()
            logger.error(f"Registration Error: {e}", exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# 2. VERIFY OTP (EMAIL)                               [monolith 358-394]
# ==========================================================================
@auth_bp.route('/verify-otp-email', methods=['POST'])
@limit_by_ip("verify_otp_ip")
def verify_otp():
    data = request.get_json()
    if not data or 'email' not in data or 'otp' not in data:
        return generate_response(False, error="Email and OTP required", status_code=400)

    with session_scope() as db:
        try:
            user = db.query(models.User).filter(models.User.email == data['email']).first()
            if not user:
                return generate_response(False, error="User not found", status_code=404)

            # PURPOSE SCOPING: this endpoint activates an account, so it may only
            # ever redeem a 'signup' code. A code mailed as "reset your password"
            # used to work here, because all three flows shared one column.
            is_valid, err = verify_purpose_otp(db, user, PURPOSE_SIGNUP, data.get('otp'))
            if is_valid:
                user.is_verified = True
                db.commit()

                send_email(user.email, "Account Verified!", f"Welcome {user.name}, your account is now active.")
                logger.info(f"User email verified: {user.email}")
                return generate_response(True, message="Email verified successfully", status_code=200)

            # Attempt counting now lives on the email_otps row (5 per row), so
            # the route no longer increments anything itself -- it only has to
            # persist what verify_otp already recorded.
            db.commit()
            return generate_response(False, error=err, status_code=400)
        except Exception as e:
            db.rollback()
            logger.error(f"Verify OTP Error: {e}", exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# 3. RESEND OTP                                       [monolith 398-453]
# ==========================================================================
@auth_bp.route('/resend-otp', methods=['POST'])
@limit_by_ip("resend_otp_ip")
@limit_by_email("resend_otp_email")
def resend_otp():
    """
    ADD (missing feature -> real lockout bug): RegisterPage mein "Resend OTP"
    button hi nahi tha, aur OTP sirf 10 minute valid hoti hai. Agar user
    screen chhod de (browser band, refresh, timeout), to wo phas jata: dobara
    register nahi kar sakta ("Email already exists"), login nahi kar sakta
    ("verify your email first"). Ye endpoint unverified account ke liye fresh
    OTP issue karta hai taake wo verify-otp screen pe wapis aa kar continue
    kar sake.
    """
    data = request.get_json()
    email = data.get('email') if data else None

    if not email:
        return generate_response(False, error="Email is required", status_code=400)

    with session_scope() as db:
        try:
            user = db.query(models.User).filter(models.User.email == email).first()
            if not user:
                return generate_response(False, error="This email is not registered with us.", status_code=404)

            if user.is_verified:
                return generate_response(False, error="This account is already verified. Please login.", status_code=400)

            # Cooldown: turant dobara-dobara resend spam na ho sake. Now scoped to
            # the 'signup' purpose, so an unrelated password-reset code sent five
            # seconds ago no longer blocks a legitimate signup resend.
            wait_more = resend_wait_seconds(db, user, PURPOSE_SIGNUP)
            if wait_more:
                return generate_response(False, error=f"Please wait {wait_more}s before requesting another OTP.", status_code=429)

            otp, otp_error = issue_otp(db, user, PURPOSE_SIGNUP, ignore_cooldown=True)
            if otp_error:  # pragma: no cover - pre-checked above
                return generate_response(False, error=otp_error, status_code=429)

            email_body = f"Hi {user.name},\n\nYour new verification code is: {otp}\n\nPlease verify your account to continue."
            email_sent = send_email(user.email, "Your New Verification Code - SkinCare", email_body)

            if not email_sent:
                # BUG FIX pattern (same as forgot-password): DB sirf tab update
                # hoti hai jab email confirm successfully chali gayi ho, warna
                # purana valid OTP silently invalidate ho sakta tha bina naya
                # deliver hue. The rollback restores the previous code exactly.
                db.rollback()
                return generate_response(False, error="Failed to send OTP email. Please check server settings.", status_code=500)

            db.commit()

            logger.info(f"OTP resent to: {user.email}")
            return generate_response(True, message="A new OTP has been sent to your email.", status_code=200)
        except Exception as e:
            db.rollback()
            logger.error(f"Resend OTP Error: {e}", exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# 4. LOGIN                                            [monolith 455-506]
# ==========================================================================
@auth_bp.route('/login', methods=['POST'])
@limit_by_ip("login_ip")
@limit_by_email("login_email")
def login():
    data = request.get_json()
    if not data or not all(k in data for k in ('email', 'password')):
        return generate_response(False, error="Missing required credentials", status_code=400)

    with session_scope() as db:
        try:
            # SECURITY: password ab hash compare hota hai, DB query me raw match nahi.
            user = db.query(models.User).filter(models.User.email == data['email']).first()

            password_ok = bool(user) and verify_password(user.password, data['password'])

            # BEHAVIOUR CHANGE (a): the monolith (line 468) ALSO demanded
            # `user.role == data.get('role')`, so picking the wrong role on the
            # login form produced 401 "Invalid credentials" for a perfectly
            # valid password. The field is still accepted and read here so the
            # intent is explicit, and then deliberately discarded: the stored
            # role below is the only one that reaches the token or the response.
            _client_supplied_role = data.get('role')  # noqa: F841 -- ignored on purpose

            if user and password_ok:
                # Same gate /auth/login applies. Without it a SUSPENDED account
                # was handed a fresh, signature-valid token carrying the CURRENT
                # token_version -- so it survived every version check and only
                # the is_active branch of session_is_current stood between it and
                # the API. Suspension must not be re-mintable.
                if getattr(user, "is_active", True) is False:
                    return generate_response(
                        False, error="This account has been deactivated.", status_code=403
                    )

                if not user.is_verified:
                    return generate_response(False, error="Please verify your email first", status_code=403)

                # `tv` must be the CURRENT token_version, otherwise a token minted
                # here would be dead on arrival for anyone whose version was ever
                # bumped (admin suspension, logout-all, password reset).
                token = encode_access_token(
                    user.id, user.role,
                    token_version=int(getattr(user, "token_version", 0) or 0),
                )

                # Response-invisible: populates users.last_login_at/_ip, which the
                # admin console reads. session_scope commits on the way out.
                record_login(user)

                join_date = joined_at(user.created_at)

                user_payload = {
                    "id": user.id,
                    "name": user.name,
                    "email": user.email,
                    "role": user.role,
                    "joined_at": join_date
                }

                # Doctor ke liye license verification status bhi login response me bhej dete hain
                # taake frontend turant "Verified" / "Pending Verification" badge dikha sake.
                if user.role == 'Doctor':
                    doctor_profile = db.query(models.DoctorProfile).filter_by(user_id=user.id).first()
                    user_payload["verification_status"] = doctor_profile.verification_status if doctor_profile else 'pending'

                logger.info(f"User logged in: {user.email}")
                return generate_response(True, data={
                    "token": token,
                    "user": user_payload
                }, status_code=200)

            logger.warning(f"Failed login attempt for email: {data.get('email')}")
            return generate_response(False, error="Invalid credentials", status_code=401)
        except Exception as e:
            logger.error(f"Login Error: {e}", exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# 5. FORGOT PASSWORD                                  [monolith 508-546]
# ==========================================================================
@auth_bp.route('/forgot-password', methods=['POST'])
@limit_by_ip("forgot_password_ip")
@limit_by_email("forgot_password_email")
def forgot_password():
    data = request.get_json()
    email = data.get('email')

    if not email:
        return generate_response(False, error="Email is required!", status_code=400)

    with session_scope() as db:
        try:
            user = db.query(models.User).filter(models.User.email == email).first()
            if not user:
                return generate_response(False, error="This email is not registered with us.", status_code=404)

            # THE UNBOUNDED-LOCKOUT FIX. This route used to call stamp_new_otp,
            # which resets otp_attempts to 0, with no cooldown at all -- so the
            # 5-attempt lockout could be cleared instantly and indefinitely.
            # issue_otp is cooldown-gated per purpose, so clearing the lockout now
            # costs 45 seconds per attempt-window instead of nothing.
            otp, otp_error = issue_otp(db, user, PURPOSE_RESET)
            if otp_error:
                return generate_response(False, error=otp_error, status_code=429)

            email_body = f"Hi {user.name},\n\nYou requested a password reset. Your OTP code is: {otp}\n\nIf you did not request this, please ignore this email safely."
            email_sent = send_email(user.email, "Reset Your Password - SkinCare", email_body)

            if not email_sent:
                # BUG FIX: pehle otp_code commit hota tha email bhejne SE PEHLE --
                # agar email fail ho jaye (SMTP hiccup, double-click, etc.) to koi
                # purana valid OTP bhi silently overwrite/invalidate ho jata tha,
                # bina kisi naye OTP ke deliver hue. Ab rollback purana state wapis
                # le aata hai.
                db.rollback()
                return generate_response(False, error="Failed to send OTP email. Please check server SMTP settings.", status_code=500)

            db.commit()

            logger.info(f"Password reset OTP sent to: {user.email}")
            return generate_response(True, message="Password reset OTP sent to your email.", status_code=200)
        except Exception as e:
            db.rollback()
            logger.error(f"Forgot Password Error: {e}", exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# 6. RESET PASSWORD                                   [monolith 548-594]
# ==========================================================================
@auth_bp.route('/reset-password', methods=['POST'])
@limit_by_ip("reset_password_ip")
def reset_password():
    data = request.get_json()
    email = data.get('email')
    otp = data.get('otp')
    new_password = data.get('new_password')

    if not all([email, otp, new_password]):
        return generate_response(False, error="Email, OTP, and New Password are required fields.", status_code=400)

    if current_app.config.get("ENFORCE_PASSWORD_POLICY_LEGACY", True):
        ok, why = validate_password(new_password)
        if not ok:
            return generate_response(False, error=why, status_code=400)

    with session_scope() as db:
        try:
            user = db.query(models.User).filter(models.User.email == email).first()
            if not user:
                return generate_response(False, error="User not found.", status_code=404)

            # PURPOSE SCOPING: only a 'reset' code opens this door. A signup code
            # is no longer accepted here.
            is_valid, err = verify_purpose_otp(db, user, PURPOSE_RESET, otp)
            if not is_valid:
                db.commit()  # persist the attempt increment recorded above
                return generate_response(False, error=err or "Invalid or expired OTP code.", status_code=400)

            _apply_new_password(db, user, new_password)
            db.commit()

            send_email(user.email, "Password Reset Successful", f"Hi {user.name},\n\nYour password has been changed successfully. You can now login to SkinCare with your new password.")
            logger.info(f"Password reset successful for: {user.email}")
            return generate_response(True, message="Password updated successfully!", status_code=200)
        except Exception as e:
            db.rollback()
            logger.error(f"Reset Password Error: {e}", exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


def _apply_new_password(db, user, new_password):
    """Everything a password change has to do, in one place.

    * hash and store
    * is_verified = True -- BUG FIX inherited from the monolith port: a user
      stuck on the OTP screen (cannot re-register, cannot log in) could reset
      their password and STILL be unable to log in, because is_verified stayed
      False. Whoever receives that email owns the inbox, which is exactly what
      verification proves.
    * kill every outstanding OTP for the account (a live signup code must not
      survive a password change)
    * bump token_version + revoke refresh rows, so a session stolen BEFORE the
      reset does not outlive it. This is the entire point of resetting a
      password under duress. Config REVOKE_SESSIONS_ON_PASSWORD_RESET (default
      true) turns it off if it ever misfires.
    """
    user.password = hash_password(new_password)
    user.is_verified = True
    invalidate_otps(db, user.id)

    if current_app.config.get("REVOKE_SESSIONS_ON_PASSWORD_RESET", True):
        bump_token_version(db, user)

    write_audit(
        db, "password.reset",
        actor_user_id=user.id, subject_user_id=user.id,
        target_type="user", target_id=user.id,
    )


# ==========================================================================
# ==========================================================================
#  PART B -- THE NEW /auth SURFACE
# ==========================================================================
# Everything below is ADDITIVE. No path here collides with the 39, and the six
# routes above are untouched by any of it.
# ==========================================================================

# A floor on how fast /auth/check-email may answer. An unauthenticated endpoint
# that says "this email exists" in 3 ms and "it does not" in 30 ms leaks the
# same fact its own response body deliberately rations. The floor is small
# enough that the typing-ahead UI never feels it.
CHECK_EMAIL_MIN_SECONDS = 0.06


def _pad_timing(started_at, floor=CHECK_EMAIL_MIN_SECONDS):
    remaining = floor - (time.perf_counter() - started_at)
    if remaining > 0:
        time.sleep(remaining)


def _json():
    return request.get_json(silent=True) or {}


def _access_token_seconds():
    return int(current_app.config.get("ACCESS_TOKEN_HOURS", 24)) * 3600


def _token_bundle(db, user):
    """The block every successful authentication returns.

    `token` keeps its legacy key name so a client that already reads
    data.token from /login needs no change to move to /auth/login.
    """
    refresh_plaintext, _row = issue_refresh_token(db, user)
    return {
        "token": mint_access_token(user),
        "refresh_token": refresh_plaintext,
        "token_type": "Bearer",
        "expires_in": _access_token_seconds(),
        "session": build_session_payload(db, user),
    }


def _legacy_user_payload(db, user):
    """The exact `data.user` shape /login emits, so both login endpoints agree."""
    payload = {
        "id": user.id,
        "name": user.name,
        "email": user.email,
        "role": user.role,
        "joined_at": joined_at(user.created_at),
    }
    if user.role == 'Doctor':
        profile = db.query(models.DoctorProfile).filter_by(user_id=user.id).first()
        payload["verification_status"] = profile.verification_status if profile else 'pending'
    return payload


def _purpose_from(data, default=PURPOSE_SIGNUP):
    """(purpose, error). Unknown purposes are a 400, never a silent default --
    silently downgrading 'reset' to 'signup' is how the original bug felt."""
    raw = str(data.get('purpose') or default).strip().lower()
    if raw not in VALID_PURPOSES:
        return None, f"Unknown purpose. Expected one of: {', '.join(VALID_PURPOSES)}."
    return raw, None


def _current_user_row(db):
    """The User row behind request.current_user (set by require_permission).

    Reads the EFFECTIVE actor, so an admin using X-Act-As-User-Id sees the
    target's session -- which is the whole point of impersonation support.
    """
    claims = getattr(request, "current_user", None) or {}
    user_id = claims.get("user_id")
    if user_id is None:
        return None
    return db.query(models.User).filter(models.User.id == int(user_id)).first()


# ==========================================================================
# B1. CHECK EMAIL -- which of the three doors to open
# ==========================================================================
@auth_bp.route('/auth/check-email', methods=['POST'])
@limit_by_ip("check_email_ip")
def auth_check_email():
    """POST {email} -> {status, next}

    This is what replaces "pick Login or Register, then pick your role" with a
    single field. Three answers, and nothing else:

        new         -> signup     no account
        unverified  -> otp        account exists, email never confirmed
        existing    -> password   account exists and is usable

    PRIVACY: the response NEVER contains the name, the role, or whether the
    account is a doctor. It is unauthenticated, so anything richer turns it into
    a directory-scraping endpoint. It does confirm existence -- that is an
    accepted, deliberate product trade (the alternative is asking every visitor
    to guess which form they need), and it is why the endpoint is both rate
    limited and timing-padded.
    """
    started = time.perf_counter()
    data = _json()
    email = str(data.get('email') or '').strip()

    if not email:
        _pad_timing(started)
        return generate_response(False, error="Email is required", status_code=400)

    with session_scope() as db:
        status = email_status(db, email)

    _pad_timing(started)
    return generate_response(True, data={
        "status": status,
        "next": NEXT_BY_STATUS[status],
    }, status_code=200)


# ==========================================================================
# B2. REGISTER (new) -- account + doctor profile + consents in one call
# ==========================================================================
@auth_bp.route('/auth/register', methods=['POST'])
@limit_by_ip("register_ip")
@limit_by_email("register_email")
def auth_register():
    """POST {name, email, password, role, doctor:{...}, consents:[...]} -> 201

    Differences from legacy /register, all additive:
      * `doctor` is a nested object (flat top-level keys still accepted, so the
        old body shape keeps working)
      * `consents` is recorded against versioned documents; missing MANDATORY
        ones are a 400 that names them
      * the password policy is unconditional here (no legacy escape hatch)

    Unchanged: 'Admin' is impossible. The role whitelist is the same tuple the
    legacy route uses, and anything outside it becomes 'AI User'.
    """
    data = _json()
    name = str(data.get('name') or '').strip()
    email = str(data.get('email') or '').strip()
    password = data.get('password')

    if not name or not email or not password:
        return generate_response(False, error="Missing required fields", status_code=400)

    ok, why = validate_password(password)
    if not ok:
        return generate_response(False, error=why, status_code=400)

    requested_role = data.get('role', 'AI User')
    final_role = requested_role if requested_role in ALLOWED_SIGNUP_ROLES else 'AI User'
    if requested_role not in ALLOWED_SIGNUP_ROLES:
        logger.warning(
            "Blocked registration attempt with disallowed role '%s' for email %s",
            requested_role, email,
        )

    doctor = data.get('doctor') if isinstance(data.get('doctor'), dict) else {}

    def field(key):
        """Nested `doctor` first, flat top-level second (legacy body shape)."""
        value = doctor.get(key)
        return data.get(key) if value in (None, "") else value

    consents = data.get('consents') if isinstance(data.get('consents'), list) else []

    with session_scope() as db:
        try:
            missing = missing_mandatory(db, final_role, consents)
            if missing:
                return generate_response(
                    False,
                    error="You must accept the required agreements to create an account.",
                    data={"missing_consents": missing},
                    status_code=400,
                )

            if find_user_by_email(db, email) is not None:
                return generate_response(False, error="Email already exists", status_code=400)

            license_number = str(field('license') or '').strip()
            if final_role == 'Doctor':
                if not license_number:
                    return generate_response(
                        False,
                        error="PMDC license number is required for doctor registration",
                        status_code=400,
                    )
                exists = db.query(models.DoctorProfile).filter(
                    models.DoctorProfile.license == license_number
                ).first()
                if exists:
                    return generate_response(
                        False, error="This license number is already registered.", status_code=400
                    )

            new_user = models.User(
                name=name,
                email=email,
                password=hash_password(password),
                role=final_role,
                is_verified=False,
                otp_attempts=0,
            )
            db.add(new_user)
            db.flush()

            if final_role == 'Doctor':
                experience = field('experience')
                try:
                    experience = int(experience) if experience not in (None, "") else 0
                except (TypeError, ValueError):
                    experience = 0

                db.add(models.DoctorProfile(
                    user_id=new_user.id,
                    specialty=field('specialty'),
                    hospital=field('hospital'),
                    city=field('city'),
                    phone=field('phone'),
                    license=license_number,
                    latitude=field('latitude'),
                    longitude=field('longitude'),
                    experience=experience,
                    # USER DECISION: existing doctors were auto-approved by the
                    # data migration; every NEW one starts pending and is subject
                    # to ENFORCE_DOCTOR_VERIFICATION.
                    verification_status='pending',
                ))
                db.flush()

            record_consents(db, new_user, consents, source="signup")

            # RUNTIME TOGGLE (admin console): with otp_verification_enabled
            # OFF, skip the OTP round trip entirely. The response carries the
            # same verified-style token bundle /auth/verify-otp returns for a
            # signup code, so the client can seat the session immediately;
            # `next: "password"` is the fallback hint for a client that
            # ignores the bundle (a value stateForCheckEmail already maps).
            if not settings_service.get_bool("OTP_VERIFICATION_ENABLED", True):
                new_user.is_verified = True
                record_login(new_user)

                payload = {
                    "email": new_user.email,
                    "role": final_role,
                    "verified": True,
                    "purpose": PURPOSE_SIGNUP,
                    "next": "password",
                }
                payload.update(_token_bundle(db, new_user))
                payload["user"] = _legacy_user_payload(db, new_user)

                write_audit(
                    db, "auth.register",
                    actor_user_id=new_user.id, subject_user_id=new_user.id,
                    target_type="user", target_id=new_user.id,
                    detail=f"role={final_role}, otp_verification=disabled",
                )
                db.commit()

                logger.info(
                    "New user registered via /auth/register with OTP verification disabled: %s (%s)",
                    new_user.email, final_role,
                )
                return generate_response(
                    True, message="Account created successfully.",
                    data=payload, status_code=201,
                )

            otp, otp_error = issue_otp(db, new_user, PURPOSE_SIGNUP, ignore_cooldown=True)
            if otp_error:  # pragma: no cover
                db.rollback()
                return generate_response(False, error=otp_error, status_code=429)

            body = (
                f"Hi {new_user.name},\n\nWelcome to SkinCare! Your verification code is: {otp}\n\n"
                "Please verify your account to continue."
            )
            if not send_email(new_user.email, "Verify Your Account - SkinCare", body):
                db.rollback()
                return generate_response(
                    False,
                    error="Failed to send OTP email. Please check server settings.",
                    status_code=500,
                )

            write_audit(
                db, "auth.register",
                actor_user_id=new_user.id, subject_user_id=new_user.id,
                target_type="user", target_id=new_user.id,
                detail=f"role={final_role}",
            )
            db.commit()

            logger.info("New user registered via /auth/register: %s (%s)", new_user.email, final_role)
            return generate_response(True, message="OTP sent to email", data={
                "email": new_user.email,
                "role": final_role,
                "next": "otp",
                "otp_purpose": PURPOSE_SIGNUP,
            }, status_code=201)
        except IntegrityError as exc:
            db.rollback()
            logger.error("Integrity error during /auth/register: %s", exc)
            return generate_response(
                False,
                error="Database integrity error or duplicate license number.",
                status_code=400,
            )
        except Exception as exc:
            db.rollback()
            logger.error("Registration error (/auth/register): %s", exc, exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# B3. LOGIN (new) -- access + refresh + the canonical session
# ==========================================================================
@auth_bp.route('/auth/login', methods=['POST'])
@limit_by_ip("login_ip")
@limit_by_email("login_email")
def auth_login():
    """POST {email, password} -> {token, refresh_token, user, session}

    `role` is accepted (the old form still sends it) and ALWAYS IGNORED --
    users.role is the only authority. Sending the "wrong" role can no longer
    turn a valid password into 401 Invalid credentials.
    """
    data = _json()
    email = str(data.get('email') or '').strip()
    password = data.get('password')

    if not email or not password:
        return generate_response(False, error="Missing required credentials", status_code=400)

    _client_supplied_role = data.get('role')  # noqa: F841 -- ignored on purpose

    with session_scope() as db:
        try:
            user = find_user_by_email(db, email)
            password_ok = bool(user) and verify_password(user.password, password)

            if not user or not password_ok:
                logger.warning("Failed login attempt for email: %s", email)
                return generate_response(False, error="Invalid credentials", status_code=401)

            if getattr(user, "is_active", True) is False:
                return generate_response(
                    False, error="This account has been deactivated.", status_code=403
                )

            if not user.is_verified:
                # `next` lets the unified screen jump straight to the OTP step
                # instead of dead-ending on an error toast.
                return generate_response(
                    False,
                    error="Please verify your email first",
                    data={"next": "otp", "otp_purpose": PURPOSE_SIGNUP, "email": user.email},
                    status_code=403,
                )

            record_login(user)
            bundle = _token_bundle(db, user)
            bundle["user"] = _legacy_user_payload(db, user)

            write_audit(
                db, "auth.login",
                actor_user_id=user.id, subject_user_id=user.id,
                target_type="user", target_id=user.id,
            )
            db.commit()

            logger.info("User logged in (/auth/login): %s", user.email)
            return generate_response(True, data=bundle, status_code=200)
        except Exception as exc:
            db.rollback()
            logger.error("Login error (/auth/login): %s", exc, exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# B4. VERIFY OTP (purpose-scoped)
# ==========================================================================
@auth_bp.route('/auth/verify-otp', methods=['POST'])
@limit_by_ip("verify_otp_ip")
@limit_by_email("verify_otp_email")
def auth_verify_otp():
    """POST {email, otp, purpose} -> depends on purpose

      signup        consumes the code, marks the account verified and returns a
                    full session -- the user proved they own the inbox and
                    already chose a password, so a second login round-trip would
                    be ceremony.
      reset         VALIDATES ONLY, does not consume: /auth/reset-password still
                    needs the code. Wrong guesses still count toward the 5.
      email_change  consumes the code and moves users.pending_email into
                    users.email.
    """
    data = _json()
    email = str(data.get('email') or '').strip()
    code = data.get('otp') if data.get('otp') is not None else data.get('code')

    if not email or code in (None, ""):
        return generate_response(False, error="Email and OTP required", status_code=400)

    purpose, purpose_error = _purpose_from(data)
    if purpose_error:
        return generate_response(False, error=purpose_error, status_code=400)

    with session_scope() as db:
        try:
            user = find_user_by_email(db, email)
            if not user:
                return generate_response(False, error="User not found", status_code=404)

            # 'reset' only proves the code is good; consuming it here would make
            # the following /auth/reset-password call impossible.
            consume = purpose != PURPOSE_RESET
            ok, err = verify_purpose_otp(db, user, purpose, code, consume=consume)
            if not ok:
                db.commit()  # keep the attempt increment
                return generate_response(False, error=err, status_code=400)

            payload = {"verified": True, "purpose": purpose, "email": user.email}

            if purpose == PURPOSE_SIGNUP:
                user.is_verified = True
                record_login(user)
                payload.update(_token_bundle(db, user))
                payload["user"] = _legacy_user_payload(db, user)
                send_email(
                    user.email, "Account Verified!",
                    f"Welcome {user.name}, your account is now active.",
                )

            elif purpose == PURPOSE_EMAIL_CHANGE:
                if not user.pending_email:
                    return generate_response(
                        False, error="No pending email change for this account.", status_code=400
                    )
                previous = user.email
                user.email = user.pending_email
                user.pending_email = None
                user.is_verified = True
                payload["email"] = user.email
                write_audit(
                    db, "auth.email_change",
                    actor_user_id=user.id, subject_user_id=user.id,
                    target_type="user", target_id=user.id,
                    detail=f"{previous} -> {user.email}",
                )

            else:  # reset -- the code stays live for /auth/reset-password
                payload["next"] = "new_password"

            db.commit()
            return generate_response(True, message="Email verified successfully",
                                     data=payload, status_code=200)
        except IntegrityError:
            db.rollback()
            return generate_response(False, error="Email already exists", status_code=400)
        except Exception as exc:
            db.rollback()
            logger.error("Verify OTP error (/auth/verify-otp): %s", exc, exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# B5. RESEND OTP (purpose-scoped)
# ==========================================================================
@auth_bp.route('/auth/resend-otp', methods=['POST'])
@limit_by_ip("resend_otp_ip")
@limit_by_email("resend_otp_email")
def auth_resend_otp():
    """POST {email, purpose} -> 200 | 429 'Please wait {n}s before requesting another OTP.'

    The cooldown is PER PURPOSE, which is the fix: asking for a password reset
    is no longer blocked by a signup code that went out five seconds ago.
    """
    data = _json()
    email = str(data.get('email') or '').strip()
    if not email:
        return generate_response(False, error="Email is required", status_code=400)

    purpose, purpose_error = _purpose_from(data)
    if purpose_error:
        return generate_response(False, error=purpose_error, status_code=400)

    with session_scope() as db:
        try:
            user = find_user_by_email(db, email)
            if not user:
                return generate_response(
                    False, error="This email is not registered with us.", status_code=404
                )

            if purpose == PURPOSE_SIGNUP and user.is_verified:
                return generate_response(
                    False, error="This account is already verified. Please login.", status_code=400
                )

            # BUG FIX: this used to mail every purpose to `user.email`. For an
            # email change that is the WRONG INBOX -- the entire point of the
            # flow is proving the person can read the address they are moving
            # TO, and sending the code to the address they are moving FROM
            # verifies something nobody doubted. Worse, the code then never
            # reaches the only inbox that could use it, so the resend button
            # looked like it worked and silently did nothing useful.
            recipient = user.email
            if purpose == PURPOSE_EMAIL_CHANGE:
                if not user.pending_email:
                    return generate_response(
                        False, error=ERR_NO_PENDING_EMAIL, status_code=400
                    )
                recipient = user.pending_email

            otp, otp_error = issue_otp(db, user, purpose)
            if otp_error:
                return generate_response(False, error=otp_error, status_code=429)

            subject, body = _otp_email_for(purpose, user, otp)
            if not send_email(recipient, subject, body):
                db.rollback()
                return generate_response(
                    False,
                    error="Failed to send OTP email. Please check server settings.",
                    status_code=500,
                )

            db.commit()
            return generate_response(
                True, message="A new OTP has been sent to your email.",
                data={"purpose": purpose}, status_code=200,
            )
        except Exception as exc:
            db.rollback()
            logger.error("Resend OTP error (/auth/resend-otp): %s", exc, exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


def _otp_email_for(purpose, user, otp):
    if purpose == PURPOSE_RESET:
        return (
            "Reset Your Password - SkinCare",
            f"Hi {user.name},\n\nYou requested a password reset. Your OTP code is: {otp}\n\n"
            "If you did not request this, please ignore this email safely.",
        )
    if purpose == PURPOSE_EMAIL_CHANGE:
        return (
            "Confirm Your New Email - SkinCare",
            f"Hi {user.name},\n\nYour email change confirmation code is: {otp}\n\n"
            "If you did not request this, please ignore this email safely.",
        )
    return (
        "Your New Verification Code - SkinCare",
        f"Hi {user.name},\n\nYour new verification code is: {otp}\n\n"
        "Please verify your account to continue.",
    )


# ==========================================================================
# B6. FORGOT PASSWORD (purpose-scoped, non-enumerating)
# ==========================================================================
@auth_bp.route('/auth/forgot-password', methods=['POST'])
@limit_by_ip("forgot_password_ip")
@limit_by_email("forgot_password_email")
def auth_forgot_password():
    """POST {email} -> always 200.

    Unlike legacy /forgot-password (404 'This email is not registered with us.')
    this never confirms or denies that an address exists. /auth/check-email is
    the ONE place that answers that question, and it is rate limited and timing
    padded; a second, chattier oracle would make that rationing pointless.

    Cooldown-gated per purpose, so the reset loop cannot be used to clear the
    5-attempt OTP lockout for free.
    """
    started = time.perf_counter()
    data = _json()
    email = str(data.get('email') or '').strip()

    if not email:
        _pad_timing(started)
        return generate_response(False, error="Email is required!", status_code=400)

    generic = generate_response(
        True,
        message="If that email is registered, a password reset code has been sent.",
        data={"next": "otp", "otp_purpose": PURPOSE_RESET, "email": email},
        status_code=200,
    )

    with session_scope() as db:
        try:
            user = find_user_by_email(db, email)
            if not user:
                _pad_timing(started)
                return generic

            otp, otp_error = issue_otp(db, user, PURPOSE_RESET)
            if otp_error:
                # The cooldown message is NOT an enumeration leak worth hiding:
                # a client only ever sees it after it already got a 200 for the
                # same address seconds earlier.
                _pad_timing(started)
                return generate_response(False, error=otp_error, status_code=429)

            subject, body = _otp_email_for(PURPOSE_RESET, user, otp)
            if not send_email(user.email, subject, body):
                db.rollback()
                _pad_timing(started)
                return generate_response(
                    False,
                    error="Failed to send OTP email. Please check server SMTP settings.",
                    status_code=500,
                )

            db.commit()
            logger.info("Password reset OTP sent to: %s", user.email)
            _pad_timing(started)
            return generic
        except Exception as exc:
            db.rollback()
            logger.error("Forgot password error (/auth/forgot-password): %s", exc, exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# B7. RESET PASSWORD (purpose-scoped)
# ==========================================================================
@auth_bp.route('/auth/reset-password', methods=['POST'])
@limit_by_ip("reset_password_ip")
@limit_by_email("forgot_password_email")
def auth_reset_password():
    """POST {email, otp, new_password} -> 200

    Consumes the 'reset' code, applies the password policy, and ends every
    existing session for the account (token_version bump + refresh revocation).
    """
    data = _json()
    email = str(data.get('email') or '').strip()
    otp = data.get('otp')
    new_password = data.get('new_password') or data.get('password')

    if not email or otp in (None, "") or not new_password:
        return generate_response(
            False, error="Email, OTP, and New Password are required fields.", status_code=400
        )

    ok, why = validate_password(new_password)
    if not ok:
        return generate_response(False, error=why, status_code=400)

    with session_scope() as db:
        try:
            user = find_user_by_email(db, email)
            if not user:
                return generate_response(False, error="User not found.", status_code=404)

            valid, err = verify_purpose_otp(db, user, PURPOSE_RESET, otp)
            if not valid:
                db.commit()
                return generate_response(
                    False, error=err or "Invalid or expired OTP code.", status_code=400
                )

            _apply_new_password(db, user, new_password)
            db.commit()

            send_email(
                user.email, "Password Reset Successful",
                f"Hi {user.name},\n\nYour password has been changed successfully. "
                "You can now login to SkinCare with your new password.",
            )
            logger.info("Password reset successful (/auth/reset-password) for: %s", user.email)
            return generate_response(
                True, message="Password updated successfully!",
                data={"next": "password"}, status_code=200,
            )
        except Exception as exc:
            db.rollback()
            logger.error("Reset password error (/auth/reset-password): %s", exc, exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# B8. ME -- the canonical identity payload (FROZEN, see docs/api-contract.md)
# ==========================================================================
@auth_bp.route('/auth/me', methods=['GET'])
@require_permission()
def auth_me():
    """GET -> {user, doctor, permissions, workspaces, home_route, pending_consents}

    `workspaces` is the piece that makes one account enough. Because
    ROLE_PERMISSIONS is a real hierarchy, a Doctor holds every Patient
    permission, so they get BOTH the doctor dashboard AND their own scan
    history -- no second account with a second email to get their own mole
    looked at. `home_route` is simply which one the UI opens first.
    """
    with session_scope() as db:
        user = _current_user_row(db)
        if user is None:
            return generate_response(False, error="User not found", status_code=404)
        return generate_response(True, data=build_session_payload(db, user), status_code=200)


# ==========================================================================
# B9. REFRESH -- rotate
# ==========================================================================
@auth_bp.route('/auth/refresh', methods=['POST'])
@limit_by_ip("refresh_ip")
def auth_refresh():
    """POST {refresh_token} -> a NEW access token and a NEW refresh token.

    The presented refresh token is revoked as part of the exchange (rotation on
    every use). Presenting an already-rotated one means two parties hold the
    same value, which is theft until proven otherwise -- rotate_refresh_token
    revokes the whole family and this returns 401.
    """
    data = _json()
    presented = data.get('refresh_token') or data.get('token')
    if not presented:
        return generate_response(False, error="Refresh token is required.", status_code=400)

    with session_scope() as db:
        try:
            user, new_refresh, err = rotate_refresh_token(db, presented)
            if err:
                db.commit()  # persist a theft-triggered mass revocation
                return generate_response(False, error=err, status_code=401)

            payload = {
                "token": mint_access_token(user),
                "refresh_token": new_refresh,
                "token_type": "Bearer",
                "expires_in": _access_token_seconds(),
                "session": build_session_payload(db, user),
            }
            db.commit()
            return generate_response(True, data=payload, status_code=200)
        except Exception as exc:
            db.rollback()
            logger.error("Refresh error: %s", exc, exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# B10 / B11. LOGOUT -- this device, or everywhere
# ==========================================================================
@auth_bp.route('/auth/logout', methods=['POST'])
@require_permission(optional=True)
def auth_logout():
    """POST {refresh_token} -> 200, always.

    Auth is OPTIONAL on purpose: a client whose access token has already expired
    must still be able to hand back its refresh token. Always 200 -- telling a
    caller "that token was not valid anyway" is a probe oracle, and the client
    has nothing useful to do with the distinction.
    """
    data = _json()
    presented = data.get('refresh_token') or data.get('token')

    with session_scope() as db:
        revoked = revoke_refresh_token(db, presented) if presented else False
        claims = getattr(request, "current_user", None) or {}
        if claims.get("user_id"):
            write_audit(
                db, "auth.logout",
                actor_user_id=claims.get("user_id"), subject_user_id=claims.get("user_id"),
                target_type="user", target_id=claims.get("user_id"),
            )
        db.commit()

    return generate_response(True, message="Logged out.",
                             data={"revoked": bool(revoked)}, status_code=200)


@auth_bp.route('/auth/logout-all', methods=['POST'])
@require_permission()
def auth_logout_all():
    """POST -> bump users.token_version and revoke every refresh row.

    The version bump is what kills ACCESS tokens too: every one carries the `tv`
    it was minted with, and require_permission refuses a token whose `tv` is
    behind the stored value. No blocklist, no shared cache, effective on the
    very next request.
    """
    with session_scope() as db:
        user = _current_user_row(db)
        if user is None:
            return generate_response(False, error="User not found", status_code=404)

        version, revoked = bump_token_version(db, user)
        invalidate_otps(db, user.id)
        write_audit(
            db, "auth.logout_all",
            actor_user_id=user.id, subject_user_id=user.id,
            target_type="user", target_id=user.id,
            detail=f"token_version={version}, refresh_revoked={revoked}",
        )
        db.commit()

        logger.info("All sessions ended for user %s (token_version=%s)", user.id, version)
        return generate_response(True, message="All sessions ended. Please login again.", data={
            "token_version": version,
            "sessions_revoked": revoked,
        }, status_code=200)


# ==========================================================================
# B12 / B13. CONSENT
# ==========================================================================
@auth_bp.route('/auth/consent-documents', methods=['GET'])
def auth_consent_documents():
    """GET ?role=Doctor -> the documents the signup form must render.

    Role-aware because the licence attestation only applies to doctors. Each
    item carries `mandatory`, which is defined in CODE (consent_service
    CONSENT_SPECS) rather than in the database, so whether a consent is
    refusable is reviewable in a diff.
    """
    role = request.args.get('role')
    with session_scope() as db:
        documents = current_documents(db, role)
    return generate_response(True, data={
        "documents": documents,
        "password_policy": password_policy_summary(),
    }, status_code=200)


@auth_bp.route('/auth/consents', methods=['POST'])
@require_permission()
def auth_record_consents():
    """POST {consents:[{type, version, granted}]} -> what is still pending.

    Also the re-prompt endpoint: when a document's version changes, /auth/me
    lists it under pending_consents and the client posts the new acceptance
    here. Append-only -- the previous grant is superseded, never edited, because
    the point is being able to reconstruct what someone agreed to on a date.
    """
    data = _json()
    submitted = data.get('consents')
    if submitted is None and isinstance(data.get('type'), str):
        submitted = [data]           # single-item convenience shape
    if not isinstance(submitted, list) or not submitted:
        return generate_response(
            False, error="A non-empty 'consents' array is required.", status_code=400
        )

    with session_scope() as db:
        user = _current_user_row(db)
        if user is None:
            return generate_response(False, error="User not found", status_code=404)

        source = str(data.get('source') or 'stepper')[:30]
        written = record_consents(db, user, submitted, source=source)
        write_audit(
            db, "consent.record",
            actor_user_id=user.id, subject_user_id=user.id,
            target_type="user", target_id=user.id,
            detail=f"{written} consent row(s), source={source}",
        )
        outstanding = pending_consents(db, user)
        db.commit()

    return generate_response(True, message="Consent recorded.", data={
        "recorded": written,
        "pending_consents": outstanding,
    }, status_code=200)


# ==========================================================================
# ==========================================================================
#  PART C -- SELF-SERVICE ACCOUNT: PROFILE, AVATAR, PASSWORD, EMAIL CHANGE
# ==========================================================================
#  /api/profile          GET, PATCH        authed   read / partially edit ME
#  /api/profile/avatar   GET, POST, DELETE authed   the account picture
#  /auth/change-password POST              authed   knows the old password
#  /auth/email-change/request  POST        authed   OTP to the NEW address
#  /auth/email-change/verify   POST        authed   swap it in
#  /auth/email-change/cancel   POST        authed   forget it
#
# WHY THESE LIVE IN THE AUTH BLUEPRINT
# ------------------------------------
# app/api/__init__.py is frozen (it says so, in capitals) and is what registers
# blueprints, so a new blueprint cannot be added without editing it. Paths are
# absolute in every @route decorator anyway -- no blueprint here carries a
# url_prefix -- so which module a route lives in is an organisational choice,
# not a routing one. The email-change endpoints genuinely belong beside the
# other OTP flows, and keeping /api/profile with them means the whole
# "self-service account" surface is one section of one file.
#
# WHAT THIS REPLACES
# ------------------
# POST /api/doctor/profile was the ONLY self-write in the entire API: doctor
# only, multipart only, `if value:` on every field (so nothing could be
# cleared), and it set users.email with no verification at all. A patient or an
# admin could not change so much as their own name. That route still exists for
# the clinic listing it owns, but it no longer touches the email address.
# ==========================================================================

EMAIL_CHANGE_SUBJECT = "Confirm Your New Email - SkinCare"

ERR_CURRENT_PASSWORD_WRONG = "Your current password is not correct."
ERR_PASSWORD_UNCHANGED = "Your new password must be different from your current one."
ERR_NO_PENDING_EMAIL = "No pending email change for this account."
ERR_EMAIL_TAKEN = "This email is already registered with another account."
ERR_EMAIL_PENDING_ELSEWHERE = (
    "That email address is already waiting to be confirmed on another account."
)
ERR_EMAIL_SAME = "That is already the email address on this account."
ERR_EMAIL_INVALID = "Please enter a valid email address."


def _profile_error(exc):
    """A profile_service.ProfileError -> the envelope, with the field to highlight.

    `data.field` is the whole reason these are typed: a settings form that gets
    back a bare string can show a toast, but it cannot put a red border on the
    box that is actually wrong.
    """
    return generate_response(
        False, error=exc.message, data={"field": exc.field} if exc.field else None,
        status_code=exc.status_code,
    )


def _looks_like_email(value):
    """Deliberately minimal. The real proof is that the OTP arrives."""
    text = str(value or "").strip()
    if not text or len(text) > 255 or " " in text:
        return False
    local, _, domain = text.partition("@")
    return bool(local) and bool(domain) and "." in domain and not domain.startswith(".")


def _pending_email_owner(db, address, exclude_user_id):
    """Another account already holding `address` as its pending_email, or None.

    Without this check two people can each park the same address, and whichever
    verifies second hits the users.email unique index as a 500 -- after their
    OTP has been consumed, so they cannot even retry.
    """
    from sqlalchemy import func

    return (
        db.query(models.User)
        .filter(
            func.lower(models.User.pending_email) == str(address).strip().lower(),
            models.User.id != exclude_user_id,
        )
        .first()
    )


# ==========================================================================
# C1. PROFILE -- read and partial write, every role
# ==========================================================================
@auth_bp.route('/api/profile', methods=['GET'])
@require_permission()
def profile_get():
    """GET -> the account, plus the doctor block when there is one.

    Same payload PATCH returns, so a client has exactly one parser. Reads the
    EFFECTIVE actor, so an admin using X-Act-As-User-Id sees the target's
    profile -- which is the point of impersonation support.
    """
    with session_scope() as db:
        user = _current_user_row(db)
        if user is None:
            return generate_response(False, error="User not found", status_code=404)
        return generate_response(True, data=profile_service.serialize(db, user),
                                 status_code=200)


@auth_bp.route('/api/profile', methods=['PATCH'])
@require_permission()
def profile_patch():
    """PATCH {name?, phone?, city?, date_of_birth?, gender?, doctor?{...}} -> the profile.

    PARTIAL: an absent key is untouched. AN EMPTY STRING CLEARS the field --
    the exact opposite of legacy POST /api/doctor/profile, which applied values
    `if value:` and therefore could not blank anything a user had deleted.

    `email` and `role` are 400s. Changing the address is changing who can log
    in, so it goes through /auth/email-change/request and an OTP delivered to
    the new inbox; a role is not self-service at any price.
    """
    payload = _json()

    with session_scope() as db:
        user = _current_user_row(db)
        if user is None:
            return generate_response(False, error="User not found", status_code=404)

        try:
            changed = profile_service.apply_patch(db, user, payload)
        except profile_service.ProfileError as exc:
            db.rollback()
            return _profile_error(exc)

        if changed:
            write_audit(
                db, "profile.update",
                actor_user_id=user.id, subject_user_id=user.id,
                target_type="user", target_id=user.id,
                detail=", ".join(changed)[:255],
            )
        db.flush()
        data = profile_service.serialize(db, user)
        db.commit()

    return generate_response(True, message="Profile updated.", data=data, status_code=200)


# ==========================================================================
# C2. AVATAR
# ==========================================================================
@auth_bp.route('/api/profile/avatar', methods=['GET'])
@require_permission()
def profile_avatar_get():
    """GET -> raw bytes of the caller's own avatar. 404 when there is none.

    The authenticated twin of `avatar_url`. Both are published because an <img>
    tag cannot send an Authorization header: a client that renders a plain
    <img> uses avatar_url (the deprecated but still-live static route), and a
    client that fetches into a blob uses this. 404, never 403 -- "you have no
    avatar" is not a permission problem.
    """
    with session_scope() as db:
        user = _current_user_row(db)
        if user is None:
            return generate_response(False, error="User not found", status_code=404)
        path = profile_service.avatar_path(user)

    if not path:
        return generate_response(False, error="No avatar", status_code=404)

    response = send_file(path, max_age=300, conditional=True)
    response.headers["Cache-Control"] = "private, max-age=300"
    return response


@auth_bp.route('/api/profile/avatar', methods=['POST'])
@require_permission()
def profile_avatar_post():
    """POST multipart field `avatar` -> {avatar_url, avatar_endpoint}.

    Type and size are checked BEFORE anything touches the disk. What is stored
    is never the uploaded file: it is a re-encoded JPEG no more than 512px on
    its longest side, which also strips the EXIF block and with it the GPS
    coordinates a phone writes into the photo somebody just made public.
    """
    file_storage = request.files.get('avatar')

    with session_scope() as db:
        user = _current_user_row(db)
        if user is None:
            return generate_response(False, error="User not found", status_code=404)

        try:
            profile_service.save_avatar(user, file_storage)
        except profile_service.ProfileError as exc:
            db.rollback()
            return _profile_error(exc)

        write_audit(
            db, "profile.avatar_upload",
            actor_user_id=user.id, subject_user_id=user.id,
            target_type="user", target_id=user.id,
        )
        data = profile_service.avatar_fields(user)
        db.commit()

    return generate_response(True, message="Photo updated.", data=data, status_code=200)


@auth_bp.route('/api/profile/avatar', methods=['DELETE'])
@require_permission()
def profile_avatar_delete():
    """DELETE -> {avatar_url: null}. Idempotent: 200 even with nothing to remove."""
    with session_scope() as db:
        user = _current_user_row(db)
        if user is None:
            return generate_response(False, error="User not found", status_code=404)

        removed = profile_service.delete_avatar(user)
        if removed:
            write_audit(
                db, "profile.avatar_delete",
                actor_user_id=user.id, subject_user_id=user.id,
                target_type="user", target_id=user.id,
            )
        data = profile_service.avatar_fields(user)
        db.commit()

    return generate_response(True, message="Photo removed.", data=data, status_code=200)


# ==========================================================================
# C3. CHANGE PASSWORD -- the caller knows the old one, so nobody is logged out
# ==========================================================================
@auth_bp.route('/auth/change-password', methods=['POST'])
@limit_by_ip("change_password_ip")
@require_permission()
def auth_change_password():
    """POST {current_password, new_password} -> 200, and you STAY LOGGED IN.

    THE SESSION RULE, AND WHY IT DIFFERS FROM /auth/reset-password
    -------------------------------------------------------------
    A reset happens because the account may be compromised: nobody proved they
    knew the old password, so every existing session is destroyed
    (`_apply_new_password` bumps token_version). Reusing that helper here would
    be a bug wearing the costume of a security feature -- it would sign the
    user out of the very page they are typing on, on every routine password
    change, for no gain: whoever is doing this ALREADY demonstrated knowledge
    of the current password.

    So token_version is deliberately left alone and `data.sessions_kept` says
    so. A user who does want their other devices gone has /auth/logout-all,
    one button away, and that is the operation that should end sessions.

    What this DOES do: re-hash, invalidate every outstanding OTP (a live signup
    or reset code must not survive a password change), audit, and email a
    heads-up to the address on file, because "your password was changed" is the
    notification that catches a takeover in progress.
    """
    data = _json()
    current_password = data.get('current_password') or data.get('old_password')
    new_password = data.get('new_password') or data.get('password')

    if not current_password:
        return generate_response(
            False, error="Your current password is required.",
            data={"field": "current_password"}, status_code=400,
        )
    if not new_password:
        return generate_response(
            False, error="Please choose a new password.",
            data={"field": "new_password"}, status_code=400,
        )

    with session_scope() as db:
        try:
            user = _current_user_row(db)
            if user is None:
                return generate_response(False, error="User not found", status_code=404)

            if not verify_password(user.password, current_password):
                logger.warning("Failed change-password attempt for user %s", user.id)
                return generate_response(
                    False, error=ERR_CURRENT_PASSWORD_WRONG,
                    data={"field": "current_password"}, status_code=401,
                )

            ok, why = validate_password(new_password)
            if not ok:
                return generate_response(
                    False, error=why, data={"field": "new_password"}, status_code=400,
                )

            if verify_password(user.password, new_password):
                return generate_response(
                    False, error=ERR_PASSWORD_UNCHANGED,
                    data={"field": "new_password"}, status_code=400,
                )

            user.password = hash_password(new_password)
            invalidate_otps(db, user.id)
            write_audit(
                db, "password.change",
                actor_user_id=user.id, subject_user_id=user.id,
                target_type="user", target_id=user.id,
                detail="sessions_kept=true",
            )
            recipient, display_name = user.email, user.name
            db.commit()

            send_email(
                recipient, "Your Password Was Changed - SkinCare",
                f"Hi {display_name},\n\nYour SkinCare password was just changed. "
                "If this was not you, reset your password immediately and end every "
                "other session from Settings.",
            )
            logger.info("Password changed in-session for user %s", recipient)
            return generate_response(
                True, message="Password updated.",
                data={"sessions_kept": True}, status_code=200,
            )
        except Exception as exc:
            db.rollback()
            logger.error("Change password error: %s", exc, exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


# ==========================================================================
# C4. EMAIL CHANGE -- request / verify / cancel
# ==========================================================================
@auth_bp.route('/auth/email-change/request', methods=['POST'])
@limit_by_ip("email_change_ip")
@require_permission()
def auth_email_change_request():
    """POST {new_email, current_password} -> {pending_email, resend_in_seconds}.

    THE CODE GOES TO THE NEW ADDRESS. That is not a detail, it is the whole
    mechanism: the only thing worth proving is that the person can read the
    inbox they are moving TO. Mailing the code to the current address would
    verify something nobody doubted and would let a hijacked session walk the
    account to an attacker's inbox unchallenged.

    users.pending_email holds the candidate until the code is redeemed, so the
    account never points at an unverified address -- login, password reset and
    every notification keep using the old one until the swap.
    """
    data = _json()
    new_email = str(data.get('new_email') or data.get('email') or '').strip()
    current_password = data.get('current_password') or data.get('password')

    if not new_email:
        return generate_response(
            False, error="Please enter the new email address.",
            data={"field": "new_email"}, status_code=400,
        )
    if not current_password:
        return generate_response(
            False, error="Your current password is required.",
            data={"field": "current_password"}, status_code=400,
        )
    if not _looks_like_email(new_email):
        return generate_response(
            False, error=ERR_EMAIL_INVALID, data={"field": "new_email"}, status_code=400,
        )

    with session_scope() as db:
        try:
            user = _current_user_row(db)
            if user is None:
                return generate_response(False, error="User not found", status_code=404)

            # Password FIRST, so the endpoint cannot be used as an
            # address-exists oracle by anyone holding a stolen access token.
            if not verify_password(user.password, current_password):
                logger.warning("Failed email-change attempt for user %s", user.id)
                return generate_response(
                    False, error=ERR_CURRENT_PASSWORD_WRONG,
                    data={"field": "current_password"}, status_code=401,
                )

            if new_email.lower() == str(user.email or '').lower():
                return generate_response(
                    False, error=ERR_EMAIL_SAME, data={"field": "new_email"},
                    status_code=400,
                )

            existing = find_user_by_email(db, new_email)
            if existing is not None and existing.id != user.id:
                return generate_response(
                    False, error=ERR_EMAIL_TAKEN, data={"field": "new_email"},
                    status_code=400,
                )

            if _pending_email_owner(db, new_email, user.id) is not None:
                return generate_response(
                    False, error=ERR_EMAIL_PENDING_ELSEWHERE,
                    data={"field": "new_email"}, status_code=400,
                )

            user.pending_email = new_email

            otp, otp_error = issue_otp(db, user, PURPOSE_EMAIL_CHANGE)
            if otp_error:
                db.rollback()
                return generate_response(False, error=otp_error, status_code=429)

            subject, body = _otp_email_for(PURPOSE_EMAIL_CHANGE, user, otp)
            if not send_email(new_email, subject, body):
                # Same rule the rest of this module follows: no database write
                # survives an email that never went out, or the account is left
                # holding a pending address whose code nobody can read.
                db.rollback()
                return generate_response(
                    False,
                    error="Failed to send OTP email. Please check server settings.",
                    status_code=500,
                )

            wait = resend_wait_seconds(db, user, PURPOSE_EMAIL_CHANGE)
            write_audit(
                db, "auth.email_change_request",
                actor_user_id=user.id, subject_user_id=user.id,
                target_type="user", target_id=user.id,
                detail=f"{user.email} -> {new_email}",
            )
            db.commit()

            logger.info("Email change requested for user %s", user.id)
            return generate_response(
                True,
                message="We sent a confirmation code to your new email address.",
                data={"pending_email": new_email, "resend_in_seconds": wait},
                status_code=200,
            )
        except IntegrityError:
            db.rollback()
            return generate_response(False, error=ERR_EMAIL_TAKEN, status_code=400)
        except Exception as exc:
            db.rollback()
            logger.error("Email change request error: %s", exc, exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


@auth_bp.route('/auth/email-change/verify', methods=['POST'])
@limit_by_ip("email_change_ip")
@require_permission()
def auth_email_change_verify():
    """POST {otp} -> {email}. Swaps pending_email in and clears it.

    The authenticated twin of `/auth/verify-otp` with purpose=email_change,
    which does the same swap for a client that still posts {email, otp,
    purpose}. Both write the SAME `auth.email_change` audit row, so the history
    does not depend on which door was used.
    """
    data = _json()
    code = data.get('otp') if data.get('otp') is not None else data.get('code')

    if code in (None, ""):
        return generate_response(
            False, error="Enter the code we emailed you.", data={"field": "otp"},
            status_code=400,
        )

    with session_scope() as db:
        try:
            user = _current_user_row(db)
            if user is None:
                return generate_response(False, error="User not found", status_code=404)

            if not user.pending_email:
                return generate_response(False, error=ERR_NO_PENDING_EMAIL, status_code=400)

            ok, err = verify_purpose_otp(db, user, PURPOSE_EMAIL_CHANGE, code)
            if not ok:
                db.commit()  # keep the attempt increment
                return generate_response(
                    False, error=err, data={"field": "otp"}, status_code=400,
                )

            candidate = user.pending_email
            # Re-check at the last possible moment: the address was free when
            # the code was issued, and up to ten minutes have passed since.
            taken = find_user_by_email(db, candidate)
            if taken is not None and taken.id != user.id:
                user.pending_email = None
                db.commit()
                return generate_response(False, error=ERR_EMAIL_TAKEN, status_code=400)

            previous = user.email
            user.email = candidate
            user.pending_email = None
            user.is_verified = True

            write_audit(
                db, "auth.email_change",
                actor_user_id=user.id, subject_user_id=user.id,
                target_type="user", target_id=user.id,
                detail=f"{previous} -> {candidate}",
            )
            display_name = user.name
            db.commit()

            # The OLD address is the one that needs to hear about this: it is
            # the inbox that is losing control of the account.
            send_email(
                previous, "Your Email Address Was Changed - SkinCare",
                f"Hi {display_name},\n\nThe email address on your SkinCare account was "
                f"changed to {candidate}. If this was not you, contact support "
                "immediately.",
            )
            logger.info("Email changed for user (was %s)", previous)
            return generate_response(
                True, message="Email address updated.",
                data={"email": candidate}, status_code=200,
            )
        except IntegrityError:
            db.rollback()
            return generate_response(False, error=ERR_EMAIL_TAKEN, status_code=400)
        except Exception as exc:
            db.rollback()
            logger.error("Email change verify error: %s", exc, exc_info=True)
            return generate_response(False, error="Internal server error", status_code=500)


@auth_bp.route('/auth/email-change/cancel', methods=['POST'])
@require_permission()
def auth_email_change_cancel():
    """POST -> {pending_email: null}. Idempotent.

    Consumes the outstanding email_change codes too. Leaving them live would
    mean an abandoned change could still be completed later by anyone who read
    that mail, long after the user decided against it.
    """
    with session_scope() as db:
        user = _current_user_row(db)
        if user is None:
            return generate_response(False, error="User not found", status_code=404)

        had_pending = bool(user.pending_email)
        user.pending_email = None
        invalidate_otps(db, user.id, purpose=PURPOSE_EMAIL_CHANGE)
        if had_pending:
            write_audit(
                db, "auth.email_change_cancel",
                actor_user_id=user.id, subject_user_id=user.id,
                target_type="user", target_id=user.id,
            )
        db.commit()

    return generate_response(
        True, message="Email change cancelled.",
        data={"pending_email": None, "cancelled": had_pending}, status_code=200,
    )


__all__ = ["auth_bp"]
