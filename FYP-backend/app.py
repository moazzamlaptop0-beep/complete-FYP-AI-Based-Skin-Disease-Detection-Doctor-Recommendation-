# app.py
from flask import Flask, request, jsonify, send_from_directory, Response
from flask_cors import CORS
import test_model  
import os
import random
import smtplib
from email.mime.text import MIMEText
from datetime import datetime, timedelta, date
from sqlalchemy.exc import IntegrityError
import jwt
from functools import wraps
import google.generativeai as genai
import json
import time
import logging
import uuid
import atexit
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash
from apscheduler.schedulers.background import BackgroundScheduler

from dotenv import load_dotenv
load_dotenv()

from database import engine, SessionLocal
import models

# Initialize Database
models.Base.metadata.create_all(bind=engine)

app = Flask(__name__)
CORS(app)

app.config['SECRET_KEY'] = os.environ.get("JWT_SECRET", "AI_Derma_Super_Secret_Key_9988_Strong_And_Secure_2026")
UPLOAD_FOLDER = 'static/uploads'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
app.config['MAX_CONTENT_LENGTH'] = 10 * 1024 * 1024  # 10 MB limit for security

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}

# ==========================================
# LOGGING CONFIGURATION (TASK 18)
# ==========================================
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# ==========================================
# UTILITY FUNCTIONS
# ==========================================
def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def generate_response(success, message="", error="", data=None, status_code=200):
    """Consistent API Response format (TASK 17)"""
    res = {"success": success}
    if message:
        res["message"] = message
    if error:
        res["error"] = error
    if data is not None:
        res["data"] = data
    return jsonify(res), status_code

def sort_appointments_by_priority(appointments, severity_by_scan_id=None):
    """
    Doctor Dashboard me actionable appointments (Scheduled/Confirmed) hamesha
    upar rahein, phir Completed, phir Cancelled sabse neeche - date kitni bhi
    purani/nayi ho. Input list already date-desc order me honi chahiye
    (sorted() stable hai, isliye har status-group ke andar wo order preserve
    rehta hai).

    Pending-Conflict wale appointments sabse upar aate hain (doctor ka action
    chahiye) - unke andar bhi zyada severe scan wala pehle. severity_by_scan_id
    optional hai (scan_id -> severity_level dict) taake conflict group ke andar
    CRITICAL/URGENT pehle dikhein.
    """
    priority = {"Pending-Conflict": 0, "Scheduled": 1, "Confirmed": 1, "Completed": 2, "Reassigned": 2, "Cancelled": 3}
    severity_by_scan_id = severity_by_scan_id or {}

    def sort_key(a):
        status_rank = priority.get(a.status, 2)
        severity = severity_by_scan_id.get(a.scan_id, "ROUTINE")
        severity_rank = TriageService.TIER_RANK.get(severity, 0)
        # severity_rank ulta karo (CRITICAL=2 pehle aana chahiye, isliye negative)
        return (status_rank, -severity_rank)

    return sorted(appointments, key=sort_key)

# ==========================================
# SECURITY DECORATORS (LOCKS) (TASK 11)
# ==========================================
def get_token_data(req):
    auth_header = req.headers.get('Authorization')
    if auth_header and auth_header.startswith('Bearer '):
        return auth_header.split(" ")[1]
    return None

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = get_token_data(request)
        if not token:
            return generate_response(False, error="Token is missing! Unauthorized access.", status_code=401)
            
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            request.current_user = data
        except jwt.ExpiredSignatureError:
            return generate_response(False, error="Session expired! Please login again.", status_code=401)
        except jwt.InvalidTokenError:
            return generate_response(False, error="Invalid Token!", status_code=401)
            
        return f(*args, **kwargs)
    return decorated

