"""guest_scans -- hold a scan taken before sign-up, then claim it

A visitor could scan without an account, but the result was thrown away: the
model ran, the answer came back, and nothing was stored (ai_scans.user_id is
NOT NULL). So signing in afterwards meant "go back and scan again" -- the photo
was gone and the person had already done the work once.

This table holds the guest's scan against an opaque per-browser token. Signing
in claims every unclaimed row for that token into ai_scans, owned by the new
user, reusing the SAME image file and the SAME verdict.

Revision ID: d2e8f14b7c31
Revises: c1d7e93a4b20
"""

import sqlalchemy as sa
from alembic import op

revision = "d2e8f14b7c31"
down_revision = "c1d7e93a4b20"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "guest_scans",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("guest_token", sa.String(length=64), nullable=False),
        sa.Column("image_url", sa.String(length=500), nullable=False),
        sa.Column("thumb_url", sa.String(length=500), nullable=True),
        sa.Column("blur_url", sa.String(length=500), nullable=True),
        sa.Column("prediction_result", sa.String(length=255), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=True),
        sa.Column("is_sensitive", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("patient_questionnaire", sa.Text(), nullable=True),
        sa.Column("severity_level", sa.String(length=50), nullable=True),
        sa.Column("triage_score", sa.Integer(), nullable=True, server_default="0"),
        sa.Column("triage_reasons", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False,
                  server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("claimed_at", sa.DateTime(), nullable=True),
        sa.Column("claimed_by", sa.Integer(), nullable=True),
        sa.Column("claimed_scan_id", sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(["claimed_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["claimed_scan_id"], ["ai_scans.id"], ondelete="SET NULL"),
    )
    op.create_index("ix_guest_scans_guest_token", "guest_scans", ["guest_token"])
    op.create_index("ix_guest_scans_created_at", "guest_scans", ["created_at"])
    # The purge job sweeps on this one.
    op.create_index("ix_guest_scans_expires_at", "guest_scans", ["expires_at"])
    op.create_index("ix_guest_scans_claimed_by", "guest_scans", ["claimed_by"])


def downgrade():
    op.drop_index("ix_guest_scans_claimed_by", table_name="guest_scans")
    op.drop_index("ix_guest_scans_expires_at", table_name="guest_scans")
    op.drop_index("ix_guest_scans_created_at", table_name="guest_scans")
    op.drop_index("ix_guest_scans_guest_token", table_name="guest_scans")
    op.drop_table("guest_scans")
