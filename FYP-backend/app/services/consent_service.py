"""
Versioned consent: which document, which version, granted or refused, when, by
whom, from where.

WHY A TABLE AND NOT A BOOLEAN
-----------------------------
"Did this user agree to share their skin photographs with a reviewing doctor?"
is a question a medical product has to be able to answer MONTHS later, about the
version of the text that was on screen AT THE TIME. A `terms_accepted` boolean
on `users` answers none of that: it cannot tell you which wording, and it is
silently wrong the moment the text changes.

So: `consent_documents` holds versioned text, `user_consents` is an append-only
grant log. Re-prompting on a new version is then trivial -- a user is "pending"
for a document when they have no GRANTED row at the CURRENT version.

MANDATORY vs OPTIONAL IS DEFINED HERE, IN CODE
----------------------------------------------
Not in the database, and deliberately so: whether a consent is refusable is a
product/legal rule, not per-row data, and it must be reviewable in a diff. See
CONSENT_SPECS below -- `mandatory=True` means registration is refused without
it; `mandatory=False` means the user may say no and still have an account.
"""

import logging

from app.core.rbac import Role, normalize_role
from app.core.security import utcnow
from app.models import enums

logger = logging.getLogger(__name__)


# ======================================================================
# THE CATALOGUE
# ======================================================================
# Re-exported from app/models/enums.py rather than redeclared, so the literal
# written to user_consents.consent_type has exactly one definition in the
# codebase. Importers may keep using consent_service.CONSENT_TERMS.
CONSENT_TERMS = enums.CONSENT_TERMS
CONSENT_PRIVACY = enums.CONSENT_PRIVACY
CONSENT_MEDICAL_DATA = enums.CONSENT_MEDICAL_DATA
CONSENT_LICENSE_ATTESTATION = enums.CONSENT_LICENSE_ATTESTATION
CONSENT_DOCTOR_DATA_SHARING = enums.CONSENT_DOCTOR_DATA_SHARING
CONSENT_MARKETING = enums.CONSENT_MARKETING

CURRENT_VERSION = "1"

# roles=None means "everyone". `url_path` is a route in the existing React app
# where one exists, so the signup form can link the real text rather than a
# placeholder.
CONSENT_SPECS = (
    {
        "consent_type": CONSENT_TERMS,
        "version": CURRENT_VERSION,
        "title": "Terms of Use",
        "url_path": "/terms-of-use",
        "mandatory": True,
        "roles": None,
        "why": "Baseline contract. No account without it.",
    },
    {
        "consent_type": CONSENT_PRIVACY,
        "version": CURRENT_VERSION,
        "title": "Privacy Policy",
        "url_path": "/privacy-policy",
        "mandatory": True,
        "roles": None,
        "why": "Baseline contract. No account without it.",
    },
    {
        "consent_type": CONSENT_MEDICAL_DATA,
        "version": CURRENT_VERSION,
        "title": "Processing of Medical Images and Health Data",
        "url_path": "/privacy-policy#medical-data",
        "mandatory": True,
        "roles": None,
        "why": (
            "Skin photographs are health data. Uploading one to an AI model is "
            "processing a special category of personal data, and the product "
            "does nothing at all without it -- so it is mandatory rather than "
            "an opt-in the user could switch off and be left with a dead app."
        ),
    },
    {
        "consent_type": CONSENT_LICENSE_ATTESTATION,
        "version": CURRENT_VERSION,
        "title": "Medical Licence Attestation",
        "url_path": "/terms-of-use#licence",
        "mandatory": True,
        "roles": (Role.DOCTOR.value,),
        "why": (
            "DOCTORS ONLY. The signer states the PMDC licence is genuine and "
            "theirs. This is the record that makes a fraudulent registration "
            "the registrant's act rather than the platform's oversight."
        ),
    },
    {
        "consent_type": CONSENT_DOCTOR_DATA_SHARING,
        "version": CURRENT_VERSION,
        "title": "Share My Scans With Reviewing Doctors",
        "url_path": "/privacy-policy#sharing",
        "mandatory": False,
        "roles": None,
        "why": (
            "OPTIONAL. Refusing keeps the AI triage working; it only means no "
            "human doctor is shown the images. A genuine choice, so it must be "
            "refusable -- a mandatory 'optional' consent is not consent."
        ),
    },
    {
        "consent_type": CONSENT_MARKETING,
        "version": CURRENT_VERSION,
        "title": "Product and Health Tips by Email",
        "url_path": "/privacy-policy#marketing",
        "mandatory": False,
        "roles": None,
        "why": (
            "OPTIONAL and OPT-IN (unticked by default). Mirrored onto "
            "users.marketing_opt_in so the mailer never has to join this table."
        ),
    },
)

