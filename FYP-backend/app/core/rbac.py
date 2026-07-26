"""
Role-Based Access Control -- the centrepiece of the refactor.

WHY THIS EXISTS
---------------
The monolith had five near-identical decorators that each hard-coded ONE role
string. That is why a doctor could not also be a patient: `@patient_required`
literally rejected `role == 'Doctor'`, so a dermatologist who wanted their own
mole scanned had to create a SECOND account with a second email. Here the role
hierarchy is built by explicit set union --

    DOCTOR_PERMS = PATIENT_PERMS | {...}
    ADMIN_PERMS  = DOCTOR_PERMS  | {...}

-- so a Doctor genuinely holds every Patient permission and can scan and book on
their own account, and an Admin genuinely holds every Doctor permission.

HARD CONSTRAINTS (do not "clean up")
------------------------------------
* The role strings stored in `users.role` and inside every issued JWT are
  exactly 'Admin', 'Doctor', 'AI User'. They are NOT renamed. Role.DOCTOR.value
  IS the database value.
* JWT claims stay `user_id` and `role` so tokens already sitting in browsers
  keep decoding.
* `patient_required` also accepted the legacy literal 'Patient'
  (monolith line 182). That branch is absorbed by ROLE_ALIASES.
* Decorators set `request.current_user` (an attribute ON THE REQUEST OBJECT,
  not flask.g) because every ported handler body reads it.
"""

import datetime
import logging
from dataclasses import dataclass, field
from enum import Enum
from functools import wraps

import jwt
from flask import current_app, g, has_app_context, request

from app.core.responses import generate_response

logger = logging.getLogger(__name__)


# ======================================================================
# ROLES
# ======================================================================
class Role(str, Enum):
    """DB/JWT role literals. The .value IS the stored string -- never rename."""

    ADMIN = "Admin"
    DOCTOR = "Doctor"
    PATIENT = "AI User"


# Every spelling that has ever reached this codebase, mapped to a canonical Role.
# 'Patient' is the dead branch from monolith line 182; 'ai_derma' shows up in
# some older seed data.
ROLE_ALIASES = {
    "admin": Role.ADMIN,
    "administrator": Role.ADMIN,
    "doctor": Role.DOCTOR,
    "dr": Role.DOCTOR,
    "ai user": Role.PATIENT,
    "aiuser": Role.PATIENT,
    "ai_user": Role.PATIENT,
    "patient": Role.PATIENT,
    "ai_derma": Role.PATIENT,
    "user": Role.PATIENT,
}

# Strict rank ordering. Delegation ("act as") requires STRICTLY greater rank.
ROLE_RANK = {
    Role.PATIENT: 100,
    Role.DOCTOR: 200,
    Role.ADMIN: 300,
}


def normalize_role(value):
    """Any spelling -> Role, or None when unrecognised."""
    if value is None:
        return None
    if isinstance(value, Role):
        return value
    text = str(value).strip()
    if not text:
        return None
    for role in Role:
        if role.value == text:
            return role
    return ROLE_ALIASES.get(text.lower())


def role_rank(value):
    role = normalize_role(value)
    return ROLE_RANK.get(role, 0)


# ======================================================================
# PERMISSIONS
# ======================================================================
class Permission(str, Enum):
    # --- scans -------------------------------------------------------
    SCAN_CREATE = "scan.create"
    SCAN_READ_OWN = "scan.read.own"
    SCAN_READ_ANY = "scan.read.any"
    SCAN_SEND_REPORT = "scan.send_report"
    SCAN_REVIEW_ASSIGNED = "scan.review.assigned"
    SCAN_REVIEW_ANY = "scan.review.any"
    SCAN_DELETE_ASSIGNED = "scan.delete.assigned"
    SCAN_DELETE_ANY = "scan.delete.any"
    SCAN_OVERRIDE_SEVERITY = "scan.override_severity"

    # --- appointments ------------------------------------------------
    APPOINTMENT_BOOK = "appointment.book"
    APPOINTMENT_READ_OWN = "appointment.read.own"
    APPOINTMENT_READ_ANY = "appointment.read.any"
    APPOINTMENT_MANAGE_OWN = "appointment.manage.own"
    APPOINTMENT_MANAGE_ANY = "appointment.manage.any"
    APPOINTMENT_RESOLVE_CONFLICT = "appointment.resolve_conflict"

    # --- schedule / doctor profile -----------------------------------
    SCHEDULE_MANAGE = "schedule.manage"
    DOCTOR_PROFILE_MANAGE = "doctor.profile.manage"
    DOCTOR_VERIFY = "doctor.verify"

    # --- ratings -----------------------------------------------------
    RATING_CREATE = "rating.create"
    RATING_READ = "rating.read"

    # --- admin / platform --------------------------------------------
    USER_READ_ANY = "user.read.any"
    # Suspending or reactivating an account. Distinct from DOCTOR_VERIFY:
    # "this licence is genuine" and "this person may sign in" are different
    # decisions and should not be gated by the same permission, even though
    # both currently belong to Admin alone.
    USER_MANAGE_ANY = "user.manage.any"
    ADMIN_STATS = "admin.stats"
    ADMIN_AUDIT_READ = "admin.audit.read"
    ACTOR_ACT_AS = "actor.act_as"


