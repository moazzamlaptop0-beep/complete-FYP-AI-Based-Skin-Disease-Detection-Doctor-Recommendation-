"""
Central configuration for the AI Dermatologist backend.

Every magic literal that used to be scattered through the 3296-line
`app.py` monolith lives here now. The DEFAULTS ARE THE MONOLITH'S VALUES --
changing any of them changes runtime behaviour, so treat them as contract.

Config selection order inside create_app():
    explicit argument  ->  $APP_ENV  ->  $FLASK_ENV  ->  "development"
"""

import os
import warnings

from dotenv import load_dotenv

load_dotenv()

# Repository root: .../FYP-backend  (this file is .../FYP-backend/app/config.py)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# The secret that was hard-coded in app.py:35. Kept EXACTLY as-is: every JWT
# already issued to a logged-in browser was signed with this fallback, so
# changing it logs every in-flight user out.
LEGACY_DEFAULT_JWT_SECRET = "AI_Derma_Super_Secret_Key_9988_Strong_And_Secure_2026"


def _env_bool(name, default=False):
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


def _env_int(name, default):
    raw = os.environ.get(name)
    if raw is None or str(raw).strip() == "":
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


class BaseConfig:
    # ------------------------------------------------------------------
    # Flask core
    # ------------------------------------------------------------------
    # app.py:35 -- os.environ.get("JWT_SECRET", <literal>)
    SECRET_KEY = os.environ.get("JWT_SECRET", LEGACY_DEFAULT_JWT_SECRET)
    JSON_SORT_KEYS = True          # Flask 3.1 default; flipping it changes bytes
    PROPAGATE_EXCEPTIONS = None

    # app.py:38 -- 10 MB
    MAX_CONTENT_LENGTH = 10 * 1024 * 1024

    # ------------------------------------------------------------------
    # Uploads / storage
    # ------------------------------------------------------------------
    # app.py:36 used the RELATIVE string 'static/uploads', which only resolved
    # correctly when the process CWD happened to be FYP-backend. We store the
    # absolute path (identical target directory, CWD-independent). The public
    # URL string written into ai_scans.image_url stays the literal
    # "static/uploads/<file>" -- see app/services/storage_service.py.
    UPLOAD_FOLDER = os.path.join(BASE_DIR, "static", "uploads")
    UPLOAD_URL_PREFIX = "static/uploads"          # NO leading slash (contract)
    ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}

    # ------------------------------------------------------------------
    # Database
    # ------------------------------------------------------------------
    DATABASE_URL = os.environ.get("DATABASE_URL")
    SQLALCHEMY_ECHO = _env_bool("SQLALCHEMY_ECHO", False)
    DB_POOL_PRE_PING = True
    DB_POOL_SIZE = _env_int("DB_POOL_SIZE", 5)
    DB_MAX_OVERFLOW = _env_int("DB_MAX_OVERFLOW", 10)

    # Alembic owns the schema. create_all() must NOT run in the boot path.
    AUTO_CREATE_ALL = _env_bool("AUTO_CREATE_ALL", False)

    # ------------------------------------------------------------------
    # Auth / tokens
    # ------------------------------------------------------------------
    JWT_ALGORITHM = "HS256"
    # app.py login(): exp = utcnow() + timedelta(hours=24). Drops to 2 once
    # refresh tokens ship; until then 24 keeps existing sessions alive.
    ACCESS_TOKEN_HOURS = _env_int("ACCESS_TOKEN_HOURS", 24)
    REFRESH_TOKEN_DAYS = _env_int("REFRESH_TOKEN_DAYS", 30)
    PASSWORD_MIN_LENGTH = _env_int("PASSWORD_MIN_LENGTH", 8)
    ROOT_ADMIN_PASSWORD_MIN_LENGTH = 12
    # The server-side password policy also runs on the two LEGACY routes
    # (/register, /reset-password). A policy the old endpoint can bypass is not
    # a policy. Set false to restore the monolith's "anything goes".
    ENFORCE_PASSWORD_POLICY_LEGACY = _env_bool("ENFORCE_PASSWORD_POLICY_LEGACY", True)

    # Reject an access token whose `tv` claim is behind users.token_version, so
    # /auth/logout-all and a password reset really do end every session. Missing
    # `tv` counts as 0 -- see app/core/rbac.session_is_current.
    ENFORCE_SESSION_VERSION = _env_bool("ENFORCE_SESSION_VERSION", True)

    # Doctor licence enforcement. USER DECISION: existing doctors were
    # auto-approved by migration 8a1c4b0d55e2, so turning this ON only ever
    # affects doctors who sign up from now on. Read routes stay open (a pending
    # doctor must still be able to see their own empty dashboard + the pending
    # screen); only WRITE routes carry require_doctor_approved=True.
    ENFORCE_DOCTOR_VERIFICATION = _env_bool("ENFORCE_DOCTOR_VERIFICATION", True)

    # Admin "act as user" delegation (X-Act-As-User-Id header).
    ALLOW_ACT_AS = _env_bool("ALLOW_ACT_AS", True)
    ACT_AS_HEADER = "X-Act-As-User-Id"

    # ------------------------------------------------------------------
    # OTP  (app.py:234-235, 396)
    # ------------------------------------------------------------------
    OTP_EXPIRY_MINUTES = _env_int("OTP_EXPIRY_MINUTES", 10)
    OTP_MAX_ATTEMPTS = _env_int("OTP_MAX_ATTEMPTS", 5)
    OTP_RESEND_COOLDOWN_SECONDS = _env_int("OTP_RESEND_COOLDOWN_SECONDS", 45)
    OTP_LENGTH = 6

    # ------------------------------------------------------------------
    # Appointments / conflicts  (app.py:2570, 2577-2578)
    # ------------------------------------------------------------------
    # THE CLINIC'S WALL CLOCK. Doctors type their availability as local
    # "09:00-17:00" and appointment_time / slot_start are stored in that same
    # naive local frame -- but every "is this slot in the past?" test compared
    # them against datetime.utcnow(). At UTC+5 that made a five-hour rolling
    # window of already-passed slots render as "available" and pass the booking
    # guards every single day. app.services.scheduling_service.clinic_now() is
    # the one conversion point. Set CLINIC_TZ=UTC to restore the old behaviour;
    # an unknown zone name falls back to UTC with a warning.
    CLINIC_TZ = os.environ.get("CLINIC_TZ", "Asia/Karachi")

    CONFLICT_SLA_HOURS = _env_int("CONFLICT_SLA_HOURS", 4)
    CONFLICT_SLA_JOB_MINUTES = _env_int("CONFLICT_SLA_JOB_MINUTES", 15)
    # How often Open appointment_requests past their expires_at are closed.
    REQUEST_EXPIRY_JOB_MINUTES = _env_int("REQUEST_EXPIRY_JOB_MINUTES", 15)
    # /readyz answers 503 when a model class has no explicit triage tier. Set
    # false to downgrade that to an informational field. See app/api/health.py.
    TRIAGE_COVERAGE_FATAL = _env_bool("TRIAGE_COVERAGE_FATAL", True)
    APPOINTMENT_DATE_FORMATS = ["%Y-%m-%d", "%a, %b %d, %Y", "%A, %b %d, %Y", "%b %d, %Y"]
    APPOINTMENT_TIME_FORMATS = ["%H:%M", "%I:%M %p"]
    DEFAULT_SLOT_DURATION = "30min"
    # /api/slots deliberately falls back to '60min' where every other code path
    # falls back to '30min' (app.py:2177). Preserved.
    SLOTS_FALLBACK_DURATION = "60min"

    # ------------------------------------------------------------------
    # SMTP  (app.py:198-219)
    # ------------------------------------------------------------------
    SMTP_HOST = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    SMTP_PORT = _env_int("SMTP_PORT", 465)
    SMTP_USE_SSL = _env_bool("SMTP_USE_SSL", True)
    EMAIL_USER = os.environ.get("EMAIL_USER")
    EMAIL_PASS = os.environ.get("EMAIL_PASS")
    EMAIL_TIMEOUT_SECONDS = _env_int("EMAIL_TIMEOUT_SECONDS", 20)

    # ------------------------------------------------------------------
    # Gemini  (app.py:2985-3006)
    # ------------------------------------------------------------------
    GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY")
    GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    GEMINI_MAX_OUTPUT_TOKENS = _env_int("GEMINI_MAX_OUTPUT_TOKENS", 800)
    GEMINI_TEMPERATURE = 0.7

    # ------------------------------------------------------------------
    # ML model
    # ------------------------------------------------------------------
    MODEL_WEIGHTS_PATH = os.environ.get(
        "MODEL_WEIGHTS_PATH",
        os.path.join(BASE_DIR, "skindisease_best_model.weights.h5"),
    )
    # Load TensorFlow eagerly at boot? The monolith did (import test_model at
    # line 4) and died with SystemExit when the weights were missing.
    EAGER_MODEL_LOAD = _env_bool("EAGER_MODEL_LOAD", False)

    # ------------------------------------------------------------------
    # CORS  (app.py:33 -- CORS(app), i.e. wide open)
    # ------------------------------------------------------------------
    CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "*")
    CORS_SUPPORTS_CREDENTIALS = _env_bool("CORS_SUPPORTS_CREDENTIALS", False)

    # ------------------------------------------------------------------
    # SSE streams  (app.py:1280-1587)
    # ------------------------------------------------------------------
    STREAM_POLL_SECONDS = _env_int("STREAM_POLL_SECONDS", 5)
    STREAM_SCAN_LIMIT = _env_int("STREAM_SCAN_LIMIT", 20)

    # ------------------------------------------------------------------
    # Background scheduler  (app.py:3290-3293)
    # ------------------------------------------------------------------
    # The monolith started APScheduler at import, so every gunicorn worker ran
    # its own copy of the SLA job. Off by default now; run.py / wsgi.py turn it
    # on for exactly one process.
    RUN_SCHEDULER = _env_bool("RUN_SCHEDULER", False)

    # ------------------------------------------------------------------
    # Rate limiting
    # ------------------------------------------------------------------
    RATELIMIT_ENABLED = _env_bool("RATELIMIT_ENABLED", False)
    RATELIMIT_STORAGE_URI = os.environ.get("RATELIMIT_STORAGE_URI", "memory://")
    RATELIMIT_DEFAULT = os.environ.get("RATELIMIT_DEFAULT", "600 per hour")
    RATELIMIT_HEADERS_ENABLED = True
    # memory:// is PER PROCESS. Under gunicorn with N workers the effective
    # budget is N x the number below, and a restart forgets everything. Point
    # RATELIMIT_STORAGE_URI at redis:// before this is a real defence.
    RATELIMIT_STORAGE_WARNING = True

    # ------------------------------------------------------------------
    # Errors / logging
    # ------------------------------------------------------------------
    # The monolith registered ZERO error handlers, so 404/405/413 and unhandled
    # 500s leaked Flask's HTML pages out of a JSON API. Turning this on makes
    # them emit the {success,error} envelope instead. Every frontend call site
    # gates on `res.ok` before parsing, so this is safe -- but if a regression
    # ever appears, set JSON_ERROR_RESPONSES=false to get the old behaviour back
    # without a code change.
    JSON_ERROR_RESPONSES = _env_bool("JSON_ERROR_RESPONSES", True)
    LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
    LOG_FORMAT = "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    LOG_FILE = os.environ.get("LOG_FILE")  # None => stdout only

    # ------------------------------------------------------------------
    # Seeds
    # ------------------------------------------------------------------
    ROOT_ADMIN_EMAIL = os.environ.get("ROOT_ADMIN_EMAIL")
    ROOT_ADMIN_PASSWORD = os.environ.get("ROOT_ADMIN_PASSWORD")
    ROOT_ADMIN_NAME = os.environ.get("ROOT_ADMIN_NAME", "Root Administrator")

    ENV_NAME = "base"
    DEBUG = False
    TESTING = False

    @classmethod
    def validate(cls):
        """Called by create_app() right after config load. Raise to refuse boot."""
        return None


