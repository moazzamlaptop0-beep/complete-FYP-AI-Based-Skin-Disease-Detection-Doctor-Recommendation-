"""
Declarative base + shared column helpers.

`Base` is THE metadata object Alembic targets (migrations/env.py sets
target_metadata = Base.metadata), and the top-level `database.py` shim
re-exports it so legacy/app_monolith.py's `models.Base.metadata.create_all()`
still resolves to the same object.
"""

import datetime

from sqlalchemy import Column, DateTime
from sqlalchemy.orm import declarative_base

Base = declarative_base()


def utcnow():
    """Timezone-aware UTC, matching the lambda the original models.py used as a
    column default."""
    return datetime.datetime.now(datetime.timezone.utc)


def created_at_column(**kwargs):
    return Column(DateTime, default=utcnow, **kwargs)


__all__ = ["Base", "utcnow", "created_at_column"]