SPECS_BY_TYPE = {spec["consent_type"]: spec for spec in CONSENT_SPECS}


def specs_for_role(role):
    """The documents that apply to a role, in catalogue order."""
    resolved = normalize_role(role)
    value = resolved.value if resolved else None
    out = []
    for spec in CONSENT_SPECS:
        roles = spec["roles"]
        if roles is None or (value is not None and value in roles):
            out.append(spec)
    return out


def mandatory_types_for_role(role):
    return {s["consent_type"] for s in specs_for_role(role) if s["mandatory"]}


# ======================================================================
# DOCUMENT LOOKUP
# ======================================================================
def _document_payload(consent_type, version, title, url_path, mandatory):
    return {
        "type": consent_type,
        "version": version,
        "title": title,
        "url_path": url_path,
        "mandatory": bool(mandatory),
    }


def current_documents(db, role=None):
    """Documents the signup form must render, newest version of each.

    Reads `consent_documents` when it has been seeded (scripts/seed_consent_docs.py)
    and falls back to CONSENT_SPECS otherwise, so a fresh database -- or a test
    that never ran the seed -- still produces a usable signup form instead of an
    empty consent list that silently lets everyone through.
    """
    from app.models import ConsentDocument

    rows = {}
    try:
        for row in db.query(ConsentDocument).filter(ConsentDocument.is_current.is_(True)).all():
            rows[row.consent_type] = row
    except Exception as exc:  # pragma: no cover - table missing on an old DB
        logger.warning("consent_documents unreadable, falling back to code specs: %s", exc)

    out = []
    for spec in specs_for_role(role):
        row = rows.get(spec["consent_type"])
        out.append(_document_payload(
            spec["consent_type"],
            row.version if row is not None else spec["version"],
            row.title if row is not None else spec["title"],
            (row.body_url if row is not None and row.body_url else spec["url_path"]),
            spec["mandatory"],
        ))
    return out


def current_version_of(db, consent_type):
    """The version a grant must carry to count as up to date."""
    from app.models import ConsentDocument

    try:
        row = (
            db.query(ConsentDocument)
            .filter(
                ConsentDocument.consent_type == consent_type,
                ConsentDocument.is_current.is_(True),
            )
            .first()
        )
        if row is not None:
            return row.version
    except Exception:  # pragma: no cover
        pass
    spec = SPECS_BY_TYPE.get(consent_type)
    return spec["version"] if spec else CURRENT_VERSION


# ======================================================================
# GRANTS
# ======================================================================
def granted_types(db, user, version_aware=True):
    """{consent_type: version} of everything this user has GRANTED and not
    revoked. With `version_aware`, a grant for an older version does not count
    as current -- that is what drives the re-prompt."""
    from app.models import UserConsent

    rows = (
        db.query(UserConsent)
        .filter(
            UserConsent.user_id == user.id,
            UserConsent.granted.is_(True),
            UserConsent.revoked_at.is_(None),
            UserConsent.target_ref.is_(None),
        )
        .order_by(UserConsent.id.asc())
        .all()
    )
    out = {}
    for row in rows:
        if version_aware:
            if row.version == current_version_of(db, row.consent_type):
                out[row.consent_type] = row.version
        else:
            out[row.consent_type] = row.version
    return out