def token_optional(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = get_token_data(request)
        request.current_user = None
        if token:
            try:
                data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
                request.current_user = data
            except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
                pass
        return f(*args, **kwargs)
    return decorated

def admin_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = get_token_data(request)
        if not token:
            return generate_response(False, error="Token is missing! Unauthorized access.", status_code=401)
            
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            if data.get('role') != 'Admin':
                logger.warning(f"Unauthorized Admin access attempt by user {data.get('user_id')}")
                return generate_response(False, error="Access denied! Only Admins allowed.", status_code=403)
            request.current_user = data
        except jwt.ExpiredSignatureError:
            return generate_response(False, error="Session expired! Please login again.", status_code=401)
        except jwt.InvalidTokenError:
            return generate_response(False, error="Invalid Token!", status_code=401)
            
        return f(*args, **kwargs)
    return decorated

def doctor_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = get_token_data(request)
        if not token:
            return generate_response(False, error="Token is missing! Unauthorized access.", status_code=401)
            
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            if data.get('role') != 'Doctor':
                logger.warning(f"Unauthorized Doctor access attempt by user {data.get('user_id')}")
                return generate_response(False, error="Access denied! Only Doctors allowed.", status_code=403)
            request.current_user = data
        except jwt.ExpiredSignatureError:
            return generate_response(False, error="Session expired! Please login again.", status_code=401)
        except jwt.InvalidTokenError:
            return generate_response(False, error="Invalid Token!", status_code=401)
            
        return f(*args, **kwargs)
    return decorated

def patient_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        token = get_token_data(request)
        if not token:
            return generate_response(False, error="Token is missing! Unauthorized access.", status_code=401)
            
        try:
            data = jwt.decode(token, app.config['SECRET_KEY'], algorithms=["HS256"])
            if data.get('role') not in ['AI User', 'Patient']:
                logger.warning(f"Unauthorized Patient access attempt by user {data.get('user_id')}")
                return generate_response(False, error="Access denied! Only Patients allowed.", status_code=403)
            request.current_user = data
        except jwt.ExpiredSignatureError:
            return generate_response(False, error="Session expired! Please login again.", status_code=401)
        except jwt.InvalidTokenError:
            return generate_response(False, error="Invalid Token!", status_code=401)
            
        return f(*args, **kwargs)
    return decorated


# ==========================================
# EMAIL HELPER FUNCTION
# ==========================================
def send_email(to_email, subject, body):
    sender = os.environ.get("EMAIL_USER")
    password = os.environ.get("EMAIL_PASS")
    
    if not sender or not password:
        logger.error("Email credentials missing in environment variables.")
        return False

    msg = MIMEText(body)
    msg['Subject'] = subject
    msg['From'] = sender
    msg['To'] = to_email

    try:
        with smtplib.SMTP_SSL('smtp.gmail.com', 465) as server:
            server.login(sender, password)
            server.sendmail(sender, [to_email], msg.as_string())
        logger.info(f"Email sent successfully to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Email Error to {to_email}: {e}")
        return False

# ==========================================
# 0. STATIC IMAGE SERVING
# ==========================================
@app.route('/static/uploads/<path:filename>')
def serve_uploaded_file(filename):
    # Prevent path traversal
    if '..' in filename or filename.startswith('/'):
        return generate_response(False, error="Invalid filename", status_code=400)
    return send_from_directory(app.config['UPLOAD_FOLDER'], filename)

# ==========================================
# 1. AUTH ROUTES
# ==========================================
OTP_EXPIRY_MINUTES = 10   # OTP is ke baad invalid ho jayega
OTP_MAX_ATTEMPTS = 5      # Itni galat tries ke baad OTP lock ho jata hai, naya OTP mangwana padega

def _is_otp_valid(user, submitted_otp):
    """
    Shared OTP check: matching code, expiry, aur attempt-limit teeno verify
    karta hai. Returns (is_valid: bool, error_message: str|None).
    Caller khud attempts increment/reset aur commit karega.
    """
    if not user.otp_code:
        return False, "No active OTP. Please request a new one."

    if (user.otp_attempts or 0) >= OTP_MAX_ATTEMPTS:
        return False, "Too many incorrect attempts. Please request a new OTP."

    if not user.otp_created_at:
        # Purane rows jinme otp_created_at set nahi - fail-safe treat as expired,
        # naya OTP mangwao
        return False, "OTP expired. Please request a new one."

    expires_at = user.otp_created_at + timedelta(minutes=OTP_EXPIRY_MINUTES)
    if datetime.utcnow() > expires_at:
        return False, "OTP has expired. Please request a new one."

    if user.otp_code != str(submitted_otp):
        return False, "Invalid OTP"

    return True, None

@app.route('/register', methods=['POST'])
def register():
    data = request.get_json()
    if not data or not all(k in data for k in ('name', 'email', 'password')):
        return generate_response(False, error="Missing required fields", status_code=400)

    db = SessionLocal()
    try:
        user_exists = db.query(models.User).filter(models.User.email == data['email']).first()
        if user_exists:
            return generate_response(False, error="Email already exists", status_code=400)

        otp = str(random.randint(100000, 999999))

        # SECURITY: role kabhi bhi client se blindly accept nahi karte.
        # Sirf ye do roles hi public /register se banwaye ja sakte hain.
        # 'Admin' is route se kabhi nahi banega, chahe request body me kuch bhi bheja jaye.
        ALLOWED_SIGNUP_ROLES = ('AI User', 'Doctor')
        requested_role = data.get('role', 'AI User')
        final_role = requested_role if requested_role in ALLOWED_SIGNUP_ROLES else 'AI User'
        if requested_role not in ALLOWED_SIGNUP_ROLES:
            logger.warning(f"Blocked registration attempt with disallowed role '{requested_role}' for email {data.get('email')}")

        license_number = str(data.get('license') or '').strip()

        # Doctor validation UPFRONT — koi bhi DB row banane se PEHLE. Isse license
        # missing/duplicate hone par ghost User row nahi banti (BUG FIX: pehle
        # user commit ho jata tha, phir license duplicate error aane par sirf
        # profile ka rollback hota tha, User row permanently reh jati thi aur
        # agla attempt "Email already exists" deta tha).
        if final_role == 'Doctor':
            if not license_number:
                return generate_response(False, error="PMDC license number is required for doctor registration", status_code=400)

            license_exists = db.query(models.DoctorProfile).filter(
                models.DoctorProfile.license == license_number
            ).first()
            if license_exists:
                return generate_response(False, error="This license number is already registered.", status_code=400)

        # User + (agar Doctor hai to) Profile banao — sirf flush(), commit NAHI.
        # Jab tak OTP email successfully nahi chali jati, kuch bhi DB mein
        # permanently nahi jayega. Poori registration ek hi atomic transaction hai.
        new_user = models.User(
            name=data['name'], 
            email=data['email'], 
            password=generate_password_hash(data['password']),
            role=final_role,
            is_verified=False,  
            otp_code=otp,
            otp_created_at=datetime.utcnow(),
            otp_attempts=0
        )
        db.add(new_user)
        db.flush()  # id chahiye DoctorProfile ke FK ke liye — DB commit abhi nahi hua

        if final_role == 'Doctor':
            profile = models.DoctorProfile(
                user_id=new_user.id, 
                specialty=data.get('specialty'),
                hospital=data.get('hospital'), 
                city=data.get('city'), 
                phone=data.get('phone'),
                license=license_number,
                latitude=data.get('latitude'),   
                longitude=data.get('longitude'),
                verification_status='pending'  # Admin license check hone tak pending
            )
            db.add(profile)
            db.flush()

        # OTP email — ye fail ho to poora rollback, koi row nahi bachni chahiye
        email_body = f"Hi {new_user.name},\n\nWelcome to SkinCare! Your verification code is: {otp}\n\nPlease verify your account to continue."
        email_sent = send_email(new_user.email, "Verify Your Account - SkinCare", email_body)

        if not email_sent:
            db.rollback() 
            return generate_response(False, error="Failed to send OTP email. Please check server settings.", status_code=500)

        # Sab theek — ab sirf ek hi commit, sab kuch atomic
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
    finally:
        db.close()

@app.route('/verify-otp-email', methods=['POST'])
def verify_otp():
    data = request.get_json()
    if not data or 'email' not in data or 'otp' not in data:
        return generate_response(False, error="Email and OTP required", status_code=400)

    db = SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.email == data['email']).first()
        if not user:
            return generate_response(False, error="User not found", status_code=404)

        is_valid, err = _is_otp_valid(user, data.get('otp'))
        if is_valid:
            user.is_verified = True
            user.otp_code = None
            user.otp_created_at = None
            user.otp_attempts = 0
            db.commit()
            
            send_email(user.email, "Account Verified!", f"Welcome {user.name}, your account is now active.")
            logger.info(f"User email verified: {user.email}")
            return generate_response(True, message="Email verified successfully", status_code=200)
        else:
            # Attempt count sirf tab badhao jab ek active OTP maujood ho - agar
            # koi OTP hi nahi ya already lock ho chuka hai to counter ko
            # meaninglessly badhane ka koi fayda nahi
            if user.otp_code:
                user.otp_attempts = (user.otp_attempts or 0) + 1
                db.commit()
            return generate_response(False, error=err, status_code=400)
    except Exception as e:
        db.rollback()
        logger.error(f"Verify OTP Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()

OTP_RESEND_COOLDOWN_SECONDS = 45  # Spam-click / abuse se bachne ke liye minimum gap do resends ke beech

@app.route('/resend-otp', methods=['POST'])
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

    db = SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.email == email).first()
        if not user:
            return generate_response(False, error="This email is not registered with us.", status_code=404)

        if user.is_verified:
            return generate_response(False, error="This account is already verified. Please login.", status_code=400)

        # Cooldown: turant dobara-dobara resend spam na ho sake
        if user.otp_created_at:
            seconds_since_last = (datetime.utcnow() - user.otp_created_at).total_seconds()
            if seconds_since_last < OTP_RESEND_COOLDOWN_SECONDS:
                wait_more = int(OTP_RESEND_COOLDOWN_SECONDS - seconds_since_last)
                return generate_response(False, error=f"Please wait {wait_more}s before requesting another OTP.", status_code=429)

        otp = str(random.randint(100000, 999999))
        email_body = f"Hi {user.name},\n\nYour new verification code is: {otp}\n\nPlease verify your account to continue."
        email_sent = send_email(user.email, "Your New Verification Code - SkinCare", email_body)

        if not email_sent:
            return generate_response(False, error="Failed to send OTP email. Please check server settings.", status_code=500)

        # BUG FIX pattern (same as forgot-password): DB sirf tab update hoti
        # hai jab email confirm successfully chali gayi ho, warna purana valid
        # OTP silently invalidate ho sakta tha bina naya deliver hue.
        user.otp_code = otp
        user.otp_created_at = datetime.utcnow()
        user.otp_attempts = 0
        db.commit()

        logger.info(f"OTP resent to: {user.email}")
        return generate_response(True, message="A new OTP has been sent to your email.", status_code=200)
    except Exception as e:
        db.rollback()
        logger.error(f"Resend OTP Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()

@app.route('/login', methods=['POST'])
def login():
    data = request.get_json()
    if not data or not all(k in data for k in ('email', 'password')):
        return generate_response(False, error="Missing required credentials", status_code=400)

    db = SessionLocal()
    try:
        # SECURITY: password ab hash compare hota hai, DB query me raw match nahi.
        user = db.query(models.User).filter(models.User.email == data['email']).first()

        password_ok = bool(user) and check_password_hash(user.password, data['password'])

        if user and password_ok and user.role == data.get('role'):
            if not user.is_verified:
                return generate_response(False, error="Please verify your email first", status_code=403)

            token = jwt.encode({
                'user_id': user.id,
                'role': user.role,
                'exp': datetime.utcnow() + timedelta(hours=24)
            }, app.config['SECRET_KEY'], algorithm="HS256")

            join_date = user.created_at.strftime("%b %Y") if user.created_at else "Jan 2024"

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
    finally:
        db.close()

@app.route('/forgot-password', methods=['POST'])
def forgot_password():
    data = request.get_json()
    email = data.get('email')
    
    if not email:
        return generate_response(False, error="Email is required!", status_code=400)
        
    db = SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.email == email).first()
        if not user:
            return generate_response(False, error="This email is not registered with us.", status_code=404)
            
        otp = str(random.randint(100000, 999999))
        email_body = f"Hi {user.name},\n\nYou requested a password reset. Your OTP code is: {otp}\n\nIf you did not request this, please ignore this email safely."
        email_sent = send_email(user.email, "Reset Your Password - SkinCare", email_body)

        if not email_sent:
            return generate_response(False, error="Failed to send OTP email. Please check server SMTP settings.", status_code=500)

        # BUG FIX: pehle otp_code commit hota tha email bhejne SE PEHLE — agar
        # email fail ho jaye (SMTP hiccup, double-click, etc.) to koi purana
        # valid OTP bhi silently overwrite/invalidate ho jata tha, bina kisi
        # naye OTP ke deliver hue. Ab DB sirf tab update hoti hai jab email
        # confirm successfully chali gayi ho.
        user.otp_code = otp
        user.otp_created_at = datetime.utcnow()
        user.otp_attempts = 0
        db.commit()

        logger.info(f"Password reset OTP sent to: {user.email}")
        return generate_response(True, message="Password reset OTP sent to your email.", status_code=200)
    except Exception as e:
        db.rollback()
        logger.error(f"Forgot Password Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()

@app.route('/reset-password', methods=['POST'])
def reset_password():
    data = request.get_json()
    email = data.get('email')
    otp = data.get('otp')
    new_password = data.get('new_password')
    
    if not all([email, otp, new_password]):
        return generate_response(False, error="Email, OTP, and New Password are required fields.", status_code=400)
        
    db = SessionLocal()
    try:
        user = db.query(models.User).filter(models.User.email == email).first()
        if not user:
            return generate_response(False, error="User not found.", status_code=404)

        is_valid, err = _is_otp_valid(user, otp)
        if not is_valid:
            if user.otp_code:
                user.otp_attempts = (user.otp_attempts or 0) + 1
                db.commit()
            return generate_response(False, error=err or "Invalid or expired OTP code.", status_code=400)

        user.password = generate_password_hash(new_password)
        # BUG FIX: pehle ye function sirf password/OTP fields clear karta tha,
        # is_verified ko kabhi touch nahi karta tha. Agar koi user OTP-verify
        # screen chhod kar phas gaya ho (na dobara register kar sakta tha, na
        # login), to forgot-password flow se OTP le kar password reset to ho
        # jata tha lekin is_verified False hi reh jati - login phir bhi
        # "verify your email first" pe atak jata. Ab reset-password successful
        # hone par account ko bhi verified maan lete hain (proven wahi hai jo
        # us email ka OTP receive kar sakta hai), taake stuck accounts bach sakein.
        user.is_verified = True
        user.otp_code = None
        user.otp_created_at = None
        user.otp_attempts = 0
        db.commit()
        
        send_email(user.email, "Password Reset Successful", f"Hi {user.name},\n\nYour password has been changed successfully. You can now login to SkinCare with your new password.")
        logger.info(f"Password reset successful for: {user.email}")
        return generate_response(True, message="Password updated successfully!", status_code=200)
    except Exception as e:
        db.rollback()
        logger.error(f"Reset Password Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()


# ==========================================
# 2. AI PREDICTION & SCAN SAVING 
# ==========================================
@app.route('/predict', methods=['POST'])
@patient_required
def predict():
    if 'image' not in request.files:
        return generate_response(False, error="No image uploaded", status_code=400)
        
    file = request.files['image']
    if file.filename == '' or not allowed_file(file.filename):
        return generate_response(False, error="Invalid file type or no file selected", status_code=400)
        
    user_id_raw = request.form.get('user_id') 
    
    os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
    # Secure filename creation
    secure_name = secure_filename(file.filename)
    unique_filename = f"scan_{uuid.uuid4().hex}_{secure_name}"
    full_path = os.path.join(app.config['UPLOAD_FOLDER'], unique_filename)
    file.save(full_path)
    
    result, raw_confidence = test_model.predict_skin_disease(full_path) 
    db_image_url = f"static/uploads/{unique_filename}"
    
    try:
        conf_val = float(raw_confidence)
        if conf_val > 100:
            conf_val = conf_val / 100
        elif conf_val <= 1.0 and conf_val > 0:
            conf_val = conf_val * 100
        final_confidence = round(max(0.0, min(100.0, conf_val)), 2)
    except (ValueError, TypeError):
        final_confidence = 0.0

    db = SessionLocal()
    try:
        final_user_id = None
        if user_id_raw and str(user_id_raw).lower() not in ["null", "undefined", ""]:
            try:
                final_user_id = int(user_id_raw)
            except ValueError:
                return generate_response(False, error="Invalid user ID format", status_code=400)
                
        # Validate IDOR (User can only upload for themselves)
        if final_user_id and request.current_user.get('user_id') != final_user_id:
             return generate_response(False, error="Unauthorized user ID mismatch", status_code=403)

        new_scan = models.AIScan(
            image_url=db_image_url,
            prediction_result=result,
            confidence=final_confidence, 
            user_id=final_user_id,
            status="Local",
            doctor_id=None
        )
        db.add(new_scan)
        db.commit()
        db.refresh(new_scan)
        
        logger.info(f"New prediction generated for user {final_user_id}: {result}")
        return generate_response(True, data={
            "scan_id": new_scan.id,
            "disease": result,
            "confidence": final_confidence, 
            "image_url": db_image_url
        }, status_code=201)
    except Exception as e:
        db.rollback()
        logger.error(f"Predict Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()


# ==========================================
# CLINICAL TRIAGE & SEVERITY ENGINE
# ==========================================
class TriageService:
    # Fixed disease -> tier map. Direct lookup against main.py's CLASS_NAMES --
    # no substring guessing, so a renamed class can't silently misfire.
    # NOTE: tier assignments below are a starting point for the system design --
    # get a dermatologist/clinical advisor to review this list before production.
    DISEASE_TIER = {
        "Actinic Keratosis Basal Cell Carcinoma and other Malignant Lesions": "CRITICAL",
        "Melanoma Skin Cancer Nevi and Moles": "CRITICAL",
        "Cellulitis Impetigo and other Bacterial Infections": "URGENT",
        "Bullous Disease Photos": "URGENT",
        "Lupus and other Connective Tissue diseases": "URGENT",
        "Systemic Disease": "URGENT",
        "Vasculitis Photos": "URGENT",
        "Scabies Lyme Disease and other Infestations and Bites": "URGENT",
        "Herpes HPV and other STDs Photos": "URGENT",
        "Exanthems and Drug Eruptions": "URGENT",
    }

    # Keys MUST match PreReportQuestionnaireModal.jsx's payload exactly --
    # this is the fix for the bug where the questionnaire was being ignored.
    SYMPTOM_WEIGHTS = {
        'is_bleeding': 3,
        'growing_fast': 3,
        'has_severe_pain': 2,
        'irregular_border': 2,
        'color_change': 2,
        'diameter_over_6mm': 1
    }

    TIER_RANK = {'ROUTINE': 0, 'URGENT': 1, 'CRITICAL': 2}
    CONFIDENCE_THRESHOLD = 0.60  # below this, don't auto-trust a high-risk AI call

    @staticmethod
    def evaluate_urgency(disease_name, answers, ai_confidence=0.85):
        reasons = []

        # 1. Disease-based tier
        disease_tier = TriageService.DISEASE_TIER.get(disease_name, 'ROUTINE')

        if disease_tier != 'ROUTINE' and ai_confidence < TriageService.CONFIDENCE_THRESHOLD:
            reasons.append(
                f"AI predicted {disease_name} but confidence "
                f"({ai_confidence*100:.0f}%) is below {int(TriageService.CONFIDENCE_THRESHOLD*100)}% "
                f"-- flagged for human review instead of auto-escalating"
            )
            disease_tier = 'ROUTINE'
        elif disease_tier != 'ROUTINE':
            reasons.append(f"AI predicted {disease_name} ({ai_confidence*100:.0f}% confidence)")

        # 2. Symptom-based tier from patient questionnaire (escalate-only, capped at URGENT --
        # patient self-report alone should never be able to trigger CRITICAL)
        symptom_score = 0
        triggered = []
        if answers:
            for key, weight in TriageService.SYMPTOM_WEIGHTS.items():
                if answers.get(key):
                    symptom_score += weight
                    triggered.append(key.replace('_', ' '))

        symptom_tier = 'URGENT' if symptom_score >= 5 else 'ROUTINE'
        if triggered:
            reasons.append(f"Patient reported: {', '.join(triggered)}")

        # 3. Combine -- escalate only, never de-escalate
        final_severity = max(disease_tier, symptom_tier, key=lambda t: TriageService.TIER_RANK[t])

        if not reasons:
            reasons.append("No high-risk indicators detected")

        return {
            "severity": final_severity,
            "triage_score": symptom_score,
            "triage_reasons": reasons,
            "is_emergency": final_severity in ['CRITICAL', 'URGENT']
        }

# ==========================================
# 3. REPORT SENDING 
# ==========================================
@app.route('/send_report', methods=['POST'])
@patient_required
def send_report():
    data = request.get_json()
    if not data:
        return generate_response(False, error="Invalid JSON payload", status_code=400)
        
    scan_id = data.get('scan_id')
    doctor_id = data.get('doctor_id')
    answers = data.get('answers')

    if not scan_id or not doctor_id:
        return generate_response(False, error="Scan ID or Doctor ID missing", status_code=400)

    db = SessionLocal()
    try:
        scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
        if not scan:
            return generate_response(False, error="Scan not found", status_code=404)
            
        # Security: Patient can only send their own scans
        if scan.user_id != request.current_user.get('user_id'):
            return generate_response(False, error="Unauthorized to send this report", status_code=403)

        doctor = db.query(models.User).filter(models.User.id == doctor_id, models.User.role == 'Doctor').first()
        if not doctor:
            return generate_response(False, error="Doctor not found", status_code=404)

        patient = db.query(models.User).filter(models.User.id == scan.user_id).first()
        patient_name = patient.name if patient else "Guest Patient"

        # Trust the DB, not the request body -- these were set at scan time,
        # so a patient's browser can't manipulate its own confidence/disease name.
        disease_name = scan.prediction_result or 'Skin Condition'
        ai_confidence = scan.confidence if scan.confidence is not None else 0.85

        triage_result = TriageService.evaluate_urgency(disease_name, answers, ai_confidence)
        
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
    finally:
        db.close()


# ==========================================
# 3a. SCAN REPORT STATUS (source of truth for "already sent" lock)
# ==========================================
# BUG FIX: frontend ka "Report Already Sent" lock pehle sirf localStorage
# (`sent_report_<scanId>`) pe based tha. scan_id sirf ek DB-wide auto-increment
# integer hai, kisi user/session ke liye reserved nahi - agar dev/test ke
# dauran DB reset ho (tables recreate, fresh install), to naya account ka
# bilkul pehla scan bhi purana id reuse kar leta hai (wapis id=1 se shuru).
# Usi browser mein baitha purana `sent_report_1=true` phir is naye, kabhi
# report-bheja-hi-nahi scan ko galat "already sent" dikha deta tha. Backend
# hi is state ka asli source-of-truth hona chahiye - frontend ab yahan se
# check karta hai ke is scan pe doctor_id set hai ya nahi.
@app.route('/api/scans/<int:scan_id>/report-status', methods=['GET'])
@patient_required
def get_scan_report_status(scan_id):
    db = SessionLocal()
    try:
        scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
        if not scan:
            return generate_response(False, error="Scan not found", status_code=404)

        if scan.user_id != request.current_user.get('user_id'):
            return generate_response(False, error="Unauthorized access to this scan", status_code=403)

        return generate_response(True, data={
            "report_sent": scan.doctor_id is not None
        }, status_code=200)
    except Exception as e:
        logger.error(f"Get Scan Report Status Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()


# ==========================================
# 3b. DOCTOR SEVERITY OVERRIDE (audited)
# ==========================================
@app.route('/api/override-severity/<int:scan_id>', methods=['POST'])
@doctor_required
def override_severity(scan_id):
    data = request.get_json()
    if not data or not data.get('severity') or not data.get('reason'):
        return generate_response(False, error="Severity and reason are required", status_code=400)

    if data['severity'] not in ('ROUTINE', 'URGENT', 'CRITICAL'):
        return generate_response(False, error="Invalid severity value", status_code=400)

    db = SessionLocal()
    try:
        scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
        if not scan:
            return generate_response(False, error="Scan not found", status_code=404)
        if scan.doctor_id != request.current_user.get('user_id'):
            return generate_response(False, error="Unauthorized", status_code=403)

        scan.severity_level = data['severity']
        scan.overridden_by = request.current_user.get('user_id')
        scan.override_reason = data['reason']
        scan.overridden_at = datetime.utcnow()
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
    finally:
        db.close()


# ==========================================
# 4. DOCTOR UPDATE (TASK 1, 9, 11)
# ==========================================
@app.route('/doctor/update_scan/<int:scan_id>', methods=['PUT'])
@doctor_required
def update_scan(scan_id):
    data = request.get_json()
    if not data:
        return generate_response(False, error="Invalid JSON data", status_code=400)
        
    db = SessionLocal()
    try:
        scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
        if not scan:
            return generate_response(False, error="Scan not found", status_code=404)
            
        # Security: Doctor can only update scans assigned to them
        current_doctor_id = request.current_user.get('user_id')
        if scan.doctor_id and scan.doctor_id != current_doctor_id:
            return generate_response(False, error="Unauthorized to update this scan", status_code=403)
            
        scan.doctor_comment = (
            data.get("comment")
            or data.get("doctor_comment")
            or scan.doctor_comment
        )
        scan.status = "Reviewed"
        scan.review_status = "Reviewed"
        scan.invite_to_clinic = data.get('invite_to_clinic', scan.invite_to_clinic)

        # Update timestamps/status info mapping
        scan.updated_at = datetime.utcnow()

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
        return jsonify(scan_data), 200 # Returning specific dict structure as per frontend requirements
    except Exception as e:
        db.rollback()
        logger.error(f"Update Scan Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()


# ==========================================
# 4B. DOCTOR DELETE SCAN (TASK 3, 11)
# ==========================================
@app.route('/doctor/delete_scan/<int:scan_id>', methods=['DELETE'])
@doctor_required
def delete_scan(scan_id):
    db = SessionLocal()
    try:
        current_doctor_id = request.current_user.get('user_id')

        scan = db.query(models.AIScan).filter(models.AIScan.id == scan_id).first()
        if not scan:
            return generate_response(False, error="Scan not found", status_code=404)
            
        if scan.doctor_id and scan.doctor_id != current_doctor_id:
            return generate_response(False, error="Unauthorized to delete this scan", status_code=403)

        db.query(models.DoctorRating).filter(
            models.DoctorRating.scan_id == scan_id
        ).update({"scan_id": None})
        db.query(models.Appointment).filter(
            models.Appointment.scan_id == scan_id
        ).update({"scan_id": None})

        if scan.image_url:
            try:
                if os.path.exists(scan.image_url):
                    os.remove(scan.image_url)
            except OSError as file_err:
                logger.warning(f"Scan image file delete failed: {file_err}")

        db.delete(scan)
        db.commit()
        logger.info(f"Scan {scan_id} deleted by Doctor {current_doctor_id}")
        return generate_response(True, message="Scan deleted from history", status_code=200)
    except Exception as e:
        db.rollback()
        logger.error(f"Delete Scan Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()


# ==========================================
# 5. PATIENT HISTORY & DOCTOR DASHBOARD (TASK 9, 10, 16)
# ==========================================
@app.route('/patient/scans/<int:user_id>', methods=['GET'])
@patient_required
def get_patient_history(user_id):
    # Security: Patient can only view their own history
    if request.current_user.get('user_id') != user_id:
        return generate_response(False, error="Unauthorized access to patient data", status_code=403)

    db = SessionLocal()
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

            scan_list.append({
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
            })
        return generate_response(True, data=scan_list, status_code=200)
    except Exception as e:
        logger.error(f"Get Patient History Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()

@app.route('/doctor/scans/<int:doctor_id>', methods=['GET'])
@doctor_required
def get_doctor_scans(doctor_id):
    # Security check
    if request.current_user.get('user_id') != doctor_id:
        return generate_response(False, error="Unauthorized to access these scans", status_code=403)

    db = SessionLocal()
    try:
        query = db.query(models.AIScan).filter(models.AIScan.doctor_id == doctor_id)
        
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

            scan_list.append({
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
                "invite_to_clinic": scan.invite_to_clinic,
                "image_url": "/" + scan.image_url if scan.image_url else "",
                "created_at": scan.created_at.isoformat() if scan.created_at else None,
                "updated_at": scan.updated_at.isoformat() if hasattr(scan, 'updated_at') and scan.updated_at else None,
                "patient_rating": rating_record.rating if rating_record else None,
                "patient_review": rating_record.review if rating_record else None
            })
        return generate_response(True, data=scan_list, status_code=200)
    except Exception as e:
        logger.error(f"Get Doctor Scans Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()


# ==========================================
# 6. STATS & DOCTORS LIST
# ==========================================
@app.route('/api/doctors/public', methods=['GET'])
def get_public_doctors():
    db = SessionLocal()
    try:
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
            # (admin ne already fake/invalid mark kiya hai) — pending doctors abhi bhi
            # dikhte hain, sirf "Pending Verification" badge ke saath.
            if getattr(profile, 'verification_status', 'pending') == 'rejected':
                continue

            doc_ratings = ratings_dict.get(doc.id, [])
            # BUG FIX: pehle koi rating na hone par 5.0 (fake perfect score) return
            # hota tha — patient ko lagta "5 star rated" jabke doctor ko koi review
            # mila hi nahi. Ab None bhejte hain, frontend "New" badge dikhata hai.
            avg_rating = round(sum(r.rating for r in doc_ratings) / len(doc_ratings), 1) if doc_ratings else None

            fee_record = fees_map.get(doc.id)
            # BUG FIX: fee_record na hone par pehle 1500/10 (fake fees) return hota
            # tha — patient ko specific-lagne wali cost dikhti thi jo doctor ne kabhi
            # set hi nahi ki thi. Ab None — frontend "Fee not set" dikhayega.
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
                # ho sakta tha) return hote the. Ab honest None — frontend clearly
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
                "verification_status": getattr(profile, 'verification_status', 'pending') or 'pending'
            })

        return generate_response(True, data=doctors_list, status_code=200)
    except Exception as e:
        logger.error(f"Public Doctors Fetch Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()

@app.route('/api/doctors', methods=['GET'])
def get_doctors_alias():
    return get_public_doctors()


# ==========================================
# 6B. LIVE DASHBOARD UPDATES (SSE STREAM)
# ==========================================
@app.route('/api/doctor-updates-stream/<int:doctor_id>', methods=['GET'])
def doctor_updates_stream(doctor_id):
    def generate():
        last_payload = None
        while True:
            db = SessionLocal()
            try:
                scans = db.query(models.AIScan).filter(
                    models.AIScan.doctor_id == doctor_id
                ).order_by(models.AIScan.id.desc()).limit(20).all() # Limit to prevent huge streams

                patient_ids = [s.user_id for s in scans]
                patients = {p.id: p for p in db.query(models.User).filter(models.User.id.in_(patient_ids)).all()}
                scan_ids = [s.id for s in scans]
                ratings_map = {r.scan_id: r for r in db.query(models.DoctorRating).filter(models.DoctorRating.scan_id.in_(scan_ids)).all()}

                scans_data = []
                for scan in scans:
                    patient = patients.get(scan.user_id)
                    rating_record = ratings_map.get(scan.id)
                    
                    questionnaire = None
                    if scan.patient_questionnaire:
                        try:
                            questionnaire = json.loads(scan.patient_questionnaire)
                        except Exception:
                            pass
                            
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
                        "image_url": "/" + scan.image_url if scan.image_url else "",
                        "created_at": scan.created_at.isoformat() if scan.created_at else None,
                        "patient_rating": rating_record.rating if rating_record else None,
                        "patient_review": rating_record.review if rating_record else None
                    })

                appointments = db.query(models.Appointment).filter(
                    models.Appointment.doctor_id == doctor_id,
                    # Doctor ne dashboard se "delete" kiya hua appointment SSE push
                    # se dobara wapas nahi aana chahiye - patient side unaffected.
                    models.Appointment.hidden_from_doctor == False
                ).order_by(models.Appointment.appointment_date.desc()).all()
                appointments = sort_appointments_by_priority(appointments)
                
                fee_setting = db.query(models.DoctorFees).filter_by(doctor_id=doctor_id).first()
                # BUG FIX: pehle har appointment ko doctor ki *current* live
                # fee-setting se duration mil jati thi, uski apni saved duration
                # se nahi - matlab doctor duration badal de to purani sab
                # appointments bhi badal jati thin. Ab har appt apni saved
                # duration use karti hai (per-appt fallback neeche loop mein).
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
                    # BUG FIX: "Confirmed" status yahan count nahi ho raha tha —
                    # sirf "Scheduled" check hota tha. Jaise hi doctor appointment
                    # Confirm karta, wo pending_count se gayab ho jati thi. Ye
                    # exact bug do jagah (slot generation, booking-conflict check)
                    # pehle se fix ho chuka hai — yahan teesri jagah reh gaya tha.
                    if appt.status in ("Scheduled", "Confirmed"):
                        pending_count += 1
                    elif appt.status == "Completed":
                        completed_count += 1
                    elif appt.status == "Cancelled":
                        cancelled_count += 1

                payload = {
                    "scans": scans_data,
                    "appointments": appts_data,
                    "pending_count": pending_count,
                    "completed_count": completed_count,
                    "cancelled_count": cancelled_count
                }
                payload_json = json.dumps(payload)

                if payload_json != last_payload:
                    last_payload = payload_json
                    yield f"data: {payload_json}\n\n"
                else:
                    yield ": heartbeat\n\n"

            except GeneratorExit:
                raise
            except Exception as e:
                logger.error(f"SSE stream error: {e}", exc_info=True)
            finally:
                db.close()

            time.sleep(5)

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive'
        }
    )

# ==========================================
# 6C. LIVE PATIENT DASHBOARD UPDATES (SSE STREAM)
# Doctor stream jaisa hi pattern: har 5 sec DB poll karke, agar kuch
# badla ho tabhi push karta hai (warna sirf heartbeat).
# Note: EventSource browser API custom Authorization header nahi bhej
# sakta, isliye ye endpoint bhi doctor stream ki tarah token-decorator
# ke bagair hai (URL me patient_id se scoped).
# ==========================================
@app.route('/api/patient-updates-stream/<int:patient_id>', methods=['GET'])
def patient_updates_stream(patient_id):
    def generate():
        last_payload = None
        while True:
            db = SessionLocal()
            try:
                # ---- Scans (patient/scans/<id> jaisa shape) ----
                scans = db.query(models.AIScan).filter(
                    models.AIScan.user_id == patient_id
                ).order_by(models.AIScan.id.desc()).limit(20).all()

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
                        "image_url": "/" + scan.image_url if scan.image_url else "",
                        "created_at": scan.created_at.isoformat() if scan.created_at else None,
                        "patient_rating": rating_record.rating if rating_record else None,
                        "patient_review": rating_record.review if rating_record else None
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
                            "image_url": scan.image_url,
                            "disease": scan.prediction_result,
                            "confidence": scan.confidence,
                            "doctor_comment": scan.doctor_comment,
                            "invite_to_clinic": scan.invite_to_clinic,
                            "severity": scan.severity_level or "ROUTINE"
                        }

                    fee_setting = fees_map.get(appt.doctor_id)
                    # BUG FIX: appt ki apni saved duration use karo, doctor ki
                    # current live fee-setting se recalculate mat karo (warna
                    # doctor duration badalte hi purani appointments bhi badal jayengi).
                    default_duration_fallback = fee_setting.duration if fee_setting and fee_setting.duration else "30min"
                    fees_obj = {
                        "pkr": fee_setting.pkr if fee_setting else 0.0,
                        "usd": fee_setting.usd if fee_setting else 0.0
                    }

                    rating_record = rating_by_scan.get(appt.scan_id) or rating_by_appt.get(appt.id)

                    # Reassigned patient ke liye suggested slots yahan bhi
                    # chahiye - warna SSE push aane par ye field gayab ho jati
                    # aur bumped patient ko suggestion dikhna band ho jata.
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

                payload = {
                    "scans": scans_data,
                    "appointments": appts_data
                }
                payload_json = json.dumps(payload)

                if payload_json != last_payload:
                    last_payload = payload_json
                    yield f"data: {payload_json}\n\n"
                else:
                    yield ": heartbeat\n\n"

            except GeneratorExit:
                raise
            except Exception as e:
                logger.error(f"Patient SSE stream error: {e}", exc_info=True)
            finally:
                db.close()

            time.sleep(5)

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
            'Connection': 'keep-alive'
        }
    )