# ----------------------------------------------------------------------
# ROLE -> PERMISSIONS, built by EXPLICIT SET UNION so the hierarchy is real.
# ----------------------------------------------------------------------
PATIENT_PERMS = frozenset({
    Permission.SCAN_CREATE,
    Permission.SCAN_READ_OWN,
    Permission.SCAN_SEND_REPORT,
    Permission.APPOINTMENT_BOOK,
    Permission.APPOINTMENT_READ_OWN,
    Permission.APPOINTMENT_MANAGE_OWN,
    Permission.RATING_CREATE,
    Permission.RATING_READ,
})

# A Doctor IS a patient plus clinical powers. This union is the whole point of
# the refactor -- it is what removes the need for a second account.
DOCTOR_PERMS = PATIENT_PERMS | frozenset({
    Permission.SCAN_REVIEW_ASSIGNED,
    Permission.SCAN_DELETE_ASSIGNED,
    Permission.SCAN_OVERRIDE_SEVERITY,
    Permission.APPOINTMENT_RESOLVE_CONFLICT,
    Permission.SCHEDULE_MANAGE,
    Permission.DOCTOR_PROFILE_MANAGE,
})

# An Admin IS a doctor plus platform powers.
ADMIN_PERMS = DOCTOR_PERMS | frozenset({
    Permission.SCAN_READ_ANY,
    Permission.SCAN_REVIEW_ANY,
    Permission.SCAN_DELETE_ANY,
    Permission.APPOINTMENT_READ_ANY,
    Permission.APPOINTMENT_MANAGE_ANY,
    Permission.DOCTOR_VERIFY,
    Permission.USER_READ_ANY,
    Permission.USER_MANAGE_ANY,
    Permission.ADMIN_STATS,
    Permission.ADMIN_AUDIT_READ,
    Permission.ACTOR_ACT_AS,
})

ROLE_PERMISSIONS = {
    Role.PATIENT: PATIENT_PERMS,
    Role.DOCTOR: DOCTOR_PERMS,
    Role.ADMIN: ADMIN_PERMS,
}


def permissions_for(role):
    return ROLE_PERMISSIONS.get(normalize_role(role), frozenset())


# ======================================================================
# ACTOR
# ======================================================================
@dataclass(frozen=True)
class Actor:
    """Who is performing the current request.

    `id`/`role`/`permissions` describe the EFFECTIVE identity. When an admin is
    acting as another user, `id` and `role` are the TARGET's and `principal_id`
    is the admin who is really driving -- so audit logs and 403 messages can
    always name the human.
    """

    id: int
    role: Role
    permissions: frozenset = field(default_factory=frozenset)
    is_root: bool = False
    principal_id: int = None

    def can(self, perm):
        return perm in self.permissions

    def can_all(self, perms):
        return all(p in self.permissions for p in perms)

    def can_any(self, perms):
        return any(p in self.permissions for p in perms)

    @property
    def is_delegated(self):
        return self.principal_id is not None and self.principal_id != self.id

    @property
    def rank(self):
        return ROLE_RANK.get(self.role, 0)

    def to_current_user(self):
        """The dict shape every ported handler body expects on request.current_user."""
        return {"user_id": self.id, "role": self.role.value}


def build_actor(user_id, role, is_root=False, principal_id=None, permissions=None):
    resolved = normalize_role(role)
    if resolved is None:
        return None
    return Actor(
        id=int(user_id),
        role=resolved,
        permissions=frozenset(permissions) if permissions is not None else permissions_for(resolved),
        is_root=bool(is_root),
        principal_id=principal_id,
    )