class DevelopmentConfig(BaseConfig):
    ENV_NAME = "development"
    DEBUG = True

    @classmethod
    def validate(cls):
        if not cls.SECRET_KEY or cls.SECRET_KEY == LEGACY_DEFAULT_JWT_SECRET:
            warnings.warn(
                "JWT_SECRET is unset or still the committed default value. "
                "This is tolerated in development but ProductionConfig will "
                "refuse to boot with it.",
                RuntimeWarning,
                stacklevel=2,
            )
        if not cls.DATABASE_URL:
            warnings.warn(
                "DATABASE_URL is not set; database access will fail.",
                RuntimeWarning,
                stacklevel=2,
            )
        return None


class TestingConfig(BaseConfig):
    ENV_NAME = "testing"
    TESTING = True
    DEBUG = True
    RUN_SCHEDULER = False
    RATELIMIT_ENABLED = False
    EAGER_MODEL_LOAD = False
    AUTO_CREATE_ALL = True          # tests build their own throwaway schema
    DATABASE_URL = os.environ.get("TEST_DATABASE_URL") or os.environ.get("DATABASE_URL")
    SECRET_KEY = os.environ.get("JWT_SECRET", LEGACY_DEFAULT_JWT_SECRET)

    @classmethod
    def validate(cls):
        return None


