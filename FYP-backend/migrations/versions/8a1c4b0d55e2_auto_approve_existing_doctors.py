"""auto-approve existing doctors

Revision ID: 8a1c4b0d55e2
Revises: 4f3c55cfee7d
Create Date: 2026-07-25 22:20:00.000000

A DATA migration. It adds no column, drops nothing, and changes no type.

WHY IT EXISTS
-------------
`ENFORCE_DOCTOR_VERIFICATION` goes ON in this phase, so a doctor whose
`verification_status` is not 'approved' loses every WRITE route (setting
availability, fees, reviewing a scan). Every doctor already in the database
registered when the flag did not exist and nothing ever approved them -- their
rows say 'pending' purely because that is the column default, not because an
admin looked and hesitated. Turning enforcement on without this migration would
silently lock out the entire existing doctor base on deploy.

USER DECISION, VERBATIM: "AUTO-APPROVE existing doctors, ENFORCE for new
signups." So every pre-existing pending row is approved here, and
`/auth/register` + `/register` keep creating new doctors as 'pending'.

WHY 'rejected' ROWS ARE LEFT ALONE
----------------------------------
A 'rejected' row is the one state in this column that records a HUMAN DECISION:
an admin looked at that licence and refused it. 'pending' is an absence of a
decision; 'rejected' is a decision. Auto-approving a refusal would quietly
overturn an admin's judgement and re-admit a licence somebody already judged
fraudulent -- so those rows are counted, reported, and skipped.

The note is written into `verification_note` so that six months from now the
difference between "an admin approved this licence" and "a migration approved
this licence" is still visible in the row itself, which is exactly the sort of
thing a medical product gets asked about.

IDEMPOTENT: the WHERE clause only matches rows that are not already approved,
so re-running is a no-op. DOWNGRADE only reverts rows still carrying this
migration's exact note, so a licence an admin has since reviewed by hand is
never dragged back to 'pending'.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = '8a1c4b0d55e2'
down_revision: Union[str, None] = '4f3c55cfee7d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Written verbatim into doctor_profiles.verification_note, and matched verbatim
# by downgrade(). Changing this string breaks the downgrade -- do not reword it.
MIGRATION_NOTE = (
    "Auto-approved by migration 8a1c4b0d55e2: this account registered before "
    "licence verification was enforced, so its 'pending' status was the column "
    "default rather than an admin decision. New registrations start pending and "
    "require an admin to approve them."
)


def upgrade() -> None:
    bind = op.get_bind()

    total = bind.execute(sa.text("SELECT count(*) FROM doctor_profiles")).scalar() or 0
    already = bind.execute(sa.text(
        "SELECT count(*) FROM doctor_profiles WHERE verification_status = 'approved'"
    )).scalar() or 0
    rejected = bind.execute(sa.text(
        "SELECT count(*) FROM doctor_profiles WHERE verification_status = 'rejected'"
    )).scalar() or 0

    result = bind.execute(
        sa.text(
            """
            UPDATE doctor_profiles
               SET verification_status = 'approved',
                   verification_note   = :note,
                   verified_at         = COALESCE(verified_at, now())
             WHERE verification_status IS NULL
                OR verification_status NOT IN ('approved', 'rejected')
            """
        ),
        {"note": MIGRATION_NOTE},
    )
    approved_now = result.rowcount if result.rowcount is not None else 0

    # Printed, not logged: `alembic upgrade head` is run by a human who needs to
    # see this number to know whether the deploy just unlocked the doctors it
    # was supposed to.
    print("")
    print("  [8a1c4b0d55e2] doctor licence auto-approval")
    print(f"     doctor profiles found ............ {total}")
    print(f"     already approved (untouched) ..... {already}")
    print(f"     rejected  (LEFT AS 'rejected') ... {rejected}")
    print(f"     AUTO-APPROVED BY THIS MIGRATION .. {approved_now}")
    print("     new doctors keep registering as 'pending' "
          "(ENFORCE_DOCTOR_VERIFICATION applies to them).")
    print("")


def downgrade() -> None:
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            """
            UPDATE doctor_profiles
               SET verification_status = 'pending',
                   verification_note   = NULL,
                   verified_at         = NULL
             WHERE verification_note = :note
            """
        ),
        {"note": MIGRATION_NOTE},
    )
    reverted = result.rowcount if result.rowcount is not None else 0
    print(f"  [8a1c4b0d55e2] reverted {reverted} auto-approved doctor profile(s) to 'pending'.")
