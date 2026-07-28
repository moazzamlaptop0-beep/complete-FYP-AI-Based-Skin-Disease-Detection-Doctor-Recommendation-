"""
system_settings -- runtime-editable configuration.

One row per setting. `key` is the SAME string the Flask config / environment
uses (SMTP_HOST, OTP_LENGTH, ...), so the resolution order implemented by
app/services/settings_service.py is a straight cascade over one name:

    system_settings row  ->  current_app.config  ->  os.environ  ->  default

`value` is TEXT: booleans are stored as "true"/"false" and integers as their
decimal string; the typed getters in settings_service do the coercion.
Deleting a row simply falls back to whatever the process booted with, which is
why the table needs no seed migration.
"""

from sqlalchemy import Column, DateTime, String, Text

from app.models.base import Base, utcnow


class SystemSetting(Base):
    __tablename__ = "system_settings"

    key = Column(String(64), primary_key=True)
    value = Column(Text, nullable=True)
    updated_at = Column(DateTime, default=utcnow, onupdate=utcnow, nullable=False)


__all__ = ["SystemSetting"]
