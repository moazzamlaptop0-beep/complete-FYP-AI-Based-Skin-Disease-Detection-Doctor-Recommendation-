"""
Seed the versioned consent catalogue (v1).

    .venv/Scripts/python.exe scripts/seed_consent_docs.py

Idempotent. Re-running updates the existing row for a (type, version) pair
instead of inserting a duplicate -- `uq_consent_type_version` would reject one
anyway -- and demotes every OTHER version of the same type to is_current=False,
so exactly one row per consent_type is ever current.

WHAT GETS SEEDED, AND WHICH ONES A USER MAY REFUSE
==================================================
The mandatory/optional split lives in code (app/services/consent_service.py,
CONSENT_SPECS) and NOT in this table, deliberately: whether a consent is
refusable is a product/legal rule that has to be reviewable in a diff, not a
per-row boolean somebody can flip in psql at 2am. This script only writes the
TEXT metadata; consent_service decides what the answer means.

  MANDATORY -- registration is refused without them
  -------------------------------------------------
  terms_of_use              Baseline contract.
  privacy_policy            Baseline contract.
  medical_data_processing   A skin photograph is health data; uploading one to
                            an AI model is processing a special category of
                            personal data. Mandatory rather than opt-in because
                            refusing it leaves the product with nothing to do --
                            an "optional" consent whose refusal bricks the app
                            is not a real choice, and pretending otherwise is
                            worse than being honest that it is required.
  license_attestation       DOCTORS ONLY. The signer states the PMDC licence is
                            genuine and theirs. This row is what makes a
                            fraudulent registration the registrant's act rather
                            than the platform's oversight.

  OPTIONAL -- the user may say no and still have a working account
  ---------------------------------------------------------------
  doctor_data_sharing       Refusing keeps AI triage working; it only means no
                            human doctor is shown the images. A genuine choice,
                            so it must be genuinely refusable.
  marketing_email           OPT-IN, unticked by default. Mirrored onto
                            users.marketing_opt_in so the mailer never joins
                            this table.
"""

import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)


def seed_consent_docs(db=None):
    """Insert/refresh one consent_documents row per CONSENT_SPECS entry.

    Returns {"log": [str], "created": int, "updated": int, "documents": [dict]}.
    Requires an app context (for the engine); commits its own transaction when
    it opened the session itself.
    """
    from app.core.db import SessionLocal
    from app.core.security import utcnow
    from app.models import ConsentDocument
    from app.services.consent_service import CONSENT_SPECS

    owns_session = db is None
    db = db or SessionLocal()

    log = ["Seeding consent documents..."]
    created = 0
    updated = 0
    documents = []

    try:
        for spec in CONSENT_SPECS:
            consent_type = spec["consent_type"]
            version = spec["version"]

            row = (
                db.query(ConsentDocument)
                .filter(
                    ConsentDocument.consent_type == consent_type,
                    ConsentDocument.version == version,
                )
                .first()
            )

            if row is None:
                row = ConsentDocument(
                    consent_type=consent_type,
                    version=version,
                    title=spec["title"],
                    body_url=spec["url_path"],
                    is_current=True,
                    effective_from=utcnow(),
                )
                db.add(row)
                created += 1
                action = "created"
            else:
                row.title = spec["title"]
                row.body_url = spec["url_path"]
                row.is_current = True
                updated += 1
                action = "updated"

            # Exactly one current row per type. Any other version of the same
            # type is demoted, which is what makes the /auth/me re-prompt fire
            # when v2 lands.
            db.query(ConsentDocument).filter(
                ConsentDocument.consent_type == consent_type,
                ConsentDocument.version != version,
                ConsentDocument.is_current.is_(True),
            ).update({"is_current": False}, synchronize_session=False)

            kind = "MANDATORY" if spec["mandatory"] else "optional "
            audience = "all roles" if spec["roles"] is None else "+".join(spec["roles"])
            log.append(
                f"  {action}: {kind} {consent_type:<24} v{version}  [{audience}]"
            )
            documents.append({
                "type": consent_type,
                "version": version,
                "title": spec["title"],
                "url_path": spec["url_path"],
                "mandatory": spec["mandatory"],
            })

        db.flush()
        if owns_session:
            db.commit()

        mandatory = sum(1 for s in CONSENT_SPECS if s["mandatory"])
        log.append("")
        log.append(
            f"  {len(CONSENT_SPECS)} documents ({mandatory} mandatory, "
            f"{len(CONSENT_SPECS) - mandatory} optional): "
            f"{created} created, {updated} updated."
        )
        log.append("  GET /auth/consent-documents now serves these to the signup form.")

        return {"log": log, "created": created, "updated": updated, "documents": documents}
    except Exception:
        if owns_session:
            db.rollback()
        raise
    finally:
        if owns_session:
            db.close()


def main():
    from dotenv import load_dotenv

    load_dotenv(os.path.join(BASE_DIR, ".env"))

    from app import create_app

    app = create_app()
    with app.app_context():
        try:
            result = seed_consent_docs()
        except Exception as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 1
        for line in result["log"]:
            print(line)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
