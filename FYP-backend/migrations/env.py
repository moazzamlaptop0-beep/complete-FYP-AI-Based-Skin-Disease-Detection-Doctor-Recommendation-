"""
Alembic environment.

Alembic is now the ONLY thing allowed to change the schema. `create_all()` is
gone from the boot path (see app/__init__.py -- it survives only behind
AUTO_CREATE_ALL for the test fixture), because a create_all() and a migration
chain disagreeing about the schema is exactly the drift this refactor removes.

The database URL comes from $DATABASE_URL, never from alembic.ini, so no
credential is ever committed.
"""

import os
import sys
from logging.config import fileConfig

from alembic import context
from dotenv import load_dotenv
from sqlalchemy import engine_from_config, pool

# Make the project root importable so `import app` works when alembic is run
# from anywhere.
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)

load_dotenv(os.path.join(BASE_DIR, ".env"))

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

database_url = os.environ.get("DATABASE_URL")
if not database_url:
    raise RuntimeError(
        "DATABASE_URL is not set. Alembic reads it from the environment "
        "(FYP-backend/.env), not from alembic.ini."
    )
config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))

# Importing app.models registers every mapped class against this MetaData.
from app.models import Base  # noqa: E402

target_metadata = Base.metadata


def include_object(obj, name, type_, reflected, compare_to):
    """Keep alembic_version out of autogenerate diffs."""
    if type_ == "table" and name == "alembic_version":
        return False
    return True


def run_migrations_offline():
    context.configure(
        url=config.get_main_option("sqlalchemy.url"),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        compare_server_default=True,
        include_object=include_object,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            compare_server_default=True,
            include_object=include_object,
        )
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