def pending_consents(db, user):
    """The `pending_consents` key of /auth/me.

        [{type, version, title, url_path}]

    MANDATORY documents only. An unaccepted OPTIONAL document is not pending --
    the user already answered it, and re-asking forever is dark-pattern
    behaviour. Non-empty here means the UI must show the re-consent step before
    letting the session proceed.
    """
    try:
        held = granted_types(db, user)
    except Exception as exc:  # pragma: no cover - table missing
        logger.warning("user_consents unreadable, treating nothing as pending: %s", exc)
        return []

    pending = []
    for doc in current_documents(db, user.role):
        if not doc["mandatory"]:
            continue
        if held.get(doc["type"]) == doc["version"]:
            continue
        pending.append({
            "type": doc["type"],
            "version": doc["version"],
            "title": doc["title"],
            "url_path": doc["url_path"],
        })
    return pending


def missing_mandatory(db, role, submitted):
    """Consent types the caller must still tick before registration succeeds.

    `submitted` is the raw request list: [{type, version, granted}].
    A mandatory document counts only when granted is TRUE -- sending
    `{granted:false}` is an explicit refusal, not a shortcut past the gate.
    """
    accepted = {
        str(item.get("type"))
        for item in (submitted or [])
        if isinstance(item, dict) and item.get("granted") is True
    }
    return sorted(mandatory_types_for_role(role) - accepted)


def record_consents(db, user, submitted, source="signup"):
    """Append one `user_consents` row per submitted item. Returns the count.

    APPEND-ONLY. A user who re-grants at a new version gets a NEW row; the old
    one is left exactly as it was, because the whole point is being able to
    reconstruct what was true on a given date. Regranting supersedes rather than
    edits: the previous granted row for that type is stamped `revoked_at` so
    "currently held" stays a single unambiguous row.

    Unknown consent types are IGNORED rather than 400'd -- a client on a newer
    build sending a type this server has not deployed yet must not be unable to
    register.
    """
    from app.models import UserConsent

    from app.services.auth_service import request_ip, request_user_agent

    if not submitted:
        return 0

    ip = request_ip()
    user_agent = request_user_agent()
    now = utcnow()
    written = 0

    for item in submitted:
        if not isinstance(item, dict):
            continue
        consent_type = str(item.get("type") or "").strip()
        if consent_type not in SPECS_BY_TYPE:
            logger.info("Ignoring unknown consent type %r from user %s", consent_type, user.id)
            continue

        granted = bool(item.get("granted"))
        version = str(item.get("version") or current_version_of(db, consent_type))

        # Supersede the previous live answer for this type.
        previous = (
            db.query(UserConsent)
            .filter(
                UserConsent.user_id == user.id,
                UserConsent.consent_type == consent_type,
                UserConsent.revoked_at.is_(None),
                UserConsent.target_ref.is_(None),
            )
            .all()
        )
        for row in previous:
            row.revoked_at = now

        db.add(UserConsent(
            user_id=user.id,
            consent_type=consent_type,
            version=version,
            granted=granted,
            granted_at=now,
            revoked_at=None,
            ip=ip,
            user_agent=user_agent,
            source=source,
            target_ref=None,
        ))
        written += 1

        # users.marketing_opt_in is a denormalised mirror so the mailing list
        # query never has to join user_consents. It is a cache, not the record.
        if consent_type == CONSENT_MARKETING:
            user.marketing_opt_in = granted

    db.flush()
    return written


__all__ = [
    "CONSENT_TERMS",
    "CONSENT_PRIVACY",
    "CONSENT_MEDICAL_DATA",
    "CONSENT_LICENSE_ATTESTATION",
    "CONSENT_DOCTOR_DATA_SHARING",
    "CONSENT_MARKETING",
    "CURRENT_VERSION",
    "CONSENT_SPECS",
    "SPECS_BY_TYPE",
    "specs_for_role",
    "mandatory_types_for_role",
    "current_documents",
    "current_version_of",
    "granted_types",
    "pending_consents",
    "missing_mandatory",
    "record_consents",
]
