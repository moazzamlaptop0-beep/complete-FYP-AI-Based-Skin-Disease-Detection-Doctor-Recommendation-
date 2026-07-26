"""
Root admin seed.

    flask seed-root
    (or)  .venv/Scripts/python.exe -m seeds.seed_root_admin

Reads ROOT_ADMIN_EMAIL, ROOT_ADMIN_PASSWORD and ROOT_ADMIN_NAME from the
environment (.env). Idempotent: running it twice updates the existing row and
reports "already exists" rather than exploding on the unique email index.

WHY is_root EXISTS AND WHY IT IS NOT AN HTTP CONCEPT
----------------------------------------------------
`is_root` is set HERE and nowhere else. There is no route, no request body key
and no admin screen that can flip it -- deliberately. It marks the one account
that:
  * cannot be impersonated (app/core/rbac.py refuses any act-as whose target
    is_root), and
  * is the recovery path when every other admin account is lost.
If it were settable over HTTP, one compromised admin session would be enough to
mint an unimpersonatable superuser.

The 12-character minimum is enforced below and is stricter than the normal
user password rule on purpose.
"""

import datetime
import os
import sys

MIN_PASSWORD_LENGTH = 12


def seed_root_admin(email=None, password=None, name=None, db=None):
    """Create or refresh the root admin.

    Returns {"created": bool, "user_id": int, "message": str}.
    Raises ValueError on missing/short credentials.
    """
    from app.core.db import SessionLocal
    from app.core.security import hash_password
    from app.models import User

    email = (email or os.environ.get("ROOT_ADMIN_EMAIL") or "").strip().lower()
    password = password or os.environ.get("ROOT_ADMIN_PASSWORD") or ""
    name = name or os.environ.get("ROOT_ADMIN_NAME") or "Root Administrator"

    if not email:
        raise ValueError(
            "ROOT_ADMIN_EMAIL is not set. Add it to FYP-backend/.env or pass --email."
        )
    if not password:
        raise ValueError(
            "ROOT_ADMIN_PASSWORD is not set. Add it to FYP-backend/.env or pass --password."
        )
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(
            f"ROOT_ADMIN_PASSWORD must be at least {MIN_PASSWORD_LENGTH} characters "
            f"(got {len(password)}). This account can never be impersonated and is "
            f"the recovery path for the whole platform."
        )

    owns_session = db is None
    db = db or SessionLocal()
    try:
        existing = db.query(User).filter(User.email == email).first()

        if existing:
            existing.name = name
            existing.password = hash_password(password)
            existing.role = "Admin"          # exact literal -- never rename
            existing.is_root = True
            existing.is_verified = True
            existing.is_active = True
            existing.otp_code = None
            existing.otp_created_at = None
            existing.otp_attempts = 0
            db.commit()
            return {
                "created": False,
                "user_id": existing.id,
                "message": f"Root admin already exists; refreshed credentials for {email} (id={existing.id}).",
            }

        user = User(
            name=name,
            email=email,
            password=hash_password(password),
            role="Admin",
            is_root=True,
            is_verified=True,
            is_active=True,
            token_version=0,
            marketing_opt_in=False,
            otp_attempts=0,
            created_at=datetime.datetime.now(datetime.timezone.utc),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return {
            "created": True,
            "user_id": user.id,
            "message": f"Root admin created: {email} (id={user.id}).",
        }
    except Exception:
        db.rollback()
        raise
    finally:
        if owns_session:
            db.close()


def main():
    from dotenv import load_dotenv

    load_dotenv()

    from app import create_app

    app = create_app()
    with app.app_context():
        try:
            result = seed_root_admin()
        except ValueError as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            return 1
        print(result["message"])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
