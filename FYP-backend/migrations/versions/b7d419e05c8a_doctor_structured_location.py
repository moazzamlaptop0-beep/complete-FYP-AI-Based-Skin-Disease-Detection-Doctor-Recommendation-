"""doctor_profiles structured location -- state, country

WHY
---
`doctor_profiles` stored a free-text `city` and a raw lat/lng pair, and nothing
else. The registration form and the doctor profile now submit a GEOCODED place
(one picked search result yields city + state + country + coordinates), so the
two administrative levels that make a city unambiguous finally have somewhere
to live. Without them "Hyderabad" is either Sindh or Telangana, "Peshawar" has
no province next to it in the directory, and the only way to tell two clinics
apart is to read their coordinates.

Both nullable, and no backfill: every existing row was created before the
picker existed and there is no honest way to invent a province for a city
somebody typed by hand. They fill in as doctors re-save their profile.

WIDTH
-----
120, against `city`'s 100. Province and country names are printed in full in
the directory ("Khyber Pakhtunkhwa", "United Arab Emirates") and are never
abbreviated, so the column has to hold the longest one anybody might pick, not
the longest one seen so far. The writers cap to these widths
(app/core/validation.py::LOCATION_TEXT_LIMITS) because Postgres raises
StringDataRightTruncation rather than trimming -- an over-long value would be a
500 at signup, not a shortened province.

Revision ID: b7d419e05c8a
Revises: f4c81a6d02e7
"""

import sqlalchemy as sa
from alembic import op

revision = "b7d419e05c8a"
down_revision = "f4c81a6d02e7"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("doctor_profiles", sa.Column("state", sa.String(length=120), nullable=True))
    op.add_column("doctor_profiles", sa.Column("country", sa.String(length=120), nullable=True))


def downgrade():
    op.drop_column("doctor_profiles", "country")
    op.drop_column("doctor_profiles", "state")
