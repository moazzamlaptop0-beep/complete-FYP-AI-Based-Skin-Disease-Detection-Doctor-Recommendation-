"""system_settings -- runtime-editable SMTP / email / OTP configuration

Changing the SMTP password or the OTP expiry used to mean editing .env and
restarting the process, which in practice meant "file a ticket". This table
lets the admin console change those values at runtime: one row per setting,
keyed by the SAME name the Flask config / environment uses, read through
app/services/settings_service.py with the cascade

    system_settings row -> current_app.config -> os.environ -> hard default.

No seed rows on purpose: an absent row means "keep whatever the process booted
with", so a fresh deploy behaves exactly as before this revision.

Revision ID: e7b3a95c1d42
Revises: d2e8f14b7c31
"""

import sqlalchemy as sa
from alembic import op

revision = "e7b3a95c1d42"
down_revision = "d2e8f14b7c31"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "system_settings",
        sa.Column("key", sa.String(length=64), primary_key=True),
        # TEXT, not typed columns: booleans as "true"/"false", integers as
        # their decimal string. The typed coercion lives in settings_service.
        sa.Column("value", sa.Text(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=False,
                  server_default=sa.text("CURRENT_TIMESTAMP")),
    )


def downgrade():
    op.drop_table("system_settings")
