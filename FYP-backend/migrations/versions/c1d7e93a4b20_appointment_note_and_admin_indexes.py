"""appointments.note + indexes the admin console sorts and filters on

Two unrelated-but-small gaps found after the phase-3 build, batched into one
revision to keep the chain short.

1. appointments.note
   /api/appointments/<id>/rebook and /api/patient-appointments/<id>/reschedule
   both accept a `note` from the patient ("the rash spread to my other arm").
   It was echoed back in the response and included in the doctor's email, but
   there was nowhere to put it, so it vanished the moment the request ended.
   The doctor then opened the appointment and saw nothing.

2. Three indexes behind the admin console.
   Every /admin/* list orders by created_at DESC, id DESC and the audit log is
   filterable by subject_user_id. audit_logs.actor_user_id was indexed but
   subject_user_id was not, so filtering "everything done TO this user" -- the
   query that matters when reviewing an impersonation -- was a sequential scan
   on the fastest-growing table in the schema.

Revision ID: c1d7e93a4b20
Revises: 8a1c4b0d55e2
"""

import sqlalchemy as sa
from alembic import op

revision = "c1d7e93a4b20"
down_revision = "8a1c4b0d55e2"
branch_labels = None
depends_on = None


def upgrade():
    # Nullable: every existing appointment predates the field and legitimately
    # has no note, which is not the same as an empty one.
    op.add_column("appointments", sa.Column("note", sa.Text(), nullable=True))

    op.create_index(
        "ix_users_created_at",
        "users",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "ix_appointments_created_at",
        "appointments",
        ["created_at"],
        unique=False,
    )
    op.create_index(
        "ix_audit_logs_subject_user_id",
        "audit_logs",
        ["subject_user_id"],
        unique=False,
    )


def downgrade():
    op.drop_index("ix_audit_logs_subject_user_id", table_name="audit_logs")
    op.drop_index("ix_appointments_created_at", table_name="appointments")
    op.drop_index("ix_users_created_at", table_name="users")
    op.drop_column("appointments", "note")