def current_actor():
    """The effective identity, or None.

    Deliberately safe to call OUTSIDE an application context (CLI commands, the
    APScheduler job, unit tests): touching flask.g there raises RuntimeError,
    and an authorization helper that explodes instead of denying is a footgun.
    """
    if not has_app_context():
        return None
    return getattr(g, "actor", None)


def current_principal():
    if not has_app_context():
        return None
    return getattr(g, "principal", None)


# ======================================================================
# OWNERSHIP -- the single primitive every route uses
# ======================================================================
def resolve_actor(target_user_id, own_perm, any_perm, actor=None):
    """True when the actor may act on `target_user_id`'s data.

    Allowed if EITHER
      * the actor IS that user and holds `own_perm`   (self-service), OR
      * the actor holds `any_perm`                    (staff override).

    This one function replaces every ad-hoc
    `if scan.user_id != request.current_user.get('user_id'): 403`
    scattered through the monolith.
    """
    actor = actor or current_actor()
    if actor is None:
        return False
    try:
        target = int(target_user_id)
    except (TypeError, ValueError):
        return False
    if actor.id == target and (own_perm is None or actor.can(own_perm)):
        return True
    return any_perm is not None and actor.can(any_perm)


# ======================================================================
# JWT PLUMBING
# ======================================================================
def get_token_data(req):
    """Verbatim from monolith line 93."""
    auth_header = req.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        return auth_header.split(" ")[1]
    return None


def _secret():
    return current_app.config["SECRET_KEY"]


def decode_token(token):
    return jwt.decode(token, _secret(), algorithms=[current_app.config.get("JWT_ALGORITHM", "HS256")])


# Error strings copied EXACTLY from the monolith. Changing them changes what the
# frontend shows the user.
ERR_TOKEN_MISSING = "Token is missing! Unauthorized access."
ERR_TOKEN_EXPIRED = "Session expired! Please login again."
ERR_TOKEN_INVALID = "Invalid Token!"
ERR_FORBIDDEN = "Access denied!"
ERR_ADMIN_ONLY = "Access denied! Only Admins allowed."
ERR_DOCTOR_ONLY = "Access denied! Only Doctors allowed."
ERR_PATIENT_ONLY = "Access denied! Only Patients allowed."


def _reset_request_identity():
    g.actor = None
    g.principal = None
    request.current_user = None


# ======================================================================
# DELEGATION ("act as")
# ======================================================================
def _load_user_row(db, user_id):
    from app.models import User

    return db.query(User).filter(User.id == int(user_id)).first()


def _write_audit(db, actor_user_id, subject_user_id, action, detail=None,
                 target_type=None, target_id=None):
    from app.models import AuditLog

    entry = AuditLog(
        actor_user_id=actor_user_id,
        subject_user_id=subject_user_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        detail=detail,
        ip=request.headers.get("X-Forwarded-For", request.remote_addr),
        user_agent=(request.headers.get("User-Agent") or "")[:255],
        created_at=datetime.datetime.now(datetime.timezone.utc),
    )
    db.add(entry)
    return entry