class ProductionConfig(BaseConfig):
    ENV_NAME = "production"
    DEBUG = False
    RATELIMIT_ENABLED = _env_bool("RATELIMIT_ENABLED", True)

    @classmethod
    def validate(cls):
        secret = os.environ.get("JWT_SECRET")
        if not secret:
            raise RuntimeError(
                "REFUSING TO BOOT: JWT_SECRET is not set. Production must not "
                "fall back to the committed default signing key."
            )
        if secret == LEGACY_DEFAULT_JWT_SECRET:
            raise RuntimeError(
                "REFUSING TO BOOT: JWT_SECRET is still the committed default "
                "value. Generate a fresh one, e.g. "
                "python -c \"import secrets; print(secrets.token_urlsafe(64))\""
            )
        if len(secret) < 32:
            raise RuntimeError(
                "REFUSING TO BOOT: JWT_SECRET must be at least 32 characters."
            )
        if not cls.DATABASE_URL:
            raise RuntimeError("REFUSING TO BOOT: DATABASE_URL is not set.")
        return None


CONFIG_MAP = {
    "base": BaseConfig,
    "development": DevelopmentConfig,
    "dev": DevelopmentConfig,
    "testing": TestingConfig,
    "test": TestingConfig,
    "production": ProductionConfig,
    "prod": ProductionConfig,
}


def get_config(config_name=None):
    """Resolve a config class from an explicit name or the environment."""
    name = (
        config_name
        or os.environ.get("APP_ENV")
        or os.environ.get("FLASK_ENV")
        or "development"
    )
    return CONFIG_MAP.get(str(name).strip().lower(), DevelopmentConfig)
