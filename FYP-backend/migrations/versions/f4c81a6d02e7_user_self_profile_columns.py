"""users self-profile columns -- phone, city, date_of_birth, gender, avatar_url

WHY
---
Before this revision there was NO way for a patient or an admin to edit their
own account at all. The single self-write in the entire API was
`POST /api/doctor/profile`, which is doctor-only, multipart-only, ignores every
falsy value (so nothing could be blanked) and writes `doctor_profiles`, not
`users`. Everyone else had a name and an email address and nothing more.

These five columns are the account-level facts that belong to a PERSON rather
than to a clinic listing. All nullable: a profile is filled in over time, and a
NOT NULL would mean inventing values for every existing row.

THE OVERLAP WITH doctor_profiles IS DELIBERATE
----------------------------------------------
`doctor_profiles.city` / `.phone` describe the CLINIC and are published in the
public directory. `users.city` / `.phone` describe the person and are not.
Collapsing the pair would publish a doctor's home town the first time they
edited their own profile, so both stay.

`avatar_url` stores the NO-LEADING-SLASH form ("static/uploads/avatar_u7_x.jpg")
exactly like `doctor_profiles.profile_image`, and the filename never contains
the substring "scan_" -- the legacy /static/uploads route refuses those, and an
avatar that 404s on every page is worse than no avatar.

Revision ID: f4c81a6d02e7
Revises: e7b3a95c1d42
"""

import sqlalchemy as sa
from alembic import op

revision = "f4c81a6d02e7"
down_revision = "e7b3a95c1d42"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("phone", sa.String(length=32), nullable=True))
    op.add_column("users", sa.Column("city", sa.String(length=120), nullable=True))
    op.add_column("users", sa.Column("date_of_birth", sa.Date(), nullable=True))
    op.add_column("users", sa.Column("gender", sa.String(length=20), nullable=True))
    op.add_column("users", sa.Column("avatar_url", sa.String(length=500), nullable=True))


def downgrade():
    op.drop_column("users", "avatar_url")
    op.drop_column("users", "gender")
    op.drop_column("users", "date_of_birth")
    op.drop_column("users", "city")
    op.drop_column("users", "phone")