def _apply_delegation(principal):
    """Handle the X-Act-As-User-Id header.

    Returns (actor, error_tuple). `error_tuple` is a ready-to-return Flask
    response when delegation was requested but refused.

    Act-as is READ-WRITE: the admin genuinely performs the action as the target,
    which is why every use writes an audit_logs row.
    """
    header = current_app.config.get("ACT_AS_HEADER", "X-Act-As-User-Id")
    raw = request.headers.get(header)
    if not raw:
        return principal, None

    if not current_app.config.get("ALLOW_ACT_AS", True):
        return None, generate_response(False, error="Delegation is disabled.", status_code=403)

    if not principal.can(Permission.ACTOR_ACT_AS):
        logger.warning("Act-as refused: user %s lacks %s", principal.id, Permission.ACTOR_ACT_AS.value)
        return None, generate_response(False, error="Access denied! Delegation not permitted.", status_code=403)

    try:
        target_id = int(raw)
    except (TypeError, ValueError):
        return None, generate_response(False, error="Invalid delegation target.", status_code=400)

    if target_id == principal.id:
        return principal, None

    from app.core.db import SessionLocal

    db = SessionLocal()
    try:
        target = _load_user_row(db, target_id)
        if not target:
            return None, generate_response(False, error="Delegation target not found.", status_code=404)

        if getattr(target, "is_root", False):
            logger.warning("Act-as refused: %s tried to act as root user %s", principal.id, target_id)
            return None, generate_response(
                False, error="Access denied! Cannot act as a root account.", status_code=403
            )

        if getattr(target, "is_active", True) is False:
            return None, generate_response(False, error="Delegation target is deactivated.", status_code=403)

        target_role = normalize_role(target.role)
        if target_role is None:
            return None, generate_response(False, error="Delegation target has an unknown role.", status_code=403)

        # STRICTLY higher rank. Admin -> Admin is refused on purpose.
        if ROLE_RANK.get(principal.role, 0) <= ROLE_RANK.get(target_role, 0):
            logger.warning(
                "Act-as refused: %s (%s) is not strictly senior to %s (%s)",
                principal.id, principal.role.value, target_id, target_role.value,
            )
            return None, generate_response(
                False, error="Access denied! Cannot act as an equal or higher role.", status_code=403
            )

        # The delegate can never gain a permission the principal does not hold.
        effective = frozenset(ROLE_PERMISSIONS.get(target_role, frozenset())) & frozenset(principal.permissions)

        actor = Actor(
            id=target_id,
            role=target_role,
            permissions=effective,
            is_root=bool(getattr(target, "is_root", False)),
            principal_id=principal.id,
        )

        _write_audit(
            db,
            actor_user_id=principal.id,
            subject_user_id=target_id,
            action="act_as",
            target_type="user",
            target_id=target_id,
            detail=f"{request.method} {request.path}",
        )
        db.commit()
        return actor, None
    except Exception as exc:  # pragma: no cover - defensive
        db.rollback()
        logger.error("Delegation failure: %s", exc, exc_info=True)
        return None, generate_response(False, error="Delegation failed.", status_code=500)
    finally:
        db.close()


# ======================================================================
# SESSION FRESHNESS  (token_version / is_active)
# ======================================================================
ERR_SESSION_REVOKED = "Session ended. Please login again."
ERR_ACCOUNT_DISABLED = "This account has been deactivated."


def session_is_current(claims):
    """(ok, error_message) for an already-signature-verified claim dict.

    Rejects when
      * `typ` is present and is not 'access'  -- a non-session token must never
        authenticate an API call, and
      * the account is deactivated, or
      * the token's `tv` is behind users.token_version, i.e. someone hit
        /auth/logout-all (or a password reset) after this token was minted.

    THE TWO FALLBACKS ARE LOAD-BEARING
    ----------------------------------
    A token minted before this phase has NO `tv` and NO `typ`. Missing `tv` is
    read as 0 and missing `typ` as 'access' (app.core.security.claim_*), so a
    browser that is logged in right now stays logged in -- until the user
    deliberately bumps their token_version, at which point tv=0 < 1 and the old
    token dies exactly as intended.

    FAIL-OPEN ON INFRASTRUCTURE FAILURE, FAIL-CLOSED ON A REAL MISMATCH
    ------------------------------------------------------------------
    No user row (a token for a deleted or never-existent id) and any database
    error both return ok=True: that is the monolith's behaviour, which did no
    lookup at all, and a DB outage should surface as the route's own 500 rather
    than as a fleet-wide forced logout. An actual version mismatch is a refusal.
    """
    from app.core.security import claim_token_type, claim_token_version

    if claim_token_type(claims) != "access":
        return False, ERR_TOKEN_INVALID

    user_id = (claims or {}).get("user_id")
    if user_id is None:
        return True, None

    from app.core.db import SessionLocal

    try:
        db = SessionLocal()
    except Exception:  # pragma: no cover - engine not configured (pure unit tests)
        return True, None

    try:
        user = _load_user_row(db, user_id)
        if user is None:
            return True, None
        if getattr(user, "is_active", True) is False:
            return False, ERR_ACCOUNT_DISABLED
        stored = int(getattr(user, "token_version", 0) or 0)
        if claim_token_version(claims) != stored:
            logger.info("Stale token rejected for user %s (tv=%s, stored=%s)",
                        user_id, claim_token_version(claims), stored)
            return False, ERR_SESSION_REVOKED
        return True, None
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Session freshness check skipped (%s)", exc)
        return True, None
    finally:
        try:
            db.close()
        except Exception:  # pragma: no cover
            pass


def _doctor_is_approved(doctor_id):
    from app.core.db import SessionLocal
    from app.models import DoctorProfile

    db = SessionLocal()
    try:
        profile = db.query(DoctorProfile).filter(DoctorProfile.user_id == int(doctor_id)).first()
        return bool(profile and profile.verification_status == "approved")
    finally:
        db.close()