@app.route('/admin/stats', methods=['GET'])
@admin_required
def get_admin_stats():
    db = SessionLocal()
    try:
        data = {
            "total_users": db.query(models.User).count(),
            "total_scans": db.query(models.AIScan).count(),
            "total_doctors": db.query(models.User).filter(models.User.role == 'Doctor').count(),
            "pending_doctor_verifications": db.query(models.DoctorProfile).filter(
                models.DoctorProfile.verification_status == 'pending'
            ).count()
        }
        return generate_response(True, data=data, status_code=200)
    except Exception as e:
        logger.error(f"Admin Stats Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()


# ==========================================
# 6C. ADMIN: DOCTOR LICENSE VERIFICATION
# ==========================================
@app.route('/admin/doctors', methods=['GET'])
@admin_required
def list_doctors_for_admin():
    """
    Admin ke liye doctor list, license verify karne ke liye.
    Optional query param: ?status=pending / approved / rejected (default: sab doctors)
    """
    db = SessionLocal()
    try:
        status_filter = request.args.get('status')

        query = db.query(models.User).filter(models.User.role == 'Doctor')
        doctors = query.all()
        doc_ids = [d.id for d in doctors]

        profiles = {p.user_id: p for p in db.query(models.DoctorProfile).filter(
            models.DoctorProfile.user_id.in_(doc_ids)
        ).all()}

        result = []
        for doc in doctors:
            profile = profiles.get(doc.id)
            v_status = profile.verification_status if profile else 'pending'

            if status_filter and v_status != status_filter:
                continue

            result.append({
                "id": doc.id,
                "name": doc.name,
                "email": doc.email,
                "created_at": doc.created_at.strftime("%Y-%m-%d %H:%M") if doc.created_at else None,
                "is_email_verified": doc.is_verified,
                "license": profile.license if profile else None,
                "specialty": profile.specialty if profile else None,
                "hospital": profile.hospital if profile else None,
                "city": profile.city if profile else None,
                "phone": profile.phone if profile else None,
                "verification_status": v_status,
                "verification_note": profile.verification_note if profile else None,
                "verified_at": profile.verified_at.strftime("%Y-%m-%d %H:%M") if profile and profile.verified_at else None
            })

        return generate_response(True, data=result, status_code=200)
    except Exception as e:
        logger.error(f"Admin List Doctors Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()


@app.route('/admin/doctors/<int:doctor_id>/verify', methods=['PUT'])
@admin_required
def verify_doctor(doctor_id):
    """
    Admin license check karne ke baad doctor ko approve ya reject karta hai.
    Body: { "action": "approve" | "reject", "note": "optional reason" }
    """
    db = SessionLocal()
    try:
        data = request.get_json() or {}
        action = data.get('action')

        if action not in ('approve', 'reject'):
            return generate_response(False, error="action must be 'approve' or 'reject'", status_code=400)

        doctor = db.query(models.User).filter_by(id=doctor_id, role='Doctor').first()
        if not doctor:
            return generate_response(False, error="Doctor not found", status_code=404)

        profile = db.query(models.DoctorProfile).filter_by(user_id=doctor_id).first()
        if not profile:
            return generate_response(False, error="Doctor profile not found", status_code=404)

        profile.verification_status = 'approved' if action == 'approve' else 'rejected'
        profile.verification_note = data.get('note')
        profile.verified_at = datetime.utcnow()
        profile.verified_by = request.current_user.get('user_id')
        db.commit()

        if action == 'approve':
            send_email(doctor.email, "Account Verified - SkinCare",
                        f"Hi {doctor.name},\n\nYour PMDC license has been reviewed and approved. Your doctor account is now fully verified on SkinCare.")
        else:
            reason_text = f"\n\nReason: {data.get('note')}" if data.get('note') else ""
            send_email(doctor.email, "Account Verification Update - SkinCare",
                        f"Hi {doctor.name},\n\nWe were unable to verify your license details.{reason_text}\n\nPlease contact support if you believe this is a mistake.")

        logger.info(f"Doctor {doctor_id} verification set to '{profile.verification_status}' by admin {request.current_user.get('user_id')}")
        return generate_response(True, message=f"Doctor {profile.verification_status}", status_code=200)
    except Exception as e:
        db.rollback()
        logger.error(f"Verify Doctor Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()


@app.route('/admin/doctors/<int:doctor_id>', methods=['DELETE'])
@admin_required
def delete_fake_doctor(doctor_id):
    """
    Admin ko fake/rejected doctor ka account permanently remove karne deta hai.
    """
    db = SessionLocal()
    try:
        doctor = db.query(models.User).filter_by(id=doctor_id, role='Doctor').first()
        if not doctor:
            return generate_response(False, error="Doctor not found", status_code=404)

        doctor_email = doctor.email
        db.delete(doctor)
        db.commit()

        logger.info(f"Doctor account {doctor_id} ({doctor_email}) deleted by admin {request.current_user.get('user_id')}")
        return generate_response(True, message="Doctor account deleted", status_code=200)
    except IntegrityError as e:
        db.rollback()
        logger.error(f"Delete Doctor Integrity Error: {e}")
        return generate_response(False, error="Could not delete: doctor has linked records that block deletion.", status_code=400)
    except Exception as e:
        db.rollback()
        logger.error(f"Delete Doctor Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()


# ==========================================
# 7. DOCTOR SCHEDULE
# ==========================================
def expand_and_standardize_days(day_string):

    full_days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    short_days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    
    day_clean = day_string.strip().lower()
    
    # Case 1: Agar range format hai (e.g., "Mon - Fri" ya "Monday - Friday")
    if '-' in day_clean:
        parts = [p.strip() for p in day_clean.split('-')]
        if len(parts) == 2:
            start_day, end_day = parts[0], parts[1]
            
            start_idx = -1
            end_idx = -1
            
            # Find indices for start and end days
            for i, d in enumerate(full_days):
                if d.lower() == start_day: start_idx = i
                if d.lower() == end_day: end_idx = i
                
            if start_idx == -1 and start_day[:3] in short_days:
                start_idx = short_days.index(start_day[:3])
            if end_idx == -1 and end_day[:3] in short_days:
                end_idx = short_days.index(end_day[:3])
                
            if start_idx != -1 and end_idx != -1:
                result = []
                if start_idx <= end_idx:
                    for idx in range(start_idx, end_idx + 1):
                        result.append(full_days[idx])
                else:
                    # Over-weekend wrap (e.g., Fri - Sun)
                    for idx in range(start_idx, 7):
                        result.append(full_days[idx])
                    for idx in range(0, end_idx + 1):
                        result.append(full_days[idx])
                return result

    # Case 2: Single Day match (e.g., "Mon" -> "Monday")
    for d in full_days:
        if d.lower() == day_clean or d.lower()[:3] == day_clean[:3]:
            return [d]
            
    # Fallback: Agar kuch samajh na aaye to capitalized string return karein
    return [day_string.strip().capitalize()]


def validate_schedule_slots(schedule):
    """
    BUG FIX: pehle na frontend na backend kahin check karta tha ke (1) shift ka
    start time end se pehle ho, (2) same din ke do slots overlap na karein.
    Doctor start:17:00, end:09:00 jaisa ulta slot bhi save kar sakta tha, koi
    warning nahi aati thi. Time strings 'HH:MM' (24hr, zero-padded) hain,
    isliye seedha lexicographic compare kaafi hai.
    Return: error message (string) agar invalid ho, warna None.
    """
    for day_data in schedule:
        raw_day = day_data.get('day')
        if not raw_day or day_data.get('off', False):
            continue

        slots = day_data.get('slots') or []
        if not slots and (day_data.get('start') or day_data.get('end')):
            slots = [{"start": day_data.get('start'), "end": day_data.get('end')}]

        active_slots = []
        for slot in slots:
            start = slot.get('start')
            end = slot.get('end')
            if not start or not end:
                continue
            if start >= end:
                return f"{raw_day}: shift start time ({start}) must be before end time ({end})."
            active_slots.append((start, end))

        active_slots.sort(key=lambda s: s[0])
        for i in range(1, len(active_slots)):
            if active_slots[i][0] < active_slots[i - 1][1]:
                return (f"{raw_day}: shifts overlap — "
                        f"{active_slots[i-1][0]}-{active_slots[i-1][1]} and "
                        f"{active_slots[i][0]}-{active_slots[i][1]} clash.")
    return None


def _time_str_to_minutes(time_str, formats):
    """Parse a time string using a list of candidate strptime formats, return
    minutes-since-midnight, or None if it can't be parsed with any of them."""
    if not time_str:
        return None
    for fmt in formats:
        try:
            t = datetime.strptime(time_str.strip(), fmt)
            return t.hour * 60 + t.minute
        except (ValueError, AttributeError):
            continue
    return None


def find_appointments_orphaned_by_schedule_change(db, doctor_id, incoming_schedule):
    """
    ADD (missing safeguard): pehle jab doctor apna weekly schedule save karta
    tha, purani availability delete karke naye se replace ho jati thi - bina ye
    check kiye ke us din/time pe pehle se koi Scheduled/Confirmed/Pending-Conflict
    appointment maujood hai ya nahi. Agar doctor Monday hata de aur kisi
    patient ki Monday appointment already booked ho, wo appointment orphaned
    reh jati thi, koi warning nahi milti thi.

    Ye function future ki active appointments check karta hai aur batata hai
    ke naye schedule mein unke din/time ko cover kiya gaya hai ya nahi. Jo
    cover nahi hoti, unki list return hoti hai taake caller doctor ko warn kar
    sake, delete se pehle.
    """
    today_str = datetime.utcnow().strftime("%Y-%m-%d")

    active_appts = db.query(models.Appointment).filter(
        models.Appointment.doctor_id == doctor_id,
        models.Appointment.status.in_(["Scheduled", "Confirmed", "Pending-Conflict"]),
        models.Appointment.appointment_date >= today_str
    ).all()

    if not active_appts:
        return []

    # Naye schedule se weekday -> covered (start,end) minute-ranges banayein.
    # Off days ya empty-slot days deliberately empty list rakhte hain (matlab
    # "explicitly not covered"), taake unhe missing days se distinguish kar sakein.
    coverage = {}
    for day_data in incoming_schedule:
        raw_day = day_data.get('day')
        if not raw_day:
            continue
        expanded_days = expand_and_standardize_days(raw_day)
        is_off = day_data.get('off', False)

        slots = day_data.get('slots') or []
        if not slots and (day_data.get('start') or day_data.get('end')):
            slots = [{"start": day_data.get('start'), "end": day_data.get('end')}]

        for standard_day in expanded_days:
            coverage.setdefault(standard_day, [])
            if is_off or not slots:
                continue
            for slot in slots:
                s_min = _time_str_to_minutes(slot.get('start'), ["%H:%M"])
                e_min = _time_str_to_minutes(slot.get('end'), ["%H:%M"])
                if s_min is not None and e_min is not None:
                    coverage[standard_day].append((s_min, e_min))

    orphaned = []
    for appt in active_appts:
        try:
            appt_date_obj = datetime.strptime(appt.appointment_date, "%Y-%m-%d")
        except ValueError:
            # Legacy/non-standard date format - can't safely verify, skip rather
            # than false-alarm the doctor.
            continue

        weekday_name = appt_date_obj.strftime("%A")  # "Monday", "Tuesday", ...
        slots_for_day = coverage.get(weekday_name)

        is_covered = False
        if slots_for_day:
            appt_minutes = _time_str_to_minutes(appt.appointment_time, APPOINTMENT_TIME_FORMATS)
            if appt_minutes is None:
                # Time format couldn't be parsed - day itself has slots, so
                # treat as covered rather than false-alarming.
                is_covered = True
            else:
                is_covered = any(start <= appt_minutes < end for start, end in slots_for_day)

        if not is_covered:
            patient = db.query(models.User).filter_by(id=appt.patient_id).first()
            orphaned.append({
                "appointment_id": appt.id,
                "date": appt.appointment_date,
                "time": appt.appointment_time,
                "status": appt.status,
                "patient_name": patient.name if patient else "Unknown Patient"
            })

    return orphaned


@app.route('/api/update-availability', methods=['POST'])
@doctor_required
def update_availability():
    data = request.get_json()
    if not data:
        return generate_response(False, error="Invalid JSON data", status_code=400)
        
    doctor_id = data.get('doctor_id')
    schedule = data.get('schedule')
    
    if not doctor_id or not schedule:
        return generate_response(False, error="Missing doctor_id or schedule data", status_code=400)
        
    if request.current_user.get('user_id') != doctor_id:
        return generate_response(False, error="Unauthorized to modify this schedule", status_code=403)

    # BUG FIX: DB touch karne se pehle poora schedule validate karo — koi bhi
    # ek din invalid ho to poori request reject, partial-save nahi.
    validation_error = validate_schedule_slots(schedule)
    if validation_error:
        return generate_response(False, error=validation_error, status_code=400)

    db = SessionLocal()
    try:
        # ADD (missing safeguard): agar ye schedule change kisi existing
        # Scheduled/Confirmed/Pending-Conflict appointment ko orphan kar
        # dega (uska din off ho gaya ya uska time ab kisi shift mein cover
        # nahi hota), to doctor ko explicit warn karo aur confirm_override
        # flag ke bina overwrite mat karo. Frontend confirm dialog dikhane
        # ke baad confirm_override: true bhej kar dobara call karega.
        if not data.get('confirm_override'):
            orphaned = find_appointments_orphaned_by_schedule_change(db, doctor_id, schedule)
            if orphaned:
                return generate_response(
                    False,
                    error="This change would leave existing booked appointments without matching availability.",
                    data={"requires_confirmation": True, "conflicts": orphaned},
                    status_code=409
                )

        # Purane records delete karein taaki fresh setup overwrite ho sake
        db.query(models.DoctorAvailability).filter(models.DoctorAvailability.doctor_id == doctor_id).delete()
        
        for day_data in schedule:
            raw_day = day_data.get('day')
            if not raw_day:
                continue
                
            # Range ya single day ko standard individual days array me convert karein
            expanded_days = expand_and_standardize_days(raw_day)

            is_off = day_data.get('off', False)

            # Multi-Slot support: frontend ab har din ke liye ek "slots" array
            # bhejta hai (multiple shifts). Har slot apni alag row me save hoti
            # hai, isliye ek din me jitne chahein utne gaps/breaks ban sakte hain.
            slots = day_data.get('slots') or []
            # Legacy fallback agar koi purana single start/end payload aa jaye
            if not slots and (day_data.get('start') or day_data.get('end')):
                slots = [{"start": day_data.get('start'), "end": day_data.get('end')}]
            
            for standard_day in expanded_days:
                if is_off or not slots:
                    # Off day ke liye ek hi placeholder row kaafi hai
                    db.add(models.DoctorAvailability(
                        doctor_id=doctor_id,
                        day=standard_day,
                        start_time=None,
                        end_time=None,
                        is_off=True))
                    continue

                prev_slot_end = None  # Pichli shift ka end time - agla gap "break" banega
                for slot in slots:
                    slot_start = slot.get('start')
                    slot_end = slot.get('end')
                    if not slot_start or not slot_end:
                        continue

                    # Sirf tab break record hoga jab ye pehli shift na ho (prev_slot_end maujood ho)
                    break_start = prev_slot_end
                    break_end = slot_start if prev_slot_end else None
                    break_name = (slot.get('break_name') or 'Break') if prev_slot_end else None

                    db.add(models.DoctorAvailability(
                        doctor_id=doctor_id,
                        day=standard_day,
                        start_time=slot_start,
                        end_time=slot_end,
                        is_off=False,
                        break_start_time=break_start,
                        break_end_time=break_end,
                        break_name=break_name))
                    prev_slot_end = slot_end
                
        db.commit()
        logger.info(f"Schedule updated for Doctor {doctor_id}")
        return generate_response(True, message="Schedule updated successfully", status_code=200)
    except Exception as e:
        db.rollback()
        logger.error(f"Update Schedule Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()


@app.route('/api/doctor-availability/<int:doctor_id>', methods=['GET'])
def get_availability(doctor_id):
    db = SessionLocal()
    try:
        availabilities = db.query(models.DoctorAvailability).filter(
            models.DoctorAvailability.doctor_id == doctor_id
        ).order_by(models.DoctorAvailability.start_time.asc()).all()

        # Ek din ki multiple shift-rows ko wapis slots[] array me group karein
        grouped = {}
        for a in availabilities:
            grouped.setdefault(a.day, []).append(a)

        result = []
        for day, rows in grouped.items():
            if rows[0].is_off:
                result.append({"day": day, "off": True, "slots": [{"start": "", "end": ""}]})
                continue

            slots = []
            for r in rows:
                if not r.start_time or not r.end_time:
                    continue
                slot = {"start": r.start_time, "end": r.end_time}
                if r.break_name:
                    slot["break_name"] = r.break_name
                    slot["break_start"] = r.break_start_time
                    slot["break_end"] = r.break_end_time
                slots.append(slot)

            result.append({"day": day, "off": False, "slots": slots or [{"start": "", "end": ""}]})

        return generate_response(True, data=result, status_code=200)
    except Exception as e:
        logger.error(f"Get Availability Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()

# ==========================================
# 8. FEES MANAGEMENT
# ==========================================
@app.route('/api/update-fees', methods=['POST'])
@doctor_required
def update_fees():  
    data = request.get_json() or {}
    doctor_id = data.get('doctor_id') or data.get('user_id')
    pkr = data.get('pkr')
    usd = data.get('usd')
    duration = data.get('duration')
    buffer_time = data.get('buffer_time', 0)
    
    if not doctor_id:
        return generate_response(False, error="Doctor ID required", status_code=400)
        
    if request.current_user.get('user_id') != doctor_id:
         return generate_response(False, error="Unauthorized to modify fees", status_code=403)
        
    db = SessionLocal()
    try:
        fee_record = db.query(models.DoctorFees).filter(models.DoctorFees.doctor_id == doctor_id).first()
        if fee_record:
            if pkr is not None: fee_record.pkr = float(pkr)
            if usd is not None: fee_record.usd = float(usd)
            if duration: fee_record.duration = str(duration)
            if buffer_time is not None: fee_record.buffer_time = int(buffer_time)
        else:
            fee_record = models.DoctorFees(
                doctor_id=doctor_id,
                pkr=float(pkr) if pkr else 0.0,
                usd=float(usd) if usd else 0.0,
                duration=str(duration) if duration else '30min',
                buffer_time=int(buffer_time) if buffer_time else 0
            )
            db.add(fee_record)
        db.commit()
        logger.info(f"Fees updated for Doctor {doctor_id}")
        return generate_response(True, message="Fees and Gap updated successfully", status_code=200)
    except Exception as e:
        db.rollback()
        logger.error(f"Update Fees Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()

@app.route('/api/doctor-fees/<int:doctor_id>', methods=['GET'])
def get_fees(doctor_id): 
    db = SessionLocal()
    try:
        fee_record = db.query(models.DoctorFees).filter(models.DoctorFees.doctor_id == doctor_id).first()
        if fee_record:
            data = {
                "pkr": fee_record.pkr,
                "usd": fee_record.usd,
                "duration": fee_record.duration,
                "buffer_time": fee_record.buffer_time if fee_record.buffer_time else 0
            }
            return generate_response(True, data=data, status_code=200)
        
        return generate_response(True, data={
            "pkr": 0,
            "usd": 0,
            "duration": "30min",
            "buffer_time": 0
        }, status_code=200)
    except Exception as e:
        logger.error(f"Get Fees Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()


# ==========================================
# 9. DYNAMIC SLOTS & BOOKING (TASK 15)
# ==========================================
def _generate_slots_for_date(db, doctor_id, date_str):
    """
    Core slot-generation logic, reused by /api/slots (raw display) aur
    find_next_available_slots() (auto-compensation suggestions). Returns a
    list of {"time", "status", "duration"} dicts, ya None agar date invalid ho.
    Conflict wale slots ("Pending-Conflict") ko bhi "booked" treat karte hain -
    naya (3rd) patient us slot pe conflict add nahi kar sakta.
    """
    try:
        date_obj = datetime.strptime(date_str, "%Y-%m-%d")
    except ValueError:
        return None

    if date_obj.date() < datetime.utcnow().date():
        return []

    day_name = date_obj.strftime("%A")

    shifts = db.query(models.DoctorAvailability).filter(
        models.DoctorAvailability.doctor_id == doctor_id,
        models.DoctorAvailability.day == day_name,
        models.DoctorAvailability.is_off == False
    ).order_by(models.DoctorAvailability.start_time.asc()).all()

    if not shifts:
        return []

    fee_setting = db.query(models.DoctorFees).filter_by(doctor_id=doctor_id).first()
    duration_str = fee_setting.duration if fee_setting and fee_setting.duration else '60min'
    buffer_time = fee_setting.buffer_time if fee_setting and fee_setting.buffer_time else 0

    try:
        interval_minutes = int(''.join(filter(str.isdigit, duration_str)))
    except ValueError:
        interval_minutes = 60

    generated_slots = []

    for shift in shifts:
        if not shift.start_time or not shift.end_time:
            continue
        try:
            if isinstance(shift.start_time, str):
                start_time = datetime.strptime(shift.start_time, "%H:%M")
                end_time = datetime.strptime(shift.end_time, "%H:%M")
            else:
                start_time = datetime.combine(date_obj, shift.start_time)
                end_time = datetime.combine(date_obj, shift.end_time)
        except ValueError:
            continue

        current_time = start_time
        while current_time + timedelta(minutes=interval_minutes) <= end_time:
            slot_end_time = current_time + timedelta(minutes=interval_minutes)

            if date_obj.date() == datetime.utcnow().date():
                current_hm = datetime.utcnow().strftime("%H:%M")
                if current_time.strftime("%H:%M") < current_hm:
                    current_time = slot_end_time + timedelta(minutes=buffer_time)
                    continue

            generated_slots.append(current_time.strftime("%H:%M"))
            current_time = slot_end_time + timedelta(minutes=buffer_time)

    booked_appointments = db.query(models.Appointment).filter(
        models.Appointment.doctor_id == doctor_id,
        models.Appointment.appointment_date == date_str,
        # BUG FIX: "Confirmed" missing yahan tha - jab doctor kisi Scheduled
        # appointment ko Confirmed karta hai (/api/update-appointment), wo slot
        # dobara "available" dikhne lagta tha, kyunke ye filter usko booked hi
        # nahi maanta tha. Isi wajah se ek hi slot pe 2 alag patients Confirmed
        # ho jate the, bina kabhi Pending-Conflict bane ya doctor ko notify kiye.
        models.Appointment.status.in_(["Scheduled", "Confirmed", "Completed", "Pending-Conflict"])
    ).all()
    booked_times = {appt.appointment_time for appt in booked_appointments}

    response_slots = []
    for slot in generated_slots:
        status = "booked" if slot in booked_times else "available"
        response_slots.append({
            "time": slot,
            "status": status,
            "duration": duration_str
        })

    return response_slots


def find_next_available_slots(db, doctor_id, start_date_str, limit=3, lookahead_days=21):
    """
    Auto-compensation ke liye: bumped (Reassigned) patient ko dikhane wale
    agle 'limit' free slots dhoondta hai, start_date_str se lookahead_days
    tak aage dekh kar (aaj ka din bhi included agar abhi tak slots bache hon).
    """
    suggestions = []
    try:
        start_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
    except ValueError:
        start_date = datetime.utcnow().date()

    for day_offset in range(0, lookahead_days):
        if len(suggestions) >= limit:
            break
        check_date = start_date + timedelta(days=day_offset)
        check_date_str = check_date.strftime("%Y-%m-%d")
        day_slots = _generate_slots_for_date(db, doctor_id, check_date_str) or []
        for slot in day_slots:
            if slot["status"] == "available":
                suggestions.append({"date": check_date_str, "time": slot["time"], "duration": slot["duration"]})
                if len(suggestions) >= limit:
                    break

    return suggestions


@app.route('/api/slots/<int:doctor_id>', methods=['GET'])
def get_daily_slots(doctor_id):
    db = SessionLocal()
    try:
        date_str = request.args.get('date')
        if not date_str:
            return generate_response(False, error="Date query parameter is required", status_code=400)

        response_slots = _generate_slots_for_date(db, doctor_id, date_str)
        if response_slots is None:
            return generate_response(False, error="Invalid date format, use YYYY-MM-DD", status_code=400)

        return jsonify(response_slots), 200  # Frontend expects raw list or generic JSON
    except Exception as e:
        logger.error(f"Get Slots Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()

@app.route('/api/book-slot', methods=['POST'])
@patient_required
def book_appointment():
    db = SessionLocal()
    try:
        data = request.get_json()
        if not data:
            return generate_response(False, error="Invalid JSON body", status_code=400)
            
        patient_id = data.get('patient_id')
        doctor_id = data.get('doctor_id')
        scan_id = data.get('scan_id')
        appointment_date = data.get('slot_date')
        appointment_time = data.get('slot_time')
        rebook_appointment_id = data.get('appointment_id')  # Set when "Book Again" on a Cancelled appointment
        
        if not all([patient_id, doctor_id, appointment_date, appointment_time]):
            return generate_response(False, error="Missing required fields for booking.", status_code=400)
            
        if request.current_user.get('user_id') != patient_id:
            return generate_response(False, error="Unauthorized ID mismatch", status_code=403)
            
        # Prevent doctor booking himself (TASK 15)
        if patient_id == doctor_id:
            return generate_response(False, error="Doctor cannot book appointment with themselves.", status_code=400)

        # Future date validation (Task 15)
        try:
            appt_date_obj = datetime.strptime(appointment_date, "%Y-%m-%d").date()
            if appt_date_obj < datetime.utcnow().date():
                return generate_response(False, error="Cannot book appointments in the past.", status_code=400)
        except ValueError:
            return generate_response(False, error="Invalid date format.", status_code=400)
            
        # BUG FIX: duration pehle yahan kabhi set nahi hoti thi - appointment
        # hamesha model default pe reh jati thi, aur baad mein listing endpoints
        # doctor ki *current* live fee-settings se duration recalculate karte
        # the (galat, kyunki doctor duration badal sakta hai). Ab booking ke
        # waqt doctor ki us-waqt ki duration snapshot karke appointment par
        # save karte hain, taake ye badge kabhi na badle.
        fee_setting_at_booking = db.query(models.DoctorFees).filter_by(doctor_id=doctor_id).first()
        duration_at_booking = fee_setting_at_booking.duration if fee_setting_at_booking and fee_setting_at_booking.duration else '30min'

        existing_booking = db.query(models.Appointment).filter(
            models.Appointment.doctor_id == doctor_id,
            models.Appointment.appointment_date == appointment_date,
            models.Appointment.appointment_time == appointment_time,
            # BUG FIX: same missing "Confirmed" issue as _generate_slots_for_date -
            # without it, a Confirmed appointment was invisible to this check, so a
            # second (even non-urgent) booking on the same slot sailed straight
            # through to the plain "new_appointment" branch below instead of ever
            # hitting the Pending-Conflict path.
            models.Appointment.status.in_(["Scheduled", "Confirmed", "Completed", "Pending-Conflict"]),
            models.Appointment.id != rebook_appointment_id if rebook_appointment_id else True
        ).first()

        if existing_booking:
            # Slot pe already ek open conflict chal raha hai - teesra patient
            # add nahi hone dena, warna doctor ke liye unmanageable ho jayega.
            if existing_booking.status == "Pending-Conflict":
                return generate_response(False, error="This slot is already booked.", status_code=400)

            # Naye booking wale patient ki severity DB se check karo (scan record
            # se) - request body se NAHI, warna koi bhi "urgent" bol kar
            # kisi ka slot le sakta hai. Sirf server-verified CRITICAL/URGENT
            # ko override power milti hai.
            incoming_severity = "ROUTINE"
            if scan_id:
                incoming_scan = db.query(models.AIScan).filter(
                    models.AIScan.id == scan_id,
                    models.AIScan.user_id == patient_id
                ).first()
                if incoming_scan:
                    incoming_severity = incoming_scan.severity_level or "ROUTINE"

            if incoming_severity not in ("CRITICAL", "URGENT"):
                return generate_response(False, error="This slot is already booked.", status_code=400)

            # Server-verified urgent/critical patient -> dono appointments ko
            # Pending-Conflict banao. Koi bhi "Confirmed" nahi hota jab tak
            # doctor (ya SLA timeout) resolve na kare - single source of truth.
            new_conflict_appointment = models.Appointment(
                patient_id=patient_id,
                doctor_id=doctor_id,
                scan_id=scan_id,
                appointment_date=appointment_date,
                appointment_time=appointment_time,
                status="Pending-Conflict",
                duration=duration_at_booking
            )
            db.add(new_conflict_appointment)
            db.flush()  # id chahiye conflict_with_id set karne ke liye

            existing_booking.status = "Pending-Conflict"
            existing_booking.conflict_with_id = new_conflict_appointment.id
            new_conflict_appointment.conflict_with_id = existing_booking.id
            db.commit()

            try:
                doctor_user = db.query(models.User).filter_by(id=doctor_id).first()
                if doctor_user and doctor_user.email:
                    send_email(
                        doctor_user.email,
                        "Action Required: Urgent Booking Conflict",
                        f"Dear Dr. {doctor_user.name},\n\n"
                        f"Ek {incoming_severity} priority patient ne {appointment_date} {appointment_time} "
                        f"ka slot select kiya hai jo pehle se book hai. Dono appointments abhi 'Pending-Conflict' "
                        f"status mein hain - kisi ek ko confirm karne ke liye dashboard par jayen.\n\n"
                        f"Agar aap time par decide nahi karte, system SLA timeout ke baad severity ke hisaab se "
                        f"khud resolve kar dega.\n\nThank you."
                    )
            except Exception as email_err:
                logger.warning(f"Conflict Notification Email Failure: {str(email_err)}")

            logger.info(
                f"Booking conflict created: slot {appointment_date} {appointment_time} doctor {doctor_id} - "
                f"appointments {existing_booking.id} vs {new_conflict_appointment.id}"
            )
            return generate_response(
                True,
                message="Slot was already booked, but your case was flagged urgent/critical - the doctor has been notified to confirm priority.",
                data={"status": "Pending-Conflict", "appointment_id": new_conflict_appointment.id},
                status_code=201
            )

        # Rebook flow: reuse the same (Cancelled) appointment row instead of inserting a duplicate
        if rebook_appointment_id:
            appt = db.query(models.Appointment).filter(
                models.Appointment.id == rebook_appointment_id,
                models.Appointment.patient_id == patient_id
            ).first()
            if not appt:
                return generate_response(False, error="Original appointment not found.", status_code=404)
            if appt.status not in ('Cancelled', 'Reassigned'):
                return generate_response(False, error="Only cancelled or reassigned appointments can be rebooked.", status_code=400)

            appt.doctor_id = doctor_id
            appt.scan_id = scan_id
            appt.appointment_date = appointment_date
            appt.appointment_time = appointment_time
            appt.status = "Scheduled"
            appt.duration = duration_at_booking
            appt.cancellation_reason = None
            db.commit()
            logger.info(f"Appointment {rebook_appointment_id} rebooked by patient {patient_id}")
            return generate_response(True, message="Appointment successfully rebooked.", status_code=200)

        new_appointment = models.Appointment(
            patient_id=patient_id,
            doctor_id=doctor_id,
            scan_id=scan_id,
            appointment_date=appointment_date,
            appointment_time=appointment_time,
            status="Scheduled",
            duration=duration_at_booking
        )
        db.add(new_appointment)
        db.commit()
        logger.info(f"New appointment booked: Patient {patient_id} with Doctor {doctor_id}")
        return generate_response(True, message="Appointment successfully booked.", status_code=201)
    except Exception as e:
        db.rollback()
        logger.error(f"Book Appointment Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()


# ==========================================
# 9B. URGENT BOOKING CONFLICT RESOLUTION
# ==========================================
def _resolve_conflict_pair(db, winner_appt, loser_appt, resolved_by_id, reason, auto_resolved=False):
    """
    Shared resolution logic - dono manual doctor-resolve aur SLA auto-resolve
    isi function ko use karte hain, taake behavior consistent rahe.
    Loser ke liye agle available slots suggest karta hai (auto-compensation).
    """
    now = datetime.utcnow()

    # BUG FIX: pehle yahan "Scheduled" set hota tha jabke doctor ne actually
    # "Confirm" kiya hota hai (button/email dono "Confirm" kehte hain), aur
    # agar winner appointment pehle se Confirmed thi to yahan wapis Scheduled
    # pe girr jati thi. Ab status doctor ke action se match karta hai.
    winner_appt.status = "Confirmed"
    winner_appt.conflict_with_id = None
    winner_appt.resolved_by = resolved_by_id
    winner_appt.resolved_at = now
    winner_appt.auto_resolved = auto_resolved

    loser_appt.status = "Reassigned"
    loser_appt.conflict_with_id = None
    loser_appt.cancellation_reason = reason
    loser_appt.resolved_by = resolved_by_id
    loser_appt.resolved_at = now
    loser_appt.auto_resolved = auto_resolved

    db.commit()

    suggested_slots = find_next_available_slots(db, loser_appt.doctor_id, loser_appt.appointment_date, limit=3)

    # Notify both patients
    try:
        winner_patient = db.query(models.User).filter_by(id=winner_appt.patient_id).first()
        doctor_user = db.query(models.User).filter_by(id=winner_appt.doctor_id).first()
        doctor_name = doctor_user.name if doctor_user else "Doctor"

        if winner_patient and winner_patient.email:
            send_email(
                winner_patient.email,
                "Appointment Confirmed",
                f"Dear {winner_patient.name},\n\nYour appointment with Dr. {doctor_name} on "
                f"{winner_appt.appointment_date} at {winner_appt.appointment_time} is confirmed.\n\nThank you."
            )

        loser_patient = db.query(models.User).filter_by(id=loser_appt.patient_id).first()
        if loser_patient and loser_patient.email:
            slots_text = "\n".join([f"- {s['date']} at {s['time']}" for s in suggested_slots]) or "Please check available slots on the app."
            send_email(
                loser_patient.email,
                "Appointment Needs Rescheduling",
                f"Dear {loser_patient.name},\n\nYour appointment with Dr. {doctor_name} on "
                f"{loser_appt.appointment_date} at {loser_appt.appointment_time} could not be kept because: "
                f"{reason}\n\nHere are the next available slots:\n{slots_text}\n\n"
                f"We're sorry for the inconvenience."
            )
    except Exception as email_err:
        logger.warning(f"Conflict Resolution Email Failure: {str(email_err)}")

    return suggested_slots


@app.route('/api/resolve-conflict/<int:appointment_id>', methods=['PUT'])
@doctor_required
def resolve_conflict(appointment_id):
    """
    Doctor conflict ke dono mein se jis appointment ko confirm karna chahta
    hai, uska id yahan bhejta hai - dusra automatically 'Reassigned' ho jata
    hai. Reason optional hai (default preset use hota hai).
    """
    db = SessionLocal()
    try:
        data = request.get_json() or {}
        reason = data.get('reason') or "Urgent patient requires immediate attention"

        winner_appt = db.query(models.Appointment).filter(models.Appointment.id == appointment_id).first()
        if not winner_appt:
            return generate_response(False, error="Appointment not found", status_code=404)

        if winner_appt.doctor_id != request.current_user.get('user_id'):
            return generate_response(False, error="Unauthorized", status_code=403)

        if winner_appt.status != "Pending-Conflict" or not winner_appt.conflict_with_id:
            return generate_response(False, error="This appointment has no active conflict to resolve.", status_code=400)

        loser_appt = db.query(models.Appointment).filter(models.Appointment.id == winner_appt.conflict_with_id).first()
        if not loser_appt:
            return generate_response(False, error="Linked conflicting appointment not found.", status_code=404)

        suggested_slots = _resolve_conflict_pair(
            db, winner_appt, loser_appt,
            resolved_by_id=request.current_user.get('user_id'),
            reason=reason,
            auto_resolved=False
        )

        logger.info(f"Conflict resolved by doctor: winner={winner_appt.id}, reassigned={loser_appt.id}")
        return generate_response(
            True,
            message="Conflict resolved.",
            data={
                "confirmed_appointment_id": winner_appt.id,
                "reassigned_appointment_id": loser_appt.id,
                "suggested_slots_for_reassigned_patient": suggested_slots
            },
            status_code=200
        )
    except Exception as e:
        db.rollback()
        logger.error(f"Resolve Conflict Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()


# ==========================================
# 9C. SLA TIMEOUT - AUTO-RESOLVE UNATTENDED CONFLICTS
# ==========================================
CONFLICT_SLA_HOURS = 4  # agar slot time se itne ghante pehle tak doctor decide na kare, system khud resolve kare

# appointment_date/appointment_time free-format strings hain (models.py dekho:
# "YYYY-MM-DD" ya "Mon, Jan 26" dono possible) - isliye yahan multiple known
# formats try karte hain. NOTE: ye ek stop-gap hai; asli fix appointment_date
# aur appointment_time ko proper Date/Time columns me migrate karna hai taake
# ye guessing hi khatam ho jaye.
APPOINTMENT_DATE_FORMATS = ["%Y-%m-%d", "%a, %b %d, %Y", "%A, %b %d, %Y", "%b %d, %Y"]
APPOINTMENT_TIME_FORMATS = ["%H:%M", "%I:%M %p"]

def parse_appointment_datetime(date_str, time_str):
    """
    appointment_date + appointment_time ko multiple known format combinations
    ke against try karta hai. Match milne par datetime, warna None return karta
    hai - caller ko is None case ko log karke skip karna chahiye (silently
    ignore NAHI, warna woh conflict kabhi SLA se resolve hi nahi hoga).
    """
    if not date_str or not time_str:
        return None
    for date_fmt in APPOINTMENT_DATE_FORMATS:
        for time_fmt in APPOINTMENT_TIME_FORMATS:
            try:
                return datetime.strptime(f"{date_str} {time_str}", f"{date_fmt} {time_fmt}")
            except ValueError:
                continue
    return None

def resolve_expired_conflicts():
    """
    Background job (APScheduler se periodically chalta hai). Har Pending-Conflict
    pair check karta hai - agar slot time CONFLICT_SLA_HOURS ke andar aa gaya
    aur doctor ne abhi tak resolve nahi kiya, to severity-rank (CRITICAL > URGENT
    > ROUTINE) se khud winner decide kar deta hai. Tie hone par pehle book hui
    appointment ko priority milti hai (first-come-first-served).
    """
    db = SessionLocal()
    try:
        pending = db.query(models.Appointment).filter(
            models.Appointment.status == "Pending-Conflict",
            models.Appointment.conflict_with_id.isnot(None)
        ).all()

        processed_ids = set()
        now = datetime.utcnow()

        for appt in pending:
            if appt.id in processed_ids or appt.conflict_with_id in processed_ids:
                continue

            other = db.query(models.Appointment).filter(models.Appointment.id == appt.conflict_with_id).first()
            if not other or other.status != "Pending-Conflict":
                continue

            slot_dt = parse_appointment_datetime(appt.appointment_date, appt.appointment_time)
            if slot_dt is None:
                logger.warning(
                    f"SLA auto-resolve: could not parse date/time for appointment {appt.id} "
                    f"(date={appt.appointment_date!r}, time={appt.appointment_time!r}). "
                    f"Skipping - needs manual doctor resolution."
                )
                continue

            hours_until_slot = (slot_dt - now).total_seconds() / 3600.0
            if hours_until_slot > CONFLICT_SLA_HOURS:
                continue  # abhi time hai, doctor ko decide karne do

            # Severity fetch karo dono ke scans se
            def _severity_for(a):
                if not a.scan_id:
                    return "ROUTINE"
                scan = db.query(models.AIScan).filter(models.AIScan.id == a.scan_id).first()
                return scan.severity_level if scan and scan.severity_level else "ROUTINE"

            appt_rank = TriageService.TIER_RANK.get(_severity_for(appt), 0)
            other_rank = TriageService.TIER_RANK.get(_severity_for(other), 0)

            if appt_rank > other_rank:
                winner, loser = appt, other
            elif other_rank > appt_rank:
                winner, loser = other, appt
            else:
                # tie -> jo pehle book hua wahi rahay ga
                winner, loser = (appt, other) if appt.created_at <= other.created_at else (other, appt)

            _resolve_conflict_pair(
                db, winner, loser,
                resolved_by_id=None,
                reason="Auto-resolved by system after doctor response timeout - higher priority patient retained the slot.",
                auto_resolved=True
            )
            processed_ids.add(winner.id)
            processed_ids.add(loser.id)
            logger.info(f"SLA auto-resolved conflict: winner={winner.id}, reassigned={loser.id}")

    except Exception as e:
        logger.error(f"SLA Conflict Auto-Resolve Error: {e}", exc_info=True)
    finally:
        db.close()


# ==========================================
# 10. APPOINTMENTS LISTING & UPDATES
# ==========================================
@app.route('/api/doctor-appointments/<int:doctor_id>', methods=['GET'])
@doctor_required
def get_doctor_appointments(doctor_id):
    if request.current_user.get('user_id') != doctor_id:
        return generate_response(False, error="Unauthorized", status_code=403)

    db = SessionLocal()
    try:
        appointments = db.query(models.Appointment).filter(
            models.Appointment.doctor_id == doctor_id,
            # Doctor ne apni dashboard se "delete" kiya hua appointment yahan
            # dobara nahi dikhna chahiye - patient side is filter se unaffected hai.
            models.Appointment.hidden_from_doctor == False
        ).order_by(models.Appointment.appointment_date.desc()).all()

        fee_setting = db.query(models.DoctorFees).filter_by(doctor_id=doctor_id).first()
        # BUG FIX: appt ki apni saved duration use karo, doctor ki current
        # live fee-setting se recalculate mat karo (warna doctor duration
        # badalte hi purani sab appointments bhi badal jayengi).
        default_duration_fallback = fee_setting.duration if fee_setting and fee_setting.duration else "30min"

        # N+1 Optimization
        patient_ids = [a.patient_id for a in appointments]
        patients_map = {p.id: p for p in db.query(models.User).filter(models.User.id.in_(patient_ids)).all()}
        
        scan_ids = [a.scan_id for a in appointments if a.scan_id]
        scans_map = {s.id: s for s in db.query(models.AIScan).filter(models.AIScan.id.in_(scan_ids)).all()}

        # Severity map scans_map se pehle banao taake conflict groups severity
        # ke hisaab se sort ho sakein (CRITICAL/URGENT pehle)
        severity_by_scan_id = {sid: scan.severity_level or "ROUTINE" for sid, scan in scans_map.items()}
        appointments = sort_appointments_by_priority(appointments, severity_by_scan_id)

        appt_ids = [a.id for a in appointments]
        ratings = db.query(models.DoctorRating).filter(
            (models.DoctorRating.scan_id.in_(scan_ids)) | (models.DoctorRating.appointment_id.in_(appt_ids))
        ).all()
        
        rating_by_scan = {r.scan_id: r for r in ratings if r.scan_id}
        rating_by_appt = {r.appointment_id: r for r in ratings if r.appointment_id}

        results = []
        for appt in appointments:
            disease_name = "Unknown"
            scan = scans_map.get(appt.scan_id)
            if scan:
                disease_name = scan.prediction_result
                    
            rating_record = rating_by_scan.get(appt.scan_id) or rating_by_appt.get(appt.id)
            patient = patients_map.get(appt.patient_id)

            triage_reasons = []
            if scan and scan.triage_reasons:
                try:
                    triage_reasons = json.loads(scan.triage_reasons)
                except (ValueError, TypeError):
                    triage_reasons = []

            results.append({
                "id": appt.id,
                "patient_name": patient.name if patient else "Unknown Patient",
                "patient_email": patient.email if patient else "No Email",
                "slot_date": appt.appointment_date,
                "slot_time": appt.appointment_time,
                "disease": disease_name,
                "status": appt.status,
                "scan_id": appt.scan_id,
                "duration": appt.duration or default_duration_fallback,
                "patient_rating": rating_record.rating if rating_record else None,
                "patient_review": rating_record.review if rating_record else None,
                # --- Triage & conflict info (doctor dashboard badge/grouping ke liye) ---
                "severity": scan.severity_level if scan else "ROUTINE",
                "triage_reasons": triage_reasons,
                "is_conflict": appt.status == "Pending-Conflict",
                "conflict_with_id": appt.conflict_with_id,
                "auto_resolved": appt.auto_resolved,
                "resolved_at": appt.resolved_at.isoformat() if appt.resolved_at else None
            })
            
        return generate_response(True, data=results, status_code=200)
    except Exception as e:
        logger.error(f"Doctor Appointments Fetch Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()

# TASK 6: ENHANCED PATIENT APPOINTMENTS
@app.route('/api/patient-appointments/<int:patient_id>', methods=['GET'])
@patient_required
def get_patient_appointments(patient_id):
    if request.current_user.get('user_id') != patient_id:
        return generate_response(False, error="Unauthorized", status_code=403)

    db = SessionLocal()
    try:
        appointments = db.query(models.Appointment).filter(
            models.Appointment.patient_id == patient_id
        ).order_by(models.Appointment.id.desc()).all()
        
        # N+1 Optimization
        doctor_ids = [a.doctor_id for a in appointments]
        doctors_map = {d.id: d for d in db.query(models.User).filter(models.User.id.in_(doctor_ids)).all()}
        profiles_map = {p.user_id: p for p in db.query(models.DoctorProfile).filter(models.DoctorProfile.user_id.in_(doctor_ids)).all()}
        fees_map = {f.doctor_id: f for f in db.query(models.DoctorFees).filter(models.DoctorFees.doctor_id.in_(doctor_ids)).all()}
        
        scan_ids = [a.scan_id for a in appointments if a.scan_id]
        scans_map = {s.id: s for s in db.query(models.AIScan).filter(models.AIScan.id.in_(scan_ids)).all()}

        results = []
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
                    "image_url": scan.image_url,
                    "disease": scan.prediction_result,
                    "confidence": scan.confidence,
                    "doctor_comment": scan.doctor_comment,
                    "invite_to_clinic": scan.invite_to_clinic,
                    "severity": scan.severity_level or "ROUTINE"
                }

            fee_setting = fees_map.get(appt.doctor_id)
            # BUG FIX: appt ki apni saved duration use karo, doctor ki current
            # live fee-setting se recalculate mat karo (warna doctor duration
            # badalte hi purani sab appointments bhi badal jayengi).
            default_duration_fallback = fee_setting.duration if fee_setting and fee_setting.duration else "30min"
            fees_obj = {
                "pkr": fee_setting.pkr if fee_setting else 0.0,
                "usd": fee_setting.usd if fee_setting else 0.0
            }

            rating_record = db.query(models.DoctorRating).filter(
                models.DoctorRating.patient_id == patient_id,
                (models.DoctorRating.scan_id == appt.scan_id) | (models.DoctorRating.appointment_id == appt.id)
            ).first()

            # Reassigned (bumped) patient ke liye live suggested slots -
            # doctor availability change ho sakti hai, isliye har fetch pe
            # taaza compute karte hain instead of storing stale data.
            suggested_slots = None
            if appt.status == "Reassigned":
                suggested_slots = find_next_available_slots(db, appt.doctor_id, appt.appointment_date, limit=3)

            results.append({
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
                # --- Conflict info ---
                "is_conflict": appt.status == "Pending-Conflict",
                "conflict_with_id": appt.conflict_with_id,
                "suggested_slots": suggested_slots
            })
            
        return generate_response(True, data=results, status_code=200)
    except Exception as e:
        logger.error(f"Patient Appointments Fetch Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()

@app.route('/api/update-appointment/<int:appt_id>', methods=['PUT'])
@doctor_required
def update_appointment_status(appt_id):
    db = SessionLocal()
    try:
        data = request.get_json()
        if not data or 'status' not in data:
            return generate_response(False, error="Status parameter is required", status_code=400)
            
        valid_statuses = ['Scheduled', 'Confirmed', 'Completed', 'Cancelled']
        new_status = data.get('status')
        cancellation_reason = data.get('reason')
        if new_status not in valid_statuses:
            return generate_response(False, error="Invalid appointment status", status_code=400)

        appt = db.query(models.Appointment).filter(models.Appointment.id == appt_id).first()
        if not appt:
            return generate_response(False, error="Appointment not found", status_code=404)
            
        if appt.doctor_id != request.current_user.get('user_id'):
            return generate_response(False, error="Unauthorized", status_code=403)

        if appt.status == "Pending-Conflict":
            return generate_response(
                False,
                error="This appointment has an active booking conflict. Use /api/resolve-conflict to resolve it first.",
                status_code=400
            )

        # BUG FIX: pehle yahan koi check nahi tha ke appointment already isi
        # status pe hai ya nahi - agar frontend se (ya double-click/race se)
        # same status dobara bheja jata, ye silently reprocess ho kar patient
        # ko dobara wahi "Status Updated" email bhi bhej deta tha. Ab clear
        # message ke sath short-circuit karte hain, koi duplicate email nahi.
        if appt.status == new_status:
            return generate_response(
                False,
                error=f"This appointment is already {new_status}.",
                status_code=400
            )

        appt.status = new_status
        if new_status == 'Cancelled':
            appt.cancellation_reason = cancellation_reason
        db.commit()
        
        try:
            patient = db.query(models.User).filter_by(id=appt.patient_id).first()
            if patient and patient.email:
                doctor = db.query(models.User).filter_by(id=appt.doctor_id).first()
                doctor_name = doctor.name if doctor else "Doctor"
                
                subject = f"Appointment Update - SkinCare Status: {new_status}"
                body = (
                    f"Dear {patient.name},\n\n"
                    f"Your appointment with Dr. {doctor_name} scheduled on {appt.appointment_date} "
                    f"has been updated.\n\n"
                    f"New Status: {new_status}\n"
                    + (f"Reason: {cancellation_reason}\n\n" if new_status == 'Cancelled' and cancellation_reason else "\n")
                    + f"Thank you for using SkinCare App."
                )
                send_email(patient.email, subject, body)
        except Exception as email_err:
            logger.warning(f"Notification Email Failure: {str(email_err)}")
            
        logger.info(f"Appointment {appt_id} status updated to {new_status}")
        return generate_response(True, message=f"Appointment status updated to {new_status}", status_code=200)
    except Exception as e:
        db.rollback()
        logger.error(f"Update Appointment Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()


# ==========================================
# 11. DELETE APPOINTMENT (TASK 3, 11)
# ==========================================
@app.route('/api/delete-appointment/<int:appt_id>', methods=['DELETE'])
@doctor_required
def delete_appointment(appt_id):
    db = SessionLocal()
    try:
        current_doctor_id = request.current_user.get('user_id')
        appt = db.query(models.Appointment).filter(models.Appointment.id == appt_id).first()
        if not appt:
            return generate_response(False, error="Appointment not found", status_code=404)
            
        if appt.doctor_id != current_doctor_id:
            return generate_response(False, error="Unauthorized to delete this appointment", status_code=403)

        # BUG FIX: pehle yahan appointment row hard-delete hoti thi - lekin
        # ye wahi row hai jo patient ki "My Appointments" history bhi use
        # karti hai (shared table, do alag listing endpoints). Doctor jab
        # apni dashboard se ek appointment "delete" karta tha, row hi DB se
        # gayab ho jati thi, isliye patient ki taraf se bhi wo booking record
        # permanently ghayab ho jati thi - bina unhe kuch pata chale, bina
        # koi notification. Ab hard-delete nahi karte - sirf doctor ki apni
        # dashboard-listing se hide karte hain (hidden_from_doctor = True).
        # Patient ka record, rating linkage, sab kuch safe/unchanged rehta hai.
        appt.hidden_from_doctor = True
        db.commit()
        logger.info(f"Appointment {appt_id} hidden from Doctor {current_doctor_id} dashboard (patient record preserved)")
        return generate_response(True, message="Appointment removed from your dashboard", status_code=200)
    except Exception as e:
        db.rollback()
        logger.error(f"Delete Appointment Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()


# ==========================================================
# 12. SECURE AI CHATBOT ROUTE
# ==========================================================
@app.route('/api/chat', methods=['POST'])
@token_optional
def chat_proxy():
    try:
        data = request.get_json()
        if not data or not data.get('message'):
            return generate_response(False, error="Message cannot be empty", status_code=400)
            
        user_message = data.get('message')
        user_role = request.current_user.get('role') if request.current_user else 'Guest'
        
        api_key = os.environ.get("GEMINI_API_KEY")
        if not api_key:
            logger.error("Gemini API key missing")
            return generate_response(False, error="Service currently unavailable", status_code=500)
            
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel('gemini-2.5-flash') 
        
        if user_role == 'Doctor':
            prompt = f"You are an advanced Medical AI Assistant helping a Dermatologist/Doctor on a SkinCare dashboard. Keep your answers highly professional, medically accurate, and concise. Do not talk to them like a patient. Doctor says: {user_message}"
        elif user_role == 'Admin':
            prompt = f"You are a System Admin AI Assistant for a SkinCare app dashboard. Help the admin with system management, general technical advice, or app overview. Admin says: {user_message}"
        else:
            prompt = f"You are a helpful and professional Medical AI Assistant for a SkinCare app. Keep your answers concise, empathetic, and strictly related to dermatology or the user's queries. Treat the user as a patient. User says: {user_message}"
        
        response = model.generate_content(
            prompt,
            generation_config=genai.types.GenerationConfig(
                max_output_tokens=800,
                temperature=0.7
            )
        )
        
        return generate_response(True, data={"reply": response.text}, status_code=200)
        
    except Exception as e:
        logger.error(f"Chatbot Error: {e}", exc_info=True)
        return generate_response(False, error="AI service error", status_code=500)


# ==========================================
# 13. REAL RATING SYSTEM ENDPOINTS
# ==========================================
@app.route('/api/rate-doctor', methods=['POST'])
@patient_required
def submit_doctor_rating():
    db = SessionLocal()
    try:
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
    except Exception as e:
        db.rollback()
        logger.error(f"Rate Doctor Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()

@app.route('/api/doctor/ratings', methods=['GET'])
@doctor_required
def get_live_doctor_reviews():
    db = SessionLocal()
    try:
        doctor_id = request.current_user.get('user_id')
        ratings = db.query(models.DoctorRating).filter_by(doctor_id=doctor_id).order_by(models.DoctorRating.created_at.desc()).all()
        
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
                "date": r.created_at.strftime("%b %d, %Y") if r.created_at else None
            })
            
        avg_rating = (total_stars / len(ratings)) if len(ratings) > 0 else 0.0
        
        data = {
            "average": round(avg_rating, 1),
            "total": len(ratings),
            "reviews": reviews_list
        }
        return generate_response(True, data=data, status_code=200)
    except Exception as e:
        logger.error(f"Doctor Ratings Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()

@app.route('/doctor/ratings/<int:doctor_id>', methods=['GET'])
def get_doctor_reviews_by_id(doctor_id):
    db = SessionLocal()
    try:
        ratings = db.query(models.DoctorRating).filter_by(doctor_id=doctor_id).order_by(models.DoctorRating.created_at.desc()).all()
        
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
                "date": r.created_at.strftime("%b %d, %Y") if r.created_at else None
            })
            
        avg_rating = (total_stars / len(ratings)) if len(ratings) > 0 else 0.0
        
        return generate_response(True, data={
            "average_rating": round(avg_rating, 1),
            "rating_count": len(ratings),
            "reviews": reviews_list
        }, status_code=200)
    except Exception as e:
        logger.error(f"Fetch Doctor Ratings Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()


# ==========================================
# DOCTOR PROFILE GET & UPDATE API
# ==========================================
@app.route('/api/doctor/profile', methods=['GET', 'POST'])
@doctor_required
def manage_doctor_profile():
    db = SessionLocal()
    try:
        doctor_id = request.current_user.get('user_id')

        user = db.query(models.User).filter_by(id=doctor_id).first()
        profile = db.query(models.DoctorProfile).filter_by(user_id=doctor_id).first()
        fees = db.query(models.DoctorFees).filter_by(doctor_id=doctor_id).first()

        if request.method == 'GET':
            if not user:
                return generate_response(False, error="User not found", status_code=404)
            
            img_path = profile.profile_image if profile and profile.profile_image else None
            if img_path and not img_path.startswith('/'):
                img_path = "/" + img_path

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
                if name: user.name = name
                # BUG FIX: email change pehle bina kisi duplicate-check ke direct
                # commit ho jata tha — DB ka unique constraint IntegrityError
                # phenkta tha jo generic "Internal server error" (500) ban jata
                # tha, jabke /register mein yehi case clear message ke saath
                # handle hota hai. Ab yahan bhi explicit, consistent check hai.
                if email and email != user.email:
                    existing_email = db.query(models.User).filter(
                        models.User.email == email,
                        models.User.id != doctor_id
                    ).first()
                    if existing_email:
                        return generate_response(False, error="This email is already registered with another account.", status_code=400)
                    user.email = email

            if not profile:
                profile = models.DoctorProfile(user_id=doctor_id)
                db.add(profile)

            if specialty: 
                profile.specialty = specialty
                    
            if hospital: profile.hospital = hospital
            if city: profile.city = city
            if phone: profile.phone = phone

            # License add/update: agar naya license diya gaya hai aur wo current se
            # different hai, to verification_status wapis 'pending' pe daal dete hain —
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
                        if existing:
                            return generate_response(False, error="This license number is already registered with another account.", status_code=400)
                    except Exception:
                        pass
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
                if file and file.filename != '' and allowed_file(file.filename):
                    upload_folder = app.config.get('UPLOAD_FOLDER', 'static/uploads')
                    os.makedirs(upload_folder, exist_ok=True)
                    
                    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                    secure_name = secure_filename(file.filename)
                    filename = f"doc_{doctor_id}_{timestamp}_{secure_name}"
                    full_path = os.path.join(upload_folder, filename)
                    file.save(full_path)
                    
                    profile.profile_image = f"static/uploads/{filename}"

            db.commit()
            logger.info(f"Doctor Profile Updated: {doctor_id}")
            return generate_response(True, message="Profile updated successfully!", status_code=200)

    except Exception as e:
        db.rollback()
        logger.error(f"Doctor Profile Update Error: {e}", exc_info=True)
        return generate_response(False, error="Internal server error", status_code=500)
    finally:
        db.close()

# ==========================================
# SLA CONFLICT AUTO-RESOLVE SCHEDULER
# ==========================================
scheduler = BackgroundScheduler()
scheduler.add_job(func=resolve_expired_conflicts, trigger="interval", minutes=15, id="conflict_sla_job")
scheduler.start()
atexit.register(lambda: scheduler.shutdown(wait=False))

# Start Server
if __name__ == '__main__':
    app.run(debug=False, host='0.0.0.0', port=5000)