# ======================================================================
# THE DECORATOR
# ======================================================================
def require_permission(*perms, owner_param=None, owner_perm=None, optional=False,
                       require_doctor_approved=False, denied_message=None):
    """Authenticate, resolve delegation, then authorise.

    Parameters
    ----------
    *perms
        Permissions the actor must hold (ALL of them) to pass the "any-scope"
        check. Pass none to require authentication only.
    owner_param
        Name of a view kwarg holding the id of the user who owns the resource
        (e.g. `user_id` in /patient/scans/<int:user_id>). When the actor IS that
        user and holds `owner_perm`, the request is allowed even without *perms.
    owner_perm
        The self-service permission checked against `owner_param`.
    optional
        Do not 401 when no/!invalid token is present -- g.actor and
        request.current_user are simply None. This is the `@token_optional`
        replacement used by /api/chat.
    require_doctor_approved
        403 a Doctor whose licence is not 'approved'. Only enforced when
        config ENFORCE_DOCTOR_VERIFICATION is True (default False today).
    denied_message
        Exact 403 error string, so ported routes can keep the monolith's
        wording ("Access denied! Only Doctors allowed." etc.).

    Side effects on success
    -----------------------
    g.principal          -> the human whose token this is
    g.actor              -> the effective identity (== principal unless act-as)
    request.current_user -> {'user_id': ..., 'role': ...}  (backward compat)
    """

    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            _reset_request_identity()
            token = get_token_data(request)

            if not token:
                if optional:
                    return f(*args, **kwargs)
                return generate_response(False, error=ERR_TOKEN_MISSING, status_code=401)

            try:
                claims = decode_token(token)
            except jwt.ExpiredSignatureError:
                if optional:
                    return f(*args, **kwargs)
                return generate_response(False, error=ERR_TOKEN_EXPIRED, status_code=401)
            except jwt.InvalidTokenError:
                if optional:
                    return f(*args, **kwargs)
                return generate_response(False, error=ERR_TOKEN_INVALID, status_code=401)

            principal = build_actor(claims.get("user_id"), claims.get("role"))
            if principal is None:
                if optional:
                    return f(*args, **kwargs)
                return generate_response(False, error=ERR_TOKEN_INVALID, status_code=401)

            # token_version / is_active. See session_is_current's docstring for
            # why a missing `tv` claim is 0 rather than a rejection.
            fresh, session_error = session_is_current(claims)
            if not fresh:
                if optional:
                    return f(*args, **kwargs)
                return generate_response(False, error=session_error, status_code=401)

            actor, err = _apply_delegation(principal)
            if err is not None:
                return err

            g.principal = principal
            g.actor = actor
            # Ported handler bodies read this. Keep the original claim dict's
            # extra keys so nothing that peeked at `exp` breaks.
            merged = dict(claims)
            merged.update(actor.to_current_user())
            request.current_user = merged

            # ---- authorise ------------------------------------------------
            allowed = False
            if owner_param is not None:
                owner_value = kwargs.get(owner_param)
                if owner_value is None:
                    payload = request.get_json(silent=True) or {}
                    owner_value = payload.get(owner_param) or request.args.get(owner_param)
                if owner_value is not None and resolve_actor(owner_value, owner_perm, None, actor=actor):
                    allowed = True

            if not allowed:
                allowed = actor.can_all(perms) if perms else True

            if not allowed:
                logger.warning(
                    "Permission denied: user=%s role=%s needs=%s path=%s",
                    actor.id, actor.role.value, [p.value for p in perms], request.path,
                )
                return generate_response(False, error=denied_message or ERR_FORBIDDEN, status_code=403)

            if require_doctor_approved and actor.role is Role.DOCTOR:
                if current_app.config.get("ENFORCE_DOCTOR_VERIFICATION", False):
                    if not _doctor_is_approved(actor.id):
                        return generate_response(
                            False,
                            error="Your licence is still pending admin approval.",
                            status_code=403,
                        )

            return f(*args, **kwargs)

        return decorated

    return decorator


def require_role(*roles, denied_message=None):
    """Escape hatch for the handful of places that genuinely care about the ROLE
    rather than a capability (e.g. `/login` role matching). Prefer
    require_permission everywhere else."""
    wanted = {normalize_role(r) for r in roles}

    def decorator(f):
        @require_permission()
        @wraps(f)
        def decorated(*args, **kwargs):
            actor = current_actor()
            if actor is None or actor.role not in wanted:
                return generate_response(False, error=denied_message or ERR_FORBIDDEN, status_code=403)
            return f(*args, **kwargs)

        return decorated

    return decorator


# ======================================================================
# LEGACY COMPATIBILITY DECORATORS
# ======================================================================
# Byte-for-byte behavioural copies of the five decorators at monolith lines
# 99-192, moved out of app.py so they no longer import the Flask app object
# (that was the circular import). They exist so a route can be ported in one
# step (move the body) and hardened in a second step (swap the decorator for
# require_permission) -- never both at once.
#
# They additionally populate g.actor / g.principal so a ported body can already
# call resolve_actor() while still wearing its old decorator.
# ======================================================================
def _legacy_set_identity(claims):
    request.current_user = claims
    actor = build_actor(claims.get("user_id"), claims.get("role"))
    g.principal = actor
    g.actor = actor


def _legacy_guard(role_check, denied_error):
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            _reset_request_identity()
            token = get_token_data(request)
            if not token:
                return generate_response(False, error=ERR_TOKEN_MISSING, status_code=401)

            try:
                data = decode_token(token)
                if role_check is not None and not role_check(data.get("role")):
                    logger.warning(
                        "Unauthorized %s access attempt by user %s",
                        denied_error, data.get("user_id"),
                    )
                    return generate_response(False, error=denied_error, status_code=403)
                # A revoked session has to be revoked EVERYWHERE, not just on the
                # handful of routes already wearing require_permission -- otherwise
                # /auth/logout-all is theatre. Config ENFORCE_SESSION_VERSION turns
                # it off without a code change if it ever misfires.
                if current_app.config.get("ENFORCE_SESSION_VERSION", True):
                    fresh, session_error = session_is_current(data)
                    if not fresh:
                        return generate_response(False, error=session_error, status_code=401)
                _legacy_set_identity(data)
            except jwt.ExpiredSignatureError:
                return generate_response(False, error=ERR_TOKEN_EXPIRED, status_code=401)
            except jwt.InvalidTokenError:
                return generate_response(False, error=ERR_TOKEN_INVALID, status_code=401)

            return f(*args, **kwargs)

        return decorated

    return decorator


def token_required(f):
    """Monolith line 99. Applied to ZERO routes in the original app."""
    return _legacy_guard(None, ERR_FORBIDDEN)(f)


def token_optional(f):
    """Monolith line 117. Used by /api/chat."""

    @wraps(f)
    def decorated(*args, **kwargs):
        _reset_request_identity()
        token = get_token_data(request)
        request.current_user = None
        if token:
            try:
                data = decode_token(token)
                # A stale token here must not 401 -- /api/chat is deliberately
                # usable logged-out. It simply stops being an identity.
                fresh, _ = session_is_current(data)
                if fresh:
                    _legacy_set_identity(data)
            except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
                pass
        return f(*args, **kwargs)

    return decorated


def admin_required(f):
    """Monolith line 131."""
    return _legacy_guard(lambda r: r == Role.ADMIN.value, ERR_ADMIN_ONLY)(f)


def doctor_required(f):
    """Monolith line 152."""
    return _legacy_guard(lambda r: r == Role.DOCTOR.value, ERR_DOCTOR_ONLY)(f)


def patient_required(f):
    """Monolith line 173. NOTE the original accepted 'AI User' OR 'Patient'."""
    return _legacy_guard(lambda r: r in ["AI User", "Patient"], ERR_PATIENT_ONLY)(f)


__all__ = [
    "Role",
    "ROLE_ALIASES",
    "ROLE_RANK",
    "normalize_role",
    "role_rank",
    "Permission",
    "PATIENT_PERMS",
    "DOCTOR_PERMS",
    "ADMIN_PERMS",
    "ROLE_PERMISSIONS",
    "permissions_for",
    "Actor",
    "build_actor",
    "current_actor",
    "current_principal",
    "resolve_actor",
    "session_is_current",
    "require_permission",
    "require_role",
    "get_token_data",
    "decode_token",
    "token_required",
    "token_optional",
    "admin_required",
    "doctor_required",
    "patient_required",
    "ERR_TOKEN_MISSING",
    "ERR_TOKEN_EXPIRED",
    "ERR_TOKEN_INVALID",
    "ERR_SESSION_REVOKED",
    "ERR_ACCOUNT_DISABLED",
    "ERR_ADMIN_ONLY",
    "ERR_DOCTOR_ONLY",
    "ERR_PATIENT_ONLY",
]
